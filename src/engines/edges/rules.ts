/**
 * EdgeRule — правило назначения кромки (§17/§47).
 *
 * Правило получает деталь и конфигурацию сторон и возвращает материал на
 * каждую сторону. Конкретный материал берётся так:
 *   1) явно заданный в конфигурации;
 *   2) кромка по умолчанию у материала плиты (§48/§49);
 *   3) ничего — сторона остаётся без кромки.
 *
 * Правило НЕ трогает стороны, назначенные вручную (§4/§86): ручной выбор
 * переживает пересчёт, иначе смена материала плиты молча стирала бы работу
 * пользователя.
 */
import type { EdgeSide, Part, PartRole, Project } from '@/core/model/types';
import type { EdgeMaterialId } from '@/core/model/ids';
import { EDGE_SIDES } from '@/core/model/types';
import { edgeSourceOf } from './banding';
import { longSides, shortSides } from './sides';

/** Какие стороны кромить (§10/§14). */
export interface EdgeConfiguration {
  /** Материал на сторону; null — снять кромку; undefined — не трогать. */
  sides: Partial<Record<EdgeSide, EdgeMaterialId | null>>;
  /** Перекрывать ли стороны, назначенные вручную. По умолчанию нет (§86). */
  overrideManual?: boolean;
}

export type EdgeSides = Record<EdgeSide, EdgeMaterialId | null>;

export interface EdgeRule {
  id: string;
  name: string;
  /** Применимо ли правило к детали. */
  matches(part: Part): boolean;
  /** Какие стороны кромить и чем. */
  build(part: Part, project: Project): Partial<Record<EdgeSide, EdgeMaterialId | null>>;
}

/** Кромка по умолчанию для материала плиты детали (§48). */
export function defaultEdgeFor(project: Project, part: Part): EdgeMaterialId | null {
  if (!part.material) return null;
  const material = project.materials.find((m) => m.id === part.material);
  return material?.defaultEdgeMaterial ?? null;
}

/** Видимые (лицевые) стороны корпусной детали — те, что выходят наружу. */
export const VISIBLE_ROLES: readonly PartRole[] = ['facade', 'shelf', 'side', 'top', 'bottom'];

/**
 * Правило фасадов (§47): фасад виден со всех сторон, поэтому облицовывается
 * по кругу.
 */
export const facadeRule: EdgeRule = {
  id: 'FACADE_ALL',
  name: 'Фасады — кромка по всем сторонам',
  matches: (part) => part.role === 'facade',
  build(part, project) {
    const material = defaultEdgeFor(project, part);
    if (!material) return {};
    return { top: material, bottom: material, left: material, right: material };
  },
};

/**
 * Правило корпуса (§47): у полок и боковин наружу выходит передний торец,
 * поэтому кромится длинная лицевая сторона.
 */
export const carcassFrontRule: EdgeRule = {
  id: 'CARCASS_FRONT',
  name: 'Корпус — кромка переднего торца',
  matches: (part) => part.role === 'shelf' || part.role === 'side' || part.role === 'divider',
  build(part, project) {
    const material = defaultEdgeFor(project, part);
    if (!material) return {};
    const [front] = longSides(part);
    return front ? { [front]: material } : {};
  },
};

const REGISTRY: EdgeRule[] = [facadeRule, carcassFrontRule];

export function edgeRules(): EdgeRule[] {
  return [...REGISTRY];
}

export function registerEdgeRule(rule: EdgeRule): void {
  const at = REGISTRY.findIndex((r) => r.id === rule.id);
  if (at >= 0) REGISTRY[at] = rule;
  else REGISTRY.push(rule);
}

/** Стороны детали как полная запись (удобно сравнивать и присваивать). */
export function edgeSidesOf(part: Part): EdgeSides {
  return { left: part.edges.left, right: part.edges.right, top: part.edges.top, bottom: part.edges.bottom };
}

/**
 * Применить конфигурацию к детали и вернуть НОВЫЕ стороны и их источники.
 * Чистая функция: сама деталь не изменяется — запись в модель делает store,
 * поэтому обновление остаётся атомарным (§77).
 */
export function applyEdgeConfiguration(
  part: Part,
  config: EdgeConfiguration,
  source: 'PARAMETRIC' | 'MANUAL' = 'MANUAL',
): { edges: EdgeSides; sources: Partial<Record<EdgeSide, 'PARAMETRIC' | 'MANUAL'>> } {
  const edges = edgeSidesOf(part);
  const sources = { ...(part.edgeSources ?? {}) };
  for (const side of EDGE_SIDES) {
    const value = config.sides[side];
    if (value === undefined) continue;
    // Ручную сторону правило не перетирает (§86).
    if (source === 'PARAMETRIC' && !config.overrideManual && edgeSourceOf(part, side) === 'MANUAL') continue;
    edges[side] = value;
    sources[side] = source;
  }
  return { edges, sources };
}

/** Результат применения правил к детали. */
export function planEdges(project: Project, part: Part): Partial<Record<EdgeSide, EdgeMaterialId | null>> {
  const rule = REGISTRY.find((r) => r.matches(part));
  return rule ? rule.build(part, project) : {};
}

// ── Быстрые действия (§15) ───────────────────────────────────────────────────

export type EdgeQuickAction = 'all' | 'long' | 'short' | 'none';

/** Конфигурация для быстрого действия. */
export function quickActionConfig(
  part: Part,
  action: EdgeQuickAction,
  materialId: EdgeMaterialId | null,
): EdgeConfiguration {
  const sides: Partial<Record<EdgeSide, EdgeMaterialId | null>> = {};
  const targets: EdgeSide[] =
    action === 'all' ? [...EDGE_SIDES]
    : action === 'long' ? longSides(part)
    : action === 'short' ? shortSides(part)
    : [...EDGE_SIDES];
  for (const side of targets) sides[side] = action === 'none' ? null : materialId;
  return { sides, overrideManual: true };
}
