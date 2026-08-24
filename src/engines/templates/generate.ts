/**
 * Генерация изделия из шаблона: параметры шаблона → CabinetParameters.
 *
 *   FurnitureTemplate + TemplateValues → CabinetParameters → CabinetEngine
 *
 * Никакой параллельной модели деталей: результат — обычные параметры корпуса,
 * которые строит существующий движок мебели. Размеры деталей выводятся движком
 * по формулам конструкции (context/rules), а не зашиваются здесь.
 */
import type { MaterialId } from '@/core/model/ids';
import {
  defaultCabinetParameters,
  type BackType,
  type CabinetParameters,
  type JointType,
} from '@/engines/furniture/cabinet';
import type { FurnitureTemplate, TemplateValues } from './types';

/** Слоты материалов для генерации (корпус/задняя стенка/фасад). */
export interface MaterialSlots {
  body: MaterialId | null;
  back: MaterialId | null;
  front: MaterialId | null;
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const boolean = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

/**
 * Документированные параметрические формулы деталей (источник размеров).
 * Используются как «понятный источник» размера (см. §9/§46) и для тестов.
 */
export const PART_FORMULAS: Record<string, string> = {
  side_left: 'height = furniture.height; depth = furniture.depth',
  side_right: 'height = furniture.height; depth = furniture.depth',
  top: 'width = furniture.width - 2 * thickness; depth = furniture.depth',
  bottom: 'width = furniture.width - 2 * thickness; depth = furniture.depth',
  shelf: 'width = section.width; depth = furniture.depth - shelfDepthReduction',
  divider: 'height = furniture.height - 2 * thickness; depth = interiorDepth',
  back: 'width = furniture.width - 2 * thickness; height = furniture.height - 2 * thickness',
  facade: 'width = (furniture.width - 2 * facadeGap - (doors - 1) * doorGap) / doors',
  board: 'width = furniture.width; depth = furniture.depth',
};

/** Преобразовать значения шаблона в полные параметры корпуса. */
export function instantiateTemplate(
  template: FurnitureTemplate,
  values: TemplateValues,
  materials: MaterialSlots,
): { type: 'cabinet'; params: CabinetParameters } {
  const base = defaultCabinetParameters({ material: materials.body, backMaterial: materials.back });
  const p: CabinetParameters = {
    ...base,
    material: materials.body,
    backMaterial: materials.back,
    frontMaterial: materials.front ?? materials.body,
  };

  const setCommon = () => {
    p.width = num(values.width, base.width);
    p.height = num(values.height, base.height);
    p.depth = num(values.depth, base.depth);
    p.thickness = num(values.materialThickness ?? values.thickness, base.thickness);
    p.back = str(values.backType, base.back) as BackType;
    p.construction = { ...base.construction, backThickness: num(values.backThickness, base.construction.backThickness) };
  };

  switch (template.generator) {
    case 'cabinet':
      setCommon();
      p.shelves = num(values.shelfCount, 4);
      p.dividers = num(values.verticalPartitionCount, 0);
      p.doors = num(values.doorCount, 0);
      p.doorGap = num(values.doorGap, 3);
      p.jointType = str(values.jointType, 'confirmat') as JointType;
      p.handleEnabled = boolean(values.handleEnabled, true);
      break;
    case 'base':
      setCommon();
      p.shelves = num(values.shelfCount, 1);
      p.doors = num(values.doorCount, 2);
      p.handleEnabled = true;
      break;
    case 'wall':
      setCommon();
      p.shelves = num(values.shelfCount, 2);
      p.doors = num(values.doorCount, 1);
      p.handleEnabled = true;
      break;
    case 'tall':
      setCommon();
      p.shelves = num(values.shelfCount, 5);
      p.dividers = num(values.verticalPartitionCount, 0);
      p.doors = num(values.doorCount, 1);
      p.handleEnabled = true;
      break;
    case 'drawer':
      setCommon();
      // Ящики моделируются как горизонтальные щиты (дно ящика). Кинематики нет.
      p.shelves = num(values.drawerCount, 4);
      p.doors = 0;
      break;
    case 'rack':
      setCommon();
      p.shelves = num(values.shelfCount, 4);
      p.dividers = num(values.verticalPartitionCount, 2);
      p.doors = 0;
      break;
    case 'tumba':
      setCommon();
      p.shelves = num(values.shelfCount, 1) + num(values.drawerCount, 0);
      p.doors = num(values.doorCount, 1);
      p.handleEnabled = true;
      break;
    case 'shelf':
      p.boardOnly = true;
      p.width = num(values.width, 800);
      p.depth = num(values.depth, 250);
      p.thickness = num(values.thickness, 18);
      p.height = p.thickness;
      p.shelves = 0;
      p.dividers = 0;
      p.doors = 0;
      p.back = 'none';
      break;
    default:
      setCommon();
  }
  return { type: 'cabinet', params: p };
}
