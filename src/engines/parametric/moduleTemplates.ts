/**
 * Шаблоны модулей (§107–§111).
 *
 * Шаблон — переиспользуемое ОПРЕДЕЛЕНИЕ, а не копия куска проекта (§110):
 * он описывает параметры по умолчанию, а модуль из него создаётся новый и
 * дальше живёт своей жизнью. Поэтому правка модуля не портит шаблон, а
 * правка шаблона не переписывает уже созданные модули.
 */
import { createParametricModel, type ParametricModel } from '@/core/parametric/types';
import { createModule, MODULE_SCHEMA_VERSION, type FurnitureModule } from './modules';

export interface ModuleTemplate {
  id: string;
  name: string;
  description: string;
  type: ParametricModel['kind'];
  /** Значения по умолчанию поверх базовой модели. */
  defaults: Partial<ParametricModel>;
  builtin?: boolean;
}

/** Шесть базовых шаблонов (§108). */
export const MODULE_TEMPLATES: ModuleTemplate[] = [
  {
    id: 'mod-base', name: 'Нижний шкаф', description: 'Напольная секция кухни или шкафа.',
    type: 'BASE_CABINET', builtin: true,
    defaults: {
      kind: 'BASE_CABINET', width: 600, height: 850, depth: 560,
      doors: { ...createParametricModel().doors, count: 1 },
      shelves: { ...createParametricModel().shelves, count: 1 },
    },
  },
  {
    id: 'mod-wall', name: 'Верхний шкаф', description: 'Навесная секция.',
    type: 'WALL_CABINET', builtin: true,
    defaults: {
      kind: 'WALL_CABINET', width: 600, height: 720, depth: 320,
      doors: { ...createParametricModel().doors, count: 1 },
      shelves: { ...createParametricModel().shelves, count: 2 },
    },
  },
  {
    id: 'mod-tall', name: 'Пенал', description: 'Высокий узкий шкаф во всю высоту.',
    type: 'TALL_CABINET', builtin: true,
    defaults: {
      kind: 'TALL_CABINET', width: 600, height: 2100, depth: 560,
      doors: { ...createParametricModel().doors, count: 2 },
      shelves: { ...createParametricModel().shelves, count: 5 },
    },
  },
  {
    id: 'mod-tumba', name: 'Тумба', description: 'Низкая секция под столешницу.',
    type: 'BASE_CABINET', builtin: true,
    defaults: {
      kind: 'BASE_CABINET', width: 450, height: 720, depth: 500,
      doors: { ...createParametricModel().doors, count: 1 },
      shelves: { ...createParametricModel().shelves, count: 1 },
    },
  },
  {
    id: 'mod-shelf-unit', name: 'Стеллаж', description: 'Открытая секция без фасадов.',
    type: 'SHELF_UNIT', builtin: true,
    defaults: {
      kind: 'SHELF_UNIT', width: 800, height: 1800, depth: 350,
      doors: { ...createParametricModel().doors, count: 0 },
      shelves: { ...createParametricModel().shelves, count: 4 },
    },
  },
  {
    id: 'mod-drawer-unit', name: 'Комод', description: 'Секция с выдвижными ящиками.',
    type: 'DRAWER_UNIT', builtin: true,
    defaults: {
      kind: 'DRAWER_UNIT', width: 800, height: 850, depth: 500,
      doors: { ...createParametricModel().doors, count: 0 },
      shelves: { ...createParametricModel().shelves, count: 0 },
      drawers: { ...createParametricModel().drawers, count: 3 },
    },
  },
];

export function findModuleTemplate(id: string): ModuleTemplate | undefined {
  return MODULE_TEMPLATES.find((t) => t.id === id);
}

/**
 * Создать модуль из шаблона (§109). Модуль получает СВОЮ копию параметров,
 * поэтому дальнейшая правка не затрагивает ни шаблон, ни другие модули (§110).
 */
export function moduleFromTemplate(template: ModuleTemplate, name?: string): FurnitureModule {
  const parameters = createParametricModel(structuredClone(template.defaults));
  return createModule({
    type: template.type,
    name: name ?? template.name,
    parameters,
    schemaVersion: MODULE_SCHEMA_VERSION,
    metadata: { templateId: template.id },
  });
}

/** Из какого шаблона создан модуль, если известно. */
export function templateOfModule(module: FurnitureModule): ModuleTemplate | undefined {
  const id = module.metadata?.templateId;
  return typeof id === 'string' ? findModuleTemplate(id) : undefined;
}
