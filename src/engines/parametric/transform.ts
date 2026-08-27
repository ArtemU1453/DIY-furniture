/**
 * Размещение модулей в сцене (§83–§92).
 *
 * Главное решение: поворот и зеркало — свойство МОДУЛЯ, а не деталей (§86).
 * Локальные размеры деталей от разворота шкафа не меняются, поэтому раскрой,
 * кромка и присадка остаются теми же. Меняется лишь то, как модуль стоит.
 *
 * Заблокированный модуль не двигается ни одной из этих операций (§98):
 * блокировка защищает от случайного сдвига, а не только предупреждает.
 */
import type { EdgeSide, Part } from '@/core/model/types';
import {
  isLocked,
  transformOf,
  type FurnitureModule,
  type ModuleRotation,
  type ModuleTransform,
} from './modules';

/** Габарит модуля в плане с учётом поворота. */
export function footprint(module: FurnitureModule): { width: number; depth: number } {
  const { width, depth } = module.parameters;
  const rotation = transformOf(module).rotation;
  return rotation === 90 || rotation === 270 ? { width: depth, depth: width } : { width, depth };
}

/** Применить размещение, если модуль не заблокирован. */
function withTransform(module: FurnitureModule, next: Partial<ModuleTransform>): FurnitureModule {
  if (isLocked(module)) return module;
  const current = transformOf(module);
  return {
    ...module,
    transform: {
      position: { ...current.position, ...(next.position ?? {}) },
      rotation: next.rotation ?? current.rotation,
      mirrored: next.mirrored ?? current.mirrored,
    },
  };
}

/** Переместить модуль (§87). */
export function moveModule(module: FurnitureModule, position: Partial<ModuleTransform['position']>): FurnitureModule {
  const current = transformOf(module).position;
  return withTransform(module, { position: { ...current, ...position } });
}

/** Сдвинуть на дельту. */
export function translateModule(module: FurnitureModule, dx: number, dy = 0, dz = 0): FurnitureModule {
  const p = transformOf(module).position;
  return moveModule(module, { x: p.x + dx, y: p.y + dy, z: p.z + dz });
}

/** Повернуть модуль (§85). Локальные размеры деталей не трогаются (§86). */
export function rotateModule(module: FurnitureModule, rotation: ModuleRotation): FurnitureModule {
  return withTransform(module, { rotation });
}

/** Повернуть на 90° по часовой от текущего положения. */
export function rotateBy(module: FurnitureModule, degrees: number): FurnitureModule {
  const current = transformOf(module).rotation;
  const next = (((current + degrees) % 360) + 360) % 360;
  return rotateModule(module, next as ModuleRotation);
}

/**
 * Зеркальное отражение (§83/§84).
 *
 * Отражается ВЕСЬ модуль вместе с содержимым: кромка и присадка переносятся
 * на противоположные стороны деталей, иначе у зеркального шкафа кромка
 * осталась бы на изнанке, а петли — не с той стороны.
 */
export function mirrorModule(module: FurnitureModule): FurnitureModule {
  if (isLocked(module)) return module;
  const current = transformOf(module);
  return {
    ...module,
    transform: { ...current, mirrored: !current.mirrored },
    children: module.children.map(mirrorModule),
  };
}

/** Противоположная сторона по ширине — левая становится правой. */
export const MIRROR_SIDE: Record<EdgeSide, EdgeSide> = {
  left: 'right',
  right: 'left',
  top: 'top',
  bottom: 'bottom',
};

/**
 * Отразить деталь: кромка, присадка и её координаты переезжают на
 * противоположную сторону. Возвращает НОВУЮ деталь — исходная не меняется.
 */
export function mirrorPart(part: Part): Part {
  return {
    ...part,
    edges: {
      left: part.edges.right,
      right: part.edges.left,
      top: part.edges.top,
      bottom: part.edges.bottom,
    },
    edgeSources: part.edgeSources
      ? {
          ...part.edgeSources,
          left: part.edgeSources.right,
          right: part.edgeSources.left,
        }
      : undefined,
    machining: part.machining.map((op) => ({
      ...op,
      // X отсчитывается от левого края грани: при отражении он становится
      // отступом от правого.
      x: part.width - op.x,
      face: op.face === 'left' ? 'right' : op.face === 'right' ? 'left' : op.face,
    })),
  };
}

// ── Привязка (§88–§90) ───────────────────────────────────────────────────────

/** Стандартные шаги сетки, мм (§90). */
export const GRID_STEPS = [1, 5, 10, 50];

/** Привязка значения к сетке. Шаг 0 отключает привязку. */
export function snapToGrid(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

/**
 * Привязка к соседним модулям (§88): к их левому и правому краю.
 * Возвращает ближайшую цель в пределах допуска, иначе исходное значение.
 */
export function snapToModules(
  value: number,
  others: FurnitureModule[],
  tolerance = 20,
): { value: number; snapped: boolean } {
  const targets: number[] = [];
  for (const other of others) {
    const x = transformOf(other).position.x;
    targets.push(x, x + footprint(other).width);
  }
  let best: number | null = null;
  let bestDistance = tolerance;
  for (const target of targets) {
    const distance = Math.abs(target - value);
    if (distance <= bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best != null ? { value: best, snapped: true } : { value, snapped: false };
}

// ── Выравнивание и распределение (§91/§92) ───────────────────────────────────

export type AlignEdge = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM' | 'CENTER';

/**
 * Выровнять модули (§91). Заблокированные остаются на месте и служат
 * ориентиром — это и есть смысл блокировки.
 */
export function alignModules(modules: FurnitureModule[], edge: AlignEdge): FurnitureModule[] {
  if (modules.length < 2) return modules;
  const box = (m: FurnitureModule) => {
    const t = transformOf(m);
    const f = footprint(m);
    return { x: t.position.x, y: t.position.y, w: f.width, h: m.parameters.height };
  };
  const boxes = modules.map(box);
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.min(...boxes.map((b) => b.y));
  const top = Math.max(...boxes.map((b) => b.y + b.h));
  const centerX = (left + right) / 2;

  return modules.map((m, i) => {
    const b = boxes[i];
    switch (edge) {
      case 'LEFT': return moveModule(m, { x: left });
      case 'RIGHT': return moveModule(m, { x: right - b.w });
      case 'CENTER': return moveModule(m, { x: centerX - b.w / 2 });
      case 'BOTTOM': return moveModule(m, { y: bottom });
      case 'TOP': return moveModule(m, { y: top - b.h });
      default: return m;
    }
  });
}

/**
 * Распределить модули с равными промежутками (§92). Крайние остаются на
 * месте — они задают границы, внутри которых распределяется остальное.
 */
export function distributeModules(
  modules: FurnitureModule[],
  axis: 'HORIZONTAL' | 'VERTICAL' = 'HORIZONTAL',
): FurnitureModule[] {
  if (modules.length < 3) return modules;
  const key = axis === 'HORIZONTAL' ? 'x' : 'y';
  const sizeOf = (m: FurnitureModule) =>
    axis === 'HORIZONTAL' ? footprint(m).width : m.parameters.height;

  const sorted = [...modules].sort(
    (a, b) => transformOf(a).position[key] - transformOf(b).position[key],
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = transformOf(first).position[key];
  const end = transformOf(last).position[key];
  const occupied = sorted.reduce((n, m) => n + sizeOf(m), 0) - sizeOf(last);
  const span = end - start;
  const gap = (span - occupied + sizeOf(first)) / (sorted.length - 1);

  let cursor = start;
  const placed = new Map<string, FurnitureModule>();
  sorted.forEach((m, i) => {
    if (i === 0 || i === sorted.length - 1) {
      placed.set(m.id, m);
      cursor = transformOf(m).position[key] + (i === 0 ? gap : 0);
      return;
    }
    placed.set(m.id, moveModule(m, { [key]: cursor } as Partial<ModuleTransform['position']>));
    cursor += gap;
  });

  // Порядок исходного списка сохраняется — вызывающий код на него полагается.
  return modules.map((m) => placed.get(m.id) ?? m);
}
