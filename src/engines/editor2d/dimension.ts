/**
 * Инструмент «Размер» (§33–§37, §53–§57).
 *
 * Замер по умолчанию СПРАВОЧНЫЙ (§55): он показывает расстояние и ничем не
 * управляет. Связать размер с параметром можно явно (§56), но если такая
 * связь противоречит уже существующей параметрической модели — модель НЕ
 * меняется, выдаётся предупреждение (§57).
 */
import type { ParametricModel } from '@/core/parametric/types';
import { linkStatus } from '@/engines/parametric';
import type { Dimension2D, EditorEntity, ViewPlane } from './types';
import { rectOf } from './projection';

let counter = 0;

export function dimensionId(): string {
  counter += 1;
  return `dim-${counter}`;
}

/** Замер между двумя точками (§54). */
export function createDimension(
  from: { x: number; y: number },
  to: { x: number; y: number },
  plane: ViewPlane,
  options: { reference?: boolean; parameterId?: string; label?: string; id?: string } = {},
): Dimension2D {
  return {
    id: options.id ?? dimensionId(),
    plane,
    from: { ...from },
    to: { ...to },
    reference: options.reference ?? true,
    parameterId: options.parameterId,
    label: options.label,
  };
}

/** Длина замера, мм. */
export function dimensionLength(dim: Dimension2D): number {
  return Math.hypot(dim.to.x - dim.from.x, dim.to.y - dim.from.y);
}

/** Ориентация замера — по ней рисуется выносная линия. */
export function dimensionOrientation(dim: Dimension2D): 'horizontal' | 'vertical' | 'diagonal' {
  const dx = Math.abs(dim.to.x - dim.from.x);
  const dy = Math.abs(dim.to.y - dim.from.y);
  if (dy < 0.5) return 'horizontal';
  if (dx < 0.5) return 'vertical';
  return 'diagonal';
}

export function addDimension(dimensions: Dimension2D[], dim: Dimension2D): Dimension2D[] {
  return [...dimensions, dim];
}

export function removeDimension(dimensions: Dimension2D[], id: string): Dimension2D[] {
  return dimensions.filter((d) => d.id !== id);
}

export function dimensionsOfPlane(dimensions: Dimension2D[], plane: ViewPlane): Dimension2D[] {
  return dimensions.filter((d) => d.plane === plane);
}

/** Габаритные подписи выбранной сущности (§33/§34): W и H. */
export interface BoundingLabel {
  entityId: string;
  width: number;
  height: number;
  /** Точка привязки подписи ширины. */
  widthAt: { x: number; y: number };
  heightAt: { x: number; y: number };
}

export function boundingLabel(entity: EditorEntity): BoundingLabel {
  const r = rectOf(entity);
  return {
    entityId: entity.entityId,
    width: r.width,
    height: r.height,
    widthAt: { x: r.x + r.width / 2, y: r.y },
    heightAt: { x: r.x, y: r.y + r.height / 2 },
  };
}

/** Источник значения размера (§36/§37/§139–§142). */
export type DimensionSource = 'LINKED' | 'MANUAL' | 'DERIVED';

export interface DimensionInfo {
  value: number;
  source: DimensionSource;
  /** Выражение, если значение вычисляется (§142). */
  expression?: string;
  /** Человекочитаемое происхождение значения (§140). */
  origin?: string;
  /** Можно ли править напрямую (§35): производные величины правятся параметрами. */
  editable: boolean;
}

/**
 * Как показывать размер сущности (§36/§37).
 *
 * У модуля ширина и высота — это параметры модели, поэтому размер либо
 * связан выражением (fx), либо задан вручную. У детали параметрического
 * модуля размер ПРОИЗВОДНЫЙ: он вычисляется генератором, и менять его прямо
 * на холсте нельзя — правится параметр модуля (§30/§32).
 */
export function dimensionInfo(
  entity: EditorEntity,
  axis: 'width' | 'height',
  model: ParametricModel | null,
): DimensionInfo {
  const value = axis === 'width' ? entity.transform.width : entity.transform.height;

  if (entity.entityType === 'PART') {
    return {
      value,
      source: 'DERIVED',
      origin: 'Вычисляется параметрами модуля',
      editable: false,
    };
  }

  if (entity.entityType === 'MODULE' && model) {
    const key = axis === 'width' ? 'width' : 'height';
    const parameter = model.parameters.find((p) => p.id === key);
    if (parameter) {
      const status = linkStatus(parameter);
      return {
        value: typeof parameter.value === 'number' ? parameter.value : value,
        source: status,
        expression: parameter.expression,
        origin: status === 'LINKED' ? `Выражение: ${parameter.expression ?? ''}` : 'Задано вручную',
        editable: true,
      };
    }
    return { value: model[key] ?? value, source: 'MANUAL', origin: 'Параметр модуля', editable: true };
  }

  return { value, source: 'MANUAL', origin: 'Положение на виде', editable: false };
}

/** Предупреждение о конфликте размера с параметрической моделью (§57). */
export interface DimensionConflict {
  code: string;
  message: string;
}

/**
 * Проверить, можно ли связать замер с параметром (§56/§57).
 * Модель при конфликте НЕ меняется — вызывающий код обязан показать
 * предупреждение и остановиться.
 */
export function checkDimensionLink(
  dim: Dimension2D,
  model: ParametricModel | null,
  parameterId: string,
): DimensionConflict | null {
  if (!model) {
    return { code: 'dimension.noModel', message: 'У объекта нет параметрической модели — размер останется справочным.' };
  }
  const parameter = model.parameters.find((p) => p.id === parameterId);
  if (!parameter) {
    return { code: 'dimension.noParameter', message: `Параметр «${parameterId}» не найден.` };
  }
  if (parameter.expression) {
    return {
      code: 'dimension.linkedParameter',
      message: `Параметр «${parameterId}» вычисляется выражением «${parameter.expression}». Размер оставлен справочным: разорвите связь, чтобы задать значение вручную.`,
    };
  }
  const length = dimensionLength(dim);
  if (!Number.isFinite(length) || length <= 0) {
    return { code: 'dimension.badValue', message: 'Размер нулевой или некорректный — параметр не изменён.' };
  }
  return null;
}

/** Расстояния от сущности до границ владельца (§44). */
export interface ParentOffsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function parentOffsets(entity: EditorEntity, parent: EditorEntity): ParentOffsets {
  const a = rectOf(entity);
  const p = rectOf(parent);
  return {
    left: a.x - p.x,
    right: p.x + p.width - (a.x + a.width),
    bottom: a.y - p.y,
    top: p.y + p.height - (a.y + a.height),
  };
}
