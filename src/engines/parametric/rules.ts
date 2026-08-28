/**
 * Параметрические правила (§14–§35): ParametricModel → PartDefinition[].
 *
 * Правила считают геометрию в координатах изделия: X ∈ [0, width],
 * Y ∈ [0, height] (снизу вверх), Z ∈ [0, depth] (СЗАДИ ВПЕРЁД: Z = 0 — задний
 * торец, Z = depth — фасадная плоскость). Перевод в поля Part делает
 * генератор — здесь только конструкция.
 *
 * Каждая деталь получает СТАБИЛЬНЫЙ ключ вида CABINET.SIDE.LEFT или
 * CABINET.SHELF.001 (§39): по нему деталь узнаётся при пересчёте и сохраняет
 * свой Part ID, номер и кромку.
 */
import {
  constructionMounts,
} from '@/core/parametric/types';
import type {
  ParametricModel,
  ParametricPartRole,
  ParametricRule,
  PartDefinition,
} from '@/core/parametric/types';
import type { Section } from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';
import type { MachiningId } from '@/core/model/ids';
import type { MachiningOperation, PartFace, Rotation, Vec3 } from '@/core/model/types';
import { toCabinetModel } from '@/engines/cabinet/model';

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
  /**
   * Задняя граница внутренних деталей: задняя стенка занимает своё место у
   * заднего торца (Z = 0), поэтому полки и перегородки начинаются за ней.
   */
  interiorDepthMin: number;
  /** Передняя граница внутренних деталей. */
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
  /* Верх и низ считаются НЕЗАВИСИМО: боковина укорачивается сверху только
   * если её накрывает крыша, и снизу — только если дно подложено (этап 37).
   * Для чистых схем результат тот же, что и раньше. */
  const mounts = constructionMounts(model.construction);

  const sideY = {
    min: mounts.bottomUnder ? t : 0,
    max: mounts.topOnSides ? H - t : H,
  };

  const backReserve =
    model.backPanel.type === 'INSET' || model.backPanel.type === 'GROOVE'
      ? model.backPanel.thickness + model.backPanel.offset
      : 0;

  return {
    t,
    sideY,
    interior: { x: { min: t, max: model.width - t }, y: { min: t, max: H - t } },
    interiorDepthMin: backReserve,
    interiorDepthMax: model.depth,
    baseHeight: model.legs.enabled ? model.legs.height
      : model.plinth.enabled ? model.plinth.height : 0,
  };
}

/**
 * Внутренний проём, свободный от ящиков (§49/§52).
 *
 * Ящики занимают низ изделия целиком, поэтому полки и перегородки живут ВЫШЕ
 * стопки ящиков: иначе полка пересекала бы короб (§79).
 */
export function interiorZone(model: ParametricModel): {
  x: { min: number; max: number };
  y: { min: number; max: number };
} {
  const g = computeGeometry(model);
  const slots = drawerSlots(model);
  if (slots.length === 0) return { x: g.interior.x, y: g.interior.y };
  const gap = toCabinetModel(model).drawers.gap;
  const top = Math.max(...slots.map((slot) => slot.y + slot.height)) + gap;
  return { x: g.interior.x, y: { min: Math.max(g.interior.y.min, top), max: g.interior.y.max } };
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
    const mounts = constructionMounts(model.construction);
    /* Между боковинами плита уже на 2t; накрывая боковины — во всю ширину.
     * Верх и низ считаются отдельно: схемы могут не совпадать (этап 37). */
    const between = { min: g.t, max: model.width - g.t };
    const full = { min: 0, max: model.width };
    const z = { min: 0, max: model.depth };

    const top = define(
      'CABINET.TOP', 'Крыша', 'TOP',
      {
        x: mounts.topOnSides ? full : between,
        y: { min: model.height - g.t, max: model.height },
        z,
      },
      'y', model, model.materialId, { partType: 'top' },
    );
    const bottom = define(
      'CABINET.BOTTOM', 'Дно', 'BOTTOM',
      { x: mounts.bottomUnder ? full : between, y: { min: 0, max: g.t }, z },
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
    const zone = interiorZone(model);
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
            z: { min: g.interiorDepthMin, max: g.interiorDepthMax },
          },
          'y', model, model.materialId, { partType: 'divider', index },
        );
      }
      return define(
        `CABINET.PARTITION.${pad3(index)}`, `Перегородка ${index}`, 'PARTITION',
        {
          x: { min: center - g.t / 2, max: center + g.t / 2 },
          y: zone.y,
          z: { min: g.interiorDepthMin, max: g.interiorDepthMax },
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
  const zone = interiorZone(model);
  const s = model.shelves;
  const lo = zone.y.min + s.startOffset;
  const hi = zone.y.max - s.endOffset;

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

/**
 * Границы секций по ширине: перегородки делят внутренний проём (§30).
 *
 * Один расчёт на всех: им пользуются и правило полок, и секции изделия, —
 * чтобы полка и секция не разъехались из-за двух похожих формул.
 */
export function sectionBounds(model: ParametricModel): Array<{ min: number; max: number }> {
  const g = computeGeometry(model);
  const bounds: Array<{ min: number; max: number }> = [];
  let left = g.interior.x.min;
  for (const c of partitionPositions(model)) {
    bounds.push({ min: left, max: c - g.t / 2 });
    left = c + g.t / 2;
  }
  bounds.push({ min: left, max: g.interior.x.max });
  return bounds;
}

/**
 * Секции изделия (Furniture.sections) — производная величина от модели.
 *
 * Хранится в ProjectModel как удобный срез, но НЕ является источником истины:
 * при каждой генерации пересчитывается отсюда.
 */
export function modelSections(model: ParametricModel): Section[] {
  if (model.kind === 'BOARD') return []; // щит — одна деталь, внутреннего пространства нет
  const g = computeGeometry(model);
  return sectionBounds(model).map((b, i) => ({
    id: `sec_${i}`,
    index: i,
    x: b.min,
    width: b.max - b.min,
    y: g.interior.y.min,
    height: g.interior.y.max - g.interior.y.min,
    z: 0,
    depth: model.depth,
  }));
}

export const shelfRule: ParametricRule = {
  id: 'CABINET.SHELVES',
  name: 'Полки',
  build(model) {
    const g = computeGeometry(model);
    const offsets = shelfOffsets(model);
    const bounds = sectionBounds(model);

    const shelfZMax = Math.min(g.interiorDepthMax, model.depth - model.shelves.depthReduction);
    const shelfMode = model.shelves.mode ?? 'ADJUSTABLE';
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
            z: { min: g.interiorDepthMin, max: shelfZMax },
          },
          'y', model, model.materialId,
          { partType: 'shelf', index: n, section: s + 1, shelfIndex: i + 1, shelfMode },
        ));
      }
    }
    return out;
  },
};

// ── Задняя стенка (§32/§33) ──────────────────────────────────────────────────

/**
 * Наибольший кусок задней стенки, мм (этап 36).
 *
 * Задняя стенка большого шкафа не существует одним листом: стандартный лист
 * ХДФ — 2745×1700 мм, и деталь 2368×2368 мм не выпилить ни из одного формата.
 * Поэтому стенка, не помещающаяся в лист, делится на равные куски по стыку —
 * так её и делают в цеху. Значения взяты от стандартного листа с припуском
 * на обрезку кромок листа.
 */
export const BACK_PIECE_LIMIT = { long: 2700, short: 1650 };

/** Помещается ли кусок в лист хотя бы в одной ориентации. */
function backPieceFits(width: number, height: number): boolean {
  const { long, short } = BACK_PIECE_LIMIT;
  return (width <= long && height <= short) || (width <= short && height <= long);
}

/**
 * На сколько кусков делить заднюю стенку: {cols} по ширине, {rows} по высоте.
 * Стенка, помещающаяся в лист, остаётся ОДНОЙ деталью — старые проекты не
 * меняются.
 */
export function backPanelSplit(width: number, height: number): { cols: number; rows: number } {
  if (backPieceFits(width, height)) return { cols: 1, rows: 1 };
  // Сначала делим по длинной стороне: меньше стыков.
  for (let n = 2; n <= 8; n++) {
    if (height >= width && backPieceFits(width, height / n)) return { cols: 1, rows: n };
    if (width > height && backPieceFits(width / n, height)) return { cols: n, rows: 1 };
  }
  // Крайний случай: очень большая стенка — делим по обеим сторонам.
  for (let n = 2; n <= 8; n++) {
    if (backPieceFits(width / n, height / n)) return { cols: n, rows: n };
  }
  return { cols: 1, rows: 1 };
}

export const backPanelRule: ParametricRule = {
  id: 'CABINET.BACK',
  name: 'Задняя стенка',
  build(model) {
    const m = toCabinetModel(model);
    const b = m.backPanel;
    if (b.type === 'NONE') return [];
    const g = computeGeometry(model);
    const material = b.material ?? model.materialId;

    /* Задняя стенка стоит у ЗАДНЕГО торца (Z = 0): фасады заняли переднюю
     * плоскость (Z = depth). Накладная накрывает торцы снаружи, вкладная
     * входит в проём, стенка в паз заходит в тело боковин на глубину паза. */
    const zInset = { min: b.offset, max: b.offset + b.thickness };
    const box: Box = b.type === 'OVERLAY'
      ? { x: { min: 0, max: model.width }, y: { min: 0, max: model.height }, z: { min: -b.thickness, max: 0 } }
      : b.type === 'GROOVE'
        ? {
            x: { min: g.t - b.grooveDepth, max: model.width - g.t + b.grooveDepth },
            y: { min: g.t - b.grooveDepth, max: model.height - g.t + b.grooveDepth },
            z: zInset,
          }
        : { x: g.interior.x, y: g.interior.y, z: zInset };

    const width = box.x.max - box.x.min;
    const height = box.y.max - box.y.min;
    const { cols, rows } = backPanelSplit(width, height);
    if (cols === 1 && rows === 1) {
      return [define('CABINET.BACK', 'Задняя стенка', 'BACK', box, 'z', model, material, {
        partType: 'back', backType: b.type,
      })];
    }

    /* Составная стенка: куски равные, стык проходит по всей длине. Ключи
     * содержат ряд и столбец, поэтому кусок узнаётся при пересчёте и
     * сохраняет свой id, номер и кромку. */
    const out: PartDefinition[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const piece: Box = {
          x: {
            min: box.x.min + (width * c) / cols,
            max: box.x.min + (width * (c + 1)) / cols,
          },
          y: {
            min: box.y.min + (height * r) / rows,
            max: box.y.min + (height * (r + 1)) / rows,
          },
          z: box.z,
        };
        const index = r * cols + c + 1;
        out.push(define(
          `CABINET.BACK.R${r + 1}C${c + 1}`,
          `Задняя стенка ${index}`,
          'BACK', piece, 'z', model, material,
          { partType: 'back', backType: b.type, index, row: r + 1, column: c + 1 },
        ));
      }
    }
    return out;
  },
};

// ── Конструктивная присадка: паз под заднюю стенку (§25) ─────────────────────

const opId = (defId: string, key: string): MachiningId => `cab:${defId}:${key}` as MachiningId;

/**
 * Операция паза. partId остаётся пустым: реальный идентификатор детали
 * проставляет генератор, когда деталь получает (или сохраняет) свой Part ID.
 * Так операция остаётся производной и не «застревает» между пересчётами.
 */
function grooveOp(
  defId: string,
  key: string,
  face: PartFace,
  x: number,
  y: number,
  length: number,
  width: number,
  depth: number,
  direction: 'vertical' | 'horizontal',
): MachiningOperation {
  return {
    id: opId(defId, key),
    type: 'slot',
    partId: '' as MachiningOperation['partId'],
    face,
    x, y, z: 0,
    length,
    width,
    depth,
    origin: 'generated',
    source: 'PARAMETRIC_RULE',
    toolType: 'END_MILL',
    parameters: { direction, fromEdge: 'rear' },
    metadata: { rule: 'CABINET.BACK.GROOVE' },
  };
}

/**
 * Добавить пазы под заднюю стенку в боковины, крышу и дно (§25).
 *
 * Операции живут в тех же MachiningOperation, что и вся присадка проекта:
 * второго списка операций не заводится, source помечает их как порождённые
 * параметрическим правилом.
 */
export function backGrooveMachining(
  model: ParametricModel,
  definitions: PartDefinition[],
): PartDefinition[] {
  const m = toCabinetModel(model);
  if (m.backPanel.type !== 'GROOVE') return definitions;
  const width = m.backPanel.thickness;
  const depth = m.backPanel.grooveDepth;
  const offset = m.backPanel.grooveOffset;

  return definitions.map((def) => {
    if (def.role === 'SIDE') {
      // Боковина: паз идёт вертикально на всю высоту детали.
      return { ...def, machining: [...(def.machining ?? []),
        grooveOp(def.id, 'back', 'front', offset, 0, def.height, width, depth, 'vertical')] };
    }
    if (def.role === 'TOP' || def.role === 'BOTTOM') {
      // Крыша и дно: паз идёт горизонтально на всю ширину детали.
      return { ...def, machining: [...(def.machining ?? []),
        grooveOp(def.id, 'back', 'front', 0, offset, def.width, width, depth, 'horizontal')] };
    }
    return def;
  });
}

// ── Фасады (§29–§31) ─────────────────────────────────────────────────────────

/**
 * Фасадная зона изделия по X, Y и Z в зависимости от типа наложения (§35/§36).
 * Её делят между собой двери и фронты ящиков.
 *
 * FULL  — фасад закрывает торцы боковин целиком;
 * HALF  — закрывает половину торца, вторая половина остаётся видимой;
 * INSET — фасад вкладной: стоит В проёме между боковинами.
 */
export function frontZone(model: ParametricModel): { x: { min: number; max: number }; y: { min: number; max: number }; z: { min: number; max: number } } {
  const m = toCabinetModel(model);
  const t = m.thickness;
  const gaps = m.doors.gaps;
  switch (m.doors.overlay) {
    case 'INSET':
      return {
        x: { min: t + gaps.leftGap, max: m.width - t - gaps.rightGap },
        y: { min: t + gaps.bottomGap, max: m.height - t - gaps.topGap },
        z: { min: m.depth - t, max: m.depth },
      };
    case 'HALF':
      return {
        x: { min: t / 2 + gaps.leftGap, max: m.width - t / 2 - gaps.rightGap },
        y: { min: gaps.bottomGap, max: m.height - t / 2 - gaps.topGap },
        z: { min: m.depth, max: m.depth + t },
      };
    case 'FULL':
    default:
      return {
        x: { min: gaps.leftGap, max: m.width - gaps.rightGap },
        y: { min: gaps.bottomGap, max: m.height - gaps.topGap },
        z: { min: m.depth, max: m.depth + t },
      };
  }
}

/**
 * Зона дверей: фасадная зона за вычетом стопки ящиков (§36/§43).
 *
 * Двери и ящики стоят в одной плоскости, поэтому делят её по высоте: ящики
 * занимают низ, двери — то, что осталось выше. Так конструкция «2 двери +
 * 3 ящика» не превращается в наложение деталей друг на друга (§79).
 */
export function doorZone(model: ParametricModel): ReturnType<typeof frontZone> {
  const zone = frontZone(model);
  const slots = drawerSlots(model);
  if (slots.length === 0) return zone;
  const top = Math.max(...slots.map((s) => s.y + s.height));
  const gap = toCabinetModel(model).drawers.gap;
  return { ...zone, y: { min: Math.min(top + gap, zone.y.max), max: zone.y.max } };
}

export const doorRule: ParametricRule = {
  id: 'CABINET.DOORS',
  name: 'Фасады',
  build(model) {
    const m = toCabinetModel(model);
    const count = Math.max(0, Math.trunc(m.doors.count));
    if (count === 0) return [];
    const gaps = m.doors.gaps;
    const material = m.doors.material ?? m.materialId;
    const zone = doorZone(m);

    // Ширина фасада пересчитывается от зоны наложения и зазоров (§31/§36).
    const span = zone.x.max - zone.x.min;
    const each = (span - gaps.betweenGap * (count - 1)) / count;

    return Array.from({ length: count }, (_, i) => {
      const index = i + 1;
      const xMin = zone.x.min + i * (each + gaps.betweenGap);
      /* Сторона навески: у двустворчатого фасада левая половина открывается
       * влево, правая — вправо; у одностворчатого работает model.doors.opening. */
      const side = count === 1
        ? m.doors.opening
        : i < count / 2 ? 'left' : 'right';
      return define(
        `CABINET.DOOR.${pad3(index)}`, `Фасад ${index}`, 'DOOR',
        { x: { min: xMin, max: xMin + each }, y: zone.y, z: zone.z },
        'z', model, material,
        {
          partType: 'facade', index,
          overlay: m.doors.overlay, doorKind: m.doors.kind, opening: side,
          handle: m.doors.handleEnabled
            ? { edgeOffset: m.doors.handle.edgeOffset, position: m.doors.handle.position }
            : undefined,
        },
      );
    });
  },
};

// ── Ящики (§41–§48) ──────────────────────────────────────────────────────────

export interface DrawerSlot {
  index: number;
  /** Низ фронта от пола изделия, мм. */
  y: number;
  /** Высота фронта, мм. */
  height: number;
}

/**
 * Раскладка ящиков по высоте проёма (§43/§44/§45).
 *
 * AUTO_EQUAL  — проём делится поровну с учётом зазоров;
 * PARAMETRIC  — фронты заданной высоты укладываются снизу вверх;
 * MANUAL      — низ каждого фронта задан явно в positions.
 */
export function drawerSlots(model: ParametricModel): DrawerSlot[] {
  const m = toCabinetModel(model);
  const count = Math.max(0, Math.trunc(m.drawers.count));
  if (count === 0) return [];
  const zone = frontZone(model);
  const gap = m.drawers.gap;
  const lo = zone.y.min;
  const span = zone.y.max - zone.y.min;

  /* Если в изделии есть и двери, и ящики, ящикам достаётся нижняя половина
   * фасадной зоны: остальное занимают двери (§36/§43). */
  const share = Math.trunc(m.doors.count) > 0 ? span / 2 : span;
  const auto = (share - gap * (count + 1)) / count;
  const height = m.drawers.frontHeight > 0 ? m.drawers.frontHeight : auto;

  if (m.drawers.distribution === 'MANUAL' && m.drawers.positions.length >= count) {
    return m.drawers.positions.slice(0, count)
      .map((y, i) => ({ index: i + 1, y, height }));
  }

  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    y: lo + gap + i * (height + gap),
    height,
  }));
}

/**
 * Ящик целиком: фронт, две боковины, задняя стенка и дно (§46).
 *
 * Короб уже́ проёма на зазор под направляющую с каждой стороны (§45/§83), а дно
 * ложится в паз — операции паза добавляются в машинную обработку деталей (§48).
 */
export const drawerRule: ParametricRule = {
  id: 'CABINET.DRAWERS',
  name: 'Ящики',
  build(model) {
    const m = toCabinetModel(model);
    const slots = drawerSlots(model);
    if (slots.length === 0) return [];

    const g = computeGeometry(model);
    const d = m.drawers;
    const st = d.sideThickness;
    const frontMaterial = d.material ?? m.doors.material ?? m.materialId;
    const zone = frontZone(m);

    const boxXMin = g.interior.x.min + d.sideClearance;
    const boxXMax = g.interior.x.max - d.sideClearance;
    // Короб живёт ВНУТРИ корпуса: фронт может выступать за проём, короб — нет.
    const boxLimit = { min: g.interior.y.min + d.gap, max: g.interior.y.max - d.gap };
    const boxDepth = d.slideLength > 0
      ? Math.min(d.slideLength, m.depth - g.interiorDepthMin)
      : Math.max(100, m.depth - g.interiorDepthMin - 50);
    const boxZMin = g.interiorDepthMin + 10;
    const boxZMax = boxZMin + boxDepth;

    const out: PartDefinition[] = [];
    for (const slot of slots) {
      const n = pad3(slot.index);
      const boxHeight = Math.max(60, slot.height - 2 * d.gap - 10);
      const boxMinY = Math.max(slot.y + d.gap, boxLimit.min);
      const boxY = { min: boxMinY, max: Math.min(boxMinY + boxHeight, boxLimit.max) };

      // Фронт ящика — та же фасадная плоскость, что и у дверей (§46).
      out.push(define(
        `CABINET.DRAWER.${n}.FRONT`, `Фронт ящика ${slot.index}`, 'DRAWER',
        {
          x: { min: zone.x.min, max: zone.x.max },
          y: { min: slot.y, max: slot.y + slot.height },
          z: zone.z,
        },
        'z', model, frontMaterial,
        {
          partType: 'drawer_front', drawer: slot.index, index: slot.index,
          handle: d.count > 0 && m.doors.handleEnabled
            ? { edgeOffset: m.doors.handle.edgeOffset, position: 'CENTER' }
            : undefined,
        },
      ));

      // Боковины короба: толщина по X, глубина по Z.
      for (const [side, xMin] of [['L', boxXMin], ['R', boxXMax - st]] as const) {
        out.push(define(
          `CABINET.DRAWER.${n}.SIDE.${side}`,
          `Боковина ящика ${slot.index} ${side === 'L' ? 'левая' : 'правая'}`,
          'OTHER',
          { x: { min: xMin, max: xMin + st }, y: boxY, z: { min: boxZMin, max: boxZMax } },
          'x', model, m.materialId,
          { partType: 'drawer_side', drawer: slot.index, side: side === 'L' ? 'left' : 'right' },
        ));
      }

      // Задняя стенка короба — между боковинами.
      out.push(define(
        `CABINET.DRAWER.${n}.BACK`, `Задняя стенка ящика ${slot.index}`, 'OTHER',
        {
          x: { min: boxXMin + st, max: boxXMax - st },
          y: boxY,
          z: { min: boxZMin, max: boxZMin + st },
        },
        'z', model, m.materialId,
        { partType: 'drawer_back', drawer: slot.index },
      ));

      // Дно ящика ложится в паз боковин и задней стенки.
      out.push(define(
        `CABINET.DRAWER.${n}.BOTTOM`, `Дно ящика ${slot.index}`, 'OTHER',
        {
          x: { min: boxXMin + st / 2, max: boxXMax - st / 2 },
          y: { min: boxY.min + 10, max: boxY.min + 10 + d.bottomThickness },
          z: { min: boxZMin + st / 2, max: boxZMax },
        },
        'y', model, m.materialId,
        { partType: 'drawer_bottom', drawer: slot.index, thickness: d.bottomThickness },
      ));
    }
    return out;
  },
};

/** Паз под дно ящика в боковинах и задней стенке короба (§48). */
export function drawerBottomMachining(
  model: ParametricModel,
  definitions: PartDefinition[],
): PartDefinition[] {
  const m = toCabinetModel(model);
  if (Math.trunc(m.drawers.count) <= 0) return definitions;
  const width = m.drawers.bottomThickness;
  const depth = Math.max(4, Math.round(m.drawers.sideThickness / 2));
  return definitions.map((def) => {
    const type = def.metadata?.partType;
    if (type !== 'drawer_side' && type !== 'drawer_back') return def;
    return {
      ...def,
      machining: [
        ...(def.machining ?? []),
        // Паз под дно идёт вдоль детали на высоте 10 мм от низа короба.
        grooveOp(def.id, 'bottom', 'front', 0, 10, def.width, width, depth, 'horizontal'),
      ],
    };
  });
}

// ── Ножки (§34) ──────────────────────────────────────────────────────────────

/** Габарит опоры в плане, мм. */
export const LEG_SIZE = 40;

/**
 * Точки установки опор (§29/§30).
 *
 * CORNERS   — четыре угла с заданными отступами;
 * INSET     — углы плюс промежуточные опоры по передней и задней грани;
 * SYMMETRIC — count опор двумя рядами, симметрично относительно центра.
 */
export function legSpots(model: ParametricModel): Array<{ x: number; z: number }> {
  const m = toCabinetModel(model);
  const l = m.legs;
  const size = LEG_SIZE;
  const count = Math.max(0, Math.trunc(l.count));
  if (count === 0) return [];

  const xLo = l.insetX;
  const xHi = m.width - l.insetX - size;
  const zLo = l.insetY;
  const zHi = m.depth - l.insetY - size;
  const rows = [zLo, zHi];

  if (l.placement === 'SYMMETRIC') {
    // Симметрично: опоры распределяются по ширине двумя рядами.
    const perRow = Math.max(2, Math.ceil(count / 2));
    const step = perRow > 1 ? (xHi - xLo) / (perRow - 1) : 0;
    const spots: Array<{ x: number; z: number }> = [];
    for (const z of rows) {
      for (let i = 0; i < perRow; i++) spots.push({ x: xLo + step * i, z });
    }
    return spots.slice(0, count);
  }

  const corners = [
    { x: xLo, z: zLo }, { x: xHi, z: zLo },
    { x: xLo, z: zHi }, { x: xHi, z: zHi },
  ];
  if (l.placement === 'CORNERS' || count <= 4) return corners.slice(0, Math.min(count, 4));

  // INSET: к углам добавляются промежуточные опоры по передней и задней грани.
  const extra = count - 4;
  const spots = [...corners];
  for (let i = 0; i < extra; i++) {
    const ratio = (i + 1) / (extra + 1);
    spots.push({ x: xLo + (xHi - xLo) * ratio, z: rows[i % 2] });
  }
  return spots.slice(0, count);
}

export const legRule: ParametricRule = {
  id: 'CABINET.LEGS',
  name: 'Ножки',
  build(model) {
    const l = model.legs;
    if (!l.enabled) return [];
    const spots = legSpots(model);
    if (spots.length === 0) return [];

    return spots.map((spot, i) => {
      const index = i + 1;
      return define(
        `CABINET.LEG.${pad3(index)}`, `Опора ${index}`, 'LEG',
        {
          x: { min: spot.x, max: spot.x + LEG_SIZE },
          y: { min: -l.height, max: 0 },
          z: { min: spot.z, max: spot.z + LEG_SIZE },
        },
        'y', model, model.materialId, { partType: 'board', index, leg: true },
      );
    });
  },
};

// ── Цоколь (§26/§27/§35) ─────────────────────────────────────────────────────

export const plinthRule: ParametricRule = {
  id: 'CABINET.PLINTH',
  name: 'Цоколь',
  build(model) {
    const m = toCabinetModel(model);
    const p = m.plinth;
    if (!p.enabled) return [];
    const material = p.material ?? m.materialId;
    /* Цоколь — фронтальная планка под корпусом. inset утапливает её по бокам,
     * frontOffset — вглубь от фасадной плоскости (Z = depth). */
    const zFront = m.depth - p.frontOffset;
    return [define(
      'CABINET.PLINTH', 'Цоколь', 'PLINTH',
      {
        x: { min: p.inset, max: m.width - p.inset },
        y: { min: -p.height, max: 0 },
        z: { min: zFront - p.thickness, max: zFront },
      },
      'z', model, material, { partType: 'board', plinth: true, recess: p.inset },
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
  drawerRule,
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
/**
 * Полка-щит (этап 35): изделие из одной детали.
 *
 * Раньше её строил отдельный движок шаблонов — теперь она проходит тем же
 * путём, что и шкаф, и получает те же номера, кромку и раскрой.
 */
export const boardRule: ParametricRule = {
  id: 'BOARD.PANEL',
  name: 'Полка-щит',
  build(model) {
    return [define(
      'BOARD.PANEL', 'Полка', 'SHELF',
      {
        x: { min: 0, max: model.width },
        y: { min: 0, max: model.thickness },
        z: { min: 0, max: model.depth },
      },
      'y', model, model.materialId, { partType: 'board' },
    )];
  },
};

/** Правила полки-щита: единственная деталь. */
export const BOARD_RULES: ParametricRule[] = [boardRule];

export function rulesForKind(kind: ParametricModel['kind']): ParametricRule[] {
  if (kind === 'BOARD') return BOARD_RULES;
  return kind === 'SHELVING' ? SHELVING_RULES : CABINET_PARAMETRIC_RULES;
}

/**
 * Построить все определения деталей модели (§14) и достроить конструктивную
 * присадку (§25/§48). Присадка добавляется отдельным проходом, потому что паз
 * в боковине принадлежит боковине, а причина паза — задняя стенка.
 */
export function buildDefinitions(model: ParametricModel): PartDefinition[] {
  const defs = rulesForKind(model.kind).flatMap((rule) => rule.build(model));
  return drawerBottomMachining(model, backGrooveMachining(model, defs));
}
