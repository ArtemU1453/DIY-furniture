/**
 * Модель типовых конструкций (FurnitureTemplate).
 *
 * Шаблон — это НЕ отдельная модель деталей. Он описывает параметры и способ
 * порождения обычного ProjectModel (через существующий движок мебели). После
 * создания проект полностью редактируется штатными средствами и может быть
 * отвязан от шаблона.
 */

export type FurnitureCategory =
  | 'CABINET'
  | 'WALL_CABINET'
  | 'BASE_CABINET'
  | 'TALL_CABINET'
  | 'DRAWER_UNIT'
  | 'SHELF'
  | 'RACK'
  | 'OTHER';

export type TemplateParameterType = 'NUMBER' | 'BOOLEAN' | 'ENUM' | 'STRING';

export interface TemplateParameterOption {
  value: string;
  label: string;
}

export interface TemplateParameter {
  id: string;
  name: string;
  type: TemplateParameterType;
  defaultValue: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  required: boolean;
  options?: TemplateParameterOption[]; // для ENUM
}

/** Значения параметров, введённые пользователем. */
export type TemplateValues = Record<string, number | boolean | string>;

export interface FurnitureTemplate {
  id: string;
  name: string;
  category: FurnitureCategory;
  description: string;
  parameters: TemplateParameter[];
  /** Ключ генератора (маппинг параметров → параметры изделия). */
  generator: string;
  preview?: string; // эмодзи/иконка (без внешних ресурсов)
  version: string;
  builtin?: boolean;
}

/** Связь изделия с шаблоном (хранится в furniture.metadata.template). */
export interface TemplateBinding {
  templateId: string;
  generator: string;
  values: TemplateValues;
  detached?: boolean;
}

export const CATEGORY_LABELS: Record<FurnitureCategory, string> = {
  CABINET: 'Шкаф',
  WALL_CABINET: 'Навесной шкаф',
  BASE_CABINET: 'Нижний шкаф',
  TALL_CABINET: 'Пенал',
  DRAWER_UNIT: 'Комод',
  SHELF: 'Полка',
  RACK: 'Стеллаж',
  OTHER: 'Другое',
};

/** Значения по умолчанию из схемы параметров. */
export function defaultValues(template: FurnitureTemplate): TemplateValues {
  const out: TemplateValues = {};
  for (const p of template.parameters) out[p.id] = p.defaultValue;
  return out;
}
