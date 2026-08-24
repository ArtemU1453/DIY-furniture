/**
 * Локальная система координат детали и переводы local ↔ world.
 *
 * У каждой детали однозначная правая система координат, привязанная к её
 * габаритному боксу: оси ex/ey/ez соответствуют width/height/thickness детали
 * (после её поворота в изделии), начало — в центре детали. Присадка хранится в
 * координатах ГРАНИ детали (2D x/y на грани + глубина внутрь), а перевод в
 * мировые координаты для 3D выполняется здесь.
 *
 *   Part local coordinates → MachiningOperation → World coordinates → Three.js
 */
import type { Part, PartFace, Vec3 } from '../model/types';
import { partBoxGeometry } from './partGeometry';

export type V3 = { x: number; y: number; z: number };

const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const neg = (a: V3): V3 => ({ x: -a.x, y: -a.y, z: -a.z });

/** Матрица поворота Эйлера (порядок XYZ), строки как 3 вектора-столбца базиса. */
function eulerBasis(rx: number, ry: number, rz: number): { ex: V3; ey: V3; ez: V3 } {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx, столбцы — образы базисных ортов.
  const ex = { x: cy * cz, y: cy * sz, z: -sy };
  const ey = { x: cz * sx * sy - cx * sz, y: cx * cz + sx * sy * sz, z: cy * sx };
  const ez = { x: cx * cz * sy + sx * sz, y: -cz * sx + cx * sy * sz, z: cx * cy };
  return { ex, ey, ez };
}

export interface PartFrame {
  center: V3;
  ex: V3; // ось width (мм → world unit)
  ey: V3; // ось height
  ez: V3; // ось thickness
  size: { x: number; y: number; z: number }; // width, height, thickness
}

/** Построить локальную систему координат детали (в мм-мировых координатах). */
export function partFrame(part: Part): PartFrame {
  const g = partBoxGeometry(part);
  const { ex, ey, ez } = eulerBasis(g.rotation.x, g.rotation.y, g.rotation.z);
  return { center: g.position, ex, ey, ez, size: { ...g.size } };
}

export interface FaceInfo {
  face: PartFace;
  normal: V3; // внешняя нормаль (world unit)
  u: V3; // ось локального x на грани
  v: V3; // ось локального y на грани
  uSize: number;
  vSize: number;
  depthExtent: number; // толщина детали вдоль нормали грани
  corner: V3; // мировая точка угла (x=0, y=0) грани
}

const ALL_FACES: PartFace[] = ['front', 'back', 'right', 'left', 'top', 'bottom'];

/** Геометрия грани детали в мировых координатах. */
export function faceInfo(frame: PartFrame, face: PartFace): FaceInfo {
  const { ex, ey, ez, size, center } = frame;
  let normal: V3, u: V3, v: V3, uSize: number, vSize: number, depthExtent: number;
  switch (face) {
    case 'front': normal = ez; u = ex; v = ey; uSize = size.x; vSize = size.y; depthExtent = size.z; break;
    case 'back': normal = neg(ez); u = ex; v = ey; uSize = size.x; vSize = size.y; depthExtent = size.z; break;
    case 'right': normal = ex; u = ez; v = ey; uSize = size.z; vSize = size.y; depthExtent = size.x; break;
    case 'left': normal = neg(ex); u = ez; v = ey; uSize = size.z; vSize = size.y; depthExtent = size.x; break;
    case 'top': normal = ey; u = ex; v = ez; uSize = size.x; vSize = size.z; depthExtent = size.y; break;
    case 'bottom': default: normal = neg(ey); u = ex; v = ez; uSize = size.x; vSize = size.z; depthExtent = size.y; break;
  }
  const corner = add(
    add(center, scale(normal, depthExtent / 2)),
    add(scale(u, -uSize / 2), scale(v, -vSize / 2)),
  );
  return { face, normal, u, v, uSize, vSize, depthExtent, corner };
}

/** Найти грань, чья внешняя нормаль ближе всего к заданному направлению. */
export function faceOfNormal(frame: PartFrame, worldNormal: V3): PartFace {
  let best: PartFace = 'front';
  let bestDot = -Infinity;
  for (const f of ALL_FACES) {
    const d = dot(faceInfo(frame, f).normal, worldNormal);
    if (d > bestDot) {
      bestDot = d;
      best = f;
    }
  }
  return best;
}

/** Мировая точка операции на грани + направление внутрь детали. */
export function operationWorld(
  part: Part,
  face: PartFace,
  x: number,
  y: number,
): { position: Vec3; inward: Vec3; normal: Vec3 } {
  const fi = faceInfo(partFrame(part), face);
  const position = add(fi.corner, add(scale(fi.u, x), scale(fi.v, y)));
  return { position, inward: neg(fi.normal), normal: fi.normal };
}

/** Локальные координаты грани для мировой точки (проекция на плоскость грани). */
export function worldToFaceXY(part: Part, face: PartFace, world: V3): { x: number; y: number } {
  const fi = faceInfo(partFrame(part), face);
  const rel = sub(world, fi.corner);
  return { x: dot(rel, fi.u), y: dot(rel, fi.v) };
}

export const vec = { add, sub, scale, dot, neg };
