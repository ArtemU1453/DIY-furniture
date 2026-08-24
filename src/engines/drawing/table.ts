/**
 * Построение таблиц как примитивов сцены (в мм; ось Y вверх, строки идут вниз).
 * Используется для спецификаций, таблицы присадки и кромки.
 */
import type { Prim, TextAnchor } from './scene';

export interface TableColumn {
  title: string;
  width: number; // мм
  align?: TextAnchor;
}

export interface TableOptions {
  rowHeight?: number;
  fontSize?: number;
  headerFill?: string;
}

/** Ширина таблицы по сумме колонок. */
export function tableWidth(columns: TableColumn[]): number {
  return columns.reduce((s, c) => s + c.width, 0);
}

/**
 * @param xLeft левый край, @param yTop верхняя граница таблицы (мм, ось Y вверх).
 * Возвращает примитивы; строки размещаются ВНИЗ от yTop.
 */
export function tablePrims(
  xLeft: number,
  yTop: number,
  columns: TableColumn[],
  rows: string[][],
  opts: TableOptions = {},
): Prim[] {
  const rh = opts.rowHeight ?? 7;
  const fs = opts.fontSize ?? 3;
  const w = tableWidth(columns);
  const total = rows.length + 1; // +заголовок
  const bottom = yTop - total * rh;
  const out: Prim[] = [];

  // Внешняя рамка.
  out.push({ kind: 'rect', x: xLeft, y: bottom, w, h: total * rh, stroke: '#3a3d43', sw: 0.5, fill: 'none' });
  // Заголовок.
  out.push({ kind: 'rect', x: xLeft, y: yTop - rh, w, h: rh, stroke: '#3a3d43', sw: 0.4, fill: '#eef1f5' });

  // Горизонтальные линии строк.
  for (let i = 1; i < total; i++) {
    const y = yTop - i * rh;
    out.push({ kind: 'line', x1: xLeft, y1: y, x2: xLeft + w, y2: y, color: '#c8cdd6', w: 0.3 });
  }
  // Вертикальные линии + текст.
  let cx = xLeft;
  for (const col of columns) {
    if (cx > xLeft) out.push({ kind: 'line', x1: cx, y1: bottom, x2: cx, y2: yTop, color: '#c8cdd6', w: 0.3 });
    const tx = col.align === 'end' ? cx + col.width - 2 : col.align === 'middle' ? cx + col.width / 2 : cx + 2;
    // Заголовок колонки.
    out.push({ kind: 'text', x: tx, y: yTop - rh / 2, text: col.title, size: fs, color: '#1a1b1e', anchor: col.align ?? 'start', baseline: 'middle', bold: true });
    // Значения.
    rows.forEach((row, ri) => {
      const y = yTop - (ri + 1) * rh - rh / 2;
      out.push({ kind: 'text', x: tx, y, text: row[columns.indexOf(col)] ?? '', size: fs, color: '#1a1b1e', anchor: col.align ?? 'start', baseline: 'middle' });
    });
    cx += col.width;
  }
  return out;
}
