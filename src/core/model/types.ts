/**
 * Типизированная модель проекта — единственный источник истины.
 *
 * Модель полностью сериализуема в JSON (никаких классов, функций, ссылок на
 * three/React). Все линейные размеры — в миллиметрах (см. core/units).
 *
 * Иерархия: Project → Furniture → Assembly → Part.
 * Производные представления (3D, спецификация, раскрой, чертежи) НЕ хранятся в
 * модели, а вычисляются из неё движками (engines/*).
 */
import type {
  ProjectId,
  FurnitureId,
  AssemblyId,
  PartId,
  MaterialId,
  EdgeMaterialId,
  HardwareId,
  HardwareConnectionId,
  MachiningId,
  DrawingId,
} from './ids';

/** Все размеры — миллиметры. */
export type Mm = number;

export interface Vec3 {
  x: Mm;
  y: Mm;
  z: Mm;
}

/** Поворот в градусах (в производственной модели — ортогональный). */
export interface Rotation {
  x: number;
  y: number;
  z: number;
}

export type GrainDirection = 'length' | 'width' | 'none';
export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';

export type MaterialKind =
  | 'ldsp'
  | 'mdf'
  | 'plywood'
  | 'edge-glued'
  | 'solid'
  | 'glass'
  | 'other';

// ─────────────────────────────────────────────────────────────────────────────
// Материалы и кромка
// ─────────────────────────────────────────────────────────────────────────────

export interface Material {
  id: MaterialId;
  name: string;
  kind: MaterialKind;
  thickness: Mm;
  sheet: { length: Mm; width: Mm };
  density?: number; // кг/м³
  grain: GrainDirection;
  allowRotate: boolean; // можно ли поворачивать деталь при раскрое
  kerf?: Mm; // ширина пропила (иначе из настроек)
  color: string; // hex для 3D/чертежей
  textureId?: string;
  /** Стоимость — опциональна, не обязательна для работы программы. */
  cost?: { perSheet?: number; perSquareMeter?: number; currency?: string };
  metadata?: Record<string, unknown>;
}

export interface EdgeMaterial {
  id: EdgeMaterialId;
  name: string;
  thickness: Mm;
  width?: Mm;
  color: string;
  cost?: { perMeter?: number; currency?: string };
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Присадка
// ─────────────────────────────────────────────────────────────────────────────

/** Тип технологической операции. Расширяется без переписывания системы. */
export type MachiningType =
  | 'drilling' // сверление (сквозное/глухое отверстие)
  | 'boring' // присадка под чашку (напр. петля)
  | 'pocket' // выборка/карман
  | 'slot' // паз
  | 'dowel' // отверстие под шкант
  | 'confirmat' // отверстие под конфирмат
  | 'hinge' // присадка под петлю
  | 'custom';

/** Грань детали, с которой заходит инструмент. */
export type PartFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

/** Происхождение операции: авто из конструкции или ручная. */
export type MachiningOrigin = 'generated' | 'manual';

/**
 * Технологическая операция присадки. Координаты x/y заданы в ЛОКАЛЬНОЙ системе
 * координат грани детали (мм), z/depth — вдоль оси сверления. Перевод в мировые
 * координаты выполняется на границе 3D (см. core/geometry/coordinate-system).
 */
export interface MachiningOperation {
  id: MachiningId;
  type: MachiningType;
  partId: PartId;
  face: PartFace;
  x: Mm;
  y: Mm;
  z: Mm;
  diameter?: Mm;
  depth?: Mm;
  length?: Mm; // для пазов/карманов
  width?: Mm; // для пазов/карманов
  angle?: number;
  through?: boolean;
  direction?: Vec3; // направление сверления (единичный вектор в лок. координатах)
  origin: MachiningOrigin;
  sequence?: number;
  sourceHardwareConnectionId?: HardwareConnectionId;
  parameters?: Record<string, number | string | boolean>;
  metadata?: Record<string, unknown>;
}

/** Технологические ограничения присадки (не зашиваются в UI). */
export interface MachiningConstraints {
  minDiameter: Mm;
  maxDepthRatio: number; // максимум depth / thickness для глухого отверстия (0..1]
  minEdgeOffset: Mm;
  minHoleSpacing: Mm; // мин. расстояние между центрами отверстий
  allowedFaces: PartFace[];
}

/** Состояние присадки на уровне проекта. Ручные операции хранятся в деталях. */
export interface MachiningState {
  constraints: MachiningConstraints;
}

// ─────────────────────────────────────────────────────────────────────────────
// Фурнитура
// ─────────────────────────────────────────────────────────────────────────────

export type HardwareCategory =
  | 'confirmat' // конфирмат
  | 'minifix' // эксцентрик / минификс
  | 'dowel' // шкант
  | 'shelf-support' // полкодержатель
  | 'hinge' // петля
  | 'slide' // направляющая
  | 'connector' // стяжка
  | 'corner' // уголок / bracket
  | 'screw' // саморез
  | 'leg' // опора
  | 'handle' // ручка
  | 'other';

/** Единица фурнитуры (крепёж/навес). Количество НЕ хранится — оно
 *  вычисляется из связей (HardwareConnection). */
export interface Hardware {
  id: HardwareId;
  name: string;
  category: HardwareCategory;
  manufacturer?: string;
  article?: string;
  model?: string;
  /** Параметры крепежа: diameter, length, headDiameter и т.п. */
  parameters?: Record<string, number | string | boolean>;
  cost?: { perUnit?: number; currency?: string };
  metadata?: Record<string, unknown>;
}

/** Тип конструктивного узла (Joint). */
export type JointType =
  | 'BUTT'
  | 'EDGE_TO_FACE'
  | 'FACE_TO_FACE'
  | 'CORNER'
  | 'PANEL_TO_PANEL'
  | 'PANEL_TO_FRAME';

/**
 * Семантическая связь (конструктивный узел): крепёж соединяет детали. НЕ
 * содержит отверстий/координат — реальные технологические операции строит
 * MachiningEngine (производные, привязаны к связи через sourceHardwareConnectionId).
 */
export interface HardwareConnection {
  id: HardwareConnectionId;
  hardwareId: HardwareId;
  partAId: PartId;
  partBId: PartId;
  jointType?: JointType;
  quantity?: number; // число крепежа в узле (переопределяет parameters.count)
  parameters?: Record<string, number | string | boolean>;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Деталь — центральная производственная сущность
// ─────────────────────────────────────────────────────────────────────────────

export type PartRole =
  | 'side'
  | 'top'
  | 'bottom'
  | 'shelf'
  | 'back'
  | 'divider'
  | 'facade'
  | 'custom';

export interface Part {
  id: PartId;
  name: string;
  role: PartRole;

  /** Габариты заготовки (плоскость раскроя). */
  width: Mm;
  height: Mm;
  thickness: Mm;

  material: MaterialId | null;
  grain: GrainDirection;
  quantity: number;

  /** Кромка по 4 сторонам (ссылка на EdgeMaterial или null). */
  edges: {
    left: EdgeMaterialId | null;
    right: EdgeMaterialId | null;
    top: EdgeMaterialId | null;
    bottom: EdgeMaterialId | null;
  };

  position: Vec3;
  rotation: Rotation;

  machining: MachiningOperation[];
  parentId?: PartId;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Сборка и изделие
// ─────────────────────────────────────────────────────────────────────────────

/** Сборочная единица (корпус) внутри изделия. */
export interface Assembly {
  id: AssemblyId;
  name: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
}

/**
 * Секция — внутреннее вертикальное отделение корпуса (между боковинами и
 * перегородками). В секции размещаются полки/двери/ящики (на будущих этапах).
 * Координаты — в системе корпуса (мм).
 */
export interface Section {
  id: string;
  index: number;
  x: Mm; // левая граница секции (внутр. координата)
  width: Mm;
  y: Mm; // нижняя граница внутреннего пространства
  height: Mm;
  z: Mm; // передняя граница
  depth: Mm;
}

/** Изделие (шкаф, тумба, стол, произвольное). */
export interface Furniture {
  id: FurnitureId;
  name: string;
  type: string; // ключ типа изделия: 'custom' | 'cabinet' | ...
  position: Vec3;
  rotation: Rotation;
  assemblies: Assembly[];
  /** Параметры типа изделия (для параметрического движка). Формат — по типу. */
  params?: Record<string, unknown>;
  /** Секции, вычисленные генератором (для будущего наполнения). */
  sections?: Section[];
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Раскрой (типы данных; алгоритм — в engines/cutting)
// ─────────────────────────────────────────────────────────────────────────────

/** Ориентация детали на листе (архитектура допускает 180/270 в будущем). */
export type PieceRotation = 0 | 90;
export type PlacementOrigin = 'automatic' | 'manual';

/** Технологическая обрезка листа по краям. */
export interface TrimSettings {
  left: Mm;
  right: Mm;
  top: Mm;
  bottom: Mm;
}

/** Зафиксированное вручную размещение (не двигается автоалгоритмом). */
export interface LockedPlacement {
  pieceId: string;
  sheetIndex: number;
  x: Mm;
  y: Mm;
  rotation: PieceRotation;
}

/** Размещение детали на листе (реальные координаты результата раскроя). */
export interface Placement {
  pieceId: string;
  partId: PartId;
  name: string;
  number: string;
  x: Mm;
  y: Mm;
  length: Mm;
  width: Mm;
  rotation: PieceRotation;
  origin: PlacementOrigin;
  locked: boolean;
}

/** Прямоугольный остаток листа. `usable` — годен по критериям полезного остатка. */
export interface CuttingRemnant {
  id: string;
  sheetId: string;
  materialId: MaterialId;
  x: Mm;
  y: Mm;
  width: Mm;
  height: Mm;
  area: number; // мм²
  usable: boolean;
}

/** Линия реза (гильотинная), вычисленная из расположения деталей и пропила. */
export interface CutLine {
  id: string;
  orientation: 'horizontal' | 'vertical';
  x1: Mm;
  y1: Mm;
  x2: Mm;
  y2: Mm;
}

export interface CuttingSheetResult {
  id: string;
  materialId: MaterialId;
  index: number;
  length: Mm;
  width: Mm;
  trim: TrimSettings;
  placements: Placement[];
  remnants: CuttingRemnant[];
  cuts: CutLine[];
  usableAreaMm2: number;
  usedAreaMm2: number;
  wasteAreaMm2: number;
  utilization: number;
  /** Источник листа: формат из библиотеки или переиспользованный остаток. */
  sheetMaterialId?: string;
  fromRemnant?: boolean;
}

export interface CuttingStatistics {
  materialId: MaterialId;
  materialName: string;
  pieceCount: number;
  sheetCount: number;
  piecesAreaMm2: number;
  sheetsUsableAreaMm2: number;
  wasteAreaMm2: number;
  utilization: number;
}

/** Причина, по которой деталь не размещена. */
export interface UnplacedPiece {
  pieceId: string;
  partId: PartId;
  name: string;
  number: string;
  length: Mm;
  width: Mm;
  reason: string;
}

/** Результат раскроя одного материала («оптимизированный вариант»). */
export interface CuttingResult {
  materialId: MaterialId;
  sheets: CuttingSheetResult[];
  unplaced: UnplacedPiece[];
  statistics: CuttingStatistics;
  attemptsRun: number;
  /** Предупреждения (нехватка материала, ограничения и т.п.). */
  warnings: string[];
}

/** Режим оптимизации раскроя. */
export type OptimizationMode = 'FAST' | 'BALANCED' | 'MAX_UTILIZATION';

/** Критерии «полезного» остатка (не зашиты в код — настройки пользователя). */
export interface UsableRemnantCriteria {
  minWidth: Mm;
  minLength: Mm;
  minArea: number; // мм²
}

/** Настройки раскроя (сохраняются в проекте). */
export interface CuttingSettings {
  respectGrain: boolean;
  attempts: number;
  sortStrategy: string;
  minRemnant: Mm; // порог извлечения остатка (мин. сторона)
  trim: TrimSettings;
  kerfOverride?: Mm;
  sheetOverrides: Record<string, { length: Mm; width: Mm }>;
  locked: LockedPlacement[];
  optimizationMode: OptimizationMode;
  algorithm: string;
  usableRemnant: UsableRemnantCriteria;
  useRemnants: boolean;
  /** Выбранный формат листа из библиотеки на материал (SheetMaterial.id). */
  sheetSelection: Record<string, string>;
}

/** Формат листа в библиотеке (SheetLibrary). Ссылается на материал. */
export interface SheetMaterial {
  id: string;
  materialId: MaterialId;
  name: string;
  width: Mm; // ширина листа (короткая сторона по умолчанию)
  height: Mm; // длина листа
  thickness: Mm;
  grainDirection: GrainDirection;
  availableQuantity: number; // ограниченный запас (0 = без ограничения)
  source: 'library' | 'custom';
  parameters?: Record<string, unknown>;
}

/** Сохранённый остаток (RemnantLibrary) — переиспользуемый в будущем раскрое. */
export interface StoredRemnant {
  id: string;
  materialId: MaterialId;
  thickness: Mm;
  width: Mm;
  height: Mm;
  grainDirection: GrainDirection;
  sourceSheetId: string;
  createdAt: string; // ISO
  note?: string;
}

/** Сохранённый результат раскроя + версия исходной модели (для инвалидации). */
export interface CuttingReport {
  jobs: CuttingResult[];
  generatedAt: string;
  sourceVersion: string;
}

/** Состояние раскроя на уровне проекта. */
export interface CuttingState {
  settings: CuttingSettings;
  report?: CuttingReport;
}

/** Состояние документации. version — сигнатура модели на момент генерации
 *  (для статуса OUTDATED). Сами документы — производные, не хранятся. */
export interface DocumentsState {
  version?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Чертёж (тип данных; построение — в engines/drawings)
// ─────────────────────────────────────────────────────────────────────────────

export interface Drawing {
  id: DrawingId;
  title: string;
  kind: 'front' | 'side' | 'top' | 'part';
  bounds: { width: Mm; height: Mm };
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Настройки и проект
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectSettings {
  units: 'mm'; // база хранения всегда мм
  displayUnits: 'mm' | 'cm' | 'm' | 'in';
  kerf: Mm;
  sheetTrim: Mm;
  costEnabled: boolean;
  locale: string;
}

/** Версия формата проекта. */
export const PROJECT_FORMAT_VERSION = '1.0';

export interface Project {
  version: string;
  id: ProjectId;
  name: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  settings: ProjectSettings;
  materials: Material[];
  edges: EdgeMaterial[];
  hardware: Hardware[];
  hardwareConnections: HardwareConnection[];
  machining: MachiningState;
  cutting: CuttingState;
  /** Библиотека форматов листов (SheetLibrary). */
  sheets: SheetMaterial[];
  /** Библиотека сохранённых остатков (RemnantLibrary). */
  remnants: StoredRemnant[];
  documents: DocumentsState;
  furnitures: Furniture[];
  metadata?: Record<string, unknown>;
}
