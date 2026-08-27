/**
 * Collision3DChecker — обнаружение пересечений деталей по осеориентированным
 * габаритным боксам (AABB). Не физика: только предупреждение о перекрытии тел.
 * Соприкосновение гранями (щиты корпуса) НЕ считается коллизией — используется
 * допуск.
 */
import type { Part } from '@/core/model/types';
import { partWorldAABB, type AABB } from '@/core/geometry/partGeometry';

export interface CollisionPair {
  a: string; // partId
  b: string;
  aName: string;
  bName: string;
}

/** Величина пересечения по одной оси. */
function overlapAxis(a: { min: number; max: number }, b: { min: number; max: number }): number {
  return Math.min(a.max, b.max) - Math.max(a.min, b.min);
}

/** Пересекаются ли два бокса телами (с допуском tolerance мм по всем осям). */
export function boxesCollide(a: AABB, b: AABB, tolerance = 1): boolean {
  const ox = overlapAxis({ min: a.min.x, max: a.max.x }, { min: b.min.x, max: b.max.x });
  const oy = overlapAxis({ min: a.min.y, max: a.max.y }, { min: b.min.y, max: b.max.y });
  const oz = overlapAxis({ min: a.min.z, max: a.max.z }, { min: b.min.z, max: b.max.z });
  // Реальное перекрытие тел: положительное по всем трём осям сверх допуска.
  return ox > tolerance && oy > tolerance && oz > tolerance;
}

/** Найти все пары пересекающихся деталей. */
export function detectCollisions(parts: Part[], tolerance = 1): CollisionPair[] {
  const boxes = parts.map((p) => ({ part: p, box: partWorldAABB(p) }));
  const pairs: CollisionPair[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesCollide(boxes[i].box, boxes[j].box, tolerance)) {
        pairs.push({
          a: String(boxes[i].part.id), b: String(boxes[j].part.id),
          aName: boxes[i].part.name, bName: boxes[j].part.name,
        });
      }
    }
  }
  return pairs;
}
