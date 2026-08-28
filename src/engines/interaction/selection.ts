/**
 * SelectionManager (§1–§11) — ЕДИНОЕ выделение для 2D и 3D.
 *
 * Выделение — состояние интерфейса: список идентификаторов реальных объектов
 * ProjectModel, а не копии объектов. Поэтому 2D и 3D показывают одно и то же
 * выделение и не расходятся (§96–§98): второго списка выбранного не заводится.
 *
 * Уровень выбора (§7) определяет, ЧТО берётся под клик по детали: сама деталь,
 * её модуль или изделие целиком. Сам клик всегда попадает в деталь — уровень
 * лишь поднимает выбор по иерархии.
 */
import type { Part, Project } from '@/core/model/types';
import { allParts, findFurniture, findPart } from '@/core/model/selectors';
import { partWorldAABB, type AABB } from '@/core/geometry/partGeometry';

/** Что именно выбрано (§7). */
export type SelectionKind = 'CABINET' | 'MODULE' | 'PART' | 'HARDWARE' | 'CONNECTION';

/** Уровень, на котором работает клик (§7). */
export type SelectionLevel = 'PART' | 'MODULE' | 'CABINET';

export interface SelectionEntry {
  id: string;
  kind: SelectionKind;
}

/** Состояние выделения — общее для всех видов редактора. */
export interface SelectionState {
  /** Выбранные объекты; последний — активный. */
  ids: string[];
  /** Уровень выбора по клику. */
  level: SelectionLevel;
  /** Объект под курсором (§11). */
  hovered: string | null;
}

export const EMPTY_SELECTION: SelectionState = { ids: [], level: 'PART', hovered: null };

/** Активный объект — тот, чьи свойства показывает панель (§99). */
export function activeId(state: SelectionState): string | null {
  return state.ids.length > 0 ? state.ids[state.ids.length - 1] : null;
}

export function isSelected(state: SelectionState, id: string): boolean {
  return state.ids.includes(id);
}

/** Одиночный выбор (§2). */
export function selectSingle(state: SelectionState, id: string | null): SelectionState {
  return { ...state, ids: id ? [id] : [] };
}

/** Ctrl/Cmd + click (§3): добавить или убрать. */
export function toggleSelection(state: SelectionState, id: string): SelectionState {
  return {
    ...state,
    ids: state.ids.includes(id) ? state.ids.filter((x) => x !== id) : [...state.ids, id],
  };
}

/** Добавить, не снимая прежнее (Shift + click). */
export function extendSelection(state: SelectionState, ids: string[]): SelectionState {
  const set = new Set(state.ids);
  for (const id of ids) set.add(id);
  return { ...state, ids: [...set] };
}

/** Esc — снять выделение (§6). */
export function clearSelection(state: SelectionState): SelectionState {
  return { ...state, ids: [] };
}

/** Ctrl/Cmd + A (§5): выбрать все видимые детали проекта. */
export function selectAll(project: Project, state: SelectionState, hidden: string[] = []): SelectionState {
  const skip = new Set(hidden);
  return { ...state, ids: allParts(project).map((p) => String(p.id)).filter((id) => !skip.has(id)) };
}

// ── Выделение рамкой в 3D (§4) ───────────────────────────────────────────────

export interface Box3 {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export function boxContains(box: Box3, target: AABB): boolean {
  return target.min.x >= box.min.x && target.max.x <= box.max.x
    && target.min.y >= box.min.y && target.max.y <= box.max.y
    && target.min.z >= box.min.z && target.max.z <= box.max.z;
}

export function boxIntersects(box: Box3, target: AABB): boolean {
  return target.min.x <= box.max.x && target.max.x >= box.min.x
    && target.min.y <= box.max.y && target.max.y >= box.min.y
    && target.min.z <= box.max.z && target.max.z >= box.min.z;
}

/**
 * Выделение объёмной рамкой (§4). `crossing` — «касанием»: попадают детали,
 * которые рамка задевает; иначе только целиком попавшие внутрь.
 */
export function selectInBox(
  project: Project,
  box: Box3,
  options: { crossing?: boolean; hidden?: string[] } = {},
): string[] {
  const skip = new Set(options.hidden ?? []);
  const test = options.crossing ? boxIntersects : boxContains;
  return allParts(project)
    .filter((p) => !skip.has(String(p.id)))
    .filter((p) => test(box, partWorldAABB(p)))
    .map((p) => String(p.id));
}

/** Нормализовать рамку, нарисованную в любом направлении. */
export function normalizeBox3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): Box3 {
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
  };
}

// ── Иерархия (§7–§9) ─────────────────────────────────────────────────────────

/** Что это за объект по его идентификатору. */
export function kindOf(project: Project, id: string): SelectionKind | null {
  if (project.furnitures.some((f) => String(f.id) === id)) return 'CABINET';
  if (findPart(project, id as Part['id'])) return 'PART';
  if (project.hardwareConnections.some((c) => String(c.id) === id)) return 'CONNECTION';
  if (project.hardware.some((h) => String(h.id) === id)) return 'HARDWARE';
  return null;
}

/** Изделие, которому принадлежит деталь. */
export function furnitureOfPart(project: Project, partId: string): string | null {
  for (const furniture of project.furnitures) {
    for (const assembly of furniture.assemblies) {
      if (assembly.parts.some((p) => String(p.id) === partId)) return String(furniture.id);
    }
  }
  return null;
}

/** Родитель объекта (§8): деталь → изделие, узел → деталь. */
export function parentOf(project: Project, id: string): string | null {
  const kind = kindOf(project, id);
  if (kind === 'PART') return furnitureOfPart(project, id);
  if (kind === 'CONNECTION') {
    const connection = project.hardwareConnections.find((c) => String(c.id) === id);
    return connection ? String(connection.partAId) : null;
  }
  return null;
}

/** Дочерние объекты (§9): изделие → его детали, деталь → её узлы. */
export function childrenOf(project: Project, id: string): string[] {
  const kind = kindOf(project, id);
  if (kind === 'CABINET') {
    const furniture = findFurniture(project, id as never);
    return furniture ? furniture.assemblies.flatMap((a) => a.parts.map((p) => String(p.id))) : [];
  }
  if (kind === 'PART') {
    return project.hardwareConnections
      .filter((c) => String(c.partAId) === id || String(c.partBId) === id)
      .map((c) => String(c.id));
  }
  return [];
}

/** Select Parent (§8). Без родителя выделение остаётся прежним. */
export function selectParent(project: Project, state: SelectionState): SelectionState {
  const parents = state.ids.map((id) => parentOf(project, id)).filter((x): x is string => Boolean(x));
  return parents.length > 0 ? { ...state, ids: [...new Set(parents)] } : state;
}

/** Select Children (§9). */
export function selectChildren(project: Project, state: SelectionState): SelectionState {
  const children = state.ids.flatMap((id) => childrenOf(project, id));
  return children.length > 0 ? { ...state, ids: [...new Set(children)] } : state;
}

/**
 * Что выбрать по клику с учётом уровня (§7). Клик всегда попадает в деталь;
 * уровень MODULE/CABINET поднимает выбор до её изделия.
 */
export function resolveClick(project: Project, partId: string, level: SelectionLevel): string {
  if (level === 'PART') return partId;
  return furnitureOfPart(project, partId) ?? partId;
}

/** Детали, которые надо подсветить для выбранного объекта (§10). */
export function highlightedParts(project: Project, state: SelectionState): string[] {
  const out = new Set<string>();
  for (const id of state.ids) {
    const kind = kindOf(project, id);
    if (kind === 'PART') out.add(id);
    else if (kind === 'CABINET') for (const child of childrenOf(project, id)) out.add(child);
    else if (kind === 'CONNECTION') {
      const connection = project.hardwareConnections.find((c) => String(c.id) === id);
      if (connection) { out.add(String(connection.partAId)); out.add(String(connection.partBId)); }
    }
  }
  return [...out];
}

/** Выбранные детали проекта — то, над чем работают операции. */
export function selectedParts(project: Project, state: SelectionState): Part[] {
  const ids = new Set(highlightedParts(project, state));
  return allParts(project).filter((p) => ids.has(String(p.id)));
}
