/**
 * Импорт и экспорт библиотеки фурнитуры (§74–§76/§109).
 *
 * БЕЗОПАСНОСТЬ: импортированный JSON — это ДАННЫЕ, а не код. Он разбирается
 * JSON.parse и полем за полем переносится в типизированную структуру; ничего
 * не вычисляется и не выполняется, а неизвестные поля отбрасываются. Поэтому
 * повреждённый или враждебный файл может дать пустую библиотеку, но не
 * выполнение кода и не порчу проекта (§109).
 */
import type { Hardware, HardwareCategory, HardwareKit } from '@/core/model/types';
import type { HardwareId } from '@/core/model/ids';
import { newHardwareId } from '@/core/model/ids';

export const HARDWARE_LIBRARY_FORMAT = 'karkas-hardware-library';
export const HARDWARE_LIBRARY_VERSION = 1;

export interface HardwareLibraryFile {
  format: typeof HARDWARE_LIBRARY_FORMAT;
  version: number;
  exportedAt: string;
  hardware: Hardware[];
  kits: HardwareKit[];
}

const CATEGORIES: HardwareCategory[] = [
  'confirmat', 'minifix', 'dowel', 'shelf-support', 'hinge', 'slide',
  'connector', 'corner', 'screw', 'leg', 'handle', 'back-panel', 'other',
];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Параметры: только примитивы. Вложенные объекты и функции отбрасываются. */
function readParameters(v: unknown): Record<string, number | string | boolean> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(v)) {
    if (typeof value === 'string' || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Разобрать одну позицию. Возвращает null, если запись непригодна. */
export function readHardware(raw: unknown): Hardware | null {
  if (!isRecord(raw)) return null;
  const name = str(raw.name);
  if (!name) return null; // позиция без названия бесполезна
  const category = CATEGORIES.includes(raw.category as HardwareCategory)
    ? (raw.category as HardwareCategory)
    : 'other';

  const item: Hardware = {
    id: (str(raw.id) ?? newHardwareId()) as HardwareId,
    name,
    category,
  };
  const manufacturer = str(raw.manufacturer);
  if (manufacturer) item.manufacturer = manufacturer;
  const article = str(raw.article);
  if (article) item.article = article;
  const description = str(raw.description);
  if (description) item.description = description;
  const parameters = readParameters(raw.parameters);
  if (parameters) item.parameters = parameters;
  if (raw.archived === true) item.archived = true;

  if (isRecord(raw.thicknessRange)) {
    const min = num(raw.thicknessRange.min);
    const max = num(raw.thicknessRange.max);
    if (min != null || max != null) item.thicknessRange = { ...(min != null ? { min } : {}), ...(max != null ? { max } : {}) };
  }
  const perUnit = isRecord(raw.cost) ? num(raw.cost.perUnit) : undefined;
  if (perUnit != null) item.cost = { perUnit, currency: str((raw.cost as Record<string, unknown>).currency) };

  return item;
}

/** Разобрать комплект. */
export function readKit(raw: unknown): HardwareKit | null {
  if (!isRecord(raw)) return null;
  const name = str(raw.name);
  if (!name) return null;
  const components = Array.isArray(raw.components)
    ? raw.components
        .map((c) => {
          if (!isRecord(c)) return null;
          const hardwareId = str(c.hardwareId);
          const quantity = num(c.quantity);
          if (!hardwareId || quantity == null || quantity <= 0) return null;
          return { hardwareId: hardwareId as HardwareId, quantity };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)
    : [];
  if (components.length === 0) return null; // комплект без компонентов бессмыслен
  return {
    id: str(raw.id) ?? `kit-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    article: str(raw.article),
    components,
    ...(raw.archived === true ? { archived: true } : {}),
  };
}

export interface ImportResult {
  ok: boolean;
  hardware: Hardware[];
  kits: HardwareKit[];
  /** Что не удалось разобрать — пользователь должен об этом узнать. */
  skipped: number;
  error?: string;
}

/** Импорт библиотеки из JSON-строки (§74). */
export function importHardwareLibrary(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, hardware: [], kits: [], skipped: 0, error: 'Файл не является корректным JSON.' };
  }
  if (!isRecord(parsed)) {
    return { ok: false, hardware: [], kits: [], skipped: 0, error: 'Ожидался объект библиотеки.' };
  }
  if (parsed.format !== undefined && parsed.format !== HARDWARE_LIBRARY_FORMAT) {
    return { ok: false, hardware: [], kits: [], skipped: 0, error: 'Файл не является библиотекой фурнитуры Karkas.' };
  }

  const rawHardware = Array.isArray(parsed.hardware) ? parsed.hardware : [];
  const rawKits = Array.isArray(parsed.kits) ? parsed.kits : [];
  const hardware = rawHardware.map(readHardware).filter((h): h is Hardware => h !== null);
  const kits = rawKits.map(readKit).filter((k): k is HardwareKit => k !== null);
  const skipped = (rawHardware.length - hardware.length) + (rawKits.length - kits.length);

  return { ok: true, hardware, kits, skipped };
}

/** Экспорт библиотеки в JSON (§75/§76) — целиком локально, без сети. */
export function exportHardwareLibrary(hardware: Hardware[], kits: HardwareKit[] = []): string {
  const file: HardwareLibraryFile = {
    format: HARDWARE_LIBRARY_FORMAT,
    version: HARDWARE_LIBRARY_VERSION,
    exportedAt: new Date().toISOString(),
    hardware,
    kits,
  };
  return JSON.stringify(file, null, 2);
}
