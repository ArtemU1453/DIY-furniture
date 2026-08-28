/**
 * Параметры корпусного шкафа и производные настройки конструкции.
 *
 * CabinetParameters — сериализуемое описание изделия (источник истины).
 * Детали НЕ хранятся здесь: они порождаются движком из этих параметров.
 */
import type { MaterialId } from '@/core/model/ids';
import { createParametricModel, PARAMETRIC_KEY, type ParametricModel } from '@/core/parametric/types';

/** Схема установки верха. Расширяется добавлением значений/стратегий. */
export type TopMount = 'between' | 'overlay'; // между боковинами | поверх боковин
/** Схема установки низа. */
export type BottomMount = 'between' | 'under'; // между боковинами | под боковинами
/** Тип задней стенки. */
export type BackType = 'none' | 'overlay' | 'inset' | 'groove';
/** Тип соединения корпуса. */
export type JointType = 'confirmat' | 'dowel' | 'minifix';
/** Тип открывания фасада. */
export type DoorOpening = 'left' | 'right' | 'double';

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
  // ── Фасады и соединения (этап 12) ──────────────────────────────────────────
  doors: number; // количество фасадов (0 — без фасадов)
  doorGap: number; // зазор между фасадами
  doorOpening: DoorOpening;
  handleEnabled: boolean;
  jointType: JointType; // тип корпусного соединения
  frontMaterial: MaterialId | null; // материал фасадов
  /** Полка-щит: единственная деталь (шаблон «Полка»). */
  boardOnly: boolean;
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
    doors: 0,
    doorGap: 3,
    doorOpening: 'double',
    handleEnabled: false,
    jointType: 'confirmat',
    frontMaterial: input.material ?? null,
    boardOnly: false,
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

/**
 * Обратное преобразование: параметрическая модель → CabinetParameters (этап 35).
 *
 * Нужно там, где интерфейс и старые проверки читают простые параметры шкафа.
 * Это ЧТЕНИЕ, а не вторая генерация: детали по-прежнему строит один
 * параметрический движок, здесь лишь другой взгляд на те же значения.
 */
export function toCabinetParameters(model: ParametricModel): CabinetParameters {
  const BACK_BY_TYPE: Record<string, CabinetParameters['back']> = {
    INSET: 'inset', OVERLAY: 'overlay', GROOVE: 'groove', NONE: 'none',
  };
  return {
    width: model.width,
    height: model.height,
    depth: model.depth,
    thickness: model.thickness,
    material: model.materialId,
    top: model.construction === 'ON_SIDES' ? 'overlay' : 'between',
    // У низа своя пара значений: «под боковинами» — аналог крышки поверх.
    bottom: model.construction === 'ON_SIDES' ? 'under' : 'between',
    back: BACK_BY_TYPE[model.backPanel.type] ?? 'inset',
    backMaterial: model.backPanel.material,
    shelves: model.shelves.count,
    dividers: model.partitions.count,
    construction: {
      ...DEFAULT_CONSTRUCTION,
      backThickness: model.backPanel.thickness,
      backOffset: model.backPanel.offset,
      shelfDepthReduction: model.shelves.depthReduction,
    },
    doors: model.doors.count,
    doorGap: model.doors.gaps.betweenGap,
    doorOpening: model.doors.opening,
    handleEnabled: model.doors.handleEnabled,
    jointType: model.jointType,
    frontMaterial: model.doors.material,
    boardOnly: model.kind === 'BOARD',
  };
}

/**
 * Прочитать параметры шкафа из сырых params изделия.
 *
 * Источник истины — параметрическая модель (этап 35): если она есть, простые
 * параметры ВЫВОДЯТСЯ из неё, а не читаются как вторая копия, которая может
 * разойтись с деталями. Старые проекты без модели читаются как раньше (§91).
 */
export function readCabinetParameters(
  params: Record<string, unknown> | undefined,
): CabinetParameters {
  const stored = params?.[PARAMETRIC_KEY];
  if (stored && typeof stored === 'object') {
    return toCabinetParameters(createParametricModel(stored as Partial<ParametricModel>));
  }
  const base = defaultCabinetParameters();
  return normalizeCabinetParameters(params as Partial<CabinetParameters> | undefined, base);
}
