/**
 * Видимость объектов сцены (§25–§30, §77–§81).
 *
 * Видимость — состояние ПРОСМОТРА: она не пишется в производственные данные
 * (§148). Поэтому изоляция и скрытие живут в состоянии сцены, а модель их
 * не замечает.
 */
import type { FurnitureScene, SceneNode } from './types';
import { descendants } from './build';

/** Переключатели слоёв (§25–§30). */
export interface SceneVisibility {
  showEdgeBand: boolean;
  showGrain: boolean;
  showHardware: boolean;
  showMachining: boolean;
  showDimensions: boolean;
  showHelpers: boolean;
  showGrid: boolean;
  showAxes: boolean;
  /** Скрытые узлы (§79). */
  hidden: string[];
  /** Изолированный узел; остальные не показываются (§77). */
  isolated: string | null;
}

export const DEFAULT_VISIBILITY: SceneVisibility = {
  showEdgeBand: true,
  showGrain: true,
  showHardware: true,
  showMachining: false,
  showDimensions: false,
  showHelpers: true,
  showGrid: true,
  showAxes: false,
  hidden: [],
  isolated: null,
};

/** Скрыть/показать узел (§79). */
export function toggleHidden(state: SceneVisibility, nodeId: string, hidden?: boolean): SceneVisibility {
  const set = new Set(state.hidden);
  const next = hidden ?? !set.has(nodeId);
  if (next) set.add(nodeId);
  else set.delete(nodeId);
  return { ...state, hidden: [...set] };
}

/** Скрыть всё, кроме выбранного (§80). */
export function hideOthers(scene: FurnitureScene, state: SceneVisibility, keepIds: string[]): SceneVisibility {
  const keep = new Set(keepIds);
  for (const id of keepIds) {
    for (const node of descendants(scene, id)) keep.add(node.id);
  }
  const hidden = scene.order
    .filter((id) => {
      const node = scene.nodes[id];
      return node.kind !== 'PROJECT' && node.kind !== 'CABINET' && node.kind !== 'MODULE' && !keep.has(id);
    });
  return { ...state, hidden };
}

/** Изолировать узел (§77). */
export function isolate(state: SceneVisibility, nodeId: string | null): SceneVisibility {
  return { ...state, isolated: nodeId };
}

/** Показать всё (§78/§81). */
export function showAll(state: SceneVisibility): SceneVisibility {
  return { ...state, hidden: [], isolated: null };
}

/**
 * Виден ли узел (§25–§30, §77–§81).
 *
 * Порядок: слой вида → изоляция → явное скрытие. Родитель, скрытый целиком,
 * прячет и детей: иначе фурнитура висела бы в воздухе.
 */
export function isVisible(scene: FurnitureScene, state: SceneVisibility, nodeId: string): boolean {
  const node: SceneNode | undefined = scene.nodes[nodeId];
  if (!node) return false;
  if (node.kind === 'HARDWARE' && !state.showHardware) return false;
  if (node.kind === 'MACHINING' && !state.showMachining) return false;

  const hidden = new Set(state.hidden);
  let current: SceneNode | undefined = node;
  while (current) {
    if (current.hidden === true || hidden.has(current.id)) return false;
    current = current.parentId ? scene.nodes[current.parentId] : undefined;
  }

  if (state.isolated) {
    if (nodeId === state.isolated) return true;
    // Дети изолированного узла — его фурнитура и присадка — остаются видны.
    if (descendants(scene, state.isolated).some((n) => n.id === nodeId)) return true;
    // Родители остаются как каркас иерархии, иначе узел «повиснет» вне сцены.
    let cursor: SceneNode | undefined = scene.nodes[state.isolated];
    while (cursor?.parentId) {
      if (cursor.parentId === nodeId) return true;
      cursor = scene.nodes[cursor.parentId];
    }
    return false;
  }
  return true;
}

/** Видимые узлы сцены (§81). */
export function visibleNodes(scene: FurnitureScene, state: SceneVisibility): SceneNode[] {
  return scene.order.map((id) => scene.nodes[id]).filter((n) => isVisible(scene, state, n.id));
}
