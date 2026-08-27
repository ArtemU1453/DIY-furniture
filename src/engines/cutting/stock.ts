/**
 * Склад листовых материалов (§75–§80).
 *
 * Единый список позиций склада строится из уже существующих сущностей —
 * SheetMaterial (форматы) и StoredRemnant (остатки). Третьей модели склада
 * не заводится: это представление поверх проекта.
 */
import type {
  GrainDirection,
  Mm,
  Project,
  RemnantStatus,
  SheetMaterial,
  StoredRemnant,
} from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';

/** Стандартные форматы листа (§6). Пользовательские задаются вручную (§7). */
export const STANDARD_SHEET_SIZES: Array<{ name: string; height: Mm; width: Mm }> = [
  { name: '2750 × 1830', height: 2750, width: 1830 },
  { name: '2800 × 2070', height: 2800, width: 2070 },
  { name: '2440 × 1830', height: 2440, width: 1830 },
  { name: '3050 × 1830', height: 3050, width: 1830 },
  { name: '2500 × 1250', height: 2500, width: 1250 },
];

export type StockKind = 'SHEET' | 'REMNANT';
export type StockItemStatus = 'AVAILABLE' | 'RESERVED' | 'USED' | 'ARCHIVED';

/** Строка склада: формат листа или сохранённый остаток. */
export interface StockItem {
  id: string;
  kind: StockKind;
  materialId: MaterialId;
  materialName: string;
  name: string;
  width: Mm;
  height: Mm;
  thickness: Mm;
  grainDirection: GrainDirection;
  /** Доступное количество; 0 у формата означает неограниченный запас. */
  quantity: number;
  infinite: boolean;
  status: StockItemStatus;
  areaM2: number;
}

const m2 = (w: number, h: number) => (w * h) / 1_000_000;

function sheetStatus(sheet: SheetMaterial): StockItemStatus {
  if (sheet.archived) return 'ARCHIVED';
  const limited = sheet.stockMode === 'LIMITED' || (sheet.stockMode == null && sheet.availableQuantity > 0);
  return limited && sheet.availableQuantity <= 0 ? 'USED' : 'AVAILABLE';
}

function remnantStatus(remnant: StoredRemnant): StockItemStatus {
  return (remnant.status ?? 'AVAILABLE') as RemnantStatus as StockItemStatus;
}

/** Полный список позиций склада (§75). */
export function stockItems(project: Project): StockItem[] {
  const materialName = new Map(project.materials.map((m) => [String(m.id), m.name]));
  const thicknessOf = new Map(project.materials.map((m) => [String(m.id), m.thickness]));

  const sheets: StockItem[] = project.sheets.map((s) => ({
    id: s.id,
    kind: 'SHEET',
    materialId: s.materialId,
    materialName: materialName.get(String(s.materialId)) ?? '—',
    name: s.name,
    width: s.width,
    height: s.height,
    thickness: s.thickness || (thicknessOf.get(String(s.materialId)) ?? 0),
    grainDirection: s.grainDirection,
    quantity: s.availableQuantity,
    infinite: s.stockMode === 'INFINITE' || (s.stockMode == null && s.availableQuantity === 0),
    status: sheetStatus(s),
    areaM2: m2(s.width, s.height),
  }));

  const remnants: StockItem[] = project.remnants.map((r) => ({
    id: r.id,
    kind: 'REMNANT',
    materialId: r.materialId,
    materialName: materialName.get(String(r.materialId)) ?? '—',
    name: r.note?.trim() || `Остаток ${Math.round(r.width)}×${Math.round(r.height)}`,
    width: r.width,
    height: r.height,
    thickness: r.thickness,
    grainDirection: r.grainDirection,
    quantity: 1,
    infinite: false,
    status: remnantStatus(r),
    areaM2: m2(r.width, r.height),
  }));

  return [...sheets, ...remnants];
}

export interface StockFilter {
  /** Поиск по названию, id и размеру (§77). */
  query?: string;
  materialId?: MaterialId | '';
  thickness?: number | '';
  minWidth?: number | '';
  minHeight?: number | '';
  status?: StockItemStatus | '';
  kind?: StockKind | '';
}

/** Фильтрация и поиск по складу (§76/§77). */
export function filterStock(items: StockItem[], filter: StockFilter): StockItem[] {
  const q = (filter.query ?? '').trim().toLowerCase();
  return items.filter((it) => {
    if (filter.materialId && String(it.materialId) !== String(filter.materialId)) return false;
    if (filter.thickness !== '' && filter.thickness != null && it.thickness !== filter.thickness) return false;
    if (filter.minWidth !== '' && filter.minWidth != null && it.width < filter.minWidth) return false;
    if (filter.minHeight !== '' && filter.minHeight != null && it.height < filter.minHeight) return false;
    if (filter.status && it.status !== filter.status) return false;
    if (filter.kind && it.kind !== filter.kind) return false;
    if (!q) return true;
    const size = `${Math.round(it.height)}x${Math.round(it.width)}`;
    return (
      it.name.toLowerCase().includes(q) ||
      it.id.toLowerCase().includes(q) ||
      it.materialName.toLowerCase().includes(q) ||
      size.includes(q.replace(/[×\s]/g, 'x'))
    );
  });
}

/**
 * Используется ли формат листа активной картой раскроя (§79). Удаление
 * такого формата сделало бы сохранённый раскрой невоспроизводимым.
 */
export function isSheetInUse(project: Project, sheetId: string): boolean {
  const report = project.cutting.report;
  if (!report) return false;
  return report.jobs.some((job) =>
    job.sheets.some((sh) => sh.sheetMaterialId === sheetId && !sh.fromRemnant),
  );
}

/** Можно ли удалить позицию склада, и если нет — почему (§79/§80). */
export function canRemoveSheet(project: Project, sheetId: string): { ok: boolean; reason?: string } {
  if (!isSheetInUse(project, sheetId)) return { ok: true };
  return {
    ok: false,
    reason: 'Формат используется активной картой раскроя. Отправьте его в архив или пересчитайте раскрой.',
  };
}

/** Сводка склада по материалам (§64/§75). */
export interface StockSummaryRow {
  materialId: MaterialId;
  materialName: string;
  sheetCount: number;
  remnantCount: number;
  areaM2: number;
}

export function stockSummary(project: Project): StockSummaryRow[] {
  const rows = new Map<string, StockSummaryRow>();
  for (const it of stockItems(project)) {
    if (it.status === 'ARCHIVED') continue;
    const key = String(it.materialId);
    const row = rows.get(key) ?? {
      materialId: it.materialId,
      materialName: it.materialName,
      sheetCount: 0,
      remnantCount: 0,
      areaM2: 0,
    };
    if (it.kind === 'SHEET') row.sheetCount += it.infinite ? 0 : it.quantity;
    else row.remnantCount += 1;
    row.areaM2 += it.areaM2 * (it.kind === 'SHEET' && !it.infinite ? it.quantity : 1);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.materialName.localeCompare(b.materialName));
}
