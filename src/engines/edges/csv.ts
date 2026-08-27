/**
 * Экспорт кромки (§60/§61).
 *
 * Длины выгружаются в миллиметрах: внутренняя единица программы — мм (§73),
 * а перевод в метры остаётся делом отображения.
 */
import type { Project } from '@/core/model/types';
import { findPart } from '@/core/model/selectors';
import { allEdgeBanding, bandingTotalLength } from './banding';
import { edgeSummary, meters } from './summary';
import { SIDE_LABELS } from './sides';

function csv(header: string[], rows: string[][]): string {
  const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n');
}

/**
 * edgebanding.csv (§61).
 * Колонки: Part ID, Part Name, Side, Material, Thickness, Width, Length, Quantity.
 * Length — длина ОДНОЙ стороны; Total — с учётом количества деталей (§42).
 */
export function edgeBandingCsv(project: Project): string {
  const header = ['Part ID', 'Part Name', 'Side', 'Material', 'Thickness', 'Width', 'Length', 'Quantity', 'Total'];
  const materials = new Map(project.edges.map((e) => [String(e.id), e.name]));
  const rows = allEdgeBanding(project).map((b) => {
    const part = findPart(project, b.partId);
    return [
      (part?.metadata?.number as string) ?? String(b.partId),
      part?.name ?? '',
      SIDE_LABELS[b.side],
      materials.get(String(b.materialId)) ?? 'не найден',
      String(b.thickness),
      String(b.width),
      String(Math.round(b.length)),
      String(b.quantity),
      String(Math.round(bandingTotalLength(b))),
    ];
  });
  return csv(header, rows);
}

/** edge_summary.csv — расход по материалам (§63). */
export function edgeSummaryCsv(project: Project): string {
  // В названиях колонок нет запятых: иначе каждая ушла бы в кавычки и
  // заголовок стало бы неудобно читать и сравнивать.
  const header = ['Material', 'Thickness', 'Width', 'Length m', 'With allowance m', 'Purchase m', 'Pieces'];
  const rows = edgeSummary(project).map((r) => [
    r.materialName,
    String(r.thickness),
    String(r.width),
    meters(r.lengthMm).toFixed(2),
    meters(r.withAllowanceMm).toFixed(2),
    meters(r.purchaseMm).toFixed(2),
    String(r.pieceCount),
  ]);
  return csv(header, rows);
}
