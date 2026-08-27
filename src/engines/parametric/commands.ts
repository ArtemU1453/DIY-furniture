/**
 * Команды параметрического редактора (§51–§53).
 *
 *   UI → Command → ParametricModel → Generator → ProjectModel
 *
 * UI никогда не меняет геометрию напрямую (§50): он вызывает команду, команда
 * возвращает НОВУЮ модель и человекочитаемое описание для истории. Применение
 * и запись в проект делает store — так каждая команда целиком ложится в
 * существующий undo/redo (§52).
 */
import type { MaterialId } from '@/core/model/ids';
import type {
  CabinetConstructionType,
  ParameterValue,
  ParametricModel,
  ShelfDistribution,
} from '@/core/parametric/types';

export type ParametricCommandType =
  | 'SetParameter'
  | 'AddShelf'
  | 'RemoveShelf'
  | 'AddPartition'
  | 'RemovePartition'
  | 'AddDoor'
  | 'RemoveDoor'
  | 'SetMaterial'
  | 'SetConstruction'
  | 'SetShelfDistribution'
  | 'SetLegs'
  | 'SetPlinth';

export interface CommandResult {
  ok: boolean;
  model: ParametricModel;
  /** Запись для истории: «Изменена ширина: 800 → 1000». */
  description: string;
  message?: string;
}

const unchanged = (model: ParametricModel, message: string): CommandResult =>
  ({ ok: false, model, description: '', message });

/** Числовые поля верхнего уровня, доступные SetParameter. */
const NUMERIC_FIELDS: Record<string, { label: string; get: (m: ParametricModel) => number; set: (m: ParametricModel, v: number) => ParametricModel }> = {
  width: { label: 'ширина', get: (m) => m.width, set: (m, v) => ({ ...m, width: v }) },
  height: { label: 'высота', get: (m) => m.height, set: (m, v) => ({ ...m, height: v }) },
  depth: { label: 'глубина', get: (m) => m.depth, set: (m, v) => ({ ...m, depth: v }) },
  thickness: { label: 'толщина материала', get: (m) => m.thickness, set: (m, v) => ({ ...m, thickness: v }) },
  backThickness: {
    label: 'толщина задней стенки',
    get: (m) => m.backPanel.thickness,
    set: (m, v) => ({ ...m, backPanel: { ...m.backPanel, thickness: v } }),
  },
  doorGap: {
    label: 'зазор между фасадами',
    get: (m) => m.doors.gaps.betweenGap,
    set: (m, v) => ({ ...m, doors: { ...m.doors, gaps: { ...m.doors.gaps, betweenGap: v } } }),
  },
  shelfDepthReduction: {
    label: 'отступ полки по глубине',
    get: (m) => m.shelves.depthReduction,
    set: (m, v) => ({ ...m, shelves: { ...m.shelves, depthReduction: v } }),
  },
};

export const SETTABLE_FIELDS = Object.keys(NUMERIC_FIELDS);

/**
 * SetParameter — изменить габарит, толщину или пользовательский параметр.
 * Нечисловые и неположительные значения отклоняются здесь же (§83/§84):
 * в модель они не попадут.
 */
export function setParameter(
  model: ParametricModel,
  field: string,
  value: ParameterValue,
): CommandResult {
  const numeric = NUMERIC_FIELDS[field];
  if (numeric) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return unchanged(model, `Некорректное значение для «${numeric.label}»: ${String(value)}.`);
    }
    const before = numeric.get(model);
    if (before === value) return unchanged(model, 'Значение не изменилось.');
    return {
      ok: true,
      model: numeric.set(model, value),
      description: `Изменена ${numeric.label}: ${before} → ${value}`,
    };
  }

  // Пользовательский параметр (§7).
  const index = model.parameters.findIndex((p) => p.id === field);
  if (index < 0) return unchanged(model, `Неизвестный параметр «${field}».`);
  const param = model.parameters[index];
  const before = param.value;
  if (before === value) return unchanged(model, 'Значение не изменилось.');

  const parameters = [...model.parameters];
  // Ручная правка вычисляемого параметра помечается override (§43).
  parameters[index] = { ...param, value, overridden: Boolean(param.expression) };
  return {
    ok: true,
    model: { ...model, parameters },
    description: `Изменён параметр «${param.name}»: ${String(before)} → ${String(value)}`,
  };
}

/** AddShelf / RemoveShelf (§51). */
export function addShelf(model: ParametricModel, count = 1): CommandResult {
  const before = model.shelves.count;
  const after = before + count;
  return {
    ok: true,
    model: { ...model, shelves: { ...model.shelves, count: after } },
    description: `Добавлена полка (${before} → ${after})`,
  };
}

export function removeShelf(model: ParametricModel, count = 1): CommandResult {
  const before = model.shelves.count;
  if (before <= 0) return unchanged(model, 'Полок нет.');
  const after = Math.max(0, before - count);
  return {
    ok: true,
    model: { ...model, shelves: { ...model.shelves, count: after } },
    description: `Удалена полка (${before} → ${after})`,
  };
}

/** AddPartition / RemovePartition. */
export function addPartition(model: ParametricModel, count = 1): CommandResult {
  const before = model.partitions.count;
  const after = before + count;
  return {
    ok: true,
    model: { ...model, partitions: { ...model.partitions, count: after } },
    description: `Добавлена перегородка (${before} → ${after})`,
  };
}

export function removePartition(model: ParametricModel, count = 1): CommandResult {
  const before = model.partitions.count;
  if (before <= 0) return unchanged(model, 'Перегородок нет.');
  const after = Math.max(0, before - count);
  const positions = model.partitions.positions.slice(0, after);
  return {
    ok: true,
    model: { ...model, partitions: { ...model.partitions, count: after, positions } },
    description: `Удалена перегородка (${before} → ${after})`,
  };
}

/** AddDoor / RemoveDoor. */
export function addDoor(model: ParametricModel, count = 1): CommandResult {
  const before = model.doors.count;
  const after = before + count;
  return {
    ok: true,
    model: { ...model, doors: { ...model.doors, count: after } },
    description: `Добавлен фасад (${before} → ${after})`,
  };
}

export function removeDoor(model: ParametricModel, count = 1): CommandResult {
  const before = model.doors.count;
  if (before <= 0) return unchanged(model, 'Фасадов нет.');
  const after = Math.max(0, before - count);
  return {
    ok: true,
    model: { ...model, doors: { ...model.doors, count: after } },
    description: `Удалён фасад (${before} → ${after})`,
  };
}

/** SetMaterial — материал корпуса (и толщина, если она известна). */
export function setMaterial(
  model: ParametricModel,
  materialId: MaterialId | null,
  thickness?: number,
): CommandResult {
  const before = model.materialId;
  if (before === materialId && (thickness == null || thickness === model.thickness)) {
    return unchanged(model, 'Материал не изменился.');
  }
  const next: ParametricModel = { ...model, materialId };
  if (thickness != null && Number.isFinite(thickness) && thickness > 0) {
    next.thickness = thickness;
  }
  const suffix = thickness != null && thickness !== model.thickness
    ? `, толщина ${model.thickness} → ${thickness} мм` : '';
  return { ok: true, model: next, description: `Изменён материал корпуса${suffix}` };
}

/** Схема корпуса (§21). */
export function setConstruction(model: ParametricModel, construction: CabinetConstructionType): CommandResult {
  if (model.construction === construction) return unchanged(model, 'Схема не изменилась.');
  return {
    ok: true,
    model: { ...model, construction },
    description: `Изменена схема корпуса: ${model.construction} → ${construction}`,
  };
}

/** Способ распределения полок (§24/§25). */
export function setShelfDistribution(model: ParametricModel, distribution: ShelfDistribution): CommandResult {
  if (model.shelves.distribution === distribution) return unchanged(model, 'Распределение не изменилось.');
  return {
    ok: true,
    model: { ...model, shelves: { ...model.shelves, distribution } },
    description: `Распределение полок: ${model.shelves.distribution} → ${distribution}`,
  };
}

/** Ножки (§34). */
export function setLegs(model: ParametricModel, patch: Partial<ParametricModel['legs']>): CommandResult {
  const legs = { ...model.legs, ...patch };
  const toggled = patch.enabled != null && patch.enabled !== model.legs.enabled;
  return {
    ok: true,
    model: { ...model, legs },
    description: toggled ? (legs.enabled ? 'Добавлены ножки' : 'Убраны ножки') : 'Изменены параметры ножек',
  };
}

/** Цоколь (§35). */
export function setPlinth(model: ParametricModel, patch: Partial<ParametricModel['plinth']>): CommandResult {
  const plinth = { ...model.plinth, ...patch };
  const toggled = patch.enabled != null && patch.enabled !== model.plinth.enabled;
  return {
    ok: true,
    model: { ...model, plinth },
    description: toggled ? (plinth.enabled ? 'Добавлен цоколь' : 'Убран цоколь') : 'Изменены параметры цоколя',
  };
}

/** Единая точка вызова команды по имени — удобно для UI и истории. */
export function runCommand(
  model: ParametricModel,
  type: ParametricCommandType,
  payload: Record<string, unknown> = {},
): CommandResult {
  switch (type) {
    case 'SetParameter':
      return setParameter(model, String(payload.field), payload.value as ParameterValue);
    case 'AddShelf': return addShelf(model, Number(payload.count ?? 1));
    case 'RemoveShelf': return removeShelf(model, Number(payload.count ?? 1));
    case 'AddPartition': return addPartition(model, Number(payload.count ?? 1));
    case 'RemovePartition': return removePartition(model, Number(payload.count ?? 1));
    case 'AddDoor': return addDoor(model, Number(payload.count ?? 1));
    case 'RemoveDoor': return removeDoor(model, Number(payload.count ?? 1));
    case 'SetMaterial':
      return setMaterial(model, (payload.materialId ?? null) as MaterialId | null, payload.thickness as number | undefined);
    case 'SetConstruction':
      return setConstruction(model, payload.construction as CabinetConstructionType);
    case 'SetShelfDistribution':
      return setShelfDistribution(model, payload.distribution as ShelfDistribution);
    case 'SetLegs': return setLegs(model, payload as Partial<ParametricModel['legs']>);
    case 'SetPlinth': return setPlinth(model, payload as Partial<ParametricModel['plinth']>);
    default:
      return unchanged(model, `Неизвестная команда: ${String(type)}`);
  }
}
