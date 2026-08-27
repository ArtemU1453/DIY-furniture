/**
 * Экспорт карты раскроя в SVG / CSV / JSON. Экспорт — визуализация реального
 * CuttingResult (координаты из движка), а не отдельно нарисованная картинка.
 */
import type { CuttingReport, CuttingResult, CuttingSheetResult, Part, Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { instanceCounts, placementLabel } from './instance';
import { prepareCuttingParts } from './preparation';
import { resolveCuttingProfile } from './profile';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Экранирование значения CSV (запятые, кавычки, переводы строк). */
function csv(header: string[], rows: string[][]): string {
  const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n');
}

/** Дополнительные данные для производственного чертежа листа (§97/§106). */
export interface SheetDrawingInfo {
  /** Толщина материала, мм. */
  thickness?: number;
  /** Номер листа из общего количества, например «3 из 8». */
  sheetOf?: string;
}

/** SVG одного листа (координаты в мм; ось Y отражена — низ листа снизу). */
export function sheetToSvg(sheet: CuttingSheetResult, materialName: string, info?: SheetDrawingInfo): string {
  const { length: L, width: W, trim } = sheet;
  const flipY = (y: number, h: number) => W - (y + h);
  const parts: string[] = [];

  parts.push(`<rect x="0" y="0" width="${L}" height="${W}" fill="#141518" stroke="#5a6472" stroke-width="2"/>`);
  parts.push(
    `<rect x="${trim.left}" y="${trim.top}" width="${L - trim.left - trim.right}" height="${W - trim.top - trim.bottom}" fill="none" stroke="#3a3d43" stroke-dasharray="8 6" stroke-width="1"/>`,
  );

  // Линии реза.
  for (const c of sheet.cuts) {
    const y1 = c.orientation === 'horizontal' ? flipY(c.y1, 0) : flipY(c.y1, 0);
    const y2 = c.orientation === 'horizontal' ? flipY(c.y2, 0) : flipY(c.y2, 0);
    parts.push(`<line x1="${c.x1}" y1="${y1}" x2="${c.x2}" y2="${y2}" stroke="#39506e" stroke-width="0.6" stroke-dasharray="10 6"/>`);
  }

  for (const p of sheet.placements) {
    const y = flipY(p.y, p.width);
    const font = Math.min(p.length, p.width) * 0.25;
    parts.push(
      `<g><rect x="${p.x}" y="${y}" width="${p.length}" height="${p.width}" fill="${p.origin === 'manual' ? '#4a3b2a' : '#2f3a4a'}" stroke="#7f8ea3" stroke-width="1"/>` +
        /* §97: направление текстуры показывается на самой детали — по нему
         * на производстве видно, как класть деталь под пилу. */
        (p.grainDirection === 'length'
          ? `<line x1="${p.x + 8}" y1="${y + p.width / 2}" x2="${p.x + p.length - 8}" y2="${y + p.width / 2}" stroke="#8fa8c8" stroke-width="1" stroke-dasharray="12 8"/>`
          : p.grainDirection === 'width'
            ? `<line x1="${p.x + p.length / 2}" y1="${y + 8}" x2="${p.x + p.length / 2}" y2="${y + p.width - 8}" stroke="#8fa8c8" stroke-width="1" stroke-dasharray="12 8"/>`
            : `<line x1="${p.x + p.length / 2}" y1="${y + 6}" x2="${p.x + p.length / 2}" y2="${y + p.width - 6}" stroke="#556" stroke-width="1"/>`) +
        `<text x="${p.x + p.length / 2}" y="${y + p.width / 2}" fill="#e6e7e9" font-size="${font}" text-anchor="middle" dominant-baseline="middle">${esc(p.number)}</text>` +
        `<text x="${p.x + p.length / 2}" y="${y + p.width / 2 + Math.min(p.length, p.width) * 0.28}" fill="#9aa0a6" font-size="${Math.min(p.length, p.width) * 0.12}" text-anchor="middle" dominant-baseline="middle">${Math.round(p.length)}×${Math.round(p.width)}${p.rotation ? ' ↻' : ''}</text></g>`,
    );
  }

  for (const r of sheet.remnants) {
    const y = flipY(r.y, r.height);
    const stroke = r.usable ? '#4caf7d' : '#6b6f76';
    parts.push(
      `<rect x="${r.x}" y="${y}" width="${r.width}" height="${r.height}" fill="none" stroke="${stroke}" stroke-dasharray="4 4" stroke-width="1"/>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -40 ${L + 40} ${W + 80}" width="${L}" height="${W + 60}">` +
    /* §106: на чертеже листа сразу видны материал, толщина, размер листа,
     * его номер, количество деталей, отход и использование. */
    `<text x="0" y="-12" fill="#e6e7e9" font-size="40">${esc(materialName)}${info?.thickness ? ` ${info.thickness} мм` : ''} — ` +
    `${Math.round(sheet.length)}×${Math.round(sheet.width)} — лист ${info?.sheetOf ?? String(sheet.index + 1)}` +
    `${sheet.fromRemnant ? ' (остаток)' : ''} — деталей ${sheet.placements.length} — ` +
    `отход ${(sheet.wasteAreaMm2 / 1_000_000).toFixed(2)} м² — использование ${Math.round(sheet.utilization * 100)}%</text>` +
    parts.join('') +
    `</svg>`
  );
}

/** SVG всего отчёта (листы одного материала, вертикально). */
export function resultToSvg(result: CuttingResult): string {
  const gap = 120;
  let offset = 0;
  const groups: string[] = [];
  let maxL = 0;
  for (const sheet of result.sheets) {
    groups.push(`<g transform="translate(0, ${offset})">${stripSvg(sheetToSvg(sheet, result.statistics.materialName))}</g>`);
    offset += sheet.width + gap;
    maxL = Math.max(maxL, sheet.length);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -60 ${maxL + 80} ${offset + 60}" width="${maxL}" height="${offset}">${groups.join('')}</svg>`;
}

function stripSvg(svg: string): string {
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

/**
 * CSV карты раскроя по всем материалам. Каждая деталь связана со своим P-ID.
 * thicknessById — толщина по материалу (мм), опционально.
 */
export function reportToCsv(report: CuttingReport, thicknessById?: Record<string, number>): string {
  const header = [
    'Лист', 'P-ID', 'Наименование', 'Длина', 'Ширина', 'X', 'Y', 'Поворот', 'Материал', 'Толщина',
  ];
  const rows: string[][] = [];
  for (const job of report.jobs) {
    const th = thicknessById?.[job.materialId as string];
    for (const sheet of job.sheets) {
      for (const p of sheet.placements) {
        rows.push([
          `${sheet.index + 1}${sheet.fromRemnant ? ' (остаток)' : ''}`,
          p.number,
          p.name,
          String(Math.round(p.length)),
          String(Math.round(p.width)),
          String(Math.round(p.x)),
          String(Math.round(p.y)),
          `${p.rotation}`,
          job.statistics.materialName,
          th != null ? String(th) : '',
        ]);
      }
    }
  }
  const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n');
}

/** JSON-экспорт результата раскроя (полный сохранённый отчёт). */
export function reportToJson(report: CuttingReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * cutting-plan.json (§102) — самодостаточный обмен картой раскроя: помимо
 * самого отчёта записываются материалы, склад и профиль реза, поэтому файл
 * читается без исходного проекта.
 */
export function cuttingPlanJson(project: Project): string {
  const report = project.cutting.report;
  return JSON.stringify(
    {
      format: 'karkas-cutting-plan',
      version: 1,
      projectId: String(project.id),
      projectName: project.name,
      generatedAt: report?.generatedAt ?? new Date().toISOString(),
      profile: resolveCuttingProfile(project),
      materials: project.materials.map((m) => ({
        id: String(m.id), name: m.name, thickness: m.thickness,
        grain: m.grain, allowRotate: m.allowRotate,
      })),
      stock: project.sheets.map((sh) => ({
        id: sh.id, materialId: String(sh.materialId), name: sh.name,
        height: sh.height, width: sh.width, thickness: sh.thickness,
        availableQuantity: sh.availableQuantity, stockMode: sh.stockMode ?? null,
        archived: sh.archived === true,
      })),
      remnants: project.remnants.map((r) => ({
        id: r.id, materialId: String(r.materialId), width: r.width, height: r.height,
        thickness: r.thickness, status: r.status ?? 'AVAILABLE',
      })),
      plans: report?.jobs ?? [],
    },
    null,
    2,
  );
}

/**
 * cut-list.csv (§103/§104) — список деталей к раскрою.
 * Колонки строго по §104: Part ID, Name, Material, Thickness, Width, Height,
 * Quantity, Grain, Edge Band.
 */
export function cutListCsv(project: Project): string {
  const header = ['Part ID', 'Name', 'Material', 'Thickness', 'Width', 'Height', 'Quantity', 'Grain', 'Edge Band'];
  const materials = new Map(project.materials.map((m) => [String(m.id), m.name]));
  const edges = new Map(project.edges.map((e) => [String(e.id), e]));
  const edgeLabel = (part: Part): string => {
    const sides: Array<[string, string | null]> = [
      ['Л', part.edges.left], ['П', part.edges.right], ['В', part.edges.top], ['Н', part.edges.bottom],
    ];
    const used = sides.filter(([, id]) => id);
    if (used.length === 0) return '';
    return used.map(([s, id]) => `${s}:${edges.get(String(id))?.thickness ?? '?'}`).join(' ');
  };

  const rows = prepareCuttingParts(project).map((cp) => {
    const part = allParts(project).find((p) => p.id === cp.partId);
    return [
      cp.number || String(cp.partId),
      cp.name,
      materials.get(String(cp.materialId)) ?? '',
      String(cp.thickness),
      String(Math.round(cp.width)),
      String(Math.round(cp.height)),
      String(cp.quantity),
      cp.grainDirection,
      part ? edgeLabel(part) : '',
    ];
  });
  return csv(header, rows);
}

/**
 * cutting_parts.csv (§54) — размещение деталей по листам.
 * Стабильные колонки: Sheet, Part ID, Name, Width, Height, Thickness,
 * Material, X, Y, Rotation, Quantity.
 */
export function cuttingPartsCsv(report: CuttingReport, thicknessById?: Record<string, number>): string {
  const header = ['Sheet', 'Part ID', 'Name', 'Width', 'Height', 'Thickness', 'Material', 'X', 'Y', 'Rotation', 'Quantity'];
  const rows: string[][] = [];
  for (const job of report.jobs) {
    const th = thicknessById?.[job.materialId as string];
    for (const sheet of job.sheets) {
      for (const p of sheet.placements) {
        rows.push([
          `${sheet.index + 1}${sheet.fromRemnant ? ' (remnant)' : ''}`,
          p.number, p.name,
          String(Math.round(p.length)), String(Math.round(p.width)),
          th != null ? String(th) : '',
          job.statistics.materialName,
          String(Math.round(p.x)), String(Math.round(p.y)), String(p.rotation),
          '1',
        ]);
      }
    }
  }
  const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n');
}

/**
 * waste_report.csv (§55) — отчёт по отходам и остаткам на каждый лист.
 * Колонки: Sheet, Material, SheetArea, PartArea, RemnantArea, WasteArea, Efficiency.
 * Площади в м², эффективность в процентах.
 */
export function wasteReportCsv(report: CuttingReport): string {
  const header = ['Sheet', 'Material', 'SheetArea', 'PartArea', 'RemnantArea', 'WasteArea', 'Efficiency'];
  const m2 = (mm2: number) => (mm2 / 1_000_000).toFixed(3);
  const rows: string[][] = [];
  for (const job of report.jobs) {
    for (const sheet of job.sheets) {
      rows.push([
        `${sheet.index + 1}${sheet.fromRemnant ? ' (remnant)' : ''}`,
        job.statistics.materialName,
        m2(sheet.usableAreaMm2),
        m2(sheet.usedAreaMm2),
        m2(sheet.remnantAreaMm2 ?? 0),
        m2(sheet.wasteAreaMm2),
        `${(sheet.utilization * 100).toFixed(1)}%`,
      ]);
    }
  }
  const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n');
}

/**
 * cutting.csv (§64) — размещение деталей по листам в порядке колонок из
 * задания: Sheet, Part ID, Part Name, Width, Height, Rotation, X, Y, Material.
 *
 * Part ID — метка ЭКЗЕМПЛЯРА (P001-2), если деталь размещена несколькими
 * экземплярами (§78/§79): иначе строки одинаковой детали неразличимы.
 */
export function cuttingCsv(report: CuttingReport): string {
  const header = ['Sheet', 'Part ID', 'Part Name', 'Width', 'Height', 'Rotation', 'X', 'Y', 'Material'];
  const rows: string[][] = [];
  for (const job of report.jobs) {
    const counts = instanceCounts(job.sheets.flatMap((s) => s.placements));
    for (const sheet of job.sheets) {
      for (const p of sheet.placements) {
        rows.push([
          `${sheet.index + 1}${sheet.fromRemnant ? ' (remnant)' : ''}`,
          placementLabel(p, counts),
          p.name,
          String(Math.round(p.length)),
          String(Math.round(p.width)),
          p.rotation ? `ROT ${p.rotation}°` : '0',
          String(Math.round(p.x)),
          String(Math.round(p.y)),
          job.statistics.materialName,
        ]);
      }
    }
  }
  return csv(header, rows);
}

/**
 * remnants.csv (§65) — остатки листов.
 * Колонки: Sheet, Remnant ID, Width, Height, Area, Material, Usable.
 * Площадь в м²; Usable отражает критерии полезного остатка (§29).
 */
export function remnantsCsv(report: CuttingReport): string {
  const header = ['Sheet', 'Remnant ID', 'Width', 'Height', 'Area', 'Material', 'Usable'];
  const rows: string[][] = [];
  for (const job of report.jobs) {
    for (const sheet of job.sheets) {
      for (const r of sheet.remnants) {
        rows.push([
          `${sheet.index + 1}${sheet.fromRemnant ? ' (remnant)' : ''}`,
          r.id,
          String(Math.round(r.width)),
          String(Math.round(r.height)),
          (r.area / 1_000_000).toFixed(3),
          job.statistics.materialName,
          r.usable ? 'yes' : 'no',
        ]);
      }
    }
  }
  return csv(header, rows);
}

/** Строка сводки по одному материалу (§74/§76). */
export interface CuttingSummaryRow {
  materialId: string;
  materialName: string;
  thickness: number;
  sheetFormat: string;
  sheetCount: number;
  partsAreaMm2: number;
  sheetsAreaMm2: number;
  remnantAreaMm2: number;
  wasteAreaMm2: number;
  utilization: number;
  unplaced: number;
}

/**
 * Сводка раскроя по материалам (§76). Отдельная строка на каждое задание —
 * ЛДСП 16, МДФ 18 и ХДФ 3 считаются независимо и не смешиваются (§25/§26).
 */
export function cuttingSummary(
  report: CuttingReport,
  thicknessById?: Record<string, number>,
  formatNameById?: Record<string, string>,
): CuttingSummaryRow[] {
  return report.jobs.map((job) => {
    const st = job.statistics;
    const formatId = job.sheets.find((s) => !s.fromRemnant)?.sheetMaterialId;
    const sheet = job.settingsSnapshot?.sheet;
    return {
      materialId: String(job.materialId),
      materialName: st.materialName,
      thickness: thicknessById?.[String(job.materialId)] ?? 0,
      sheetFormat: (formatId && formatNameById?.[formatId])
        ?? (sheet ? `${Math.round(sheet.length)}×${Math.round(sheet.width)}` : ''),
      sheetCount: st.sheetCount,
      partsAreaMm2: st.piecesAreaMm2,
      sheetsAreaMm2: st.sheetsUsableAreaMm2,
      remnantAreaMm2: st.remnantAreaMm2,
      wasteAreaMm2: st.wasteAreaMm2,
      utilization: st.utilization,
      unplaced: job.unplaced.length,
    };
  });
}

/** Сводка в CSV (§74). */
export function cuttingSummaryCsv(
  report: CuttingReport,
  thicknessById?: Record<string, number>,
  formatNameById?: Record<string, string>,
): string {
  const header = ['Material', 'Thickness', 'Sheet format', 'Sheets', 'Parts area', 'Sheets area', 'Remnant area', 'Waste area', 'Utilization', 'Unplaced'];
  const a = (mm2: number) => (mm2 / 1_000_000).toFixed(3);
  const rows = cuttingSummary(report, thicknessById, formatNameById).map((r) => [
    r.materialName,
    r.thickness ? String(r.thickness) : '',
    r.sheetFormat,
    String(r.sheetCount),
    a(r.partsAreaMm2),
    a(r.sheetsAreaMm2),
    a(r.remnantAreaMm2),
    a(r.wasteAreaMm2),
    `${(r.utilization * 100).toFixed(1)}%`,
    String(r.unplaced),
  ]);
  return csv(header, rows);
}
