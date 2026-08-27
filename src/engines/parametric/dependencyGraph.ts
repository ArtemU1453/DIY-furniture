/**
 * ParameterDependencyGraph (§12/§13).
 *
 * Строит граф «какой параметр от какого зависит» по выражениям, даёт порядок
 * вычисления и обнаруживает циклы A → B → A. Разбор выражений идёт через
 * существующий FormulaEngine этапа 12 — без eval и без второго парсера.
 */
import { formulaVariables, FormulaError } from '@/engines/templates/formula';
import type { Parameter } from '@/core/parametric/types';

export interface DependencyNode {
  id: string;
  /** От кого зависит этот параметр. */
  dependsOn: string[];
  /** Кто зависит от него. */
  usedBy: string[];
  /** Есть ли выражение (иначе значение задано напрямую). */
  computed: boolean;
}

export interface ParameterDependencyGraph {
  nodes: Map<string, DependencyNode>;
  /** Порядок вычисления: зависимости раньше зависимых. Пуст при цикле. */
  order: string[];
  /** Найденный цикл, например ['a','b','a']; null — циклов нет. */
  cycle: string[] | null;
  /** Выражения, которые не удалось разобрать. */
  invalid: Array<{ id: string; message: string }>;
}

/**
 * Построить граф зависимостей. Ссылки на неизвестные имена не считаются
 * зависимостями графа: это либо встроенные величины (width, thickness), либо
 * ошибка, которую поймает вычислитель.
 */
export function buildDependencyGraph(
  parameters: Parameter[],
  /** Имена, которые считаются заданными извне (width, height, thickness…). */
  builtins: string[] = [],
): ParameterDependencyGraph {
  const known = new Set(parameters.map((p) => p.id));
  const builtinSet = new Set(builtins);
  const nodes = new Map<string, DependencyNode>();
  const invalid: Array<{ id: string; message: string }> = [];

  for (const p of parameters) {
    nodes.set(p.id, { id: p.id, dependsOn: [], usedBy: [], computed: Boolean(p.expression) });
  }

  for (const p of parameters) {
    if (!p.expression) continue;
    let vars: string[];
    try {
      vars = formulaVariables(p.expression);
    } catch (e) {
      invalid.push({ id: p.id, message: e instanceof FormulaError ? e.message : String(e) });
      continue;
    }
    const node = nodes.get(p.id)!;
    for (const v of vars) {
      if (v === p.id) {
        // Параметр, ссылающийся сам на себя, — вырожденный цикл.
        node.dependsOn.push(v);
        continue;
      }
      if (known.has(v)) {
        node.dependsOn.push(v);
        nodes.get(v)!.usedBy.push(p.id);
      } else if (!builtinSet.has(v)) {
        invalid.push({ id: p.id, message: `Неизвестная переменная «${v}» в выражении.` });
      }
    }
  }

  const cycle = findCycle(nodes);
  const order = cycle ? [] : topoOrder(nodes);
  return { nodes, order, cycle, invalid };
}

/** Поиск цикла обходом в глубину с раскраской. */
function findCycle(nodes: Map<string, DependencyNode>): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    color.set(id, GRAY);
    stack.push(id);
    for (const dep of nodes.get(id)?.dependsOn ?? []) {
      if (!nodes.has(dep)) continue;
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        const start = stack.indexOf(dep);
        return stack.slice(start).concat(dep);
      }
      if (c === WHITE) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    color.set(id, BLACK);
    stack.pop();
    return null;
  };

  for (const id of nodes.keys()) {
    if ((color.get(id) ?? WHITE) === WHITE) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}

/** Топологический порядок: зависимости идут раньше зависимых. */
function topoOrder(nodes: Map<string, DependencyNode>): string[] {
  const order: string[] = [];
  const seen = new Set<string>();

  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dep of nodes.get(id)?.dependsOn ?? []) {
      if (nodes.has(dep)) visit(dep);
    }
    order.push(id);
  };

  for (const id of nodes.keys()) visit(id);
  return order;
}

/** Все параметры, которые придётся пересчитать при изменении данного (§89). */
export function dependents(graph: ParameterDependencyGraph, id: string): string[] {
  const out = new Set<string>();
  const walk = (current: string): void => {
    for (const next of graph.nodes.get(current)?.usedBy ?? []) {
      if (out.has(next)) continue;
      out.add(next);
      walk(next);
    }
  };
  walk(id);
  return [...out];
}
