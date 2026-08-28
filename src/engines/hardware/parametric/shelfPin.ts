/**
 * Полкодержатель и ряд присадочных отверстий (§38–§44).
 *
 * Ряд строится по системе 32 мм: количество отверстий вычисляется из высоты
 * детали и отступов, а не задаётся руками.
 */
import type { HardwareKindSpec, ParametricContext, ParametricResult, TemplateOperation } from './types';
import { clamp, faceSize, num, str } from './types';

export const SHELF_PIN_DEFAULTS = {
  diameter: 5,
  depth: 12,
  /** Шаг ряда, мм (§42). */
  rowSpacing: 32,
  /** Отступ ряда от переднего/заднего края детали, мм (§39). */
  edgeOffset: 37,
  topOffset: 100,
  bottomOffset: 100,
  side: 'left',
  /** Два ряда: спереди и сзади. */
  rows: 2,
} as const;

/** Количество отверстий в ряду (§41). */
export function pinRowCount(height: number, topOffset: number, bottomOffset: number, spacing: number): number {
  const usable = height - topOffset - bottomOffset;
  if (usable <= 0 || spacing <= 0) return 0;
  return Math.floor(usable / spacing) + 1;
}

/** Высоты отверстий ряда (§40/§43). */
export function pinRowPositions(
  height: number,
  topOffset: number,
  bottomOffset: number,
  spacing: number,
): number[] {
  const count = pinRowCount(height, topOffset, bottomOffset, spacing);
  return Array.from({ length: count }, (_, i) => clamp(bottomOffset + i * spacing, 0, height));
}

export const shelfPinSpec: HardwareKindSpec = {
  kind: 'SHELF_PIN',
  label: 'Полкодержатель',
  /* Ряд сверлится по ПЛАСТИ боковины: в системе детали это front/back. */
  defaultFace: 'front',
  defaults: { ...SHELF_PIN_DEFAULTS },
  placement: { reference: 'EDGE', from: 'bottom', offset: SHELF_PIN_DEFAULTS.bottomOffset },

  resolve(ctx: ParametricContext): ParametricResult {
    const { item, part, params: p } = ctx;
    // Сторона ряда (§44): левая или правая боковина корпуса.
    const side = str(p.side, SHELF_PIN_DEFAULTS.side);
    const face = item.face ?? (side === 'right' ? 'back' : 'front');
    const size = faceSize(part, face);

    const spacing = num(p.rowSpacing, SHELF_PIN_DEFAULTS.rowSpacing);
    const top = num(p.topOffset, SHELF_PIN_DEFAULTS.topOffset);
    const bottom = num(p.bottomOffset, SHELF_PIN_DEFAULTS.bottomOffset);
    const edge = num(p.edgeOffset, SHELF_PIN_DEFAULTS.edgeOffset);
    const diameter = num(p.diameter, SHELF_PIN_DEFAULTS.diameter);
    const depth = Math.min(num(p.depth, SHELF_PIN_DEFAULTS.depth), Math.max(1, size.depth - 1));
    const rows = Math.max(1, Math.round(num(p.rows, SHELF_PIN_DEFAULTS.rows)));

    const dy = item.override?.y ?? 0;
    const dx = item.override?.x ?? 0;
    const ys = pinRowPositions(size.v, top, bottom, spacing).map((y) => clamp(y + dy, 0, size.v));
    const xs = rows === 1
      ? [clamp(edge + dx, 0, size.u)]
      : [clamp(edge + dx, 0, size.u), clamp(size.u - edge + dx, 0, size.u)];

    const issues: ParametricResult['issues'] = [];
    if (ys.length === 0) {
      issues.push({
        severity: 'error',
        code: 'pin.noRow',
        message: 'Ряд отверстий пуст: отступы больше высоты детали.',
      });
    }
    if (depth >= size.depth) {
      issues.push({
        severity: 'error',
        code: 'pin.depth',
        message: `Глубина ${depth} мм больше толщины детали ${size.depth} мм.`,
      });
    }
    if (edge < diameter) {
      issues.push({
        severity: 'warning',
        code: 'pin.edge',
        message: `Ряд стоит в ${edge} мм от края — близко к минимуму.`,
      });
    }

    const operations: TemplateOperation[] = [];
    xs.forEach((x, r) => {
      ys.forEach((y, i) => {
        operations.push({
          key: `pin:${r}:${i}`,
          type: 'drilling',
          face,
          x,
          y,
          diameter,
          depth,
          through: false,
          role: 'shelf-pin',
        });
      });
    });

    return {
      anchors: xs.map((x, r) => ({
        key: `row:${r}`, face, x, y: ys[0] ?? 0, rotation: 0, role: 'pin-row',
      })),
      operations,
      issues,
    };
  },
};
