/**
 * Базовый движок раскроя — простая полочная (shelf) укладка.
 *
 * Это НЕ оптимизирующий алгоритм (оптимизация — отдельный будущий этап).
 * Реализация корректная и детерминированная, служит первым рабочим движком за
 * интерфейсом CuttingEngine и эталоном для контрактных тестов. Более
 * эффективный алгоритм регистрируется позже без изменений в UI.
 *
 * Детали не поворачиваются в этой версии; учитывается пропил (kerf) и обрезка
 * листа по краям (trim). Группировка — по материалу.
 */
import type { CuttingPiece, CuttingSheet } from '@/core/model/types';
import type { CuttingEngine } from './CuttingEngine';
import type { CuttingInput, CuttingResult, StockSheet } from './types';

export class BasicShelfEngine implements CuttingEngine {
  readonly id = 'basic-shelf';
  readonly name = 'Базовый (полочный)';

  calculate(input: CuttingInput): CuttingResult {
    const { pieces, stock, kerf } = input;
    const sheets: CuttingSheet[] = [];
    const unplaced: CuttingPiece[] = [];
    let usedAreaMm2 = 0;

    // Группировка деталей по материалу.
    const byMaterial = new Map<string, CuttingPiece[]>();
    for (const piece of pieces) {
      const list = byMaterial.get(piece.materialId) ?? [];
      list.push(piece);
      byMaterial.set(piece.materialId, list);
    }

    let sheetIndex = 0;

    for (const [materialId, groupPieces] of byMaterial) {
      const stockSheet = stock.find((s) => s.materialId === materialId);
      if (!stockSheet) {
        unplaced.push(...groupPieces);
        continue;
      }

      const packed = this.packGroup(groupPieces, stockSheet, kerf, sheetIndex);
      sheets.push(...packed.sheets);
      unplaced.push(...packed.unplaced);
      usedAreaMm2 += packed.usedAreaMm2;
      sheetIndex += packed.sheets.length;
    }

    const sheetsUsed = sheets.length;
    const totalSheetArea = sheets.reduce((s, sh) => s + sh.length * sh.width, 0);
    const wasteAreaMm2 = Math.max(0, totalSheetArea - usedAreaMm2);
    const utilization = totalSheetArea > 0 ? usedAreaMm2 / totalSheetArea : 0;

    return {
      sheets,
      unplaced,
      summary: { sheetsUsed, usedAreaMm2, wasteAreaMm2, utilization },
    };
  }

  private packGroup(
    pieces: CuttingPiece[],
    stock: StockSheet,
    kerf: number,
    startIndex: number,
  ): { sheets: CuttingSheet[]; unplaced: CuttingPiece[]; usedAreaMm2: number } {
    const usableLen = stock.length - 2 * stock.trim;
    const usableWid = stock.width - 2 * stock.trim;
    const sheets: CuttingSheet[] = [];
    const unplaced: CuttingPiece[] = [];
    let usedAreaMm2 = 0;

    // Крупные детали — раньше (по «высоте» полки = width детали).
    const sorted = [...pieces].sort((a, b) => b.width - a.width || b.length - a.length);

    let current = this.newSheet(stock, startIndex + sheets.length);
    let cursorX = 0;
    let shelfY = 0;
    let shelfHeight = 0;

    const finalizeSheet = () => {
      if (current.placements.length > 0) sheets.push(current);
    };

    for (const piece of sorted) {
      // Деталь физически не помещается на лист.
      if (piece.length > usableLen || piece.width > usableWid) {
        unplaced.push(piece);
        continue;
      }

      const fitsCurrentShelf =
        cursorX + piece.length <= usableLen && shelfY + piece.width <= usableWid;

      if (!fitsCurrentShelf) {
        // Новая полка.
        shelfY += shelfHeight + (shelfHeight > 0 ? kerf : 0);
        cursorX = 0;
        shelfHeight = 0;

        if (shelfY + piece.width > usableWid) {
          // Новый лист.
          finalizeSheet();
          current = this.newSheet(stock, startIndex + sheets.length);
          shelfY = 0;
        }
      }

      current.placements.push({
        pieceId: piece.pieceId,
        partId: piece.partId,
        x: stock.trim + cursorX,
        y: stock.trim + shelfY,
        length: piece.length,
        width: piece.width,
        rotated: false,
      });
      usedAreaMm2 += piece.length * piece.width;
      cursorX += piece.length + kerf;
      shelfHeight = Math.max(shelfHeight, piece.width);
    }

    finalizeSheet();
    return { sheets, unplaced, usedAreaMm2 };
  }

  private newSheet(stock: StockSheet, index: number): CuttingSheet {
    return {
      materialId: stock.materialId,
      index,
      length: stock.length,
      width: stock.width,
      placements: [],
    };
  }
}
