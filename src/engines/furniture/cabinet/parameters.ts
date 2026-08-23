/**
 * Параметры корпусного шкафа и производные настройки конструкции.
 *
 * CabinetParameters — сериализуемое описание изделия (источник истины).
 * Детали НЕ хранятся здесь: они порождаются движком из этих параметров.
 */
import type { MaterialId } from '@/core/model/ids';

/** Схема установки верха. Расширяется добавлением значений/стратегий. */
export type TopMount = 'between' | 'overlay'; // между боковинами | поверх боковин
/** Схема установки низа. */
export type BottomMount = 'between' | 'under'; // между боковинами | под боковинами
/** Тип задней стенки. */
export type BackType = 'none' | 'overlay' | 'inset' | 'groove';

/** Параметры зазоров/отступов конструкции (не зашиваются в формулы). */
export interface ConstructionSettings {
  backOffset: number; // отступ вкладной задней стенки от заднего торца
  backThickness: number; // толщина задней стенки
  shelfDepthReduction: number; // насколько полка мельче корпуса по глубине
  shelfGap: number; // зазор полки (резерв для будущего)
  facadeGap: number; // зазор фасада (резерв)
  bottomGap: number; // резерв
  topGap: number; // резерв
}

export const DEFAULT_CONSTRUCTION: ConstructionSettings = {
  backOffset: 0,
  backThickness: 3,
  shelfDepthReduction: 20,
  shelfGap: 0,
  facadeGap: 3,
  bottomGap: 0,
  topGap: 0,
};

export interface CabinetParameters {
  width: number;
  height: number;
  depth: number;
  thickness: number;
  material: MaterialId | null;
  top: TopMount;
  bottom: BottomMount;
  back: BackType;
  backMaterial: MaterialId | null;
  shelves: number; // полок на секцию
  dividers: number; // вертикальных перегородок
  construction: ConstructionSettings;
}

export interface CabinetDefaultsInput {
  material?: MaterialId | null;
  backMaterial?: MaterialId | null;
}

export function defaultCabinetParameters(input: CabinetDefaultsInput = {}): CabinetParameters {
  return {
    width: 800,
    height: 2000,
    depth: 600,
    thickness: 16,
    material: input.material ?? null,
    top: 'between',
    bottom: 'between',
    back: 'inset',
    backMaterial: input.backMaterial ?? null,
    shelves: 3,
    dividers: 0,
    construction: { ...DEFAULT_CONSTRUCTION },
  };
}

/** Нормализовать частично заданные параметры до полного набора. */
export function normalizeCabinetParameters(
  partial: Partial<CabinetParameters> | undefined,
  base: CabinetParameters,
): CabinetParameters {
  if (!partial) return base;
  return {
    ...base,
    ...partial,
    construction: { ...base.construction, ...(partial.construction ?? {}) },
  };
}

/** Прочитать параметры шкафа из сырых params изделия. */
export function readCabinetParameters(
  params: Record<string, unknown> | undefined,
): CabinetParameters {
  const base = defaultCabinetParameters();
  return normalizeCabinetParameters(params as Partial<CabinetParameters> | undefined, base);
}
