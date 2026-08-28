/**
 * Режим сечения (§69–§72).
 *
 * Сечение — это ВИД, а не изменение модели: плоскость только скрывает то, что
 * лежит за ней, и в ProjectModel ничего не пишет (§148).
 */
import type { FurnitureScene, SceneNode } from './types';
import { sceneBounds } from './camera';

export type SectionAxis = 'X' | 'Y' | 'Z';

export interface SectionState {
  enabled: boolean;
  axis: SectionAxis;
  /** Положение плоскости по оси, мм. */
  position: number;
  /** Что оставить: часть до плоскости или после. */
  side: 'NEGATIVE' | 'POSITIVE';
}

export const DEFAULT_SECTION: SectionState = {
  enabled: false,
  axis: 'X',
  position: 0,
  side: 'NEGATIVE',
};

/** Включить/выключить сечение (§72). */
export function toggleSection(state: SectionState, enabled?: boolean): SectionState {
  return { ...state, enabled: enabled ?? !state.enabled };
}

/** Сменить плоскость (§70) и поставить её по центру модели. */
export function setSectionAxis(state: SectionState, axis: SectionAxis, scene?: FurnitureScene): SectionState {
  const center = scene ? sceneBounds(scene).center : { x: 0, y: 0, z: 0 };
  const position = axis === 'X' ? center.x : axis === 'Y' ? center.y : center.z;
  return { ...state, axis, position };
}

/** Передвинуть плоскость (§71). */
export function moveSection(state: SectionState, position: number): SectionState {
  return { ...state, position };
}

/** Координата узла вдоль оси сечения. */
function axisValue(node: SceneNode, axis: SectionAxis): number {
  return axis === 'X' ? node.world.position.x : axis === 'Y' ? node.world.position.y : node.world.position.z;
}

/**
 * Отсечён ли узел плоскостью (§69).
 *
 * Сравнивается ближняя грань бокса, а не центр: иначе половина детали
 * «пропадала» бы, едва плоскость коснулась её середины.
 */
export function isCut(node: SceneNode, state: SectionState): boolean {
  if (!state.enabled) return false;
  const half = (state.axis === 'X' ? node.size.x : state.axis === 'Y' ? node.size.y : node.size.z) / 2;
  const value = axisValue(node, state.axis);
  return state.side === 'NEGATIVE'
    ? value - half > state.position
    : value + half < state.position;
}

/** Узлы, остающиеся видимыми после сечения (§69). */
export function sectionNodes(scene: FurnitureScene, state: SectionState): SceneNode[] {
  return scene.order.map((id) => scene.nodes[id]).filter((n) => !isCut(n, state));
}
