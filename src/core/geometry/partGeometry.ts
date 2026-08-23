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

export interface AABB {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/**
 * Осеориентированный габаритный бокс детали в мировых координатах с учётом
 * поворота (повороты кратны 90°). position трактуется как центр.
 */
export function partWorldAABB(part: Part): AABB {
  const g = partBoxGeometry(part);
  const half = { x: g.size.x / 2, y: g.size.y / 2, z: g.size.z / 2 };
  // Матрица поворота Эйлера в порядке XYZ.
  const { x: rx, y: ry, z: rz } = g.rotation;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx
  const m = [
    cy * cz, cz * sx * sy - cx * sz, cx * cz * sy + sx * sz,
    cy * sz, cx * cz + sx * sy * sz, -cz * sx + cx * sy * sz,
    -sy, cy * sx, cx * cy,
  ];
  // Мировые полу-габариты = |R| · half.
  const hx = Math.abs(m[0]) * half.x + Math.abs(m[1]) * half.y + Math.abs(m[2]) * half.z;
  const hy = Math.abs(m[3]) * half.x + Math.abs(m[4]) * half.y + Math.abs(m[5]) * half.z;
  const hz = Math.abs(m[6]) * half.x + Math.abs(m[7]) * half.y + Math.abs(m[8]) * half.z;
  const c = g.position;
  return {
    min: { x: c.x - hx, y: c.y - hy, z: c.z - hz },
    max: { x: c.x + hx, y: c.y + hy, z: c.z + hz },
  };
}
