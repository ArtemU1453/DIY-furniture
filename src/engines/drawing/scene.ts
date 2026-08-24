/**
 * Абстрактная 2D-сцена чертежа — примитивы в миллиметрах.
 *
 * Сцена не зависит от способа вывода: один и тот же набор примитивов
 * рендерится в SVG (экран/файл), печатается или экспортируется в PDF (через
 * векторную печать браузера). Размеры берутся из производственной модели.
 */

export type TextAnchor = 'start' | 'middle' | 'end';
export type TextBaseline = 'auto' | 'middle' | 'hanging';

export type Prim =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; w?: number; color?: string; dash?: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number; dash?: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number }
  | { kind: 'polyline'; pts: Array<[number, number]>; color?: string; w?: number; closed?: boolean; fill?: string }
  | { kind: 'text'; x: number; y: number; text: string; size?: number; color?: string; anchor?: TextAnchor; baseline?: TextBaseline; bold?: boolean };

export interface Scene2D {
  /** Габариты содержимого в мм (для авто-масштаба и центрирования). */
  width: number;
  height: number;
  /** Смещение начала содержимого (мм) — левый-нижний угол сцены. */
  originX: number;
  originY: number;
  prims: Prim[];
}

export function emptyScene(): Scene2D {
  return { width: 0, height: 0, originX: 0, originY: 0, prims: [] };
}

/** Пересчитать габариты сцены по её примитивам. */
export function computeBounds(prims: Prim[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const p of prims) {
    switch (p.kind) {
      case 'line': acc(p.x1, p.y1); acc(p.x2, p.y2); break;
      case 'rect': acc(p.x, p.y); acc(p.x + p.w, p.y + p.h); break;
      case 'circle': acc(p.cx - p.r, p.cy - p.r); acc(p.cx + p.r, p.cy + p.r); break;
      case 'polyline': for (const [x, y] of p.pts) acc(x, y); break;
      case 'text': acc(p.x, p.y); break;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Обновить width/height/origin сцены по примитивам (с отступом). */
export function finalizeScene(prims: Prim[], pad = 0): Scene2D {
  const b = computeBounds(prims);
  return {
    prims,
    originX: b.minX - pad,
    originY: b.minY - pad,
    width: b.maxX - b.minX + 2 * pad,
    height: b.maxY - b.minY + 2 * pad,
  };
}
