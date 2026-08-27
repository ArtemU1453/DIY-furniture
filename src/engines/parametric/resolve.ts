/**
 * Вычисление параметров изделия (§9–§13).
 *
 * Выражения считает FormulaEngine этапа 12 — токенизация, сортировочная
 * станция, ОПЗ. Никакого eval и new Function (§10): парсер принимает только
 * числа, имена, + - * / % ( ) , и известные функции; всё остальное — ошибка.
 */
import { evaluateFormula, FormulaError, type FormulaScope } from '@/engines/templates/formula';
import type { Parameter, ParametricModel, ParameterValue } from '@/core/parametric/types';
import { buildDependencyGraph, type ParameterDependencyGraph } from './dependencyGraph';

export interface ResolveIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  parameterId?: string;
}

export interface ResolveResult {
  /** Значения всех параметров: встроенные + пользовательские. */
  values: Record<string, ParameterValue>;
  /** Числовая область — то, что видят выражения. */
  scope: FormulaScope;
  parameters: Parameter[];
  graph: ParameterDependencyGraph;
  issues: ResolveIssue[];
  ok: boolean;
}

/** Встроенные числовые величины изделия, доступные выражениям. */
export function builtinScope(model: ParametricModel): FormulaScope {
  return {
    width: model.width,
    height: model.height,
    depth: model.depth,
    thickness: model.thickness,
    backThickness: model.backPanel.thickness,
    shelves: model.shelves.count,
    partitions: model.partitions.count,
    doors: model.doors.count,
    doorGap: model.doors.gaps.betweenGap,
    legHeight: model.legs.enabled ? model.legs.height : 0,
    plinthHeight: model.plinth.enabled ? model.plinth.height : 0,
  };
}

export const BUILTIN_NAMES = [
  'width', 'height', 'depth', 'thickness', 'backThickness',
  'shelves', 'partitions', 'doors', 'doorGap', 'legHeight', 'plinthHeight',
];

/**
 * Вычислить все параметры в порядке зависимостей. При цикле вычисление
 * останавливается и возвращается ошибка — бесконечного пересчёта не будет.
 */
export function resolveParameters(model: ParametricModel): ResolveResult {
  const issues: ResolveIssue[] = [];
  const graph = buildDependencyGraph(model.parameters, BUILTIN_NAMES);

  const scope: FormulaScope = { ...builtinScope(model) };
  const values: Record<string, ParameterValue> = { ...scope };

  if (graph.cycle) {
    issues.push({
      severity: 'error',
      code: 'param.cycle',
      message: `Циклическая зависимость параметров: ${graph.cycle.join(' → ')}.`,
      parameterId: graph.cycle[0],
    });
    return { values, scope, parameters: model.parameters, graph, issues, ok: false };
  }
  for (const bad of graph.invalid) {
    issues.push({ severity: 'error', code: 'param.expression', message: bad.message, parameterId: bad.id });
  }

  const byId = new Map(model.parameters.map((p) => [p.id, p]));
  const resolved: Parameter[] = [];

  for (const id of graph.order) {
    const p = byId.get(id);
    if (!p) continue;

    // Параметр без выражения — берём значение как есть.
    if (!p.expression) {
      values[p.id] = p.value;
      if (typeof p.value === 'number') scope[p.id] = p.value;
      resolved.push({ ...p });
      continue;
    }

    // Значение с выражением: считаем, но ручная правка имеет приоритет (§43).
    if (p.overridden) {
      values[p.id] = p.value;
      if (typeof p.value === 'number') scope[p.id] = p.value;
      resolved.push({ ...p });
      continue;
    }

    try {
      const computed = evaluateFormula(p.expression, scope);
      if (!Number.isFinite(computed)) {
        throw new FormulaError('Результат выражения не является конечным числом.');
      }
      values[p.id] = computed;
      scope[p.id] = computed;
      resolved.push({ ...p, value: computed });
    } catch (e) {
      issues.push({
        severity: 'error',
        code: 'param.expression',
        message: `Параметр «${p.name}»: ${e instanceof FormulaError ? e.message : String(e)}`,
        parameterId: p.id,
      });
      resolved.push({ ...p });
    }
  }

  // Параметры, не попавшие в порядок (не должно быть, но не теряем их).
  for (const p of model.parameters) {
    if (!resolved.some((r) => r.id === p.id)) resolved.push({ ...p });
  }

  const ok = issues.every((i) => i.severity !== 'error');
  return { values, scope, parameters: resolved, graph, issues, ok };
}

/** Вычислить одно выражение в контексте модели (для предпросмотра в UI). */
export function evaluateInModel(model: ParametricModel, expression: string): {
  ok: boolean; value?: number; message?: string;
} {
  const { scope, ok } = resolveParameters(model);
  if (!ok) return { ok: false, message: 'Параметры модели содержат ошибку.' };
  try {
    const value = evaluateFormula(expression, scope);
    if (!Number.isFinite(value)) return { ok: false, message: 'Результат не является конечным числом.' };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, message: e instanceof FormulaError ? e.message : String(e) };
  }
}
