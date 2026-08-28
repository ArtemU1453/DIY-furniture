/**
 * Выравнивание, распределение и уравнивание размеров (§40–§43).
 *
 * Функции чистые: они считают ЦЕЛЕВЫЕ координаты и размеры, а записывает их в
 * ProjectModel вызывающий код одной транзакцией (§124). Заблокированные и
 * скрытые объекты не двигаются (§85/§86).
 */
import { rectOf } from './projection';
import type { EditorEntity, Rect2D } from './types';

export type AlignMode = 'LEFT' | 'CENTER' | 'RIGHT' | 'TOP' | 'MIDDLE' | 'BOTTOM';

/** Целевое положение сущности: entityId → новое начало прямоугольника. */
export type PlacementPatch = Record<string, { x?: number; y?: number }>;

/** Целевой размер сущности: entityId → новые габариты. */
export type SizePatch = Record<string, { width?: number; height?: number }>;

const movable = (entities: EditorEntity[]): EditorEntity[] =>
  entities.filter((e) => !e.locked && !e.hidden);

function bounds(rects: Rect2D[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...rects.map((r) => r.x)),
    minY: Math.min(...rects.map((r) => r.y)),
    maxX: Math.max(...rects.map((r) => r.x + r.width)),
    maxY: Math.max(...rects.map((r) => r.y + r.height)),
  };
}

/**
 * Выравнивание (§40). Опорой служит общий габарит выделения: так «выровнять
 * по левому краю» означает «по левому краю самого левого объекта», а не по
 * случайно выбранному объекту.
 */
export function alignEntities(entities: EditorEntity[], mode: AlignMode): PlacementPatch {
  const list = movable(entities);
  if (list.length < 2) return {};
  const rects = list.map(rectOf);
  const b = bounds(rects);
  const patch: PlacementPatch = {};

  list.forEach((entity, i) => {
    const r = rects[i];
    switch (mode) {
      case 'LEFT':
        patch[entity.entityId] = { x: b.minX };
        break;
      case 'RIGHT':
        patch[entity.entityId] = { x: b.maxX - r.width };
        break;
      case 'CENTER':
        patch[entity.entityId] = { x: (b.minX + b.maxX) / 2 - r.width / 2 };
        break;
      case 'BOTTOM':
        patch[entity.entityId] = { y: b.minY };
        break;
      case 'TOP':
        patch[entity.entityId] = { y: b.maxY - r.height };
        break;
      case 'MIDDLE':
        patch[entity.entityId] = { y: (b.minY + b.maxY) / 2 - r.height / 2 };
        break;
    }
  });
  return patch;
}

/**
 * Равномерное распределение (§41). Крайние объекты остаются на месте, промежутки
 * между остальными делаются равными: именно так это делают графические
 * редакторы, и именно этого ждут при расстановке модулей в ряд.
 */
export function distributeEntities(entities: EditorEntity[], axis: 'x' | 'y'): PlacementPatch {
  const list = movable(entities);
  if (list.length < 3) return {};

  const sorted = [...list].sort((a, b) => {
    const ra = rectOf(a), rb = rectOf(b);
    return (axis === 'x' ? ra.x - rb.x : ra.y - rb.y) || a.entityId.localeCompare(b.entityId);
  });

  const rects = sorted.map(rectOf);
  const sizeKey = axis === 'x' ? 'width' : 'height';
  const first = rects[0];
  const last = rects[rects.length - 1];
  const start = axis === 'x' ? first.x : first.y;
  const end = (axis === 'x' ? last.x : last.y) + last[sizeKey];
  const totalSize = rects.reduce((s, r) => s + r[sizeKey], 0);
  const gap = (end - start - totalSize) / (rects.length - 1);

  const patch: PlacementPatch = {};
  let cursor = start;
  sorted.forEach((entity, i) => {
    const r = rects[i];
    if (i > 0 && i < sorted.length - 1) {
      patch[entity.entityId] = axis === 'x' ? { x: cursor } : { y: cursor };
    }
    cursor += r[sizeKey] + gap;
  });
  return patch;
}

/**
 * Уравнять размеры (§42). Эталон — активная (последняя выбранная) сущность:
 * пользователь выбирает образец последним, как в графических редакторах.
 */
export function equalSize(
  entities: EditorEntity[],
  axis: 'width' | 'height',
  referenceId?: string,
): SizePatch {
  const list = movable(entities);
  if (list.length < 2) return {};
  const reference = list.find((e) => e.entityId === referenceId) ?? list[list.length - 1];
  const value = axis === 'width' ? reference.transform.width : reference.transform.height;
  const patch: SizePatch = {};
  for (const entity of list) {
    if (entity.entityId === reference.entityId) continue;
    patch[entity.entityId] = { [axis]: value };
  }
  return patch;
}

/** Центрировать внутри владельца (§43). */
export function centerInParent(
  entities: EditorEntity[],
  parent: EditorEntity,
  axis: 'horizontal' | 'vertical',
): PlacementPatch {
  const p = rectOf(parent);
  const patch: PlacementPatch = {};
  for (const entity of movable(entities)) {
    if (entity.entityId === parent.entityId) continue;
    const r = rectOf(entity);
    patch[entity.entityId] =
      axis === 'horizontal'
        ? { x: p.x + (p.width - r.width) / 2 }
        : { y: p.y + (p.height - r.height) / 2 };
  }
  return patch;
}

/** Сдвиг всех выбранных на дельту (§22–§24). */
export function translateEntities(entities: EditorEntity[], dx: number, dy: number): PlacementPatch {
  const patch: PlacementPatch = {};
  for (const entity of movable(entities)) {
    const r = rectOf(entity);
    patch[entity.entityId] = { x: r.x + dx, y: r.y + dy };
  }
  return patch;
}

/** Шаг точного перемещения стрелками (§23/§24). */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;

export function nudgeDelta(key: string, shift: boolean): { dx: number; dy: number } | null {
  const step = shift ? NUDGE_STEP_LARGE : NUDGE_STEP;
  switch (key) {
    case 'ArrowLeft': return { dx: -step, dy: 0 };
    case 'ArrowRight': return { dx: step, dy: 0 };
    case 'ArrowUp': return { dx: 0, dy: step };
    case 'ArrowDown': return { dx: 0, dy: -step };
    default: return null;
  }
}
