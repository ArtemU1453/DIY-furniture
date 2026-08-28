/**
 * Шаблоны фурнитуры (§104–§106) и канонические категории (§5).
 *
 * Шаблон — заготовка для создания HardwareItem: он задаёт категорию,
 * параметры, правило размещения и массив. Готовая позиция — это обычный
 * `Hardware` существующей модели, второй системы каталога не появляется (§2).
 */
import { ARRAY_PRESETS } from './arrays';
import { PLACEMENT_PRESETS } from './placement';
import type {
  Hardware,
  HardwareArraySpec,
  HardwareCategory,
  PlacementRule,
} from '@/core/model/types';
import type { HardwareId } from '@/core/model/ids';

/**
 * Канонические категории из §5. Внутренняя модель использует собственные
 * ключи с прошлых этапов; здесь задано соответствие, чтобы обе номенклатуры
 * жили вместе и переименование модели не потребовалось (§8).
 */
export type CanonicalCategory =
  | 'CONNECTOR' | 'HINGE' | 'DRAWER_SLIDE' | 'HANDLE' | 'LEG' | 'SHELF_SUPPORT'
  | 'CAM' | 'CONFIRMAT' | 'DOWEL' | 'SCREW' | 'BRACKET' | 'OTHER';

export const CANONICAL_OF_CATEGORY: Record<HardwareCategory, CanonicalCategory> = {
  confirmat: 'CONFIRMAT',
  minifix: 'CAM',
  dowel: 'DOWEL',
  'shelf-support': 'SHELF_SUPPORT',
  hinge: 'HINGE',
  slide: 'DRAWER_SLIDE',
  connector: 'CONNECTOR',
  corner: 'BRACKET',
  screw: 'SCREW',
  leg: 'LEG',
  handle: 'HANDLE',
  'back-panel': 'SCREW',
  other: 'OTHER',
};

export const CATEGORY_OF_CANONICAL: Record<CanonicalCategory, HardwareCategory> = {
  CONFIRMAT: 'confirmat',
  CAM: 'minifix',
  DOWEL: 'dowel',
  SHELF_SUPPORT: 'shelf-support',
  HINGE: 'hinge',
  DRAWER_SLIDE: 'slide',
  CONNECTOR: 'connector',
  BRACKET: 'corner',
  SCREW: 'screw',
  LEG: 'leg',
  HANDLE: 'handle',
  OTHER: 'other',
};

export const CANONICAL_CATEGORIES: CanonicalCategory[] = [
  'CONNECTOR', 'HINGE', 'DRAWER_SLIDE', 'HANDLE', 'LEG', 'SHELF_SUPPORT',
  'CAM', 'CONFIRMAT', 'DOWEL', 'SCREW', 'BRACKET', 'OTHER',
];

/** Заготовка позиции фурнитуры (§104). */
export interface HardwareTemplateSpec {
  id: string;
  name: string;
  category: HardwareCategory;
  description: string;
  parameters: Record<string, number | string | boolean>;
  /** Допустимая толщина детали, мм (§39/§112). */
  thicknessRange?: { min?: number; max?: number };
  placement?: PlacementRule;
  array?: HardwareArraySpec;
}

/** Шесть шаблонов из §104. */
export const HARDWARE_TEMPLATES: HardwareTemplateSpec[] = [
  {
    id: 'tpl-confirmat',
    name: 'Конфирмат 7×50',
    category: 'confirmat',
    description: 'Корпусная стяжка: сквозное отверстие в присоединяемой детали и глухое в торце.',
    // §35: диаметр, длина, позиция и отступ — параметры, а не константы в коде.
    parameters: { diameter: 7, length: 50, pilotDiameter: 4.5, headDiameter: 10, edgeOffset: 50 },
    thicknessRange: { min: 15 },
    placement: { reference: 'EDGE', from: 'left', x: 50, y: 'height / 2' },
    array: ARRAY_PRESETS.carcassFasteners,
  },
  {
    id: 'tpl-dowel',
    name: 'Шкант 8×30',
    category: 'dowel',
    description: 'Деревянный шкант: глухие отверстия в обеих деталях.',
    // §30: диаметр, длина, отступ от края и шаг.
    parameters: { diameter: 8, length: 30, edgeOffset: 50, spacing: 128, depth: 15 },
    thicknessRange: { min: 15 },
    placement: { reference: 'EDGE', from: 'left', x: 50, y: 'height / 2' },
    array: ARRAY_PRESETS.dowelRow,
  },
  {
    id: 'tpl-cam',
    name: 'Эксцентрик 15×12',
    category: 'minifix',
    description: 'Эксцентриковая стяжка: корпус эксцентрика, шток и футорка.',
    // §38: параметры эксцентрика и штока.
    parameters: { camDiameter: 15, camDepth: 12.5, screwDiameter: 8, screwOffset: 34, screwLength: 24 },
    // §39: корпус эксцентрика Ø15 не помещается в плиту тоньше 16 мм.
    thicknessRange: { min: 16 },
    placement: { reference: 'EDGE', from: 'left', x: 34, y: 'height / 2' },
    array: ARRAY_PRESETS.carcassFasteners,
  },
  {
    id: 'tpl-hinge',
    name: 'Петля накладная Ø35',
    category: 'hinge',
    description: 'Мебельная петля: чашка Ø35 в фасаде и ответная планка на боковине.',
    // §41: чашка, глубина, отступ от края, присадочное расстояние.
    parameters: { cupDiameter: 35, cupDepth: 12.5, edgeOffset: 22, mountingDistance: 32, plateThickness: 2 },
    // §112: чашка Ø35 глубиной 12.5 требует плиту не тоньше 16 мм.
    thicknessRange: { min: 16 },
    placement: PLACEMENT_PRESETS.hingeTop,
  },
  {
    id: 'tpl-handle',
    name: 'Ручка-скоба 96 мм',
    category: 'handle',
    description: 'Ручка на два отверстия с межцентровым расстоянием 96 мм.',
    // §49: межцентровое расстояние и отступ от края.
    parameters: { holeSpacing: 96, diameter: 5, edgeOffset: 80 },
    placement: PLACEMENT_PRESETS.handleCenter,
    array: ARRAY_PRESETS.handleHoles,
  },
  {
    id: 'tpl-shelf-support',
    name: 'Полкодержатель Ø5',
    category: 'shelf-support',
    description: 'Полкодержатель в отверстие Ø5: по два на каждую сторону полки.',
    parameters: { diameter: 5, depth: 12, edgeOffset: 50 },
    placement: PLACEMENT_PRESETS.shelfSupportFront,
    array: ARRAY_PRESETS.shelfSupports,
  },
];

export function findHardwareTemplate(id: string): HardwareTemplateSpec | undefined {
  return HARDWARE_TEMPLATES.find((t) => t.id === id);
}

/**
 * Создать позицию каталога из шаблона (§105). Возвращается обычный
 * `Hardware`: дальше он живёт в библиотеке проекта как любая другая позиция.
 */
export function hardwareFromTemplateSpec(
  template: HardwareTemplateSpec,
  id: HardwareId,
  over: Partial<Hardware> = {},
): Hardware {
  return {
    id,
    name: template.name,
    category: template.category,
    description: template.description,
    parameters: { ...template.parameters },
    thicknessRange: template.thicknessRange ? { ...template.thicknessRange } : undefined,
    placement: template.placement ? { ...template.placement } : undefined,
    array: template.array ? { ...template.array } : undefined,
    ...over,
  };
}

/**
 * Пользовательская позиция (§106/§156/§157): ни производитель, ни артикул не
 * обязательны — своя фурнитура часто не имеет ни того, ни другого.
 */
export function customHardware(id: HardwareId, name: string, category: HardwareCategory = 'other'): Hardware {
  return { id, name: name.trim() || 'Своя фурнитура', category, parameters: {} };
}
