/**
 * CutLines — вычисление линий реза из фактического расположения деталей.
 *
 * Линии реза НЕ рисуются произвольно: это координаты границ размещённых
 * деталей (с учётом пропила kerf), спроецированные на рабочую область листа.
 * Набор уникальных вертикальных (по X) и горизонтальных (по Y) резов —
 * достаточная и честная модель гильотинного/пильного раскроя для визуализации.
 */
import type { CutLine, Placement, TrimSettings } from '@/core/model/types';

interface SheetGeom {
  length: number;
  width: number;
  trim: TrimSettings;
}

const EPS = 0.5; // мм: координаты меньше 0.5 мм считаем совпадающими

function pushUnique(set: number[], v: number, lo: number, hi: number): void {
  if (v <= lo + EPS || v >= hi - EPS) return; // края рабочей области — не рез
  if (!set.some((x) => Math.abs(x - v) < EPS)) set.push(v);
}

/**
 * Резы для одного листа. kerf учитывается: правый/верхний край детали плюс
 * половина пропила — фактическая линия распила между деталью и остатком.
 */
export function computeCutLines(sheetId: string, placements: Placement[], geom: SheetGeom, kerf: number): CutLine[] {
  const usableX0 = geom.trim.left;
  const usableX1 = geom.length - geom.trim.right;
  const usableY0 = geom.trim.bottom;
  const usableY1 = geom.width - geom.trim.top;
  const half = kerf / 2;

  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of placements) {
    pushUnique(xs, p.x - half, usableX0, usableX1);
    pushUnique(xs, p.x + p.length + half, usableX0, usableX1);
    pushUnique(ys, p.y - half, usableY0, usableY1);
    pushUnique(ys, p.y + p.width + half, usableY0, usableY1);
  }

  const lines: CutLine[] = [];
  xs.forEach((x, i) =>
    lines.push({ id: `${sheetId}-cx-${i}`, orientation: 'vertical', x1: x, y1: usableY0, x2: x, y2: usableY1 }),
  );
  ys.forEach((y, i) =>
    lines.push({ id: `${sheetId}-cy-${i}`, orientation: 'horizontal', x1: usableX0, y1: y, x2: usableX1, y2: y }),
  );
  return lines;
}
