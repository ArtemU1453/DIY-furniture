/**
 * Система размеров чертежа. Размерные линии выносятся за геометрию с
 * нарастающим отступом, чтобы не пересекать её хаотично (базовое авто-размещение).
 */
import type { Prim } from './scene';
import { fmtMm } from './notation';

export type DimensionType = 'HORIZONTAL' | 'VERTICAL' | 'ALIGNED' | 'RADIAL' | 'ANGULAR';

export interface Dimension {
  type: DimensionType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  value: number; // мм (реальное значение из модели)
  offset: number; // вынос размерной линии
  orientation?: 'up' | 'down' | 'left' | 'right';
}

const DIM_COLOR = '#8aa0c0';
const ARROW = 6;
const TICK = 4;

/**
 * Значение размера на чертеже — в мм, без лишнего округления (§33):
 * 16, 800, 153.5. Формат единый с остальной документацией.
 */
function fmt(v: number): string {
  return fmtMm(v);
}

/** Развернуть размер в примитивы (выносные + размерная линия + стрелки + текст). */
export function renderDimension(d: Dimension): Prim[] {
  const out: Prim[] = [];
  if (d.type === 'HORIZONTAL') {
    const y = Math.max(d.y1, d.y2) + d.offset;
    out.push({ kind: 'line', x1: d.x1, y1: d.y1, x2: d.x1, y2: y + TICK, color: DIM_COLOR, w: 0.4 });
    out.push({ kind: 'line', x1: d.x2, y1: d.y2, x2: d.x2, y2: y + TICK, color: DIM_COLOR, w: 0.4 });
    out.push({ kind: 'line', x1: d.x1, y1: y, x2: d.x2, y2: y, color: DIM_COLOR, w: 0.5 });
    arrow(out, d.x1, y, 1, 0);
    arrow(out, d.x2, y, -1, 0);
    out.push({ kind: 'text', x: (d.x1 + d.x2) / 2, y: y - 3, text: fmt(d.value), anchor: 'middle', baseline: 'auto', color: DIM_COLOR });
  } else if (d.type === 'VERTICAL') {
    const x = Math.min(d.x1, d.x2) - d.offset;
    out.push({ kind: 'line', x1: d.x1, y1: d.y1, x2: x - TICK, y2: d.y1, color: DIM_COLOR, w: 0.4 });
    out.push({ kind: 'line', x1: d.x2, y1: d.y2, x2: x - TICK, y2: d.y2, color: DIM_COLOR, w: 0.4 });
    out.push({ kind: 'line', x1: x, y1: d.y1, x2: x, y2: d.y2, color: DIM_COLOR, w: 0.5 });
    arrow(out, x, d.y1, 0, 1);
    arrow(out, x, d.y2, 0, -1);
    out.push({ kind: 'text', x: x - 3, y: (d.y1 + d.y2) / 2, text: fmt(d.value), anchor: 'middle', baseline: 'middle', color: DIM_COLOR });
  } else {
    // ALIGNED — размерная линия параллельна отрезку, вынесена по нормали.
    const dx = d.x2 - d.x1, dy = d.y2 - d.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const ox = nx * d.offset, oy = ny * d.offset;
    out.push({ kind: 'line', x1: d.x1, y1: d.y1, x2: d.x1 + ox, y2: d.y1 + oy, color: DIM_COLOR, w: 0.4 });
    out.push({ kind: 'line', x1: d.x2, y1: d.y2, x2: d.x2 + ox, y2: d.y2 + oy, color: DIM_COLOR, w: 0.4 });
    out.push({ kind: 'line', x1: d.x1 + ox, y1: d.y1 + oy, x2: d.x2 + ox, y2: d.y2 + oy, color: DIM_COLOR, w: 0.5 });
    out.push({ kind: 'text', x: (d.x1 + d.x2) / 2 + ox, y: (d.y1 + d.y2) / 2 + oy - 3, text: fmt(d.value), anchor: 'middle', baseline: 'auto', color: DIM_COLOR });
  }
  return out;
}

function arrow(out: Prim[], x: number, y: number, dirX: number, dirY: number): void {
  const perpX = -dirY, perpY = dirX;
  out.push({
    kind: 'polyline',
    pts: [
      [x + dirX * ARROW + perpX * (ARROW / 3), y + dirY * ARROW + perpY * (ARROW / 3)],
      [x, y],
      [x + dirX * ARROW - perpX * (ARROW / 3), y + dirY * ARROW - perpY * (ARROW / 3)],
    ],
    color: DIM_COLOR,
    w: 0.5,
  });
}

/** Горизонтальный размер под геометрией. */
export function hDim(x1: number, x2: number, yBase: number, offset: number): Dimension {
  return { type: 'HORIZONTAL', x1, y1: yBase, x2, y2: yBase, value: Math.abs(x2 - x1), offset };
}

/** Вертикальный размер слева от геометрии. */
export function vDim(y1: number, y2: number, xBase: number, offset: number): Dimension {
  return { type: 'VERTICAL', x1: xBase, y1, x2: xBase, y2, value: Math.abs(y2 - y1), offset };
}

// ─────────────────────────────────────────────────────────────────────────────
// Авто-раскладка размеров (§35)
// ─────────────────────────────────────────────────────────────────────────────

/** Прямоугольник, занимаемый размерной линией вместе с текстом (мм). */
export function dimensionBox(d: Dimension): { x1: number; y1: number; x2: number; y2: number } {
  const TEXT = 6; // высота подписи + зазор
  if (d.type === 'HORIZONTAL') {
    const y = Math.max(d.y1, d.y2) + d.offset;
    return { x1: Math.min(d.x1, d.x2), y1: y - TEXT, x2: Math.max(d.x1, d.x2), y2: y + TICK };
  }
  if (d.type === 'VERTICAL') {
    const x = Math.min(d.x1, d.x2) - d.offset;
    return { x1: x - TEXT, y1: Math.min(d.y1, d.y2), x2: x + TICK, y2: Math.max(d.y1, d.y2) };
  }
  const dx = d.x2 - d.x1, dy = d.y2 - d.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (-dy / len) * d.offset, oy = (dx / len) * d.offset;
  return {
    x1: Math.min(d.x1, d.x2) + Math.min(ox, 0) - TEXT,
    y1: Math.min(d.y1, d.y2) + Math.min(oy, 0) - TEXT,
    x2: Math.max(d.x1, d.x2) + Math.max(ox, 0) + TEXT,
    y2: Math.max(d.y1, d.y2) + Math.max(oy, 0) + TEXT,
  };
}

function boxesOverlap(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

/**
 * Развести размеры так, чтобы их линии и подписи не накладывались друг на
 * друга: каждый следующий конфликтующий размер отодвигается на шаг наружу.
 * Это базовая раскладка, а не полноценный CAD-layout — но пересечений после
 * неё не остаётся.
 */
export function layoutDimensions(dims: Dimension[], step = 9, maxTries = 24): Dimension[] {
  const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const out: Dimension[] = [];
  for (const d of dims) {
    let cur = d;
    let box = dimensionBox(cur);
    for (let i = 0; i < maxTries && placed.some((p) => boxesOverlap(p, box)); i++) {
      cur = { ...cur, offset: cur.offset + step };
      box = dimensionBox(cur);
    }
    placed.push(box);
    out.push(cur);
  }
  return out;
}

/** Пересекаются ли размеры при текущих выносах (для проверок и тестов). */
export function dimensionsOverlap(dims: Dimension[]): boolean {
  const boxes = dims.map(dimensionBox);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i], boxes[j])) return true;
    }
  }
  return false;
}
