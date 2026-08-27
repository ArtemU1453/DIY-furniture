/**
 * Миграция библиотеки между версиями схемы (§57/§58).
 *
 * Старый JSON не должен ломать приложение и не должен ломать существующие
 * проекты: неизвестные поля сохраняются, недостающие достраиваются значениями
 * по умолчанию. Каждая миграция — отдельный шаг v(n) → v(n+1).
 */
import type { Material } from '@/core/model/types';
import { LIBRARY_SCHEMA_VERSION, categoryOfKind, type LibraryModel } from './types';

export interface MigrationResult {
  library: LibraryModel;
  /** С какой версии мигрировали. */
  fromVersion: number;
  toVersion: number;
  /** Применённые шаги — для отчёта пользователю. */
  steps: string[];
}

type RawLibrary = Record<string, unknown>;

/**
 * v1 → v2: у материалов появилась категория (§3), у записей — revision.
 * До v2 категория выводилась только из kind, форматов листов не было.
 */
function migrateV1toV2(raw: RawLibrary): RawLibrary {
  const materials = Array.isArray(raw.materials) ? raw.materials : [];
  const migrated = materials.map((m) => {
    const rec = m as Record<string, unknown>;
    // v1 хранил объекты материалов напрямую, без обёртки LibraryEntry.
    const value = (rec.value ?? rec) as Material;
    const withCategory: Material = {
      ...value,
      category: value.category ?? categoryOfKind(value.kind),
      schemaVersion: 2,
    };
    return {
      revision: typeof rec.revision === 'number' ? rec.revision : 1,
      updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : new Date().toISOString(),
      builtin: rec.builtin === true,
      value: withCategory,
    };
  });
  return { ...raw, materials: migrated, sheetFormats: raw.sheetFormats ?? [], schemaVersion: 2 };
}

const STEPS: Array<{ from: number; to: number; run: (raw: RawLibrary) => RawLibrary; label: string }> = [
  { from: 1, to: 2, run: migrateV1toV2, label: 'v1 → v2: категории материалов и форматы листов' },
];

/** Версия схемы во входных данных; отсутствие версии трактуем как v1. */
export function detectVersion(raw: unknown): number {
  if (typeof raw !== 'object' || raw === null) return LIBRARY_SCHEMA_VERSION;
  const v = (raw as RawLibrary).schemaVersion;
  return typeof v === 'number' && v > 0 ? v : 1;
}

/**
 * Привести библиотеку любой поддерживаемой версии к текущей.
 * Версия новее текущей не мигрируется — такой файл отклоняет валидатор.
 */
export function migrateLibrary(raw: unknown): MigrationResult {
  const fromVersion = detectVersion(raw);
  let current = (typeof raw === 'object' && raw !== null ? { ...(raw as RawLibrary) } : {}) as RawLibrary;
  const steps: string[] = [];

  let version = fromVersion;
  for (const step of STEPS) {
    if (version === step.from) {
      current = step.run(current);
      steps.push(step.label);
      version = step.to;
    }
  }
  current.schemaVersion = Math.max(version, LIBRARY_SCHEMA_VERSION);

  return {
    library: current as unknown as LibraryModel,
    fromVersion,
    toVersion: LIBRARY_SCHEMA_VERSION,
    steps,
  };
}

/** Нужна ли миграция для этих данных. */
export function needsMigration(raw: unknown): boolean {
  return detectVersion(raw) < LIBRARY_SCHEMA_VERSION;
}
