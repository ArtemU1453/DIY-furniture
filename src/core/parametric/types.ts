/**
 * Параметрическая модель мебели (§3–§16, §21–§35).
 *
 *   PARAMETERS → PARAMETRIC RULES → PROJECT MODEL → PARTS → CONNECTIONS →
 *   MACHINING → 3D → CUTTING → DOCUMENTS
 *
 * Модель НЕ хранит геометрию: детали порождаются из параметров правилами и
 * живут в ProjectModel. Второй системы деталей здесь не заводится — типы
 * описывают, ЧТО построить, а не готовые Part.
 *
 * ParametricModel — надстройка над CabinetParameters этапов 03/12: те же
 * ширина/высота/глубина, но с формальными параметрами, лимитами и настройками
 * полок, перегородок, фасадов, ножек и цоколя.
 */
import type { MaterialId } from '@/core/model/ids';
import type { Mm, Vec3, Rotation, PartRole } from '@/core/model/types';

// ── Параметры (§7/§8) ────────────────────────────────────────────────────────

export type ParameterType = 'NUMBER' | 'BOOLEAN' | 'ENUM' | 'STRING';

export type ParameterValue = number | boolean | string;

/** Одна параметрическая переменная изделия. */
export interface Parameter {
  id: string;
  name: string;
  type: ParameterType;
  value: ParameterValue;
  /** Единица измерения: 'mm', 'шт' и т.п. Для BOOLEAN/ENUM не задаётся. */
  unit?: string;
  /**
   * Выражение вида `width - 2 * thickness` (§9). Если задано, значение
   * вычисляется из него, а поле value хранит последний расчёт.
   */
  expression?: string;
  /** Границы для NUMBER (§6). */
  min?: number;
  max?: number;
  /** Допустимые значения для ENUM. */
  options?: Array<{ value: string; label: string }>;
  /** Параметр изменён пользователем вручную, а не вычислен. */
  overridden?: boolean;
}

/** Габаритные ограничения изделия (§6) — параметры шаблона, не константы UI. */
export interface DimensionLimits {
  minimumWidth: Mm;
  maximumWidth: Mm;
  minimumHeight: Mm;
  maximumHeight: Mm;
  minimumDepth: Mm;
  maximumDepth: Mm;
}

export const DEFAULT_LIMITS: DimensionLimits = {
  minimumWidth: 100,
  maximumWidth: 3000,
  minimumHeight: 100,
  maximumHeight: 3000,
  minimumDepth: 100,
  maximumDepth: 1200,
};

// ── Схема корпуса (§21) ──────────────────────────────────────────────────────

/**
 * BETWEEN_SIDES — верх и низ входят МЕЖДУ боковинами (боковины во всю высоту).
 * ON_SIDES      — верх и низ лежат НА боковинах (накрывают их сверху/снизу).
 *
 * Правила этих схем не смешиваются: каждая считает свои размеры и позиции.
 */
export type CabinetConstructionType = 'BETWEEN_SIDES' | 'ON_SIDES';

// ── Полки (§22–§26) ──────────────────────────────────────────────────────────

/** AUTO_EQUAL — равномерно между верхом и низом; MANUAL — по заданным высотам. */
export type ShelfDistribution = 'AUTO_EQUAL' | 'MANUAL';

/** Полка, положение которой пользователь задал явно. */
export interface FixedShelf {
  /** Порядковый номер полки, начиная с 1. */
  index: number;
  /** Высота от низа корпуса, мм. */
  offset: Mm;
  /** Не перемещается при пересчёте (§26). */
  fixed: boolean;
}

export interface ShelfSettings {
  count: number;
  distribution: ShelfDistribution;
  /** Шаг при MANUAL без явных позиций; 0 — считать равномерно. */
  spacing: Mm;
  /** Отступ первой полки от низа. */
  startOffset: Mm;
  /** Отступ последней полки от верха. */
  endOffset: Mm;
  /** Полки с явно заданным положением. */
  fixedShelves: FixedShelf[];
  /** Насколько полка мельче корпуса по глубине. */
  depthReduction: Mm;
}

export const DEFAULT_SHELVES: ShelfSettings = {
  count: 3,
  distribution: 'AUTO_EQUAL',
  spacing: 0,
  startOffset: 0,
  endOffset: 0,
  fixedShelves: [],
  depthReduction: 20,
};

// ── Перегородки (§27/§28) ────────────────────────────────────────────────────

export type PartitionOrientation = 'VERTICAL' | 'HORIZONTAL';

export interface PartitionSettings {
  count: number;
  /** Явные положения по ширине (мм от левого края); пусто — равномерно. */
  positions: Mm[];
  orientation: PartitionOrientation;
}

export const DEFAULT_PARTITIONS: PartitionSettings = {
  count: 0,
  positions: [],
  orientation: 'VERTICAL',
};

// ── Фасады (§29–§31) ─────────────────────────────────────────────────────────

/** Зазоры фасада по всем сторонам (§30). */
export interface DoorGapSettings {
  topGap: Mm;
  bottomGap: Mm;
  leftGap: Mm;
  rightGap: Mm;
  betweenGap: Mm;
}

export const DEFAULT_DOOR_GAPS: DoorGapSettings = {
  topGap: 2,
  bottomGap: 2,
  leftGap: 2,
  rightGap: 2,
  betweenGap: 3,
};

export type DoorOpening = 'left' | 'right' | 'double';

export interface DoorSettings {
  count: number;
  gaps: DoorGapSettings;
  opening: DoorOpening;
  handleEnabled: boolean;
  material: MaterialId | null;
}

export const DEFAULT_DOORS: DoorSettings = {
  count: 0,
  gaps: { ...DEFAULT_DOOR_GAPS },
  opening: 'double',
  handleEnabled: false,
  material: null,
};

// ── Задняя стенка (§32/§33) ──────────────────────────────────────────────────

export type BackPanelType = 'NONE' | 'INSET' | 'OVERLAY' | 'GROOVE';

export interface BackPanelSettings {
  type: BackPanelType;
  thickness: Mm;
  /** Отступ вкладной стенки от заднего торца. */
  offset: Mm;
  material: MaterialId | null;
}

export const DEFAULT_BACK: BackPanelSettings = {
  type: 'INSET',
  thickness: 3,
  offset: 0,
  material: null,
};

// ── Ножки и цоколь (§34/§35) ─────────────────────────────────────────────────

export interface LegSettings {
  enabled: boolean;
  height: Mm;
  /** Отступ ножки от боковой грани. */
  insetX: Mm;
  /** Отступ ножки от передней/задней грани. */
  insetY: Mm;
  count: number;
}

export const DEFAULT_LEGS: LegSettings = {
  enabled: false,
  height: 100,
  insetX: 50,
  insetY: 50,
  count: 4,
};

export interface PlinthSettings {
  enabled: boolean;
  height: Mm;
  /** Утопление цоколя внутрь корпуса по бокам. */
  inset: Mm;
  /** Отступ передней плоскости цоколя от переднего торца. */
  frontOffset: Mm;
  material: MaterialId | null;
}

export const DEFAULT_PLINTH: PlinthSettings = {
  enabled: false,
  height: 100,
  inset: 0,
  frontOffset: 50,
  material: null,
};

// ── Ящики (заготовка, §3) ────────────────────────────────────────────────────

export interface DrawerSettings {
  count: number;
  /** Высота фронта ящика; 0 — делить проём поровну. */
  frontHeight: Mm;
  gap: Mm;
}

export const DEFAULT_DRAWERS: DrawerSettings = { count: 0, frontHeight: 0, gap: 3 };

// ── Параметрическая модель изделия (§3) ──────────────────────────────────────

/**
 * Тип изделия/модуля (§3). SHELVING сохранён с этапа 18 как синоним
 * стеллажа — проекты прошлых этапов продолжают открываться.
 */
export type FurnitureKind =
  | 'CABINET'
  | 'BASE_CABINET'
  | 'WALL_CABINET'
  | 'TALL_CABINET'
  | 'DRAWER_UNIT'
  | 'SHELF_UNIT'
  | 'OPEN_SHELF'
  | 'CUSTOM'
  | 'SHELVING';

export interface ParametricModel {
  /** Тип изделия (§57). */
  kind: FurnitureKind;
  width: Mm;
  height: Mm;
  depth: Mm;
  thickness: Mm;
  materialId: MaterialId | null;
  construction: CabinetConstructionType;
  backPanel: BackPanelSettings;
  shelves: ShelfSettings;
  partitions: PartitionSettings;
  doors: DoorSettings;
  drawers: DrawerSettings;
  legs: LegSettings;
  plinth: PlinthSettings;
  limits: DimensionLimits;
  /** Пользовательские параметры и выражения (§7/§9). */
  parameters: Parameter[];
  /** Тип корпусного соединения. */
  jointType: 'confirmat' | 'dowel' | 'minifix';
}

export function createParametricModel(patch: Partial<ParametricModel> = {}): ParametricModel {
  return {
    kind: 'CABINET',
    width: 800,
    height: 2000,
    depth: 600,
    thickness: 16,
    materialId: null,
    construction: 'BETWEEN_SIDES',
    backPanel: { ...DEFAULT_BACK },
    shelves: { ...DEFAULT_SHELVES, fixedShelves: [] },
    partitions: { ...DEFAULT_PARTITIONS, positions: [] },
    doors: { ...DEFAULT_DOORS, gaps: { ...DEFAULT_DOOR_GAPS } },
    drawers: { ...DEFAULT_DRAWERS },
    legs: { ...DEFAULT_LEGS },
    plinth: { ...DEFAULT_PLINTH },
    limits: { ...DEFAULT_LIMITS },
    parameters: [],
    jointType: 'confirmat',
    ...patch,
  };
}

// ── Определение детали (§15/§16) ─────────────────────────────────────────────

/**
 * PartDefinition — то, что возвращает параметрическое правило. Это ещё не Part:
 * из определения генератор делает или обновляет деталь ProjectModel, сохраняя
 * её стабильный id.
 */
export interface PartDefinition {
  /** Стабильный ключ детали: CABINET.SIDE.LEFT, CABINET.SHELF.001 (§39). */
  id: string;
  name: string;
  width: Mm;
  height: Mm;
  thickness: Mm;
  position: Vec3;
  rotation: Rotation;
  materialId: MaterialId | null;
  role: ParametricPartRole;
  metadata?: Record<string, unknown>;
}

/** Роли параметрических деталей (§16). */
export type ParametricPartRole =
  | 'SIDE' | 'TOP' | 'BOTTOM' | 'SHELF' | 'PARTITION'
  | 'DOOR' | 'BACK' | 'DRAWER' | 'LEG' | 'PLINTH' | 'OTHER';

/** Соответствие роли параметрической детали роли в ProjectModel. */
export const ROLE_TO_PART_ROLE: Record<ParametricPartRole, PartRole> = {
  SIDE: 'side',
  TOP: 'top',
  BOTTOM: 'bottom',
  SHELF: 'shelf',
  PARTITION: 'divider',
  DOOR: 'facade',
  BACK: 'back',
  DRAWER: 'facade',
  LEG: 'custom',
  PLINTH: 'custom',
  OTHER: 'custom',
};

/** Источник детали (§42): порождена правилом или добавлена вручную. */
export type PartSource = 'PARAMETRIC' | 'MANUAL';

/** Параметрическое правило (§14): модель → определения деталей. */
export interface ParametricRule {
  id: string;
  name: string;
  build(model: ParametricModel): PartDefinition[];
}
