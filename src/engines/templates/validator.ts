/**
 * TemplateValidator — проверка параметров шаблона и геометрии сгенерированного
 * изделия. Пользовательские ошибки формулируются понятно (без stack trace).
 */
import type { Part } from '@/core/model/types';
import { buildCabinet, validateCabinet, type CabinetParameters } from '@/engines/furniture/cabinet';
import { detectCircular, evaluateFormula, FormulaError } from './formula';
import type { FurnitureTemplate, TemplateValues } from './types';

export interface TemplateIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  paramId?: string;
}

/** Проверить значения параметров шаблона (обязательность, диапазоны, тип). */
export function validateTemplateValues(template: FurnitureTemplate, values: TemplateValues): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  for (const param of template.parameters) {
    const v = values[param.id];
    if (param.required && (v === undefined || v === null || v === '')) {
      issues.push({ severity: 'error', code: 'tpl.required', message: `Параметр «${param.name}» обязателен.`, paramId: param.id });
      continue;
    }
    if (param.type === 'NUMBER' && v !== undefined) {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        issues.push({ severity: 'error', code: 'tpl.notNumber', message: `«${param.name}» должно быть числом.`, paramId: param.id });
      } else {
        if (n <= 0 && (param.min === undefined || param.min > 0)) {
          issues.push({ severity: 'error', code: 'tpl.nonPositive', message: `${param.name} должна быть больше 0.`, paramId: param.id });
        }
        if (param.min !== undefined && n < param.min) {
          issues.push({ severity: 'error', code: 'tpl.belowMin', message: `${param.name}: минимум ${param.min}${param.unit ? ' ' + param.unit : ''}.`, paramId: param.id });
        }
        if (param.max !== undefined && n > param.max) {
          issues.push({ severity: 'error', code: 'tpl.aboveMax', message: `${param.name}: максимум ${param.max}${param.unit ? ' ' + param.unit : ''}.`, paramId: param.id });
        }
      }
    }
    if (param.type === 'ENUM' && v !== undefined && param.options) {
      if (!param.options.some((o) => o.value === v)) {
        issues.push({ severity: 'error', code: 'tpl.badEnum', message: `Недопустимое значение «${param.name}».`, paramId: param.id });
      }
    }
  }
  return issues;
}

/**
 * Проверить набор именованных формул: корректность выражений и отсутствие
 * циклических зависимостей (A→B→A).
 */
export function validateFormulas(formulas: Record<string, string>, scope: Record<string, number>): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const cycle = detectCircular(formulas);
  if (cycle) {
    issues.push({ severity: 'error', code: 'tpl.circular', message: `Циклическая зависимость формул: ${cycle.join(' → ')}.` });
  }
  for (const [name, expr] of Object.entries(formulas)) {
    try {
      evaluateFormula(expr, { ...scope, ...Object.fromEntries(Object.keys(formulas).map((k) => [k, 0])) });
    } catch (e) {
      const msg = e instanceof FormulaError ? e.message : 'ошибка';
      issues.push({ severity: 'error', code: 'tpl.badFormula', message: `Формула «${name}»: ${msg}.` });
    }
  }
  return issues;
}

/** Проверка геометрии сгенерированного изделия (переиспользует корпусный валидатор). */
export function validateTemplateGeometry(params: CabinetParameters): TemplateIssue[] {
  const parts: Part[] = buildCabinet(params).parts;
  return validateCabinet(parts, params).map((i) => ({ severity: i.severity === 'info' ? 'warning' : i.severity, code: i.code, message: i.message }));
}
