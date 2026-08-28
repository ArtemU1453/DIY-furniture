/**
 * Обновление сцены (§126–§129).
 *
 * Сцена пересобирается не целиком: если изменилась одна деталь, обновляются
 * её узел и зависимые (фурнитура и присадка на ней). Полная пересборка
 * остаётся отдельной командой (§129).
 */
import type { Project } from '@/core/model/types';
import { buildFurnitureScene, sceneSignature, type SceneBuildOptions } from './build';
import type { FurnitureScene, SceneNode } from './types';

/** Что изменилось в сцене (§127/§128). */
export interface SceneDiff {
  added: string[];
  removed: string[];
  changed: string[];
  /** Сцена не менялась — обновление не нужно. */
  clean: boolean;
}

function nodeFingerprint(node: SceneNode): string {
  const p = node.world.position;
  const r = node.world.rotation;
  const s = node.size;
  return [
    node.kind, node.label, node.refId ?? '-',
    Math.round(p.x * 10), Math.round(p.y * 10), Math.round(p.z * 10),
    Math.round(r.x * 1000), Math.round(r.y * 1000), Math.round(r.z * 1000),
    Math.round(s.x * 10), Math.round(s.y * 10), Math.round(s.z * 10),
    node.material?.color ?? '-', node.material?.materialId ?? '-',
    (node.edges ?? []).map((e) => `${e.side}${e.materialId}${e.thickness}`).join(','),
    node.hidden ? 1 : 0,
  ].join('|');
}

/** Сравнить две сцены (§127/§128). */
export function diffScenes(previous: FurnitureScene, next: FurnitureScene): SceneDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const id of next.order) {
    const before = previous.nodes[id];
    if (!before) { added.push(id); continue; }
    if (nodeFingerprint(before) !== nodeFingerprint(next.nodes[id])) changed.push(id);
  }
  for (const id of previous.order) {
    if (!next.nodes[id]) removed.push(id);
  }
  return {
    added,
    removed,
    changed,
    clean: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}

/** Устарела ли сцена относительно модели (§127). */
export function isSceneStale(scene: FurnitureScene, project: Project, options?: SceneBuildOptions): boolean {
  return scene.signature !== sceneSignature(project, options ?? {});
}

export interface SceneUpdate {
  scene: FurnitureScene;
  diff: SceneDiff;
  /** true — сцена была пересобрана целиком (§129). */
  rebuilt: boolean;
}

/**
 * Обновить сцену под модель (§128).
 *
 * Если модель не менялась — возвращается та же сцена: перерисовывать нечего.
 * Иначе строится новая и считается разница, чтобы слой отображения обновил
 * только затронутые узлы, а не всю сцену (§126).
 */
export function updateScene(
  scene: FurnitureScene,
  project: Project,
  options: SceneBuildOptions = {},
): SceneUpdate {
  if (!isSceneStale(scene, project, options)) {
    return { scene, diff: { added: [], removed: [], changed: [], clean: true }, rebuilt: false };
  }
  const next = buildFurnitureScene(project, options);
  return { scene: next, diff: diffScenes(scene, next), rebuilt: false };
}

/** Полная пересборка сцены (§129). */
export function rebuildScene(project: Project, options: SceneBuildOptions = {}): SceneUpdate {
  const next = buildFurnitureScene(project, options);
  return {
    scene: next,
    diff: { added: next.order, removed: [], changed: [], clean: false },
    rebuilt: true,
  };
}

/** Узлы, зависящие от детали: её фурнитура и присадка (§128). */
export function dependentNodes(scene: FurnitureScene, partNodeId: string): string[] {
  const node = scene.nodes[partNodeId];
  if (!node) return [];
  return node.childIds.filter((id) => {
    const child = scene.nodes[id];
    return child?.kind === 'HARDWARE' || child?.kind === 'MACHINING';
  });
}
