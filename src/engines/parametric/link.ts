/**
 * Параметрическая связь значений (§75–§80/§118/§119).
 *
 * Значение параметра либо ВЫЧИСЛЯЕТСЯ из выражения (LINKED), либо задано
 * человеком (MANUAL). Разрыв связи не стирает выражение, а лишь перестаёт его
 * применять — поэтому «вернуть связь» возможно и восстанавливает ровно то,
 * что было, а не значение по умолчанию (§80).
 *
 * Выражения считает СУЩЕСТВУЮЩИЙ безопасный парсер (§11): второго движка
 * выражений не появляется.
 */
import type { Parameter, ParametricModel } from '@/core/parametric/types';
import { evaluateFormula } from '@/engines/templates/formula';

export type LinkStatus = 'LINKED' | 'MANUAL';

/** Состояние связи параметра (§79). */
export function linkStatus(parameter: Parameter): LinkStatus {
  if (!parameter.expression) return 'MANUAL';
  return parameter.overridden ? 'MANUAL' : 'LINKED';
}

/**
 * Разорвать связь (§78): значение фиксируется тем, что видно сейчас, а
 * выражение сохраняется — иначе восстановить связь было бы нечем.
 */
export function breakLink(parameter: Parameter, currentValue?: number): Parameter {
  if (!parameter.expression) return parameter;
  return {
    ...parameter,
    value: currentValue ?? parameter.value,
    overridden: true,
  };
}

/** Вернуть параметрическую связь (§80). */
export function resetLink(parameter: Parameter): Parameter {
  if (!parameter.expression) return parameter;
  const next = { ...parameter };
  delete next.overridden;
  return next;
}

/** Переменные модуля, доступные пользовательским выражениям (§72/§76). */
export function moduleScope(model: ParametricModel): Record<string, number> {
  const scope: Record<string, number> = {
    width: model.width,
    height: model.height,
    depth: model.depth,
    thickness: model.thickness,
    topThickness: model.thickness,
    bottomThickness: model.thickness,
    sideThickness: model.thickness,
    shelfThickness: model.thickness,
    backThickness: model.backPanel.thickness,
    frontGap: model.doors.gaps.betweenGap,
    shelfCount: model.shelves.count,
    doorCount: model.doors.count,
    drawerCount: model.drawers.count,
  };
  // Пользовательские числовые параметры видны в выражениях друг друга (§72).
  for (const p of model.parameters) {
    if (typeof p.value === 'number') scope[p.id] = p.value;
  }
  return scope;
}

export interface ResolvedParameter {
  parameter: Parameter;
  value: number;
  status: LinkStatus;
  error?: string;
}

/**
 * Вычислить параметр. Ошибка выражения НЕ роняет расчёт: параметр остаётся с
 * прежним значением и получает понятное сообщение — модель не должна ломаться
 * из-за опечатки в одной формуле.
 */
export function resolveParameter(parameter: Parameter, scope: Record<string, number>): ResolvedParameter {
  const status = linkStatus(parameter);
  const fallback = typeof parameter.value === 'number' ? parameter.value : 0;
  if (status === 'MANUAL' || !parameter.expression) {
    return { parameter, value: fallback, status };
  }
  try {
    return { parameter, value: evaluateFormula(parameter.expression, scope), status };
  } catch (err) {
    return {
      parameter,
      value: fallback,
      status,
      error: err instanceof Error ? err.message : 'Не удалось вычислить выражение.',
    };
  }
}

/**
 * Вычислить все параметры модели С УЧЁТОМ СВЯЗЕЙ (§79).
 *
 * Отличается от resolveParameters из resolve.ts: тот считает значения для
 * генератора, а этот дополнительно сообщает состояние связи и ошибку
 * выражения, чтобы интерфейс мог показать LINKED/MANUAL и подсказку.
 */
export function resolveLinkedParameters(model: ParametricModel): ResolvedParameter[] {
  const scope = moduleScope(model);
  return model.parameters.map((p) => resolveParameter(p, scope));
}

// ── Групповое редактирование (§118/§119) ─────────────────────────────────────

export type ModuleParameterKey = 'width' | 'height' | 'depth' | 'thickness';

/** Есть ли параметр у модели. Пока габариты есть у всех типов модулей. */
export function hasParameter(model: ParametricModel, key: ModuleParameterKey): boolean {
  return typeof model[key] === 'number';
}

/**
 * Общее значение параметра у набора моделей (§118). Возвращает null, если
 * значения различаются: показывать одно из них было бы неверно.
 */
export function commonValue(models: ParametricModel[], key: ModuleParameterKey): number | null {
  if (models.length === 0) return null;
  const first = models[0][key];
  return models.every((m) => m[key] === first) ? first : null;
}

/**
 * Применить значение к набору моделей (§118/§119). Модель без такого
 * параметра пропускается: молча выдумывать его нельзя.
 */
export function applyToAll(
  models: ParametricModel[],
  key: ModuleParameterKey,
  value: number,
): { models: ParametricModel[]; applied: number; skipped: number } {
  let applied = 0;
  let skipped = 0;
  const next = models.map((m) => {
    if (!hasParameter(m, key)) { skipped += 1; return m; }
    applied += 1;
    return { ...m, [key]: value };
  });
  return { models: next, applied, skipped };
}
