/**
 * Петля (§14–§25).
 *
 * Петля параметрическая: чашка, крепёжные отверстия и ответная планка
 * рассчитываются из размеров фасада и параметров позиции каталога. Количество
 * берётся из существующего правила проекта (§18) — своё второе правило петель
 * здесь не заводится.
 */
import type { HardwareKindSpec, ParametricContext, ParametricResult, TemplateOperation } from './types';
import { clamp, distributePoints, faceSize, num } from './types';

/** Количество петель по высоте двери (§18). Правило проекта, не новое. */
export function hingeCount(doorHeight: number, doorWidth = 0): number {
  if (doorHeight <= 900) return 2;
  if (doorHeight <= 1600) return 3;
  if (doorHeight <= 2000) return 4;
  return doorWidth > 600 ? 6 : 5;
}

export const HINGE_DEFAULTS = {
  cupDiameter: 35,
  cupDepth: 12.5,
  /** Расстояние от края фасада до центра чашки (§15). */
  mountingDistance: 22.5,
  overlay: 16,
  minDoorWidth: 250,
  maxDoorWidth: 900,
  screwDiameter: 2.5,
  screwDepth: 8,
  /** Разнос крепёжных отверстий чашки по высоте, мм (§17). */
  screwSpacing: 45,
  topOffset: 100,
  bottomOffset: 100,
  platePosition: 37,
} as const;

/** Положения петель по высоте фасада (§19–§22). */
export function hingePositions(
  height: number,
  count: number,
  params: { topOffset?: number; bottomOffset?: number; hingeSpacing?: number } = {},
): number[] {
  const top = num(params.topOffset, HINGE_DEFAULTS.topOffset);
  const bottom = num(params.bottomOffset, HINGE_DEFAULTS.bottomOffset);
  return distributePoints(height, count, top, bottom, params.hingeSpacing);
}

/** Проверки петли на фасаде (§25). */
export function checkHinge(
  ctx: ParametricContext,
  ys: number[],
): ParametricResult['issues'] {
  const p = ctx.params;
  const { u: width, v: height, depth } = faceSize(ctx.part, ctx.item.face ?? 'back');
  const issues: ParametricResult['issues'] = [];

  const minW = num(p.minDoorWidth, HINGE_DEFAULTS.minDoorWidth);
  const maxW = num(p.maxDoorWidth, HINGE_DEFAULTS.maxDoorWidth);
  if (width < minW) {
    issues.push({
      severity: 'error',
      code: 'hinge.narrowDoor',
      message: `Фасад ${Math.round(width)} мм уже минимальной ширины петли ${minW} мм.`,
    });
  } else if (width > maxW) {
    issues.push({
      severity: 'warning',
      code: 'hinge.wideDoor',
      message: `Фасад ${Math.round(width)} мм шире рекомендованных ${maxW} мм — добавьте петли.`,
    });
  }

  const cupD = num(p.cupDiameter, HINGE_DEFAULTS.cupDiameter);
  const cupDepth = num(p.cupDepth, HINGE_DEFAULTS.cupDepth);
  const mount = num(p.mountingDistance, HINGE_DEFAULTS.mountingDistance);
  if (cupDepth >= depth) {
    issues.push({
      severity: 'error',
      code: 'hinge.cupDepth',
      message: `Чашка ${cupDepth} мм глубже толщины фасада ${depth} мм.`,
    });
  }
  if (mount - cupD / 2 < 0 || mount + cupD / 2 > width) {
    issues.push({
      severity: 'error',
      code: 'hinge.cupBounds',
      message: 'Чашка петли выходит за границы фасада.',
    });
  }
  for (const y of ys) {
    if (y - cupD / 2 < 0 || y + cupD / 2 > height) {
      issues.push({
        severity: 'error',
        code: 'hinge.cupBounds',
        message: `Чашка на высоте ${Math.round(y)} мм выходит за границы фасада.`,
      });
      break;
    }
  }
  // Петли не должны налезать друг на друга (§25).
  const sorted = [...ys].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap < cupD) {
      issues.push({
        severity: 'error',
        code: 'hinge.collision',
        message: `Петли стоят ближе ${Math.round(cupD)} мм друг к другу (${Math.round(gap)} мм).`,
      });
      break;
    }
    if (gap < cupD * 2) {
      issues.push({
        severity: 'warning',
        code: 'hinge.spacing',
        message: `Расстояние между петлями ${Math.round(gap)} мм близко к минимальному.`,
      });
      break;
    }
  }
  return issues;
}

export const hingeSpec: HardwareKindSpec = {
  kind: 'HINGE',
  label: 'Петля',
  defaultFace: 'back',
  defaults: { ...HINGE_DEFAULTS },
  placement: { reference: 'EDGE', from: 'left', x: HINGE_DEFAULTS.mountingDistance, offset: 0 },

  resolve(ctx: ParametricContext): ParametricResult {
    const { item, part, params: p } = ctx;
    const face = item.face ?? 'back';
    const { u: width, v: height, depth } = faceSize(part, face);

    const count = Math.max(1, Math.round(num(item.quantity, hingeCount(height, width))));
    const cupD = num(p.cupDiameter, HINGE_DEFAULTS.cupDiameter);
    const cupDepth = Math.min(num(p.cupDepth, HINGE_DEFAULTS.cupDepth), Math.max(1, depth - 1));
    const mount = clamp(num(p.mountingDistance, HINGE_DEFAULTS.mountingDistance), cupD / 2, Math.max(cupD / 2, width - cupD / 2));
    const screwD = num(p.screwDiameter, HINGE_DEFAULTS.screwDiameter);
    const screwDepth = num(p.screwDepth, HINGE_DEFAULTS.screwDepth);
    const screwSpacing = num(p.screwSpacing, HINGE_DEFAULTS.screwSpacing);

    const base = hingePositions(height, count, {
      topOffset: num(p.topOffset, HINGE_DEFAULTS.topOffset),
      bottomOffset: num(p.bottomOffset, HINGE_DEFAULTS.bottomOffset),
      hingeSpacing: typeof p.hingeSpacing === 'number' ? p.hingeSpacing : undefined,
    });
    /* Ручная правка сдвигает ВЕСЬ ряд петель (§23): пользователь двигает
     * фурнитуру, а не отдельное отверстие — отверстия следуют за ней (§85). */
    const dy = item.override?.y ?? 0;
    const dx = item.override?.x ?? 0;
    const ys = base.map((y) => clamp(y + dy, 0, height));
    const x = clamp(mount + dx, 0, width);

    const anchors = ys.map((y, i) => ({
      key: `hinge:${i}`, face, x, y, rotation: num(item.rotation?.z, 0), role: 'hinge',
    }));

    const operations: TemplateOperation[] = [];
    ys.forEach((y, i) => {
      // Чашка петли (§16).
      operations.push({
        key: `cup:${i}`, type: 'boring', face, x, y,
        diameter: cupD, depth: cupDepth, through: false, role: 'cup',
      });
      // Крепёжные отверстия чашки (§17).
      for (const [j, sign] of [[0, -1], [1, 1]] as const) {
        operations.push({
          key: `screw:${i}:${j}`, type: 'drilling', face,
          x: clamp(x + 5.5, 0, width), y: clamp(y + sign * (screwSpacing / 2), 0, height),
          diameter: screwD, depth: screwDepth, through: false, role: 'mounting',
        });
      }
    });

    return { anchors, operations, issues: checkHinge({ ...ctx, item: { ...item } }, ys) };
  },
};
