/**
 * PartTransformAdapter — единый мост «производственная деталь → 3D-трансформация».
 *
 * 3D НЕ хранит собственную геометрию: положение/размер/поворот детали
 * выводятся из ProjectModel (Part) этим адаптером. Соглашение осей едино для
 * всего проекта: X — ширина, Y — высота, Z — глубина; единицы — мм.
 */
import type { Part } from '@/core/model/types';
import { partBoxGeometry, partWorldAABB, type AABB, type BoxGeometry } from '@/core/geometry/partGeometry';

/** Масштаб отображения: 1 единица three = 1 метр, модель в мм. */
export const MM_TO_UNIT = 1 / 1000;

export interface PartTransform {
  partId: string;
  size: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number }; // радианы
}

/** Трансформация детали для 3D (мм/радианы). */
export function partTransform(part: Part): PartTransform {
  const g: BoxGeometry = partBoxGeometry(part);
  return { partId: String(part.id), size: g.size, position: g.position, rotation: g.rotation };
}

/** Матрица поворота Эйлера XYZ (R = Rz·Ry·Rx), 9 элементов по строкам. */
export function rotationMatrix(rx: number, ry: number, rz: number): number[] {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cy * cz, cz * sx * sy - cx * sz, cx * cz * sy + sx * sz,
    cy * sz, cx * cz + sx * sy * sz, -cz * sx + cx * sy * sz,
    -sy, cy * sx, cx * cy,
  ];
}

/** 8 угловых точек ориентированного бокса детали в мировых координатах (мм). */
export function partWorldCorners(part: Part): Array<[number, number, number]> {
  const g = partBoxGeometry(part);
  const hx = g.size.x / 2, hy = g.size.y / 2, hz = g.size.z / 2;
  const m = rotationMatrix(g.rotation.x, g.rotation.y, g.rotation.z);
  const c = g.position;
  const corners: Array<[number, number, number]> = [];
  for (const sxk of [-1, 1]) {
    for (const syk of [-1, 1]) {
      for (const szk of [-1, 1]) {
        const lx = sxk * hx, ly = syk * hy, lz = szk * hz;
        corners.push([
          c.x + m[0] * lx + m[1] * ly + m[2] * lz,
          c.y + m[3] * lx + m[4] * ly + m[5] * lz,
          c.z + m[6] * lx + m[7] * ly + m[8] * lz,
        ]);
      }
    }
  }
  return corners;
}

export { partWorldAABB, type AABB };
