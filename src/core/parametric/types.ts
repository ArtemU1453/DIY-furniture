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
import type { MachiningOperation, Mm, Vec3, Rotation, PartRole } from '@/core/model/types';

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
 * Схема установки верха и низа относительно боковин.
 *
 * BETWEEN_SIDES — верх и низ входят МЕЖДУ боковинами (боковины во всю высоту).
 * ON_SIDES      — верх и низ накрывают боковины сверху и снизу.
 * TOP_ON_SIDES  — накрывает только верх, низ входит между боковинами.
 * BOTTOM_UNDER  — только низ подложен под боковины, верх входит между ними.
 *
 * Смешанные схемы существуют в реальной мебели и были в проектах прошлых
 * этапов, где верх и низ настраивались независимо (этап 37). Хранится ОДНО
 * поле: две независимые величины выводятся из него, а не дублируют его.
 */
export type CabinetConstructionType =
  | 'BETWEEN_SIDES'
  | 'ON_SIDES'
  | 'TOP_ON_SIDES'
  | 'BOTTOM_UNDER';

/** Подписи схем корпуса: один список на все панели (этап 37). */
export const CONSTRUCTION_LABELS: Record<CabinetConstructionType, string> = {
  BETWEEN_SIDES: 'Верх и низ между боковинами',
  ON_SIDES: 'Верх и низ на боковинах',
  TOP_ON_SIDES: 'Только верх на боковинах',
  BOTTOM_UNDER: 'Только низ под боковинами',
};

/** Порядок показа схем в списках. */
export const CONSTRUCTION_ORDER: CabinetConstructionType[] = [
  'BETWEEN_SIDES', 'ON_SIDES', 'TOP_ON_SIDES', 'BOTTOM_UNDER',
];

/** Что схема означает для геометрии: накрывает ли верх боковины, подложен ли низ. */
export interface ConstructionMounts {
  /** Верх лежит НА боковинах (иначе — между ними). */
  topOnSides: boolean;
  /** Низ подложен ПОД боковины (иначе — между ними). */
  bottomUnder: boolean;
}

export function constructionMounts(construction: CabinetConstructionType): ConstructionMounts {
  return {
    topOnSides: construction === 'ON_SIDES' || construction === 'TOP_ON_SIDES',
    bottomUnder: construction === 'ON_SIDES' || construction === 'BOTTOM_UNDER',
  };
}

/** Обратное преобразование: пара признаков → схема корпуса. */
export function constructionOf(mounts: ConstructionMounts): CabinetConstructionType {
  if (mounts.topOnSides && mounts.bottomUnder) return 'ON_SIDES';
  if (mounts.topOnSides) return 'TOP_ON_SIDES';
  if (mounts.bottomUnder) return 'BOTTOM_UNDER';
  return 'BETWEEN_SIDES';
}

// ── Полки (§22–§26) ──────────────────────────────────────────────────────────

/** AUTO_EQUAL — равномерно между верхом и низом; MANUAL — по заданным высотам. */
export type ShelfDistribution = 'AUTO_EQUAL' | 'MANUAL';

/** Фиксированная или регулируемая полка (§14 этапа 28). */
export type ShelfMode = 'FIXED' | 'ADJUSTABLE';

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
  /**
   * Полка вклеена/закреплена в корпус (FIXED) или лежит на полкодержателях
   * (ADJUSTABLE, §14 этапа 28). Не задано — регулируемая.
   */
  mode?: ShelfMode;
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

/**
 * Как фасад стоит относительно корпуса (§35 этапа 28).
 *
 * FULL — полное наложение: фасад закрывает торцы боковин целиком;
 * HALF — половинное: фасад закрывает половину торца (два фасада делят боковину);
 * INSET — вкладной: фасад утоплен В проём между боковинами.
 */
export type DoorOverlay = 'FULL' | 'HALF' | 'INSET';

/** Тип фасада (§33 этапа 28). */
export type DoorKind = 'single' | 'double';

/** Ручка фасада (§39/§40 этапа 28). */
export interface HandleSettings {
  /** Отступ ручки от кромки фасада, мм. */
  edgeOffset: Mm;
  /** Положение ручки по высоте фасада. */
  position: 'TOP' | 'CENTER' | 'BOTTOM';
}

export const DEFAULT_HANDLE: HandleSettings = { edgeOffset: 50, position: 'TOP' };

export interface DoorSettings {
  count: number;
  gaps: DoorGapSettings;
  opening: DoorOpening;
  handleEnabled: boolean;
  material: MaterialId | null;
  /** Наложение фасада; не задано — полное. */
  overlay?: DoorOverlay;
  /** Одностворчатый или двустворчатый фасад. */
  kind?: DoorKind;
  /** Параметры ручки. */
  handle?: HandleSettings;
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
  /**
   * Глубина паза под стенку (§23 этапа 28). Поле необязательное: проекты
   * прошлых этапов его не знают, и тогда работает DEFAULT_GROOVE_DEPTH.
   */
  grooveDepth?: Mm;
  /** Отступ паза от заднего торца детали. */
  grooveOffset?: Mm;
}

export const DEFAULT_BACK: BackPanelSettings = {
  type: 'INSET',
  thickness: 3,
  offset: 0,
  material: null,
};

// ── Ножки и цоколь (§34/§35) ─────────────────────────────────────────────────

/** Схема расстановки опор (§30 этапа 28). */
export type LegPlacement = 'CORNERS' | 'INSET' | 'SYMMETRIC';

export interface LegSettings {
  enabled: boolean;
  height: Mm;
  /** Отступ ножки от боковой грани. */
  insetX: Mm;
  /** Отступ ножки от передней/задней грани. */
  insetY: Mm;
  count: number;
  /** Схема расстановки; не задана — по углам. */
  placement?: LegPlacement;
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
  /** Утопление цоколя внутрь корпуса по бокам (recess, §27 этапа 28). */
  inset: Mm;
  /** Отступ передней плоскости цоколя от переднего торца. */
  frontOffset: Mm;
  material: MaterialId | null;
  /** Толщина планки цоколя; не задана — берётся толщина корпуса. */
  thickness?: Mm;
}

export const DEFAULT_PLINTH: PlinthSettings = {
  enabled: false,
  height: 100,
  inset: 0,
  frontOffset: 50,
  material: null,
};

// ── Ящики (заготовка, §3) ────────────────────────────────────────────────────

/** Как распределяются ящики по проёму (§43 этапа 28). */
export type DrawerDistribution = 'AUTO_EQUAL' | 'MANUAL' | 'PARAMETRIC';

export interface DrawerSettings {
  count: number;
  /** Высота фронта ящика; 0 — делить проём поровну. */
  frontHeight: Mm;
  gap: Mm;
  /** Способ расстановки; не задан — равномерно. */
  distribution?: DrawerDistribution;
  /** Явные высоты фронтов от низа проёма (для MANUAL). */
  positions?: Mm[];
  /** Толщина боковин и задней стенки короба ящика. */
  sideThickness?: Mm;
  /** Толщина дна ящика. */
  bottomThickness?: Mm;
  /** Длина направляющей, мм. 0 — подобрать по глубине корпуса. */
  slideLength?: Mm;
  /** Боковой зазор между коробом и стенкой секции (на направляющую). */
  sideClearance?: Mm;
  /** Материал фронтов; не задан — материал фасадов или корпуса. */
  material?: MaterialId | null;
}

export const DEFAULT_DRAWERS: DrawerSettings = { count: 0, frontHeight: 0, gap: 3 };

// ── Параметрическая модель изделия (§3) ──────────────────────────────────────

// ── Кромка (§4 этапа 28) ─────────────────────────────────────────────────────

/**
 * Параметры кромки корпуса. Сама кромка деталей остаётся в Part.edges и
 * считается движком edges этапа 21 — здесь только значения по умолчанию,
 * которыми параметрический корпус их заполняет.
 */
export interface EdgeSettings {
  thickness: Mm;
  materialId: string | null;
}

export const DEFAULT_EDGE: EdgeSettings = { thickness: 0.4, materialId: null };

// ── Тип шкафа (§5 этапа 28) ──────────────────────────────────────────────────

/**
 * Тип корпусного изделия. Это НЕ второй перечень видов мебели: каждый тип
 * отображается на существующий FurnitureKind (KIND_OF_CABINET_TYPE в
 * engines/cabinet/model.ts), а правила остаются одни и те же.
 */
export type CabinetType =
  | 'CABINET'
  | 'WARDROBE'
  | 'BASE_UNIT'
  | 'WALL_UNIT'
  | 'TALL_UNIT'
  | 'SHELF_UNIT';

/**
 * Тип изделия/модуля (§3). SHELVING сохранён с этапа 18 как синоним
 * стеллажа — проекты прошлых этапов продолжают открываться.
 */
/** Ключ, под которым параметрическая модель живёт в params изделия (§90). */
export const PARAMETRIC_KEY = 'parametric';

export type FurnitureKind =
  | 'CABINET'
  | 'BASE_CABINET'
  | 'WALL_CABINET'
  | 'TALL_CABINET'
  | 'DRAWER_UNIT'
  | 'SHELF_UNIT'
  | 'OPEN_SHELF'
  | 'CUSTOM'
  | 'SHELVING'
  /** Полка-щит: изделие из одной детали (шаблон «Полка», этап 35). */
  | 'BOARD';

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
  /**
   * Тип корпуса (§5 этапа 28). Не задан — выводится из kind, поэтому проекты
   * прошлых этапов открываются без миграции.
   */
  cabinetType?: CabinetType;
  /** Материал и толщина кромки по умолчанию (§4 этапа 28). */
  edge?: EdgeSettings;
  /** Толщина корпусного материала для задней стенки задаётся в backPanel. */
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
  /**
   * Конструктивная присадка детали (§25/§48 этапа 28): паз под заднюю стенку,
   * паз под дно ящика. Это не второй список операций — генератор кладёт их в
   * Part.machining рядом с ручными, помечая source: PARAMETRIC_RULE.
   */
  machining?: MachiningOperation[];
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
