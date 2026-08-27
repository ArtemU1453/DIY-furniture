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
  | 'hdf'
  | 'glass'
  | 'other';

/**
 * Категория материала для библиотеки (§3). Это внешнее, «человеческое» имя
 * того же деления, что и MaterialKind: kind остаётся техническим полем модели
 * (по нему работают раскрой и 3D), category — тем, что видит пользователь.
 * Две шкалы связаны однозначно, дублирующей модели материала не возникает.
 */
export type MaterialCategory =
  | 'LDSP'
  | 'MDF'
  | 'PLYWOOD'
  | 'SOLID_WOOD'
  | 'HDF'
  | 'OTHER';

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
  /** Категория для библиотеки (§2/§3); выводится из kind, если не задана. */
  category?: MaterialCategory;
  /** Совместимые кромки: id EdgeMaterial. Пусто — совместимы любые (§2). */
  edgeCompatibility?: EdgeMaterialId[];
  /** Архивная позиция не предлагается в новых проектах (§28). */
  archived?: boolean;
  /** Версия схемы записи библиотеки (§57). */
  schemaVersion?: number;
  /** Ссылка на запись глобальной библиотеки, из которой скопирован объект (§60). */
  libraryRef?: LibraryRef;
  metadata?: Record<string, unknown>;
}

export interface EdgeMaterial {
  id: EdgeMaterialId;
  name: string;
  thickness: Mm;
  width?: Mm;
  color: string;
  cost?: { perMeter?: number; currency?: string };
  /** Материал кромки: ABS, PVC, меламин и т.п. (§8). */
  material?: string;
  manufacturer?: string;
  /** Артикул/код позиции (§8). Не выдумывается — пусто, если неизвестен. */
  code?: string;
  archived?: boolean;
  schemaVersion?: number;
  libraryRef?: LibraryRef;
  metadata?: Record<string, unknown>;
}

/**
 * Стабильная ссылка на запись глобальной библиотеки (§60).
 *
 * Проект хранит СВОЮ копию материала/кромки/фурнитуры, а ссылка нужна лишь
 * для того, чтобы позже предложить «Обновить из библиотеки» (§62). Изменение
 * глобальной библиотеки само по себе проект не трогает (§61).
 */
export interface LibraryRef {
  /** id записи в глобальной библиотеке. */
  libraryId: string;
  /** Версия библиотечной записи на момент копирования в проект. */
  revision: number;
  /** Когда скопировано (ISO). */
  linkedAt: string;
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
  | 'countersink' // зенковка под потайную головку
  | 'cut' // рез/выборка по контуру
  | 'custom';

/**
 * Внешние (производственные) имена операций (§10). Технический MachiningType
 * остаётся полем модели, а это — то, что видит пользователь и что уходит в
 * CSV и на чертёж. Соответствие однозначно в обе стороны.
 */
export type OperationKind =
  | 'DRILL' | 'BORE' | 'COUNTERSINK' | 'POCKET' | 'CUT' | 'CUSTOM';

/** Грань детали, с которой заходит инструмент. */
export type PartFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

/**
 * Технологическая база для простановки размеров на чертеже (§52).
 * A — левый/нижний край детали, B — противоположный, C — вспомогательная.
 */
export type DatumReference = 'A' | 'B' | 'C';

/**
 * Признак сквозного отверстия. Глубина сквозного НЕ задаётся числом-заглушкой:
 * используется through: true, а фактическая глубина равна толщине детали.
 */
export const THROUGH = 'THROUGH' as const;

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
  /** Фурнитура, к которой относится отверстие (§31/§60). */
  hardwareId?: HardwareId;
  /** База для простановки размеров на чертеже (§52). */
  datum?: DatumReference;
  /** true — параметры изменены вручную поверх правила (§41/§42). */
  override?: boolean;
  parameters?: Record<string, number | string | boolean>;
  metadata?: Record<string, unknown>;
}

/** Ручная правка параметров автоматически созданной операции (§42). */
export type MachiningOverride = Partial<
  Pick<MachiningOperation, 'diameter' | 'depth' | 'x' | 'y' | 'face' | 'through' | 'type'>
>;

/**
 * Производственный профиль (§54) — технологические умолчания цеха.
 * Расширяется дополнительными профилями без переписывания системы.
 */
export interface ManufacturingProfile {
  id: string;
  name: string;
  /** Ширина пропила пилы. */
  sawKerf: Mm;
  /** Обрезка кромки листа перед раскроем (§17). */
  trimAllowance?: Mm;
  /** Минимальный размер делового остатка (§17). */
  minimumRemnant?: Mm;
  minHoleEdgeDistance: Mm;
  defaultDrillDepth: Mm;
  defaultJointType: ConnectionType;
  archived?: boolean;
  schemaVersion?: number;
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
  /**
   * Ручные правки автоматических операций по id операции (§42). Переживают
   * пересчёт; «Сбросить правило» удаляет запись.
   */
  overrides?: Record<string, MachiningOverride>;
  /** Производственный профиль цеха (§54). */
  profile?: ManufacturingProfile;
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
  /** Параметры крепежа: diameter, length, headDiameter и т.п. (§13). */
  parameters?: Record<string, number | string | boolean>;
  cost?: { perUnit?: number; currency?: string };
  /**
   * Правила присадки этой позиции (§10/§14). Если не заданы, применяется
   * правило по категории из реестра machining — то есть каталог продолжает
   * работать без изменений.
   */
  machiningRules?: HardwareRule[];
  archived?: boolean;
  schemaVersion?: number;
  libraryRef?: LibraryRef;
  metadata?: Record<string, unknown>;
}

/**
 * HardwareRule (§14) — декларативное описание ОДНОЙ операции присадки,
 * которую порождает крепёж. Данные, а не код: пользователь может задать
 * правило для своей фурнитуры прямо в редакторе, не трогая исходники.
 *
 * Правило превращается в MachiningOperation через RuleEngine (§15).
 */
export interface HardwareRule {
  id: string;
  /** Что делаем: сверление, присадка под чашку, паз и т.п. */
  operation: MachiningType;
  /** На какую деталь стыка ложится операция. */
  target: 'through' | 'receiving' | 'both';
  diameter: Mm;
  /** Глубина глухого отверстия; для сквозного не используется. */
  depth?: Mm;
  through?: boolean;
  /** Сколько операций на один стык (например, 2 конфирмата). */
  count?: number;
  /** Отступ от края стыка до крайней операции. */
  edgeOffset?: Mm;
  /** Ограничения применимости (§45). */
  constraints?: HardwareRuleConstraints;
  metadata?: Record<string, unknown>;
}

/** Ограничения правила: когда крепёж физически применим (§45). */
export interface HardwareRuleConstraints {
  minThickness?: Mm;
  maxThickness?: Mm;
  /** Разрешённые категории материала; пусто — любые. */
  materialCategories?: MaterialCategory[];
  /** Минимальная длина стыка, при которой крепёж имеет смысл. */
  minJointLength?: Mm;
}

/**
 * Тип соединения (способ крепления). Отделён от категории фурнитуры:
 * категория описывает ЧЕМ крепим, ConnectionType — КАК. Расширяется значениями.
 */
export type ConnectionType =
  | 'CONFIRMAT'
  | 'DOWEL'
  | 'MINIFIX'
  | 'SCREW'
  | 'CAM_LOCK'
  | 'CUSTOM'
  | 'OTHER';

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
  /** Способ соединения (CONFIRMAT/DOWEL/…). Выводится из категории крепежа. */
  connectionType?: ConnectionType;
  jointType?: JointType;
  quantity?: number; // число крепежа в узле (переопределяет parameters.count)
  /**
   * Стабильный ключ соединения (§5): CABINET.SIDE.LEFT↔CABINET.TOP.
   * По нему соединение узнаётся при пересчёте и сохраняет свой id.
   */
  stableId?: string;
  /** Порождено правилом или создано пользователем (§4). */
  source?: ConnectionSource;
  /** Результат последней проверки (§45). */
  status?: ConnectionStatus;
  /**
   * Различает несколько одинаковых соединений между одной парой деталей (§44):
   * например верхний и нижний узел боковины с перегородкой.
   */
  position?: string;
  parameters?: Record<string, number | string | boolean>;
  metadata?: Record<string, unknown>;
}

/** Источник соединения (§4). */
export type ConnectionSource = 'PARAMETRIC' | 'MANUAL';

/** Состояние соединения после проверки (§45). */
export type ConnectionStatus = 'VALID' | 'WARNING' | 'ERROR' | 'OUTDATED';

/** Состояние присадки относительно модели (§46). */
export type MachiningStatus = 'CURRENT' | 'DIRTY' | 'ERROR';

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
  /** Порядок реза на листе (1..N). Задел под будущий оптимизатор реза/CNC. */
  cutOrder?: number;
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
  /** Площадь ПОЛЕЗНЫХ остатков (REMNANT) — пригодны к повторному использованию. */
  remnantAreaMm2: number;
  /** Площадь безвозвратного отхода (WASTE) = usable − used − remnant. */
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
  /** Полезные остатки (REMNANT), мм². */
  remnantAreaMm2: number;
  /** Безвозвратный отход (WASTE), мм². */
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
  /**
   * Приоритет форматов листа на материал: список SheetMaterial.id по убыванию
   * предпочтения. Пустой список — использовать sheetSelection/все доступные.
   */
  sheetPriority: Record<string, string[]>;
  /** Стратегия: меньше листов (по умолчанию) или выше использование материала. */
  preferFewerSheets: boolean;
}

/**
 * Траектория реза — АДАПТЕР под будущий оптимизатор/CNC. Сейчас не
 * рассчитывается: сохраняется только порядок реза (Placement.cutOrder).
 * CNC/G-code в этом этапе НЕ реализуется.
 */
export interface CuttingPath {
  sheetId: string;
  segments: Array<{ x1: Mm; y1: Mm; x2: Mm; y2: Mm; order: number }>;
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

/** Запись истории генерации документов (локальная, без облака). */
export interface DocumentGenerationRecord {
  generatedAt: string; // ISO
  modelVersion: string; // сигнатура модели
  docVersion: string; // версия комплекта документов (1.0, 1.1, …)
  documents: string[]; // ключи сгенерированных документов
  status: 'CURRENT' | 'ERROR';
}

/**
 * Ручные настройки чертежа — ОТДЕЛЬНЫ от производственной модели (не влияют на
 * геометрию деталей). Масштаб по документу и видимость необязательных слоёв.
 */
export interface DrawingSettings {
  scaleOverrides: Record<string, number | 'AUTO'>; // ключ документа → масштаб
  hidden: Record<string, boolean>; // ключ слоя → скрыт ли (напр. 'grain', 'edges')
  /** Формат листа по документу (A4/A3/A2), §8. */
  formatOverrides?: Record<string, 'A4' | 'A3' | 'A2'>;
  /** Выбранные виды изделия для общего вида (§9). */
  views?: string[];
  /** Ручное оформление: смещения элементов, скрытые виды, примечания (§37). */
  layout?: DocumentLayoutOverrides;
  /** Версия оформления — входит в ключ кэша документов (§55). */
  layoutVersion?: number;
  /** Фильтр деталей для деталировки (§65). */
  partFilter?: string;
}

/**
 * Ручное оформление документа. Хранится ОТДЕЛЬНО от производственной модели:
 * перемещение размера или добавление примечания не меняет ни одну деталь и не
 * делает документацию OUTDATED (§37).
 */
export interface DocumentLayoutOverrides {
  /** id элемента → смещение в мм относительно авторасчёта. */
  moved: Record<string, { dx: number; dy: number }>;
  /** id элемента → зафиксирован пользователем (§38). */
  locked: Record<string, boolean>;
  /** Скрытые виды: id вида → скрыт. */
  hiddenViews: Record<string, boolean>;
  /** Пользовательские примечания по документу. */
  notes: Record<string, DocumentNote[]>;
}

/** Пользовательское примечание на чертеже (§36). */
export interface DocumentNote {
  id: string;
  x: number;
  y: number;
  text: string;
}

/** Состояние документации. version — сигнатура модели на момент генерации
 *  (для статуса OUTDATED). Сами документы — производные, не хранятся.
 *  docVersion — независимая версия комплекта документов (1.0 → 1.1). */
export interface DocumentsState {
  version?: string;
  docVersion?: string;
  history?: DocumentGenerationRecord[];
  settings?: DrawingSettings;
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
