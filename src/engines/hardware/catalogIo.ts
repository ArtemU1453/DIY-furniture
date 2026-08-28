/**
 * Импорт и экспорт каталога фурнитуры (§9/§10, §115–§121).
 *
 * Файл `hardware-catalog.json` содержит те же позиции Hardware, что и каталог
 * в памяти: разбор позиции выполняет уже существующий readHardware, поэтому
 * второй проверки структуры позиции не появляется. Всё локально: ни импорт,
 * ни экспорт наружу не ходят.
 */
import type { HardwareCatalog, HardwareCatalogEntry, HardwareKind } from '@/core/model/types';
import { readHardware } from './io';
import { HARDWARE_CATALOG_VERSION } from './catalog';
import { HARDWARE_KINDS, kindOfHardware } from './parametric';

export const HARDWARE_CATALOG_FORMAT = 'karkas-hardware-catalog';

export interface HardwareCatalogFile {
  format: typeof HARDWARE_CATALOG_FORMAT;
  version: number;
  exportedAt: string;
  entries: Array<{
    hardware: unknown;
    kind?: string;
    custom?: boolean;
    favorite?: boolean;
    installation?: string;
  }>;
}

/** Экспорт каталога в JSON (§10/§120). */
export function exportCatalog(catalog: HardwareCatalog, now = new Date().toISOString()): string {
  const file: HardwareCatalogFile = {
    format: HARDWARE_CATALOG_FORMAT,
    version: HARDWARE_CATALOG_VERSION,
    exportedAt: now,
    entries: catalog.entries.map((e) => ({
      hardware: e.hardware,
      kind: e.kind,
      custom: e.custom,
      favorite: e.favorite,
      installation: e.installation,
    })),
  };
  return JSON.stringify(file, null, 2);
}

export interface CatalogImportResult {
  ok: boolean;
  catalog?: HardwareCatalog;
  /** Сколько записей прочитано и сколько отброшено. */
  imported: number;
  skipped: number;
  errors: string[];
  /** Файл был старой версии и приведён к текущей (§118). */
  migrated?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Миграция старых версий каталога (§118).
 *
 * v1 не знал видов фурнитуры — вид выводится из категории позиции. Это
 * единственное отличие, поэтому миграция сводится к дополнению записи.
 */
export function migrateEntry(entry: HardwareCatalogEntry, fromVersion: number): HardwareCatalogEntry {
  if (fromVersion >= HARDWARE_CATALOG_VERSION) return entry;
  return { ...entry, kind: entry.kind ?? kindOfHardware(entry.hardware) };
}

/**
 * Импорт каталога из JSON (§9/§115/§116/§121).
 *
 * Повреждённый файл не принимается целиком: лучше отказать, чем подсунуть
 * цеху половину каталога.
 */
export function importCatalog(json: string): CatalogImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, imported: 0, skipped: 0, errors: ['Файл повреждён: не удалось прочитать JSON.'] };
  }
  if (!isRecord(parsed)) {
    return { ok: false, imported: 0, skipped: 0, errors: ['Файл не содержит каталога фурнитуры.'] };
  }
  if (parsed.format !== HARDWARE_CATALOG_FORMAT) {
    return { ok: false, imported: 0, skipped: 0, errors: ['Неподходящий формат файла — ожидается каталог фурнитуры Karkas.'] };
  }
  const version = typeof parsed.version === 'number' ? parsed.version : 0;
  if (version <= 0 || version > HARDWARE_CATALOG_VERSION) {
    return {
      ok: false, imported: 0, skipped: 0,
      errors: [`Версия каталога ${version} не поддерживается (текущая ${HARDWARE_CATALOG_VERSION}).`],
    };
  }
  if (!Array.isArray(parsed.entries)) {
    return { ok: false, imported: 0, skipped: 0, errors: ['В файле нет списка позиций.'] };
  }

  const entries: HardwareCatalogEntry[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const raw of parsed.entries) {
    if (!isRecord(raw)) { skipped += 1; continue; }
    const hardware = readHardware(raw.hardware);
    if (!hardware) {
      skipped += 1;
      errors.push('Позиция без названия или с повреждёнными данными пропущена.');
      continue;
    }
    const kindRaw = typeof raw.kind === 'string' ? raw.kind : undefined;
    const kind: HardwareKind = kindRaw && (HARDWARE_KINDS as string[]).includes(kindRaw)
      ? (kindRaw as HardwareKind)
      : kindOfHardware(hardware);
    entries.push(migrateEntry({
      hardware,
      kind,
      custom: raw.custom === true,
      favorite: raw.favorite === true,
      installation: typeof raw.installation === 'string' ? raw.installation : undefined,
    }, version));
  }

  if (entries.length === 0) {
    return { ok: false, imported: 0, skipped, errors: [...errors, 'В файле нет пригодных позиций.'] };
  }
  return {
    ok: true,
    catalog: { version: HARDWARE_CATALOG_VERSION, entries, updatedAt: new Date().toISOString() },
    imported: entries.length,
    skipped,
    errors,
    migrated: version < HARDWARE_CATALOG_VERSION,
  };
}

/** Слить импортированный каталог с текущим: позиции с тем же id обновляются. */
export function mergeCatalog(base: HardwareCatalog, incoming: HardwareCatalog): HardwareCatalog {
  const byId = new Map(base.entries.map((e) => [String(e.hardware.id), e]));
  for (const entry of incoming.entries) byId.set(String(entry.hardware.id), entry);
  return {
    version: HARDWARE_CATALOG_VERSION,
    entries: [...byId.values()],
    updatedAt: new Date().toISOString(),
  };
}

/** Имя файла каталога (§120/§121). */
export const HARDWARE_CATALOG_FILE = 'hardware-catalog.json';
