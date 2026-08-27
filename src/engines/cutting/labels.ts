/**
 * Этикетки деталей (§108–§112).
 *
 * Строятся из существующих Part и результата раскроя; новых производственных
 * данных не появляется. Код для QR/штрихкода — локальная строка вида
 * `karkas:<projectId>:<partId>[:<instance>]`; внешние сервисы генерации
 * НЕ используются (§112). Отрисовка кода остаётся за слоем представления:
 * движок отдаёт данные, а не картинку.
 */
import type { EdgeMaterial, PartLabel, Placement, Project } from '@/core/model/types';
import type { PartId } from '@/core/model/ids';
import { allParts } from '@/core/model/selectors';

/** Данные QR/штрихкода: идентификатор проекта и детали (§111). */
export function labelCode(projectId: string, partId: PartId, instance?: string): string {
  const base = `karkas:${projectId}:${partId}`;
  return instance ? `${base}:${instance}` : base;
}

/** Разобрать код обратно (для будущего сканера). */
export function parseLabelCode(code: string): { projectId: string; partId: string; instance?: string } | null {
  const parts = code.split(':');
  if (parts.length < 3 || parts[0] !== 'karkas') return null;
  return { projectId: parts[1], partId: parts[2], instance: parts[3] };
}

function edgeSummary(
  edges: { left: string | null; right: string | null; top: string | null; bottom: string | null },
  materials: Map<string, EdgeMaterial>,
): string {
  const sides: Array<[string, string | null]> = [
    ['Л', edges.left], ['П', edges.right], ['В', edges.top], ['Н', edges.bottom],
  ];
  const used = sides.filter(([, id]) => id);
  if (used.length === 0) return 'без кромки';
  return used
    .map(([side, id]) => `${side}:${materials.get(String(id))?.thickness ?? '?'}`)
    .join(' ');
}

/** Этикетки по деталям проекта (§109): одна строка на Part. */
export function partLabels(project: Project): PartLabel[] {
  const materials = new Map(project.materials.map((m) => [String(m.id), m]));
  const edges = new Map(project.edges.map((e) => [String(e.id), e]));

  return allParts(project)
    .filter((p) => p.material)
    .map((p) => ({
      partId: p.id,
      name: p.name,
      number: (p.metadata?.number as string) ?? '',
      materialName: materials.get(String(p.material))?.name ?? '—',
      thickness: p.thickness,
      width: Math.max(p.width, p.height),
      height: Math.min(p.width, p.height),
      quantity: p.quantity,
      edgeSummary: edgeSummary(p.edges, edges),
      grain: p.grain,
      code: labelCode(String(project.id), p.id),
    }));
}

/**
 * Этикетки по экземплярам раскроя: одна на каждую размещённую деталь, с
 * номером листа и порядковым номером экземпляра «2/4» (§51).
 */
export function cuttingLabels(project: Project): PartLabel[] {
  const report = project.cutting.report;
  if (!report) return [];
  const byPart = new Map(partLabels(project).map((l) => [String(l.partId), l]));
  const totals = new Map<string, number>();
  for (const job of report.jobs) {
    for (const sheet of job.sheets) {
      for (const pl of sheet.placements) {
        totals.set(String(pl.partId), (totals.get(String(pl.partId)) ?? 0) + 1);
      }
    }
  }

  const seen = new Map<string, number>();
  const out: PartLabel[] = [];
  for (const job of report.jobs) {
    for (const sheet of job.sheets) {
      for (const pl of sheet.placements as Placement[]) {
        const base = byPart.get(String(pl.partId));
        if (!base) continue;
        const n = (seen.get(String(pl.partId)) ?? 0) + 1;
        seen.set(String(pl.partId), n);
        const instance = `${n}/${totals.get(String(pl.partId)) ?? n}`;
        out.push({
          ...base,
          instance,
          quantity: 1,
          sheetLabel: `Лист ${sheet.index + 1}`,
          code: labelCode(String(project.id), pl.partId, instance),
        });
      }
    }
  }
  return out;
}

const csvCell = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Этикетки в CSV — печать на любом принтере этикеток без облака (§108). */
export function labelsCsv(labels: PartLabel[]): string {
  const header = ['Part ID', 'Number', 'Name', 'Material', 'Thickness', 'Width', 'Height', 'Quantity', 'Instance', 'Sheet', 'Edge', 'Grain', 'Code'];
  const rows = labels.map((l) => [
    l.partId, l.number, l.name, l.materialName, l.thickness, l.width, l.height,
    l.quantity, l.instance ?? '', l.sheetLabel ?? '', l.edgeSummary, l.grain, l.code,
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}
