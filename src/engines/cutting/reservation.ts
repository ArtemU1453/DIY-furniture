/**
 * Резервирование складского материала (§95–§103).
 *
 * Резерв — это ПОМЕТКА на существующей складской позиции, а не отдельный
 * учёт: лист получает счётчик `reserved`, остаток — статус RESERVED и ссылку
 * на задание. Поэтому второй системы склада не появляется, а снятие резерва
 * возвращает позицию в исходное состояние.
 */
import type {
  CuttingResult,
  Project,
  SheetMaterial,
  StoredRemnant,
} from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';

export interface ReservationRequest {
  /** Задание, под которое резервируется материал (§102). */
  jobId: string;
  materialId: MaterialId;
  thickness: number;
  /** Сколько листов нужно. */
  sheets: number;
  /** Идентификаторы остатков, которые пойдут в дело. */
  remnantIds?: string[];
}

export interface ReservationResult {
  sheets: SheetMaterial[];
  remnants: StoredRemnant[];
  /** Сколько листов удалось зарезервировать. */
  reservedSheets: number;
  /** Сколько остатков переведено в RESERVED. */
  reservedRemnants: number;
  /** Чего не хватило — показывается пользователю, а не глотается. */
  warnings: string[];
}

const sameMaterial = (a: unknown, b: unknown): boolean => String(a) === String(b);

/** Свободный остаток листа склада: запас минус уже зарезервированное. */
export function freeQuantity(sheet: SheetMaterial): number {
  const mode = sheet.stockMode ?? (sheet.availableQuantity === 0 ? 'INFINITE' : 'LIMITED');
  if (mode === 'INFINITE') return Infinity;
  return Math.max(0, sheet.availableQuantity - (sheet.reserved ?? 0));
}

/** Доступные листы под материал и толщину (§96/§98). */
export function availableSheets(
  project: Project,
  materialId: MaterialId,
  thickness: number,
): SheetMaterial[] {
  return project.sheets
    .filter((s) => !s.archived)
    .filter((s) => sameMaterial(s.materialId, materialId))
    .filter((s) => Math.abs(s.thickness - thickness) < 1e-6)
    .filter((s) => freeQuantity(s) > 0);
}

/**
 * Зарезервировать материал под задание (§101/§102).
 *
 * Резерв не «съедает» больше, чем есть: если складского запаса не хватает,
 * резервируется доступное, а нехватка возвращается предупреждением — раскрой
 * при этом добавит новые листы (§97).
 */
export function reserveForJob(project: Project, request: ReservationRequest): ReservationResult {
  const warnings: string[] = [];
  let remaining = Math.max(0, Math.trunc(request.sheets));
  let reservedSheets = 0;

  /* Складской лист с реальным запасом расходуется РАНЬШЕ бесконечного формата
   * (§98): сначала в дело идёт то, что уже куплено и лежит на складе. */
  const candidates = [...project.sheets]
    .map((sheet, index) => ({ sheet, index }))
    .filter(({ sheet }) => !sheet.archived
      && sameMaterial(sheet.materialId, request.materialId)
      && Math.abs(sheet.thickness - request.thickness) < 1e-6)
    .sort((a, b) => {
      const infinite = (x: SheetMaterial) => (freeQuantity(x) === Infinity ? 1 : 0);
      return infinite(a.sheet) - infinite(b.sheet) || a.index - b.index;
    });

  const reservedBySheet = new Map<string, number>();
  for (const { sheet } of candidates) {
    if (remaining === 0) break;
    const free = freeQuantity(sheet);
    const take = free === Infinity ? remaining : Math.min(free, remaining);
    if (take <= 0) continue;
    remaining -= take;
    reservedSheets += take;
    reservedBySheet.set(sheet.id, (reservedBySheet.get(sheet.id) ?? 0) + take);
  }

  const sheets = project.sheets.map((sheet) => {
    const take = reservedBySheet.get(sheet.id);
    return take ? { ...sheet, reserved: (sheet.reserved ?? 0) + take } : sheet;
  });

  if (remaining > 0) {
    warnings.push(`Не хватает листов на складе: ${remaining} шт. Раскрой добавит новые листы.`);
  }

  const wanted = new Set(request.remnantIds ?? []);
  let reservedRemnants = 0;
  const remnants = project.remnants.map((remnant) => {
    if (!wanted.has(remnant.id)) return remnant;
    if ((remnant.status ?? 'AVAILABLE') !== 'AVAILABLE') {
      warnings.push(`Остаток ${remnant.id} уже занят.`);
      return remnant;
    }
    reservedRemnants += 1;
    return { ...remnant, status: 'RESERVED' as const, reservedBy: request.jobId };
  });

  return { sheets, remnants, reservedSheets, reservedRemnants, warnings };
}

/** Снять резерв задания (§103). */
export function releaseJob(project: Project, jobId: string, sheets?: number): ReservationResult {
  let remaining = sheets === undefined ? Infinity : Math.max(0, Math.trunc(sheets));
  let releasedSheets = 0;

  const nextSheets = project.sheets.map((sheet) => {
    const reserved = sheet.reserved ?? 0;
    if (reserved <= 0 || remaining <= 0) return sheet;
    const take = remaining === Infinity ? reserved : Math.min(reserved, remaining);
    if (remaining !== Infinity) remaining -= take;
    releasedSheets += take;
    const next = reserved - take;
    const copy = { ...sheet };
    if (next > 0) copy.reserved = next;
    else delete copy.reserved;
    return copy;
  });

  let releasedRemnants = 0;
  const nextRemnants = project.remnants.map((remnant) => {
    if (remnant.reservedBy !== jobId) return remnant;
    releasedRemnants += 1;
    const copy = { ...remnant, status: 'AVAILABLE' as const };
    delete copy.reservedBy;
    return copy;
  });

  return {
    sheets: nextSheets,
    remnants: nextRemnants,
    reservedSheets: releasedSheets,
    reservedRemnants: releasedRemnants,
    warnings: [],
  };
}

/** Отметить использованные остатки после раскроя (§40/§103). */
export function markRemnantsUsed(remnants: StoredRemnant[], usedIds: string[]): StoredRemnant[] {
  const used = new Set(usedIds);
  return remnants.map((r) => (used.has(r.id) ? { ...r, status: 'USED' as const } : r));
}

/** Остатки, фактически пущенные в дело этим результатом (§43). */
export function consumedRemnantIds(result: CuttingResult): string[] {
  return result.sheets
    .filter((sheet) => sheet.fromRemnant)
    .map((sheet) => sheet.sheetMaterialId ?? sheet.id);
}

/** Сводка резерва по материалу — для панели склада (§96). */
export interface ReservationSummary {
  materialId: string;
  thickness: number;
  available: number;
  reserved: number;
  remnantsAvailable: number;
  remnantsReserved: number;
}

export function reservationSummary(project: Project): ReservationSummary[] {
  const rows = new Map<string, ReservationSummary>();
  for (const sheet of project.sheets) {
    const key = `${sheet.materialId}:${sheet.thickness}`;
    const row = rows.get(key) ?? {
      materialId: String(sheet.materialId),
      thickness: sheet.thickness,
      available: 0, reserved: 0, remnantsAvailable: 0, remnantsReserved: 0,
    };
    const free = freeQuantity(sheet);
    row.available += free === Infinity ? 0 : free;
    row.reserved += sheet.reserved ?? 0;
    rows.set(key, row);
  }
  for (const remnant of project.remnants) {
    const key = `${remnant.materialId}:${remnant.thickness}`;
    const row = rows.get(key) ?? {
      materialId: String(remnant.materialId),
      thickness: remnant.thickness,
      available: 0, reserved: 0, remnantsAvailable: 0, remnantsReserved: 0,
    };
    const status = remnant.status ?? 'AVAILABLE';
    if (status === 'AVAILABLE') row.remnantsAvailable += 1;
    if (status === 'RESERVED') row.remnantsReserved += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.materialId.localeCompare(b.materialId) || a.thickness - b.thickness);
}
