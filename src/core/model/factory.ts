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
  newMaterialId,
  newPartId,
  newProjectId,
} from './ids';
import {
  PROJECT_FORMAT_VERSION,
  type Assembly,
  type EdgeMaterial,
  type Furniture,
  type Material,
  type Part,
  type PartRole,
  type Project,
  type ProjectSettings,
} from './types';

export const DEFAULT_SETTINGS: ProjectSettings = {
  units: 'mm',
  displayUnits: 'mm',
  kerf: 4,
  sheetTrim: 10,
  costEnabled: false,
  locale: 'ru',
};

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

/** Встроенные варианты кромки (0.4 / 1 / 2 мм). */
export function createDefaultEdges(): EdgeMaterial[] {
  const mk = (thickness: number): EdgeMaterial => ({
    id: newEdgeMaterialId(),
    name: `Кромка ПВХ ${thickness} мм`,
    thickness,
    width: 23,
    color: '#f2f0ec',
  });
  return [mk(0.4), mk(1), mk(2)];
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
  const material = createDefaultMaterial();
  const backMaterial = createDefaultBackMaterial();
  const edges = createDefaultEdges();
  const furniture = createFurniture('Изделие 1');

  return {
    version: PROJECT_FORMAT_VERSION,
    id: newProjectId(),
    name: input.name ?? 'Новый проект',
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_SETTINGS },
    materials: [material, backMaterial],
    edges,
    hardware: [],
    furnitures: [furniture],
  };
}
