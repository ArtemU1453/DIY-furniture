/**
 * Локальное хранение библиотеки (§52): localStorage, без сервера и
 * регистрации. Все обращения обёрнуты в try/catch — приложение работает и
 * там, где хранилище недоступно (приватный режим, отключённые cookie).
 *
 * Повреждённое содержимое хранилища не роняет приложение: разбор идёт через
 * тот же валидатор, что и импорт файла, и при неудаче отдаётся библиотека
 * по умолчанию.
 */
import { createDefaultLibrary } from './presets';
import { parseLibrary, serializeLibrary } from './serialization';
import type { LibraryModel } from './types';

const KEY = 'karkas.library.v1';

/** Прочитать библиотеку; при любой проблеме — библиотека по умолчанию. */
export function loadLibrary(): LibraryModel {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return createDefaultLibrary();
    const result = parseLibrary(raw);
    return result.ok ? result.library : createDefaultLibrary();
  } catch {
    return createDefaultLibrary();
  }
}

export function saveLibrary(library: LibraryModel): void {
  try {
    localStorage.setItem(KEY, serializeLibrary(library));
  } catch {
    /* хранилище недоступно — работаем в памяти */
  }
}

/** Сбросить библиотеку к поставке (осознанное действие пользователя). */
export function resetLibrary(): LibraryModel {
  const fresh = createDefaultLibrary();
  saveLibrary(fresh);
  return fresh;
}

export function clearLibraryStorage(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* нечего чистить */
  }
}
