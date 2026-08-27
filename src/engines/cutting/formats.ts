/**
 * Выбор формата листа под деталь (§23/§24).
 *
 * Алгоритм сначала пробует предпочтительный формат; если деталь в него не
 * помещается, перебирает альтернативные форматы по убыванию приоритета.
 */
import type { Mm } from '@/core/model/types';
import type { CuttingInput, CuttingPieceInstance } from './types';

export interface SheetFormat {
  id?: string;
  length: Mm;
  width: Mm;
  availableQuantity: number;
  /** Рабочая область формата (формат − технологический припуск). */
  usable: { x: number; y: number; w: number; h: number };
}

function usableOf(input: CuttingInput, length: number, width: number): SheetFormat['usable'] {
  return {
    x: input.trim.left,
    y: input.trim.bottom,
    w: length - input.trim.left - input.trim.right,
    h: width - input.trim.top - input.trim.bottom,
  };
}

/** Все форматы для входа в порядке приоритета: основной, затем альтернативные. */
export function sheetFormats(input: CuttingInput): SheetFormat[] {
  const primary: SheetFormat = {
    id: input.sheetMaterialId,
    length: input.sheet.length,
    width: input.sheet.width,
    availableQuantity: input.availableQuantity ?? 0,
    usable: usableOf(input, input.sheet.length, input.sheet.width),
  };
  const alts = (input.alternateSheets ?? []).map((a) => ({
    id: a.id,
    length: a.length,
    width: a.width,
    availableQuantity: a.availableQuantity,
    usable: usableOf(input, a.length, a.width),
  }));
  return [primary, ...alts];
}

/** Помещается ли деталь в рабочую область формата (с учётом поворота). */
export function fitsFormat(fmt: SheetFormat, piece: CuttingPieceInstance, allowRotate: boolean): boolean {
  const { w, h } = fmt.usable;
  if (piece.length <= w && piece.width <= h) return true;
  if (allowRotate && piece.width <= w && piece.length <= h) return true;
  return false;
}

/**
 * Подобрать формат под деталь: первый по приоритету, в который она влезает.
 * Если ни один не подходит — вернуть предпочтительный (деталь уйдёт в unplaced
 * с понятной причиной).
 */
export function formatForPiece(
  formats: SheetFormat[],
  piece: CuttingPieceInstance,
  allowRotate: boolean,
): SheetFormat {
  return formats.find((f) => fitsFormat(f, piece, allowRotate)) ?? formats[0];
}
