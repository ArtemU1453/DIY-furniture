/**
 * SIMPLE_SHELF — полочный раскрой (Next-Fit Decreasing Height).
 *
 * Детали сортируются по убыванию высоты и укладываются рядами («полками»):
 * ряд растёт слева направо, его высота задана первой деталью ряда. Когда ряд
 * заполнен — открывается следующий над ним, когда лист исчерпан — берётся
 * новый.
 *
 * Даёт заведомо ГИЛЬОТИННЫЙ раскрой одним проходом: линии реза идут сплошными
 * полосами через весь лист, что удобно на форматно-раскроечном станке. По
 * использованию материала уступает MaxRects — выбирается пользователем
 * осознанно, движком по умолчанию не является (§30).
 */
import type { CuttingEngine } from './CuttingEngine';
import {
  CuttingCancelledError,
  type CuttingInput,
  type CuttingPieceInstance,
  type CuttingResult,
  type CuttingRunControls,
  type PieceRotation,
  type Placement,
} from './types';
import { assembleResult, type PackedResult, type PackedSheet, type Rect } from './assemble';
import { sheetFormats, formatForPiece } from './formats';
import { spacingOf } from './profile';

const EPS = 1e-6;

function canRotate(piece: CuttingPieceInstance, respectGrain: boolean): boolean {
  if (!piece.allowRotate) return false;
  if (respectGrain && piece.grain !== 'none') return false;
  return true;
}

/** Полка внутри листа: горизонтальная полоса фиксированной высоты. */
interface Shelf {
  y: number;
  height: number;
  cursorX: number;
}

interface ShelfSheet extends PackedSheet {
  shelves: Shelf[];
  /** Верхняя граница занятой части листа. */
  top: number;
}

function newSheet(index: number, usable: Rect, fromRemnant: boolean, extra: Partial<ShelfSheet> = {}): ShelfSheet {
  return {
    index,
    usable,
    placements: [],
    fromRemnant,
    free: [],
    shelves: [],
    top: usable.y,
    ...extra,
  };
}

/**
 * Ориентация детали для полки: при разрешённом повороте деталь кладётся
 * «лёжа» (меньшей стороной вверх) — так полки получаются ниже и на листе их
 * помещается больше.
 */
function orientationsFor(piece: CuttingPieceInstance, respectGrain: boolean): Array<[number, number, PieceRotation]> {
  const base: Array<[number, number, PieceRotation]> = [[piece.length, piece.width, 0]];
  if (canRotate(piece, respectGrain) && piece.length !== piece.width) base.push([piece.width, piece.length, 90]);
  return base;
}

/** Разложить свободное место листа на прямоугольники (для остатков §65). */
function freeRects(sheet: ShelfSheet, spacing: number): Rect[] {
  const out: Rect[] = [];
  for (const shelf of sheet.shelves) {
    const restW = sheet.usable.x + sheet.usable.w - shelf.cursorX;
    if (restW > 1 && shelf.height > 1) out.push({ x: shelf.cursorX, y: shelf.y, w: restW, h: shelf.height });
  }
  const restH = sheet.usable.y + sheet.usable.h - sheet.top;
  if (restH > 1) out.push({ x: sheet.usable.x, y: sheet.top, w: sheet.usable.w, h: restH });
  return out.filter((r) => r.w > spacing && r.h > spacing);
}

function pack(input: CuttingInput): PackedResult {
  const respectGrain = input.options.respectGrain;
  const spacing = spacingOf({ kerf: input.kerf, minGap: input.minGap });
  const maxFull = input.availableQuantity && input.availableQuantity > 0 ? input.availableQuantity : Infinity;
  const formats = sheetFormats(input);
  const byId = new Map(input.pieces.map((p) => [p.pieceId, p]));

  const sheets: ShelfSheet[] = [];
  let fullCount = 0;
  let stockExceeded = false;

  // Остатки идут первыми — они дешевле нового листа (§68).
  for (const rs of input.remnantSheets ?? []) {
    sheets.push(newSheet(sheets.length, { x: 0, y: 0, w: rs.length, h: rs.width }, true, { sourceId: rs.id, top: 0 }));
  }
  const remnantCount = sheets.length;

  const ensureFullSheet = (index: number, piece?: CuttingPieceInstance): ShelfSheet | null => {
    while (sheets.length <= index) {
      if (fullCount >= maxFull) {
        stockExceeded = true;
        return null;
      }
      const fmt = piece ? formatForPiece(formats, piece, canRotate(piece, respectGrain)) : formats[0];
      sheets.push(newSheet(sheets.length, { ...fmt.usable }, false, { fmt, top: fmt.usable.y }));
      fullCount++;
    }
    return sheets[index];
  };

  const put = (
    sheet: ShelfSheet,
    shelf: Shelf,
    piece: CuttingPieceInstance,
    w: number,
    h: number,
    rotation: PieceRotation,
    origin: Placement['origin'],
    locked: boolean,
  ): void => {
    sheet.placements.push({
      pieceId: piece.pieceId,
      partId: piece.partId,
      name: piece.name,
      number: piece.number,
      x: shelf.cursorX,
      y: shelf.y,
      length: w,
      width: h,
      rotation,
      origin,
      locked,
      grainDirection: piece.grain,
    });
    shelf.cursorX += w + spacing;
    sheet.top = Math.max(sheet.top, shelf.y + shelf.height + spacing);
  };

  /* Зафиксированные вручную детали (§): полочный движок не двигает их, но и
   * не умеет обходить произвольные координаты — каждая занимает собственную
   * полку во всю ширину листа, чтобы автоматические детали её не задели. */
  const lockedIds = new Set<string>();
  for (const lp of input.locked ?? []) {
    const piece = byId.get(lp.pieceId);
    if (!piece) continue;
    const sheet = ensureFullSheet(remnantCount + lp.sheetIndex);
    if (!sheet) continue;
    const w = lp.rotation === 90 ? piece.width : piece.length;
    const h = lp.rotation === 90 ? piece.length : piece.width;
    sheet.placements.push({
      pieceId: piece.pieceId,
      partId: piece.partId,
      name: piece.name,
      number: piece.number,
      x: lp.x,
      y: lp.y,
      length: w,
      width: h,
      rotation: lp.rotation,
      origin: 'manual',
      locked: true,
      grainDirection: piece.grain,
    });
    sheet.top = Math.max(sheet.top, lp.y + h + spacing);
    lockedIds.add(lp.pieceId);
  }

  // Сортировка по убыванию высоты — базовое условие полочного алгоритма.
  const remaining = input.pieces
    .filter((p) => !lockedIds.has(p.pieceId))
    .slice()
    .sort((a, b) => {
      const ha = Math.min(a.length, a.width);
      const hb = Math.min(b.length, b.width);
      return hb - ha || b.length * b.width - a.length * a.width || a.pieceId.localeCompare(b.pieceId);
    });

  const unplaced: CuttingPieceInstance[] = [];

  for (const piece of remaining) {
    let placed = false;

    // 1) Текущие полки существующих листов.
    for (const sheet of sheets) {
      for (const shelf of sheet.shelves) {
        for (const [w, h, rot] of orientationsFor(piece, respectGrain)) {
          const fitsWidth = shelf.cursorX + w <= sheet.usable.x + sheet.usable.w + EPS;
          const fitsHeight = h <= shelf.height + EPS;
          if (fitsWidth && fitsHeight) {
            put(sheet, shelf, piece, w, h, rot, 'automatic', false);
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
      if (placed) break;
    }
    if (placed) continue;

    // 2) Новая полка на существующем листе.
    for (const sheet of sheets) {
      for (const [w, h, rot] of orientationsFor(piece, respectGrain)) {
        const fitsWidth = w <= sheet.usable.w + EPS;
        const fitsHeight = sheet.top + h <= sheet.usable.y + sheet.usable.h + EPS;
        if (fitsWidth && fitsHeight) {
          const shelf: Shelf = { y: sheet.top, height: h, cursorX: sheet.usable.x };
          sheet.shelves.push(shelf);
          put(sheet, shelf, piece, w, h, rot, 'automatic', false);
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (placed) continue;

    // 3) Новый лист.
    const sheet = ensureFullSheet(sheets.length, piece);
    if (!sheet) {
      unplaced.push(piece); // запас исчерпан
      continue;
    }
    let opened = false;
    for (const [w, h, rot] of orientationsFor(piece, respectGrain)) {
      if (w <= sheet.usable.w + EPS && h <= sheet.usable.h + EPS) {
        const shelf: Shelf = { y: sheet.usable.y, height: h, cursorX: sheet.usable.x };
        sheet.shelves.push(shelf);
        put(sheet, shelf, piece, w, h, rot, 'automatic', false);
        opened = true;
        break;
      }
    }
    if (!opened) {
      unplaced.push(piece); // не помещается даже на пустой лист
      if (sheet.placements.length === 0 && !sheet.fromRemnant) {
        sheets.pop();
        fullCount--;
      }
    }
  }

  const nonEmpty = sheets.filter((s) => s.placements.length > 0);
  nonEmpty.forEach((s, i) => {
    s.index = i;
    s.free = freeRects(s, spacing);
  });
  return { sheets: nonEmpty, unplaced, stockExceeded, attemptsRun: 1 };
}

export class ShelfEngine implements CuttingEngine {
  readonly id = 'shelf';
  readonly name = 'Полочный раскрой (гильотинный, один проход)';
  readonly version = '1.0';

  calculate(input: CuttingInput, controls?: CuttingRunControls): CuttingResult {
    if (controls?.shouldCancel?.()) throw new CuttingCancelledError();
    controls?.onProgress?.({ fraction: 0, message: 'Полочная укладка…' });
    const packed = pack(input);
    if (controls?.shouldCancel?.()) throw new CuttingCancelledError();
    controls?.onProgress?.({ fraction: 1, message: 'Готово' });
    return assembleResult(input, packed, (p) => canRotate(p, input.options.respectGrain));
  }
}
