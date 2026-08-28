/**
 * Инструменты преобразования в сцене (§56–§68).
 *
 * Сцена НЕ меняет объекты сама (§64): она считает, куда объект должен встать,
 * проверяет это существующими правилами и отдаёт результат вызывающему коду,
 * который применяет изменение через ProjectModel.
 */
import type { Part, Project } from '@/core/model/types';
import { validatePartChange } from '@/engines/viewer';
import { partWorldAABB } from '@/core/geometry/partGeometry';
import type { FurnitureScene, SceneNode } from './types';
import { snapToGrid } from './camera';

/** Режим преобразования (§61). */
export type TransformMode = 'SELECT' | 'MOVE' | 'ROTATE';

/** Виды привязки (§56). */
export interface SnapSettings {
  enabled: boolean;
  grid: boolean;
  edge: boolean;
  vertex: boolean;
  center: boolean;
  step: number;
  /** Радиус срабатывания привязки, мм. */
  tolerance: number;
}

export const DEFAULT_SNAP: SnapSettings = {
  enabled: true,
  grid: true,
  edge: true,
  vertex: true,
  center: true,
  step: 10,
  tolerance: 15,
};

export interface SnapCandidate {
  kind: 'grid' | 'edge' | 'vertex' | 'center';
  value: number;
  nodeId?: string;
}

/**
 * Кандидаты привязки по одной оси (§56).
 *
 * Приоритет — от точного к приблизительному: вершина, край, центр, сетка.
 * Так перетаскивание «липнет» к конструкции, а не к абстрактной сетке.
 */
export function snapCandidates(
  scene: FurnitureScene,
  axis: 'x' | 'y' | 'z',
  value: number,
  settings: SnapSettings,
  excludeId?: string,
): SnapCandidate[] {
  if (!settings.enabled) return [];
  const out: SnapCandidate[] = [];
  for (const id of scene.order) {
    const node = scene.nodes[id];
    if (node.kind !== 'PART' || node.id === excludeId) continue;
    const center = node.world.position[axis];
    const half = node.size[axis] / 2;
    if (settings.vertex) {
      out.push({ kind: 'vertex', value: center - half, nodeId: node.id });
      out.push({ kind: 'vertex', value: center + half, nodeId: node.id });
    }
    if (settings.edge) {
      out.push({ kind: 'edge', value: center - half, nodeId: node.id });
      out.push({ kind: 'edge', value: center + half, nodeId: node.id });
    }
    if (settings.center) out.push({ kind: 'center', value: center, nodeId: node.id });
  }
  if (settings.grid) out.push({ kind: 'grid', value: snapToGrid(value, settings.step) });
  return out;
}

const PRIORITY: Record<SnapCandidate['kind'], number> = { vertex: 0, edge: 1, center: 2, grid: 3 };

/** Привязать координату (§56/§57). */
export function snapAxis(
  scene: FurnitureScene,
  axis: 'x' | 'y' | 'z',
  value: number,
  settings: SnapSettings,
  excludeId?: string,
): { value: number; snapped: SnapCandidate | null } {
  if (!settings.enabled) return { value, snapped: null };
  const candidates = snapCandidates(scene, axis, value, settings, excludeId)
    .filter((c) => Math.abs(c.value - value) <= settings.tolerance)
    .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || Math.abs(a.value - value) - Math.abs(b.value - value));
  const best = candidates[0];
  return best ? { value: best.value, snapped: best } : { value, snapped: null };
}

export interface MoveRequest {
  nodeId: string;
  delta: { x: number; y: number; z: number };
}

export interface MoveResult {
  /** Новое положение детали в модели, мм. */
  position: { x: number; y: number; z: number };
  snapped: SnapCandidate[];
  issues: ReturnType<typeof validatePartChange>;
  /** Изменение допустимо и его можно применить к ProjectModel (§63). */
  ok: boolean;
}

/**
 * Рассчитать перемещение детали (§58/§63/§64).
 *
 * Результат проверяется существующими правилами модели: сцена не решает сама,
 * можно ли двигать деталь.
 */
export function planMove(
  scene: FurnitureScene,
  project: Project,
  part: Part,
  request: MoveRequest,
  settings: SnapSettings = DEFAULT_SNAP,
): MoveResult {
  const node: SceneNode | undefined = scene.nodes[request.nodeId];
  const base = node ? node.world.position : part.position;
  const raw = {
    x: base.x + request.delta.x,
    y: base.y + request.delta.y,
    z: base.z + request.delta.z,
  };

  const snapped: SnapCandidate[] = [];
  const position = { ...raw };
  for (const axis of ['x', 'y', 'z'] as const) {
    const result = snapAxis(scene, axis, raw[axis], settings, request.nodeId);
    position[axis] = result.value;
    if (result.snapped) snapped.push(result.snapped);
  }

  const issues = validatePartChange(project, String(part.id), { position });
  return {
    position,
    snapped,
    issues,
    ok: issues.every((i) => i.severity !== 'error'),
  };
}

export interface RotateResult {
  rotation: { x: number; y: number; z: number };
  issues: ReturnType<typeof validatePartChange>;
  ok: boolean;
}

/** Рассчитать поворот детали (§59/§63). Углы — в градусах. */
export function planRotate(
  project: Project,
  part: Part,
  axis: 'x' | 'y' | 'z',
  degrees: number,
): RotateResult {
  const rotation = { ...part.rotation };
  rotation[axis] = (rotation[axis] ?? 0) + degrees;
  const issues = validatePartChange(project, String(part.id), { rotation });
  return { rotation, issues, ok: issues.every((i) => i.severity !== 'error') };
}

/**
 * Масштаб в сцене (§60).
 *
 * Реальные размеры детали изменять масштабом нельзя: размеры задаются
 * параметрами. Функция возвращает масштаб только для вспомогательных узлов.
 */
export function allowedScale(node: SceneNode, scale: number): number {
  const auxiliary = node.kind !== 'PART' && node.kind !== 'MODULE' && node.kind !== 'CABINET';
  return auxiliary ? scale : 1;
}

/** Габарит детали в мировых координатах — для гизмо и рамок (§132). */
export function partBounds(part: Part): ReturnType<typeof partWorldAABB> {
  return partWorldAABB(part);
}
