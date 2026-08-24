/**
 * Геометрический анализ соединения двух деталей.
 *
 * По двум деталям определяет: ось крепежа, «проходную» и «принимающую» деталь,
 * грани захода инструмента и координаты крепёжных точек (в локальной системе
 * каждой детали). Это основа для правил присадки (шкант/конфирмат): правила
 * задают лишь диаметры/глубины, а расположение выводится из конструкции.
 */
import type { Part } from '@/core/model/types';
import { partWorldAABB } from '@/core/geometry/partGeometry';
import { partFrame, faceOfNormal, worldToFaceXY, vec, type V3 } from '@/core/geometry/coordinateSystem';

export interface JointHole {
  x: number;
  y: number;
}

export interface JointSidePlan {
  part: Part;
  face: import('@/core/model/types').PartFace;
  holes: JointHole[];
  thickness: number; // толщина детали вдоль оси крепежа
}

export interface JointAnalysis {
  through: JointSidePlan; // проходная деталь
  receiving: JointSidePlan; // принимающая деталь (заходит в торец)
  count: number;
}

export interface JointOptions {
  count: number;
  edgeOffset: number;
}

const TOL = 1.5; // мм — допуск на касание деталей

/** Определить тип конструктивного узла по взаимной ориентации деталей. */
export function inferJointType(a: Part, b: Part): import('@/core/model/types').JointType {
  const joint = analyzeJoint(a, b, { count: 1, edgeOffset: 0 });
  const tA = partFrame(a).ez;
  const tB = partFrame(b).ez;
  const parallel = Math.abs(vec.dot(tA, tB)) > 0.9;
  if (!joint) return 'BUTT';
  return parallel ? 'FACE_TO_FACE' : 'EDGE_TO_FACE';
}

/** Проанализировать соединение. Возвращает null, если детали не соприкасаются. */
export function analyzeJoint(a: Part, b: Part, opts: JointOptions): JointAnalysis | null {
  const boxA = partWorldAABB(a);
  const boxB = partWorldAABB(b);

  // Пересечение AABB, расширенное допуском (иначе стыкующиеся панели не «касаются»).
  const lo = {
    x: Math.max(boxA.min.x, boxB.min.x) - TOL,
    y: Math.max(boxA.min.y, boxB.min.y) - TOL,
    z: Math.max(boxA.min.z, boxB.min.z) - TOL,
  };
  const hi = {
    x: Math.min(boxA.max.x, boxB.max.x) + TOL,
    y: Math.min(boxA.max.y, boxB.max.y) + TOL,
    z: Math.min(boxA.max.z, boxB.max.z) + TOL,
  };
  const ext = { x: hi.x - lo.x, y: hi.y - lo.y, z: hi.z - lo.z };
  if (ext.x <= 0 || ext.y <= 0 || ext.z <= 0) return null;

  // Ось крепежа — самый тонкий размер зоны контакта.
  const axisKey = (['x', 'y', 'z'] as const).reduce((m, k) => (ext[k] < ext[m] ? k : m), 'x' as 'x' | 'y' | 'z');
  const remaining = (['x', 'y', 'z'] as const).filter((k) => k !== axisKey);
  const longKey = ext[remaining[0]] >= ext[remaining[1]] ? remaining[0] : remaining[1];
  const midKey = remaining[0] === longKey ? remaining[1] : remaining[0];

  const axisW: V3 = { x: axisKey === 'x' ? 1 : 0, y: axisKey === 'y' ? 1 : 0, z: axisKey === 'z' ? 1 : 0 };
  const center = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 };

  // Проходная деталь — та, чья ось толщины совпадает с осью крепежа.
  const tA = partFrame(a).ez;
  const tB = partFrame(b).ez;
  const alignA = Math.abs(vec.dot(tA, axisW));
  const alignB = Math.abs(vec.dot(tB, axisW));
  const through = alignA >= alignB ? a : b;
  const receiving = through === a ? b : a;

  // Направление крепежа: от проходной детали к принимающей.
  const dir = vec.sub(partFrame(receiving).center, partFrame(through).center);
  const sign = vec.dot(dir, axisW) >= 0 ? 1 : -1;
  const axisSigned = vec.scale(axisW, sign);
  const entryNormal = vec.neg(axisSigned); // нормаль грани захода (для обеих деталей)

  const faceThrough = faceOfNormal(partFrame(through), entryNormal);
  const faceReceiving = faceOfNormal(partFrame(receiving), entryNormal);

  // Точки крепежа вдоль длинной оси зоны контакта.
  const span = ext[longKey];
  const off = Math.min(opts.edgeOffset, span / (opts.count + 1));
  const usable = span - 2 * off;
  const positionsWorld: V3[] = [];
  for (let i = 0; i < opts.count; i++) {
    const t = opts.count === 1 ? 0.5 : i / (opts.count - 1);
    const along = lo[longKey] + off + usable * t;
    const p = { ...center };
    p[longKey] = along;
    p[midKey] = center[midKey];
    p[axisKey] = center[axisKey];
    positionsWorld.push(p);
  }

  const thickThrough = through.thickness;
  const thickReceiving = receiving.thickness;

  return {
    count: opts.count,
    through: {
      part: through,
      face: faceThrough,
      thickness: thickThrough,
      holes: positionsWorld.map((p) => worldToFaceXY(through, faceThrough, p)),
    },
    receiving: {
      part: receiving,
      face: faceReceiving,
      thickness: thickReceiving,
      holes: positionsWorld.map((p) => worldToFaceXY(receiving, faceReceiving, p)),
    },
  };
}
