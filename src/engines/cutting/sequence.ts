/**
 * Порядок резов и его воспроизведение (§84–§89).
 *
 * Линии реза уже вычисляются из расположения деталей (cutlines.ts). Здесь они
 * получают ПОРЯДОК: гильотинный распил идёт от сквозных резов к частным, и
 * этот порядок — то, что оператор видит на карте и что можно проиграть кадр
 * за кадром. Второго набора линий не создаётся.
 */
import type { CutLine, CuttingSheetResult, Placement } from '@/core/model/types';

export interface OrderedCut {
  id: string;
  /** Номер реза на листе, начиная с 1 (§88). */
  order: number;
  orientation: 'horizontal' | 'vertical';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Сквозной рез делит лист целиком — с него начинают (§86). */
  through: boolean;
  /** Длина реза, мм — по ней видно объём работы. */
  length: number;
}

const EPS = 0.5;

/** Проходит ли рез через весь лист (гильотинный сквозной рез). */
export function isThroughCut(cut: CutLine, sheet: { length: number; width: number }): boolean {
  if (cut.orientation === 'vertical') {
    return Math.abs(cut.y1) < EPS + 1 && Math.abs(cut.y2 - sheet.width) < EPS + 1;
  }
  return Math.abs(cut.x1) < EPS + 1 && Math.abs(cut.x2 - sheet.length) < EPS + 1;
}

/**
 * Упорядочить резы листа (§84/§86).
 *
 * Сначала сквозные резы (лист делится на полосы), затем частные — внутри
 * каждой группы слева направо и снизу вверх. Такой порядок повторяет работу
 * на форматно-раскроечном станке.
 */
export function orderCuts(sheet: CuttingSheetResult): OrderedCut[] {
  const geom = { length: sheet.length, width: sheet.width };
  const decorated = sheet.cuts.map((cut) => ({
    cut,
    through: isThroughCut(cut, geom),
    position: cut.orientation === 'vertical' ? cut.x1 : cut.y1,
  }));

  decorated.sort((a, b) => {
    if (a.through !== b.through) return a.through ? -1 : 1;
    if (a.cut.orientation !== b.cut.orientation) return a.cut.orientation === 'vertical' ? -1 : 1;
    return a.position - b.position || a.cut.id.localeCompare(b.cut.id);
  });

  return decorated.map((item, index) => ({
    id: item.cut.id,
    order: index + 1,
    orientation: item.cut.orientation,
    x1: item.cut.x1,
    y1: item.cut.y1,
    x2: item.cut.x2,
    y2: item.cut.y2,
    through: item.through,
    length: Math.hypot(item.cut.x2 - item.cut.x1, item.cut.y2 - item.cut.y1),
  }));
}

/** Проставить деталям порядковый номер в порядке съёма с листа (§84). */
export function orderPlacements(sheet: CuttingSheetResult): Placement[] {
  return [...sheet.placements]
    .sort((a, b) => a.y - b.y || a.x - b.x || a.pieceId.localeCompare(b.pieceId))
    .map((placement, index) => ({ ...placement, cutOrder: index + 1 }));
}

/**
 * Кадр воспроизведения резов (§89).
 *
 * Полная анимация не требуется: кадр описывает, какие резы уже сделаны и
 * какой выполняется сейчас, — этого достаточно и для проигрывания, и для
 * пошагового показа оператору.
 */
export interface CutFrame {
  step: number;
  /** Резы, выполненные к этому кадру. */
  done: string[];
  /** Рез, выполняемый в этом кадре; null — лист ещё цел. */
  current: OrderedCut | null;
  /** Доля выполнения, 0…1. */
  progress: number;
}

export function cutFrames(sheet: CuttingSheetResult): CutFrame[] {
  const cuts = orderCuts(sheet);
  const frames: CutFrame[] = [{ step: 0, done: [], current: null, progress: 0 }];
  cuts.forEach((cut, index) => {
    frames.push({
      step: index + 1,
      done: cuts.slice(0, index).map((c) => c.id),
      current: cut,
      progress: cuts.length === 0 ? 1 : (index + 1) / cuts.length,
    });
  });
  return frames;
}

/** Сводка по резам листа — сколько и какой длины (§85). */
export interface CutSummary {
  total: number;
  through: number;
  totalLengthMm: number;
}

export function cutSummary(sheet: CuttingSheetResult): CutSummary {
  const cuts = orderCuts(sheet);
  return {
    total: cuts.length,
    through: cuts.filter((c) => c.through).length,
    totalLengthMm: Math.round(cuts.reduce((sum, c) => sum + c.length, 0)),
  };
}
