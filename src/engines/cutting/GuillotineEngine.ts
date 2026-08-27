/**
 * Движок раскроя GUILLOTINE — прямолинейный последовательный раскрой.
 *
 * Каждое размещение делит свободный прямоугольник ОДНИМ сквозным резом
 * (вертикальным или горизонтальным), как на форматно-раскроечном станке.
 * В отличие от MaxRects свободные области не перекрываются: это гарантирует
 * физическую выполнимость реза на пиле.
 *
 * Учитывает: рабочую область (лист − припуск), пропил (kerf), направление
 * текстуры и запрет поворота, зафиксированные вручную детали, остатки и
 * ограниченный запас листов. Детерминирован.
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
import { spacingOf } from './profile';
import { computeSheetStats, computeStatistics } from './metrics';
import { sheetFormats, formatForPiece, type SheetFormat } from './formats';
import { toUnplaced } from './unplaced';

interface Rect { x: number; y: number; w: number; h: number }

interface WorkSheet {
  index: number;
  usable: Rect;
  free: Rect[]; // непересекающиеся свободные прямоугольники
  placements: Placement[];
  fromRemnant: boolean;
  sourceId?: string;
  /** Формат листа (может отличаться от предпочтительного — §23). */
  fmt?: SheetFormat;
}

const EPS = 1e-6;

function canRotate(piece: CuttingPieceInstance, respectGrain: boolean): boolean {
  if (!piece.allowRotate) return false;
  if (respectGrain && piece.grain !== 'none') return false;
  return true;
}

function orientations(piece: CuttingPieceInstance, respectGrain: boolean): Array<[number, number, PieceRotation]> {
  const base: Array<[number, number, PieceRotation]> = [[piece.length, piece.width, 0]];
  if (canRotate(piece, respectGrain) && piece.length !== piece.width) {
    base.push([piece.width, piece.length, 90]);
  }
  return base;
}

/**
 * Гильотинное деление: занятая область отрезается сквозным резом. Выбираем
 * направление реза по правилу «оставить более крупный полезный кусок»
 * (Shorter Axis Split — детерминированное правило).
 */
function guillotineSplit(free: Rect, w: number, h: number, kerf: number): Rect[] {
  const right = free.w - w - kerf;   // остаток справа от детали
  const above = free.h - h - kerf;   // остаток сверху от детали
  const out: Rect[] = [];
  // Горизонтальный рез (делим по высоте детали): справа — узкая полоса высотой h.
  const horizontal = right * h >= above * w;
  if (horizontal) {
    if (right > EPS) out.push({ x: free.x + w + kerf, y: free.y, w: right, h });
    if (above > EPS) out.push({ x: free.x, y: free.y + h + kerf, w: free.w, h: above });
  } else {
    if (right > EPS) out.push({ x: free.x + w + kerf, y: free.y, w: right, h: free.h });
    if (above > EPS) out.push({ x: free.x, y: free.y + h + kerf, w, h: above });
  }
  return out.filter((r) => r.w > 1 && r.h > 1);
}

interface Candidate {
  sheet: WorkSheet;
  freeIndex: number;
  w: number;
  h: number;
  rotation: PieceRotation;
  waste: number;
}

/** Best-fit: свободный прямоугольник с минимальным остатком площади. */
function findBest(sheets: WorkSheet[], piece: CuttingPieceInstance, respectGrain: boolean): Candidate | null {
  let best: Candidate | null = null;
  for (const sheet of sheets) {
    for (let i = 0; i < sheet.free.length; i++) {
      const rect = sheet.free[i];
      for (const [w, h, rot] of orientations(piece, respectGrain)) {
        if (w <= rect.w + EPS && h <= rect.h + EPS) {
          const waste = rect.w * rect.h - w * h;
          if (!best || waste < best.waste - EPS) {
            best = { sheet, freeIndex: i, w, h, rotation: rot, waste };
          }
        }
      }
    }
  }
  return best;
}

function placeAt(sheet: WorkSheet, piece: CuttingPieceInstance, cand: Candidate, kerf: number, origin: Placement['origin'], locked: boolean): void {
  const free = sheet.free[cand.freeIndex];
  sheet.placements.push({
    pieceId: piece.pieceId,
    partId: piece.partId,
    name: piece.name,
    number: piece.number,
    x: free.x,
    y: free.y,
    length: cand.w,
    width: cand.h,
    rotation: cand.rotation,
    origin,
    locked,
  });
  const parts = guillotineSplit(free, cand.w, cand.h, kerf);
  sheet.free.splice(cand.freeIndex, 1, ...parts);
}

interface AttemptResult {
  sheets: WorkSheet[];
  unplaced: CuttingPieceInstance[];
  stockExceeded: boolean;
}

function packAttempt(input: CuttingInput, strategyId: string): AttemptResult {
  const respectGrain = input.options.respectGrain;
  // Вокруг детали резервируется пропил ПЛЮС технологический зазор (§38/§39).
  const kerf = spacingOf({ kerf: input.kerf, minGap: input.minGap });
  const byId = new Map(input.pieces.map((p) => [p.pieceId, p]));
  const maxFull = input.availableQuantity && input.availableQuantity > 0 ? input.availableQuantity : Infinity;

  const sheets: WorkSheet[] = [];
  let fullCount = 0;
  let stockExceeded = false;

  for (const rs of input.remnantSheets ?? []) {
    const usable: Rect = { x: 0, y: 0, w: rs.length, h: rs.width };
    sheets.push({ index: sheets.length, usable, free: [{ ...usable }], placements: [], fromRemnant: true, sourceId: rs.id });
  }
  const remnantCount = sheets.length;

  const formats = sheetFormats(input);
  /** Создать лист под деталь: формат подбирается по приоритету (§23/§24). */
  const ensureFullSheet = (index: number, piece?: CuttingPieceInstance): WorkSheet | null => {
    while (sheets.length <= index) {
      if (fullCount >= maxFull) {
        stockExceeded = true;
        return null;
      }
      const rotatable = piece ? canRotate(piece, respectGrain) : false;
      const fmt = piece ? formatForPiece(formats, piece, rotatable) : formats[0];
      const usable = { ...fmt.usable };
      sheets.push({ index: sheets.length, usable, free: [{ ...usable }], placements: [], fromRemnant: false, fmt });
      fullCount++;
    }
    return sheets[index];
  };

  // Зафиксированные вручную детали размещаются первыми и не двигаются.
  const lockedIds = new Set<string>();
  for (const lp of input.locked ?? []) {
    const piece = byId.get(lp.pieceId);
    if (!piece) continue;
    const sheet = ensureFullSheet(remnantCount + lp.sheetIndex);
    if (!sheet) continue;
    const w = lp.rotation === 90 ? piece.width : piece.length;
    const h = lp.rotation === 90 ? piece.length : piece.width;
    sheet.placements.push({
      pieceId: piece.pieceId, partId: piece.partId, name: piece.name, number: piece.number,
      x: lp.x, y: lp.y, length: w, width: h, rotation: lp.rotation, origin: 'manual', locked: true,
    });
    // Вычитаем занятую область из свободных (гильотинно, по каждому пересечению).
    const occ: Rect = { x: lp.x, y: lp.y, w: w + kerf, h: h + kerf };
    const next: Rect[] = [];
    for (const f of sheet.free) {
      const inter = f.x < occ.x + occ.w && f.x + f.w > occ.x && f.y < occ.y + occ.h && f.y + f.h > occ.y;
      if (!inter) { next.push(f); continue; }
      if (occ.x - f.x > EPS) next.push({ x: f.x, y: f.y, w: occ.x - f.x, h: f.h });
      if (f.x + f.w - (occ.x + occ.w) > EPS) next.push({ x: occ.x + occ.w, y: f.y, w: f.x + f.w - (occ.x + occ.w), h: f.h });
      if (occ.y - f.y > EPS) next.push({ x: Math.max(f.x, occ.x), y: f.y, w: Math.min(f.x + f.w, occ.x + occ.w) - Math.max(f.x, occ.x), h: occ.y - f.y });
      if (f.y + f.h - (occ.y + occ.h) > EPS) next.push({ x: Math.max(f.x, occ.x), y: occ.y + occ.h, w: Math.min(f.x + f.w, occ.x + occ.w) - Math.max(f.x, occ.x), h: f.y + f.h - (occ.y + occ.h) });
    }
    sheet.free = next.filter((r) => r.w > 1 && r.h > 1);
    lockedIds.add(lp.pieceId);
  }

  const remaining = [...input.pieces].filter((p) => !lockedIds.has(p.pieceId)).sort(getSortStrategy(strategyId).compare);
  const unplaced: CuttingPieceInstance[] = [];
  for (const piece of remaining) {
    let cand = findBest(sheets, piece, respectGrain);
    if (!cand) {
      const sheet = ensureFullSheet(sheets.length, piece);
      if (!sheet) { unplaced.push(piece); continue; }
      cand = findBest([sheet], piece, respectGrain);
      if (!cand) {
        unplaced.push(piece);
        if (sheet.placements.length === 0 && !sheet.fromRemnant) { sheets.pop(); fullCount--; }
        continue;
      }
    }
    placeAt(cand.sheet, piece, cand, kerf, 'automatic', false);
  }

  const nonEmpty = sheets.filter((s) => s.placements.length > 0);
  nonEmpty.forEach((s, i) => (s.index = i));
  return { sheets: nonEmpty, unplaced, stockExceeded };
}

function attemptsForMode(input: CuttingInput): number {
  switch (input.options.optimizationMode) {
    case 'FAST': return 1;
    case 'MAX_UTILIZATION': return SORT_STRATEGIES.length;
    case 'BALANCED':
    default: return Math.min(Math.max(2, input.options.attempts), SORT_STRATEGIES.length);
  }
}

export class GuillotineEngine implements CuttingEngine {
  readonly id = 'guillotine';
  readonly name = 'Guillotine (прямолинейный раскрой)';
  readonly version = '1.0';

  calculate(input: CuttingInput, controls?: CuttingRunControls): CuttingResult {
    const attempts = attemptsForMode(input);
    const order = [
      input.options.sortStrategy,
      ...SORT_STRATEGIES.map((s) => s.id).filter((id) => id !== input.options.sortStrategy),
    ].slice(0, attempts);

    let best: AttemptResult | null = null;
    // Приоритет: 1) меньше неразмещённых, 2) меньше листов, 3) выше использование.
    let bestScore = { unplaced: Infinity, sheets: Infinity, util: -Infinity };
    let attemptsRun = 0;

    for (let i = 0; i < order.length; i++) {
      if (controls?.shouldCancel?.()) throw new CuttingCancelledError();
      controls?.onProgress?.({ fraction: i / order.length, message: `Guillotine: вариант ${i + 1} из ${order.length}…` });
      const attempt = packAttempt(input, order[i]);
      attemptsRun++;
      const sheetArea = attempt.sheets.reduce((a, s) => a + s.usable.w * s.usable.h, 0) || 1;
      const used = attempt.sheets.reduce((a, s) => a + s.placements.reduce((k, p) => k + p.length * p.width, 0), 0);
      const score = { unplaced: attempt.unplaced.length, sheets: attempt.sheets.length, util: used / sheetArea };
      const better =
        score.unplaced < bestScore.unplaced ||
        (score.unplaced === bestScore.unplaced && score.sheets < bestScore.sheets) ||
        (score.unplaced === bestScore.unplaced && score.sheets === bestScore.sheets && score.util > bestScore.util);
      if (!best || better) { best = attempt; bestScore = score; }
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
      const remnantArea = remnants.filter((r) => r.usable).reduce((a, r) => a + r.area, 0);
      const stats = computeSheetStats(sh.placements, usableArea, remnantArea);
      const ordered = [...sh.placements].sort((a, b) => a.y - b.y || a.x - b.x);
      ordered.forEach((pl, i) => { pl.cutOrder = i + 1; });
      const geomLen = sh.fromRemnant ? sh.usable.w : (sh.fmt?.length ?? input.sheet.length);
      const geomWid = sh.fromRemnant ? sh.usable.h : (sh.fmt?.width ?? input.sheet.width);
      const trim = sh.fromRemnant ? { left: 0, right: 0, top: 0, bottom: 0 } : input.trim;
      return {
        id, materialId: input.materialId, index: sh.index,
        length: geomLen, width: geomWid, trim,
        placements: sh.placements, remnants,
        cuts: computeCutLines(id, sh.placements, { length: geomLen, width: geomWid, trim }, input.kerf),
        usableAreaMm2: usableArea,
        usedAreaMm2: stats.used,
        remnantAreaMm2: stats.remnant,
        wasteAreaMm2: stats.waste,
        utilization: stats.utilization,
        sheetMaterialId: sh.fromRemnant ? sh.sourceId : (sh.fmt?.id ?? input.sheetMaterialId),
        fromRemnant: sh.fromRemnant,
      };
    });

    // Причина кодируется, а не описывается строкой (§35): у «деталь больше
    // листа», «нет места» и «кончился запас» разные решения.
    const allFormats = sheetFormats(input);
    const unplaced: UnplacedPiece[] = chosen.unplaced.map((p) =>
      toUnplaced(p, allFormats, canRotate(p, input.options.respectGrain), chosen.stockExceeded),
    );

    const warnings: string[] = [];
    if (chosen.stockExceeded) {
      warnings.push(`Недостаточно листов в библиотеке — не размещено ${unplaced.length} дет.`);
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
