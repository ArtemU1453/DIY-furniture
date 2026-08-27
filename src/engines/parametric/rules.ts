/**
 * Параметрические правила (§14–§35): ParametricModel → PartDefinition[].
 *
 * Правила считают геометрию в координатах изделия: X ∈ [0, width],
 * Y ∈ [0, height] (снизу вверх), Z ∈ [0, depth] (спереди назад). Перевод в
 * поля Part делает генератор — здесь только конструкция.
 *
 * Каждая деталь получает СТАБИЛЬНЫЙ ключ вида CABINET.SIDE.LEFT или
 * CABINET.SHELF.001 (§39): по нему деталь узнаётся при пересчёте и сохраняет
 * свой Part ID, номер и кромку.
 */
import type {
  ParametricModel,
  ParametricPartRole,
  ParametricRule,
  PartDefinition,
} from '@/core/parametric/types';
import type { MaterialId } from '@/core/model/ids';
import type { Rotation, Vec3 } from '@/core/model/types';

export interface Box {
  x: { min: number; max: number };
  y: { min: number; max: number };
  z: { min: number; max: number };
}

/** Ось, вдоль которой отложена толщина плиты. */
export type ThicknessAxis = 'x' | 'y' | 'z';

const D90 = 90;
const pad3 = (n: number): string => String(n).padStart(3, '0');

/**
 * Построить определение детали из габаритного бокса. Изделие центрируется по
 * X и Z и стоит на Y = 0 — та же система, что и у корпусного движка, поэтому
 * 3D, раскрой и присадка работают без изменений.
 */
function define(
  id: string,
  name: string,
  role: ParametricPartRole,
  box: Box,
  axis: ThicknessAxis,
  model: ParametricModel,
  materialId: MaterialId | null,
  metadata: Record<string, unknown> = {},
): PartDefinition {
  const ex = box.x.max - box.x.min;
  const ey = box.y.max - box.y.min;
  const ez = box.z.max - box.z.min;

  const position: Vec3 = {
    x: (box.x.min + box.x.max) / 2 - model.width / 2,
    y: (box.y.min + box.y.max) / 2,
    z: (box.z.min + box.z.max) / 2 - model.depth / 2,
  };

  let width: number, height: number, thickness: number, rotation: Rotation;
  switch (axis) {
    case 'z': // фронтальная плита: фасад, задняя стенка
      width = ex; height = ey; thickness = ez; rotation = { x: 0, y: 0, z: 0 };
      break;
    case 'x': // вертикальная плита: боковина, перегородка
      width = ez; height = ey; thickness = ex; rotation = { x: 0, y: D90, z: 0 };
      break;
    case 'y': // горизонтальная плита: верх, низ, полка
    default:
      width = ex; height = ez; thickness = ey; rotation = { x: D90, y: 0, z: 0 };
      break;
  }

  return { id, name, width, height, thickness, position, rotation, materialId, role, metadata };
}

// ── Производные величины конструкции ─────────────────────────────────────────

export interface CabinetGeometry {
  t: number;
  /** Вертикальный диапазон боковин: зависит от схемы корпуса (§21). */
  sideY: { min: number; max: number };
  /** Внутреннее пространство. */
  interior: { x: { min: number; max: number }; y: { min: number; max: number } };
  /** Предел глубины внутренних деталей (задняя стенка занимает своё место). */
  interiorDepthMax: number;
  /** Высота, на которой стоит корпус (ножки или цоколь). */
  baseHeight: number;
}

/**
 * BETWEEN_SIDES — боковины во всю высоту, верх и низ между ними.
 * ON_SIDES      — верх и низ накрывают боковины, боковины короче на 2t.
 */
export function computeGeometry(model: ParametricModel): CabinetGeometry {
  const t = model.thickness;
  const H = model.height;
  const between = model.construction === 'BETWEEN_SIDES';

  const sideY = between
    ? { min: 0, max: H }
    : { min: t, max: H - t };

  const backReserve =
    model.backPanel.type === 'INSET' || model.backPanel.type === 'GROOVE'
      ? model.backPanel.thickness + model.backPanel.offset
      : 0;

  return {
    t,
    sideY,
    interior: { x: { min: t, max: model.width - t }, y: { min: t, max: H - t } },
    interiorDepthMax: model.depth - backReserve,
    baseHeight: model.legs.enabled ? model.legs.height
      : model.plinth.enabled ? model.plinth.height : 0,
  };
}

// ── Боковины (§18) ───────────────────────────────────────────────────────────

export const sideRule: ParametricRule = {
  id: 'CABINET.SIDES',
  name: 'Боковины',
  build(model) {
    const g = computeGeometry(model);
    const mk = (side: 'LEFT' | 'RIGHT', xMin: number): PartDefinition =>
      define(
        `CABINET.SIDE.${side}`,
        side === 'LEFT' ? 'Боковина левая' : 'Боковина правая',
        'SIDE',
        { x: { min: xMin, max: xMin + g.t }, y: g.sideY, z: { min: 0, max: model.depth } },
        'x', model, model.materialId,
        { partType: side === 'LEFT' ? 'side_left' : 'side_right' },
      );
    return [mk('LEFT', 0), mk('RIGHT', model.width - g.t)];
  },
};

// ── Верх и низ (§19/§20) ─────────────────────────────────────────────────────

export const topBottomRule: ParametricRule = {
  id: 'CABINET.TOP_BOTTOM',
  name: 'Верх и низ',
  build(model) {
    const g = computeGeometry(model);
    const between = model.construction === 'BETWEEN_SIDES';
    // BETWEEN_SIDES: плита живёт между боковинами, её ширина меньше на 2t.
    // ON_SIDES: плита накрывает боковины во всю ширину корпуса.
    const x = between
      ? { min: g.t, max: model.width - g.t }
      : { min: 0, max: model.width };
    const z = { min: 0, max: model.depth };

    const top = define(
      'CABINET.TOP', 'Крыша', 'TOP',
      { x, y: { min: model.height - g.t, max: model.height }, z },
      'y', model, model.materialId, { partType: 'top' },
    );
    const bottom = define(
      'CABINET.BOTTOM', 'Дно', 'BOTTOM',
      { x, y: { min: 0, max: g.t }, z },
      'y', model, model.materialId, { partType: 'bottom' },
    );
    return [top, bottom];
  },
};

// ── Перегородки (§27/§28) ────────────────────────────────────────────────────

/** Положения перегородок по ширине: явные или равномерные. */
export function partitionPositions(model: ParametricModel): number[] {
  const count = Math.max(0, Math.trunc(model.partitions.count));
  if (count === 0) return [];
  if (model.partitions.positions.length >= count) {
    return model.partitions.positions.slice(0, count);
  }
  const g = computeGeometry(model);
  const span = g.interior.x.max - g.interior.x.min;
  const step = span / (count + 1);
  return Array.from({ length: count }, (_, i) => g.interior.x.min + step * (i + 1));
}

export const partitionRule: ParametricRule = {
  id: 'CABINET.PARTITIONS',
  name: 'Перегородки',
  build(model) {
    const g = computeGeometry(model);
    const centers = partitionPositions(model);
    return centers.map((center, i) => {
      const index = i + 1;
      if (model.partitions.orientation === 'HORIZONTAL') {
        // Горизонтальная перегородка — во всю ширину проёма на заданной высоте.
        return define(
          `CABINET.PARTITION.${pad3(index)}`, `Перегородка ${index}`, 'PARTITION',
          {
            x: g.interior.x,
            y: { min: center - g.t / 2, max: center + g.t / 2 },
            z: { min: 0, max: g.interiorDepthMax },
          },
          'y', model, model.materialId, { partType: 'divider', index },
        );
      }
      return define(
        `CABINET.PARTITION.${pad3(index)}`, `Перегородка ${index}`, 'PARTITION',
        {
          x: { min: center - g.t / 2, max: center + g.t / 2 },
          y: g.interior.y,
          z: { min: 0, max: g.interiorDepthMax },
        },
        'x', model, model.materialId, { partType: 'divider', index },
      );
    });
  },
};

// ── Полки (§22–§26) ──────────────────────────────────────────────────────────

/**
 * Высоты полок (центр плиты по Y).
 *
 * AUTO_EQUAL — равномерно между низом и верхом проёма с учётом отступов;
 * MANUAL     — по шагу spacing от startOffset.
 * Полка с fixed = true не перемещается: её высота берётся как задана (§26).
 */
export function shelfOffsets(model: ParametricModel): number[] {
  const count = Math.max(0, Math.trunc(model.shelves.count));
  if (count === 0) return [];
  const g = computeGeometry(model);
  const s = model.shelves;
  const lo = g.interior.y.min + s.startOffset;
  const hi = g.interior.y.max - s.endOffset;

  const fixedByIndex = new Map(
    s.fixedShelves.filter((f) => f.fixed).map((f) => [f.index, f.offset]),
  );

  const auto: number[] = [];
  if (s.distribution === 'MANUAL' && s.spacing > 0) {
    for (let i = 0; i < count; i++) auto.push(lo + s.spacing * (i + 1));
  } else {
    const step = (hi - lo) / (count + 1);
    for (let i = 0; i < count; i++) auto.push(lo + step * (i + 1));
  }

  // Явно заданные положения перекрывают расчётные.
  return auto.map((value, i) => {
    const index = i + 1;
    const manual = s.fixedShelves.find((f) => f.index === index);
    if (fixedByIndex.has(index)) return fixedByIndex.get(index)!;
    if (manual && s.distribution === 'MANUAL') return manual.offset;
    return value;
  });
}

export const shelfRule: ParametricRule = {
  id: 'CABINET.SHELVES',
  name: 'Полки',
  build(model) {
    const g = computeGeometry(model);
    const offsets = shelfOffsets(model);
    const centers = partitionPositions(model);

    // Границы секций по ширине: перегородки делят проём.
    const bounds: Array<{ min: number; max: number }> = [];
    let left = g.interior.x.min;
    for (const c of centers) {
      bounds.push({ min: left, max: c - g.t / 2 });
      left = c + g.t / 2;
    }
    bounds.push({ min: left, max: g.interior.x.max });

    const shelfZMax = Math.min(g.interiorDepthMax, model.depth - model.shelves.depthReduction);
    const out: PartDefinition[] = [];
    let n = 0;
    for (let s = 0; s < bounds.length; s++) {
      for (let i = 0; i < offsets.length; i++) {
        n += 1;
        const y = offsets[i];
        out.push(define(
          `CABINET.SHELF.${pad3(n)}`, `Полка ${n}`, 'SHELF',
          {
            x: bounds[s],
            y: { min: y - g.t / 2, max: y + g.t / 2 },
            z: { min: 0, max: shelfZMax },
          },
          'y', model, model.materialId,
          { partType: 'shelf', index: n, section: s + 1, shelfIndex: i + 1 },
        ));
      }
    }
    return out;
  },
};

// ── Задняя стенка (§32/§33) ──────────────────────────────────────────────────

export const backPanelRule: ParametricRule = {
  id: 'CABINET.BACK',
  name: 'Задняя стенка',
  build(model) {
    const b = model.backPanel;
    if (b.type === 'NONE') return [];
    const g = computeGeometry(model);
    const material = b.material ?? model.materialId;

    // OVERLAY — накладная во весь габарит; INSET/GROOVE — вкладная в проём.
    const box: Box = b.type === 'OVERLAY'
      ? {
          x: { min: 0, max: model.width },
          y: { min: 0, max: model.height },
          z: { min: model.depth - b.thickness, max: model.depth },
        }
      : {
          x: g.interior.x,
          y: g.interior.y,
          z: { min: model.depth - b.thickness - b.offset, max: model.depth - b.offset },
        };

    return [define('CABINET.BACK', 'Задняя стенка', 'BACK', box, 'z', model, material, { partType: 'back' })];
  },
};

// ── Фасады (§29–§31) ─────────────────────────────────────────────────────────

export const doorRule: ParametricRule = {
  id: 'CABINET.DOORS',
  name: 'Фасады',
  build(model) {
    const count = Math.max(0, Math.trunc(model.doors.count));
    if (count === 0) return [];
    const gaps = model.doors.gaps;
    const material = model.doors.material ?? model.materialId;

    // Ширина фасада пересчитывается от ширины корпуса и зазоров (§31).
    const usable = model.width - gaps.leftGap - gaps.rightGap - gaps.betweenGap * (count - 1);
    const each = usable / count;
    const yMin = gaps.bottomGap;
    const yMax = model.height - gaps.topGap;
    const zMin = model.depth;
    const zMax = model.depth + model.thickness;

    return Array.from({ length: count }, (_, i) => {
      const index = i + 1;
      const xMin = gaps.leftGap + i * (each + gaps.betweenGap);
      return define(
        `CABINET.DOOR.${pad3(index)}`, `Фасад ${index}`, 'DOOR',
        { x: { min: xMin, max: xMin + each }, y: { min: yMin, max: yMax }, z: { min: zMin, max: zMax } },
        'z', model, material, { partType: 'facade', index },
      );
    });
  },
};

// ── Ножки (§34) ──────────────────────────────────────────────────────────────

export const legRule: ParametricRule = {
  id: 'CABINET.LEGS',
  name: 'Ножки',
  build(model) {
    const l = model.legs;
    if (!l.enabled) return [];
    const count = Math.max(0, Math.trunc(l.count));
    if (count === 0) return [];

    // Ножки расставляются по углам основания с заданными отступами.
    const size = 40;
    const xs = [l.insetX, model.width - l.insetX - size];
    const zs = [l.insetY, model.depth - l.insetY - size];
    const spots: Array<{ x: number; z: number }> = [];
    for (const z of zs) for (const x of xs) spots.push({ x, z });
    // Если ножек больше четырёх — добавляем промежуточные по передней и задней грани.
    while (spots.length < count) {
      const extra = spots.length - 4;
      const ratio = (extra + 1) / (Math.ceil(count / 2) + 1);
      spots.push({ x: l.insetX + (model.width - 2 * l.insetX - size) * ratio, z: zs[extra % 2] });
    }

    return spots.slice(0, count).map((spot, i) => {
      const index = i + 1;
      return define(
        `CABINET.LEG.${pad3(index)}`, `Опора ${index}`, 'LEG',
        {
          x: { min: spot.x, max: spot.x + size },
          y: { min: -l.height, max: 0 },
          z: { min: spot.z, max: spot.z + size },
        },
        'y', model, model.materialId, { partType: 'board', index, leg: true },
      );
    });
  },
};

// ── Цоколь (§35) ─────────────────────────────────────────────────────────────

export const plinthRule: ParametricRule = {
  id: 'CABINET.PLINTH',
  name: 'Цоколь',
  build(model) {
    const p = model.plinth;
    if (!p.enabled) return [];
    const material = p.material ?? model.materialId;
    // Цоколь — фронтальная планка под корпусом, утопленная вглубь.
    return [define(
      'CABINET.PLINTH', 'Цоколь', 'PLINTH',
      {
        x: { min: p.inset, max: model.width - p.inset },
        y: { min: -p.height, max: 0 },
        z: { min: p.frontOffset, max: p.frontOffset + model.thickness },
      },
      'z', model, material, { partType: 'board', plinth: true },
    )];
  },
};

/** Порядок правил корпуса: сначала оболочка, затем наполнение. */
export const CABINET_PARAMETRIC_RULES: ParametricRule[] = [
  sideRule,
  topBottomRule,
  partitionRule,
  shelfRule,
  backPanelRule,
  doorRule,
  legRule,
  plinthRule,
];

/** Стеллаж (§59): корпус и полки, без фасадов и задней стенки. */
export const SHELVING_RULES: ParametricRule[] = [
  sideRule,
  topBottomRule,
  partitionRule,
  shelfRule,
  legRule,
  plinthRule,
];

/** Правила по типу изделия (§57). */
export function rulesForKind(kind: ParametricModel['kind']): ParametricRule[] {
  return kind === 'SHELVING' ? SHELVING_RULES : CABINET_PARAMETRIC_RULES;
}

/** Построить все определения деталей модели (§14). */
export function buildDefinitions(model: ParametricModel): PartDefinition[] {
  return rulesForKind(model.kind).flatMap((rule) => rule.build(model));
}
