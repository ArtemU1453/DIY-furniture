/**
 * Стартовое наполнение библиотеки (§64/§65).
 *
 * Это обычные листовые материалы и типовой крепёж, которые есть в любой
 * мастерской. Производители и артикулы НЕ выдумываются (§66): поля
 * manufacturer/code/article остаются пустыми, пока пользователь не заполнит
 * их сам. Никаких реальных брендов в поставке нет.
 */
import type {
  EdgeMaterial,
  Hardware,
  ManufacturingProfile,
  Material,
} from '@/core/model/types';
import { LIBRARY_SCHEMA_VERSION, type LibraryEntry, type LibraryModel, type SheetFormat } from './types';

const now = () => new Date().toISOString();

function entry<T>(value: T, builtin = true): LibraryEntry<T> {
  return { revision: 1, updatedAt: now(), builtin, value };
}

/** Стабильные id встроенных записей — чтобы ссылки проекта не «плыли». */
export const PRESET_IDS = {
  ldsp16: 'lib-mat-ldsp-16',
  ldsp18: 'lib-mat-ldsp-18',
  mdf16: 'lib-mat-mdf-16',
  mdf18: 'lib-mat-mdf-18',
  plywood18: 'lib-mat-plywood-18',
  hdf3: 'lib-mat-hdf-3',
  edge04: 'lib-edge-04',
  edge1: 'lib-edge-1',
  edge2: 'lib-edge-2',
  confirmat: 'lib-hw-confirmat-7x50',
  dowel: 'lib-hw-dowel-8x30',
  minifix: 'lib-hw-minifix',
  hinge: 'lib-hw-hinge-35',
  handle: 'lib-hw-handle-96',
  profileDefault: 'profile-default',
  profileWorkshop: 'profile-workshop',
} as const;

function material(
  id: string,
  name: string,
  kind: Material['kind'],
  category: Material['category'],
  thickness: number,
  sheet: { length: number; width: number },
  color: string,
  density: number,
): Material {
  return {
    id: id as Material['id'],
    name,
    kind,
    category,
    thickness,
    sheet,
    density,
    grain: 'none',
    allowRotate: true,
    kerf: 3.2,
    color,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
  };
}

export const PRESET_MATERIALS: Material[] = [
  material(PRESET_IDS.ldsp16, 'ЛДСП 16 мм', 'ldsp', 'LDSP', 16, { length: 2750, width: 1830 }, '#d9c7a8', 650),
  material(PRESET_IDS.ldsp18, 'ЛДСП 18 мм', 'ldsp', 'LDSP', 18, { length: 2750, width: 1830 }, '#d3bfa0', 650),
  material(PRESET_IDS.mdf16, 'МДФ 16 мм', 'mdf', 'MDF', 16, { length: 2800, width: 2070 }, '#c9a884', 750),
  material(PRESET_IDS.mdf18, 'МДФ 18 мм', 'mdf', 'MDF', 18, { length: 2800, width: 2070 }, '#c2a07c', 750),
  material(PRESET_IDS.plywood18, 'Фанера 18 мм', 'plywood', 'PLYWOOD', 18, { length: 2440, width: 1220 }, '#e0cba4', 700),
  material(PRESET_IDS.hdf3, 'ХДФ 3 мм', 'hdf', 'HDF', 3, { length: 2800, width: 2070 }, '#e8dcc6', 850),
];

/**
 * Форматы листов (§5/§6). Один материал — несколько форматов с приоритетом:
 * раскрой сначала пробует формат с меньшим priority.
 */
export const PRESET_SHEET_FORMATS: SheetFormat[] = [
  { id: 'fmt-ldsp16-2750', materialId: PRESET_IDS.ldsp16, length: 2750, width: 1830, priority: 1, active: true },
  { id: 'fmt-ldsp16-2800', materialId: PRESET_IDS.ldsp16, length: 2800, width: 2070, priority: 2, active: true },
  { id: 'fmt-ldsp18-2750', materialId: PRESET_IDS.ldsp18, length: 2750, width: 1830, priority: 1, active: true },
  { id: 'fmt-mdf16-2800', materialId: PRESET_IDS.mdf16, length: 2800, width: 2070, priority: 1, active: true },
  { id: 'fmt-mdf18-2800', materialId: PRESET_IDS.mdf18, length: 2800, width: 2070, priority: 1, active: true },
  { id: 'fmt-plywood18-2440', materialId: PRESET_IDS.plywood18, length: 2440, width: 1220, priority: 1, active: true },
  { id: 'fmt-hdf3-2800', materialId: PRESET_IDS.hdf3, length: 2800, width: 2070, priority: 1, active: true },
];

function edge(id: string, thickness: number, color: string): EdgeMaterial {
  return {
    id: id as EdgeMaterial['id'],
    name: `Кромка ABS ${thickness} мм`,
    thickness,
    width: 23,
    color,
    material: 'ABS',
    // manufacturer и code не заполняем — они неизвестны (§66).
    schemaVersion: LIBRARY_SCHEMA_VERSION,
  };
}

export const PRESET_EDGES: EdgeMaterial[] = [
  edge(PRESET_IDS.edge04, 0.4, '#f2f0ec'),
  edge(PRESET_IDS.edge1, 1, '#f2f0ec'),
  edge(PRESET_IDS.edge2, 2, '#f2f0ec'),
];

/**
 * Типовой крепёж с правилами присадки (§65). Параметры соответствуют тем, что
 * уже понимают правила присадки этапа 09/15 — поэтому существующая генерация
 * работает без изменений.
 */
export const PRESET_HARDWARE: Hardware[] = [
  {
    id: PRESET_IDS.confirmat as Hardware['id'],
    name: 'Конфирмат 7×50',
    category: 'confirmat',
    parameters: { diameter: 7, length: 50, headDiameter: 7, pilotDiameter: 5, count: 2, edgeOffset: 32 },
    machiningRules: [
      {
        id: 'rule-confirmat-through', operation: 'confirmat', target: 'through',
        diameter: 7, through: true, count: 2, edgeOffset: 32,
        constraints: { minThickness: 15 },
      },
      {
        id: 'rule-confirmat-receiving', operation: 'confirmat', target: 'receiving',
        diameter: 5, depth: 50, count: 2, edgeOffset: 32,
        constraints: { minThickness: 15 },
      },
    ],
    schemaVersion: LIBRARY_SCHEMA_VERSION,
  },
  {
    id: PRESET_IDS.dowel as Hardware['id'],
    name: 'Шкант 8×30',
    category: 'dowel',
    parameters: { diameter: 8, length: 30, count: 2, edgeOffset: 50 },
    machiningRules: [
      { id: 'rule-dowel-a', operation: 'dowel', target: 'both', diameter: 8, depth: 15, count: 2, edgeOffset: 50 },
    ],
    schemaVersion: LIBRARY_SCHEMA_VERSION,
  },
  {
    id: PRESET_IDS.minifix as Hardware['id'],
    name: 'Минификс Ø15',
    category: 'minifix',
    parameters: { camDiameter: 15, camDepth: 12.5, rodDiameter: 8, rodDepth: 34, count: 2, edgeOffset: 32 },
    machiningRules: [
      { id: 'rule-minifix-cam', operation: 'boring', target: 'through', diameter: 15, depth: 12.5, count: 2, edgeOffset: 32 },
      { id: 'rule-minifix-rod', operation: 'dowel', target: 'receiving', diameter: 8, depth: 34, count: 2, edgeOffset: 32 },
    ],
    schemaVersion: LIBRARY_SCHEMA_VERSION,
  },
  {
    id: PRESET_IDS.hinge as Hardware['id'],
    name: 'Петля чашечная 35 мм',
    category: 'hinge',
    parameters: { cupDiameter: 35, cupDepth: 12.5, cupEdgeOffset: 22.5, screwDiameter: 2.5, count: 2, edgeOffset: 90 },
    machiningRules: [
      { id: 'rule-hinge-cup', operation: 'hinge', target: 'through', diameter: 35, depth: 12.5, count: 2, edgeOffset: 90 },
    ],
    schemaVersion: LIBRARY_SCHEMA_VERSION,
  },
  {
    id: PRESET_IDS.handle as Hardware['id'],
    name: 'Ручка 96 мм',
    category: 'handle',
    parameters: { centerDistance: 96, diameter: 5, edgeOffset: 40 },
    machiningRules: [
      { id: 'rule-handle', operation: 'drilling', target: 'through', diameter: 5, through: true, count: 2, edgeOffset: 40 },
    ],
    schemaVersion: LIBRARY_SCHEMA_VERSION,
  },
];

/** Профиль по умолчанию (§18). */
export const DEFAULT_PROFILE: ManufacturingProfile = {
  id: PRESET_IDS.profileDefault,
  name: 'Базовый профиль',
  sawKerf: 3.2,
  trimAllowance: 10,
  minimumRemnant: 100,
  minHoleEdgeDistance: 8,
  defaultDrillDepth: 12,
  defaultJointType: 'CONFIRMAT',
  schemaVersion: LIBRARY_SCHEMA_VERSION,
};

/** Пример пользовательского профиля (§19) — домашняя мастерская. */
export const WORKSHOP_PROFILE: ManufacturingProfile = {
  id: PRESET_IDS.profileWorkshop,
  name: 'Домашняя мастерская',
  sawKerf: 2,
  trimAllowance: 5,
  minimumRemnant: 150,
  minHoleEdgeDistance: 10,
  defaultDrillDepth: 10,
  defaultJointType: 'DOWEL',
  schemaVersion: LIBRARY_SCHEMA_VERSION,
};

/** Библиотека «из коробки». */
export function createDefaultLibrary(): LibraryModel {
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    materials: PRESET_MATERIALS.map((m) => entry(m)),
    sheetFormats: PRESET_SHEET_FORMATS.map((f) => ({ ...f })),
    edges: PRESET_EDGES.map((e) => entry(e)),
    hardware: PRESET_HARDWARE.map((h) => entry(h)),
    profiles: [entry(DEFAULT_PROFILE), entry(WORKSHOP_PROFILE)],
    updatedAt: now(),
  };
}

/** Пустая библиотека — для импорта «с нуля». */
export function createEmptyLibrary(): LibraryModel {
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    materials: [], sheetFormats: [], edges: [], hardware: [], profiles: [],
    updatedAt: now(),
  };
}
