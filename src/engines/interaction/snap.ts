/**
 * Система привязок (§111–§118) — общая для 2D и 3D.
 *
 * Привязка работает по ОСЯМ: кандидат — это «интересная» координата вдоль оси
 * (край детали, её центр, угол, середина ребра, направляющая, узел сетки).
 * Такой вид одинаково пригоден и для плоского вида, и для трёх измерений,
 * поэтому второй системы привязок для 3D не появляется — 2D-движок этапа 26
 * продолжает работать со своими кандидатами, а здесь они обобщены на Z.
 *
 * ПРИОРИТЕТ (§112): точные точки важнее площадей, площади важнее сетки.
 * При равном расстоянии побеждает более приоритетный вид привязки — результат
 * детерминирован и не зависит от порядка деталей в проекте.
 */
import type { Part, Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { partWorldAABB } from '@/core/geometry/partGeometry';

export type SnapAxis = 'x' | 'y' | 'z';

/** Виды привязки (§111). */
export type SnapKind3D = 'endpoint' | 'midpoint' | 'center' | 'edge' | 'face' | 'guide' | 'grid';

/** Порядок приоритета (§112): чем меньше индекс, тем важнее. */
export const SNAP_PRIORITY: SnapKind3D[] = [
  'endpoint', 'midpoint', 'center', 'edge', 'face', 'guide', 'grid',
];

export function snapRank(kind: SnapKind3D): number {
  const index = SNAP_PRIORITY.indexOf(kind);
  return index < 0 ? SNAP_PRIORITY.length : index;
}

export interface SnapCandidate3D {
  axis: SnapAxis;
  /** Мировая координата, к которой притягивает, мм. */
  value: number;
  kind: SnapKind3D;
  /** Объект-источник — для подсветки в предпросмотре (§113). */
  sourceId?: string;
  label?: string;
}

/** Направляющая: плоскость, перпендикулярная оси (§58–§62). */
export interface Guide3D {
  id: string;
  axis: SnapAxis;
  /** Координата плоскости, мм. */
  position: number;
  locked?: boolean;
  label?: string;
}

export interface SnapSettings3D {
  enabled: boolean;
  toGrid: boolean;
  toParts: boolean;
  toGuides: boolean;
  toFaces: boolean;
  /** Шаг сетки, мм (§16/§17). */
  gridSize: number;
  /** Радиус срабатывания, мм (§118). */
  tolerance: number;
}

export const DEFAULT_SNAP_3D: SnapSettings3D = {
  enabled: true,
  toGrid: true,
  toParts: true,
  toGuides: true,
  toFaces: true,
  gridSize: 10,
  tolerance: 12,
};

/** Шаги сетки, доступные пользователю (§17). */
export const GRID_STEPS_3D = [1, 5, 10, 20, 50, 100];

/** Округление до шага сетки (§16). */
export function snapToGridValue(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

/**
 * Кандидаты от деталей (§115/§116/§117): грани (edge), центр (center), углы
 * габарита (endpoint) и середины рёбер (midpoint). Перемещаемые детали в
 * кандидаты не попадают — иначе объект притягивался бы сам к себе.
 */
export function partCandidates(parts: Part[], excludeIds: string[] = []): SnapCandidate3D[] {
  const skip = new Set(excludeIds);
  const out: SnapCandidate3D[] = [];
  for (const part of parts) {
    if (skip.has(String(part.id))) continue;
    const box = partWorldAABB(part);
    const id = String(part.id);
    const axes: SnapAxis[] = ['x', 'y', 'z'];
    for (const axis of axes) {
      const min = box.min[axis];
      const max = box.max[axis];
      out.push(
        { axis, value: min, kind: 'edge', sourceId: id, label: part.name },
        { axis, value: max, kind: 'edge', sourceId: id, label: part.name },
        { axis, value: (min + max) / 2, kind: 'center', sourceId: id, label: part.name },
      );
    }
    // Углы габарита — точные точки, приоритетнее граней.
    for (const x of [box.min.x, box.max.x]) out.push({ axis: 'x', value: x, kind: 'endpoint', sourceId: id });
    for (const y of [box.min.y, box.max.y]) out.push({ axis: 'y', value: y, kind: 'endpoint', sourceId: id });
    for (const z of [box.min.z, box.max.z]) out.push({ axis: 'z', value: z, kind: 'endpoint', sourceId: id });
    // Середины рёбер.
    out.push({ axis: 'x', value: (box.min.x + box.max.x) / 2, kind: 'midpoint', sourceId: id });
    out.push({ axis: 'y', value: (box.min.y + box.max.y) / 2, kind: 'midpoint', sourceId: id });
    out.push({ axis: 'z', value: (box.min.z + box.max.z) / 2, kind: 'midpoint', sourceId: id });
  }
  return out;
}

/** Привязка к поверхности детали (§117): плоскость грани по нормали оси. */
export function faceCandidates(parts: Part[], excludeIds: string[] = []): SnapCandidate3D[] {
  const skip = new Set(excludeIds);
  const out: SnapCandidate3D[] = [];
  for (const part of parts) {
    if (skip.has(String(part.id))) continue;
    const box = partWorldAABB(part);
    const id = String(part.id);
    out.push(
      { axis: 'x', value: box.min.x, kind: 'face', sourceId: id },
      { axis: 'x', value: box.max.x, kind: 'face', sourceId: id },
      { axis: 'y', value: box.min.y, kind: 'face', sourceId: id },
      { axis: 'y', value: box.max.y, kind: 'face', sourceId: id },
      { axis: 'z', value: box.min.z, kind: 'face', sourceId: id },
      { axis: 'z', value: box.max.z, kind: 'face', sourceId: id },
    );
  }
  return out;
}

export function guideCandidates3D(guides: Guide3D[]): SnapCandidate3D[] {
  return guides.map((g) => ({ axis: g.axis, value: g.position, kind: 'guide' as const, sourceId: g.id, label: g.label }));
}

export interface SnapContext3D {
  project: Project;
  guides: Guide3D[];
  settings: SnapSettings3D;
  /** Что перемещается: эти детали не участвуют как источники привязки. */
  excludeIds?: string[];
}

/** Все кандидаты контекста — из них выбирается ближайший (§112). */
export function collectCandidates(ctx: SnapContext3D): SnapCandidate3D[] {
  const { settings } = ctx;
  if (!settings.enabled) return [];
  const parts = allParts(ctx.project);
  const out: SnapCandidate3D[] = [];
  if (settings.toParts) out.push(...partCandidates(parts, ctx.excludeIds));
  if (settings.toFaces) out.push(...faceCandidates(parts, ctx.excludeIds));
  if (settings.toGuides) out.push(...guideCandidates3D(ctx.guides));
  return out;
}

export interface SnapMatch {
  /** Итоговая координата, мм. */
  value: number;
  /** Сработавшая привязка; null — привязка не нашлась. */
  candidate: SnapCandidate3D | null;
  /** Насколько объект «притянуло», мм (§114). */
  pull: number;
}

/**
 * Ближайшая привязка по одной оси (§112/§114).
 *
 * Сетка проверяется отдельно и последней: она есть всегда, поэтому иначе
 * заслоняла бы более осмысленные привязки к деталям и направляющим.
 */
export function snapAxis(
  value: number,
  axis: SnapAxis,
  candidates: SnapCandidate3D[],
  settings: SnapSettings3D,
): SnapMatch {
  if (!settings.enabled) return { value, candidate: null, pull: 0 };

  let best: SnapCandidate3D | null = null;
  let bestDelta = settings.tolerance;
  for (const candidate of candidates) {
    if (candidate.axis !== axis) continue;
    const delta = Math.abs(candidate.value - value);
    if (delta > settings.tolerance) continue;
    if (best === null || delta < bestDelta - 1e-9
      || (Math.abs(delta - bestDelta) < 1e-9 && snapRank(candidate.kind) < snapRank(best.kind))) {
      best = candidate;
      bestDelta = delta;
    }
  }
  if (best) return { value: best.value, candidate: best, pull: best.value - value };

  if (settings.toGrid) {
    const grid = snapToGridValue(value, settings.gridSize);
    if (Math.abs(grid - value) <= settings.tolerance) {
      return { value: grid, candidate: { axis, value: grid, kind: 'grid' }, pull: grid - value };
    }
  }
  return { value, candidate: null, pull: 0 };
}

export interface SnapPoint {
  x: number;
  y: number;
  z: number;
}

export interface SnapPointResult extends SnapPoint {
  /** Сработавшие привязки по осям — из них рисуется предпросмотр (§113). */
  matches: SnapCandidate3D[];
}

/** Привязка точки по всем трём осям. */
export function snapPoint(point: SnapPoint, ctx: SnapContext3D): SnapPointResult {
  const candidates = collectCandidates(ctx);
  const x = snapAxis(point.x, 'x', candidates, ctx.settings);
  const y = snapAxis(point.y, 'y', candidates, ctx.settings);
  const z = snapAxis(point.z, 'z', candidates, ctx.settings);
  return {
    x: x.value, y: y.value, z: z.value,
    matches: [x.candidate, y.candidate, z.candidate].filter((c): c is SnapCandidate3D => Boolean(c)),
  };
}

/**
 * Предпросмотр привязки до завершения операции (§113). Возвращает, куда
 * встанет объект и чем это вызвано, ничего не меняя в модели.
 */
export interface SnapPreview {
  target: SnapPoint;
  matches: SnapCandidate3D[];
  /** Человеческое описание: «край детали «Боковина левая»». */
  description: string;
}

const KIND_LABEL: Record<SnapKind3D, string> = {
  endpoint: 'угол',
  midpoint: 'середина ребра',
  center: 'центр',
  edge: 'край',
  face: 'поверхность',
  guide: 'направляющая',
  grid: 'сетка',
};

export function describeSnap(matches: SnapCandidate3D[]): string {
  if (matches.length === 0) return 'без привязки';
  return matches
    .map((m) => (m.label ? `${KIND_LABEL[m.kind]} «${m.label}»` : KIND_LABEL[m.kind]))
    .join(', ');
}

export function snapPreview(point: SnapPoint, ctx: SnapContext3D): SnapPreview {
  const result = snapPoint(point, ctx);
  return {
    target: { x: result.x, y: result.y, z: result.z },
    matches: result.matches,
    description: describeSnap(result.matches),
  };
}
