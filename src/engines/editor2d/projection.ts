/**
 * Проекция мировых координат на плоскость технического вида (§8, §92–§99).
 *
 * Соглашение осей проекта: X — ширина, Y — высота, Z — глубина, мм.
 * Все три вида ОРТОГРАФИЧЕСКИЕ (§98), свободной перспективы у технических
 * видов нет (§99):
 *
 *   TOP   — вид сверху:  горизонталь X (ширина), вертикаль Z (глубина);
 *   FRONT — вид спереди: горизонталь X (ширина), вертикаль Y (высота);
 *   SIDE  — вид сбоку:   горизонталь Z (глубина), вертикаль Y (высота).
 *
 * Экранные координаты НИКОГДА не попадают в ProjectModel (§8): всё, что
 * записывается в модель, выражено в мировых миллиметрах.
 */
import type { AABB } from '@/core/geometry/partGeometry';
import type { Mm } from '@/core/model/types';
import type { Bounds2D, EditorEntity, Rect2D, ViewPlane } from './types';

/** Подписи осей вида — для линеек и подсказок (§14/§94/§95). */
export const PLANE_AXES: Record<ViewPlane, { h: 'X' | 'Y' | 'Z'; v: 'X' | 'Y' | 'Z'; title: string }> = {
  TOP: { h: 'X', v: 'Z', title: 'Сверху — ширина × глубина' },
  FRONT: { h: 'X', v: 'Y', title: 'Спереди — ширина × высота' },
  SIDE: { h: 'Z', v: 'Y', title: 'Сбоку — глубина × высота' },
};

/** Спроецировать точку мира на плоскость вида. */
export function projectPoint(
  point: { x: number; y: number; z: number },
  plane: ViewPlane,
): { x: Mm; y: Mm } {
  switch (plane) {
    case 'TOP':
      return { x: point.x, y: point.z };
    case 'SIDE':
      return { x: point.z, y: point.y };
    case 'FRONT':
    default:
      return { x: point.x, y: point.y };
  }
}

/**
 * Вернуть точку мира из координат вида. Третья координата берётся из
 * `reference` — вид её не задаёт, и придумывать её нельзя.
 */
export function unprojectPoint(
  point: { x: Mm; y: Mm },
  plane: ViewPlane,
  reference: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  switch (plane) {
    case 'TOP':
      return { x: point.x, y: reference.y, z: point.y };
    case 'SIDE':
      return { x: reference.x, y: point.y, z: point.x };
    case 'FRONT':
    default:
      return { x: point.x, y: point.y, z: reference.z };
  }
}

/** Габаритный прямоугольник мирового AABB на плоскости вида. */
export function projectAABB(box: AABB, plane: ViewPlane): Rect2D {
  const a = projectPoint({ x: box.min.x, y: box.min.y, z: box.min.z }, plane);
  const b = projectPoint({ x: box.max.x, y: box.max.y, z: box.max.z }, plane);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Какая мировая ось соответствует горизонтали и вертикали вида. */
export function planeAxisKeys(plane: ViewPlane): { h: 'x' | 'y' | 'z'; v: 'x' | 'y' | 'z' } {
  switch (plane) {
    case 'TOP':
      return { h: 'x', v: 'z' };
    case 'SIDE':
      return { h: 'z', v: 'y' };
    case 'FRONT':
    default:
      return { h: 'x', v: 'y' };
  }
}

/** Параметры камеры 2D-вида. */
export interface Viewport {
  /** Пикселей на миллиметр. */
  zoom: number;
  /** Мировая координата левого края области, мм. */
  panX: Mm;
  /** Мировая координата НИЖНЕГО края области, мм. */
  panY: Mm;
  /** Размер области отображения, пикселей. */
  widthPx: number;
  heightPx: number;
}

/**
 * Мировые координаты → экранные. Ось Y экрана направлена вниз, поэтому
 * вертикаль переворачивается: на техническом виде верх должен быть сверху.
 */
export function worldToScreen(point: { x: Mm; y: Mm }, view: Viewport): { x: number; y: number } {
  return {
    x: (point.x - view.panX) * view.zoom,
    y: view.heightPx - (point.y - view.panY) * view.zoom,
  };
}

/** Экранные координаты → мировые (§8: обратное преобразование без потерь). */
export function screenToWorld(point: { x: number; y: number }, view: Viewport): { x: Mm; y: Mm } {
  return {
    x: point.x / view.zoom + view.panX,
    y: (view.heightPx - point.y) / view.zoom + view.panY,
  };
}

/** Видимая область в мировых координатах, мм. */
export function visibleBounds(view: Viewport): Bounds2D {
  return {
    minX: view.panX,
    minY: view.panY,
    maxX: view.panX + view.widthPx / view.zoom,
    maxY: view.panY + view.heightPx / view.zoom,
  };
}

/** Пересекаются ли прямоугольник и область. */
export function rectIntersects(rect: Rect2D, bounds: Bounds2D): boolean {
  return (
    rect.x <= bounds.maxX &&
    rect.x + rect.width >= bounds.minX &&
    rect.y <= bounds.maxY &&
    rect.y + rect.height >= bounds.minY
  );
}

/** Полностью ли прямоугольник внутри области (для выделения рамкой, §19). */
export function rectContains(rect: Rect2D, bounds: Bounds2D): boolean {
  return (
    rect.x >= bounds.minX &&
    rect.y >= bounds.minY &&
    rect.x + rect.width <= bounds.maxX &&
    rect.y + rect.height <= bounds.maxY
  );
}

/**
 * Отсечение по видимой области (§127/§128): на холст попадают только те
 * сущности, что реально видны. На проекте в тысячи деталей это и есть
 * виртуализация — рисуется десяток объектов вместо тысячи.
 */
export function cullEntities(entities: EditorEntity[], view: Viewport): EditorEntity[] {
  const bounds = visibleBounds(view);
  return entities.filter((e) => rectIntersects(rectOf(e), bounds));
}

/** Прямоугольник сущности. */
export function rectOf(entity: EditorEntity): Rect2D {
  const t = entity.transform;
  return { x: t.x, y: t.y, width: t.width, height: t.height };
}

/** Границы набора сущностей (§89–§91). */
export function boundsOf(entities: EditorEntity[]): Bounds2D | null {
  if (entities.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of entities) {
    const r = rectOf(e);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Камера, при которой заданные границы вписаны в область (§89–§91).
 * `padding` — доля свободного места по краям.
 */
export function fitBounds(
  bounds: Bounds2D,
  widthPx: number,
  heightPx: number,
  padding = 0.08,
): { zoom: number; panX: Mm; panY: Mm } {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = Math.min(widthPx / w, heightPx / h) * (1 - padding * 2);
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  // Центрируем: свободное место делится поровну между краями.
  const panX = bounds.minX - (widthPx / safeZoom - w) / 2;
  const panY = bounds.minY - (heightPx / safeZoom - h) / 2;
  return { zoom: safeZoom, panX, panY };
}

/** Зум относительно точки экрана: точка под курсором остаётся на месте. */
export function zoomAt(view: Viewport, factor: number, screen: { x: number; y: number }): Viewport {
  const before = screenToWorld(screen, view);
  const zoom = Math.max(0.005, Math.min(20, view.zoom * factor));
  const after = screenToWorld(screen, { ...view, zoom });
  return { ...view, zoom, panX: view.panX + (before.x - after.x), panY: view.panY + (before.y - after.y) };
}
