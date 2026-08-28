/**
 * Типы 2D-редактора конструкции (§2–§5).
 *
 * ГЛАВНОЕ РАЗДЕЛЕНИЕ: `Editor2DState` содержит ТОЛЬКО состояние интерфейса —
 * инструмент, зум, сдвиг, сетка, привязки, направляющие, выделение. Ни одна
 * производственная величина здесь не хранится (§2/§131): всё, что описывает
 * конструкцию, живёт в ProjectModel (§3) и правится через его действия.
 *
 * `EditorEntity` — это ПРЕДСТАВЛЕНИЕ существующей сущности проекта на плоскости,
 * а не новая сущность. Второй системы геометрии/деталей/модулей не заводится:
 * каждый EditorEntity ссылается на реальный объект через `entityId`.
 */
import type { Mm } from '@/core/model/types';

/** Тип сущности на холсте (§5). */
export type EntityType = 'MODULE' | 'PART' | 'HARDWARE' | 'CONNECTION' | 'REFERENCE';

/** Плоскость технического вида (§92–§99). Все виды ортографические. */
export type ViewPlane = 'TOP' | 'FRONT' | 'SIDE';

/** Инструмент редактора (§109/§111). */
export type EditorTool = 'select' | 'move' | 'rotate' | 'guide' | 'dimension' | 'addPart' | 'addModule';

export type SelectionState = 'none' | 'selected' | 'active';

/** Прямоугольник в мировых координатах вида, мм (§8). */
export interface Rect2D {
  x: Mm;
  y: Mm;
  width: Mm;
  height: Mm;
}

/** Размещение сущности на плоскости вида. */
export interface EntityTransform {
  /** Левый нижний угол габарита в мировых координатах вида, мм. */
  x: Mm;
  y: Mm;
  width: Mm;
  height: Mm;
  /** Поворот вокруг нормали вида, градусы. */
  rotation: number;
  mirrored: boolean;
}

/** Визуальный объект холста (§4). Только ссылка на модель, не копия данных. */
export interface EditorEntity {
  /** Идентификатор реальной сущности проекта (PartId/FurnitureId/…). */
  entityId: string;
  entityType: EntityType;
  transform: EntityTransform;
  selectionState: SelectionState;
  /** Отображаемое имя (Part.name, Furniture.name, …). */
  label: string;
  /** Номер позиции, если у сущности он есть. */
  number?: string;
  /** Владелец: модуль для детали, деталь для операции присадки. */
  parentId?: string;
  locked: boolean;
  hidden: boolean;
  /** Диаметр условного обозначения для точечных сущностей (фурнитура, отверстия). */
  symbolSize?: Mm;
  status?: 'VALID' | 'WARNING' | 'ERROR' | 'DIRTY';
}

/** Шаг сетки, мм (§9). */
export const GRID_STEPS_2D: Mm[] = [1, 5, 10, 20, 50];

/** Настройки привязки (§11–§13). */
export interface SnapSettings {
  /** Привязка к сетке. */
  toGrid: boolean;
  /** Привязка к краям, центрам и углам соседних объектов (§12). */
  toObjects: boolean;
  /** Привязка к направляющим. */
  toGuides: boolean;
  /** Радиус срабатывания привязки, мм (§13). */
  distance: Mm;
}

export const DEFAULT_SNAP: SnapSettings = {
  toGrid: true,
  toObjects: true,
  toGuides: true,
  distance: 8,
};

/** Ручная направляющая (§49–§52). */
export interface Guide2D {
  id: string;
  orientation: 'horizontal' | 'vertical';
  /** Координата в мировой системе вида, мм. */
  position: Mm;
  locked: boolean;
  /** Вид, к которому относится направляющая. */
  plane: ViewPlane;
}

/** Замер расстояния (§53–§56). */
export interface Dimension2D {
  id: string;
  plane: ViewPlane;
  from: { x: Mm; y: Mm };
  to: { x: Mm; y: Mm };
  /** Справочный размер не управляет моделью (§55). */
  reference: boolean;
  /** Параметр, с которым размер связан (§56). Пусто — просто замер. */
  parameterId?: string;
  label?: string;
}

/** Фильтр выделения по типам (§20). */
export type SelectionFilter = Record<EntityType, boolean>;

export const DEFAULT_SELECTION_FILTER: SelectionFilter = {
  MODULE: true,
  PART: true,
  HARDWARE: true,
  CONNECTION: true,
  REFERENCE: true,
};

/** Незавершённая операция перетаскивания/изменения размера (§122/§123/§152). */
export interface PendingOperation {
  kind: 'move' | 'resize';
  /** Сущности, затронутые операцией. */
  entityIds: string[];
  /** Смещение относительно старта, мм. */
  dx: Mm;
  dy: Mm;
  /** Для resize — какая ручка тянется. */
  handle?: ResizeHandle;
  /** Габариты на старте — по ним Esc возвращает исходное состояние (§150/§151). */
  origin: Record<string, EntityTransform>;
}

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Состояние интерфейса 2D-редактора (§2). В экспорт проекта не попадает (§131).
 */
export interface Editor2DState {
  plane: ViewPlane;
  tool: EditorTool;
  /** Масштаб отображения: пикселей на миллиметр. */
  zoom: number;
  /** Сдвиг вида в мировых координатах, мм. */
  panX: Mm;
  panY: Mm;
  showGrid: boolean;
  gridStep: Mm;
  snap: SnapSettings;
  showRulers: boolean;
  showGuides: boolean;
  showLabels: boolean;
  showHardware: boolean;
  showConnections: boolean;
  showMachining: boolean;
  showEdges: boolean;
  guides: Guide2D[];
  dimensions: Dimension2D[];
  /** Выбранные сущности; последняя — активная. */
  selection: string[];
  filter: SelectionFilter;
  /** Изолированные сущности; пусто — показывать всё (§88). */
  isolated: string[];
  /** Скрытые вручную сущности (§86). */
  hidden: string[];
  /** Заблокированные вручную сущности (§85). */
  locked: string[];
  pending: PendingOperation | null;
  /** Режим только для чтения (§133/§134). */
  readOnly: boolean;
}

export const DEFAULT_EDITOR_2D: Editor2DState = {
  plane: 'FRONT',
  tool: 'select',
  zoom: 0.25,
  panX: 0,
  panY: 0,
  showGrid: true,
  gridStep: 10,
  snap: { ...DEFAULT_SNAP },
  showRulers: true,
  showGuides: true,
  showLabels: true,
  showHardware: true,
  showConnections: false,
  showMachining: false,
  showEdges: false,
  guides: [],
  dimensions: [],
  selection: [],
  filter: { ...DEFAULT_SELECTION_FILTER },
  isolated: [],
  hidden: [],
  locked: [],
  pending: null,
  readOnly: false,
};

/** Границы группы сущностей, мм. */
export interface Bounds2D {
  minX: Mm;
  minY: Mm;
  maxX: Mm;
  maxY: Mm;
}

export const EMPTY_BOUNDS: Bounds2D = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
