/**
 * Геометрия сторон детали (§3/§9/§16/§20/§21).
 *
 * Сторона детали — ФИЗИЧЕСКАЯ, а не сторона экрана: «левая» остаётся левой
 * стороной панели и после того, как раскрой повернул деталь на листе.
 *
 * Соответствие стороны и размера едино для всей программы:
 *   left / right  — идут вдоль height детали;
 *   top  / bottom — идут вдоль width детали.
 */
import type { EdgeDirection, EdgeSide, Part } from '@/core/model/types';
import { EDGE_SIDES } from '@/core/model/types';

export { EDGE_SIDES };

/**
 * Единый символ кромки (§28). Одно обозначение во всех представлениях — 3D,
 * чертёж, карта раскроя, спецификация — чтобы «EB» везде значило одно и то же.
 * Какая именно сторона облицована, показывают коды L1–L4 на чертеже детали.
 */
export const EDGE_SYMBOL = 'EB';

/** Противоположная сторона. */
export const OPPOSITE_SIDE: Record<EdgeSide, EdgeSide> = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
};

export const SIDE_LABELS: Record<EdgeSide, string> = {
  top: 'Верх',
  bottom: 'Низ',
  left: 'Лево',
  right: 'Право',
};

/**
 * Длина стороны детали (§9). Для прямой стороны это длина соответствующего
 * ребра: у детали 800×300 левая сторона равна 300, верхняя — 800.
 */
export function sideLength(part: Pick<Part, 'width' | 'height'>, side: EdgeSide): number {
  return side === 'left' || side === 'right' ? part.height : part.width;
}

/**
 * Направление кромки (§20). Считается от геометрии, а не от названия стороны:
 * у детали 300×800 «верхняя» сторона идёт по короткому ребру.
 */
export function sideDirection(part: Pick<Part, 'width' | 'height'>, side: EdgeSide): EdgeDirection {
  const long = Math.max(part.width, part.height);
  return sideLength(part, side) >= long ? 'ALONG_LENGTH' : 'ALONG_WIDTH';
}

/**
 * Длинные стороны детали (§16). У квадратной детали длинных сторон нет —
 * иначе «кромить длинные» облицевало бы её целиком, чего пользователь не
 * ожидает; для такой детали есть действие «кромить все».
 */
export function longSides(part: Pick<Part, 'width' | 'height'>): EdgeSide[] {
  if (part.width === part.height) return [];
  return part.width > part.height ? ['top', 'bottom'] : ['left', 'right'];
}

/** Короткие стороны детали (§16). */
export function shortSides(part: Pick<Part, 'width' | 'height'>): EdgeSide[] {
  if (part.width === part.height) return [];
  return part.width > part.height ? ['left', 'right'] : ['top', 'bottom'];
}

/**
 * Пересчёт сторон при повороте детали в раскрое (§21/§24).
 *
 * Кромка приклеена к физической стороне панели, поэтому поворот не убирает и
 * не добавляет кромку — он лишь меняет то, где эта сторона видна на листе.
 * Поворот на 90° против часовой: левая сторона детали становится нижней на
 * карте, нижняя — правой и так далее.
 */
export function rotateSide(side: EdgeSide, rotation: number): EdgeSide {
  if (((rotation % 360) + 360) % 360 !== 90) return side;
  const map: Record<EdgeSide, EdgeSide> = {
    left: 'bottom',
    bottom: 'right',
    right: 'top',
    top: 'left',
  };
  return map[side];
}

/** Флаги сторон с кромкой, пересчитанные под поворот на карте раскроя. */
export function rotateSideFlags(
  flags: Record<EdgeSide, boolean>,
  rotation: number,
): Record<EdgeSide, boolean> {
  const out = { left: false, right: false, top: false, bottom: false };
  for (const side of EDGE_SIDES) out[rotateSide(side, rotation)] = flags[side];
  return out;
}
