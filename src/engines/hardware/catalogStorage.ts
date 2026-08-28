/**
 * Локальное хранение каталога фурнитуры (§119).
 *
 * localStorage, без облака и регистрации. Все обращения обёрнуты в try/catch:
 * в приватном режиме приложение должно работать, просто без сохранения.
 */
import type { HardwareCatalog, HardwareCatalogEntry } from '@/core/model/types';
import { HARDWARE_CATALOG_VERSION, builtinCatalog } from './catalog';
import { migrateEntry } from './catalogIo';

const KEY = 'karkas.hardwareCatalog.v1';

/** Прочитать каталог; если сохранённого нет — встроенный (§4/§119). */
export function loadCatalog(): HardwareCatalog {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return builtinCatalog();
    const parsed = JSON.parse(raw) as Partial<HardwareCatalog>;
    if (!parsed || !Array.isArray(parsed.entries) || parsed.entries.length === 0) return builtinCatalog();
    const version = typeof parsed.version === 'number' ? parsed.version : 1;
    return {
      version: HARDWARE_CATALOG_VERSION,
      entries: (parsed.entries as HardwareCatalogEntry[]).map((e) => migrateEntry(e, version)),
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return builtinCatalog();
  }
}

export function saveCatalog(catalog: HardwareCatalog): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...catalog, updatedAt: new Date().toISOString() }));
  } catch {
    /* хранилище недоступно — работаем без сохранения */
  }
}

/** Вернуть встроенный каталог, забыв пользовательские правки. */
export function resetCatalog(): HardwareCatalog {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* нечего чистить */
  }
  return builtinCatalog();
}
