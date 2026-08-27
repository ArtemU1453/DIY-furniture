/**
 * Сборка результата раскроя из уложенных листов.
 *
 * Общая часть для движков: остатки, статистика листа, порядок реза, линии
 * реза, коды причин неразмещения. Алгоритм отвечает только за то, КУДА
 * положить деталь; форма результата у всех движков одна.
 */
import type { CuttingRemnant, CuttingSheetResult, Placement, UnplacedPiece } from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';
import { extractRemnants } from './remnants';
import { computeCutLines } from './cutlines';
import { computeSheetStats, computeStatistics } from './metrics';
import { sheetFormats, type SheetFormat } from './formats';
import { toUnplaced } from './unplaced';
import type { CuttingInput, CuttingPieceInstance, CuttingResult } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Лист в процессе укладки — то, что движок передаёт на сборку. */
export interface PackedSheet {
  index: number;
  /** Рабочая область листа (лист − обрезка). */
  usable: Rect;
  placements: Placement[];
  fromRemnant: boolean;
  /** StoredRemnant.id для остатка. */
  sourceId?: string;
  fmt?: SheetFormat;
  /** Свободные прямоугольники для извлечения остатков (§65/§73). */
  free: Rect[];
}

export interface PackedResult {
  sheets: PackedSheet[];
  unplaced: CuttingPieceInstance[];
  stockExceeded: boolean;
  attemptsRun: number;
}

/** Стабильный id листа результата. */
export function sheetResultId(materialId: MaterialId, sheet: PackedSheet): string {
  return sheet.fromRemnant
    ? `${materialId}-remnant-${sheet.sourceId ?? sheet.index + 1}`
    : `${materialId}-sheet-${sheet.index + 1}`;
}

function toSheetResult(sheet: PackedSheet, input: CuttingInput): CuttingSheetResult {
  const id = sheetResultId(input.materialId, sheet);
  const usableAreaMm2 = sheet.usable.w * sheet.usable.h;
  const remnants: CuttingRemnant[] = extractRemnants(
    sheet.free,
    input.materialId,
    id,
    input.options.minRemnant,
    input.options.usableRemnant,
  );
  const remnantArea = remnants.filter((r) => r.usable).reduce((a, r) => a + r.area, 0);
  const stats = computeSheetStats(sheet.placements, usableAreaMm2, remnantArea);

  // Порядок реза: снизу вверх, слева направо (§99/§100).
  [...sheet.placements].sort((a, b) => a.y - b.y || a.x - b.x).forEach((pl, i) => {
    pl.cutOrder = i + 1;
    pl.sheetId = id;
  });

  const length = sheet.fromRemnant ? sheet.usable.w : (sheet.fmt?.length ?? input.sheet.length);
  const width = sheet.fromRemnant ? sheet.usable.h : (sheet.fmt?.width ?? input.sheet.width);
  const trim = sheet.fromRemnant ? { left: 0, right: 0, top: 0, bottom: 0 } : input.trim;

  return {
    id,
    materialId: input.materialId,
    index: sheet.index,
    length,
    width,
    trim,
    placements: sheet.placements,
    remnants,
    cuts: computeCutLines(id, sheet.placements, { length, width, trim }, input.kerf),
    usableAreaMm2,
    usedAreaMm2: stats.used,
    remnantAreaMm2: stats.remnant,
    wasteAreaMm2: stats.waste,
    utilization: stats.utilization,
    sheetMaterialId: sheet.fromRemnant ? sheet.sourceId : (sheet.fmt?.id ?? input.sheetMaterialId),
    fromRemnant: sheet.fromRemnant,
  };
}

/** Собрать результат раскроя одного материала. */
export function assembleResult(
  input: CuttingInput,
  packed: PackedResult,
  canRotate: (piece: CuttingPieceInstance) => boolean,
): CuttingResult {
  const sheets = packed.sheets.map((sh) => toSheetResult(sh, input));
  const formats = sheetFormats(input);
  const unplaced: UnplacedPiece[] = packed.unplaced.map((p) =>
    toUnplaced(p, formats, canRotate(p), packed.stockExceeded),
  );

  const warnings: string[] = [];
  if (packed.stockExceeded) {
    warnings.push(
      `Недостаточно листов в библиотеке для полного раскроя — не размещено ${unplaced.length} дет. Добавьте листы или увеличьте запас.`,
    );
  }

  return {
    materialId: input.materialId,
    sheets,
    unplaced,
    statistics: computeStatistics(input.materialId, sheets, unplaced.length),
    attemptsRun: packed.attemptsRun,
    warnings,
  };
}
