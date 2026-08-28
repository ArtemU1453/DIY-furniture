/**
 * Измерение (§54–§57).
 *
 * Замер — справочная величина: он ничего не меняет в модели и не участвует в
 * производстве. Расстояния считаются по тем же габаритам, что и вся геометрия.
 */
import type { Part, Vec3 } from '@/core/model/types';
import { partWorldAABB } from '@/core/geometry/partGeometry';

export interface MeasurePoint extends Vec3 {
  /** Откуда взята точка: клик по пустому месту или привязка к детали. */
  sourceId?: string;
}

export interface Measurement {
  from: MeasurePoint;
  to: MeasurePoint;
  /** Полное расстояние, мм. */
  distance: number;
  /** Проекции на оси, мм. */
  dx: number;
  dy: number;
  dz: number;
  label: string;
}

const round = (v: number): number => Math.round(v * 10) / 10;

/** Расстояние между двумя точками (§55). */
export function measurePoints(from: MeasurePoint, to: MeasurePoint): Measurement {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dy, dz);
  return {
    from, to,
    distance: round(distance),
    dx: round(dx), dy: round(dy), dz: round(dz),
    label: `${round(distance)} мм`,
  };
}

export interface PartMeasurement {
  partId: string;
  name: string;
  width: number;
  height: number;
  depth: number;
  label: string;
}

/** Габариты выбранной детали (§56). */
export function measurePart(part: Part): PartMeasurement {
  const box = partWorldAABB(part);
  const width = round(box.max.x - box.min.x);
  const height = round(box.max.y - box.min.y);
  const depth = round(box.max.z - box.min.z);
  return {
    partId: String(part.id),
    name: part.name,
    width, height, depth,
    label: `${width} × ${height} × ${depth} мм`,
  };
}

/**
 * Расстояние между двумя деталями (§57).
 *
 * Меряется просвет между габаритами: если детали перекрываются по оси, зазор
 * по ней равен нулю — именно это и нужно знать при сборке.
 */
export interface PartsDistance {
  aId: string;
  bId: string;
  /** Просвет по осям, мм; 0 — детали перекрываются по этой оси. */
  gapX: number;
  gapY: number;
  gapZ: number;
  /** Расстояние между центрами, мм. */
  centerDistance: number;
  /** Минимальный просвет между телами, мм. */
  clearance: number;
  label: string;
}

function axisGap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  if (aMax < bMin) return bMin - aMax;
  if (bMax < aMin) return aMin - bMax;
  return 0;
}

export function measureDistance(a: Part, b: Part): PartsDistance {
  const boxA = partWorldAABB(a);
  const boxB = partWorldAABB(b);
  const gapX = axisGap(boxA.min.x, boxA.max.x, boxB.min.x, boxB.max.x);
  const gapY = axisGap(boxA.min.y, boxA.max.y, boxB.min.y, boxB.max.y);
  const gapZ = axisGap(boxA.min.z, boxA.max.z, boxB.min.z, boxB.max.z);
  const centerA = {
    x: (boxA.min.x + boxA.max.x) / 2,
    y: (boxA.min.y + boxA.max.y) / 2,
    z: (boxA.min.z + boxA.max.z) / 2,
  };
  const centerB = {
    x: (boxB.min.x + boxB.max.x) / 2,
    y: (boxB.min.y + boxB.max.y) / 2,
    z: (boxB.min.z + boxB.max.z) / 2,
  };
  const centerDistance = Math.hypot(centerB.x - centerA.x, centerB.y - centerA.y, centerB.z - centerA.z);
  const clearance = Math.hypot(gapX, gapY, gapZ);
  return {
    aId: String(a.id),
    bId: String(b.id),
    gapX: round(gapX), gapY: round(gapY), gapZ: round(gapZ),
    centerDistance: round(centerDistance),
    clearance: round(clearance),
    label: `${round(clearance)} мм между «${a.name}» и «${b.name}»`,
  };
}

/** Состояние инструмента измерения (§54). */
export interface MeasureState {
  active: boolean;
  from: MeasurePoint | null;
  result: Measurement | null;
}

export const EMPTY_MEASURE: MeasureState = { active: false, from: null, result: null };

/** Клик инструментом измерения: первый задаёт точку A, второй — точку B. */
export function measureClick(state: MeasureState, point: MeasurePoint): MeasureState {
  if (!state.from) return { ...state, from: point, result: null };
  return { ...state, from: null, result: measurePoints(state.from, point) };
}
