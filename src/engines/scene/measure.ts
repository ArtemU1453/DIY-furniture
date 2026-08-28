/**
 * Размеры и измерение в сцене (§88–§94, §135/§136).
 *
 * Все значения в миллиметрах, отображение — с точностью 0.1 мм. Измерения
 * временные: они живут в состоянии вида и не попадают в модель.
 */
import type { FurnitureScene, SceneNode } from './types';
import { round01 } from './types';

export interface MeasurePoint {
  x: number;
  y: number;
  z: number;
  /** Узел, к которому привязана точка, если она снята с объекта. */
  nodeId?: string;
}

export interface MeasureResult {
  id: string;
  from: MeasurePoint;
  to: MeasurePoint;
  /** Расстояние, мм (§92). */
  distance: number;
  /** Проекции (§93). */
  dx: number;
  dy: number;
  dz: number;
}

export interface MeasureState {
  active: boolean;
  /** Первая выбранная точка, пока вторая не поставлена (§91). */
  pending: MeasurePoint | null;
  results: MeasureResult[];
}

export const DEFAULT_MEASURE: MeasureState = { active: false, pending: null, results: [] };

/** Расстояние между точками с проекциями (§92/§93). */
export function measureBetween(from: MeasurePoint, to: MeasurePoint, id = 'm1'): MeasureResult {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return {
    id,
    from,
    to,
    distance: round01(Math.hypot(dx, dy, dz)),
    dx: round01(dx),
    dy: round01(dy),
    dz: round01(dz),
  };
}

/**
 * Поставить точку измерения (§91).
 *
 * Первая точка запоминается, вторая сразу даёт результат — инструмент готов
 * к следующему замеру без лишних действий.
 */
export function addMeasurePoint(state: MeasureState, point: MeasurePoint): MeasureState {
  if (!state.pending) return { ...state, pending: point };
  const result = measureBetween(state.pending, point, `m${state.results.length + 1}`);
  return { ...state, pending: null, results: [...state.results, result] };
}

/** Удалить временные измерения (§94). */
export function clearMeasures(state: MeasureState): MeasureState {
  return { ...state, pending: null, results: [] };
}

export function toggleMeasure(state: MeasureState, active?: boolean): MeasureState {
  const next = active ?? !state.active;
  return next ? { ...state, active: true } : { ...state, active: false, pending: null };
}

/** Габаритные размеры узла (§88/§89). */
export interface NodeDimensions {
  nodeId: string;
  label: string;
  width: number;
  height: number;
  depth: number;
  /** Положение центра, мм (§133). */
  position: { x: number; y: number; z: number };
}

export function nodeDimensions(node: SceneNode): NodeDimensions {
  return {
    nodeId: node.id,
    label: node.label,
    width: round01(node.size.x),
    height: round01(node.size.y),
    depth: round01(node.size.z),
    position: {
      x: round01(node.world.position.x),
      y: round01(node.world.position.y),
      z: round01(node.world.position.z),
    },
  };
}

/** Автоматические размеры выбранных объектов (§89). */
export function autoDimensions(scene: FurnitureScene, nodeIds: string[]): NodeDimensions[] {
  return nodeIds
    .map((id) => scene.nodes[id])
    .filter((n): n is SceneNode => n !== undefined)
    .map(nodeDimensions);
}
