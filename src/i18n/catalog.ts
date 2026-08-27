/** Локализация категорий каталога (материалы, фурнитура, текстура). */
import type {
  GrainDirection,
  HardwareCategory,
  MaterialCategory,
  MaterialKind,
} from '@/core/model/types';

export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  ldsp: 'ЛДСП',
  mdf: 'МДФ',
  plywood: 'Фанера',
  'edge-glued': 'Мебельный щит',
  solid: 'Массив',
  hdf: 'ХДФ',
  glass: 'Стекло',
  other: 'Другой листовой',
};

/** Категории материалов библиотеки (§3/§32). */
export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  LDSP: 'ЛДСП',
  MDF: 'МДФ',
  PLYWOOD: 'Фанера',
  SOLID_WOOD: 'Дерево',
  HDF: 'ХДФ',
  OTHER: 'Другое',
};

export function materialCategoryLabel(c: MaterialCategory): string {
  return MATERIAL_CATEGORY_LABELS[c] ?? c;
}

export const HARDWARE_CATEGORY_LABELS: Record<HardwareCategory, string> = {
  confirmat: 'Конфирмат',
  minifix: 'Эксцентрик',
  dowel: 'Шкант',
  'shelf-support': 'Полкодержатель',
  hinge: 'Петля',
  slide: 'Направляющая',
  connector: 'Стяжка',
  corner: 'Уголок',
  screw: 'Саморез',
  leg: 'Опора',
  handle: 'Ручка',
  'back-panel': 'Крепёж задней стенки',
  other: 'Другой крепёж',
};

export const GRAIN_LABELS: Record<GrainDirection, string> = {
  none: 'Нет',
  length: 'Вдоль листа',
  width: 'Поперёк листа',
};

export const materialKindLabel = (k: MaterialKind): string => MATERIAL_KIND_LABELS[k] ?? k;
export const hardwareCategoryLabel = (c: HardwareCategory): string =>
  HARDWARE_CATEGORY_LABELS[c] ?? c;
export const grainLabel = (g: GrainDirection): string => GRAIN_LABELS[g] ?? g;
