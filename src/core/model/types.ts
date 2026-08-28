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
  /**
   * Кромка по умолчанию для этой плиты (§48/§49): ЛДСП 16 → ABS 0.4 белый.
   * Правило кромки берёт её, когда сторона облицована, но материал не задан.
   */
  defaultEdgeMaterial?: EdgeMaterialId | null;
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

/* EdgeSide объявлен выше (физическая сторона детали, а не сторона экрана, §3). */
export const EDGE_SIDES: readonly EdgeSide[] = ['top', 'bottom', 'left', 'right'];

/** Откуда взялась кромка (§4). Ручная переживает пересчёт правил. */
export type EdgeSource = 'PARAMETRIC' | 'MANUAL';

/** Состояние кромки (§5). */
export type EdgeStatus = 'VALID' | 'WARNING' | 'ERROR' | 'OUTDATED';

/**
 * Направление кромки относительно детали (§20). Считается от геометрии, а не
 * от названия стороны: у детали 300×800 «верх» идёт по короткой стороне.
 */
export type EdgeDirection = 'ALONG_LENGTH' | 'ALONG_WIDTH';

/** Ручная правка параметров одной кромки (§45). */
export interface EdgeOverride {
  materialId?: EdgeMaterialId | null;
  width?: Mm;
  thickness?: Mm;
}

/**
 * Кромка одной стороны детали (§2). ПРОИЗВОДНАЯ величина: вычисляется из
 * Part.edges и библиотеки кромки при каждом обращении, поэтому при изменении
 * размеров детали длина пересчитывается сама (§18) и второй системы деталей
 * не появляется (§6).
 */
export interface EdgeBanding {
  /** Стабильный id: `<partId>:<side>`. */
  id: string;
  partId: PartId;
  side: EdgeSide;
  materialId: EdgeMaterialId;
  /** Толщина ленты (§7), мм. */
  thickness: Mm;
  /** Ширина ленты (§8), мм — не путать с толщиной. */
  width: Mm;
  /** Длина стороны детали (§9), мм. Без умножения на количество. */
  length: Mm;
  /** Количество деталей — множитель потребности (§42). */
  quantity: number;
  direction: EdgeDirection;
  status: EdgeStatus;
  source: EdgeSource;
  /** Параметры правки пользователем (§45). */
  override?: boolean;
  /** Пояснение к статусу WARNING/ERROR. */
  issue?: string;
}

/**
 * Технологический профиль кромки (§50) — как данный материал кромки ведёт
 * себя в производстве. Хранится в проекте рядом с самим материалом.
 */
export interface EdgeProfile {
  materialId: EdgeMaterialId;
  thickness: Mm;
  width: Mm;
  /** Цвет для карты раскроя и чертежа. */
  display?: string;
  /** Припуск на кромкование по умолчанию, мм. */
  defaultAllowance?: Mm;
}

/** Готовый набор кромки по сторонам (§51). */
export interface EdgePreset {
  id: string;
  name: string;
  /** Материал на сторону; null — сторона без кромки. */
  sides: Partial<Record<EdgeSide, EdgeMaterialId | null>>;
  /** Категория деталей, для которой пресет предназначен (§54). */
  role?: PartRole;
  builtin?: boolean;
}

/** Состояние производной операции кромкования (§68). */
export type EdgeOperationStatus = 'CURRENT' | 'DIRTY' | 'ERROR';

/**
 * Операция кромкования (§66/§67). Отдельная технологическая операция: с
 * фурнитурой не связана (§65), с присадкой не смешивается.
 */
export interface EdgeOperation {
  id: string;
  partId: PartId;
  side: EdgeSide;
  materialId: EdgeMaterialId;
  thickness: Mm;
  width: Mm;
  /** Длина с учётом количества деталей и припуска, мм. */
  length: Mm;
  operationType: 'EDGE_BANDING';
  status: EdgeOperationStatus;
}

/** Рулон кромки (§35) — единица закупки и учёта остатков. */
export interface EdgeRoll {
  id: string;
  materialId: EdgeMaterialId;
  width: Mm;
  thickness: Mm;
  totalLength: Mm;
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
  | 'groove' // паз (§26)
  | 'cutout' // прямоугольный вырез (§28)
  | 'mill' // фрезеровка по контуру (§29)
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

/** Тип инструмента (§4). */
export type ToolType = 'DRILL' | 'END_MILL' | 'SAW' | 'CUSTOM';

/**
 * Откуда взялась операция (§8). Отличается от origin тем, что различает два
 * вида автоматических операций: порождённую фурнитурой и параметрическим
 * правилом. Поле необязательное — операции прошлых этапов остаются валидными.
 */
export type MachiningSource = 'HARDWARE_RULE' | 'PARAMETRIC_RULE' | 'MANUAL';

/**
 * Состояние операции (§9). DIRTY и OUTDATED различаются: DIRTY — параметры
 * изменились и операцию надо пересчитать, OUTDATED — она посчитана по уже
 * устаревшей модели.
 */
export type MachiningStatusKind = 'VALID' | 'WARNING' | 'ERROR' | 'DIRTY' | 'OUTDATED';

/**
 * Инструмент (§51). Библиотека локальная, лежит в проекте — отдельной базы
 * не заводится.
 */
export interface ToolItem {
  id: string;
  name: string;
  type: ToolType;
  diameter: Mm;
  /** Наибольшая достижимая глубина, мм. */
  maxDepth: Mm;
  archived?: boolean;
}

/**
 * Способ задать координату операции (§15–§19).
 *
 * EDGE      — отступ от края детали;
 * CENTER    — от центра (положительное значение вправо/вверх);
 * POINT     — абсолютная координата в системе детали;
 * OPERATION — от другой операции (например «шаг 32 мм от предыдущего»).
 *
 * Значение может быть числом или БЕЗОПАСНЫМ выражением вида `width / 2`
 * (§20/§21): выражение разбирается парсером проекта, никакой eval.
 */
export type PositionReferenceKind = 'EDGE' | 'CENTER' | 'POINT' | 'OPERATION';

export interface PositionReference {
  kind: PositionReferenceKind;
  /** Число или выражение (`width / 2`, `height - 37`). */
  value: number | string;
  /** Для EDGE — от какого края; для OPERATION — id операции-опоры. */
  from?: string;
}

/**
 * Шаблон операции в правиле (§14). Данные, а не код: правило описывается
 * набором шаблонов, поэтому пользователь может задать свою технологию, не
 * трогая исходники.
 */
export interface OperationTemplate {
  id: string;
  type: MachiningType;
  toolType?: ToolType;
  face: PartFace;
  x: PositionReference;
  y: PositionReference;
  diameter?: number | string;
  depth?: number | string;
  /** Для паза/кармана/выреза. */
  length?: number | string;
  width?: number | string;
  through?: boolean;
}

/**
 * Результат генерации присадки детали (§83). Хранит снимок условий расчёта
 * (§82), поэтому по старому результату видно, каким правилом и с каким
 * профилем он получен.
 */
export interface MachiningResult {
  partId: PartId;
  operations: MachiningOperation[];
  warnings: string[];
  errors: string[];
  /** Версия набора правил, которым посчитано (§84). */
  version: string;
  generatedAt: string; // ISO
  /** Снимок производственного профиля (§82). */
  profileSnapshot?: ManufacturingProfile;
}

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
  /** Инструмент, которым выполняется операция (§2/§4). */
  toolType?: ToolType;
  /** Конкретный инструмент из библиотеки, если выбран (§51). */
  toolId?: string;
  /**
   * Источник операции (§8). Необязательное поле: у операций прошлых этапов
   * его нет, и оно выводится из origin.
   */
  source?: MachiningSource;
  /** Состояние операции (§9). Выводится валидатором, в модели необязательно. */
  status?: MachiningStatusKind;
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
  /** Технологический припуск на кромкование, мм (§39). */
  edgeCutAllowance?: Mm;
  /**
   * Возможности станка (§55). Живут в ЭТОМ профиле, а не в отдельной
   * сущности (§56): производственные ограничения — свойство одного и того же
   * производства.
   */
  supportedOperations?: MachiningType[];
  maxToolDiameter?: Mm;
  maxMachiningDepth?: Mm;
  /** Библиотека инструментов производства (§52). */
  tools?: ToolItem[];
  /**
   * Округление ЗАКУПОЧНОЙ длины кромки, мм (§34/§72). Расчётная длина от
   * округления не страдает: геометрия остаётся точной.
   */
  edgePurchaseRounding?: Mm;
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
  | 'back-panel' // крепёж задней стенки
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
  description?: string;
  /** Параметры крепежа: diameter, length, headDiameter и т.п. (§13). */
  parameters?: Record<string, number | string | boolean>;
  /**
   * Совместимые материалы плиты (§2/§39). Пусто — совместим с любыми: так
   * позиции прошлых этапов продолжают работать без правки.
   */
  compatibleMaterials?: MaterialId[];
  /**
   * Допустимый диапазон толщины детали, мм (§39/§41). Выход за диапазон —
   * предупреждение, а не запрет: крепёж часто ставят и «на грани».
   */
  thicknessRange?: { min?: Mm; max?: Mm };
  /** Цена необязательна и на геометрию не влияет (§82/§83). */
  cost?: { perUnit?: number; currency?: string };
  /**
   * Правила присадки этой позиции (§10/§14). Если не заданы, применяется
   * правило по категории из реестра machining — то есть каталог продолжает
   * работать без изменений.
   */
  machiningRules?: HardwareRule[];
  /**
   * Правило размещения по умолчанию (§10/§79). Пресет и правило соединения
   * могут его переопределить; отсутствие поля означает «по центру узла».
   */
  placement?: PlacementRule;
  /** Правило массива по умолчанию (§83–§85): полкодержатели, петли, шканты. */
  array?: HardwareArraySpec;
  archived?: boolean;
  schemaVersion?: number;
  libraryRef?: LibraryRef;
  metadata?: Record<string, unknown>;
}

/**
 * Состояние позиции фурнитуры в проекте (§81).
 *
 * MISSING отличается от ERROR намеренно: соединение ссылается на позицию,
 * которой нет в проекте. Соединение при этом НЕ удаляется (§79) — пользователь
 * должен иметь возможность назначить замену (§80).
 */
export type HardwareStatus = 'VALID' | 'WARNING' | 'ERROR' | 'MISSING' | 'ARCHIVED';

/** Компонент комплекта (§23/§24). */
export interface HardwareComponent {
  hardwareId: HardwareId;
  /** Сколько штук этого компонента входит в ОДИН комплект. */
  quantity: number;
}

/**
 * Комплект фурнитуры (§23–§25): минификс = эксцентрик + шток + футорка.
 *
 * Комплект — это способ ПОСЧИТАТЬ, а не отдельная позиция склада: количество
 * компонентов выводится из числа применений комплекта, поэтому независимого
 * количества нигде не хранится (§85).
 */
export interface HardwareKit {
  id: string;
  name: string;
  article?: string;
  components: HardwareComponent[];
  archived?: boolean;
}

/**
 * Установленная единица фурнитуры (§18). Производная величина: выводится из
 * соединения, поэтому дублей одной и той же единицы не бывает (§20), а
 * стабильный id (§19) позволяет ссылаться на неё из 3D и документов.
 */
export interface HardwareInstance {
  /** Стабильный id: `<connectionId>#<индекс>`. */
  id: string;
  hardwareId: HardwareId;
  /**
   * Соединение, породившее единицу. Пусто у ручной фурнитуры (§132):
   * декоративная ручка может стоять и без конструктивного узла.
   */
  connectionId?: HardwareConnectionId;
  /** Деталь, на которой стоит единица (сторона A соединения). */
  partId: PartId;
  /** Вторая деталь узла — для навигации и подсветки. */
  counterpartId?: PartId;
  position?: Vec3;
  /** Ориентация единицы, градусы (§61). */
  rotation?: Rotation;
  /** Значения параметров именно этой единицы (§4): длина, вылет, отступ. */
  parameters?: Record<string, number | string | boolean>;
  /** Количество единиц в этой позиции (§4). Отсутствует — одна штука. */
  quantity?: number;
  /** Порождена правилом или поставлена вручную (§132). */
  source?: 'rule' | 'manual';

  // ── Этап 32: параметрическая фурнитура на детали ──────────────────────────
  /** Грань детали, на которой стоит единица (§60). */
  face?: PartFace;
  /**
   * Стабильный ключ детали (`metadata.key`), запомненный при установке (§76–§79).
   *
   * Перегенерация шкафа создаёт детали заново с новыми id, поэтому привязка
   * только по partId теряла бы фурнитуру. Ключ переживает пересчёт.
   */
  partKey?: string;
  /** Вид фурнитуры каталога (§2): HINGE, HANDLE, DRAWER_SLIDE и т.д. */
  kind?: HardwareKind;
  /** Правило параметрического размещения (§71/§72). */
  placement?: PlacementRule;
  /**
   * Ручная правка положения (§80). Хранится отдельно от расчётного положения,
   * поэтому Reset (§81) возвращает автоматическое место, ничего не теряя.
   */
  override?: { x?: Mm; y?: Mm; z?: Mm; rotation?: Rotation };
  /** Положение зафиксировано — пересчёт его не двигает (§65). */
  locked?: boolean;
  /** Скрыта в 2D/3D (§66). */
  hidden?: boolean;
  /** Комплект, в который входит единица (§67/§68). */
  setId?: string;
}

/**
 * Единица фурнитуры на детали (§1). Это тот же HardwareInstance: отдельной
 * параллельной модели не заводим, чтобы спецификация, присадка и производство
 * продолжали видеть одни и те же данные.
 */
export type HardwareItem = HardwareInstance;

/**
 * Вид фурнитуры каталога (§2).
 *
 * Отличается от HardwareCategory тем, что это словарь КАТАЛОГА (внешнее имя),
 * а категория — внутренний ключ правил присадки. Соответствие однозначное.
 */
export type HardwareKind =
  | 'HINGE' | 'HANDLE' | 'DRAWER_SLIDE' | 'SHELF_PIN' | 'CONFIRMAT' | 'MINIFIX'
  | 'DOWEL' | 'SCREW' | 'BRACKET' | 'LEG' | 'CASTER' | 'CONNECTOR' | 'LOCK' | 'OTHER';

/**
 * Комплект фурнитуры (§67–§70): чашка + ответная планка + саморезы.
 *
 * Комплект хранит только состав и привязку; количество компонентов считается
 * из единиц (§69), а не дублируется в модели.
 */
export interface HardwareSet {
  id: string;
  name: string;
  /** Единицы, входящие в комплект. */
  itemIds: string[];
  /** К чему привязан комплект (§70). */
  parentId?: string;
  parentKind?: 'PART' | 'MODULE' | 'CABINET';
}

/**
 * Позиция каталога фурнитуры (§4/§5).
 *
 * Это Hardware из модели плюс каталожные признаки. Второй карточки фурнитуры
 * не появляется: каталог хранит те же позиции, что попадают в проект.
 */
export interface HardwareCatalogEntry {
  hardware: Hardware;
  kind: HardwareKind;
  /** Позиция создана пользователем (§6), а не входит во встроенный каталог. */
  custom?: boolean;
  favorite?: boolean;
  /** Правила установки (§5): описание монтажа для схемы и подсказок. */
  installation?: string;
}

/** Локальный каталог фурнитуры (§4/§117/§119). */
export interface HardwareCatalog {
  version: number;
  entries: HardwareCatalogEntry[];
  updatedAt?: string;
}

/**
 * Опорная точка параметрического положения фурнитуры (§17/§79).
 *
 * EDGE      — от края детали;
 * CENTER    — от центра детали;
 * CORNER    — от угла (обе координаты от края);
 * DISTANCE  — фиксированное расстояние в мм;
 * PARAMETER — из параметра модуля или выражения.
 */
export type PlacementReference =
  | 'EDGE' | 'CENTER' | 'CORNER' | 'DISTANCE' | 'PARAMETER'
  /** Этап 32 (§73): от плоскости детали, от оси и от другой фурнитуры. */
  | 'FACE' | 'AXIS' | 'HARDWARE';

/**
 * Правило параметрического размещения (§16/§79–§81).
 *
 * Координата задаётся либо числом, либо ВЫРАЖЕНИЕМ, которое считает
 * существующий безопасный вычислитель (§108). Никакого произвольного
 * JavaScript: `width / 2` — это формула, а не код.
 */
export interface PlacementRule {
  reference: PlacementReference;
  /** Выражение или число для координаты вдоль детали. */
  x?: string | number;
  /** Выражение или число для координаты поперёк детали. */
  y?: string | number;
  /** Выражение или число для координаты по толщине детали (§74). */
  z?: string | number;
  /** Сторона отсчёта для EDGE/CORNER. */
  from?: 'left' | 'right' | 'top' | 'bottom';
  /** Отступ от опорной точки, мм. */
  offset?: Mm;
  /** Грань детали, на которой стоит фурнитура (§73/§75). */
  face?: PartFace;
  /** Ось для reference: 'AXIS' (§73). */
  axis?: 'X' | 'Y' | 'Z';
  /** Опорная фурнитура для reference: 'HARDWARE' (§73). */
  referenceId?: string;
  /** Поворот относительно грани, градусы (§75/§31). */
  orientation?: number;
  /** Ограничения размещения (§72): минимальные отступы и допустимый размер. */
  constraints?: PlacementConstraints;
}

/** Ограничения правила размещения (§72/§111–§113). */
export interface PlacementConstraints {
  /** Минимальный отступ от края детали, мм. */
  minEdgeDistance?: Mm;
  /** Минимальное расстояние между однотипными элементами, мм. */
  minSpacing?: Mm;
  /** Допустимый размер детали, мм: петля не встанет на узкий фасад. */
  minPartSize?: Mm;
  maxPartSize?: Mm;
}

/** Способ расстановки элементов массива (§87). */
export type SpacingMode = 'FIXED' | 'EQUAL' | 'MAX';

/**
 * Массив фурнитуры (§83–§89): повторение позиции по линии.
 *
 * Количество может задаваться прямо или вычисляться правилом по длине
 * соединения (§33/§85) с ограничениями minCount/maxCount (§34).
 */
export interface HardwareArraySpec {
  /** Явное количество; не задано — считается по spacing и длине. */
  count?: number;
  /** Шаг между элементами, мм (§32/§84). */
  spacing?: Mm;
  spacingMode?: SpacingMode;
  /** Направление размещения на детали. */
  direction?: 'horizontal' | 'vertical';
  /** Отступ первого и последнего элемента от края, мм (§88). */
  edgeOffset?: Mm;
  minCount?: number;
  maxCount?: number;
  /** Симметрично относительно центра (§90/§91). */
  symmetric?: boolean;
}

/**
 * Набор фурнитуры для типовой задачи (§64): «Стандартный корпус» — конфирмат,
 * «Стандартные фасады» — петля и ручка. Пресет задаёт КАТЕГОРИЮ → позицию,
 * поэтому один пресет работает с любой библиотекой.
 */
export interface HardwarePreset {
  id: string;
  name: string;
  /** Категория крепежа → выбранная позиция. */
  selection: Partial<Record<HardwareCategory, HardwareId>>;
  /** Для какого профиля предназначен (§67). */
  profile?: HardwareProfileKind;
  builtin?: boolean;
}

/** Профиль применения фурнитуры (§67). */
export type HardwareProfileKind = 'CARCASS' | 'FACADE' | 'DRAWER';

/**
 * Профиль фурнитуры (§67): какие категории крепежа относятся к корпусу,
 * фасадам и ящикам. Нужен, чтобы пресет применялся к своей части изделия и
 * не трогал остальное.
 */
export interface HardwareProfile {
  kind: HardwareProfileKind;
  name: string;
  categories: HardwareCategory[];
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
  /** Параметры узла: шаг шкантов, отступ от края и т.п. (§13/§16). */
  parameters?: Record<string, number | string | boolean>;
  /**
   * Правка автоматически рассчитанного количества (§134/§135). Пусто —
   * количество считается правилом; сброс override (§136) — удаление поля.
   */
  quantityOverride?: number;
  /**
   * Снимок правила, которым узел построен (§99/§100): версия правила и
   * параметры на момент расчёта. По нему видно, что узел устарел (§24).
   */
  ruleSnapshot?: ConnectionRuleSnapshot;
  /** Правило размещения крепежа в узле (§16/§17). */
  placement?: PlacementRule;
  /** Массив точек крепления для длинного узла (§86). */
  array?: HardwareArraySpec;
  metadata?: Record<string, unknown>;
}

/**
 * Снимок правила соединения (§99/§100). Хранится вместе с узлом, поэтому
 * после доработки правил видно, каким поколением построен существующий узел.
 */
export interface ConnectionRuleSnapshot {
  ruleId: string;
  version: string;
  /** Параметры крепежа на момент расчёта. */
  hardwareParameters?: Record<string, number | string | boolean>;
  /** Параметры узла на момент расчёта. */
  connectionParameters?: Record<string, number | string | boolean>;
  createdAt: string; // ISO
}

/** Источник соединения (§4). */
export type ConnectionSource = 'PARAMETRIC' | 'MANUAL';

/**
 * Состояние соединения после проверки (§24/§45).
 * DIRTY — исходные детали изменились, узел требует пересчёта (§96);
 * OUTDATED — узел построен другой версией правила (§99).
 */
export type ConnectionStatus = 'VALID' | 'WARNING' | 'ERROR' | 'DIRTY' | 'OUTDATED';

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

  /**
   * Откуда взялась кромка каждой стороны (§4). Сторона, назначенная вручную,
   * переживает пересчёт правил (§86). Поле необязательное: у деталей из
   * проектов прошлых этапов его нет, и они считаются параметрическими (§97).
   */
  edgeSources?: Partial<Record<EdgeSide, EdgeSource>>;

  /**
   * Ручные правки параметров кромки по сторонам (§45). Пустое поле — все
   * значения берутся из библиотеки кромки.
   */
  edgeOverrides?: Partial<Record<EdgeSide, EdgeOverride>>;

  position: Vec3;
  rotation: Rotation;
  /**
   * Смещение детали в разнесённом виде (§145). Это ПРЕДСТАВЛЕНИЕ, а не
   * конструкция: на раскрой, присадку и спецификацию оно не влияет и в
   * производственных расчётах не участвует.
   */
  explodedOffset?: Vec3;

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
  /** Лист, на котором лежит деталь (§24). Дублирует владельца для экспорта. */
  sheetId?: string;
  /** Направление текстуры детали в размещённом положении (§24/§35). */
  grainDirection?: GrainDirection;
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
  /** Складская позиция, если остаток оприходован (§100 этапа 30). */
  stockSheetId?: string;
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

/**
 * Машиночитаемая причина, по которой деталь не размещена (§35).
 *
 * DETAIL_TOO_LARGE  — деталь не помещается ни в один доступный формат листа
 *                     даже с учётом разрешённого поворота: раскроем не
 *                     лечится, нужен другой лист или другая деталь.
 * NO_VALID_PLACEMENT — деталь помещается в лист, но свободного места с учётом
 *                     пропила, отступов и текстуры не нашлось.
 * OUT_OF_STOCK      — место есть, но исчерпан ограниченный запас листов.
 */
export type UnplacedReason = 'DETAIL_TOO_LARGE' | 'NO_VALID_PLACEMENT' | 'OUT_OF_STOCK';

/** Причина, по которой деталь не размещена. */
export interface UnplacedPiece {
  pieceId: string;
  partId: PartId;
  name: string;
  number: string;
  length: Mm;
  width: Mm;
  /** Код причины для программной обработки (§35). */
  code: UnplacedReason;
  /** Текст для пользователя. */
  reason: string;
}

/**
 * Экземпляр детали в раскрое (§80). Деталь с quantity > 1 раскладывается
 * несколькими экземплярами, но PartModel остаётся ОДИН (§5/§81): экземпляр
 * только ссылается на него через partId.
 */
export interface CuttingInstance {
  /** Стабильный id экземпляра: `<partId>#<instanceIndex>`. */
  id: string;
  partId: PartId;
  /** Номер экземпляра, начиная с 1. */
  instanceIndex: number;
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
  /** Задание, которым получен результат (§56). */
  jobId?: string;
  /** Идентификатор алгоритма (maxrects / guillotine). */
  algorithm?: string;
  /**
   * Версия алгоритма (§57). После доработки движка старый результат остаётся
   * читаемым и видно, каким поколением алгоритма он посчитан.
   */
  algorithmVersion?: string;
  /**
   * Снимок настроек, с которыми результат посчитан (§58/§59). Позволяет
   * воспроизвести раскрой даже если настройки проекта уже изменились.
   */
  settingsSnapshot?: CuttingSettingsSnapshot;
  /** Стабильный id карты раскроя (§25): `plan:<materialId>`. */
  planId?: string;
  /** Версия карты (§93): увеличивается при каждом успешном пересчёте. */
  planVersion?: number;
  /** Состояние карты (§88–§95). Вычисляется, в проекте хранится как отметка. */
  status?: CuttingPlanStatus;
  /** Карта зафиксирована пользователем (§90). */
  locked?: boolean;
  /** Снимок исходных данных (§94) для определения OUTDATED (§95). */
  sourceSnapshot?: CuttingSourceSnapshot;
}

/**
 * Снимок параметров расчёта (§59). Хранится вместе с результатом, поэтому
 * раскрой воспроизводим: те же детали + тот же снимок → тот же результат.
 */
export interface CuttingSettingsSnapshot {
  algorithm: string;
  algorithmVersion: string;
  kerf: Mm;
  trim: TrimSettings;
  respectGrain: boolean;
  attempts: number;
  sortStrategy: string;
  optimizationMode: OptimizationMode;
  usableRemnant: UsableRemnantCriteria;
  sheet: { length: Mm; width: Mm };
  sheetMaterialId?: string;
  /** Детерминированное зерно (§20): расчёт не использует случайность. */
  seed: number;
}

/**
 * Статус задания раскроя (§3 этапа 14, §123 этапа 30).
 *
 * Первые пять значений — исходный набор этапа 14, он продолжает работать.
 * READY/DIRTY/CALCULATING/VALID/WARNING добавлены этапом 30 и описывают
 * задание подробнее: посчитано и годно, требует пересчёта, считается сейчас.
 */
export type CuttingJobStatus =
  | 'PENDING' | 'RUNNING' | 'DONE' | 'ERROR' | 'CANCELLED'
  | 'READY' | 'DIRTY' | 'CALCULATING' | 'VALID' | 'WARNING';

/**
 * Задание раскроя (§3). Одно задание = ОДИН материал одной толщины (§25/§26):
 * смешивать ЛДСП 16 и ЛДСП 18 в одном задании нельзя, для них создаются
 * отдельные задания (§75).
 */
export interface CuttingJob {
  id: string;
  projectId: string;
  materialId: MaterialId;
  /** Толщина — часть ключа задания: 16 и 18 мм не смешиваются (§26). */
  thickness: Mm;
  /** Выбранный формат листа (SheetMaterial.id) либо undefined = AUTO (§22). */
  sheetFormatId?: string;
  /** Экземпляры деталей задания (§4/§80), ссылаются на PartModel. */
  instances: CuttingInstance[];
  settings: CuttingSettingsSnapshot;
  result?: CuttingResult;
  status: CuttingJobStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  /**
   * Версия задания (§118 этапа 30): растёт при каждом успешном пересчёте.
   * Отсутствие поля читается как версия 1 — задания прошлых этапов остаются
   * действительными.
   */
  version?: number;
  /** Остатки задания (§3/§38 этапа 30); выводятся из result.sheets. */
  leftovers?: LeftoverSheet[];
  /** Исходные данные изменились — задание требует пересчёта (§120). */
  dirty?: boolean;
}

/**
 * Полезный остаток листа (§38–§41 этапа 30).
 *
 * Это ПРЕДСТАВЛЕНИЕ остатка: сам прямоугольник считает раскрой
 * (CuttingRemnant), а на складе он живёт как StoredRemnant. Второй геометрии
 * здесь не заводится — только производственные свойства.
 */
export interface LeftoverSheet {
  id: string;
  width: Mm;
  height: Mm;
  thickness: Mm;
  materialId: MaterialId;
  /** Лист, из которого получен остаток (§39). */
  sourceSheetId: string;
  grainDirection: GrainDirection;
  status: LeftoverStatus;
  /** Складская позиция, если остаток оприходован (§100). */
  stockSheetId?: string;
  area: number; // мм²
}

/**
 * Состояние остатка (§40). USABLE и TOO_SMALL ВЫЧИСЛЯЮТСЯ из минимальных
 * размеров, USED и RESERVED — из складского учёта.
 */
export type LeftoverStatus = 'USABLE' | 'TOO_SMALL' | 'USED' | 'RESERVED';

/** Режим оптимизации раскроя. */
export type OptimizationMode = 'FAST' | 'BALANCED' | 'MAX_UTILIZATION';

/** Критерии «полезного» остатка (не зашиты в код — настройки пользователя). */
export interface UsableRemnantCriteria {
  minWidth: Mm;
  minLength: Mm;
  minArea: number; // мм²
}

/**
 * Разрешённый технологический профиль реза (§17). НЕ отдельная сущность
 * проекта: это вычисленный вид поверх Material.kerf, ProjectSettings.kerf и
 * CuttingSettings — второй профиль не заводится (§18).
 */
export interface CuttingProfile {
  /** Ширина пропила, мм (например 3.2). */
  kerf: Mm;
  /** Обрезка кромок листа (§19). */
  trimming: TrimSettings;
  /** Минимальный технологический зазор между деталями, мм (§39). */
  minGap: Mm;
  /**
   * Ширина пильного диска, мм (§17). Если задана и не совпадает с kerf —
   * фактическим пропилом считается большее значение.
   */
  bladeWidth?: Mm;
}

/**
 * Пресет раскроя (§82–§84) — именованный набор технологических параметров.
 * Пресет НЕ хранит результат: он применяется к CuttingSettings.
 */
export interface CuttingPreset {
  id: string;
  name: string;
  description?: string;
  kerf: Mm;
  minGap: Mm;
  bladeWidth?: Mm;
  trim: TrimSettings;
  respectGrain: boolean;
  useRemnants: boolean;
  algorithm: string;
  optimizationMode: OptimizationMode;
  /** Встроенный пресет нельзя удалить, можно только скопировать. */
  builtIn?: boolean;
}

/**
 * Пороги производственной классификации качества раскроя (§132/§133).
 * Значения — нижние границы utilization в процентах; настраиваются
 * пользователем, субъективных оценок в коде нет.
 */
export interface QualityThresholds {
  excellent: number; // ≥ excellent → EXCELLENT
  good: number;      // ≥ good → GOOD
  average: number;   // ≥ average → AVERAGE, ниже → POOR
}

export type CuttingQuality = 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'POOR';

/**
 * Состояние карты раскроя (§88/§89/§90/§95).
 * VALID    — рассчитана по текущим данным, все детали размещены;
 * WARNING  — рассчитана, но utilization ниже порога (§131);
 * ERROR    — есть неразмещённые детали (§130);
 * DIRTY    — изменились детали/материал/склад/профиль, нужен пересчёт;
 * OUTDATED — снимок исходных данных не совпадает с проектом (§95);
 * LOCKED   — план зафиксирован пользователем и не пересчитывается (§91).
 */
export type CuttingPlanStatus = 'VALID' | 'WARNING' | 'ERROR' | 'DIRTY' | 'OUTDATED' | 'LOCKED';

/**
 * Снимок исходных данных плана (§94). По нему определяется OUTDATED без
 * повторного расчёта: те же входные данные → тот же план.
 */
export interface CuttingSourceSnapshot {
  /** Сигнатура материала (id, толщина, текстура, поворот). */
  material: string;
  /** Сигнатура технологического профиля (kerf, minGap, обрезка). */
  profile: string;
  /** Количества деталей: partId → quantity. */
  quantities: Record<string, number>;
  /** Сигнатура доступного склада листов и остатков. */
  stock: string;
  createdAt: string; // ISO
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
  /**
   * Минимальный зазор между деталями сверх пропила, мм (§39). Отсутствие
   * поля = 0: проекты до этого этапа считаются как раньше.
   */
  minGap?: Mm;
  /** Ширина пильного диска, мм (§17). */
  bladeWidth?: Mm;
  /** Пользовательские пресеты раскроя (§84). Встроенные живут в движке. */
  presets?: CuttingPreset[];
  /** Применённый пресет (§82). */
  activePresetId?: string;
  /** Пороги классификации качества (§133). */
  qualityThresholds?: QualityThresholds;
  /**
   * Зафиксированные карты раскроя по материалу (§90/§91): materialId → true.
   * Автоматический пересчёт такие планы не трогает.
   */
  lockedPlans?: Record<string, boolean>;
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

/**
 * Режим запаса листа (§10). INFINITE — материал всегда доступен, раскрой
 * добавляет листы по необходимости; LIMITED — доступно ровно
 * `availableQuantity` листов, дальше детали остаются UNPLACED/OUT_OF_STOCK.
 */
export type StockMode = 'INFINITE' | 'LIMITED';

/**
 * Формат листа в библиотеке (StockSheet / SheetLibrary). Ссылается на
 * существующий Material — толщина и текстура берутся оттуда (§5/§8), поле
 * `thickness` дублируется только как денормализация для фильтров склада.
 */
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
  /**
   * Режим запаса (§9/§10). Отсутствие поля читается по старому правилу:
   * availableQuantity === 0 → INFINITE, иначе LIMITED.
   */
  stockMode?: StockMode;
  /**
   * Технологический припуск по краю листа, мм (§4). Если задан — применяется
   * как обрезка по всем четырём сторонам поверх настроек раскроя (§19).
   */
  edgeAllowance?: Mm;
  /** Разрешён ли поворот самого листа 90° при подборе формата (§48). */
  allowRotate?: boolean;
  /** Архивный формат не предлагается в новом раскрое (§80). */
  archived?: boolean;
  /** Складская позиция листа (§99 этапа 30). */
  stockSheetId?: string;
  /** Сколько листов зарезервировано заданиями раскроя (§102 этапа 30). */
  reserved?: number;
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Сохранённый остаток (RemnantLibrary) — переиспользуемый в будущем раскрое. */
export type RemnantStatus = 'AVAILABLE' | 'RESERVED' | 'USED' | 'ARCHIVED';

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
  /**
   * Состояние остатка (§92). Отсутствие поля = AVAILABLE: остатки, сохранённые
   * до этого этапа, продолжают работать как раньше.
   */
  status?: RemnantStatus;
  /** Складская позиция остатка (§100 этапа 30). */
  stockSheetId?: string;
  /** Кем зарезервирован: id задания раскроя (§101/§102 этапа 30). */
  reservedBy?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Производство (этап 31)
// ─────────────────────────────────────────────────────────────────────────────

/** Состояние производственного задания (§2). */
export type ProductionStatus = 'DRAFT' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'ERROR';

/** Состояние детали в производстве (§9). */
export type ProductionPartStatus = 'NEW' | 'MODIFIED' | 'READY' | 'ERROR';

/**
 * Снимок ревизий проекта (§76/§77).
 *
 * Снимок не копирует детали: он хранит СИГНАТУРЫ разделов, по которым видно,
 * что изменилось между выпусками. Сами данные остаются в ProjectModel.
 */
export interface ProductionSnapshot {
  projectRevision: string;
  partsRevision: string;
  cuttingRevision: string;
  machiningRevision: string;
  hardwareRevision: string;
  createdAt: string; // ISO
  /** Сигнатуры деталей: partId → ревизия детали (§77/§82). */
  parts: Record<string, string>;
}

/** Выпуск производства (§78/§79). */
export interface ProductionRelease {
  /** Человекочитаемый номер: REL-001 (§79). */
  id: string;
  number: number;
  createdAt: string; // ISO
  /** Снимок на момент выпуска — он не меняется вслед за проектом (§80). */
  snapshot: ProductionSnapshot;
  note?: string;
  /** Сколько деталей вошло в выпуск. */
  partCount: number;
}

/** Партия деталей (§59/§60). */
export interface ProductionBatch {
  id: string;
  materialId: MaterialId;
  materialName: string;
  thickness: Mm;
  /** Вид обработки партии: раскрой, кромка, присадка. */
  kind: 'CUT' | 'EDGE' | 'MACHINING';
  partIds: PartId[];
  /** Общее количество деталей с учётом quantity (§61). */
  quantity: number;
  status: 'READY' | 'WARNING' | 'ERROR';
}

/** Производственное задание (§1–§3). */
export interface ProductionJob {
  id: string;
  projectId: string;
  status: ProductionStatus;
  /** Текущая ревизия задания; растёт после изменений проекта (§81). */
  revision: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  /** Снимок последнего расчёта готовности (§76). */
  snapshot?: ProductionSnapshot;
  /** Выпуски задания, новейший последним (§84). */
  releases?: ProductionRelease[];
  note?: string;
}

/** Производственное состояние проекта (§119). */
export interface ProductionState {
  job?: ProductionJob;
  /** История выпусков — локальная, без облака (§84). */
  history?: ProductionRelease[];
}

/**
 * Этикетка детали (§108/§109). Модель данных без привязки к печатному
 * движку: тот же объект используется и для списка, и для будущей печати.
 */
export interface PartLabel {
  partId: PartId;
  /** Номер экземпляра в раскрое (§51), например «2/4». Пусто — деталь целиком. */
  instance?: string;
  name: string;
  number: string;
  materialName: string;
  thickness: Mm;
  width: Mm;
  height: Mm;
  quantity: number;
  edgeSummary: string;
  grain: GrainDirection;
  /** Лист, на котором лежит экземпляр (если этикетка из раскроя). */
  sheetLabel?: string;
  /**
   * Локальные данные для QR/штрихкода (§110/§111). Строка, а не картинка:
   * внешние сервисы генерации не используются (§112).
   */
  code: string;
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
// Чертёж (тип данных; построение — в engines/drawing)
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
  /**
   * Единицы фурнитуры, поставленные вручную (§132): декоративная ручка может
   * стоять без конструктивного узла. Единицы, порождённые соединениями,
   * здесь НЕ хранятся — они выводятся из связей (§20/§85).
   */
  hardwareInstances?: HardwareInstance[];
  /** Комплекты фурнитуры (§23). Необязательно — старые проекты открываются (§108). */
  hardwareKits?: HardwareKit[];
  /** Пресеты фурнитуры проекта (§64/§107). */
  hardwarePresets?: HardwarePreset[];
  /** Комплекты установленной фурнитуры (§67–§70). */
  hardwareItemSets?: HardwareSet[];
  /** Нормы расхода фурнитуры (§35): полкодержатели, крепёж задней стенки. */
  hardwareRules?: Record<string, number>;
  machining: MachiningState;
  cutting: CuttingState;
  /** Библиотека форматов листов (SheetLibrary). */
  sheets: SheetMaterial[];
  /** Библиотека сохранённых остатков (RemnantLibrary). */
  remnants: StoredRemnant[];
  documents: DocumentsState;
  /** Производственное задание проекта (§119). Необязательно — старые проекты открываются. */
  production?: ProductionState;
  furnitures: Furniture[];
  metadata?: Record<string, unknown>;
}
