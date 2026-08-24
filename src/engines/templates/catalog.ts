/**
 * Встроенный каталог типовых конструкций. Каждый шаблон описывает параметры и
 * ключ генератора; генерация превращает параметры в обычные CabinetParameters
 * (см. generate.ts) — без создания параллельной модели деталей.
 */
import type { FurnitureTemplate, TemplateParameter } from './types';

const dim = (id: string, name: string, def: number, min = 50, max = 3000, unit = 'мм'): TemplateParameter => ({
  id, name, type: 'NUMBER', defaultValue: def, min, max, step: 1, unit, required: true,
});
const count = (id: string, name: string, def: number, max = 12): TemplateParameter => ({
  id, name, type: 'NUMBER', defaultValue: def, min: 0, max, step: 1, unit: 'шт', required: true,
});
const bool = (id: string, name: string, def: boolean): TemplateParameter => ({
  id, name, type: 'BOOLEAN', defaultValue: def, required: false,
});
const backTypeParam: TemplateParameter = {
  id: 'backType', name: 'Задняя стенка', type: 'ENUM', defaultValue: 'inset', required: true,
  options: [
    { value: 'none', label: 'Нет' },
    { value: 'overlay', label: 'Накладная' },
    { value: 'inset', label: 'Вкладная' },
    { value: 'groove', label: 'В паз' },
  ],
};
const jointParam: TemplateParameter = {
  id: 'jointType', name: 'Соединение', type: 'ENUM', defaultValue: 'confirmat', required: true,
  options: [
    { value: 'confirmat', label: 'Конфирмат' },
    { value: 'dowel', label: 'Шкант' },
    { value: 'minifix', label: 'Минификс' },
  ],
};

export const BUILTIN_TEMPLATES: FurnitureTemplate[] = [
  {
    id: 'tpl-cabinet', name: 'Шкаф', category: 'CABINET', generator: 'cabinet', version: '1.0', preview: '🚪', builtin: true,
    description: 'Корпусный шкаф с полками, перегородками и фасадами.',
    parameters: [
      dim('width', 'Ширина', 800), dim('height', 'Высота', 2000), dim('depth', 'Глубина', 600),
      dim('materialThickness', 'Толщина корпуса', 16, 8, 40), dim('backThickness', 'Толщина задней стенки', 3, 2, 24),
      count('shelfCount', 'Полки', 4), count('verticalPartitionCount', 'Перегородки', 1, 6),
      count('doorCount', 'Фасады', 2, 6), dim('doorGap', 'Зазор фасадов', 3, 0, 20),
      backTypeParam, jointParam, bool('handleEnabled', 'Ручки', true),
    ],
  },
  {
    id: 'tpl-base', name: 'Нижний шкаф', category: 'BASE_CABINET', generator: 'base', version: '1.0', preview: '🗄️', builtin: true,
    description: 'Нижняя секция кухни/шкафа со столешницей.',
    parameters: [
      dim('width', 'Ширина', 800), dim('height', 'Высота', 820), dim('depth', 'Глубина', 560),
      dim('materialThickness', 'Толщина', 16, 8, 40), count('shelfCount', 'Полки', 1),
      count('doorCount', 'Фасады', 2, 4), backTypeParam,
    ],
  },
  {
    id: 'tpl-wall', name: 'Навесной шкаф', category: 'WALL_CABINET', generator: 'wall', version: '1.0', preview: '🧰', builtin: true,
    description: 'Навесной кухонный шкаф.',
    parameters: [
      dim('width', 'Ширина', 600), dim('height', 'Высота', 720), dim('depth', 'Глубина', 300),
      dim('materialThickness', 'Толщина', 16, 8, 40), count('doorCount', 'Фасады', 1, 4),
      count('shelfCount', 'Полки', 2), backTypeParam,
    ],
  },
  {
    id: 'tpl-tall', name: 'Пенал', category: 'TALL_CABINET', generator: 'tall', version: '1.0', preview: '🚪', builtin: true,
    description: 'Высокий узкий шкаф-пенал.',
    parameters: [
      dim('width', 'Ширина', 500), dim('height', 'Высота', 2100), dim('depth', 'Глубина', 560),
      dim('materialThickness', 'Толщина', 16, 8, 40), count('shelfCount', 'Полки', 5),
      count('doorCount', 'Фасады', 1, 4), count('verticalPartitionCount', 'Перегородки', 0, 4),
    ],
  },
  {
    id: 'tpl-drawer', name: 'Комод', category: 'DRAWER_UNIT', generator: 'drawer', version: '1.0', preview: '🗃️', builtin: true,
    description: 'Комод с ящиками (детали ящиков создаются как горизонтальные щиты).',
    parameters: [
      dim('width', 'Ширина', 800), dim('height', 'Высота', 900), dim('depth', 'Глубина', 500),
      dim('materialThickness', 'Толщина', 16, 8, 40), count('drawerCount', 'Ящики', 4, 10),
      dim('drawerHeight', 'Высота ящика', 180, 60, 400), backTypeParam,
    ],
  },
  {
    id: 'tpl-rack', name: 'Стеллаж', category: 'RACK', generator: 'rack', version: '1.0', preview: '🗂️', builtin: true,
    description: 'Открытый стеллаж с полками и перегородками.',
    parameters: [
      dim('width', 'Ширина', 1000), dim('height', 'Высота', 1800), dim('depth', 'Глубина', 300),
      dim('materialThickness', 'Толщина', 18, 8, 40), count('shelfCount', 'Полки', 4),
      count('verticalPartitionCount', 'Перегородки', 2, 8), backTypeParam,
    ],
  },
  {
    id: 'tpl-shelf', name: 'Полка', category: 'SHELF', generator: 'shelf', version: '1.0', preview: '📏', builtin: true,
    description: 'Одиночная полка-щит с кромкой.',
    parameters: [
      dim('width', 'Ширина', 800), dim('depth', 'Глубина', 250),
      dim('thickness', 'Толщина', 18, 8, 40), bool('edgeAll', 'Кромка по периметру', true),
    ],
  },
  {
    id: 'tpl-tumba', name: 'Тумба', category: 'BASE_CABINET', generator: 'tumba', version: '1.0', preview: '🪑', builtin: true,
    description: 'Тумба с полками, фасадами и ящиками.',
    parameters: [
      dim('width', 'Ширина', 600), dim('height', 'Высота', 700), dim('depth', 'Глубина', 500),
      dim('materialThickness', 'Толщина', 16, 8, 40), count('shelfCount', 'Полки', 1),
      count('doorCount', 'Фасады', 1, 4), count('drawerCount', 'Ящики', 0, 6), backTypeParam,
    ],
  },
];

export function findTemplate(id: string, extra: FurnitureTemplate[] = []): FurnitureTemplate | undefined {
  return [...BUILTIN_TEMPLATES, ...extra].find((t) => t.id === id);
}
