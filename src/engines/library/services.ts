/**
 * Сервисы библиотеки (§23–§26): единая точка изменения глобальной библиотеки.
 *
 * Производственная логика живёт здесь, а не в React-компонентах (§22). Все
 * методы чистые: принимают библиотеку и возвращают новую — состояние хранит
 * вызывающий слой.
 *
 * Общий принцип удаления (§27/§51): удалять можно только неиспользуемую и
 * невстроенную запись. Всё остальное архивируется (§28) — архивная позиция
 * не предлагается в новых проектах, но старые проекты продолжают работать.
 */
import type {
  EdgeMaterial,
  Hardware,
  ManufacturingProfile,
  Material,
} from '@/core/model/types';
import type { LibraryEntry, LibraryModel, SheetFormat } from '@/core/library/types';

export interface ServiceResult<T> {
  ok: boolean;
  library: LibraryModel;
  /** Затронутая запись, если операция её вернула. */
  value?: T;
  message?: string;
  /** Предложить архивирование вместо удаления (§51). */
  suggestArchive?: boolean;
}

const now = () => new Date().toISOString();

function touch(library: LibraryModel): LibraryModel {
  return { ...library, updatedAt: now() };
}

function newEntry<T>(value: T): LibraryEntry<T> {
  return { revision: 1, updatedAt: now(), builtin: false, value };
}

/** Уникальное имя копии: «ЛДСП 16 мм» → «ЛДСП 16 мм (копия)» (§31). */
function copyName(name: string, taken: Set<string>): string {
  let candidate = `${name} (копия)`;
  let n = 2;
  while (taken.has(candidate)) candidate = `${name} (копия ${n++})`;
  return candidate;
}

/**
 * Обобщённый сервис раздела библиотеки. Материалы, кромка, фурнитура и
 * профили отличаются только типом записи, поэтому CRUD у них общий — четыре
 * почти одинаковых класса писать незачем.
 */
function makeService<T extends { id: string; name: string; archived?: boolean }>(
  section: keyof Pick<LibraryModel, 'materials' | 'edges' | 'hardware' | 'profiles'>,
  label: string,
  newId: () => string,
) {
  const entries = (lib: LibraryModel): LibraryEntry<T>[] =>
    lib[section] as unknown as LibraryEntry<T>[];

  const write = (lib: LibraryModel, list: LibraryEntry<T>[]): LibraryModel =>
    touch({ ...lib, [section]: list } as LibraryModel);

  return {
    /** Все записи, включая архивные. */
    list(lib: LibraryModel): T[] {
      return entries(lib).map((e) => e.value);
    },

    /** Только доступные для новых проектов (§70). */
    listActive(lib: LibraryModel): T[] {
      return entries(lib).filter((e) => e.value.archived !== true).map((e) => e.value);
    },

    listArchived(lib: LibraryModel): T[] {
      return entries(lib).filter((e) => e.value.archived === true).map((e) => e.value);
    },

    get(lib: LibraryModel, id: string): T | undefined {
      return entries(lib).find((e) => e.value.id === id)?.value;
    },

    entry(lib: LibraryModel, id: string): LibraryEntry<T> | undefined {
      return entries(lib).find((e) => e.value.id === id);
    },

    create(lib: LibraryModel, value: Omit<T, 'id'> & { id?: string }): ServiceResult<T> {
      const id = value.id ?? newId();
      if (entries(lib).some((e) => e.value.id === id)) {
        return { ok: false, library: lib, message: `${label} с таким id уже есть в библиотеке.` };
      }
      const created = { ...value, id } as T;
      return { ok: true, library: write(lib, [...entries(lib), newEntry(created)]), value: created };
    },

    update(lib: LibraryModel, id: string, patch: Partial<T>): ServiceResult<T> {
      const list = entries(lib);
      const index = list.findIndex((e) => e.value.id === id);
      if (index < 0) return { ok: false, library: lib, message: `${label} не найден в библиотеке.` };
      // id менять нельзя — на него ссылаются проекты.
      const { id: _ignored, ...safe } = patch as Partial<T> & { id?: string };
      void _ignored;
      const updated = { ...list[index].value, ...safe } as T;
      const next = [...list];
      next[index] = { ...list[index], revision: list[index].revision + 1, updatedAt: now(), value: updated };
      return { ok: true, library: write(lib, next), value: updated };
    },

    /**
     * Удаление разрешено только если запись не используется и не встроена.
     * usedCount приходит снаружи — сервис не знает про проекты (§51).
     */
    remove(lib: LibraryModel, id: string, usedCount = 0): ServiceResult<T> {
      const entryToRemove = entries(lib).find((e) => e.value.id === id);
      if (!entryToRemove) return { ok: false, library: lib, message: `${label} не найден в библиотеке.` };
      if (usedCount > 0) {
        return {
          ok: false, library: lib, suggestArchive: true,
          message: `${label} используется (${usedCount}) — удаление запрещено. Архивируйте позицию.`,
        };
      }
      if (entryToRemove.builtin) {
        return {
          ok: false, library: lib, suggestArchive: true,
          message: `${label} входит в поставку — его нельзя удалить, только архивировать.`,
        };
      }
      return { ok: true, library: write(lib, entries(lib).filter((e) => e.value.id !== id)) };
    },

    /** Архивировать / вернуть из архива (§28). */
    setArchived(lib: LibraryModel, id: string, archived: boolean): ServiceResult<T> {
      return this.update(lib, id, { archived } as Partial<T>);
    },

    /** Копия записи с новым id и именем (§31). */
    duplicate(lib: LibraryModel, id: string, name?: string): ServiceResult<T> {
      const source = entries(lib).find((e) => e.value.id === id);
      if (!source) return { ok: false, library: lib, message: `${label} не найден в библиотеке.` };
      const taken = new Set(entries(lib).map((e) => e.value.name));
      const copy = {
        ...structuredClone(source.value),
        id: newId(),
        name: name ?? copyName(source.value.name, taken),
        archived: false,
      } as T;
      // Копия — всегда пользовательская запись, даже если исходник встроенный.
      return { ok: true, library: write(lib, [...entries(lib), newEntry(copy)]), value: copy };
    },
  };
}

let counter = 0;
const genId = (prefix: string) => (): string =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const MaterialService = makeService<Material>('materials', 'Материал', genId('lib-mat') as () => string);
export const EdgeMaterialService = makeService<EdgeMaterial>('edges', 'Кромка', genId('lib-edge') as () => string);
export const HardwareService = makeService<Hardware>('hardware', 'Фурнитура', genId('lib-hw') as () => string);
export const ManufacturingProfileService = makeService<ManufacturingProfile>('profiles', 'Профиль', genId('profile') as () => string);

// ── Форматы листов (§5/§6) ───────────────────────────────────────────────────

export const SheetFormatService = {
  list(lib: LibraryModel, materialId?: string): SheetFormat[] {
    const all = lib.sheetFormats;
    return materialId ? all.filter((f) => f.materialId === materialId) : all;
  },

  /** Активные форматы материала в порядке приоритета. */
  listActive(lib: LibraryModel, materialId: string): SheetFormat[] {
    return lib.sheetFormats
      .filter((f) => f.materialId === materialId && f.active)
      .sort((a, b) => a.priority - b.priority);
  },

  create(lib: LibraryModel, format: Omit<SheetFormat, 'id'> & { id?: string }): ServiceResult<SheetFormat> {
    const id = format.id ?? genId('fmt')();
    if (lib.sheetFormats.some((f) => f.id === id)) {
      return { ok: false, library: lib, message: 'Формат листа с таким id уже есть.' };
    }
    const created: SheetFormat = { ...format, id };
    return { ok: true, library: touch({ ...lib, sheetFormats: [...lib.sheetFormats, created] }), value: created };
  },

  update(lib: LibraryModel, id: string, patch: Partial<SheetFormat>): ServiceResult<SheetFormat> {
    const index = lib.sheetFormats.findIndex((f) => f.id === id);
    if (index < 0) return { ok: false, library: lib, message: 'Формат листа не найден.' };
    const next = [...lib.sheetFormats];
    next[index] = { ...next[index], ...patch, id };
    return { ok: true, library: touch({ ...lib, sheetFormats: next }), value: next[index] };
  },

  remove(lib: LibraryModel, id: string): ServiceResult<SheetFormat> {
    if (!lib.sheetFormats.some((f) => f.id === id)) {
      return { ok: false, library: lib, message: 'Формат листа не найден.' };
    }
    return { ok: true, library: touch({ ...lib, sheetFormats: lib.sheetFormats.filter((f) => f.id !== id) }) };
  },
};
