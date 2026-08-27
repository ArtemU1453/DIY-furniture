/**
 * Dimension3D — габаритные размеры и расстояния. Размеры берутся из
 * ProjectModel (детали), а не измеряются по mesh как источник истины.
 */
import type { Part } from '@/core/model/types';
import { partWorldAABB } from '@/core/geometry/partGeometry';

export interface OverallDimensions {
  width: number; // X, мм
  height: number; // Y
  depth: number; // Z
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** Габариты всей модели по объединённому AABB деталей (мм). */
export function overallDimensions(parts: Part[]): OverallDimensions {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of parts) {
    if (p.metadata?.hidden === true) continue;
    const b = partWorldAABB(p);
    minX = Math.min(minX, b.min.x); minY = Math.min(minY, b.min.y); minZ = Math.min(minZ, b.min.z);
    maxX = Math.max(maxX, b.max.x); maxY = Math.max(maxY, b.max.y); maxZ = Math.max(maxZ, b.max.z);
  }
  if (!Number.isFinite(minX)) {
    return { width: 0, height: 0, depth: 0, min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  }
  return {
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY),
    depth: Math.round(maxZ - minZ),
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

/** Евклидово расстояние между двумя точками (мм). */
export function distance3D(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
