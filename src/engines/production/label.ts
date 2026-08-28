/**
 * Этикетки производства (§108/§109).
 *
 * Этикетка строится из уже готовой PartLabel раскроя (движок cutting) и
 * дополняется производственными данными: маркой P-001, содержимым QR и
 * строкой штрихкода. Второй системы этикеток не появляется.
 */
import type { PartLabel, Project } from '@/core/model/types';
import { partLabels, cuttingLabels } from '@/engines/cutting';
import { toBarcodeText } from './barcode';
import type { ProductionPart } from './parts';

/** Формат этикетки (§109). Размеры в мм. */
export interface LabelSize {
  id: string;
  name: string;
  width: number;
  height: number;
}

export const LABEL_SIZES: LabelSize[] = [
  { id: 'S', name: 'Малая 58 × 30', width: 58, height: 30 },
  { id: 'M', name: 'Средняя 70 × 40', width: 70, height: 40 },
  { id: 'L', name: 'Большая 100 × 50', width: 100, height: 50 },
];

export const DEFAULT_LABEL_SIZE = LABEL_SIZES[1];

export function labelSize(id: string): LabelSize {
  return LABEL_SIZES.find((s) => s.id === id) ?? DEFAULT_LABEL_SIZE;
}

/** Этикетка детали для цеха (§108). */
export interface ProductionLabel {
  partId: string;
  /** Марка детали P-001 (§97). */
  mark: string;
  name: string;
  materialName: string;
  /** Строки предпросмотра — то, что печатается (§109). */
  lines: string[];
  /** Содержимое QR (§111). */
  code: string;
  /** Строка штрихкода в алфавите Code 39 (§110). */
  barcode: string;
  /** Экземпляр «2/4» и лист раскроя, если этикетка из раскроя (§51). */
  instance?: string;
  sheetLabel?: string;
  size: LabelSize;
}

function toProductionLabel(
  label: PartLabel,
  marks: Map<string, string>,
  size: LabelSize,
): ProductionLabel {
  const mark = marks.get(String(label.partId)) ?? label.number ?? '';
  const dims = `${label.width} × ${label.height} × ${label.thickness}`;
  const lines = [
    `${mark} ${label.name}`.trim(),
    dims,
    label.materialName,
    `Кромка: ${label.edgeSummary}`,
  ];
  if (label.instance) lines.push(`Экз. ${label.instance}`);
  if (label.sheetLabel) lines.push(`Лист ${label.sheetLabel}`);
  return {
    partId: String(label.partId),
    mark,
    name: label.name,
    materialName: label.materialName,
    lines,
    code: label.code,
    barcode: toBarcodeText(mark || label.code),
    instance: label.instance,
    sheetLabel: label.sheetLabel,
    size,
  };
}

/**
 * Этикетки производства (§108).
 *
 * `source: 'CUTTING'` даёт по этикетке на каждый экземпляр в раскрое,
 * `'PARTS'` — по одной на деталь.
 */
export function productionLabels(
  project: Project,
  parts: ProductionPart[],
  options: { source?: 'PARTS' | 'CUTTING'; size?: LabelSize } = {},
): ProductionLabel[] {
  const size = options.size ?? DEFAULT_LABEL_SIZE;
  const marks = new Map(parts.map((p) => [String(p.partId), p.number]));
  const source = options.source ?? 'PARTS';
  const base = source === 'CUTTING' ? cuttingLabels(project) : partLabels(project);
  return base.map((label) => toProductionLabel(label, marks, size));
}

/** Раскладка этикеток по листу (§109): сколько влезает и на какой позиции. */
export interface LabelSheet {
  page: number;
  columns: number;
  rows: number;
  items: Array<{ label: ProductionLabel; x: number; y: number }>;
}

/** Разложить этикетки по листам A4 (210 × 297) с полями (§109). */
export function labelSheets(
  labels: ProductionLabel[],
  size: LabelSize = DEFAULT_LABEL_SIZE,
  page: { width: number; height: number; margin: number; gap: number } =
    { width: 210, height: 297, margin: 10, gap: 2 },
): LabelSheet[] {
  const usableW = page.width - page.margin * 2;
  const usableH = page.height - page.margin * 2;
  const columns = Math.max(1, Math.floor((usableW + page.gap) / (size.width + page.gap)));
  const rows = Math.max(1, Math.floor((usableH + page.gap) / (size.height + page.gap)));
  const perPage = columns * rows;

  const sheets: LabelSheet[] = [];
  for (let i = 0; i < labels.length; i += perPage) {
    const slice = labels.slice(i, i + perPage);
    sheets.push({
      page: sheets.length + 1,
      columns,
      rows,
      items: slice.map((label, index) => ({
        label,
        x: page.margin + (index % columns) * (size.width + page.gap),
        y: page.margin + Math.floor(index / columns) * (size.height + page.gap),
      })),
    });
  }
  return sheets;
}

/** Текстовый предпросмотр этикетки (§109). */
export function labelPreview(label: ProductionLabel): string {
  return label.lines.join('\n');
}
