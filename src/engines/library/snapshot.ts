/**
 * Связь глобальной библиотеки и проекта (§59–§63).
 *
 * АРХИТЕКТУРНОЕ РЕШЕНИЕ. Проект уже хранит СВОИ материалы, кромку и фурнитуру
 * внутри ProjectModel (project.materials / project.edges / project.hardware).
 * Именно это и есть снимок библиотеки (§59): производственная документация
 * старого проекта воспроизводима, потому что проект ни на что внешнее не
 * опирается. Отдельного materialsSnapshot заводить не нужно — это была бы
 * вторая модель тех же данных.
 *
 * Библиотека добавляет к этому одну вещь: LibraryRef — стабильную ссылку
 * «откуда взято» с номером ревизии (§60). Ссылка нужна ровно для того, чтобы
 * позже спросить «в библиотеке появилась версия новее — обновить?» (§62).
 * Правка глобальной библиотеки сама по себе проект НЕ меняет (§61).
 *
 *   ГЛОБАЛЬНАЯ БИБЛИОТЕКА            ПРОЕКТ
 *   Material{id, revision:3}  ──копия──►  Material{…, libraryRef{libraryId, revision:2}}
 *                                          ▲
 *                       revision 3 > 2 ────┘  → доступно «Обновить из библиотеки»
 */
import type {
  EdgeMaterial,
  Hardware,
  LibraryRef,
  ManufacturingProfile,
  Material,
  Project,
} from '@/core/model/types';
import type { LibraryEntry, LibraryModel } from '@/core/library/types';

/** Объект библиотеки, который можно положить в проект. */
type Linkable = Material | EdgeMaterial | Hardware;

function makeRef(libraryId: string, revision: number): LibraryRef {
  return { libraryId, revision, linkedAt: new Date().toISOString() };
}

/**
 * Подготовить библиотечную запись к добавлению в проект: копия объекта плюс
 * ссылка на источник. Копия — потому что проект должен оставаться
 * воспроизводимым независимо от библиотеки (§59/§61).
 */
export function linkToProject<T extends Linkable>(entry: LibraryEntry<T>): T {
  return {
    ...structuredClone(entry.value),
    libraryRef: makeRef(entry.value.id, entry.revision),
  } as T;
}

/** То же для профиля (у профиля нет libraryRef — он копируется целиком). */
export function linkProfile(entry: LibraryEntry<ManufacturingProfile>): ManufacturingProfile {
  return structuredClone(entry.value);
}

// ── Diff (§63) ───────────────────────────────────────────────────────────────

export interface FieldDiff {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface EntityDiff {
  section: 'materials' | 'edges' | 'hardware';
  /** id объекта в проекте. */
  projectId: string;
  /** id записи в библиотеке. */
  libraryId: string;
  name: string;
  fromRevision: number;
  toRevision: number;
  fields: FieldDiff[];
  /** Меняется ли геометрия/производство (толщина, формат листа) — §29. */
  affectsProduction: boolean;
}

const fmt = (v: unknown): string => {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** Поля, которые показываем в diff, и то, влияют ли они на производство. */
const MATERIAL_FIELDS: Array<{ key: keyof Material; label: string; production: boolean }> = [
  { key: 'name', label: 'Название', production: false },
  { key: 'kind', label: 'Вид', production: false },
  { key: 'category', label: 'Категория', production: false },
  { key: 'thickness', label: 'Толщина', production: true },
  { key: 'sheet', label: 'Формат листа', production: true },
  { key: 'grain', label: 'Текстура', production: true },
  { key: 'allowRotate', label: 'Поворот при раскрое', production: true },
  { key: 'kerf', label: 'Пропил', production: true },
  { key: 'density', label: 'Плотность', production: false },
  { key: 'color', label: 'Цвет', production: false },
];

const EDGE_FIELDS: Array<{ key: keyof EdgeMaterial; label: string; production: boolean }> = [
  { key: 'name', label: 'Название', production: false },
  { key: 'thickness', label: 'Толщина', production: true },
  { key: 'width', label: 'Ширина', production: false },
  { key: 'material', label: 'Материал', production: false },
  { key: 'manufacturer', label: 'Производитель', production: false },
  { key: 'code', label: 'Артикул', production: false },
  { key: 'color', label: 'Цвет', production: false },
];

const HARDWARE_FIELDS: Array<{ key: keyof Hardware; label: string; production: boolean }> = [
  { key: 'name', label: 'Название', production: false },
  { key: 'category', label: 'Категория', production: true },
  { key: 'manufacturer', label: 'Производитель', production: false },
  { key: 'model', label: 'Модель', production: false },
  { key: 'article', label: 'Артикул', production: false },
  { key: 'parameters', label: 'Параметры', production: true },
  { key: 'machiningRules', label: 'Правила присадки', production: true },
];

function diffFields<T>(
  before: T,
  after: T,
  spec: Array<{ key: keyof T; label: string; production: boolean }>,
): { fields: FieldDiff[]; affectsProduction: boolean } {
  const fields: FieldDiff[] = [];
  let affectsProduction = false;
  for (const { key, label, production } of spec) {
    const a = fmt(before[key]);
    const b = fmt(after[key]);
    if (a === b) continue;
    fields.push({ field: String(key), label, before: a, after: b });
    if (production) affectsProduction = true;
  }
  return { fields, affectsProduction };
}

/**
 * Что изменится в проекте, если обновить его данные из библиотеки (§62/§63).
 * Возвращаются только те объекты, у которых в библиотеке ревизия новее.
 */
export function diffFromLibrary(project: Project, library: LibraryModel): EntityDiff[] {
  const out: EntityDiff[] = [];

  const compare = <T extends Linkable>(
    section: EntityDiff['section'],
    projectItems: T[],
    entries: LibraryEntry<T>[],
    spec: Array<{ key: keyof T; label: string; production: boolean }>,
  ) => {
    const byLibraryId = new Map<string, LibraryEntry<T>>(
      entries.map((e) => [String(e.value.id), e]),
    );
    for (const item of projectItems) {
      const ref = item.libraryRef;
      if (!ref) continue; // объект создан в проекте — обновлять нечего
      const entry = byLibraryId.get(ref.libraryId);
      if (!entry || entry.revision <= ref.revision) continue;
      const { fields, affectsProduction } = diffFields(item, entry.value, spec);
      if (fields.length === 0) continue;
      out.push({
        section,
        projectId: String(item.id),
        libraryId: ref.libraryId,
        name: item.name,
        fromRevision: ref.revision,
        toRevision: entry.revision,
        fields,
        affectsProduction,
      });
    }
  };

  compare('materials', project.materials, library.materials, MATERIAL_FIELDS);
  compare('edges', project.edges, library.edges, EDGE_FIELDS);
  compare('hardware', project.hardware, library.hardware, HARDWARE_FIELDS);
  return out;
}

/** Есть ли для проекта обновления в библиотеке. */
export function hasLibraryUpdates(project: Project, library: LibraryModel): boolean {
  return diffFromLibrary(project, library).length > 0;
}

/**
 * Значения, которые нужно записать в проект при обновлении из библиотеки.
 * Функция чистая: она не мутирует проект, а отдаёт готовые патчи, чтобы
 * store применил их одной командой (и запись попала в undo/redo).
 */
export interface LibraryUpdatePatch {
  section: EntityDiff['section'];
  projectId: string;
  /** Новое состояние объекта: библиотечные данные + свой id + новая ссылка. */
  value: Linkable;
  affectsProduction: boolean;
}

export function buildUpdatePatches(
  project: Project,
  library: LibraryModel,
  /** Ограничить обновление конкретными объектами проекта. */
  onlyProjectIds?: string[],
): LibraryUpdatePatch[] {
  const filter = onlyProjectIds ? new Set(onlyProjectIds) : null;
  const diffs = diffFromLibrary(project, library).filter((d) => !filter || filter.has(d.projectId));

  const patches: LibraryUpdatePatch[] = [];
  for (const d of diffs) {
    const entries = library[d.section] as LibraryEntry<Linkable>[];
    const entry = entries.find((e) => String(e.value.id) === d.libraryId);
    if (!entry) continue;
    patches.push({
      section: d.section,
      projectId: d.projectId,
      // Библиотечные данные, но id объекта в проекте сохраняется — иначе
      // порвутся ссылки деталей и соединений.
      value: {
        ...structuredClone(entry.value),
        id: d.projectId,
        libraryRef: makeRef(d.libraryId, entry.revision),
      } as Linkable,
      affectsProduction: d.affectsProduction,
    });
  }
  return patches;
}

/**
 * Снимок библиотеки, использованной проектом (§59) — для отчёта и проверки
 * воспроизводимости. Это ПРОЕКЦИЯ уже хранящихся в проекте данных, а не
 * второе место хранения.
 */
export interface ProjectLibrarySnapshot {
  materials: Array<{ id: string; name: string; thickness: number; libraryId?: string; revision?: number }>;
  edges: Array<{ id: string; name: string; thickness: number; libraryId?: string; revision?: number }>;
  hardware: Array<{ id: string; name: string; category: string; libraryId?: string; revision?: number }>;
  profile?: { id: string; name: string };
}

export function projectLibrarySnapshot(project: Project): ProjectLibrarySnapshot {
  return {
    materials: project.materials.map((m) => ({
      id: String(m.id), name: m.name, thickness: m.thickness,
      libraryId: m.libraryRef?.libraryId, revision: m.libraryRef?.revision,
    })),
    edges: project.edges.map((e) => ({
      id: String(e.id), name: e.name, thickness: e.thickness,
      libraryId: e.libraryRef?.libraryId, revision: e.libraryRef?.revision,
    })),
    hardware: project.hardware.map((h) => ({
      id: String(h.id), name: h.name, category: h.category,
      libraryId: h.libraryRef?.libraryId, revision: h.libraryRef?.revision,
    })),
    profile: project.machining.profile
      ? { id: project.machining.profile.id, name: project.machining.profile.name }
      : undefined,
  };
}
