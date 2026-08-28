/**
 * Параметрические шаблоны и совместимость (§56–§60, §90–§92).
 *
 * ParametricModel хранится в ProjectModel рядом с параметрами изделия, поэтому
 * переживает сохранение и перезагрузку (§90). Старые проекты, где её нет,
 * продолжают открываться: модель восстанавливается из существующих
 * CabinetParameters (§91/§92) — миграция, а не поломка.
 */
import type { Furniture } from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';
import {
  createParametricModel,
  DEFAULT_LIMITS,
  PARAMETRIC_KEY,
  type FurnitureKind,
  type ParametricModel,
} from '@/core/parametric/types';
import type { CabinetParameters } from '@/engines/furniture/cabinet/parameters';

export { PARAMETRIC_KEY };
/* Обратное преобразование живёт рядом с самими параметрами: так его читает и
 * readCabinetParameters, не создавая круговой зависимости (этап 35). */
export { toCabinetParameters } from '@/engines/furniture/cabinet/parameters';

export interface ParametricTemplate {
  id: string;
  kind: FurnitureKind;
  name: string;
  description: string;
  build(): ParametricModel;
}

/** Шаблон шкафа (§58): корпус, полки, фасады, задняя стенка. */
export const cabinetTemplate: ParametricTemplate = {
  id: 'param-cabinet',
  kind: 'CABINET',
  name: 'Шкаф',
  description: 'Корпусный шкаф с полками, перегородками и фасадами.',
  build: () => createParametricModel({
    kind: 'CABINET',
    width: 800, height: 2000, depth: 600, thickness: 16,
    shelves: { count: 4, distribution: 'AUTO_EQUAL', spacing: 0, startOffset: 0, endOffset: 0, fixedShelves: [], depthReduction: 20 },
    partitions: { count: 1, positions: [], orientation: 'VERTICAL' },
    doors: {
      count: 2,
      gaps: { topGap: 2, bottomGap: 2, leftGap: 2, rightGap: 2, betweenGap: 3 },
      opening: 'double', handleEnabled: true, material: null,
    },
    backPanel: { type: 'INSET', thickness: 3, offset: 0, material: null },
  }),
};

/** Шаблон стеллажа (§59): боковины, верх, низ, полки. Без фасадов. */
export const shelvingTemplate: ParametricTemplate = {
  id: 'param-shelving',
  kind: 'SHELVING',
  name: 'Стеллаж',
  description: 'Открытый стеллаж: две боковины, верх, низ и полки.',
  build: () => createParametricModel({
    kind: 'SHELVING',
    width: 900, height: 1800, depth: 350, thickness: 18,
    shelves: { count: 4, distribution: 'AUTO_EQUAL', spacing: 0, startOffset: 0, endOffset: 0, fixedShelves: [], depthReduction: 0 },
    partitions: { count: 0, positions: [], orientation: 'VERTICAL' },
    doors: {
      count: 0,
      gaps: { topGap: 2, bottomGap: 2, leftGap: 2, rightGap: 2, betweenGap: 3 },
      opening: 'double', handleEnabled: false, material: null,
    },
    backPanel: { type: 'NONE', thickness: 3, offset: 0, material: null },
  }),
};

/** Шаблон тумбы (§60): низкий корпус с полками и фасадами. */
export const baseCabinetTemplate: ParametricTemplate = {
  id: 'param-base',
  kind: 'BASE_CABINET',
  name: 'Тумба',
  description: 'Нижняя тумба с полкой и фасадами; ящики — как опция.',
  build: () => createParametricModel({
    kind: 'BASE_CABINET',
    width: 800, height: 820, depth: 560, thickness: 16,
    shelves: { count: 1, distribution: 'AUTO_EQUAL', spacing: 0, startOffset: 0, endOffset: 0, fixedShelves: [], depthReduction: 20 },
    partitions: { count: 0, positions: [], orientation: 'VERTICAL' },
    doors: {
      count: 2,
      gaps: { topGap: 2, bottomGap: 2, leftGap: 2, rightGap: 2, betweenGap: 3 },
      opening: 'double', handleEnabled: true, material: null,
    },
    backPanel: { type: 'INSET', thickness: 3, offset: 0, material: null },
    legs: { enabled: true, height: 100, insetX: 50, insetY: 50, count: 4 },
  }),
};

export const PARAMETRIC_TEMPLATES: ParametricTemplate[] = [
  cabinetTemplate,
  shelvingTemplate,
  baseCabinetTemplate,
];

export function findParametricTemplate(id: string): ParametricTemplate | undefined {
  return PARAMETRIC_TEMPLATES.find((t) => t.id === id);
}

// ── Совместимость со старыми проектами (§91/§92) ─────────────────────────────

const BACK_TYPE_MAP: Record<string, ParametricModel['backPanel']['type']> = {
  none: 'NONE', inset: 'INSET', overlay: 'OVERLAY', groove: 'GROOVE',
};

/**
 * Восстановить параметрическую модель из CabinetParameters прошлых этапов.
 * Ничего не ломает: старый проект просто получает эквивалентное описание.
 */
export function fromCabinetParameters(params: Partial<CabinetParameters>): ParametricModel {
  const thickness = params.thickness ?? 16;
  const construction = params.top === 'overlay' ? 'ON_SIDES' : 'BETWEEN_SIDES';
  const boardOnly = params.boardOnly === true;
  return createParametricModel({
    kind: boardOnly ? 'BOARD' : 'CABINET',
    width: params.width ?? 800,
    height: params.height ?? 2000,
    depth: params.depth ?? 600,
    thickness,
    materialId: (params.material ?? null) as MaterialId | null,
    construction,
    jointType: params.jointType ?? 'confirmat',
    shelves: {
      count: params.shelves ?? 0,
      distribution: 'AUTO_EQUAL',
      spacing: 0, startOffset: 0, endOffset: 0, fixedShelves: [],
      depthReduction: params.construction?.shelfDepthReduction ?? 20,
    },
    partitions: { count: params.dividers ?? 0, positions: [], orientation: 'VERTICAL' },
    doors: {
      count: params.doors ?? 0,
      gaps: {
        topGap: 2, bottomGap: 2, leftGap: 2, rightGap: 2,
        betweenGap: params.doorGap ?? 3,
      },
      opening: params.doorOpening ?? 'double',
      handleEnabled: params.handleEnabled ?? false,
      material: (params.frontMaterial ?? null) as MaterialId | null,
    },
    backPanel: {
      type: BACK_TYPE_MAP[params.back ?? 'inset'] ?? 'INSET',
      thickness: params.construction?.backThickness ?? 3,
      offset: params.construction?.backOffset ?? 0,
      material: (params.backMaterial ?? null) as MaterialId | null,
    },
    // У щита высота равна толщине — корпусный минимум к нему неприменим.
    limits: boardOnly ? { ...DEFAULT_LIMITS, minimumHeight: 1 } : { ...DEFAULT_LIMITS },
  });
}

/**
 * Прочитать параметрическую модель изделия. Если её нет — восстановить из
 * старых параметров, чтобы проект открылся без миграции файла (§91).
 */
export function readParametricModel(furniture: Furniture): ParametricModel {
  const params = (furniture.params ?? {}) as Record<string, unknown>;
  const stored = params[PARAMETRIC_KEY];
  if (stored && typeof stored === 'object') {
    // Достраиваем недостающие блоки значениями по умолчанию.
    return createParametricModel(stored as Partial<ParametricModel>);
  }
  return fromCabinetParameters(params as Partial<CabinetParameters>);
}

/** Есть ли у изделия сохранённая параметрическая модель. */
export function hasParametricModel(furniture: Furniture): boolean {
  const params = (furniture.params ?? {}) as Record<string, unknown>;
  const stored = params[PARAMETRIC_KEY];
  return Boolean(stored && typeof stored === 'object');
}
