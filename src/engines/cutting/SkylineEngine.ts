/**
 * SKYLINE — укладка по «линии горизонта» (Bottom-Left).
 *
 * Занятая часть листа описывается ступенчатым профилем: массивом отрезков
 * (x, ширина, высота). Деталь ставится в позицию с наименьшей достижимой
 * высотой, при равенстве — левее. После установки профиль поднимается на
 * высоту детали.
 *
 * Памяти требует линейно от числа ступеней (а не от числа свободных
 * прямоугольников), поэтому устойчиво держит раскрой на тысячах деталей
 * (§122). Точность ниже MaxRects: движком по умолчанию не является (§30).
 */
import type { CuttingEngine } from './CuttingEngine';
import {
  CuttingCancelledError,
  type CuttingInput,
  type CuttingPieceInstance,
  type CuttingResult,
  type CuttingRunControls,
  type PieceRotation,
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

/** Ступень профиля: от x до x+w занято до высоты y. */
interface Step {
  x: number;
  w: number;
  y: number;
}

interface SkylineSheet extends PackedSheet {
  steps: Step[];
}

function newSheet(index: number, usable: Rect, fromRemnant: boolean, extra: Partial<SkylineSheet> = {}): SkylineSheet {
  return {
    index,
    usable,
    placements: [],
    fromRemnant,
    free: [],
    steps: [{ x: usable.x, w: usable.w, y: usable.y }],
    ...extra,
  };
}

/** Высота, на которую встанет деталь шириной w, начиная со ступени i. */
function levelAt(steps: Step[], i: number, w: number, limitX: number): number | null {
  if (steps[i].x + w > limitX + EPS) return null;
  let y = steps[i].y;
  let rest = w;
  for (let k = i; k < steps.length && rest > EPS; k++) {
    y = Math.max(y, steps[k].y);
    rest -= steps[k].w;
  }
  if (rest > EPS) return null; // профиль кончился раньше детали
  return y;
}

/** Поднять профиль под прямоугольником [x, x+w) до высоты top. */
function raise(steps: Step[], x: number, w: number, top: number): void {
  const out: Step[] = [];
  for (const s of steps) {
    const left = Math.max(s.x, x);
    const right = Math.min(s.x + s.w, x + w);
    if (right <= left + EPS) {
      out.push(s);
      continue;
    }
    if (s.x < left - EPS) out.push({ x: s.x, w: left - s.x, y: s.y });
    if (s.x + s.w > right + EPS) out.push({ x: right, w: s.x + s.w - right, y: s.y });
  }
  out.push({ x, w, y: top });
  out.sort((a, b) => a.x - b.x);

  // Слить соседние ступени одной высоты — профиль не должен разрастаться.
  steps.length = 0;
  for (const s of out) {
    const prev = steps[steps.length - 1];
    if (prev && Math.abs(prev.y - s.y) < EPS && Math.abs(prev.x + prev.w - s.x) < EPS) prev.w += s.w;
    else steps.push({ ...s });
  }
}

interface Spot {
  sheet: SkylineSheet;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: PieceRotation;
}

function bestSpot(sheets: SkylineSheet[], piece: CuttingPieceInstance, respectGrain: boolean): Spot | null {
  const options: Array<[number, number, PieceRotation]> = [[piece.length, piece.width, 0]];
  if (canRotate(piece, respectGrain) && piece.length !== piece.width) options.push([piece.width, piece.length, 90]);

  let best: Spot | null = null;
  for (const sheet of sheets) {
    const limitX = sheet.usable.x + sheet.usable.w;
    const limitY = sheet.usable.y + sheet.usable.h;
    for (let i = 0; i < sheet.steps.length; i++) {
      for (const [w, h, rot] of options) {
        const y = levelAt(sheet.steps, i, w, limitX);
        if (y === null || y + h > limitY + EPS) continue;
        const x = sheet.steps[i].x;
        if (!best || y < best.y - EPS || (Math.abs(y - best.y) < EPS && x < best.x - EPS)) {
          best = { sheet, x, y, w, h, rotation: rot };
        }
      }
    }
  }
  return best;
}

/** Свободные прямоугольники над профилем — кандидаты в остатки (§65). */
function freeRects(sheet: SkylineSheet, spacing: number): Rect[] {
  const top = sheet.usable.y + sheet.usable.h;
  return sheet.steps
    .map((s) => ({ x: s.x, y: s.y, w: s.w, h: top - s.y }))
    .filter((r) => r.w > spacing && r.h > spacing);
}

function pack(input: CuttingInput): PackedResult {
  const respectGrain = input.options.respectGrain;
  const spacing = spacingOf({ kerf: input.kerf, minGap: input.minGap });
  const maxFull = input.availableQuantity && input.availableQuantity > 0 ? input.availableQuantity : Infinity;
  const formats = sheetFormats(input);
  const byId = new Map(input.pieces.map((p) => [p.pieceId, p]));

  const sheets: SkylineSheet[] = [];
  let fullCount = 0;
  let stockExceeded = false;

  for (const rs of input.remnantSheets ?? []) {
    sheets.push(newSheet(sheets.length, { x: 0, y: 0, w: rs.length, h: rs.width }, true, { sourceId: rs.id }));
  }
  const remnantCount = sheets.length;

  const ensureFullSheet = (index: number, piece?: CuttingPieceInstance): SkylineSheet | null => {
    while (sheets.length <= index) {
      if (fullCount >= maxFull) {
        stockExceeded = true;
        return null;
      }
      const fmt = piece ? formatForPiece(formats, piece, canRotate(piece, respectGrain)) : formats[0];
      sheets.push(newSheet(sheets.length, { ...fmt.usable }, false, { fmt }));
      fullCount++;
    }
    return sheets[index];
  };

  const put = (spot: Spot, piece: CuttingPieceInstance, origin: 'automatic' | 'manual', locked: boolean): void => {
    spot.sheet.placements.push({
      pieceId: piece.pieceId,
      partId: piece.partId,
      name: piece.name,
      number: piece.number,
      x: spot.x,
      y: spot.y,
      length: spot.w,
      width: spot.h,
      rotation: spot.rotation,
      origin,
      locked,
      grainDirection: piece.grain,
    });
    // Под деталью профиль поднимается на её высоту плюс пропил и зазор.
    // Ширина подъёма ограничена листом: профиль не должен выходить за него.
    const limitX = spot.sheet.usable.x + spot.sheet.usable.w;
    const raiseW = Math.min(spot.w + spacing, limitX - spot.x);
    raise(spot.sheet.steps, spot.x, raiseW, spot.y + spot.h + spacing);
  };

  // Зафиксированные вручную детали ставятся точно и поднимают профиль.
  const lockedIds = new Set<string>();
  for (const lp of input.locked ?? []) {
    const piece = byId.get(lp.pieceId);
    if (!piece) continue;
    const sheet = ensureFullSheet(remnantCount + lp.sheetIndex);
    if (!sheet) continue;
    const w = lp.rotation === 90 ? piece.width : piece.length;
    const h = lp.rotation === 90 ? piece.length : piece.width;
    put({ sheet, x: lp.x, y: lp.y, w, h, rotation: lp.rotation }, piece, 'manual', true);
    lockedIds.add(lp.pieceId);
  }

  // Детерминированный порядок: крупные детали первыми (§32).
  const remaining = input.pieces
    .filter((p) => !lockedIds.has(p.pieceId))
    .slice()
    .sort((a, b) =>
      b.length * b.width - a.length * a.width ||
      Math.max(b.length, b.width) - Math.max(a.length, a.width) ||
      a.pieceId.localeCompare(b.pieceId),
    );

  const unplaced: CuttingPieceInstance[] = [];
  for (const piece of remaining) {
    let spot = bestSpot(sheets, piece, respectGrain);
    if (!spot) {
      const sheet = ensureFullSheet(sheets.length, piece);
      if (!sheet) {
        unplaced.push(piece);
        continue;
      }
      spot = bestSpot([sheet], piece, respectGrain);
      if (!spot) {
        unplaced.push(piece);
        if (sheet.placements.length === 0 && !sheet.fromRemnant) {
          sheets.pop();
          fullCount--;
        }
        continue;
      }
    }
    put(spot, piece, 'automatic', false);
  }

  const nonEmpty = sheets.filter((s) => s.placements.length > 0);
  nonEmpty.forEach((s, i) => {
    s.index = i;
    s.free = freeRects(s, spacing);
  });
  return { sheets: nonEmpty, unplaced, stockExceeded, attemptsRun: 1 };
}

export class SkylineEngine implements CuttingEngine {
  readonly id = 'skyline';
  readonly name = 'Skyline (быстрый раскрой больших партий)';
  readonly version = '1.0';

  calculate(input: CuttingInput, controls?: CuttingRunControls): CuttingResult {
    if (controls?.shouldCancel?.()) throw new CuttingCancelledError();
    controls?.onProgress?.({ fraction: 0, message: 'Укладка по линии горизонта…' });
    const packed = pack(input);
    if (controls?.shouldCancel?.()) throw new CuttingCancelledError();
    controls?.onProgress?.({ fraction: 1, message: 'Готово' });
    return assembleResult(input, packed, (p) => canRotate(p, input.options.respectGrain));
  }
}
