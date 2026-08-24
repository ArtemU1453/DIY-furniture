/** Публичный API движка типовых конструкций (шаблонов). */
export {
  type FurnitureTemplate,
  type FurnitureCategory,
  type TemplateParameter,
  type TemplateParameterType,
  type TemplateParameterOption,
  type TemplateValues,
  type TemplateBinding,
  CATEGORY_LABELS,
  defaultValues,
} from './types';
export { BUILTIN_TEMPLATES, findTemplate } from './catalog';
export { instantiateTemplate, PART_FORMULAS, type MaterialSlots } from './generate';
export {
  planCabinetConnections,
  hingeCountForHeight,
  type ConnectionPlan,
} from './connections';
export {
  validateTemplateValues,
  validateFormulas,
  validateTemplateGeometry,
  type TemplateIssue,
} from './validator';
export {
  evaluateFormula,
  formulaVariables,
  detectCircular,
  FormulaError,
  type FormulaScope,
} from './formula';
export {
  loadCustomTemplates,
  saveCustomTemplates,
  addCustomTemplate,
  removeCustomTemplate,
} from './storage';
