/**
 * Разнесённый вид (§73–§76).
 *
 * Смещения существуют ТОЛЬКО в сцене (§75): модель их не видит, поэтому
 * раскрой, спецификация и производство остаются нетронутыми.
 */
import type { FurnitureScene, SceneNode } from './types';
import { sceneBounds } from './camera';

export interface ExplodeState {
  enabled: boolean;
  /** Коэффициент разноса: 0 — собрано, 1 — типовой разнос. */
  factor: number;
}

export const DEFAULT_EXPLODE: ExplodeState = { enabled: false, factor: 0.5 };

/** Включить/выключить разнос (§73/§74). */
export function toggleExplode(state: ExplodeState, enabled?: boolean): ExplodeState {
  return { ...state, enabled: enabled ?? !state.enabled };
}

export function setExplodeFactor(state: ExplodeState, factor: number): ExplodeState {
  return { ...state, factor: Math.max(0, Math.min(3, factor)) };
}

/** Сбросить разнос (§76). */
export function resetExplode(): ExplodeState {
  return { ...DEFAULT_EXPLODE };
}

/**
 * Смещение узла в разнесённом виде (§74).
 *
 * Деталь отъезжает от центра модели по своему направлению: чем дальше она
 * стоит, тем сильнее сдвиг — так собранный шкаф «раскрывается» наружу.
 */
export function explodeOffset(
  scene: FurnitureScene,
  node: SceneNode,
  state: ExplodeState,
): { x: number; y: number; z: number } {
  if (!state.enabled || state.factor === 0) return { x: 0, y: 0, z: 0 };
  const center = sceneBounds(scene).center;
  const dx = node.world.position.x - center.x;
  const dy = node.world.position.y - center.y;
  const dz = node.world.position.z - center.z;
  return {
    x: dx * state.factor,
    y: dy * state.factor,
    z: dz * state.factor,
  };
}

/** Положение узла с учётом разноса — только для отрисовки (§75). */
export function explodedPosition(
  scene: FurnitureScene,
  node: SceneNode,
  state: ExplodeState,
): { x: number; y: number; z: number } {
  const offset = explodeOffset(scene, node, state);
  return {
    x: node.world.position.x + offset.x,
    y: node.world.position.y + offset.y,
    z: node.world.position.z + offset.z,
  };
}
