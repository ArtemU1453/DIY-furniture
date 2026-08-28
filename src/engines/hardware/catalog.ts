/**
 * Каталог фурнитуры (§4–§13).
 *
 * Каталог хранит те же позиции Hardware, что попадают в проект: отдельной
 * карточки фурнитуры не заводим. Встроенные позиции строятся из уже
 * существующих шаблонов (§104 этапа 22) и параметрических видов этапа 32.
 */
import type {
  Hardware,
  HardwareCatalog,
  HardwareCatalogEntry,
  HardwareKind,
} from '@/core/model/types';
import type { HardwareId } from '@/core/model/ids';
import { HARDWARE_TEMPLATES, hardwareFromTemplateSpec } from './templates';
import { HARDWARE_KIND_SPECS, KIND_CATEGORY, kindOfHardware, kindSpec } from './parametric';

/** Версия структуры каталога (§117). */
export const HARDWARE_CATALOG_VERSION = 2;

/** Позиция каталога из вида фурнитуры (§5). */
function entryFromKind(kind: HardwareKind): HardwareCatalogEntry {
  const spec = kindSpec(kind);
  return {
    kind,
    hardware: {
      id: `cat-${kind.toLowerCase()}` as HardwareId,
      name: spec.label,
      category: KIND_CATEGORY[kind],
      manufacturer: 'Karkas',
      model: spec.label,
      article: `KRK-${kind}`,
      parameters: { ...spec.defaults },
      placement: spec.placement,
      metadata: { kind },
    },
    installation: `Ставится на грань «${spec.defaultFace}» по правилу вида.`,
  };
}

/** Позиция каталога из шаблона прошлых этапов (§5). */
function entryFromTemplate(id: string): HardwareCatalogEntry | null {
  const template = HARDWARE_TEMPLATES.find((t) => t.id === id);
  if (!template) return null;
  const hardware = hardwareFromTemplateSpec(template, template.id as HardwareId);
  return {
    kind: kindOfHardware(hardware),
    hardware: { ...hardware, manufacturer: hardware.manufacturer ?? 'Karkas' },
    installation: template.description,
  };
}

/** Встроенный каталог: параметрические виды плюс готовые шаблоны (§4). */
export function builtinCatalog(): HardwareCatalog {
  const entries: HardwareCatalogEntry[] = HARDWARE_KIND_SPECS.map((s) => entryFromKind(s.kind));
  for (const template of HARDWARE_TEMPLATES) {
    const entry = entryFromTemplate(template.id);
    if (entry) entries.push(entry);
  }
  return { version: HARDWARE_CATALOG_VERSION, entries };
}

/** Позиция каталога по идентификатору. */
export function findEntry(catalog: HardwareCatalog, id: string): HardwareCatalogEntry | undefined {
  return catalog.entries.find((e) => String(e.hardware.id) === id);
}

/**
 * Поиск по каталогу (§11): название, артикул, производитель, вид.
 *
 * Регистр не важен, совпадение — по подстроке: цех ищет «блюм» и «35», а не
 * точную строку.
 */
export function searchCatalog(catalog: HardwareCatalog, query: string): HardwareCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return catalog.entries;
  return catalog.entries.filter((e) => {
    const h = e.hardware;
    return [h.name, h.article, h.manufacturer, h.model, e.kind]
      .filter((v): v is string => typeof v === 'string')
      .some((v) => v.toLowerCase().includes(q));
  });
}

/** Фильтр каталога (§12). */
export interface CatalogFilter {
  kind?: HardwareKind;
  manufacturer?: string;
  /** 'custom' — только созданные пользователем, 'catalog' — только встроенные. */
  origin?: 'custom' | 'catalog';
  favoritesOnly?: boolean;
  query?: string;
}

export function filterCatalog(catalog: HardwareCatalog, filter: CatalogFilter): HardwareCatalogEntry[] {
  let list = filter.query ? searchCatalog(catalog, filter.query) : catalog.entries;
  if (filter.kind) list = list.filter((e) => e.kind === filter.kind);
  if (filter.manufacturer) {
    list = list.filter((e) => (e.hardware.manufacturer ?? '') === filter.manufacturer);
  }
  if (filter.origin === 'custom') list = list.filter((e) => e.custom === true);
  if (filter.origin === 'catalog') list = list.filter((e) => e.custom !== true);
  if (filter.favoritesOnly) list = list.filter((e) => e.favorite === true);
  return list;
}

/** Производители каталога — для выпадающего списка фильтра (§12). */
export function catalogManufacturers(catalog: HardwareCatalog): string[] {
  const set = new Set<string>();
  for (const entry of catalog.entries) {
    if (entry.hardware.manufacturer) set.add(entry.hardware.manufacturer);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
}

/** Виды, встречающиеся в каталоге (§12). */
export function catalogKinds(catalog: HardwareCatalog): HardwareKind[] {
  const set = new Set<HardwareKind>();
  for (const entry of catalog.entries) set.add(entry.kind);
  return [...set];
}

/** Переключить избранное (§13). */
export function toggleFavorite(catalog: HardwareCatalog, id: string): HardwareCatalog {
  return {
    ...catalog,
    entries: catalog.entries.map((e) =>
      String(e.hardware.id) === id ? { ...e, favorite: !e.favorite } : e),
  };
}

export function favorites(catalog: HardwareCatalog): HardwareCatalogEntry[] {
  return catalog.entries.filter((e) => e.favorite === true);
}

/** Свободный идентификатор позиции. */
function nextEntryId(catalog: HardwareCatalog, base: string): HardwareId {
  const used = new Set(catalog.entries.map((e) => String(e.hardware.id)));
  if (!used.has(base)) return base as HardwareId;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}` as HardwareId;
}

export interface CustomHardwareInput {
  name: string;
  kind: HardwareKind;
  manufacturer?: string;
  model?: string;
  article?: string;
  parameters?: Record<string, number | string | boolean>;
  cost?: { perUnit?: number; currency?: string };
  installation?: string;
}

/** Создать собственную позицию (§6). */
export function createCustomEntry(
  catalog: HardwareCatalog,
  input: CustomHardwareInput,
): { catalog: HardwareCatalog; entry: HardwareCatalogEntry } {
  const spec = kindSpec(input.kind);
  const id = nextEntryId(catalog, `custom-${input.kind.toLowerCase()}`);
  const hardware: Hardware = {
    id,
    name: input.name,
    category: KIND_CATEGORY[input.kind],
    manufacturer: input.manufacturer,
    model: input.model,
    article: input.article,
    parameters: { ...spec.defaults, ...(input.parameters ?? {}) },
    placement: spec.placement,
    cost: input.cost,
    metadata: { kind: input.kind },
  };
  const entry: HardwareCatalogEntry = {
    hardware,
    kind: input.kind,
    custom: true,
    installation: input.installation,
  };
  return { catalog: { ...catalog, entries: [...catalog.entries, entry] }, entry };
}

/** Копия позиции каталога (§7). Копия всегда пользовательская. */
export function duplicateEntry(
  catalog: HardwareCatalog,
  id: string,
  name?: string,
): { catalog: HardwareCatalog; entry: HardwareCatalogEntry } | null {
  const source = findEntry(catalog, id);
  if (!source) return null;
  const newId = nextEntryId(catalog, `${String(source.hardware.id)}-copy`);
  const entry: HardwareCatalogEntry = {
    ...source,
    custom: true,
    favorite: false,
    hardware: {
      ...source.hardware,
      id: newId,
      name: name ?? `${source.hardware.name} (копия)`,
      parameters: { ...(source.hardware.parameters ?? {}) },
    },
  };
  return { catalog: { ...catalog, entries: [...catalog.entries, entry] }, entry };
}

/** Удалить позицию каталога (только пользовательскую). */
export function removeEntry(catalog: HardwareCatalog, id: string): HardwareCatalog {
  return {
    ...catalog,
    entries: catalog.entries.filter((e) => !(String(e.hardware.id) === id && e.custom === true)),
  };
}

/** Обновить параметры позиции. */
export function updateEntry(
  catalog: HardwareCatalog,
  id: string,
  patch: Partial<Hardware>,
): HardwareCatalog {
  return {
    ...catalog,
    entries: catalog.entries.map((e) =>
      String(e.hardware.id) === id ? { ...e, hardware: { ...e.hardware, ...patch, id: e.hardware.id } } : e),
  };
}

/** Пресет каталога (§8): подборка позиций под тип мебели. */
export interface HardwarePresetSet {
  id: string;
  name: string;
  entryIds: string[];
}

export const BUILTIN_CATALOG_PRESETS: HardwarePresetSet[] = [
  {
    id: 'preset-cabinet',
    name: 'Шкаф: петли, ручки, полкодержатели',
    entryIds: ['cat-hinge', 'cat-handle', 'cat-shelf_pin', 'cat-confirmat'],
  },
  {
    id: 'preset-drawers',
    name: 'Ящики: направляющие и стяжки',
    entryIds: ['cat-drawer_slide', 'cat-handle', 'cat-minifix', 'cat-dowel'],
  },
];

/** Позиции пресета (§8). */
export function presetEntries(catalog: HardwareCatalog, preset: HardwarePresetSet): HardwareCatalogEntry[] {
  return preset.entryIds
    .map((id) => findEntry(catalog, id))
    .filter((e): e is HardwareCatalogEntry => e !== undefined);
}
