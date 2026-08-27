/**
 * Классификация неразмещённых деталей (§34–§36).
 *
 * Пользователю мало знать, что деталь «не влезла»: у трёх ситуаций разные
 * решения. Деталь крупнее любого листа лечится только другим форматом или
 * другой конструкцией; нехватка места — настройками раскроя; исчерпанный
 * запас — пополнением библиотеки листов. Поэтому причина возвращается кодом,
 * а не строкой.
 */
import type { UnplacedPiece, UnplacedReason } from '@/core/model/types';
import type { CuttingPieceInstance } from './types';
import { fitsFormat, type SheetFormat } from './formats';

/** Читаемое пояснение к коду причины. */
export function unplacedMessage(
  code: UnplacedReason,
  piece: { number: string; length: number; width: number },
  formats: SheetFormat[],
): string {
  const size = `${Math.round(piece.length)}×${Math.round(piece.width)} мм`;
  switch (code) {
    case 'DETAIL_TOO_LARGE': {
      const best = formats[0];
      const sheet = best ? `${Math.round(best.usable.w)}×${Math.round(best.usable.h)} мм` : 'доступный лист';
      return `Деталь ${piece.number} (${size}) больше рабочей области листа (${sheet}) — не помещается ни в один доступный формат.`;
    }
    case 'OUT_OF_STOCK':
      return `Деталь ${piece.number} (${size}) не размещена: исчерпан запас листов в библиотеке.`;
    case 'NO_VALID_PLACEMENT':
    default:
      return `Деталь ${piece.number} (${size}): не найдено свободное место с учётом пропила, отступов и текстуры.`;
  }
}

/**
 * Определить причину. Порядок проверок важен: «слишком большая» сильнее
 * «нет запаса» — если деталь не влезает физически, добавление листов
 * того же формата не поможет.
 */
export function classifyUnplaced(
  piece: CuttingPieceInstance,
  formats: SheetFormat[],
  allowRotate: boolean,
  stockExceeded: boolean,
): UnplacedReason {
  const fitsAnywhere = formats.some((f) => fitsFormat(f, piece, allowRotate));
  if (!fitsAnywhere) return 'DETAIL_TOO_LARGE';
  return stockExceeded ? 'OUT_OF_STOCK' : 'NO_VALID_PLACEMENT';
}

/** Собрать запись unplaced с кодом и пояснением. */
export function toUnplaced(
  piece: CuttingPieceInstance,
  formats: SheetFormat[],
  allowRotate: boolean,
  stockExceeded: boolean,
): UnplacedPiece {
  const code = classifyUnplaced(piece, formats, allowRotate, stockExceeded);
  return {
    pieceId: piece.pieceId,
    partId: piece.partId,
    name: piece.name,
    number: piece.number,
    length: piece.length,
    width: piece.width,
    code,
    reason: unplacedMessage(code, piece, formats),
  };
}
