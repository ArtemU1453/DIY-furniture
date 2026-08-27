/**
 * Модули мебели (§61–§65).
 *
 * FurnitureModule — узел дерева изделия: свои параметры, свои детали и
 * вложенные модули. Полноценная BIM-система не требуется — нужна
 * архитектурная возможность вкладывать модули и копировать их.
 */
import type { ParametricModel } from '@/core/parametric/types';
import { createParametricModel } from '@/core/parametric/types';

export interface FurnitureModule {
  id: string;
  type: ParametricModel['kind'];
  name: string;
  parameters: ParametricModel;
  /** Ключи деталей, порождённых этим модулем. */
  parts: string[];
  children: FurnitureModule[];
  /** Смещение модуля относительно родителя, мм. */
  offset?: { x: number; y: number; z: number };
}

let counter = 0;
const newModuleId = (): string =>
  `mod-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function createModule(patch: Partial<FurnitureModule> = {}): FurnitureModule {
  return {
    id: patch.id ?? newModuleId(),
    type: patch.type ?? 'CABINET',
    name: patch.name ?? 'Модуль',
    parameters: patch.parameters ?? createParametricModel(),
    parts: patch.parts ?? [],
    children: patch.children ?? [],
    offset: patch.offset,
  };
}

/**
 * Копия модуля со всеми вложенными (§61). Идентификаторы новые — иначе копия
 * и оригинал начали бы делить детали.
 */
export function duplicateModule(module: FurnitureModule, name?: string): FurnitureModule {
  const copy = (m: FurnitureModule): FurnitureModule => ({
    ...structuredClone(m),
    id: newModuleId(),
    children: m.children.map(copy),
  });
  const result = copy(module);
  result.name = name ?? `${module.name} (копия)`;
  return result;
}

/** Плоский список модулей дерева, включая корень. */
export function flattenModules(root: FurnitureModule): FurnitureModule[] {
  return [root, ...root.children.flatMap(flattenModules)];
}

/** Найти модуль по id в дереве. */
export function findModule(root: FurnitureModule, id: string): FurnitureModule | undefined {
  return flattenModules(root).find((m) => m.id === id);
}

/** Заменить модуль в дереве (чистая операция). */
export function replaceModule(root: FurnitureModule, id: string, next: FurnitureModule): FurnitureModule {
  if (root.id === id) return next;
  return { ...root, children: root.children.map((c) => replaceModule(c, id, next)) };
}

/** Добавить дочерний модуль. */
export function addChildModule(root: FurnitureModule, parentId: string, child: FurnitureModule): FurnitureModule {
  if (root.id === parentId) return { ...root, children: [...root.children, child] };
  return { ...root, children: root.children.map((c) => addChildModule(c, parentId, child)) };
}

/** Удалить модуль по id (корень удалить нельзя). */
export function removeModule(root: FurnitureModule, id: string): FurnitureModule {
  return {
    ...root,
    children: root.children.filter((c) => c.id !== id).map((c) => removeModule(c, id)),
  };
}

// ── Выравнивание (§64) ───────────────────────────────────────────────────────

export type Alignment = 'LEFT' | 'CENTER' | 'RIGHT';

export interface AlignItem {
  id: string;
  x: number;
  width: number;
}

/**
 * Выровнять элементы по левому краю, центру или правому краю общего диапазона.
 * Возвращает новые координаты X — применяет их вызывающий код.
 */
export function alignItems(items: AlignItem[], alignment: Alignment): Array<{ id: string; x: number }> {
  if (items.length === 0) return [];
  const left = Math.min(...items.map((i) => i.x));
  const right = Math.max(...items.map((i) => i.x + i.width));
  const center = (left + right) / 2;

  return items.map((item) => {
    switch (alignment) {
      case 'LEFT': return { id: item.id, x: left };
      case 'RIGHT': return { id: item.id, x: right - item.width };
      case 'CENTER':
      default: return { id: item.id, x: center - item.width / 2 };
    }
  });
}

// ── Привязка (§65) ───────────────────────────────────────────────────────────

export interface SnapTarget {
  /** Координата, к которой притягиваемся. */
  value: number;
  /** Что это: край, центр, деталь. */
  kind: 'edge' | 'center' | 'part';
  label?: string;
}

/**
 * Притянуть значение к ближайшей цели в пределах допуска. Сложный CAD-snap не
 * требуется: хватает краёв, центра и существующих деталей.
 */
export function snapValue(
  value: number,
  targets: SnapTarget[],
  tolerance = 5,
): { value: number; snapped: SnapTarget | null } {
  let best: { target: SnapTarget; distance: number } | null = null;
  for (const target of targets) {
    const distance = Math.abs(target.value - value);
    if (distance > tolerance) continue;
    if (!best || distance < best.distance) best = { target, distance };
  }
  return best ? { value: best.target.value, snapped: best.target } : { value, snapped: null };
}

/** Стандартные цели привязки изделия: края, центр и границы деталей. */
export function cabinetSnapTargets(
  model: ParametricModel,
  partEdges: number[] = [],
): SnapTarget[] {
  const targets: SnapTarget[] = [
    { value: 0, kind: 'edge', label: 'Левый край' },
    { value: model.width, kind: 'edge', label: 'Правый край' },
    { value: model.width / 2, kind: 'center', label: 'Центр' },
    { value: model.thickness, kind: 'edge', label: 'Внутренний левый' },
    { value: model.width - model.thickness, kind: 'edge', label: 'Внутренний правый' },
  ];
  for (const edge of partEdges) targets.push({ value: edge, kind: 'part' });
  return targets;
}
