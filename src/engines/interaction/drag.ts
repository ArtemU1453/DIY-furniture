/**
 * Перетаскивание конструктивных элементов (§25–§32).
 *
 * Полка, перегородка, фасад и ящик — ПРОИЗВОДНЫЕ детали: их положение задают
 * параметры шкафа. Поэтому перетаскивание мышью не двигает деталь напрямую, а
 * превращается в изменение параметра (§22): полка получает ручное положение,
 * перегородка — свою координату, ящик — свою высоту. Так модель остаётся
 * согласованной, а Undo откатывает один параметр, а не «поехавшую» геометрию.
 */
import type { Part, Project } from '@/core/model/types';
import type { ParametricModel } from '@/core/parametric/types';
import { drawerSlots, frontZone, interiorZone, toCabinetModel } from '@/engines/cabinet';
import { computeGeometry, shelfOffsets } from '@/engines/parametric';
import { partWorldAABB } from '@/core/geometry/partGeometry';

/** Что именно тянут. */
export type DragTarget = 'SHELF' | 'DIVIDER' | 'DOOR' | 'DRAWER' | 'PART';

export interface DragRefusal {
  code: string;
  message: string;
}

export interface DragOutcome {
  ok: boolean;
  /** Новая модель шкафа; при отказе — исходная. */
  model: ParametricModel;
  /** Человекочитаемое описание для истории (§120). */
  description: string;
  /** Итоговая координата после ограничений и привязок, мм. */
  value?: number;
  refusal?: DragRefusal;
}

const fail = (model: ParametricModel, code: string, message: string): DragOutcome =>
  ({ ok: false, model, description: '', refusal: { code, message } });

/** Индекс детали в её группе: полка 3, перегородка 2, ящик 1. */
export function indexOfPart(part: Part): number {
  const raw = part.metadata?.shelfIndex ?? part.metadata?.drawer ?? part.metadata?.index;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 1;
}

/** Что за конструктивный элемент перед нами (§25/§27/§29/§31). */
export function dragTargetOf(part: Part): DragTarget {
  const type = String(part.metadata?.partType ?? '');
  if (type === 'shelf') return 'SHELF';
  if (type === 'divider') return 'DIVIDER';
  if (type === 'facade') return 'DOOR';
  if (type.startsWith('drawer')) return 'DRAWER';
  return 'PART';
}

/**
 * Перетащить полку по высоте (§25/§26).
 *
 * Полка не может встать на верх или дно и не может совпасть с соседней: между
 * полками остаётся хотя бы толщина плюс минимальный просвет.
 */
export function dragShelf(
  model: ParametricModel,
  index: number,
  targetY: number,
  options: { minGap?: number } = {},
): DragOutcome {
  const m = toCabinetModel(model);
  const count = Math.trunc(m.shelves.count);
  if (index < 1 || index > count) {
    return fail(model, 'drag.noShelf', `Полки ${index} нет в изделии.`);
  }
  const zone = interiorZone(m);
  const minGap = options.minGap ?? 60;
  const t = m.thickness;

  const offsets = shelfOffsets(m);
  const below = index > 1 ? offsets[index - 2] : zone.y.min;
  const above = index < count ? offsets[index] : zone.y.max;

  const lo = below + t + minGap;
  const hi = above - t - minGap;
  if (lo > hi) {
    return fail(model, 'drag.noRoom', `Полке ${index} некуда двигаться: соседние полки слишком близко.`);
  }

  const value = Math.min(hi, Math.max(lo, targetY));
  const fixedShelves = [
    ...m.shelves.fixedShelves.filter((f) => f.index !== index),
    { index, offset: value, fixed: true },
  ].sort((a, b) => a.index - b.index);

  return {
    ok: true,
    model: { ...model, shelves: { ...m.shelves, fixedShelves } },
    description: `Полка ${index}: ${Math.round(value)} мм`,
    value,
  };
}

/** Перетащить перегородку по ширине (§27/§28). */
export function dragDivider(
  model: ParametricModel,
  index: number,
  targetX: number,
  options: { minSection?: number } = {},
): DragOutcome {
  const m = toCabinetModel(model);
  const count = Math.trunc(m.partitions.count);
  if (index < 1 || index > count) {
    return fail(model, 'drag.noDivider', `Перегородки ${index} нет в изделии.`);
  }
  const g = computeGeometry(m);
  const minSection = options.minSection ?? 100;
  const t = m.thickness;

  const positions = m.partitions.positions.length >= count
    ? [...m.partitions.positions]
    : evenPositions(m, count);

  const left = index > 1 ? positions[index - 2] + t : g.interior.x.min;
  const right = index < count ? positions[index] - t : g.interior.x.max;
  const lo = left + minSection;
  const hi = right - minSection;
  if (lo > hi) {
    return fail(model, 'drag.noRoom', `Перегородке ${index} некуда двигаться: секции стали бы уже ${minSection} мм.`);
  }

  const value = Math.min(hi, Math.max(lo, targetX));
  positions[index - 1] = value;
  return {
    ok: true,
    model: { ...model, partitions: { ...m.partitions, positions } },
    description: `Перегородка ${index}: ${Math.round(value)} мм`,
    value,
  };
}

/** Равномерные положения перегородок — стартовое значение для ручного сдвига. */
function evenPositions(model: ParametricModel, count: number): number[] {
  const g = computeGeometry(model);
  const span = g.interior.x.max - g.interior.x.min;
  const step = span / (count + 1);
  return Array.from({ length: count }, (_, i) => g.interior.x.min + step * (i + 1));
}

/**
 * Сдвинуть фасад (§29/§30).
 *
 * Если параметрическая связь включена, положение фасада задаётся зазорами:
 * перетаскивание меняет зазор, а не координату детали, и общий зазор между
 * створками сохраняется. С разорванной связью фасад просто получает Override.
 */
export function dragDoor(
  model: ParametricModel,
  edge: 'left' | 'right' | 'top' | 'bottom',
  delta: number,
  options: { linked?: boolean } = {},
): DragOutcome {
  const m = toCabinetModel(model);
  if (Math.trunc(m.doors.count) <= 0) {
    return fail(model, 'drag.noDoor', 'В изделии нет фасадов.');
  }
  if (options.linked === false) {
    return fail(model, 'drag.unlinked', 'Связь фасада разорвана: положение задаётся вручную в свойствах детали.');
  }
  const gaps = { ...m.doors.gaps };
  const key = edge === 'left' ? 'leftGap' : edge === 'right' ? 'rightGap' : edge === 'top' ? 'topGap' : 'bottomGap';
  const next = Math.round((gaps[key] + delta) * 10) / 10;
  if (next < 0) {
    return fail(model, 'drag.negativeGap', 'Зазор фасада не может быть отрицательным.');
  }
  gaps[key] = next;
  return {
    ok: true,
    model: { ...model, doors: { ...m.doors, gaps } },
    description: `Зазор фасада (${edge}): ${next} мм`,
    value: next,
  };
}

/**
 * Перетащить ящик по высоте (§31/§32).
 *
 * Ящик не наезжает на соседей и не выходит за фасадную зону: между фронтами
 * остаётся заданный зазор.
 */
export function dragDrawer(model: ParametricModel, index: number, targetY: number): DragOutcome {
  const m = toCabinetModel(model);
  const count = Math.trunc(m.drawers.count);
  if (index < 1 || index > count) {
    return fail(model, 'drag.noDrawer', `Ящика ${index} нет в изделии.`);
  }
  const slots = drawerSlots(m);
  const zone = frontZone(m);
  const gap = m.drawers.gap;
  const height = slots[index - 1]?.height ?? 0;

  const below = index > 1 ? slots[index - 2].y + slots[index - 2].height : zone.y.min;
  const above = index < count ? slots[index].y : zone.y.max;
  const lo = below + gap;
  const hi = above - gap - height;
  if (lo > hi) {
    return fail(model, 'drag.noRoom', `Ящику ${index} некуда двигаться: соседние ящики занимают место.`);
  }

  const value = Math.min(hi, Math.max(lo, targetY));
  const positions = slots.map((slot) => slot.y);
  positions[index - 1] = value;
  return {
    ok: true,
    model: {
      ...model,
      drawers: { ...m.drawers, distribution: 'MANUAL', positions, frontHeight: height },
    },
    description: `Ящик ${index}: ${Math.round(value)} мм`,
    value,
  };
}

/**
 * Перетаскивание детали в общем виде: конструктивный элемент уходит в свой
 * параметр, обычная деталь — в Override положения (§22/§23).
 */
export interface PartDragPlan {
  target: DragTarget;
  /** Индекс элемента в его группе. */
  index: number;
  /** Ось, вдоль которой имеет смысл тянуть этот элемент. */
  axis: 'x' | 'y' | 'z';
}

export function planPartDrag(part: Part): PartDragPlan {
  const target = dragTargetOf(part);
  const axis = target === 'DIVIDER' ? 'x' : target === 'DOOR' ? 'x' : 'y';
  return { target, index: indexOfPart(part), axis };
}

/** Текущая координата детали по оси — от неё считается перетаскивание. */
export function currentCoordinate(part: Part, axis: 'x' | 'y' | 'z', project?: Project): number {
  void project;
  const box = partWorldAABB(part);
  return (box.min[axis] + box.max[axis]) / 2;
}
