/** Локализация категорий каталога (материалы, фурнитура, текстура). */
import type { GrainDirection, HardwareCategory, MaterialKind } from '@/core/model/types';

export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  ldsp: 'ЛДСП',
  mdf: 'МДФ',
  plywood: 'Фанера',
  'edge-glued': 'Мебельный щит',
  solid: 'Массив',
  glass: 'Стекло',
  other: 'Другой листовой',
};

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
