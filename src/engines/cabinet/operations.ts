/**
 * Операции со шкафом как с целым (§90–§97).
 *
 * Создание, дубликат, копирование и удаление работают с ОДНОЙ моделью:
 * изделие ProjectModel + параметрическая модель в его params. Функции чистые —
 * они возвращают новые данные, а записывает их store одной командой, поэтому
 * любая из операций целиком ложится в undo/redo (§116/§117).
 */
import type {
  EdgeMaterial, Furniture, Hardware, HardwareConnection, Material, Part, Project,
} from '@/core/model/types';
import type { FurnitureId } from '@/core/model/ids';
import { newAssemblyId, newFurnitureId, newHardwareConnectionId, newPartId } from '@/core/model/ids';
import { createFurniture, createAssembly } from '@/core/model/factory';
import { findFurniture } from '@/core/model/selectors';
import type { ParametricModel } from '@/core/parametric/types';
import { PARAMETRIC_KEY } from '@/engines/parametric/templates';
import { generateParts } from '@/engines/parametric/generator';
import { modelSections } from '@/engines/parametric/rules';
import { ensureConnectionHardware, reconcileConnections } from '@/engines/connections/reconcile';
import { toCabinetModel, type CabinetModel } from './model';
import { checkCabinet, type CabinetIssue } from './collision';

export const CABINET_CLIPBOARD_FORMAT = 'karkas-cabinet';
export const CABINET_CLIPBOARD_VERSION = 1;

export interface CabinetBuild {
  furniture: Furniture;
  connections: HardwareConnection[];
  /** Фурнитура, которой в проекте не было, но она нужна соединениям. */
  hardware: Hardware[];
  issues: CabinetIssue[];
  ok: boolean;
}

/**
 * Создать изделие по модели (§94). Детали и соединения строятся сразу, чтобы
 * 3D показывал корректный шкаф без дополнительных действий (§105).
 */
export function buildCabinet(
  project: Project,
  model: ParametricModel,
  name?: string,
): CabinetBuild {
  const resolved = toCabinetModel(model);
  const furniture = createFurniture(name ?? 'Шкаф');
  furniture.type = 'cabinet';
  furniture.params = { [PARAMETRIC_KEY]: resolved } as Record<string, unknown>;

  const generated = generateParts(resolved, []);
  if (!generated.ok) {
    return {
      furniture, connections: [], hardware: [], ok: false,
      issues: generated.issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message })),
    };
  }
  if (furniture.assemblies[0]) furniture.assemblies[0].parts = generated.parts;
  // Секции — производная модели, а не отдельно хранимая правда (этап 35).
  furniture.sections = modelSections(resolved);

  const ctx = {
    jointCategory: resolved.jointType,
    construction: resolved.construction,
    handles: resolved.doors.handleEnabled,
  };
  /* Фурнитура добирается ДО соединений: без неё правило молча пропустит узел,
   * и мастер дал бы меньше соединений, чем шаблон (этап 35). */
  const hardware = ensureConnectionHardware(project, generated.parts, ctx);
  const withHardware = hardware.length === 0
    ? project
    : { ...project, hardware: [...project.hardware, ...hardware] };

  const reconciled = reconcileConnections(withHardware, generated.parts, ctx);
  const check = checkCabinet(project, resolved, generated.parts);
  return {
    furniture, connections: reconciled.connections, hardware,
    issues: check.issues, ok: check.ok,
  };
}

/** Краткая сводка будущего изделия для предпросмотра (§93). */
export interface CabinetPreview {
  parts: number;
  connections: number;
  materialAreaM2: number;
  issues: CabinetIssue[];
  ok: boolean;
  byRole: Array<{ role: string; count: number }>;
}

export function previewCabinet(project: Project, model: ParametricModel): CabinetPreview {
  const built = buildCabinet(project, model, 'preview');
  const parts = built.furniture.assemblies[0]?.parts ?? [];
  const area = parts.reduce((sum, p) => sum + (p.width * p.height * (p.quantity || 1)) / 1_000_000, 0);
  const counts = new Map<string, number>();
  for (const part of parts) counts.set(part.role, (counts.get(part.role) ?? 0) + 1);
  return {
    parts: parts.length,
    connections: built.connections.length,
    materialAreaM2: Math.round(area * 100) / 100,
    issues: built.issues,
    ok: built.ok,
    byRole: [...counts.entries()].map(([role, count]) => ({ role, count })),
  };
}

// ── Дубликат и копирование (§95/§96) ─────────────────────────────────────────

/** Новые идентификаторы для деталей: копия обязана быть независимой (§95). */
function cloneParts(parts: Part[]): { parts: Part[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const cloned = parts.map((part) => {
    const id = newPartId();
    idMap.set(String(part.id), String(id));
    return {
      ...structuredClone(part),
      id,
      machining: part.machining.map((op) => ({ ...op, partId: id })),
    };
  });
  return { parts: cloned, idMap };
}

export interface CabinetCopy {
  furniture: Furniture;
  connections: HardwareConnection[];
  /** Материалы, кромка и крепёж, которых нет в проекте-получателе (этап 38). */
  materials?: Material[];
  edges?: EdgeMaterial[];
  hardware?: Hardware[];
}

/**
 * Полностью независимая копия изделия (§95): новые id деталей, сборок и
 * соединений. Изменение копии не затрагивает оригинал.
 */
export function duplicateCabinet(project: Project, id: FurnitureId, name?: string): CabinetCopy | null {
  const source = findFurniture(project, id);
  if (!source) return null;
  return duplicateFurnitureData(source, project.hardwareConnections, name ?? `${source.name} (копия)`);
}

/**
 * Копия изделия и его соединений вне контекста проекта: используется и
 * дубликатом, и вставкой из буфера, чтобы правило «новые id» было одно.
 */
export function duplicateFurnitureData(
  source: Furniture,
  allConnections: HardwareConnection[],
  name: string,
): CabinetCopy {
  const clone: Furniture = structuredClone(source);
  clone.id = newFurnitureId();
  clone.name = name;

  const idMap = new Map<string, string>();
  clone.assemblies = source.assemblies.map((assembly) => {
    const cloned = cloneParts(assembly.parts);
    for (const [from, to] of cloned.idMap) idMap.set(from, to);
    return { ...createAssembly(assembly.name), id: newAssemblyId(), parts: cloned.parts };
  });

  // Соединения копии ссылаются на детали копии, а не оригинала.
  const ownIds = new Set(source.assemblies.flatMap((a) => a.parts.map((p) => String(p.id))));
  const connections = allConnections
    .filter((c) => ownIds.has(String(c.partAId)) && ownIds.has(String(c.partBId)))
    .map((c) => ({
      ...structuredClone(c),
      id: newHardwareConnectionId(),
      partAId: (idMap.get(String(c.partAId)) ?? c.partAId) as HardwareConnection['partAId'],
      partBId: (idMap.get(String(c.partBId)) ?? c.partBId) as HardwareConnection['partBId'],
    }));

  return { furniture: clone, connections };
}

export interface CabinetClipboardFile {
  format: typeof CABINET_CLIPBOARD_FORMAT;
  version: number;
  furniture: Furniture;
  connections: HardwareConnection[];
  /**
   * Материалы и кромка, на которые ссылаются детали (этап 38).
   *
   * Без них шкаф, вставленный в ДРУГОЙ проект, ссылался бы на чужие
   * идентификаторы: детали оставались без материала, и проект переставал
   * годиться для раскроя и спецификации.
   */
  materials?: Material[];
  edges?: EdgeMaterial[];
  /** Фурнитура, на которую ссылаются узлы шкафа (этап 38). */
  hardware?: Hardware[];
}

/** Копировать шкаф в переносимый вид (§96). */
export function copyCabinet(project: Project, id: FurnitureId): string | null {
  const source = findFurniture(project, id);
  if (!source) return null;
  const ownIds = new Set(source.assemblies.flatMap((a) => a.parts.map((p) => String(p.id))));
  const parts = source.assemblies.flatMap((a) => a.parts);
  const usedMaterials = new Set(parts.map((p) => String(p.material)).filter(Boolean));
  const usedEdges = new Set(
    parts.flatMap((p) => Object.values(p.edges)).filter(Boolean).map((e) => String(e)),
  );

  const connections = project.hardwareConnections.filter(
    (c) => ownIds.has(String(c.partAId)) && ownIds.has(String(c.partBId)),
  );
  const usedHardware = new Set(connections.map((c) => String(c.hardwareId)));

  const file: CabinetClipboardFile = {
    format: CABINET_CLIPBOARD_FORMAT,
    version: CABINET_CLIPBOARD_VERSION,
    furniture: source,
    connections,
    // Материалы и крепёж едут вместе со шкафом: в другом проекте у них другие id.
    materials: project.materials.filter((m) => usedMaterials.has(String(m.id))),
    edges: project.edges.filter((e) => usedEdges.has(String(e.id))),
    hardware: project.hardware.filter((h) => usedHardware.has(String(h.id))),
  };
  return JSON.stringify(file);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Вставить шкаф из копии (§96). Как и импорт библиотек, читает ДАННЫЕ: ничего
 * не вычисляется и не выполняется, чужой файл отклоняется.
 */
/**
 * Вставить шкаф из буфера (§96).
 *
 * project — проект, КУДА вставляют: материалы и кромка привязываются к нему
 * (этап 38). Совпадающий по названию и толщине материал используется
 * повторно, недостающий добавляется из буфера. Молча подменять материал
 * другим нельзя: деталь уехала бы в цех не из того листа.
 */
export function pasteCabinet(
  project: Project,
  json: string,
  name?: string,
): CabinetCopy | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.format !== CABINET_CLIPBOARD_FORMAT) return null;
  const source = parsed.furniture;
  if (!isRecord(source) || !Array.isArray(source.assemblies)) return null;

  const furniture = source as unknown as Furniture;
  const connections = Array.isArray(parsed.connections)
    ? (parsed.connections as HardwareConnection[])
    : [];

  // Тот же путь, что и у дубликата: копия получает собственные идентификаторы.
  const copy = duplicateFurnitureData(furniture, connections, name ?? `${furniture.name} (вставка)`);
  return bindLibraries(
    project,
    copy,
    Array.isArray(parsed.materials) ? (parsed.materials as Material[]) : [],
    Array.isArray(parsed.edges) ? (parsed.edges as EdgeMaterial[]) : [],
    Array.isArray(parsed.hardware) ? (parsed.hardware as Hardware[]) : [],
  );
}

/** Одинаковые материалы: то же название и та же толщина. */
const sameMaterial = (a: Material, b: Material) =>
  a.name === b.name && Math.abs(a.thickness - b.thickness) < 1e-6;
const sameEdge = (a: EdgeMaterial, b: EdgeMaterial) =>
  a.name === b.name && Math.abs(a.thickness - b.thickness) < 1e-6;
/** Одинаковый крепёж: тот же вид, название и артикул. */
const sameHardware = (a: Hardware, b: Hardware) =>
  a.category === b.category && a.name === b.name && (a.article ?? '') === (b.article ?? '');

/**
 * Привязать материалы, кромку и крепёж вставленного шкафа к проекту-получателю.
 * Возвращает копию с исправленными ссылками и список позиций, которых в
 * проекте не было и которые нужно добавить вместе со шкафом.
 */
function bindLibraries(
  project: Project,
  copy: CabinetCopy,
  materials: Material[],
  edges: EdgeMaterial[],
  hardware: Hardware[],
): CabinetCopy {
  const materialMap = new Map<string, string>();
  const edgeMap = new Map<string, string>();
  const hardwareMap = new Map<string, string>();
  const newMaterials: Material[] = [];
  const newEdges: EdgeMaterial[] = [];
  const newHardware: Hardware[] = [];

  for (const material of materials) {
    const existing = project.materials.find((m) => sameMaterial(m, material));
    if (existing) {
      materialMap.set(String(material.id), String(existing.id));
    } else if (!project.materials.some((m) => String(m.id) === String(material.id))) {
      newMaterials.push(structuredClone(material));
    }
  }
  for (const edge of edges) {
    const existing = project.edges.find((e) => sameEdge(e, edge));
    if (existing) {
      edgeMap.set(String(edge.id), String(existing.id));
    } else if (!project.edges.some((e) => String(e.id) === String(edge.id))) {
      newEdges.push(structuredClone(edge));
    }
  }

  for (const item of hardware) {
    const existing = project.hardware.find((h) => sameHardware(h, item));
    if (existing) {
      hardwareMap.set(String(item.id), String(existing.id));
    } else if (!project.hardware.some((h) => String(h.id) === String(item.id))) {
      newHardware.push(structuredClone(item));
    }
  }

  for (const assembly of copy.furniture.assemblies) {
    for (const part of assembly.parts) {
      const material = materialMap.get(String(part.material));
      if (material) part.material = material as Part['material'];
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        const mapped = edgeMap.get(String(part.edges[side]));
        if (mapped) part.edges[side] = mapped as Part['edges']['left'];
      }
    }
  }

  const connections = copy.connections.map((c) => {
    const mapped = hardwareMap.get(String(c.hardwareId));
    return mapped ? { ...c, hardwareId: mapped as HardwareConnection['hardwareId'] } : c;
  });

  return {
    ...copy,
    connections,
    materials: newMaterials,
    edges: newEdges,
    hardware: newHardware,
  };
}

// ── Удаление (§97) ───────────────────────────────────────────────────────────

export interface CabinetRemovalImpact {
  furnitureId: string;
  name: string;
  parts: number;
  connections: number;
  machining: number;
}

/** Что исчезнет вместе со шкафом (§97). */
export function cabinetRemovalImpact(project: Project, id: FurnitureId): CabinetRemovalImpact | null {
  const furniture = findFurniture(project, id);
  if (!furniture) return null;
  const parts = furniture.assemblies.flatMap((a) => a.parts);
  const ownIds = new Set(parts.map((p) => String(p.id)));
  return {
    furnitureId: String(id),
    name: furniture.name,
    parts: parts.length,
    connections: project.hardwareConnections.filter(
      (c) => ownIds.has(String(c.partAId)) || ownIds.has(String(c.partBId)),
    ).length,
    machining: parts.reduce((sum, p) => sum + p.machining.length, 0),
  };
}

/**
 * Удалить шкаф вместе с зависимостями (§97). Соединения, потерявшие деталь,
 * удаляются вместе с ним: «мёртвых» узлов и присадки не остаётся.
 */
export function removeCabinet(project: Project, id: FurnitureId): {
  furnitures: Furniture[];
  connections: HardwareConnection[];
} {
  const furniture = findFurniture(project, id);
  const ownIds = new Set(
    (furniture?.assemblies ?? []).flatMap((a) => a.parts.map((p) => String(p.id))),
  );
  return {
    furnitures: project.furnitures.filter((f) => String(f.id) !== String(id)),
    connections: project.hardwareConnections.filter(
      (c) => !ownIds.has(String(c.partAId)) && !ownIds.has(String(c.partBId)),
    ),
  };
}

/** Модель шкафа, как её видит изделие (§101/§102). */
export function cabinetModelOf(furniture: Furniture | undefined): CabinetModel | null {
  if (!furniture) return null;
  const stored = (furniture.params ?? {})[PARAMETRIC_KEY];
  if (!stored || typeof stored !== 'object') return null;
  return toCabinetModel(stored as ParametricModel);
}
