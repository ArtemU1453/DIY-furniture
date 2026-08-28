/**
 * Дерево сцены (§82–§87).
 *
 * Дерево — это та же сцена, только в виде списка: собственных данных оно не
 * держит, поэтому выбор в дереве и в 3D всегда указывает на один узел.
 */
import type { FurnitureScene, SceneNode, SceneNodeKind } from './types';

export interface SceneTreeItem {
  nodeId: string;
  kind: SceneNodeKind;
  label: string;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  refId: string | null;
}

/** Плоское дерево с уровнями вложенности (§83). */
export function sceneTree(scene: FurnitureScene): SceneTreeItem[] {
  const out: SceneTreeItem[] = [];
  const walk = (id: string, depth: number): void => {
    const node: SceneNode | undefined = scene.nodes[id];
    if (!node) return;
    out.push({
      nodeId: node.id,
      kind: node.kind,
      label: node.label,
      depth,
      parentId: node.parentId,
      hasChildren: node.childIds.length > 0,
      refId: node.refId,
    });
    for (const child of node.childIds) walk(child, depth + 1);
  };
  walk(scene.rootId, 0);
  return out;
}

/** Фильтр дерева (§87). */
export interface TreeFilter {
  parts?: boolean;
  hardware?: boolean;
  machining?: boolean;
  query?: string;
}

export const DEFAULT_TREE_FILTER: TreeFilter = { parts: true, hardware: true, machining: false };

/**
 * Поиск и фильтрация дерева (§86/§87).
 *
 * Найденный узел показывается вместе с родителями: иначе деталь «висела» бы
 * в списке без корпуса и модуля.
 */
export function filterTree(
  scene: FurnitureScene,
  items: SceneTreeItem[],
  filter: TreeFilter,
  numbers: Record<string, string> = {},
): SceneTreeItem[] {
  const query = filter.query?.trim().toLowerCase() ?? '';
  const kindAllowed = (kind: SceneNodeKind): boolean => {
    if (kind === 'PART') return filter.parts !== false;
    if (kind === 'HARDWARE') return filter.hardware !== false;
    if (kind === 'MACHINING') return filter.machining === true;
    return true;
  };

  const matches = new Set<string>();
  for (const item of items) {
    if (!kindAllowed(item.kind)) continue;
    if (query) {
      const number = item.refId ? (numbers[item.refId] ?? '') : '';
      const hay = `${item.label} ${item.refId ?? ''} ${number}`.toLowerCase();
      if (!hay.includes(query)) continue;
    }
    matches.add(item.nodeId);
    let parent = scene.nodes[item.nodeId]?.parentId ?? null;
    while (parent) {
      matches.add(parent);
      parent = scene.nodes[parent]?.parentId ?? null;
    }
  }
  return items.filter((i) => matches.has(i.nodeId));
}

/** Номера деталей для поиска по номеру (§86). */
export function partNumbers(parts: Array<{ id: unknown; metadata?: Record<string, unknown> }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of parts) {
    const number = part.metadata?.number;
    if (typeof number === 'string') out[String(part.id)] = number;
  }
  return out;
}
