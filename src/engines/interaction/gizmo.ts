/**
 * Гизмо перемещения, поворота и размера (§12–§18, §73–§80).
 *
 * Здесь только МОДЕЛЬ гизмо: где стоят ручки, какая ось активна и во что
 * превращается движение мыши. Рисование остаётся в компонентах, а запись в
 * ProjectModel — в командах: движок ничего не мутирует.
 */
import type { Part, Vec3 } from '@/core/model/types';
import { partWorldAABB } from '@/core/geometry/partGeometry';

export type GizmoMode = 'MOVE' | 'ROTATE' | 'RESIZE';
export type GizmoAxis = 'X' | 'Y' | 'Z' | 'XYZ';

export interface GizmoState {
  mode: GizmoMode;
  /** Ограничение по оси (§14). XYZ — свободное перемещение. */
  axis: GizmoAxis;
  /** Ортогональный режим (§18): движение только по доминирующей оси. */
  orthogonal: boolean;
}

export const DEFAULT_GIZMO: GizmoState = { mode: 'MOVE', axis: 'XYZ', orthogonal: false };

/** Габарит набора деталей — на нём стоит гизмо. */
export interface GizmoBounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  size: Vec3;
}

export function gizmoBounds(parts: Part[]): GizmoBounds | null {
  if (parts.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const part of parts) {
    const box = partWorldAABB(part);
    minX = Math.min(minX, box.min.x); maxX = Math.max(maxX, box.max.x);
    minY = Math.min(minY, box.min.y); maxY = Math.max(maxY, box.max.y);
    minZ = Math.min(minZ, box.min.z); maxZ = Math.max(maxZ, box.max.z);
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
  };
}

/** Ручка изменения размера (§20). */
export interface ResizeHandle3D {
  id: string;
  axis: 'x' | 'y' | 'z';
  /** −1 — минимальная грань, +1 — максимальная. */
  side: -1 | 1;
  position: Vec3;
}

/** Шесть ручек по граням габарита (§20). */
export function resizeHandles(bounds: GizmoBounds): ResizeHandle3D[] {
  const c = bounds.center;
  return [
    { id: 'x-', axis: 'x', side: -1, position: { x: bounds.min.x, y: c.y, z: c.z } },
    { id: 'x+', axis: 'x', side: 1, position: { x: bounds.max.x, y: c.y, z: c.z } },
    { id: 'y-', axis: 'y', side: -1, position: { x: c.x, y: bounds.min.y, z: c.z } },
    { id: 'y+', axis: 'y', side: 1, position: { x: c.x, y: bounds.max.y, z: c.z } },
    { id: 'z-', axis: 'z', side: -1, position: { x: c.x, y: c.y, z: bounds.min.z } },
    { id: 'z+', axis: 'z', side: 1, position: { x: c.x, y: c.y, z: bounds.max.z } },
  ];
}

/**
 * Применить ограничение оси и ортогональный режим к смещению (§14/§18).
 *
 * В ортогональном режиме остаётся только доминирующая составляющая: так
 * перетаскивание не «съезжает» по второй оси на пару миллиметров.
 */
export function constrainDelta(delta: Vec3, state: GizmoState): Vec3 {
  let next: Vec3 = { ...delta };
  if (state.axis === 'X') next = { x: next.x, y: 0, z: 0 };
  else if (state.axis === 'Y') next = { x: 0, y: next.y, z: 0 };
  else if (state.axis === 'Z') next = { x: 0, y: 0, z: next.z };

  if (state.orthogonal && state.axis === 'XYZ') {
    const ax = Math.abs(next.x), ay = Math.abs(next.y), az = Math.abs(next.z);
    if (ax >= ay && ax >= az) next = { x: next.x, y: 0, z: 0 };
    else if (ay >= ax && ay >= az) next = { x: 0, y: next.y, z: 0 };
    else next = { x: 0, y: 0, z: next.z };
  }
  return next;
}

/** Углы поворота, доступные командой (§75). */
export const ROTATION_STEPS = [90, 180, 270] as const;

export type FlipAxis = 'X' | 'Y' | 'Z';

/** Положение детали после перемещения. */
export function movedPosition(part: Part, delta: Vec3): Vec3 {
  return {
    x: part.position.x + delta.x,
    y: part.position.y + delta.y,
    z: part.position.z + delta.z,
  };
}

/** Зеркальное положение относительно плоскости (§73/§74/§76). */
export function mirroredPosition(position: Vec3, axis: FlipAxis, plane = 0): Vec3 {
  switch (axis) {
    case 'X': return { ...position, x: 2 * plane - position.x };
    case 'Y': return { ...position, y: 2 * plane - position.y };
    case 'Z': default: return { ...position, z: 2 * plane - position.z };
  }
}

/** Поворот детали на заданный угол вокруг оси, градусы (§75/§80). */
export function rotatedRotation(part: Part, axis: FlipAxis, degrees: number): Part['rotation'] {
  const normalize = (v: number) => ((v % 360) + 360) % 360;
  const r = part.rotation;
  if (axis === 'X') return { ...r, x: normalize(r.x + degrees) };
  if (axis === 'Y') return { ...r, y: normalize(r.y + degrees) };
  return { ...r, z: normalize(r.z + degrees) };
}
