/**
 * Группы модулей (§93–§95).
 *
 * Группа — это способ двигать несколько модулей вместе, а НЕ контейнер с
 * собственной геометрией. Перемещение и поворот группы меняют размещение
 * каждого модуля, но не трогают его локальные параметры (§95): ширина шкафа
 * от того, что его сгруппировали с соседним, не меняется.
 */
import {
  isLocked,
  transformOf,
  type FurnitureModule,
  type ModuleRotation,
} from './modules';
import { footprint, moveModule, rotateBy, translateModule } from './transform';

export interface ModuleGroup {
  id: string;
  name: string;
  /** Идентификаторы входящих модулей. */
  moduleIds: string[];
  locked?: boolean;
}

let counter = 0;
export function newGroupId(): string {
  counter += 1;
  return `grp-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function createGroup(moduleIds: string[], name = 'Группа'): ModuleGroup {
  return { id: newGroupId(), name, moduleIds: [...new Set(moduleIds)] };
}

/** Модули группы из общего списка. */
export function groupModules(group: ModuleGroup, modules: FurnitureModule[]): FurnitureModule[] {
  const ids = new Set(group.moduleIds);
  return modules.filter((m) => ids.has(m.id));
}

/** Габарит группы в плане — по крайним модулям. */
export function groupBounds(modules: FurnitureModule[]): {
  x: number; y: number; width: number; height: number;
} {
  if (modules.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const boxes = modules.map((m) => {
    const t = transformOf(m);
    const f = footprint(m);
    return { x: t.position.x, y: t.position.y, w: f.width, h: m.parameters.height };
  });
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const top = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, width: right - x, height: top - y };
}

/**
 * Сдвинуть группу (§95). Каждый модуль смещается на одну дельту, поэтому
 * взаимное расположение сохраняется, а параметры не затрагиваются.
 */
export function moveGroup(
  modules: FurnitureModule[],
  dx: number,
  dy = 0,
  dz = 0,
): FurnitureModule[] {
  return modules.map((m) => translateModule(m, dx, dy, dz));
}

/**
 * Повернуть группу вокруг её центра (§95). Модули поворачиваются сами и
 * переезжают по кругу — иначе поворот группы разъехался бы на составляющие.
 */
export function rotateGroup(modules: FurnitureModule[], degrees: 90 | 180 | 270): FurnitureModule[] {
  const bounds = groupBounds(modules);
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));

  return modules.map((m) => {
    if (isLocked(m)) return m;
    const p = transformOf(m).position;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const rotated = rotateBy(m, degrees);
    return moveModule(rotated, {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    });
  });
}

/** Разгруппировать: сами модули остаются, исчезает только связка. */
export function ungroup(groups: ModuleGroup[], groupId: string): ModuleGroup[] {
  return groups.filter((g) => g.id !== groupId);
}

/** Группа, в которую входит модуль. */
export function groupOfModule(groups: ModuleGroup[], moduleId: string): ModuleGroup | undefined {
  return groups.find((g) => g.moduleIds.includes(moduleId));
}

/** Повернуть один модуль в составе группы, не трогая остальные. */
export function rotateWithinGroup(
  modules: FurnitureModule[],
  moduleId: string,
  rotation: ModuleRotation,
): FurnitureModule[] {
  return modules.map((m) => (m.id === moduleId ? rotateBy(m, rotation - transformOf(m).rotation) : m));
}
