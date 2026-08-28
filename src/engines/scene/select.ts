/**
 * Выбор объектов сцены (§31–§36, §84/§85).
 *
 * Выбор хранится идентификаторами узлов, а не ссылками на объекты three:
 * поэтому он переживает пересборку сцены и одинаково работает из дерева, из
 * 3D и из других экранов.
 */
import type { FurnitureScene, SceneNode, SceneNodeKind } from './types';
import { nodeOfPart } from './build';

export interface SceneSelection {
  ids: string[];
  /** Последний выбранный узел — к нему относятся свойства и размеры. */
  activeId: string | null;
}

export const EMPTY_SELECTION: SceneSelection = { ids: [], activeId: null };

/** Одиночный выбор (§31). */
export function selectNode(nodeId: string): SceneSelection {
  return { ids: [nodeId], activeId: nodeId };
}

/** Добавить/убрать из выбора: Ctrl/Cmd + click (§34). */
export function toggleNode(state: SceneSelection, nodeId: string): SceneSelection {
  const has = state.ids.includes(nodeId);
  const ids = has ? state.ids.filter((id) => id !== nodeId) : [...state.ids, nodeId];
  return { ids, activeId: has ? (ids[ids.length - 1] ?? null) : nodeId };
}

/** Снять выделение: Escape (§36). */
export function clearSelection(): SceneSelection {
  return { ids: [], activeId: null };
}

/** Прямоугольная область экрана для выделения рамкой (§35). */
export interface SelectionBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function normalizeBox(a: { x: number; y: number }, b: { x: number; y: number }): SelectionBox {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/**
 * Выделение рамкой (§35).
 *
 * Проекция берётся у вызывающего кода (он знает камеру), сцена лишь решает,
 * какие узлы попали в рамку — так логика остаётся проверяемой без three.
 */
export function selectInBox(
  scene: FurnitureScene,
  box: SelectionBox,
  project: (node: SceneNode) => { x: number; y: number } | null,
  kinds: SceneNodeKind[] = ['PART'],
): SceneSelection {
  const ids: string[] = [];
  for (const id of scene.order) {
    const node = scene.nodes[id];
    if (!kinds.includes(node.kind)) continue;
    const point = project(node);
    if (!point) continue;
    if (point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY) {
      ids.push(id);
    }
  }
  return { ids, activeId: ids[ids.length - 1] ?? null };
}

/**
 * Луч и его пересечение с узлами (§32).
 *
 * Простой перебор боксов: сцен мебели немного, зато результат детерминирован
 * и его можно проверить тестом без графического контекста.
 */
export interface Ray {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}

export function raycast(
  scene: FurnitureScene,
  ray: Ray,
  kinds: SceneNodeKind[] = ['PART', 'HARDWARE', 'MACHINING'],
): SceneNode | null {
  let best: { node: SceneNode; distance: number } | null = null;
  for (const id of scene.order) {
    const node = scene.nodes[id];
    if (!kinds.includes(node.kind)) continue;
    const hit = intersectBox(ray, node);
    if (hit === null) continue;
    if (!best || hit < best.distance) best = { node, distance: hit };
  }
  return best?.node ?? null;
}

/** Пересечение луча с осеориентированным боксом узла; null — промах. */
function intersectBox(ray: Ray, node: SceneNode): number | null {
  const min = {
    x: node.world.position.x - node.size.x / 2,
    y: node.world.position.y - node.size.y / 2,
    z: node.world.position.z - node.size.z / 2,
  };
  const max = {
    x: node.world.position.x + node.size.x / 2,
    y: node.world.position.y + node.size.y / 2,
    z: node.world.position.z + node.size.z / 2,
  };
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const axis of ['x', 'y', 'z'] as const) {
    const origin = ray.origin[axis];
    const dir = ray.direction[axis];
    if (Math.abs(dir) < 1e-9) {
      if (origin < min[axis] || origin > max[axis]) return null;
      continue;
    }
    const t1 = (min[axis] - origin) / dir;
    const t2 = (max[axis] - origin) / dir;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (tmax < Math.max(tmin, 0)) return null;
  return Math.max(tmin, 0);
}

/** Узел детали для связи «выбор в 2D → выбор в 3D» (§84/§153). */
export function selectionForPart(scene: FurnitureScene, partId: string): SceneSelection {
  const node = nodeOfPart(scene, partId);
  return node ? selectNode(node.id) : clearSelection();
}

/** Деталь выбранного узла — для обратной связи «3D → 2D» (§85/§154/§158). */
export function partOfSelection(scene: FurnitureScene, selection: SceneSelection): string | null {
  const node = selection.activeId ? scene.nodes[selection.activeId] : undefined;
  if (!node) return null;
  if (node.kind === 'PART') return node.refId;
  // У фурнитуры и присадки родитель — деталь: показываем именно её (§158).
  let parent = node.parentId ? scene.nodes[node.parentId] : undefined;
  while (parent) {
    if (parent.kind === 'PART') return parent.refId;
    parent = parent.parentId ? scene.nodes[parent.parentId] : undefined;
  }
  return null;
}
