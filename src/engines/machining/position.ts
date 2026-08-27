/**
 * Разрешение координат операции (§15–§21/§43–§45).
 *
 * Координата может быть задана числом или выражением вида `width / 2`.
 * Выражение считает БЕЗОПАСНЫЙ парсер проекта (engines/templates/formula) —
 * тот же, что и в параметрическом редакторе. Никакого eval и никакого
 * выполнения произвольного кода (§21): второй реализации парсера тоже не
 * заводится, иначе правила считались бы по разным грамматикам.
 */
import type { MachiningOperation, Part, PartFace, PositionReference } from '@/core/model/types';
import { evaluateFormula } from '@/engines/templates/formula';
import { sideLength } from '@/engines/edges';

/** Переменные, доступные в выражениях координат. */
export interface PositionScope {
  width: number;
  height: number;
  thickness: number;
  /** Размеры самой ГРАНИ, на которой размещается операция. */
  faceWidth: number;
  faceHeight: number;
  [key: string]: number;
}

/** Размеры грани детали: по ним считаются отступы от края и центра. */
export function faceExtent(part: Part, face: PartFace): { width: number; height: number } {
  switch (face) {
    case 'front':
    case 'back':
      return { width: part.width, height: part.height };
    case 'left':
    case 'right':
      return { width: part.thickness, height: part.height };
    case 'top':
    case 'bottom':
    default:
      return { width: part.width, height: part.thickness };
  }
}

/** Область видимости выражений для детали и грани. */
export function scopeFor(part: Part, face: PartFace): PositionScope {
  const extent = faceExtent(part, face);
  return {
    width: part.width,
    height: part.height,
    thickness: part.thickness,
    faceWidth: extent.width,
    faceHeight: extent.height,
    // Длина стороны — та же величина, что использует кромка: одна геометрия
    // на всю программу.
    left: sideLength(part, 'left'),
    right: sideLength(part, 'right'),
    top: sideLength(part, 'top'),
    bottom: sideLength(part, 'bottom'),
  };
}

/** Число или безопасное выражение → число. */
export function resolveValue(value: number | string, scope: PositionScope): number {
  if (typeof value === 'number') return value;
  return evaluateFormula(value, scope);
}

export interface ResolveContext {
  part: Part;
  face: PartFace;
  /** Уже посчитанные операции — для ссылок вида «от отверстия A» (§19). */
  resolved?: Map<string, { x: number; y: number }>;
  /** Ось, по которой считается ссылка. */
  axis: 'x' | 'y';
}

/**
 * Разрешить одну координату (§16).
 *
 * EDGE от дальнего края считается с обратной стороны: «37 мм от правого края»
 * должно оставаться 37 мм и после изменения ширины детали (§42/§43).
 */
export function resolvePosition(ref: PositionReference, ctx: ResolveContext): number {
  const scope = scopeFor(ctx.part, ctx.face);
  const extent = faceExtent(ctx.part, ctx.face);
  const span = ctx.axis === 'x' ? extent.width : extent.height;
  const value = resolveValue(ref.value, scope);

  switch (ref.kind) {
    case 'EDGE': {
      const far = ref.from === 'right' || ref.from === 'top';
      return far ? span - value : value;
    }
    case 'CENTER':
      return span / 2 + value;
    case 'OPERATION': {
      const base = ref.from ? ctx.resolved?.get(ref.from) : undefined;
      // Ссылка на неизвестную операцию не должна давать молчаливый ноль:
      // возвращаем само значение, а несогласованность поймает валидатор.
      if (!base) return value;
      return (ctx.axis === 'x' ? base.x : base.y) + value;
    }
    case 'POINT':
    default:
      return value;
  }
}

/** Отступ от края — самая частая форма записи (§43/§44). */
export function fromEdge(value: number | string, from: 'left' | 'right' | 'top' | 'bottom' = 'left'): PositionReference {
  return { kind: 'EDGE', value, from };
}

/** От центра грани (§18/§45). */
export function fromCenter(value: number | string = 0): PositionReference {
  return { kind: 'CENTER', value };
}

/** Абсолютная координата детали. */
export function atPoint(value: number | string): PositionReference {
  return { kind: 'POINT', value };
}

/** От другой операции (§19). */
export function fromOperation(operationId: string, offset: number | string): PositionReference {
  return { kind: 'OPERATION', value: offset, from: operationId };
}

/** Координаты уже посчитанных операций — для ссылок между ними. */
export function resolvedMap(operations: MachiningOperation[]): Map<string, { x: number; y: number }> {
  return new Map(operations.map((op) => [String(op.id), { x: op.x, y: op.y }]));
}
