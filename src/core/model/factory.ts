/**
 * Фабрики объектов модели.
 *
 * Единая точка создания объектов со стабильными UUID и корректными
 * значениями по умолчанию. UI и store создают объекты только отсюда.
 */
import {
  newAssemblyId,
  newEdgeMaterialId,
  newFurnitureId,
  newHardwareId,
  newMaterialId,
  newPartId,
  newProjectId,
  newSheetMaterialId,
} from './ids';
import {
  PROJECT_FORMAT_VERSION,
  type Assembly,
  type EdgeMaterial,
  type Furniture,
  type CuttingSettings,
  type Hardware,
  type MachiningConstraints,
  type ManufacturingProfile,
  type Material,
  type MaterialKind,
  type Part,
  type PartRole,
  type Project,
  type ProjectSettings,
  type SheetMaterial,
} from './types';

export const DEFAULT_SETTINGS: ProjectSettings = {
  units: 'mm',
  displayUnits: 'mm',
  kerf: 4,
  sheetTrim: 10,
  costEnabled: false,
  locale: 'ru',
};

/** Производственный профиль по умолчанию (§54). */
export const DEFAULT_MANUFACTURING_PROFILE: ManufacturingProfile = {
  id: 'default',
  name: 'Базовый профиль',
  sawKerf: 3.2,
  minHoleEdgeDistance: 8,
  defaultDrillDepth: 12,
  defaultJointType: 'CONFIRMAT',
};

export const DEFAULT_MACHINING_CONSTRAINTS: MachiningConstraints = {
  minDiameter: 2,
  maxDepthRatio: 1, // глухое отверстие не глубже толщины детали
  minEdgeOffset: 8,
  minHoleSpacing: 16,
  allowedFaces: ['top', 'bottom', 'front', 'back', 'left', 'right'],
};

export const DEFAULT_CUTTING_SETTINGS: CuttingSettings = {
  respectGrain: true,
  attempts: 4,
  sortStrategy: 'area',
  minRemnant: 150,
  trim: { left: 10, right: 10, top: 10, bottom: 10 },
  sheetOverrides: {},
  locked: [],
  optimizationMode: 'BALANCED',
  algorithm: 'maxrects',
  usableRemnant: { minWidth: 100, minLength: 300, minArea: 60_000 },
  useRemnants: false,
  sheetSelection: {},
  sheetPriority: {},
  preferFewerSheets: true,
};

/** Полные настройки раскроя со значениями по умолчанию (для миграции). */
export function makeCuttingSettings(): CuttingSettings {
  return {
    ...DEFAULT_CUTTING_SETTINGS,
    trim: { ...DEFAULT_CUTTING_SETTINGS.trim },
    usableRemnant: { ...DEFAULT_CUTTING_SETTINGS.usableRemnant },
    sheetOverrides: {},
    sheetSelection: {},
    sheetPriority: {},
    locked: [],
  };
}

/** Встроенный минимальный каталог материалов (ЛДСП). */
export function createDefaultMaterial(): Material {
  return {
    id: newMaterialId(),
    name: 'ЛДСП 16 мм Белый',
    kind: 'ldsp',
    thickness: 16,
    sheet: { length: 2800, width: 2070 },
    density: 650,
    grain: 'none',
    allowRotate: true,
    color: '#f2f0ec',
  };
}

/** Встроенный материал задней стенки (ХДФ). */
export function createDefaultBackMaterial(): Material {
  return {
    id: newMaterialId(),
    name: 'ХДФ 3 мм Белый',
    kind: 'other',
    thickness: 3,
    sheet: { length: 2745, width: 1700 },
    density: 800,
    grain: 'none',
    allowRotate: true,
    color: '#e9e6df',
  };
}

/** Демонстрационный каталог листовых материалов (создаётся при новом проекте). */
export function createStandardMaterials(): Material[] {
  const mk = (
    name: string,
    kind: MaterialKind,
    thickness: number,
    sheet: { length: number; width: number },
    color: string,
    density: number,
  ): Material => ({
    id: newMaterialId(),
    name,
    kind,
    thickness,
    sheet,
    density,
    grain: 'none',
    allowRotate: true,
    kerf: 3.2,
    color,
  });
  return [
    mk('ЛДСП 16 мм Белый', 'ldsp', 16, { length: 2800, width: 2070 }, '#f2f0ec', 650),
    mk('ЛДСП 18 мм Белый', 'ldsp', 18, { length: 2800, width: 2070 }, '#eeeae2', 650),
    mk('ЛДСП 25 мм Белый', 'ldsp', 25, { length: 2800, width: 2070 }, '#e8e3da', 650),
    mk('МДФ 16 мм', 'mdf', 16, { length: 2800, width: 2070 }, '#d9c7a8', 750),
    mk('ХДФ 3 мм Белый', 'other', 3, { length: 2745, width: 1700 }, '#e9e6df', 800),
  ];
}

/**
 * Библиотека форматов листов по умолчанию — по одному формату на каждый
 * материал (габарит листа берётся из материала). availableQuantity=0 —
 * запас не ограничен.
 */
export function createDefaultSheets(materials: Material[]): SheetMaterial[] {
  return materials.map((m) => ({
    id: newSheetMaterialId(),
    materialId: m.id,
    name: `${m.name} · ${m.sheet.length}×${m.sheet.width}`,
    width: m.sheet.width,
    height: m.sheet.length,
    thickness: m.thickness,
    grainDirection: m.grain,
    availableQuantity: 0,
    source: 'library',
  }));
}

/** Встроенные варианты кромки (0.4 / 1 / 2 мм). */
export function createDefaultEdges(): EdgeMaterial[] {
  const mk = (thickness: number): EdgeMaterial => ({
    id: newEdgeMaterialId(),
    name: `Кромка ABS ${thickness} мм`,
    thickness,
    width: 23,
    color: '#f2f0ec',
  });
  return [mk(0.4), mk(1), mk(2)];
}

/** Демонстрационная фурнитура (конфирмат / шкант / полкодержатель). */
export function createDefaultHardware(): Hardware[] {
  return [
    {
      id: newHardwareId(),
      name: 'Конфирмат 7×50',
      category: 'confirmat',
      parameters: { diameter: 7, length: 50, headDiameter: 7 },
    },
    {
      id: newHardwareId(),
      name: 'Шкант 8×30',
      category: 'dowel',
      parameters: { diameter: 8, length: 30 },
    },
    {
      id: newHardwareId(),
      name: 'Полкодержатель Ø5',
      category: 'shelf-support',
      parameters: { diameter: 5 },
    },
    // Петля и ручка нужны, чтобы правила фасадов могли создать соединения
    // (§35): без крепежа нужной категории соединение не порождается.
    {
      id: newHardwareId(),
      name: 'Петля чашечная 35 мм',
      category: 'hinge',
      parameters: { cupDiameter: 35, cupDepth: 12.5, cupEdgeOffset: 22.5, screwDiameter: 2.5, count: 2, edgeOffset: 90 },
    },
    {
      id: newHardwareId(),
      name: 'Ручка 96 мм',
      category: 'handle',
      parameters: { centerDistance: 96, diameter: 5, edgeOffset: 40 },
    },
  ];
}

/** Заготовка нового материала для редактора. */
export function createBlankMaterial(): Material {
  return {
    id: newMaterialId(),
    name: 'Новый материал',
    kind: 'ldsp',
    thickness: 16,
    sheet: { length: 2750, width: 1830 },
    density: 650,
    grain: 'none',
    allowRotate: true,
    kerf: 3.2,
    color: '#d9c7a8',
  };
}

/** Заготовка новой кромки для редактора. */
export function createBlankEdge(): EdgeMaterial {
  return {
    id: newEdgeMaterialId(),
    name: 'Новая кромка',
    thickness: 1,
    width: 23,
    color: '#d9c7a8',
  };
}

/** Заготовка новой фурнитуры для редактора. */
export function createBlankHardware(): Hardware {
  return {
    id: newHardwareId(),
    name: 'Новый крепёж',
    category: 'confirmat',
    parameters: { diameter: 7, length: 50 },
  };
}

export interface CreatePartInput {
  name?: string;
  role?: PartRole;
  width?: number;
  height?: number;
  thickness?: number;
  material?: Part['material'];
  quantity?: number;
  position?: Partial<Part['position']>;
}

export function createPart(input: CreatePartInput = {}): Part {
  return {
    id: newPartId(),
    name: input.name ?? 'Деталь',
    role: input.role ?? 'custom',
    width: input.width ?? 800,
    height: input.height ?? 300,
    thickness: input.thickness ?? 16,
    material: input.material ?? null,
    grain: 'none',
    quantity: input.quantity ?? 1,
    edges: { left: null, right: null, top: null, bottom: null },
    position: {
      x: input.position?.x ?? 0,
      y: input.position?.y ?? 0,
      z: input.position?.z ?? 0,
    },
    rotation: { x: 0, y: 0, z: 0 },
    machining: [],
  };
}

export function createAssembly(name = 'Корпус'): Assembly {
  return { id: newAssemblyId(), name, parts: [] };
}

export function createFurniture(name = 'Изделие'): Furniture {
  return {
    id: newFurnitureId(),
    name,
    type: 'custom',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    assemblies: [createAssembly()],
  };
}

export interface CreateProjectInput {
  name?: string;
  withStarterContent?: boolean;
}

/**
 * Создать новый проект. По умолчанию добавляет один материал, одну кромку и
 * одно пустое изделие с одной сборкой — чтобы пользователь сразу мог работать.
 */
export function createProject(input: CreateProjectInput = {}): Project {
  const now = new Date().toISOString();
  const materials = createStandardMaterials();
  const edges = createDefaultEdges();
  const furniture = createFurniture('Изделие 1');

  return {
    version: PROJECT_FORMAT_VERSION,
    id: newProjectId(),
    name: input.name ?? 'Новый проект',
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_SETTINGS },
    materials,
    edges,
    hardware: createDefaultHardware(),
    hardwareConnections: [],
    machining: {
      constraints: { ...DEFAULT_MACHINING_CONSTRAINTS },
      overrides: {},
      profile: { ...DEFAULT_MANUFACTURING_PROFILE },
    },
    cutting: { settings: makeCuttingSettings() },
    sheets: createDefaultSheets(materials),
    remnants: [],
    documents: { settings: { scaleOverrides: {}, hidden: {} }, history: [] },
    furnitures: [furniture],
  };
}
