/**
 * Направляющая ящика (§32–§37).
 *
 * Длина подбирается по глубине корпуса существующим правилом проекта
 * (slideLengthFor) — второго подбора длины здесь не появляется. Монтажные
 * отверстия ставятся по шаблону 32 мм от переднего края.
 */
import type { HardwareKindSpec, ParametricContext, ParametricResult, TemplateOperation } from './types';
import { clamp, faceSize, num, str } from './types';

/** Тип направляющей (§34). */
export type SlideType = 'side' | 'bottom' | 'hidden';

export const SLIDE_TYPES: SlideType[] = ['side', 'bottom', 'hidden'];

export const SLIDE_DEFAULTS = {
  length: 450,
  /** Зазор между ящиком и боковиной на сторону (§33). */
  clearance: 13,
  side: 'left',
  /** Шаг монтажных отверстий, мм (§33/§35). */
  mountingPattern: 32,
  mountingCount: 3,
  diameter: 5,
  depth: 12,
  /** Высота оси направляющей от низа ящика, мм. */
  axisHeight: 12,
  type: 'side',
} as const;

/** Ряд монтажных точек направляющей от переднего края (§35/§36). */
export function slideMountingPoints(
  length: number,
  pattern: number,
  count: number,
  frontOffset = 32,
): number[] {
  const n = Math.max(1, Math.round(count));
  const step = pattern > 0 ? pattern : 32;
  const points: number[] = [];
  for (let i = 0; i < n; i++) {
    /* Отверстия идут по системе 32 мм от переднего края, но крайнее не должно
     * выходить за длину направляющей — иначе шуруп попадёт в воздух. */
    const raw = frontOffset + i * step * (i === 0 ? 1 : 4);
    points.push(clamp(raw, 0, Math.max(0, length - 16)));
  }
  return points;
}

export const slideSpec: HardwareKindSpec = {
  kind: 'DRAWER_SLIDE',
  label: 'Направляющая ящика',
  /* Направляющая крепится к ПЛАСТИ боковины. В собственной системе детали
   * пласти — это грани front/back, а left/right — узкие торцы, поэтому
   * сторона корпуса выбирает между front и back, а не между left и right. */
  defaultFace: 'front',
  defaults: { ...SLIDE_DEFAULTS },
  placement: { reference: 'EDGE', from: 'bottom', offset: SLIDE_DEFAULTS.axisHeight },

  resolve(ctx: ParametricContext): ParametricResult {
    const { item, part, params: p } = ctx;
    const face = item.face ?? (str(p.side, SLIDE_DEFAULTS.side) === 'right' ? 'back' : 'front');
    const size = faceSize(part, face);
    const type = str(p.type, SLIDE_DEFAULTS.type) as SlideType;
    const length = num(p.length, SLIDE_DEFAULTS.length);
    const pattern = num(p.mountingPattern, SLIDE_DEFAULTS.mountingPattern);
    const count = num(p.mountingCount, SLIDE_DEFAULTS.mountingCount);
    const diameter = num(p.diameter, SLIDE_DEFAULTS.diameter);
    const depth = Math.min(num(p.depth, SLIDE_DEFAULTS.depth), Math.max(1, size.depth - 1));

    const baseY = type === 'bottom' ? 0 : num(p.axisHeight, SLIDE_DEFAULTS.axisHeight);
    const y = clamp(baseY + (item.override?.y ?? 0), 0, size.v);
    const x0 = clamp(item.override?.x ?? 0, 0, size.u);

    const xs = slideMountingPoints(Math.min(length, size.u), pattern, count).map((x) => clamp(x0 + x, 0, size.u));

    const issues: ParametricResult['issues'] = [];
    if (length > size.u) {
      issues.push({
        severity: 'error',
        code: 'slide.length',
        message: `Направляющая ${length} мм длиннее детали ${Math.round(size.u)} мм.`,
      });
    } else if (size.u - length > 60) {
      issues.push({
        severity: 'warning',
        code: 'slide.short',
        message: `Направляющая ${length} мм заметно короче детали ${Math.round(size.u)} мм.`,
      });
    }
    const clearance = num(p.clearance, SLIDE_DEFAULTS.clearance);
    if (clearance <= 0) {
      issues.push({
        severity: 'error',
        code: 'slide.clearance',
        message: 'Зазор направляющей должен быть больше нуля.',
      });
    } else if (clearance < 10) {
      issues.push({
        severity: 'warning',
        code: 'slide.clearance',
        message: `Зазор ${clearance} мм меньше типовых 13 мм — ящик может закусывать.`,
      });
    }
    if (y > size.v) {
      issues.push({
        severity: 'error',
        code: 'slide.position',
        message: 'Ось направляющей выше детали.',
      });
    }

    const operations: TemplateOperation[] = xs.map((x, i) => ({
      key: `mount:${i}`,
      type: 'drilling',
      face,
      x,
      y,
      diameter,
      depth,
      through: false,
      role: 'mounting',
    }));

    return {
      anchors: [{ key: 'slide', face, x: x0, y, rotation: num(item.rotation?.z, 0), role: 'slide' }],
      operations,
      issues,
    };
  },
};
