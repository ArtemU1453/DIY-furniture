/**
 * Геометрия детали (чистая, без three).
 *
 * Преобразует производственную деталь (Part) в описание прямоугольного
 * параллелепипеда — размеры/позиция/поворот в мм и радианах. Это описание
 * потребляет и 3D (Three.js Mesh), и в будущем — 2D-чертежи/раскрой.
 *
 *   Part (width, height, thickness) → BoxGeometry
 *
 * Соглашение осей: width → X, height → Y, thickness → Z.
 * Part.position трактуется как ЦЕНТР панели (мм).
 */
import type { Part } from '../model/types';

export interface BoxGeometry {
  /** Размеры бокса по осям X/Y/Z (мм). */
  size: { x: number; y: number; z: number };
  /** Позиция центра бокса (мм). */
  position: { x: number; y: number; z: number };
  /** Поворот в радианах. */
  rotation: { x: number; y: number; z: number };
}

const DEG_TO_RAD = Math.PI / 180;

/** Построить описание бокса для детали. */
export function partBoxGeometry(part: Part): BoxGeometry {
  return {
    size: {
      x: Math.max(0, part.width),
      y: Math.max(0, part.height),
      z: Math.max(0, part.thickness),
    },
    position: { x: part.position.x, y: part.position.y, z: part.position.z },
    rotation: {
      x: part.rotation.x * DEG_TO_RAD,
      y: part.rotation.y * DEG_TO_RAD,
      z: part.rotation.z * DEG_TO_RAD,
    },
  };
}

/** Площадь пласти детали (мм²) — для будущих расчётов материала. */
export function partFaceArea(part: Part): number {
  return Math.max(0, part.width) * Math.max(0, part.height);
}
