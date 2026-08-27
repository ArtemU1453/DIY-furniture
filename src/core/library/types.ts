/**
 * Глобальная библиотека: материалы, форматы листов, кромка, фурнитура и
 * производственные профили (§1).
 *
 *   ГЛОБАЛЬНАЯ БИБЛИОТЕКА (localStorage)  ──копия──►  ПРОЕКТ (ProjectModel)
 *
 * Библиотека и проект используют ОДНИ И ТЕ ЖЕ типы Material / EdgeMaterial /
 * Hardware — параллельной модели данных не заводится (§6 правил). Разница
 * только в месте хранения и в том, что у библиотечной записи есть revision:
 * проект держит собственную копию, поэтому правка библиотеки не меняет уже
 * сохранённый проект (§61).
 */
import type {
  EdgeMaterial,
  Hardware,
  ManufacturingProfile,
  Material,
  MaterialCategory,
  MaterialKind,
  Mm,
} from '@/core/model/types';

/** Текущая версия схемы библиотеки (§57). */
export const LIBRARY_SCHEMA_VERSION = 2;

/**
 * Формат листа материала (§5/§6). Один материал может иметь несколько
 * форматов, поэтому формат — отдельная запись со ссылкой на материал, а не
 * строка внутри материала.
 */
export interface SheetFormat {
  id: string;
  materialId: string;
  length: Mm;
  width: Mm;
  /** Приоритет подбора при раскрое: меньше — раньше. */
  priority: number;
  active: boolean;
}

/** Что именно хранит библиотека. Каждый раздел — плоский список. */
export interface LibraryModel {
  schemaVersion: number;
  materials: LibraryEntry<Material>[];
  sheetFormats: SheetFormat[];
  edges: LibraryEntry<EdgeMaterial>[];
  hardware: LibraryEntry<Hardware>[];
  profiles: LibraryEntry<ManufacturingProfile>[];
  updatedAt: string;
}

/**
 * Запись библиотеки: сам объект плюс служебные поля версионирования.
 * revision растёт при каждом изменении — по нему проект понимает, что в
 * библиотеке появилась более свежая версия (§62).
 */
export interface LibraryEntry<T> {
  revision: number;
  updatedAt: string;
  /** Встроенная в поставку запись: её нельзя удалить, только архивировать. */
  builtin?: boolean;
  value: T;
}

export type LibrarySection = 'materials' | 'edges' | 'hardware' | 'profiles';

// ── Соответствие категории и технического kind ───────────────────────────────
// Одно и то же деление в двух шкалах; отображение однозначно в обе стороны.

const KIND_TO_CATEGORY: Record<MaterialKind, MaterialCategory> = {
  ldsp: 'LDSP',
  mdf: 'MDF',
  plywood: 'PLYWOOD',
  solid: 'SOLID_WOOD',
  'edge-glued': 'SOLID_WOOD',
  hdf: 'HDF',
  glass: 'OTHER',
  other: 'OTHER',
};

const CATEGORY_TO_KIND: Record<MaterialCategory, MaterialKind> = {
  LDSP: 'ldsp',
  MDF: 'mdf',
  PLYWOOD: 'plywood',
  SOLID_WOOD: 'solid',
  HDF: 'hdf',
  OTHER: 'other',
};

export const MATERIAL_CATEGORIES: MaterialCategory[] =
  ['LDSP', 'MDF', 'PLYWOOD', 'SOLID_WOOD', 'HDF', 'OTHER'];

export function categoryOfKind(kind: MaterialKind): MaterialCategory {
  return KIND_TO_CATEGORY[kind] ?? 'OTHER';
}

export function kindOfCategory(category: MaterialCategory): MaterialKind {
  return CATEGORY_TO_KIND[category] ?? 'other';
}

/** Категория материала: явная, либо выведенная из kind. */
export function materialCategory(m: Material): MaterialCategory {
  return m.category ?? categoryOfKind(m.kind);
}

// ── Текстура (§7) ────────────────────────────────────────────────────────────
// В модели детали текстура задаётся относительно заготовки ('length'/'width'),
// а пользователю показывается как направление на листе.

export type GrainOption = 'NONE' | 'HORIZONTAL' | 'VERTICAL';

export const GRAIN_OPTIONS: GrainOption[] = ['NONE', 'HORIZONTAL', 'VERTICAL'];

export const GRAIN_OPTION_LABELS: Record<GrainOption, string> = {
  NONE: 'Без текстуры',
  HORIZONTAL: 'Горизонтальная',
  VERTICAL: 'Вертикальная',
};

/** 'length' — вдоль длинной стороны листа, значит горизонтальная. */
export function grainOptionOf(grain: Material['grain']): GrainOption {
  if (grain === 'none') return 'NONE';
  return grain === 'length' ? 'HORIZONTAL' : 'VERTICAL';
}

export function grainOfOption(option: GrainOption): Material['grain'] {
  if (option === 'NONE') return 'none';
  return option === 'HORIZONTAL' ? 'length' : 'width';
}
