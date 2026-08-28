/**
 * CabinetModel (§1–§5) — нормализованный вид параметрической модели корпуса.
 *
 * Это НЕ вторая модель мебели. Хранится по-прежнему один ParametricModel
 * (этап 18) в параметрах изделия; здесь он лишь дочитывается значениями по
 * умолчанию, чтобы правила и UI работали с полным набором полей и не
 * повторяли `?? 16` в двадцати местах. Обратное преобразование не нужно:
 * CabinetModel — это и есть ParametricModel, только со всеми блоками.
 *
 *   ParametricModel (хранимое) → toCabinetModel() → CabinetModel (расчётное)
 */
import type {
  BackPanelSettings,
  CabinetType,
  DoorKind,
  DoorOverlay,
  DoorSettings,
  DrawerDistribution,
  DrawerSettings,
  EdgeSettings,
  FurnitureKind,
  HandleSettings,
  LegPlacement,
  LegSettings,
  ParametricModel,
  PlinthSettings,
  ShelfMode,
  ShelfSettings,
} from '@/core/parametric/types';
import { DEFAULT_EDGE, DEFAULT_HANDLE, createParametricModel } from '@/core/parametric/types';
import type { Mm } from '@/core/model/types';

/** Глубина паза под заднюю стенку по умолчанию (§23). */
export const DEFAULT_GROOVE_DEPTH: Mm = 8;
/** Отступ паза от заднего торца детали по умолчанию. */
export const DEFAULT_GROOVE_OFFSET: Mm = 10;
/** Толщина боковин короба ящика по умолчанию. */
export const DEFAULT_DRAWER_SIDE_THICKNESS: Mm = 16;
/** Толщина дна ящика по умолчанию. */
export const DEFAULT_DRAWER_BOTTOM_THICKNESS: Mm = 3;
/** Зазор на направляющую с каждой стороны короба (§45/§83). */
export const DEFAULT_DRAWER_SIDE_CLEARANCE: Mm = 13;

export interface ResolvedBackPanel extends BackPanelSettings {
  grooveDepth: Mm;
  grooveOffset: Mm;
}
export interface ResolvedShelves extends ShelfSettings {
  mode: ShelfMode;
}
export interface ResolvedDoors extends DoorSettings {
  overlay: DoorOverlay;
  kind: DoorKind;
  handle: HandleSettings;
}
export interface ResolvedDrawers extends DrawerSettings {
  distribution: DrawerDistribution;
  positions: Mm[];
  sideThickness: Mm;
  bottomThickness: Mm;
  slideLength: Mm;
  sideClearance: Mm;
}
export interface ResolvedLegs extends LegSettings {
  placement: LegPlacement;
}
export interface ResolvedPlinth extends PlinthSettings {
  thickness: Mm;
}

/** Параметрическая модель со всеми заполненными блоками (§1). */
export interface CabinetModel extends ParametricModel {
  cabinetType: CabinetType;
  edge: EdgeSettings;
  backPanel: ResolvedBackPanel;
  shelves: ResolvedShelves;
  doors: ResolvedDoors;
  drawers: ResolvedDrawers;
  legs: ResolvedLegs;
  plinth: ResolvedPlinth;
}

// ── Типы корпуса (§5) ────────────────────────────────────────────────────────

export interface CabinetTypeInfo {
  type: CabinetType;
  label: string;
  /** Изделие, которым тип представлен в модели этапа 18. */
  kind: FurnitureKind;
  /** Типовые габариты — подставляются в мастере создания (§92). */
  width: Mm;
  height: Mm;
  depth: Mm;
}

/**
 * Соответствие типа корпуса и вида изделия. Второго перечня видов мебели не
 * появляется: тип — это удобное имя для набора габаритов и правил.
 */
export const CABINET_TYPES: CabinetTypeInfo[] = [
  { type: 'CABINET', label: 'Шкаф', kind: 'CABINET', width: 800, height: 2000, depth: 600 },
  { type: 'WARDROBE', label: 'Шкаф-купе', kind: 'CABINET', width: 1800, height: 2400, depth: 600 },
  { type: 'BASE_UNIT', label: 'Нижняя тумба', kind: 'BASE_CABINET', width: 800, height: 820, depth: 560 },
  { type: 'WALL_UNIT', label: 'Навесной шкаф', kind: 'WALL_CABINET', width: 600, height: 720, depth: 300 },
  { type: 'TALL_UNIT', label: 'Пенал', kind: 'TALL_CABINET', width: 600, height: 2100, depth: 560 },
  { type: 'SHELF_UNIT', label: 'Стеллаж', kind: 'SHELF_UNIT', width: 900, height: 1800, depth: 350 },
];

export function cabinetTypeInfo(type: CabinetType): CabinetTypeInfo {
  return CABINET_TYPES.find((t) => t.type === type) ?? CABINET_TYPES[0];
}

export const KIND_OF_CABINET_TYPE: Record<CabinetType, FurnitureKind> = {
  CABINET: 'CABINET',
  WARDROBE: 'CABINET',
  BASE_UNIT: 'BASE_CABINET',
  WALL_UNIT: 'WALL_CABINET',
  TALL_UNIT: 'TALL_CABINET',
  SHELF_UNIT: 'SHELF_UNIT',
};

/** Обратное сопоставление: старый проект без cabinetType не теряет смысла. */
export function cabinetTypeOfKind(kind: FurnitureKind): CabinetType {
  switch (kind) {
    case 'BASE_CABINET': return 'BASE_UNIT';
    case 'WALL_CABINET': return 'WALL_UNIT';
    case 'TALL_CABINET': return 'TALL_UNIT';
    case 'SHELF_UNIT':
    case 'OPEN_SHELF':
    case 'SHELVING': return 'SHELF_UNIT';
    default: return 'CABINET';
  }
}

// ── Нормализация (§1–§4) ─────────────────────────────────────────────────────

const positive = (v: number | undefined, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;

/**
 * Дочитать модель значениями по умолчанию. Функция чистая и идемпотентная:
 * toCabinetModel(toCabinetModel(m)) === toCabinetModel(m) по значению.
 */
export function toCabinetModel(model: ParametricModel): CabinetModel {
  const back = model.backPanel;
  const doors = model.doors;
  const drawers = model.drawers;
  return {
    ...model,
    cabinetType: model.cabinetType ?? cabinetTypeOfKind(model.kind),
    edge: model.edge ?? { ...DEFAULT_EDGE },
    backPanel: {
      ...back,
      grooveDepth: positive(back.grooveDepth, DEFAULT_GROOVE_DEPTH),
      grooveOffset: back.grooveOffset ?? DEFAULT_GROOVE_OFFSET,
    },
    shelves: { ...model.shelves, mode: model.shelves.mode ?? 'ADJUSTABLE' },
    doors: {
      ...doors,
      overlay: doors.overlay ?? 'FULL',
      kind: doors.kind ?? (doors.count === 1 ? 'single' : 'double'),
      handle: doors.handle ?? { ...DEFAULT_HANDLE },
    },
    drawers: {
      ...drawers,
      distribution: drawers.distribution ?? 'AUTO_EQUAL',
      positions: drawers.positions ?? [],
      sideThickness: positive(drawers.sideThickness, DEFAULT_DRAWER_SIDE_THICKNESS),
      bottomThickness: positive(drawers.bottomThickness, DEFAULT_DRAWER_BOTTOM_THICKNESS),
      slideLength: drawers.slideLength ?? 0,
      sideClearance: drawers.sideClearance ?? DEFAULT_DRAWER_SIDE_CLEARANCE,
      material: drawers.material ?? null,
    },
    legs: { ...model.legs, placement: model.legs.placement ?? 'CORNERS' },
    plinth: { ...model.plinth, thickness: positive(model.plinth.thickness, model.thickness) },
  };
}

/**
 * Создать модель корпуса заданного типа с типовыми габаритами (§90–§92).
 * Размеры можно переопределить — мастер создания так и делает.
 */
export function createCabinetModel(
  type: CabinetType,
  patch: Partial<ParametricModel> = {},
): CabinetModel {
  const info = cabinetTypeInfo(type);
  return toCabinetModel(createParametricModel({
    kind: info.kind,
    cabinetType: type,
    width: info.width,
    height: info.height,
    depth: info.depth,
    ...patch,
  }));
}

/** Сменить тип корпуса, сохранив все прочие параметры (§5). */
export function withCabinetType(model: ParametricModel, type: CabinetType): CabinetModel {
  return toCabinetModel({ ...model, cabinetType: type, kind: KIND_OF_CABINET_TYPE[type] });
}
