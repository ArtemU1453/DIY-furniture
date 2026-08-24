/**
 * Извлечение прямоугольных остатков листа из оставшегося свободного места.
 * Из перекрывающихся свободных прямоугольников MaxRects выбираются наибольшие
 * непересекающиеся области ≥ порога — как будущие полезные остатки склада.
 */
import type { CuttingRemnant } from './types';
import type { MaterialId } from '@/core/model/ids';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 1e-6;
const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;

export function extractRemnants(
  free: Rect[],
  materialId: MaterialId,
  sheetId: string,
  minSize: number,
): CuttingRemnant[] {
  const candidates = free
    .filter((r) => r.w >= minSize && r.h >= minSize)
    .sort((a, b) => b.w * b.h - a.w * a.h);

  const accepted: Rect[] = [];
  for (const c of candidates) {
    if (!accepted.some((a) => overlaps(a, c))) accepted.push(c);
  }

  return accepted.map((r, i) => ({
    id: `${sheetId}-remnant-${i + 1}`,
    sheetId,
    materialId,
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.w),
    height: Math.round(r.h),
  }));
}
