/**
 * Импорт и экспорт библиотеки в JSON (§53–§56) с защитой от повреждённых
 * данных (§78).
 *
 * Невалидный файл НИКОГДА не должен ломать приложение и не должен затирать
 * рабочую библиотеку: разбор возвращает результат с ошибками, а вызывающий код
 * сам решает, применять ли импорт. Неизвестные enum, отсутствующие
 * обязательные поля и неверные типы отсеиваются на уровне записи — одна
 * битая позиция не отменяет весь файл.
 */
import type {
  EdgeMaterial,
  Hardware,
  HardwareRule,
  ManufacturingProfile,
  Material,
} from '@/core/model/types';
import { migrateLibrary, type MigrationResult } from './migration';
import {
  LIBRARY_SCHEMA_VERSION,
  MATERIAL_CATEGORIES,
  categoryOfKind,
  type LibraryEntry,
  type LibraryModel,
  type SheetFormat,
} from './types';
import { createEmptyLibrary } from './presets';

export class LibraryParseError extends Error {}

export interface ImportIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ImportResult {
  ok: boolean;
  library: LibraryModel;
  issues: ImportIssue[];
  migration?: MigrationResult;
  counts: { materials: number; edges: number; hardware: number; profiles: number; sheetFormats: number };
}

const MATERIAL_KINDS = new Set([
  'ldsp', 'mdf', 'plywood', 'edge-glued', 'solid', 'hdf', 'glass', 'other',
]);
const HARDWARE_CATEGORIES = new Set([
  'confirmat', 'minifix', 'dowel', 'shelf-support', 'hinge', 'slide',
  'connector', 'corner', 'screw', 'leg', 'handle', 'other',
]);
const GRAINS = new Set(['length', 'width', 'none']);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPos = (v: unknown): v is number => isNum(v) && v > 0;

/** Развернуть запись библиотеки: и обёрнутый, и «голый» объект. */
function unwrap(raw: unknown): { rec: Record<string, unknown>; meta: Partial<LibraryEntry<unknown>> } | null {
  if (!isObj(raw)) return null;
  if (isObj(raw.value)) {
    return {
      rec: raw.value,
      meta: {
        revision: isNum(raw.revision) ? raw.revision : 1,
        updatedAt: isStr(raw.updatedAt) ? raw.updatedAt : new Date().toISOString(),
        builtin: raw.builtin === true,
      },
    };
  }
  return { rec: raw, meta: { revision: 1, updatedAt: new Date().toISOString(), builtin: false } };
}

function wrap<T>(value: T, meta: Partial<LibraryEntry<unknown>>): LibraryEntry<T> {
  return {
    revision: meta.revision ?? 1,
    updatedAt: meta.updatedAt ?? new Date().toISOString(),
    builtin: meta.builtin ?? false,
    value,
  };
}

function parseMaterial(raw: unknown, issues: ImportIssue[], index: number): LibraryEntry<Material> | null {
  const un = unwrap(raw);
  if (!un) {
    issues.push({ severity: 'error', code: 'lib.material.shape', message: `Материал #${index + 1}: запись не является объектом.` });
    return null;
  }
  const r = un.rec;
  if (!isStr(r.id) || !isStr(r.name)) {
    issues.push({ severity: 'error', code: 'lib.material.required', message: `Материал #${index + 1}: отсутствует id или name.` });
    return null;
  }
  if (!isPos(r.thickness)) {
    issues.push({ severity: 'error', code: 'lib.material.thickness', message: `Материал «${r.name}»: некорректная толщина.` });
    return null;
  }
  const sheet = isObj(r.sheet) ? r.sheet : null;
  if (!sheet || !isPos(sheet.length) || !isPos(sheet.width)) {
    issues.push({ severity: 'error', code: 'lib.material.sheet', message: `Материал «${r.name}»: некорректный формат листа.` });
    return null;
  }
  // Неизвестный enum не роняет импорт — заменяем на безопасное значение.
  let kind = r.kind as Material['kind'];
  if (!isStr(r.kind) || !MATERIAL_KINDS.has(r.kind)) {
    issues.push({ severity: 'warning', code: 'lib.material.kind', message: `Материал «${r.name}»: неизвестный вид «${String(r.kind)}» заменён на «other».` });
    kind = 'other';
  }
  let grain = r.grain as Material['grain'];
  if (!isStr(r.grain) || !GRAINS.has(r.grain)) grain = 'none';
  let category = r.category as Material['category'];
  if (category !== undefined && !MATERIAL_CATEGORIES.includes(category)) {
    issues.push({ severity: 'warning', code: 'lib.material.category', message: `Материал «${r.name}»: неизвестная категория заменена по виду материала.` });
    category = undefined;
  }

  const value: Material = {
    id: r.id as Material['id'],
    name: r.name,
    kind,
    category: category ?? categoryOfKind(kind),
    thickness: r.thickness,
    sheet: { length: sheet.length, width: sheet.width },
    density: isPos(r.density) ? r.density : undefined,
    grain,
    allowRotate: r.allowRotate !== false,
    kerf: isPos(r.kerf) ? r.kerf : undefined,
    color: isStr(r.color) ? r.color : '#d9c7a8',
    edgeCompatibility: Array.isArray(r.edgeCompatibility)
      ? (r.edgeCompatibility.filter(isStr) as Material['edgeCompatibility'])
      : undefined,
    archived: r.archived === true,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    metadata: isObj(r.metadata) ? r.metadata : undefined,
  };
  return wrap(value, un.meta);
}

function parseEdge(raw: unknown, issues: ImportIssue[], index: number): LibraryEntry<EdgeMaterial> | null {
  const un = unwrap(raw);
  if (!un) {
    issues.push({ severity: 'error', code: 'lib.edge.shape', message: `Кромка #${index + 1}: запись не является объектом.` });
    return null;
  }
  const r = un.rec;
  if (!isStr(r.id) || !isStr(r.name)) {
    issues.push({ severity: 'error', code: 'lib.edge.required', message: `Кромка #${index + 1}: отсутствует id или name.` });
    return null;
  }
  if (!isPos(r.thickness)) {
    issues.push({ severity: 'error', code: 'lib.edge.thickness', message: `Кромка «${r.name}»: некорректная толщина.` });
    return null;
  }
  const value: EdgeMaterial = {
    id: r.id as EdgeMaterial['id'],
    name: r.name,
    thickness: r.thickness,
    width: isPos(r.width) ? r.width : undefined,
    color: isStr(r.color) ? r.color : '#f2f0ec',
    material: isStr(r.material) ? r.material : undefined,
    manufacturer: isStr(r.manufacturer) ? r.manufacturer : undefined,
    code: isStr(r.code) ? r.code : undefined,
    archived: r.archived === true,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    metadata: isObj(r.metadata) ? r.metadata : undefined,
  };
  return wrap(value, un.meta);
}

function parseHardware(raw: unknown, issues: ImportIssue[], index: number): LibraryEntry<Hardware> | null {
  const un = unwrap(raw);
  if (!un) {
    issues.push({ severity: 'error', code: 'lib.hardware.shape', message: `Фурнитура #${index + 1}: запись не является объектом.` });
    return null;
  }
  const r = un.rec;
  if (!isStr(r.id) || !isStr(r.name)) {
    issues.push({ severity: 'error', code: 'lib.hardware.required', message: `Фурнитура #${index + 1}: отсутствует id или name.` });
    return null;
  }
  let category = r.category as Hardware['category'];
  if (!isStr(r.category) || !HARDWARE_CATEGORIES.has(r.category)) {
    issues.push({ severity: 'warning', code: 'lib.hardware.category', message: `Фурнитура «${r.name}»: неизвестная категория «${String(r.category)}» заменена на «other».` });
    category = 'other';
  }
  // Параметры принимаем только примитивных типов.
  const parameters: Record<string, number | string | boolean> = {};
  if (isObj(r.parameters)) {
    for (const [k, v] of Object.entries(r.parameters)) {
      if (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' || typeof v === 'boolean') {
        parameters[k] = v as number | string | boolean;
      }
    }
  }
  const rules = Array.isArray(r.machiningRules)
    ? r.machiningRules.filter((x): x is HardwareRule => {
        if (!isObj(x)) return false;
        return isStr(x.id) && isStr(x.operation) && isPos(x.diameter);
      })
    : undefined;

  const value: Hardware = {
    id: r.id as Hardware['id'],
    name: r.name,
    category,
    manufacturer: isStr(r.manufacturer) ? r.manufacturer : undefined,
    model: isStr(r.model) ? r.model : undefined,
    article: isStr(r.article) ? r.article : undefined,
    parameters,
    machiningRules: rules && rules.length > 0 ? rules : undefined,
    archived: r.archived === true,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    metadata: isObj(r.metadata) ? r.metadata : undefined,
  };
  return wrap(value, un.meta);
}

function parseProfile(raw: unknown, issues: ImportIssue[], index: number): LibraryEntry<ManufacturingProfile> | null {
  const un = unwrap(raw);
  if (!un) {
    issues.push({ severity: 'error', code: 'lib.profile.shape', message: `Профиль #${index + 1}: запись не является объектом.` });
    return null;
  }
  const r = un.rec;
  if (!isStr(r.id) || !isStr(r.name)) {
    issues.push({ severity: 'error', code: 'lib.profile.required', message: `Профиль #${index + 1}: отсутствует id или name.` });
    return null;
  }
  const value: ManufacturingProfile = {
    id: r.id,
    name: r.name,
    sawKerf: isPos(r.sawKerf) ? r.sawKerf : 3.2,
    trimAllowance: isNum(r.trimAllowance) && r.trimAllowance >= 0 ? r.trimAllowance : 10,
    minimumRemnant: isNum(r.minimumRemnant) && r.minimumRemnant >= 0 ? r.minimumRemnant : 100,
    minHoleEdgeDistance: isPos(r.minHoleEdgeDistance) ? r.minHoleEdgeDistance : 8,
    defaultDrillDepth: isPos(r.defaultDrillDepth) ? r.defaultDrillDepth : 12,
    defaultJointType: isStr(r.defaultJointType)
      ? (r.defaultJointType as ManufacturingProfile['defaultJointType'])
      : 'CONFIRMAT',
    archived: r.archived === true,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
  };
  return wrap(value, un.meta);
}

function parseSheetFormat(raw: unknown, issues: ImportIssue[], index: number): SheetFormat | null {
  if (!isObj(raw)) {
    issues.push({ severity: 'error', code: 'lib.format.shape', message: `Формат листа #${index + 1}: запись не является объектом.` });
    return null;
  }
  if (!isStr(raw.id) || !isStr(raw.materialId) || !isPos(raw.length) || !isPos(raw.width)) {
    issues.push({ severity: 'error', code: 'lib.format.required', message: `Формат листа #${index + 1}: некорректные поля.` });
    return null;
  }
  return {
    id: raw.id,
    materialId: raw.materialId,
    length: raw.length,
    width: raw.width,
    priority: isNum(raw.priority) ? raw.priority : 1,
    active: raw.active !== false,
  };
}

/** Библиотека → строка JSON (§54). */
export function serializeLibrary(library: LibraryModel): string {
  return JSON.stringify({ ...library, schemaVersion: LIBRARY_SCHEMA_VERSION }, null, 2);
}

/**
 * Строка JSON → библиотека (§53/§56/§78). Никогда не бросает исключение на
 * повреждённых данных — возвращает ok: false и список проблем.
 */
export function parseLibrary(json: string): ImportResult {
  const empty = createEmptyLibrary();
  const issues: ImportIssue[] = [];

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    issues.push({ severity: 'error', code: 'lib.json', message: `Файл не является корректным JSON: ${e instanceof Error ? e.message : String(e)}` });
    return { ok: false, library: empty, issues, counts: zeroCounts() };
  }

  if (!isObj(raw)) {
    issues.push({ severity: 'error', code: 'lib.root', message: 'Корень файла должен быть объектом библиотеки.' });
    return { ok: false, library: empty, issues, counts: zeroCounts() };
  }

  // Версия новее текущей: мигрировать «вперёд» мы не умеем.
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  if (version > LIBRARY_SCHEMA_VERSION) {
    issues.push({
      severity: 'error', code: 'lib.version',
      message: `Файл создан более новой версией библиотеки (v${version}); поддерживается до v${LIBRARY_SCHEMA_VERSION}.`,
    });
    return { ok: false, library: empty, issues, counts: zeroCounts() };
  }

  const migration = migrateLibrary(raw);
  const src = migration.library as unknown as Record<string, unknown>;

  const materials = asArray(src.materials).map((m, i) => parseMaterial(m, issues, i)).filter(nonNull);
  const edges = asArray(src.edges).map((e, i) => parseEdge(e, issues, i)).filter(nonNull);
  const hardware = asArray(src.hardware).map((h, i) => parseHardware(h, issues, i)).filter(nonNull);
  const profiles = asArray(src.profiles).map((p, i) => parseProfile(p, issues, i)).filter(nonNull);
  const sheetFormats = asArray(src.sheetFormats).map((f, i) => parseSheetFormat(f, issues, i)).filter(nonNull);

  const library: LibraryModel = {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    materials, edges, hardware, profiles, sheetFormats,
    updatedAt: new Date().toISOString(),
  };

  const total = materials.length + edges.length + hardware.length + profiles.length;
  if (total === 0) {
    issues.push({ severity: 'error', code: 'lib.empty', message: 'В файле нет ни одной корректной записи библиотеки.' });
  }

  return {
    ok: total > 0,
    library,
    issues,
    migration: migration.steps.length > 0 ? migration : undefined,
    counts: {
      materials: materials.length, edges: edges.length, hardware: hardware.length,
      profiles: profiles.length, sheetFormats: sheetFormats.length,
    },
  };
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function nonNull<T>(v: T | null): v is T {
  return v !== null;
}
function zeroCounts() {
  return { materials: 0, edges: 0, hardware: 0, profiles: 0, sheetFormats: 0 };
}

/**
 * Слить импортированную библиотеку с текущей (§56): импорт не должен ломать
 * то, что уже есть. Записи с совпадающим id заменяются, остальные добавляются.
 */
export function mergeLibrary(current: LibraryModel, incoming: LibraryModel): LibraryModel {
  const mergeSection = <T extends { id: string }>(
    a: LibraryEntry<T>[], b: LibraryEntry<T>[],
  ): LibraryEntry<T>[] => {
    const byId = new Map(a.map((e) => [e.value.id, e]));
    for (const entry of b) {
      const existing = byId.get(entry.value.id);
      byId.set(entry.value.id, existing
        ? { ...entry, revision: Math.max(existing.revision, entry.revision) }
        : entry);
    }
    return [...byId.values()];
  };

  const formats = new Map(current.sheetFormats.map((f) => [f.id, f]));
  for (const f of incoming.sheetFormats) formats.set(f.id, f);

  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    materials: mergeSection(current.materials, incoming.materials),
    edges: mergeSection(current.edges, incoming.edges),
    hardware: mergeSection(current.hardware, incoming.hardware),
    profiles: mergeSection(current.profiles, incoming.profiles),
    sheetFormats: [...formats.values()],
    updatedAt: new Date().toISOString(),
  };
}
