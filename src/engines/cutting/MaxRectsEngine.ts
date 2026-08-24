/**
 * Движок раскроя на основе алгоритма MaxRects (Best Short Side Fit).
 *
 * Учитывает: рабочую область листа (лист − технологическая обрезка), ширину
 * пропила (kerf), направление текстуры и запрет поворота, зафиксированные
 * вручную детали, переиспользуемые остатки (перед новыми листами) и
 * ограниченный запас листов. Перебирает несколько стратегий сортировки (по
 * режиму оптимизации) и выбирает лучший вариант. Детерминирован.
 *
 * Это «оптимизированный вариант», а не доказанный глобальный оптимум.
 */
import type { CuttingEngine } from './CuttingEngine';
import { getSortStrategy, SORT_STRATEGIES } from './sort';
import {
  CuttingCancelledError,
  type CuttingInput,
  type CuttingPieceInstance,
  type CuttingResult,
  type CuttingRunControls,
  type CuttingSheetResult,
  type Placement,
  type PieceRotation,
  type UnplacedPiece,
} from './types';
import { extractRemnants } from './remnants';
import { computeCutLines } from './cutlines';
import { computeSheetStats, computeStatistics } from './metrics';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WorkSheet {
  index: number;
  usable: Rect; // рабочая область именно этого листа
  free: Rect[];
  placements: Placement[];
  fromRemnant: boolean;
  sourceId?: string; // StoredRemnant.id для остатка
}

const EPS = 1e-6;

function fullUsableRect(input: CuttingInput): Rect {
  return {
    x: input.trim.left,
    y: input.trim.bottom,
    w: input.sheet.length - input.trim.left - input.trim.right,
    h: input.sheet.width - input.trim.top - input.trim.bottom,
  };
}

function canRotate(piece: CuttingPieceInstance, respectGrain: boolean): boolean {
  if (!piece.allowRotate) return false;
  if (respectGrain && piece.grain !== 'none') return false;
  return true;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
}

function contains(a: Rect, b: Rect): boolean {
  return b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS;
}

function splitFree(f: Rect, o: Rect): Rect[] {
  if (!overlaps(f, o)) return [f];
  const out: Rect[] = [];
  if (o.x > f.x + EPS) out.push({ x: f.x, y: f.y, w: o.x - f.x, h: f.h });
  if (o.x + o.w < f.x + f.w - EPS) out.push({ x: o.x + o.w, y: f.y, w: f.x + f.w - (o.x + o.w), h: f.h });
  if (o.y > f.y + EPS) out.push({ x: f.x, y: f.y, w: f.w, h: o.y - f.y });
  if (o.y + o.h < f.y + f.h - EPS) out.push({ x: f.x, y: o.y + o.h, w: f.w, h: f.y + f.h - (o.y + o.h) });
  return out;
}

function pruneFree(rects: Rect[]): Rect[] {
  const kept: Rect[] = rects.filter((r) => r.w > 1 && r.h > 1);
  const result: Rect[] = [];
  for (let i = 0; i < kept.length; i++) {
    let contained = false;
    for (let j = 0; j < kept.length; j++) {
      if (i !== j && contains(kept[j], kept[i])) {
        if (!contains(kept[i], kept[j]) || i > j) {
          contained = true;
          break;
        }
      }
    }
    if (!contained) result.push(kept[i]);
  }
  return result;
}

function applyOccupied(sheet: WorkSheet, occ: Rect): void {
  const next: Rect[] = [];
  for (const f of sheet.free) next.push(...splitFree(f, occ));
  sheet.free = pruneFree(next);
}

interface Candidate {
  sheet: WorkSheet;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: PieceRotation;
  shortLeftover: number;
  longLeftover: number;
}

function orientations(piece: CuttingPieceInstance, respectGrain: boolean): Array<[number, number, PieceRotation]> {
  const base: Array<[number, number, PieceRotation]> = [[piece.length, piece.width, 0]];
  if (canRotate(piece, respectGrain) && piece.length !== piece.width) {
    base.push([piece.width, piece.length, 90]);
  }
  return base;
}

function findBest(sheets: WorkSheet[], piece: CuttingPieceInstance, respectGrain: boolean): Candidate | null {
  let best: Candidate | null = null;
  for (const sheet of sheets) {
    for (const rect of sheet.free) {
      for (const [w, h, rot] of orientations(piece, respectGrain)) {
        if (w <= rect.w + EPS && h <= rect.h + EPS) {
          const leftoverH = rect.w - w;
          const leftoverV = rect.h - h;
          const shortLeftover = Math.min(leftoverH, leftoverV);
          const longLeftover = Math.max(leftoverH, leftoverV);
          if (
            !best ||
            shortLeftover < best.shortLeftover - EPS ||
            (Math.abs(shortLeftover - best.shortLeftover) < EPS && longLeftover < best.longLeftover - EPS)
          ) {
            best = { sheet, x: rect.x, y: rect.y, w, h, rotation: rot, shortLeftover, longLeftover };
          }
        }
      }
    }
  }
  return best;
}

function place(sheet: WorkSheet, piece: CuttingPieceInstance, x: number, y: number, w: number, h: number, rotation: PieceRotation, kerf: number, origin: Placement['origin'], locked: boolean): void {
  sheet.placements.push({
    pieceId: piece.pieceId,
    partId: piece.partId,
    name: piece.name,
    number: piece.number,
    x,
    y,
    length: w,
    width: h,
    rotation,
    origin,
    locked,
  });
  applyOccupied(sheet, { x, y, w: w + kerf, h: h + kerf });
}

interface AttemptResult {
  sheets: WorkSheet[];
  unplaced: CuttingPieceInstance[];
  stockExceeded: boolean;
}

/** Одна попытка укладки с заданной стратегией сортировки. */
function packAttempt(input: CuttingInput, strategyId: string): AttemptResult {
  const fullUsable = fullUsableRect(input);
  const respectGrain = input.options.respectGrain;
  const kerf = input.kerf;
  const byId = new Map(input.pieces.map((p) => [p.pieceId, p]));
  const remnantSheets = input.remnantSheets ?? [];
  const maxFull = input.availableQuantity && input.availableQuantity > 0 ? input.availableQuantity : Infinity;

  const sheets: WorkSheet[] = [];
  let fullCount = 0;
  let stockExceeded = false;

  // Остатки — как предразмещённые листы фиксированного размера (индексы 0..R-1).
  for (const rs of remnantSheets) {
    const usable: Rect = { x: 0, y: 0, w: rs.length, h: rs.width };
    sheets.push({ index: sheets.length, usable, free: [{ ...usable }], placements: [], fromRemnant: true, sourceId: rs.id });
  }
  const remnantCount = sheets.length;

  const ensureFullSheet = (index: number): WorkSheet | null => {
    while (sheets.length <= index) {
      if (fullCount >= maxFull) {
        stockExceeded = true;
        return null;
      }
      sheets.push({ index: sheets.length, usable: { ...fullUsable }, free: [{ ...fullUsable }], placements: [], fromRemnant: false });
      fullCount++;
    }
    return sheets[index];
  };

  // 1) Зафиксированные вручную детали — сначала (на полные листы по индексу).
  const lockedIds = new Set<string>();
  for (const lp of input.locked ?? []) {
    const piece = byId.get(lp.pieceId);
    if (!piece) continue;
    const w = lp.rotation === 90 ? piece.width : piece.length;
    const h = lp.rotation === 90 ? piece.length : piece.width;
    const sheet = ensureFullSheet(remnantCount + lp.sheetIndex);
    if (!sheet) continue;
    place(sheet, piece, lp.x, lp.y, w, h, lp.rotation, kerf, 'manual', true);
    lockedIds.add(lp.pieceId);
  }

  // 2) Остальные детали — автоматически (сначала на остатки, затем новые листы).
  const remaining = [...input.pieces].filter((p) => !lockedIds.has(p.pieceId)).sort(getSortStrategy(strategyId).compare);

  const unplaced: CuttingPieceInstance[] = [];
  for (const piece of remaining) {
    let cand = findBest(sheets, piece, respectGrain);
    if (!cand) {
      const sheet = ensureFullSheet(sheets.length);
      if (!sheet) {
        unplaced.push(piece); // запас листов исчерпан
        continue;
      }
      cand = findBest([sheet], piece, respectGrain);
      if (!cand) {
        unplaced.push(piece); // не помещается даже на пустой лист
        if (sheet.placements.length === 0 && !sheet.fromRemnant) {
          sheets.pop();
          fullCount--;
        }
        continue;
      }
    }
    place(cand.sheet, piece, cand.x, cand.y, cand.w, cand.h, cand.rotation, kerf, 'automatic', false);
  }

  // Убираем пустые остатки-листы (без размещений) из результата.
  const nonEmpty = sheets.filter((s) => s.placements.length > 0);
  nonEmpty.forEach((s, i) => (s.index = i));
  return { sheets: nonEmpty, unplaced, stockExceeded };
}

function totalUsedArea(sheets: WorkSheet[]): number {
  return sheets.reduce((s, sh) => s + sh.placements.reduce((a, p) => a + p.length * p.width, 0), 0);
}
function totalSheetArea(sheets: WorkSheet[]): number {
  return sheets.reduce((s, sh) => s + sh.usable.w * sh.usable.h, 0);
}

/** Число попыток сортировки в зависимости от режима оптимизации. */
function attemptsForMode(input: CuttingInput): number {
  switch (input.options.optimizationMode) {
    case 'FAST':
      return 1;
    case 'MAX_UTILIZATION':
      return SORT_STRATEGIES.length;
    case 'BALANCED':
    default:
      return Math.min(Math.max(2, input.options.attempts), SORT_STRATEGIES.length);
  }
}

export class MaxRectsEngine implements CuttingEngine {
  readonly id = 'maxrects';
  readonly name = 'MaxRects (оптимизированный раскрой)';

  calculate(input: CuttingInput, controls?: CuttingRunControls): CuttingResult {
    const attempts = attemptsForMode(input);
    const order = [
      input.options.sortStrategy,
      ...SORT_STRATEGIES.map((s) => s.id).filter((id) => id !== input.options.sortStrategy),
    ].slice(0, attempts);

    let best: AttemptResult | null = null;
    // Оценка: меньше неразмещённых → меньше листов → выше использование.
    let bestScore = { unplaced: Infinity, sheets: Infinity, util: -Infinity };
    let attemptsRun = 0;

    for (let i = 0; i < order.length; i++) {
      if (controls?.shouldCancel?.()) throw new CuttingCancelledError();
      controls?.onProgress?.({ fraction: i / order.length, message: `Вариант ${i + 1} из ${order.length}…` });

      const attempt = packAttempt(input, order[i]);
      attemptsRun++;
      const sheetArea = totalSheetArea(attempt.sheets) || 1;
      const score = {
        unplaced: attempt.unplaced.length,
        sheets: attempt.sheets.length,
        util: totalUsedArea(attempt.sheets) / sheetArea,
      };
      const better =
        score.unplaced < bestScore.unplaced ||
        (score.unplaced === bestScore.unplaced && score.sheets < bestScore.sheets) ||
        (score.unplaced === bestScore.unplaced && score.sheets === bestScore.sheets && score.util > bestScore.util);
      if (!best || better) {
        best = attempt;
        bestScore = score;
      }
    }
    controls?.onProgress?.({ fraction: 1, message: 'Готово' });

    const chosen: AttemptResult = best ?? { sheets: [], unplaced: input.pieces, stockExceeded: false };
    const criteria = input.options.usableRemnant;

    const sheetResults: CuttingSheetResult[] = chosen.sheets.map((sh) => {
      const id = sh.fromRemnant
        ? `${input.materialId}-remnant-${sh.sourceId ?? sh.index + 1}`
        : `${input.materialId}-sheet-${sh.index + 1}`;
      const usableArea = sh.usable.w * sh.usable.h;
      const remnants = extractRemnants(sh.free, input.materialId, id, input.options.minRemnant, criteria);
      const stats = computeSheetStats(sh.placements, usableArea);
      const geomLen = sh.fromRemnant ? sh.usable.w : input.sheet.length;
      const geomWid = sh.fromRemnant ? sh.usable.h : input.sheet.width;
      const trim = sh.fromRemnant ? { left: 0, right: 0, top: 0, bottom: 0 } : input.trim;
      const cuts = computeCutLines(id, sh.placements, { length: geomLen, width: geomWid, trim }, input.kerf);
      return {
        id,
        materialId: input.materialId,
        index: sh.index,
        length: geomLen,
        width: geomWid,
        trim,
        placements: sh.placements,
        remnants,
        cuts,
        usableAreaMm2: usableArea,
        usedAreaMm2: stats.used,
        wasteAreaMm2: stats.waste,
        utilization: stats.utilization,
        sheetMaterialId: sh.fromRemnant ? sh.sourceId : input.sheetMaterialId,
        fromRemnant: sh.fromRemnant,
      };
    });

    const unplaced: UnplacedPiece[] = chosen.unplaced.map((p) => ({
      pieceId: p.pieceId,
      partId: p.partId,
      name: p.name,
      number: p.number,
      length: p.length,
      width: p.width,
      reason: chosen.stockExceeded
        ? 'Недостаточно материала (исчерпан запас листов).'
        : 'Не найдено допустимое свободное пространство с учётом ограничений.',
    }));

    const warnings: string[] = [];
    if (chosen.stockExceeded) {
      warnings.push(
        `Недостаточно листов в библиотеке для полного раскроя — не размещено ${unplaced.length} дет. Добавьте листы или увеличьте запас.`,
      );
    }

    return {
      materialId: input.materialId,
      sheets: sheetResults,
      unplaced,
      statistics: computeStatistics(input.materialId, sheetResults, unplaced.length),
      attemptsRun,
      warnings,
    };
  }
}
