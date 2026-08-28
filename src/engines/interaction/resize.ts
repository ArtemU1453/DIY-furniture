/**
 * Изменение размеров интерактивно (§19–§24).
 *
 * Размер параметрической детали ВЫЧИСЛЯЕТСЯ правилом. Ручное изменение не
 * стирает правило и не «отвязывает» деталь: оно записывается как Override
 * механизмом этапа 18 (Part.metadata.overrides) и переживает пересчёт, пока
 * его не сбросят (§22–§24). Формула остаётся на месте — поэтому «Вернуть
 * расчёт» возвращает деталь под управление правил, ничего не пересобирая.
 */
import type { Part } from '@/core/model/types';
import {
  applyOverride,
  hasOverride,
  partOverrides,
  partSource,
  resetOverride,
  type PartOverride,
} from '@/engines/parametric';

/** Ограничения размеров детали (§21). */
export interface SizeLimits {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  minDepth: number;
  maxDepth: number;
}

export const DEFAULT_SIZE_LIMITS: SizeLimits = {
  minWidth: 10, maxWidth: 4000,
  minHeight: 10, maxHeight: 4000,
  minDepth: 1, maxDepth: 200,
};

export type SizeField = 'width' | 'height' | 'thickness';

export interface ResizeRefusal {
  code: string;
  message: string;
}

export interface ResizeOutcome {
  ok: boolean;
  /** Деталь с записанным override; при отказе — исходная. */
  part: Part;
  /** Что именно переопределено. */
  override?: PartOverride;
  refusal?: ResizeRefusal;
}

const LABEL: Record<SizeField, string> = {
  width: 'Ширина',
  height: 'Высота',
  thickness: 'Толщина',
};

function limitsOf(field: SizeField, limits: SizeLimits): { min: number; max: number } {
  if (field === 'width') return { min: limits.minWidth, max: limits.maxWidth };
  if (field === 'height') return { min: limits.minHeight, max: limits.maxHeight };
  return { min: limits.minDepth, max: limits.maxDepth };
}

/** Проверить значение размера (§21/§47). */
export function checkSize(
  field: SizeField,
  value: number,
  limits: SizeLimits = DEFAULT_SIZE_LIMITS,
): ResizeRefusal | null {
  if (!Number.isFinite(value)) {
    return { code: 'resize.notNumber', message: `${LABEL[field]}: нужно число.` };
  }
  if (value <= 0) {
    return { code: 'resize.notPositive', message: `${LABEL[field]}: значение должно быть больше нуля.` };
  }
  const { min, max } = limitsOf(field, limits);
  if (value < min) {
    return { code: 'resize.belowMin', message: `${LABEL[field]} ${Math.round(value)} мм меньше минимальной (${min} мм).` };
  }
  if (value > max) {
    return { code: 'resize.aboveMax', message: `${LABEL[field]} ${Math.round(value)} мм больше максимальной (${max} мм).` };
  }
  return null;
}

/**
 * Изменить размер детали вручную (§19/§23).
 *
 * Заблокированная по размеру деталь (§82) не меняется. Параметрическая деталь
 * получает Override — формула остаётся, но поле считается вручную.
 */
export function resizePart(
  part: Part,
  field: SizeField,
  value: number,
  limits: SizeLimits = DEFAULT_SIZE_LIMITS,
): ResizeOutcome {
  if (part.metadata?.lockedSize === true) {
    return { ok: false, part, refusal: { code: 'resize.locked', message: `Размер детали «${part.name}» заблокирован.` } };
  }
  const refusal = checkSize(field, value, limits);
  if (refusal) return { ok: false, part, refusal };

  const patch: PartOverride = { [field]: value } as PartOverride;
  return { ok: true, part: applyOverride(part, patch), override: patch };
}

/** Изменить сразу несколько полей одной операцией (§121). */
export function resizePartTo(
  part: Part,
  patch: Partial<Record<SizeField, number>>,
  limits: SizeLimits = DEFAULT_SIZE_LIMITS,
): ResizeOutcome {
  if (part.metadata?.lockedSize === true) {
    return { ok: false, part, refusal: { code: 'resize.locked', message: `Размер детали «${part.name}» заблокирован.` } };
  }
  const entries = Object.entries(patch) as Array<[SizeField, number]>;
  for (const [field, value] of entries) {
    const refusal = checkSize(field, value, limits);
    if (refusal) return { ok: false, part, refusal };
  }
  const override = Object.fromEntries(entries) as PartOverride;
  return { ok: true, part: applyOverride(part, override), override };
}

/** «Вернуть расчётное значение» (§24): деталь снова считает правило. */
export function resetToFormula(part: Part, fields?: SizeField[]): Part {
  return resetOverride(part, fields);
}

/** Состояние связи детали с параметрами (§137). */
export type LinkState = 'LINKED' | 'OVERRIDE' | 'LOCKED' | 'MANUAL';

export function linkState(part: Part): LinkState {
  if (part.metadata?.lockedPosition === true || part.metadata?.lockedSize === true) return 'LOCKED';
  if (hasOverride(part)) return 'OVERRIDE';
  return partSource(part) === 'PARAMETRIC' ? 'LINKED' : 'MANUAL';
}

/** Какие поля детали сейчас переопределены (§101/§137). */
export function overriddenFields(part: Part): string[] {
  return Object.keys(partOverrides(part));
}

/** Заблокировано ли положение детали (§81). */
export function isPositionLocked(part: Part): boolean {
  return part.metadata?.lockedPosition === true;
}

export function isSizeLocked(part: Part): boolean {
  return part.metadata?.lockedSize === true;
}
