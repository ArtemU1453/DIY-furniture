/**
 * Мост «действие на холсте → изменение ProjectModel» (§3, §22–§32).
 *
 * Функции здесь НИЧЕГО не мутируют: они переводят намерение пользователя в
 * список изменений модели, а применяет их стор одной транзакцией (§122–§124).
 * Так операция перетаскивания даёт одну запись в истории, а не запись на
 * каждый пиксель.
 *
 * Правило §30/§32: свободного масштабирования деталей нет. Размер
 * параметрической детали меняется ТОЛЬКО через параметр модуля; попытка
 * растянуть такую деталь возвращает отказ с объяснением, а не тихо ломает
 * параметрическую модель.
 */
import type { ParametricModel } from '@/core/parametric/types';
import type { Mm, Project } from '@/core/model/types';
import { planeAxisKeys } from './projection';
import type { EditorEntity, ResizeHandle, ViewPlane } from './types';

/** Изменение положения сущности в мировых координатах, мм. */
export interface MoveChange {
  kind: 'move';
  entityType: EditorEntity['entityType'];
  entityId: string;
  /** Дельта по мировым осям. */
  dx: Mm;
  dy: Mm;
  dz: Mm;
}

/** Изменение параметра параметрической модели (§31). */
export interface ParameterChange {
  kind: 'parameter';
  entityId: string;
  key: 'width' | 'height' | 'depth' | 'thickness';
  value: number;
}

/** Изменение поворота (§27/§28/§72). */
export interface RotateChange {
  kind: 'rotate';
  entityType: EditorEntity['entityType'];
  entityId: string;
  /** Угол вокруг вертикальной оси мира, градусы. */
  rotation: number;
}

/** Зеркальное отражение (§29). */
export interface MirrorChange {
  kind: 'mirror';
  entityId: string;
  axis: 'horizontal' | 'vertical';
}

export type ModelChange = MoveChange | ParameterChange | RotateChange | MirrorChange;

/** Отказ выполнить операцию с объяснением (§30/§32/§85). */
export interface OperationRefusal {
  entityId: string;
  code: string;
  message: string;
}

export interface OperationResult {
  changes: ModelChange[];
  refusals: OperationRefusal[];
}

const EMPTY: OperationResult = { changes: [], refusals: [] };

/**
 * Перевести смещение на плоскости вида в мировое смещение (§8).
 * Третья ось вида не участвует: вид её не задаёт.
 */
export function planeDeltaToWorld(
  plane: ViewPlane,
  dx: number,
  dy: number,
): { dx: Mm; dy: Mm; dz: Mm } {
  const axes = planeAxisKeys(plane);
  const out = { dx: 0, dy: 0, dz: 0 };
  const set = (axis: 'x' | 'y' | 'z', value: number) => {
    if (axis === 'x') out.dx = value;
    else if (axis === 'y') out.dy = value;
    else out.dz = value;
  };
  set(axes.h, dx);
  set(axes.v, dy);
  return out;
}

/** Переместить выбранные сущности (§22/§26). */
export function moveEntities(
  entities: EditorEntity[],
  plane: ViewPlane,
  dx: number,
  dy: number,
): OperationResult {
  const changes: ModelChange[] = [];
  const refusals: OperationRefusal[] = [];
  const world = planeDeltaToWorld(plane, dx, dy);

  for (const entity of entities) {
    if (entity.locked) {
      refusals.push({
        entityId: entity.entityId,
        code: 'editor.locked',
        message: `«${entity.label}» заблокирован — снимите блокировку, чтобы переместить.`,
      });
      continue;
    }
    if (entity.entityType !== 'MODULE' && entity.entityType !== 'PART') {
      // Фурнитура и соединения не имеют собственных координат: они выводятся
      // из деталей, поэтому двигать их отдельно нельзя (§102/§103).
      refusals.push({
        entityId: entity.entityId,
        code: 'editor.derivedPosition',
        message: `Положение «${entity.label}» вычисляется по деталям и отдельно не задаётся.`,
      });
      continue;
    }
    changes.push({ kind: 'move', entityType: entity.entityType, entityId: entity.entityId, ...world });
  }
  return { changes, refusals };
}

/** Задать положение сущности точно (§25/§26). */
export function setEntityPosition(
  entity: EditorEntity,
  plane: ViewPlane,
  x: number | undefined,
  y: number | undefined,
): OperationResult {
  if (entity.locked) {
    return {
      changes: [],
      refusals: [{ entityId: entity.entityId, code: 'editor.locked', message: `«${entity.label}» заблокирован.` }],
    };
  }
  const dx = x != null && Number.isFinite(x) ? x - entity.transform.x : 0;
  const dy = y != null && Number.isFinite(y) ? y - entity.transform.y : 0;
  if (dx === 0 && dy === 0) return EMPTY;
  return moveEntities([entity], plane, dx, dy);
}

/** Допустимые углы поворота (§27/§72). */
export const ROTATIONS = [0, 90, 180, 270] as const;

/** Нормализовать произвольный угол к ортогональному (§28). */
export function normalizeRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const wrapped = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  return wrapped;
}

/** Повернуть сущности (§27/§28). */
export function rotateEntities(entities: EditorEntity[], degrees: number): OperationResult {
  const rotation = normalizeRotation(degrees);
  const changes: ModelChange[] = [];
  const refusals: OperationRefusal[] = [];
  for (const entity of entities) {
    if (entity.locked) {
      refusals.push({ entityId: entity.entityId, code: 'editor.locked', message: `«${entity.label}» заблокирован.` });
      continue;
    }
    if (entity.entityType !== 'MODULE' && entity.entityType !== 'PART') {
      refusals.push({
        entityId: entity.entityId,
        code: 'editor.notRotatable',
        message: `«${entity.label}» не поворачивается отдельно от детали.`,
      });
      continue;
    }
    changes.push({ kind: 'rotate', entityType: entity.entityType, entityId: entity.entityId, rotation });
  }
  return { changes, refusals };
}

/** Отразить сущности (§29). */
export function mirrorEntities(entities: EditorEntity[], axis: 'horizontal' | 'vertical'): OperationResult {
  const changes: ModelChange[] = [];
  const refusals: OperationRefusal[] = [];
  for (const entity of entities) {
    if (entity.locked) {
      refusals.push({ entityId: entity.entityId, code: 'editor.locked', message: `«${entity.label}» заблокирован.` });
      continue;
    }
    if (entity.entityType !== 'MODULE') {
      refusals.push({
        entityId: entity.entityId,
        code: 'editor.mirrorModuleOnly',
        message: 'Зеркалить можно модуль целиком: у отдельной детали зеркало ломает кромку и присадку.',
      });
      continue;
    }
    changes.push({ kind: 'mirror', entityId: entity.entityId, axis });
  }
  return { changes, refusals };
}

/** Какие параметры меняет ручка изменения размера на данном виде. */
function resizeAxes(plane: ViewPlane, handle: ResizeHandle): { h?: 'width' | 'depth'; v?: 'height' | 'depth' } {
  const axes = planeAxisKeys(plane);
  const horizontal = axes.h === 'x' ? 'width' : 'depth';
  const vertical = axes.v === 'y' ? 'height' : 'depth';
  const out: { h?: 'width' | 'depth'; v?: 'height' | 'depth' } = {};
  if (handle.includes('e') || handle.includes('w')) out.h = horizontal as 'width' | 'depth';
  if (handle.includes('n') || handle.includes('s')) out.v = vertical as 'height' | 'depth';
  return out;
}

export interface ResizeOptions {
  plane: ViewPlane;
  handle: ResizeHandle;
  /** Новые габариты на виде, мм. */
  width: number;
  height: number;
  /** Параметрическая модель модуля, если она есть. */
  model: ParametricModel | null;
  /** Ограничения на размер (§147). */
  limits?: { min?: number; max?: number };
}

export const MIN_DIMENSION = 20;
export const MAX_DIMENSION = 6000;

/**
 * Изменение размера (§30–§32, §146/§147).
 *
 * Для модуля с параметрической моделью правятся ЕГО ПАРАМЕТРЫ — новая
 * геометрия появляется как результат перегенерации, а не как независимый
 * прямоугольник (§31). Для детали параметрического модуля операция
 * отклоняется: её размер вычисляется генератором (§32).
 */
export function resizeEntity(entity: EditorEntity, options: ResizeOptions): OperationResult {
  if (entity.locked) {
    return {
      changes: [],
      refusals: [{ entityId: entity.entityId, code: 'editor.locked', message: `«${entity.label}» заблокирован.` }],
    };
  }

  if (entity.entityType === 'PART') {
    return {
      changes: [],
      refusals: [{
        entityId: entity.entityId,
        code: 'editor.parametricPart',
        message: 'Размер детали вычисляется параметрами модуля. Измените параметр модуля, а не деталь.',
      }],
    };
  }

  if (entity.entityType !== 'MODULE' || !options.model) {
    return {
      changes: [],
      refusals: [{
        entityId: entity.entityId,
        code: 'editor.notResizable',
        message: `«${entity.label}» не имеет параметров размера.`,
      }],
    };
  }

  const min = options.limits?.min ?? MIN_DIMENSION;
  const max = options.limits?.max ?? MAX_DIMENSION;
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const axes = resizeAxes(options.plane, options.handle);
  const changes: ModelChange[] = [];

  if (axes.h) changes.push({ kind: 'parameter', entityId: entity.entityId, key: axes.h, value: clamp(options.width) });
  if (axes.v) changes.push({ kind: 'parameter', entityId: entity.entityId, key: axes.v, value: clamp(options.height) });

  return { changes, refusals: [] };
}

/** Габариты после перетаскивания ручки (§146/§149). */
export function resizedRect(
  rect: { x: number; y: number; width: number; height: number },
  handle: ResizeHandle,
  dx: number,
  dy: number,
): { x: number; y: number; width: number; height: number } {
  let { x, y, width, height } = rect;
  if (handle.includes('e')) width += dx;
  if (handle.includes('w')) { x += dx; width -= dx; }
  if (handle.includes('n')) height += dy;
  if (handle.includes('s')) { y += dy; height -= dy; }
  return {
    x, y,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

/** Изменения параметра из панели свойств (§118/§119). */
export function setParameter(
  entity: EditorEntity,
  key: ParameterChange['key'],
  value: number,
): OperationResult {
  // §119: некорректное значение не записывается в модель.
  if (!Number.isFinite(value) || value <= 0) {
    return {
      changes: [],
      refusals: [{ entityId: entity.entityId, code: 'editor.badValue', message: 'Значение должно быть положительным числом.' }],
    };
  }
  if (entity.entityType !== 'MODULE') {
    return {
      changes: [],
      refusals: [{ entityId: entity.entityId, code: 'editor.notParametric', message: 'У объекта нет параметров модели.' }],
    };
  }
  return { changes: [{ kind: 'parameter', entityId: entity.entityId, key, value }], refusals: [] };
}

/** Режим только для чтения запрещает любые изменения модели (§133/§134). */
export function guardReadOnly(readOnly: boolean, result: OperationResult): OperationResult {
  if (!readOnly) return result;
  return {
    changes: [],
    refusals: result.changes.map((c) => ({
      entityId: 'entityId' in c ? c.entityId : '',
      code: 'editor.readOnly',
      message: 'Проект открыт только для чтения — изменения не сохраняются.',
    })),
  };
}

/** Есть ли в проекте сущность с таким идентификатором. */
export function entityExists(project: Project, entityId: string): boolean {
  if (project.furnitures.some((f) => String(f.id) === entityId)) return true;
  return project.furnitures.some((f) =>
    f.assemblies.some((a) => a.parts.some((p) => String(p.id) === entityId)),
  );
}
