/**
 * Ручка (§26–§31).
 *
 * Положение задаётся стороной фасада и отступом, монтажные отверстия —
 * межцентровым расстоянием. Поворот 0°/90° меняет ось разноса отверстий.
 */
import type { HardwareKindSpec, ParametricContext, ParametricResult, TemplateOperation } from './types';
import { clamp, faceSize, num, str } from './types';

/** Положение ручки на фасаде (§29). */
export type HandlePosition = 'top' | 'bottom' | 'left' | 'right' | 'center';

export const HANDLE_POSITIONS: HandlePosition[] = ['top', 'bottom', 'left', 'right', 'center'];

export const HANDLE_DEFAULTS = {
  length: 128,
  /** Межцентровое расстояние отверстий (§27). */
  holeSpacing: 96,
  diameter: 5,
  /** Отступ от края фасада (§30). */
  offset: 40,
  position: 'top',
  rotation: 0,
} as const;

/** Центр ручки на грани по её положению (§29/§30). */
export function handleCenter(
  size: { u: number; v: number },
  position: HandlePosition,
  offset: number,
): { x: number; y: number } {
  switch (position) {
    case 'top': return { x: size.u / 2, y: Math.max(0, size.v - offset) };
    case 'bottom': return { x: size.u / 2, y: Math.min(size.v, offset) };
    case 'left': return { x: Math.min(size.u, offset), y: size.v / 2 };
    case 'right': return { x: Math.max(0, size.u - offset), y: size.v / 2 };
    case 'center':
    default: return { x: size.u / 2, y: size.v / 2 };
  }
}

/**
 * Ось разноса отверстий (§31).
 *
 * По умолчанию ручка лежит вдоль длинной стороны своего положения: сверху и
 * снизу — горизонтально, слева и справа — вертикально. Поворот 90° переключает.
 */
export function handleAxis(position: HandlePosition, rotation: number): 'x' | 'y' {
  const along: 'x' | 'y' = position === 'left' || position === 'right' ? 'y' : 'x';
  const turned = Math.round(rotation) % 180 === 90;
  if (!turned) return along;
  return along === 'x' ? 'y' : 'x';
}

export const handleSpec: HardwareKindSpec = {
  kind: 'HANDLE',
  label: 'Ручка',
  defaultFace: 'front',
  defaults: { ...HANDLE_DEFAULTS },
  placement: { reference: 'EDGE', from: 'top', offset: HANDLE_DEFAULTS.offset },

  resolve(ctx: ParametricContext): ParametricResult {
    const { item, part, params: p } = ctx;
    const face = item.face ?? 'front';
    const size = faceSize(part, face);
    const position = str(p.position, HANDLE_DEFAULTS.position) as HandlePosition;
    const offset = num(p.offset, HANDLE_DEFAULTS.offset);
    const spacing = num(p.holeSpacing, HANDLE_DEFAULTS.holeSpacing);
    const diameter = num(p.diameter, HANDLE_DEFAULTS.diameter);
    const rotation = num(item.rotation?.z, num(p.rotation, HANDLE_DEFAULTS.rotation));

    const base = handleCenter(size, position, offset);
    const center = {
      x: clamp(base.x + (item.override?.x ?? 0), 0, size.u),
      y: clamp(base.y + (item.override?.y ?? 0), 0, size.v),
    };
    const axis = handleAxis(position, rotation);

    const points = spacing > 0
      ? [-spacing / 2, spacing / 2].map((d) => (axis === 'x'
        ? { x: center.x + d, y: center.y }
        : { x: center.x, y: center.y + d }))
      : [center];

    const issues: ParametricResult['issues'] = [];
    for (const point of points) {
      if (point.x < 0 || point.x > size.u || point.y < 0 || point.y > size.v) {
        issues.push({
          severity: 'error',
          code: 'handle.bounds',
          message: 'Отверстия ручки выходят за границы фасада.',
        });
        break;
      }
    }
    const length = num(p.length, HANDLE_DEFAULTS.length);
    if (length > (axis === 'x' ? size.u : size.v)) {
      issues.push({
        severity: 'error',
        code: 'handle.length',
        message: `Ручка ${length} мм длиннее стороны фасада.`,
      });
    }
    if (Math.min(center.x, size.u - center.x, center.y, size.v - center.y) < diameter) {
      issues.push({
        severity: 'warning',
        code: 'handle.edge',
        message: 'Ручка стоит близко к краю фасада.',
      });
    }

    const operations: TemplateOperation[] = points.map((point, i) => ({
      key: `hole:${i}`,
      type: 'drilling',
      face,
      x: clamp(point.x, 0, size.u),
      y: clamp(point.y, 0, size.v),
      diameter,
      depth: size.depth,
      through: true,
      role: 'mounting',
    }));

    return {
      anchors: [{ key: 'handle', face, x: center.x, y: center.y, rotation, role: 'handle' }],
      operations,
      issues,
    };
  },
};
