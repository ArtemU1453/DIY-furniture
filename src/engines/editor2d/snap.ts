/**
 * Привязки и умные направляющие (§11–§13, §45–§48).
 *
 * Привязка возвращает не только новую координату, но и то, ЧЕМ она вызвана:
 * из этого рисуются направляющие (§46) и подписи расстояний (§45). Радиус
 * срабатывания задаётся пользователем и меряется в миллиметрах модели, а не
 * в пикселях — иначе на разном зуме привязка вела бы себя по-разному.
 */
import { rectOf } from './projection';
import type { EditorEntity, Guide2D, Rect2D, SnapSettings } from './types';

/** Тип совпадения, вызвавшего привязку. */
export type SnapKind = 'grid' | 'edge' | 'center' | 'corner' | 'guide' | 'extension';

export interface SnapCandidate {
  axis: 'x' | 'y';
  /** Мировая координата, к которой притягивает. */
  value: number;
  kind: SnapKind;
  /** Идентификатор объекта-источника (для подсветки). */
  sourceId?: string;
}

export interface SnapResult {
  x: number;
  y: number;
  /** Сработавшие привязки — по ним рисуются направляющие (§46). */
  matches: SnapCandidate[];
}

/** Округление до шага сетки (§11). */
export function snapValueToGrid(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

/**
 * Кандидаты привязки от соседних объектов (§12): края, центры и углы.
 * Сам перемещаемый объект в кандидаты не попадает.
 */
export function objectCandidates(entities: EditorEntity[], excludeIds: string[] = []): SnapCandidate[] {
  const skip = new Set(excludeIds);
  const out: SnapCandidate[] = [];
  for (const e of entities) {
    if (skip.has(e.entityId) || e.hidden) continue;
    const r = rectOf(e);
    out.push(
      { axis: 'x', value: r.x, kind: 'edge', sourceId: e.entityId },
      { axis: 'x', value: r.x + r.width, kind: 'edge', sourceId: e.entityId },
      { axis: 'x', value: r.x + r.width / 2, kind: 'center', sourceId: e.entityId },
      { axis: 'y', value: r.y, kind: 'edge', sourceId: e.entityId },
      { axis: 'y', value: r.y + r.height, kind: 'edge', sourceId: e.entityId },
      { axis: 'y', value: r.y + r.height / 2, kind: 'center', sourceId: e.entityId },
    );
  }
  return out;
}

/** Кандидаты от направляющих (§47). */
export function guideCandidates(guides: Guide2D[]): SnapCandidate[] {
  return guides.map((g) => ({
    axis: g.orientation === 'vertical' ? ('x' as const) : ('y' as const),
    value: g.position,
    kind: 'guide' as const,
    sourceId: g.id,
  }));
}

/** Ближайший кандидат по оси в пределах радиуса. */
function nearest(candidates: SnapCandidate[], axis: 'x' | 'y', value: number, distance: number): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestDelta = distance;
  for (const c of candidates) {
    if (c.axis !== axis) continue;
    const delta = Math.abs(c.value - value);
    if (delta <= bestDelta) {
      // При равенстве побеждает более ранний кандидат — результат детерминирован.
      if (best && delta === bestDelta) continue;
      best = c;
      bestDelta = delta;
    }
  }
  return best;
}

export interface SnapContext {
  settings: SnapSettings;
  gridStep: number;
  /** Соседние объекты — источники краёв, центров и углов. */
  entities: EditorEntity[];
  guides: Guide2D[];
  /** Объекты, которые сейчас перемещаются: сами себе привязкой не служат. */
  excludeIds?: string[];
}

/**
 * Привязать перемещаемый прямоугольник (§12/§47).
 *
 * Проверяются три опорные линии по каждой оси — левая, центр и правая, — и
 * побеждает самая близкая. Так объект прилипает и краем к краю, и центром к
 * центру, что и ожидается от умных направляющих.
 */
export function snapRect(rect: Rect2D, ctx: SnapContext): SnapResult {
  const { settings } = ctx;
  const candidates: SnapCandidate[] = [];
  if (settings.toObjects) candidates.push(...objectCandidates(ctx.entities, ctx.excludeIds));
  if (settings.toGuides) candidates.push(...guideCandidates(ctx.guides));

  const matches: SnapCandidate[] = [];
  let x = rect.x;
  let y = rect.y;

  const axes: Array<{ axis: 'x' | 'y'; anchors: Array<{ value: number; offset: number }> }> = [
    {
      axis: 'x',
      anchors: [
        { value: rect.x, offset: 0 },
        { value: rect.x + rect.width / 2, offset: rect.width / 2 },
        { value: rect.x + rect.width, offset: rect.width },
      ],
    },
    {
      axis: 'y',
      anchors: [
        { value: rect.y, offset: 0 },
        { value: rect.y + rect.height / 2, offset: rect.height / 2 },
        { value: rect.y + rect.height, offset: rect.height },
      ],
    },
  ];

  for (const { axis, anchors } of axes) {
    let bestDelta = Infinity;
    let bestValue: number | null = null;
    let bestMatch: SnapCandidate | null = null;

    for (const anchor of anchors) {
      const hit = nearest(candidates, axis, anchor.value, settings.distance);
      if (!hit) continue;
      const delta = Math.abs(hit.value - anchor.value);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestValue = hit.value - anchor.offset;
        bestMatch = hit;
      }
    }

    if (bestValue !== null && bestMatch) {
      if (axis === 'x') x = bestValue; else y = bestValue;
      matches.push(bestMatch);
      continue;
    }

    // Сетка — привязка последней очереди: объекты и направляющие важнее.
    if (settings.toGrid) {
      const base = axis === 'x' ? rect.x : rect.y;
      const snapped = snapValueToGrid(base, ctx.gridStep);
      if (Math.abs(snapped - base) <= settings.distance) {
        if (axis === 'x') x = snapped; else y = snapped;
        matches.push({ axis, value: snapped, kind: 'grid' });
      }
    }
  }

  return { x, y, matches };
}

/** Привязать одиночную координату (используется при изменении размера, §148). */
export function snapCoordinate(value: number, axis: 'x' | 'y', ctx: SnapContext): { value: number; match: SnapCandidate | null } {
  const candidates: SnapCandidate[] = [];
  if (ctx.settings.toObjects) candidates.push(...objectCandidates(ctx.entities, ctx.excludeIds));
  if (ctx.settings.toGuides) candidates.push(...guideCandidates(ctx.guides));
  const hit = nearest(candidates, axis, value, ctx.settings.distance);
  if (hit) return { value: hit.value, match: hit };
  if (ctx.settings.toGrid) {
    const snapped = snapValueToGrid(value, ctx.gridStep);
    if (Math.abs(snapped - value) <= ctx.settings.distance) {
      return { value: snapped, match: { axis, value: snapped, kind: 'grid' } };
    }
  }
  return { value, match: null };
}

/** Расстояние между двумя прямоугольниками по оси (§45). Отрицательное — перекрытие. */
export function gapBetween(a: Rect2D, b: Rect2D, axis: 'x' | 'y'): number {
  if (axis === 'x') return Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  return Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
}

/** Подпись расстояния до соседа (§45). */
export interface DistanceHint {
  axis: 'x' | 'y';
  distance: number;
  fromId: string;
  toId: string;
}

/**
 * Расстояния от перемещаемого объекта до ближайших соседей по обеим осям
 * (§45). Возвращаются только соседи, с которыми объект пересекается по
 * другой оси: измерять расстояние до объекта «наискосок» бессмысленно.
 */
export function distanceHints(
  moving: EditorEntity,
  entities: EditorEntity[],
  limit = 2,
): DistanceHint[] {
  const a = rectOf(moving);
  const hints: DistanceHint[] = [];
  for (const axis of ['x', 'y'] as const) {
    const cross = axis === 'x' ? 'y' : 'x';
    const near: DistanceHint[] = [];
    for (const other of entities) {
      if (other.entityId === moving.entityId || other.hidden) continue;
      const b = rectOf(other);
      const overlapCross = gapBetween(a, b, cross) < 0;
      if (!overlapCross) continue;
      const d = gapBetween(a, b, axis);
      if (d < 0) continue; // перекрытие — не расстояние
      near.push({ axis, distance: d, fromId: moving.entityId, toId: other.entityId });
    }
    near.sort((p, q) => p.distance - q.distance || p.toId.localeCompare(q.toId));
    hints.push(...near.slice(0, limit));
  }
  return hints;
}

/**
 * Направляющая-продолжение линии (§46): объекты, у которых край лежит на той
 * же координате, что и край перемещаемого. Их и подсвечивает редактор.
 */
export function extensionGuides(moving: Rect2D, entities: EditorEntity[], tolerance = 0.5): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  const edgesX = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const edgesY = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];
  for (const e of entities) {
    if (e.hidden) continue;
    const r = rectOf(e);
    for (const value of [r.x, r.x + r.width / 2, r.x + r.width]) {
      if (edgesX.some((v) => Math.abs(v - value) <= tolerance)) {
        out.push({ axis: 'x', value, kind: 'extension', sourceId: e.entityId });
      }
    }
    for (const value of [r.y, r.y + r.height / 2, r.y + r.height]) {
      if (edgesY.some((v) => Math.abs(v - value) <= tolerance)) {
        out.push({ axis: 'y', value, kind: 'extension', sourceId: e.entityId });
      }
    }
  }
  return out;
}
