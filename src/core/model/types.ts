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

/** Технологическая операция присадки. Координаты — в плоскости детали. */
export interface MachiningOperation {
  id: MachiningId;
  type: string; // ключ в реестре операций: 'hole' | 'confirmat' | 'hinge' | ...
  x: Mm;
  y: Mm;
  z?: Mm;
  diameter?: Mm;
  depth?: Mm;
  angle?: number;
  side: EdgeSide | 'front' | 'back';
  through?: boolean;
  params?: Record<string, number | string | boolean>;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Фурнитура
// ─────────────────────────────────────────────────────────────────────────────

export type HardwareCategory =
  | 'hinge'
  | 'slide'
  | 'leg'
  | 'handle'
  | 'connector'
  | 'shelf-support'
  | 'rod'
  | 'other';

export interface Hardware {
  id: HardwareId;
  name: string;
  category: HardwareCategory;
  quantity: number;
  cost?: { perUnit?: number; currency?: string };
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

/** Изделие (шкаф, тумба, стол, произвольное). */
export interface Furniture {
  id: FurnitureId;
  name: string;
  type: string; // ключ типа изделия ('custom' в этом каркасе)
  position: Vec3;
  rotation: Rotation;
  assemblies: Assembly[];
  /** Параметры типа изделия (используются параметрическим движком позже). */
  params?: Record<string, number | string | boolean>;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Раскрой (типы данных; алгоритм — в engines/cutting)
// ─────────────────────────────────────────────────────────────────────────────

export interface CuttingPiece {
  pieceId: string;
  partId: PartId;
  length: Mm;
  width: Mm;
  grain: GrainDirection;
  allowRotate: boolean;
  materialId: MaterialId;
}

export interface CuttingSheet {
  materialId: MaterialId;
  index: number;
  length: Mm;
  width: Mm;
  placements: Array<{
    pieceId: string;
    partId: PartId;
    x: Mm;
    y: Mm;
    length: Mm;
    width: Mm;
    rotated: boolean;
  }>;
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
  furnitures: Furniture[];
  metadata?: Record<string, unknown>;
}
