/**
 * Библиотека модулей (§99–§106).
 *
 * Хранение локальное, формат — JSON (§102). Импортируемый файл разбирается
 * как ДАННЫЕ: поле за полем, с отбрасыванием неизвестных ключей. Ничего не
 * вычисляется и не выполняется, поэтому повреждённый файл даёт понятную
 * ошибку, а не сбой.
 */
import { createParametricModel, type ParametricModel } from '@/core/parametric/types';
import {
  createModule,
  MODULE_SCHEMA_VERSION,
  type FurnitureModule,
} from './modules';

export const MODULE_LIBRARY_FORMAT = 'karkas-module-library';

export interface ModuleLibraryEntry {
  id: string;
  name: string;
  description?: string;
  module: FurnitureModule;
  savedAt: string; // ISO
  schemaVersion: number;
}

export interface ModuleLibraryFile {
  format: typeof MODULE_LIBRARY_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  modules: ModuleLibraryEntry[];
}

/** Сохранить модуль в библиотеку (§100). */
export function toLibraryEntry(module: FurnitureModule, name?: string, description?: string): ModuleLibraryEntry {
  return {
    id: `lib-${module.id}`,
    name: name ?? module.name,
    description,
    // Копия: дальнейшая правка модуля в проекте не меняет запись библиотеки.
    module: structuredClone(module),
    savedAt: new Date().toISOString(),
    schemaVersion: MODULE_SCHEMA_VERSION,
  };
}

/**
 * Загрузить модуль из библиотеки (§101). Идентификаторы новые: иначе копия
 * и оригинал делили бы один id и правка одного меняла бы другой.
 */
export function fromLibraryEntry(entry: ModuleLibraryEntry, name?: string): FurnitureModule {
  const source = migrateModule(entry.module, entry.schemaVersion);
  const rebuild = (m: FurnitureModule): FurnitureModule =>
    createModule({ ...structuredClone(m), id: undefined, children: m.children.map(rebuild) });
  const result = rebuild(source);
  result.name = name ?? entry.name;
  return result;
}

/**
 * Миграция записи старой версии (§106). Пока версия одна, поэтому функция
 * лишь проставляет недостающие поля — но точка расширения существует, и
 * новая версия не потребует менять вызывающий код.
 */
export function migrateModule(module: FurnitureModule, fromVersion = 0): FurnitureModule {
  if (fromVersion >= MODULE_SCHEMA_VERSION) return module;
  return createModule({ ...module, schemaVersion: MODULE_SCHEMA_VERSION });
}

// ── Импорт и экспорт (§103/§104) ─────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Разобрать параметрическую модель из данных файла. */
function readParameters(raw: unknown): ParametricModel {
  const base = createParametricModel();
  if (!isRecord(raw)) return base;
  const patch: Partial<ParametricModel> = {};
  for (const key of ['width', 'height', 'depth', 'thickness'] as const) {
    const value = num(raw[key]);
    if (value != null && value > 0) patch[key] = value;
  }
  if (typeof raw.kind === 'string') patch.kind = raw.kind as ParametricModel['kind'];
  // Вложенные настройки берутся целиком, но только если это объекты.
  for (const key of ['shelves', 'doors', 'drawers', 'backPanel', 'partitions', 'legs', 'plinth'] as const) {
    if (isRecord(raw[key])) {
      patch[key] = { ...base[key], ...(raw[key] as object) } as never;
    }
  }
  return createParametricModel(patch);
}

/** Разобрать один модуль. Возвращает null, если запись непригодна. */
export function readModule(raw: unknown): FurnitureModule | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : undefined;
  if (!name) return null; // модуль без названия бесполезен в библиотеке
  const children = Array.isArray(raw.children)
    ? raw.children.map(readModule).filter((m): m is FurnitureModule => m !== null)
    : [];
  return createModule({
    name,
    type: typeof raw.type === 'string' ? (raw.type as FurnitureModule['type']) : 'CABINET',
    parameters: readParameters(raw.parameters),
    children,
    visible: raw.visible !== false,
    locked: raw.locked === true,
  });
}

export interface ModuleImportResult {
  ok: boolean;
  entries: ModuleLibraryEntry[];
  skipped: number;
  error?: string;
}

/** Импорт module.json (§103). */
export function importModuleLibrary(json: string): ModuleImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, entries: [], skipped: 0, error: 'Файл не является корректным JSON.' };
  }
  if (!isRecord(parsed)) {
    return { ok: false, entries: [], skipped: 0, error: 'Ожидался объект библиотеки модулей.' };
  }
  if (parsed.format !== undefined && parsed.format !== MODULE_LIBRARY_FORMAT) {
    return { ok: false, entries: [], skipped: 0, error: 'Файл не является библиотекой модулей Karkas.' };
  }

  const raw = Array.isArray(parsed.modules) ? parsed.modules : [];
  const entries: ModuleLibraryEntry[] = [];
  let skipped = 0;
  for (const item of raw) {
    if (!isRecord(item)) { skipped += 1; continue; }
    // Запись может быть как элементом библиотеки, так и самим модулем.
    const module = readModule(isRecord(item.module) ? item.module : item);
    if (!module) { skipped += 1; continue; }
    entries.push({
      id: typeof item.id === 'string' ? item.id : `lib-${module.id}`,
      name: typeof item.name === 'string' ? item.name : module.name,
      description: typeof item.description === 'string' ? item.description : undefined,
      module,
      savedAt: typeof item.savedAt === 'string' ? item.savedAt : new Date().toISOString(),
      schemaVersion: num(item.schemaVersion) ?? MODULE_SCHEMA_VERSION,
    });
  }
  return { ok: true, entries, skipped };
}

/** Экспорт библиотеки модулей (§104) — целиком локально, без сети. */
export function exportModuleLibrary(entries: ModuleLibraryEntry[]): string {
  const file: ModuleLibraryFile = {
    format: MODULE_LIBRARY_FORMAT,
    schemaVersion: MODULE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    modules: entries,
  };
  return JSON.stringify(file, null, 2);
}

/** Экспорт одного модуля (§104). */
export function exportModule(module: FurnitureModule): string {
  return exportModuleLibrary([toLibraryEntry(module)]);
}
