/**
 * Крепёж и соединители (§45–§59).
 *
 * Конфирмат, шкант, минификс, стяжка, уголок, опора, колесо и замок ставятся
 * по одной схеме: точка на грани + шаблон операций. Разница только в наборе
 * отверстий, поэтому общий каркас один.
 *
 * Важное ограничение: единица стоит на ОДНОЙ детали, поэтому здесь строятся
 * только её отверстия. Ответное глухое отверстие в присоединяемой детали
 * (направляющее конфирмата, гнездо стяжного болта) появляется, лишь когда оно
 * физически помещается в материал этой грани; иначе его делает существующее
 * правило узла по связи деталей — второй системы для этого не заводим.
 */
import type { PartFace } from '@/core/model/types';
import type { HardwareKindSpec, ParametricContext, ParametricResult, TemplateOperation } from './types';
import { clamp, faceSize, num } from './types';

/** Точка установки крепежа с учётом ручной правки (§80). */
function anchorOf(ctx: ParametricContext, face: PartFace): { x: number; y: number; u: number; v: number; depth: number } {
  const size = faceSize(ctx.part, face);
  const px = num(ctx.params.x, size.u / 2);
  const py = num(ctx.params.y, size.v / 2);
  return {
    x: clamp(px + (ctx.item.override?.x ?? 0), 0, size.u),
    y: clamp(py + (ctx.item.override?.y ?? 0), 0, size.v),
    u: size.u,
    v: size.v,
    depth: size.depth,
  };
}

function boundsIssues(
  point: { x: number; y: number; u: number; v: number },
  clearance: number,
): ParametricResult['issues'] {
  const issues: ParametricResult['issues'] = [];
  if (point.x < 0 || point.x > point.u || point.y < 0 || point.y > point.v) {
    issues.push({ severity: 'error', code: 'fastener.bounds', message: 'Крепёж выходит за границы детали.' });
    return issues;
  }
  const edge = Math.min(point.x, point.u - point.x, point.y, point.v - point.y);
  if (edge < clearance / 2) {
    issues.push({
      severity: 'error',
      code: 'fastener.edge',
      message: `Крепёж в ${Math.round(edge)} мм от края — отверстие выйдет за деталь.`,
    });
  } else if (edge < clearance) {
    issues.push({
      severity: 'warning',
      code: 'fastener.edge',
      message: `Крепёж в ${Math.round(edge)} мм от края — близко к минимальному расстоянию.`,
    });
  }
  return issues;
}

export const CONFIRMAT_DEFAULTS = {
  diameter: 7,
  length: 50,
  headDiameter: 10,
  drillDiameter: 5,
  drillDepth: 45,
} as const;

/** Конфирмат (§45–§47): сквозное в присоединяемой + глухое в торце. */
export const confirmatSpec: HardwareKindSpec = {
  kind: 'CONFIRMAT',
  label: 'Конфирмат',
  defaultFace: 'front',
  defaults: { ...CONFIRMAT_DEFAULTS },
  placement: { reference: 'CENTER' },

  resolve(ctx: ParametricContext): ParametricResult {
    const face = ctx.item.face ?? 'front';
    const point = anchorOf(ctx, face);
    const p = ctx.params;
    const through = num(p.diameter, CONFIRMAT_DEFAULTS.diameter);
    const head = num(p.headDiameter, CONFIRMAT_DEFAULTS.headDiameter);
    const drill = num(p.drillDiameter, CONFIRMAT_DEFAULTS.drillDiameter);
    const drillDepth = num(p.drillDepth, CONFIRMAT_DEFAULTS.drillDepth);

    const operations: TemplateOperation[] = [
      {
        key: 'through', type: 'confirmat', face, x: point.x, y: point.y,
        diameter: through, depth: point.depth, through: true, role: 'body',
      },
      {
        key: 'head', type: 'drilling', face, x: point.x, y: point.y,
        diameter: head, depth: 3, through: false, role: 'head',
      },
    ];
    // Направляющее отверстие — только если оно помещается в эту грань (§47).
    if (drillDepth < point.depth) {
      operations.push({
        key: 'pilot', type: 'drilling', face, x: point.x, y: point.y,
        diameter: drill, depth: drillDepth, through: false, role: 'pilot',
      });
    }
    return {
      anchors: [{ key: 'confirmat', face, x: point.x, y: point.y, rotation: 0, role: 'confirmat' }],
      operations,
      issues: boundsIssues(point, head),
    };
  },
};

export const DOWEL_DEFAULTS = { diameter: 8, length: 30, depth: 16 } as const;

/** Шкант (§48–§50). */
export const dowelSpec: HardwareKindSpec = {
  kind: 'DOWEL',
  label: 'Шкант',
  defaultFace: 'front',
  defaults: { ...DOWEL_DEFAULTS },
  placement: { reference: 'CENTER' },

  resolve(ctx: ParametricContext): ParametricResult {
    const face = ctx.item.face ?? 'front';
    const point = anchorOf(ctx, face);
    const p = ctx.params;
    const diameter = num(p.diameter, DOWEL_DEFAULTS.diameter);
    const length = num(p.length, DOWEL_DEFAULTS.length);
    const depth = Math.min(num(p.depth, DOWEL_DEFAULTS.depth), Math.max(1, point.depth - 1));

    const issues = boundsIssues(point, diameter * 2);
    if (depth * 2 < length) {
      issues.push({
        severity: 'warning',
        code: 'dowel.depth',
        message: `Шкант ${length} мм длиннее двух глубин отверстия ${depth} мм.`,
      });
    }
    return {
      anchors: [{ key: 'dowel', face, x: point.x, y: point.y, rotation: 0, role: 'dowel' }],
      operations: [{
        key: 'hole', type: 'dowel', face, x: point.x, y: point.y,
        diameter, depth, through: false, role: 'dowel',
      }],
      issues,
    };
  },
};

export const MINIFIX_DEFAULTS = {
  /** Эксцентрик (§52). */
  camDiameter: 15,
  camDepth: 12.5,
  camOffset: 34,
  /** Стяжной болт. */
  boltDiameter: 8,
  boltDepth: 24,
  /** Шкант комплекта. */
  dowelDiameter: 8,
  dowelDepth: 16,
  dowelSpacing: 32,
} as const;

/** Минификс (§51–§53): эксцентрик + болт + шкант одной связкой. */
export const minifixSpec: HardwareKindSpec = {
  kind: 'MINIFIX',
  label: 'Минификс',
  defaultFace: 'front',
  defaults: { ...MINIFIX_DEFAULTS },
  placement: { reference: 'CENTER' },

  resolve(ctx: ParametricContext): ParametricResult {
    const face = ctx.item.face ?? 'front';
    const point = anchorOf(ctx, face);
    const p = ctx.params;
    const camD = num(p.camDiameter, MINIFIX_DEFAULTS.camDiameter);
    const camDepth = Math.min(num(p.camDepth, MINIFIX_DEFAULTS.camDepth), Math.max(1, point.depth - 1));
    const camOffset = num(p.camOffset, MINIFIX_DEFAULTS.camOffset);
    const boltD = num(p.boltDiameter, MINIFIX_DEFAULTS.boltDiameter);
    const boltDepth = num(p.boltDepth, MINIFIX_DEFAULTS.boltDepth);
    const dowelD = num(p.dowelDiameter, MINIFIX_DEFAULTS.dowelDiameter);
    const dowelDepth = num(p.dowelDepth, MINIFIX_DEFAULTS.dowelDepth);
    const dowelSpacing = num(p.dowelSpacing, MINIFIX_DEFAULTS.dowelSpacing);

    const operations: TemplateOperation[] = [
      {
        key: 'cam', type: 'drilling', face, x: point.x, y: point.y,
        diameter: camD, depth: camDepth, through: false, role: 'cam',
      },
    ];
    /* Гнездо стяжного болта и шкант уходят в торец присоединяемой детали:
     * на этой грани они появляются, только если материал позволяет (§53). */
    if (boltDepth < point.depth) {
      operations.push({
        key: 'bolt', type: 'drilling', face, x: clamp(point.x + camOffset, 0, point.u), y: point.y,
        diameter: boltD, depth: boltDepth, through: false, role: 'bolt',
      });
    }
    if (dowelDepth < point.depth) {
      operations.push({
        key: 'dowel', type: 'dowel', face, x: point.x, y: clamp(point.y + dowelSpacing, 0, point.v),
        diameter: dowelD, depth: dowelDepth, through: false, role: 'dowel',
      });
    }

    const issues = boundsIssues(point, camD);
    if (camDepth >= point.depth) {
      issues.push({
        severity: 'error',
        code: 'minifix.depth',
        message: 'Эксцентрик глубже толщины детали.',
      });
    }
    return {
      anchors: [{ key: 'minifix', face, x: point.x, y: point.y, rotation: 0, role: 'minifix' }],
      operations,
      issues,
    };
  },
};

export const CONNECTOR_DEFAULTS = { diameter: 8, length: 40, offset: 32 } as const;

/** Универсальная стяжка (§54/§55). */
export const connectorSpec: HardwareKindSpec = {
  kind: 'CONNECTOR',
  label: 'Стяжка',
  defaultFace: 'front',
  defaults: { ...CONNECTOR_DEFAULTS },
  placement: { reference: 'CENTER' },

  resolve(ctx: ParametricContext): ParametricResult {
    const face = ctx.item.face ?? 'front';
    const point = anchorOf(ctx, face);
    const p = ctx.params;
    const diameter = num(p.diameter, CONNECTOR_DEFAULTS.diameter);
    const length = num(p.length, CONNECTOR_DEFAULTS.length);
    const offset = num(p.offset, CONNECTOR_DEFAULTS.offset);

    // Глубина гнезда ограничена материалом грани: сквозняк здесь не нужен.
    const depth = Math.min(length, Math.max(1, point.depth - 1));
    const operations: TemplateOperation[] = [
      {
        key: 'a', type: 'drilling', face, x: point.x, y: point.y,
        diameter, depth, through: false, role: 'connector',
      },
      {
        key: 'b', type: 'drilling', face, x: clamp(point.x + offset, 0, point.u), y: point.y,
        diameter, depth, through: false, role: 'connector',
      },
    ];
    return {
      anchors: [{ key: 'connector', face, x: point.x, y: point.y, rotation: 0, role: 'connector' }],
      operations,
      issues: boundsIssues(point, diameter * 2),
    };
  },
};

/** Простой крепёж «одно отверстие»: уголок, опора, колесо, замок, саморез. */
function simpleSpec(
  kind: HardwareKindSpec['kind'],
  label: string,
  defaultFace: PartFace,
  defaults: Record<string, number>,
  role: string,
  through = false,
): HardwareKindSpec {
  return {
    kind,
    label,
    defaultFace,
    defaults,
    placement: { reference: 'CENTER' },
    resolve(ctx: ParametricContext): ParametricResult {
      const face = ctx.item.face ?? defaultFace;
      const point = anchorOf(ctx, face);
      const p = ctx.params;
      const diameter = num(p.diameter, defaults.diameter ?? 5);
      const depth = through
        ? point.depth
        : Math.min(num(p.depth, defaults.depth ?? 12), Math.max(1, point.depth - 1));
      const holes = Math.max(1, Math.round(num(p.holes, defaults.holes ?? 1)));
      const spacing = num(p.holeSpacing, defaults.holeSpacing ?? 32);

      const operations: TemplateOperation[] = Array.from({ length: holes }, (_, i) => {
        const shift = holes === 1 ? 0 : (i - (holes - 1) / 2) * spacing;
        return {
          key: `hole:${i}`,
          type: 'drilling' as const,
          face,
          x: clamp(point.x + shift, 0, point.u),
          y: point.y,
          diameter,
          depth,
          through,
          role,
        };
      });
      return {
        anchors: [{ key: role, face, x: point.x, y: point.y, rotation: num(ctx.item.rotation?.z, 0), role }],
        operations,
        issues: boundsIssues(point, diameter * 2),
      };
    },
  };
}

/** Уголок (§56). */
export const bracketSpec = simpleSpec('BRACKET', 'Уголок', 'front', { diameter: 4, depth: 10, holes: 2, holeSpacing: 32 }, 'bracket');
/** Опора (§57) — параметры совпадают с существующей моделью ножек. */
export const legSpec = simpleSpec('LEG', 'Опора', 'bottom', { diameter: 8, depth: 12, holes: 1 }, 'leg');
/** Колесо (§58). */
export const casterSpec = simpleSpec('CASTER', 'Колесо', 'bottom', { diameter: 5, depth: 12, holes: 4, holeSpacing: 32 }, 'caster');
/** Замок (§59). */
export const lockSpec = simpleSpec('LOCK', 'Замок', 'front', { diameter: 19, depth: 16, holes: 1 }, 'lock', true);
/** Саморез. */
export const screwSpec = simpleSpec('SCREW', 'Саморез', 'front', { diameter: 3.5, depth: 16, holes: 1 }, 'screw');
/** Прочее: одно отверстие по параметрам позиции. */
export const otherSpec = simpleSpec('OTHER', 'Прочее', 'front', { diameter: 5, depth: 10, holes: 1 }, 'other');
