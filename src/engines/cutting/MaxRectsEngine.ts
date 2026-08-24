/**
 * Движок раскроя на основе алгоритма MaxRects (Best Short Side Fit).
 *
 * Учитывает: рабочую область листа (лист − технологическая обрезка), ширину
 * пропила (kerf), направление текстуры и запрет поворота, зафиксированные
 * вручную детали. Перебирает несколько стратегий сортировки и выбирает лучший
 * вариант (минимум листов, затем максимум использования). Детерминирован.
 *
 * Это «расчётный вариант», а не доказанный глобальный оптимум.
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
} from './types';
import { extractRemnants } from './remnants';
import { computeSheetStats, computeStatistics } from './metrics';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WorkSheet {
  index: number;
  free: Rect[];
  placements: Placement[];
}

const EPS = 1e-6;

function usableRect(input: CuttingInput): Rect {
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

/** Разбить свободный прямоугольник F вычитанием занятого O. */
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
        // при равенстве оставляем только первый
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

/** Вычесть занятую область (с учётом пропила) из всех свободных прямоугольников. */
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

/** Одна попытка укладки с заданной стратегией сортировки. */
function packAttempt(input: CuttingInput, strategyId: string): { sheets: WorkSheet[]; unplaced: CuttingPieceInstance[] } {
  const usable = usableRect(input);
  const respectGrain = input.options.respectGrain;
  const kerf = input.kerf;
  const byId = new Map(input.pieces.map((p) => [p.pieceId, p]));

  const sheets: WorkSheet[] = [];
  const ensureSheet = (index: number): WorkSheet => {
    while (sheets.length <= index) {
      sheets.push({ index: sheets.length, free: [{ ...usable }], placements: [] });
    }
    return sheets[index];
  };

  // 1) Зафиксированные вручную детали — сначала.
  const lockedIds = new Set<string>();
  for (const lp of input.locked ?? []) {
    const piece = byId.get(lp.pieceId);
    if (!piece) continue;
    const w = lp.rotation === 90 ? piece.width : piece.length;
    const h = lp.rotation === 90 ? piece.length : piece.width;
    const sheet = ensureSheet(lp.sheetIndex);
    place(sheet, piece, lp.x, lp.y, w, h, lp.rotation, kerf, 'manual', true);
    lockedIds.add(lp.pieceId);
  }

  // 2) Остальные детали — автоматически.
  const remaining = getSortStrategy(strategyId).compare
    ? [...input.pieces].filter((p) => !lockedIds.has(p.pieceId)).sort(getSortStrategy(strategyId).compare)
    : input.pieces;

  const unplaced: CuttingPieceInstance[] = [];
  for (const piece of remaining) {
    let cand = findBest(sheets, piece, respectGrain);
    if (!cand) {
      // Новый лист.
      const sheet = ensureSheet(sheets.length);
      cand = findBest([sheet], piece, respectGrain);
      if (!cand) {
        unplaced.push(piece); // не помещается даже на пустой лист
        // удаляем только что созданный пустой лист, если он пуст
        if (sheet.placements.length === 0) sheets.pop();
        continue;
      }
    }
    place(cand.sheet, piece, cand.x, cand.y, cand.w, cand.h, cand.rotation, kerf, 'automatic', false);
  }

  return { sheets, unplaced };
}

function totalUtilization(sheets: WorkSheet[], usableArea: number): number {
  if (sheets.length === 0) return 0;
  const used = sheets.reduce((s, sh) => s + sh.placements.reduce((a, p) => a + p.length * p.width, 0), 0);
  return used / (sheets.length * usableArea);
}

export class MaxRectsEngine implements CuttingEngine {
  readonly id = 'maxrects';
  readonly name = 'MaxRects (расчётный вариант)';

  calculate(input: CuttingInput, controls?: CuttingRunControls): CuttingResult {
    const usable = usableRect(input);
    const usableArea = Math.max(0, usable.w) * Math.max(0, usable.h);
    const attempts = Math.max(1, Math.min(input.options.attempts, SORT_STRATEGIES.length));

    // Первая стратегия — заданная; далее остальные для поиска лучшего варианта.
    const order = [
      input.options.sortStrategy,
      ...SORT_STRATEGIES.map((s) => s.id).filter((id) => id !== input.options.sortStrategy),
    ].slice(0, attempts);

    let best: { sheets: WorkSheet[]; unplaced: CuttingPieceInstance[] } | null = null;
    let bestScore = { sheets: Infinity, util: -Infinity };
    let attemptsRun = 0;

    for (let i = 0; i < order.length; i++) {
      if (controls?.shouldCancel?.()) throw new CuttingCancelledError();
      controls?.onProgress?.({ fraction: i / order.length, message: `Вариант ${i + 1} из ${order.length}…` });

      const attempt = packAttempt(input, order[i]);
      attemptsRun++;
      const score = {
        sheets: attempt.sheets.length + attempt.unplaced.length * 1000, // неразмещённые — худший вариант
        util: totalUtilization(attempt.sheets, usableArea || 1),
      };
      if (score.sheets < bestScore.sheets || (score.sheets === bestScore.sheets && score.util > bestScore.util)) {
        best = attempt;
        bestScore = score;
      }
    }
    controls?.onProgress?.({ fraction: 1, message: 'Готово' });

    const chosen = best ?? { sheets: [], unplaced: input.pieces };

    const sheetResults: CuttingSheetResult[] = chosen.sheets.map((sh) => {
      const id = `${input.materialId}-sheet-${sh.index + 1}`;
      const remnants = extractRemnants(sh.free, input.materialId, id, input.options.minRemnant);
      const stats = computeSheetStats(sh.placements, usableArea);
      return {
        id,
        materialId: input.materialId,
        index: sh.index,
        length: input.sheet.length,
        width: input.sheet.width,
        trim: input.trim,
        placements: sh.placements,
        remnants,
        usableAreaMm2: usableArea,
        usedAreaMm2: stats.used,
        wasteAreaMm2: stats.waste,
        utilization: stats.utilization,
      };
    });

    return {
      materialId: input.materialId,
      sheets: sheetResults,
      unplaced: chosen.unplaced,
      statistics: computeStatistics(input.materialId, sheetResults, chosen.unplaced.length),
      attemptsRun,
    };
  }
}
