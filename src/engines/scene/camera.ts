/**
 * Камера сцены (§47–§55, §160).
 *
 * Состояние камеры — часть вида, а не модели (§148): оно сохраняется локально
 * и никогда не влияет на производственные данные.
 */
import type { FurnitureScene } from './types';
import { visibleNodes, type SceneVisibility } from './visibility';

/** Стандартные виды (§49). */
export type SceneView = 'FRONT' | 'BACK' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM' | 'ISO';

export const SCENE_VIEWS: SceneView[] = ['FRONT', 'BACK', 'LEFT', 'RIGHT', 'TOP', 'BOTTOM', 'ISO'];

export const SCENE_VIEW_LABELS: Record<SceneView, string> = {
  FRONT: 'Спереди',
  BACK: 'Сзади',
  LEFT: 'Слева',
  RIGHT: 'Справа',
  TOP: 'Сверху',
  BOTTOM: 'Снизу',
  ISO: 'Изометрия',
};

/** Направление взгляда для каждого вида — единичный вектор от цели к камере. */
export const VIEW_DIRECTIONS: Record<SceneView, { x: number; y: number; z: number }> = {
  FRONT: { x: 0, y: 0, z: 1 },
  BACK: { x: 0, y: 0, z: -1 },
  LEFT: { x: -1, y: 0, z: 0 },
  RIGHT: { x: 1, y: 0, z: 0 },
  TOP: { x: 0, y: 1, z: 0 },
  BOTTOM: { x: 0, y: -1, z: 0 },
  ISO: { x: 0.577, y: 0.577, z: 0.577 },
};

/** Горячие клавиши видов (§139). */
export const VIEW_HOTKEY: Record<string, SceneView> = {
  '1': 'FRONT', '2': 'BACK', '3': 'LEFT', '4': 'RIGHT', '5': 'TOP', '6': 'BOTTOM', '7': 'ISO',
};

export interface CameraState {
  view: SceneView;
  /** Точка, вокруг которой вращается камера, мм. */
  target: { x: number; y: number; z: number };
  /** Расстояние до цели, мм. */
  distance: number;
}

export const HOME_CAMERA: CameraState = {
  view: 'ISO',
  target: { x: 0, y: 0, z: 0 },
  distance: 3000,
};

export interface SceneBounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  center: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
}

/** Габарит видимой части сцены (§48). */
export function sceneBounds(scene: FurnitureScene, visibility?: SceneVisibility): SceneBounds {
  const nodes = (visibility ? visibleNodes(scene, visibility) : scene.order.map((id) => scene.nodes[id]))
    .filter((n) => n.kind === 'PART');
  if (nodes.length === 0) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
      center: { x: 0, y: 0, z: 0 },
      size: { x: 0, y: 0, z: 0 },
    };
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const node of nodes) {
    const p = node.world.position;
    const s = node.size;
    min.x = Math.min(min.x, p.x - s.x / 2);
    min.y = Math.min(min.y, p.y - s.y / 2);
    min.z = Math.min(min.z, p.z - s.z / 2);
    max.x = Math.max(max.x, p.x + s.x / 2);
    max.y = Math.max(max.y, p.y + s.y / 2);
    max.z = Math.max(max.z, p.z + s.z / 2);
  }
  return {
    min,
    max,
    center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
  };
}

/**
 * Вписать модель в кадр (§48).
 *
 * Пустой проект (§161) не ломает камеру: она просто остаётся в домашнем
 * положении.
 */
export function fitModel(scene: FurnitureScene, state: CameraState, visibility?: SceneVisibility): CameraState {
  const bounds = sceneBounds(scene, visibility);
  const diagonal = Math.hypot(bounds.size.x, bounds.size.y, bounds.size.z);
  if (diagonal === 0) return { ...state, target: { ...HOME_CAMERA.target }, distance: HOME_CAMERA.distance };
  return {
    ...state,
    target: { ...bounds.center },
    // Полтора габарита — модель видна целиком и не упирается в края кадра.
    distance: Math.max(300, diagonal * 1.5),
  };
}

/** Переключить стандартный вид (§49/§51). */
export function setView(state: CameraState, view: SceneView): CameraState {
  return { ...state, view };
}

/** Домашний вид (§160). */
export function homeView(scene: FurnitureScene): CameraState {
  return fitModel(scene, { ...HOME_CAMERA, target: { ...HOME_CAMERA.target } });
}

/** Позиция камеры для текущего вида (§47/§49). */
export function cameraPosition(state: CameraState): { x: number; y: number; z: number } {
  const dir = VIEW_DIRECTIONS[state.view];
  return {
    x: state.target.x + dir.x * state.distance,
    y: state.target.y + dir.y * state.distance,
    z: state.target.z + dir.z * state.distance,
  };
}

/** Грани View Cube (§50/§51). */
export const VIEW_CUBE_FACES: Array<{ face: string; view: SceneView; label: string }> = [
  { face: 'front', view: 'FRONT', label: 'Перед' },
  { face: 'back', view: 'BACK', label: 'Зад' },
  { face: 'left', view: 'LEFT', label: 'Лево' },
  { face: 'right', view: 'RIGHT', label: 'Право' },
  { face: 'top', view: 'TOP', label: 'Верх' },
  { face: 'bottom', view: 'BOTTOM', label: 'Низ' },
  { face: 'iso', view: 'ISO', label: 'Изо' },
];

/** Вид по нажатой грани куба (§51). */
export function viewOfCubeFace(face: string): SceneView | undefined {
  return VIEW_CUBE_FACES.find((f) => f.face === face)?.view;
}

/** Настройки сетки (§52/§53). */
export interface GridSettings {
  size: number;
  step: number;
}

export const DEFAULT_GRID: GridSettings = { size: 4000, step: 100 };

/** Привязка значения к сетке (§56). */
export function snapToGrid(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}
