/**
 * Коллизии и зазоры в сцене (§95–§100).
 *
 * Пересечения деталей считает существующий движок viewer (detectCollisions):
 * здесь добавляются фурнитура и зазоры, а результат переводится в термины
 * сцены — с узлами, к которым можно перейти по клику (§98).
 */
import type { Part, Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { detectCollisions } from '@/engines/viewer';
import type { FurnitureScene, SceneNode } from './types';
import { nodeOfPart } from './build';

/** Минимальный допустимый зазор между деталями, мм (§99). */
export const DEFAULT_CLEARANCE = 2;

export interface SceneCollision {
  severity: 'error' | 'warning';
  code: 'collision' | 'clearance';
  message: string;
  /** Узлы, которые нужно выбрать по клику (§98). */
  nodeIds: string[];
  /** Насколько объекты пересекаются или насколько мал зазор, мм. */
  amount: number;
}

function overlapAmount(a: SceneNode, b: SceneNode): { overlap: number; gap: number } {
  const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
  let minOverlap = Infinity;
  let maxGap = -Infinity;
  for (const axis of axes) {
    const ac = a.world.position[axis];
    const bc = b.world.position[axis];
    const half = (a.size[axis] + b.size[axis]) / 2;
    const distance = Math.abs(ac - bc);
    minOverlap = Math.min(minOverlap, half - distance);
    maxGap = Math.max(maxGap, distance - half);
  }
  return { overlap: minOverlap, gap: maxGap };
}

/**
 * Проверка сцены на пересечения и малые зазоры (§96/§97/§100).
 *
 * Пересечение деталей — ошибка, слишком малый зазор — предупреждение: цеху
 * важно различать «не соберётся» и «соберётся, но впритык».
 */
export function sceneCollisions(
  scene: FurnitureScene,
  project: Project,
  options: { clearance?: number; tolerance?: number } = {},
): SceneCollision[] {
  const clearance = options.clearance ?? DEFAULT_CLEARANCE;
  const tolerance = options.tolerance ?? 1;
  const out: SceneCollision[] = [];

  // Детали: используем существующий детектор, чтобы правила совпадали с 3D.
  const parts: Part[] = allParts(project);
  const byId = new Map(parts.map((p) => [String(p.id), p]));
  for (const pair of detectCollisions(parts, tolerance)) {
    const a = nodeOfPart(scene, pair.a);
    const b = nodeOfPart(scene, pair.b);
    // Глубину пересечения считаем по узлам сцены: в паре её нет.
    const amount = a && b ? Math.round(overlapAmount(a, b).overlap * 10) / 10 : 0;
    out.push({
      severity: 'error',
      code: 'collision',
      message: `Детали «${pair.aName || byId.get(pair.a)?.name || pair.a}» и «${pair.bName || byId.get(pair.b)?.name || pair.b}» пересекаются.`,
      nodeIds: [a?.id, b?.id].filter((id): id is string => id !== undefined),
      amount,
    });
  }

  // Фурнитура: пересечения между единицами и малые зазоры (§96/§99).
  const hardware = scene.order.map((id) => scene.nodes[id]).filter((n) => n.kind === 'HARDWARE');
  for (let i = 0; i < hardware.length; i++) {
    for (let j = i + 1; j < hardware.length; j++) {
      const a = hardware[i];
      const b = hardware[j];
      if (a.parentId !== b.parentId) continue;
      const { overlap, gap } = overlapAmount(a, b);
      if (overlap > tolerance) {
        out.push({
          severity: 'error',
          code: 'collision',
          message: `Фурнитура «${a.label}» и «${b.label}» пересекаются.`,
          nodeIds: [a.id, b.id],
          amount: Math.round(overlap * 10) / 10,
        });
      } else if (gap >= 0 && gap < clearance) {
        out.push({
          severity: 'warning',
          code: 'clearance',
          message: `Зазор между «${a.label}» и «${b.label}» всего ${Math.round(gap * 10) / 10} мм.`,
          nodeIds: [a.id, b.id],
          amount: Math.round(gap * 10) / 10,
        });
      }
    }
  }
  return out;
}

/** Сводка проверки (§97). */
export function collisionSummary(items: SceneCollision[]): { errors: number; warnings: number } {
  return {
    errors: items.filter((i) => i.severity === 'error').length,
    warnings: items.filter((i) => i.severity === 'warning').length,
  };
}
