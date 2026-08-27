/**
 * Модули мебели (§61–§65).
 *
 * FurnitureModule — узел дерева изделия: свои параметры, свои детали и
 * вложенные модули. Полноценная BIM-система не требуется — нужна
 * архитектурная возможность вкладывать модули и копировать их.
 */
import type { ParametricModel } from '@/core/parametric/types';
import { createParametricModel } from '@/core/parametric/types';

/** Состояние модуля (§65). */
export type ModuleStatusKind = 'VALID' | 'WARNING' | 'ERROR' | 'DIRTY' | 'OUTDATED';

/** Допустимые повороты модуля в плане (§85). */
export type ModuleRotation = 0 | 90 | 180 | 270;

/**
 * Размещение модуля в сцене (§85–§87).
 *
 * Поворот и зеркало живут ЗДЕСЬ, а не в деталях (§86): локальные размеры
 * деталей от разворота шкафа не меняются, меняется только то, как модуль
 * стоит в сцене. Иначе поворот на 90° «портил» бы раскрой и чертежи.
 */
export interface ModuleTransform {
  position: { x: number; y: number; z: number };
  rotation: ModuleRotation;
  /** Зеркальное отражение по ширине (левый шкаф ↔ правый). */
  mirrored: boolean;
}

export const IDENTITY_TRANSFORM: ModuleTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: 0,
  mirrored: false,
};

/** Версия схемы модуля (§105). Растёт, когда меняется структура. */
export const MODULE_SCHEMA_VERSION = 1;

export interface FurnitureModule {
  id: string;
  type: ParametricModel['kind'];
  name: string;
  parameters: ParametricModel;
  /** Ключи деталей, порождённых этим модулем. */
  parts: string[];
  children: FurnitureModule[];
  /** Смещение модуля относительно родителя, мм. Сохранено с этапа 18. */
  offset?: { x: number; y: number; z: number };
  /** Размещение в сцене (§85–§87). */
  transform?: ModuleTransform;
  /** Скрытый модуль не показывается в 3D, но остаётся в проекте (§96). */
  visible?: boolean;
  /** Заблокированный модуль нельзя случайно сдвинуть (§97/§98). */
  locked?: boolean;
  /** Состояние модуля (§65). */
  status?: ModuleStatusKind;
  schemaVersion?: number;
  metadata?: Record<string, unknown>;
}

/** Размещение модуля с подстановкой значений по умолчанию. */
export function transformOf(module: FurnitureModule): ModuleTransform {
  const base = module.transform ?? IDENTITY_TRANSFORM;
  // Смещение этапа 18 остаётся действительным: модули прошлых проектов
  // продолжают стоять там же, где стояли.
  if (!module.transform && module.offset) {
    return { ...IDENTITY_TRANSFORM, position: { ...module.offset } };
  }
  return { position: { ...base.position }, rotation: base.rotation, mirrored: base.mirrored };
}

/** Виден ли модуль (§96). Отсутствие поля означает «виден». */
export function isVisible(module: FurnitureModule): boolean {
  return module.visible !== false;
}

/** Заблокирован ли модуль (§97). */
export function isLocked(module: FurnitureModule): boolean {
  return module.locked === true;
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
    transform: patch.transform ?? { ...IDENTITY_TRANSFORM, position: { ...IDENTITY_TRANSFORM.position } },
    visible: patch.visible ?? true,
    locked: patch.locked ?? false,
    status: patch.status ?? 'VALID',
    schemaVersion: patch.schemaVersion ?? MODULE_SCHEMA_VERSION,
    metadata: patch.metadata,
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
