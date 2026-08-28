/**
 * Ограничения конструкции (§58–§67).
 *
 * СОЗНАТЕЛЬНОЕ ОГРАНИЧЕНИЕ ОБЪЁМА (§65): полноценного CAD-решателя здесь нет
 * и не будет. Реализованы только детерминированные ограничения, каждое из
 * которых выражается одной подстановкой координаты. Решатель — прямой проход
 * по списку с фиксированным числом итераций: он либо сходится, либо честно
 * сообщает о конфликте (§66), но никогда не «дорешивает» модель наугад.
 *
 * При конфликте МОДЕЛЬ НЕ МЕНЯЕТСЯ (§66). Недостаток ограничений ошибкой не
 * считается (§67).
 */
import { rectOf } from './projection';
import type { EditorEntity, Rect2D } from './types';

export type ConstraintType =
  | 'HORIZONTAL'
  | 'VERTICAL'
  | 'COINCIDENT'
  | 'DISTANCE'
  | 'ALIGN'
  | 'CENTER';

export type ConstraintStatus = 'VALID' | 'WARNING' | 'ERROR' | 'SUPPRESSED';

/** Опорная линия объекта, к которой применяется ограничение. */
export type ConstraintAnchor = 'min' | 'center' | 'max';

/** Ограничение между двумя сущностями (§58/§59). */
export interface Constraint2D {
  id: string;
  type: ConstraintType;
  /** Ведущая сущность: её положение считается заданным. */
  a: string;
  /** Ведомая сущность: именно она сдвигается. */
  b: string;
  /** Ось, по которой действует ограничение. */
  axis: 'x' | 'y';
  /** Опорные линии сторон A и B. */
  anchorA?: ConstraintAnchor;
  anchorB?: ConstraintAnchor;
  /** Значение для DISTANCE, мм. */
  value?: number;
  /** Временно отключено (§64). */
  suppressed?: boolean;
  label?: string;
}

let counter = 0;

export function constraintId(): string {
  counter += 1;
  return `cst-${counter}`;
}

export function createConstraint(
  type: ConstraintType,
  a: string,
  b: string,
  options: Partial<Omit<Constraint2D, 'id' | 'type' | 'a' | 'b'>> & { id?: string } = {},
): Constraint2D {
  const axis = options.axis ?? defaultAxis(type);
  return {
    id: options.id ?? constraintId(),
    type,
    a,
    b,
    axis,
    anchorA: options.anchorA ?? defaultAnchor(type),
    anchorB: options.anchorB ?? defaultAnchor(type),
    value: options.value,
    suppressed: options.suppressed,
    label: options.label,
  };
}

function defaultAxis(type: ConstraintType): 'x' | 'y' {
  // HORIZONTAL выравнивает по горизонтали, значит управляет координатой Y.
  return type === 'HORIZONTAL' ? 'y' : 'x';
}

function defaultAnchor(type: ConstraintType): ConstraintAnchor {
  return type === 'CENTER' ? 'center' : 'min';
}

/** Координата опорной линии прямоугольника. */
export function anchorValue(rect: Rect2D, axis: 'x' | 'y', anchor: ConstraintAnchor): number {
  const start = axis === 'x' ? rect.x : rect.y;
  const size = axis === 'x' ? rect.width : rect.height;
  if (anchor === 'center') return start + size / 2;
  if (anchor === 'max') return start + size;
  return start;
}

/** Смещение опорной линии от начала прямоугольника. */
function anchorOffset(rect: Rect2D, axis: 'x' | 'y', anchor: ConstraintAnchor): number {
  const size = axis === 'x' ? rect.width : rect.height;
  if (anchor === 'center') return size / 2;
  if (anchor === 'max') return size;
  return 0;
}

/**
 * Требуемая координата начала прямоугольника B, чтобы ограничение выполнилось.
 * Возвращает null, если ограничение к паре неприменимо.
 */
export function targetFor(constraint: Constraint2D, a: Rect2D, b: Rect2D): number | null {
  const axis = constraint.axis;
  const anchorA = constraint.anchorA ?? 'min';
  const anchorB = constraint.anchorB ?? 'min';
  const va = anchorValue(a, axis, anchorA);
  const offset = anchorOffset(b, axis, anchorB);

  switch (constraint.type) {
    case 'HORIZONTAL':
    case 'VERTICAL':
    case 'ALIGN':
    case 'COINCIDENT':
      return va - offset;
    case 'CENTER':
      return anchorValue(a, axis, 'center') - (axis === 'x' ? b.width : b.height) / 2;
    case 'DISTANCE': {
      const distance = constraint.value;
      if (distance == null || !Number.isFinite(distance)) return null;
      return va + distance - offset;
    }
    default:
      return null;
  }
}

const EPS = 1e-6;

/** Выполнено ли ограничение на текущем расположении. */
export function isSatisfied(constraint: Constraint2D, a: Rect2D, b: Rect2D): boolean {
  const target = targetFor(constraint, a, b);
  if (target === null) return false;
  const current = constraint.axis === 'x' ? b.x : b.y;
  return Math.abs(current - target) <= 1e-3;
}

export interface ConstraintIssue {
  constraintId: string;
  status: ConstraintStatus;
  message: string;
}

export interface SolveResult {
  /** Новые координаты начала прямоугольников: entityId → {x, y}. */
  positions: Record<string, { x: number; y: number }>;
  issues: ConstraintIssue[];
  /** Сошёлся ли решатель. */
  ok: boolean;
  /** Конструкция переопределена — конфликтующие ограничения (§66). */
  overconstrained: boolean;
  /** Ограничения, которые ничего не фиксируют (§67) — не ошибка. */
  underconstrained: boolean;
}

const MAX_ITERATIONS = 24;

/**
 * Решатель (§65). Прямые подстановки с ограниченным числом итераций.
 *
 * Каждое ограничение задаёт координату ведомого объекта; если два активных
 * ограничения требуют от одного объекта разных координат по одной оси —
 * это конфликт, и решатель останавливается, НЕ трогая модель (§66).
 */
export function solveConstraints(
  entities: EditorEntity[],
  constraints: Constraint2D[],
): SolveResult {
  const rects = new Map<string, Rect2D>(entities.map((e) => [e.entityId, { ...rectOf(e) }]));
  const issues: ConstraintIssue[] = [];
  const active = constraints.filter((c) => !c.suppressed);

  for (const c of constraints) {
    if (c.suppressed) {
      issues.push({ constraintId: c.id, status: 'SUPPRESSED', message: 'Ограничение отключено.' });
      continue;
    }
    if (!rects.has(c.a) || !rects.has(c.b)) {
      issues.push({
        constraintId: c.id,
        status: 'ERROR',
        message: 'Ограничение ссылается на отсутствующий объект.',
      });
    }
  }

  // Конфликт по построению: два ограничения управляют одной осью одного объекта.
  const controllers = new Map<string, Constraint2D[]>();
  for (const c of active) {
    if (!rects.has(c.a) || !rects.has(c.b)) continue;
    const key = `${c.b}:${c.axis}`;
    (controllers.get(key) ?? controllers.set(key, []).get(key)!).push(c);
  }

  let overconstrained = false;
  for (const [key, list] of controllers) {
    if (list.length < 2) continue;
    const targets = list.map((c) => targetFor(c, rects.get(c.a)!, rects.get(c.b)!));
    const finite = targets.filter((t): t is number => t !== null);
    const conflicting = finite.some((t) => Math.abs(t - finite[0]) > 1e-3);
    if (conflicting) {
      overconstrained = true;
      for (const c of list) {
        issues.push({
          constraintId: c.id,
          status: 'ERROR',
          message: `Конструкция имеет конфликтующие ограничения (${key}).`,
        });
      }
    }
  }

  if (overconstrained) {
    // §66: модель не меняется. Возвращаются исходные координаты.
    return {
      positions: Object.fromEntries([...rects].map(([id, r]) => [id, { x: r.x, y: r.y }])),
      issues,
      ok: false,
      overconstrained: true,
      underconstrained: false,
    };
  }

  let converged = false;
  for (let iteration = 0; iteration < MAX_ITERATIONS && !converged; iteration++) {
    converged = true;
    for (const c of active) {
      const a = rects.get(c.a);
      const b = rects.get(c.b);
      if (!a || !b) continue;
      const target = targetFor(c, a, b);
      if (target === null) continue;
      const current = c.axis === 'x' ? b.x : b.y;
      if (Math.abs(current - target) > EPS) {
        if (c.axis === 'x') b.x = target; else b.y = target;
        converged = false;
      }
    }
  }

  if (!converged) {
    issues.push({
      constraintId: '',
      status: 'ERROR',
      message: 'Конструкция имеет конфликтующие ограничения.',
    });
    return {
      positions: Object.fromEntries([...rects].map(([id, r]) => [id, { x: r.x, y: r.y }])),
      issues,
      ok: false,
      overconstrained: true,
      underconstrained: false,
    };
  }

  const constrainedIds = new Set(active.map((c) => c.b));
  const underconstrained = entities.some((e) => !constrainedIds.has(e.entityId)) && active.length > 0;

  return {
    positions: Object.fromEntries([...rects].map(([id, r]) => [id, { x: r.x, y: r.y }])),
    issues,
    ok: true,
    overconstrained: false,
    underconstrained,
  };
}

/** Статус одного ограничения на текущем расположении (§60). */
export function constraintStatus(
  constraint: Constraint2D,
  entities: EditorEntity[],
): ConstraintStatus {
  if (constraint.suppressed) return 'SUPPRESSED';
  const byId = new Map(entities.map((e) => [e.entityId, rectOf(e)]));
  const a = byId.get(constraint.a);
  const b = byId.get(constraint.b);
  if (!a || !b) return 'ERROR';
  if (constraint.type === 'DISTANCE' && (constraint.value == null || !Number.isFinite(constraint.value))) {
    return 'ERROR';
  }
  return isSatisfied(constraint, a, b) ? 'VALID' : 'WARNING';
}

/** Отрисовочное представление ограничения (§61). */
export interface ConstraintGlyph {
  constraintId: string;
  type: ConstraintType;
  status: ConstraintStatus;
  /** Линия между опорными точками объектов. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
}

const TYPE_LABEL: Record<ConstraintType, string> = {
  HORIZONTAL: '↔',
  VERTICAL: '↕',
  COINCIDENT: '≡',
  DISTANCE: '⟷',
  ALIGN: '⊢',
  CENTER: '⊕',
};

export function constraintGlyph(
  constraint: Constraint2D,
  entities: EditorEntity[],
): ConstraintGlyph | null {
  const byId = new Map(entities.map((e) => [e.entityId, rectOf(e)]));
  const a = byId.get(constraint.a);
  const b = byId.get(constraint.b);
  if (!a || !b) return null;
  return {
    constraintId: constraint.id,
    type: constraint.type,
    status: constraintStatus(constraint, entities),
    x1: a.x + a.width / 2,
    y1: a.y + a.height / 2,
    x2: b.x + b.width / 2,
    y2: b.y + b.height / 2,
    label: constraint.label ?? `${TYPE_LABEL[constraint.type]}${constraint.type === 'DISTANCE' ? ` ${constraint.value ?? '?'}` : ''}`,
  };
}

export function addConstraint(list: Constraint2D[], constraint: Constraint2D): Constraint2D[] {
  return [...list, constraint];
}

/** Удалить ограничение (§63). */
export function removeConstraint(list: Constraint2D[], id: string): Constraint2D[] {
  return list.filter((c) => c.id !== id);
}

/** Временно отключить/включить ограничение (§64). */
export function setConstraintSuppressed(list: Constraint2D[], id: string, suppressed: boolean): Constraint2D[] {
  return list.map((c) => (c.id === id ? { ...c, suppressed } : c));
}
