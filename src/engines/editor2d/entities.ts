/**
 * Сборка визуальных объектов холста из ProjectModel (§4/§5).
 *
 * Ни одна величина здесь не изобретается: положение и габариты берутся из
 * существующей геометрии деталей (partWorldAABB), модули — из Furniture и его
 * параметрической модели, фурнитура и присадка — из уже посчитанных
 * соединений и операций. Второй системы геометрии не появляется (§7).
 *
 *   Project → Furniture/Part/HardwareConnection/MachiningOperation
 *           → projectAABB(plane) → EditorEntity[]
 */
import { partWorldAABB } from '@/core/geometry/partGeometry';
import { operationWorld } from '@/core/geometry/coordinateSystem';
import { allParts, findPart } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import type { Furniture, Part, Project } from '@/core/model/types';
import { hasParametricModel, readParametricModel } from '@/engines/parametric';
import { projectAABB, projectPoint } from './projection';
import type { EditorEntity, Rect2D, SelectionFilter, ViewPlane } from './types';

/** Габарит изделия по его деталям — модуль показывается по фактическому содержимому. */
function furnitureRect(furniture: Furniture, plane: ViewPlane): Rect2D | null {
  const parts = furniture.assemblies.flatMap((a) => a.parts);
  if (parts.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const part of parts) {
    const r = projectAABB(partWorldAABB(part), plane);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const isHidden = (o: { metadata?: Record<string, unknown> }): boolean => o.metadata?.hidden === true;
const isLocked = (o: { metadata?: Record<string, unknown> }): boolean => o.metadata?.locked === true;

/** Сущности-модули (§5). Модуль — это существующий Furniture, не новый объект. */
export function moduleEntities(project: Project, plane: ViewPlane): EditorEntity[] {
  const out: EditorEntity[] = [];
  for (const furniture of project.furnitures) {
    const rect = furnitureRect(furniture, plane);
    if (!rect) continue;
    const parametric = hasParametricModel(furniture);
    out.push({
      entityId: String(furniture.id),
      entityType: 'MODULE',
      transform: {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        rotation: furniture.rotation.y ?? 0,
        mirrored: furniture.metadata?.mirrored === true,
      },
      selectionState: 'none',
      label: furniture.name,
      locked: isLocked(furniture),
      hidden: isHidden(furniture),
      status: parametric ? undefined : 'WARNING',
    });
  }
  return out;
}

/** Сущности-детали (§5). Габарит берётся из мировой геометрии детали. */
export function partEntities(project: Project, plane: ViewPlane): EditorEntity[] {
  const out: EditorEntity[] = [];
  for (const furniture of project.furnitures) {
    for (const assembly of furniture.assemblies) {
      for (const part of assembly.parts) {
        const rect = projectAABB(partWorldAABB(part), plane);
        out.push({
          entityId: String(part.id),
          entityType: 'PART',
          transform: {
            x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            rotation: part.rotation.y ?? 0,
            mirrored: false,
          },
          selectionState: 'none',
          label: part.name,
          number: (part.metadata?.number as string) ?? undefined,
          parentId: String(furniture.id),
          locked: isLocked(part),
          hidden: isHidden(part),
        });
      }
    }
  }
  return out;
}

/** Условный размер значка фурнитуры и отверстия на виде, мм. */
export const SYMBOL_SIZE = 20;

/**
 * Сущности-фурнитура (§102). Позиция — середина между соединяемыми деталями:
 * собственных координат у HardwareConnection нет, и выдумывать их нельзя.
 */
export function hardwareEntities(project: Project, plane: ViewPlane): EditorEntity[] {
  const hardwareName = new Map(project.hardware.map((h) => [String(h.id), h.name]));
  const out: EditorEntity[] = [];
  for (const conn of project.hardwareConnections) {
    const a = findPart(project, conn.partAId);
    const b = findPart(project, conn.partBId);
    if (!a || !b) continue;
    const ca = partWorldAABB(a);
    const cb = partWorldAABB(b);
    const mid = {
      x: (ca.min.x + ca.max.x + cb.min.x + cb.max.x) / 4,
      y: (ca.min.y + ca.max.y + cb.min.y + cb.max.y) / 4,
      z: (ca.min.z + ca.max.z + cb.min.z + cb.max.z) / 4,
    };
    const p = projectPoint(mid, plane);
    out.push({
      entityId: String(conn.id),
      entityType: 'HARDWARE',
      transform: {
        x: p.x - SYMBOL_SIZE / 2, y: p.y - SYMBOL_SIZE / 2,
        width: SYMBOL_SIZE, height: SYMBOL_SIZE, rotation: 0, mirrored: false,
      },
      selectionState: 'none',
      label: hardwareName.get(String(conn.hardwareId)) ?? 'Крепёж',
      parentId: String(conn.partAId),
      locked: false,
      hidden: false,
      symbolSize: SYMBOL_SIZE,
      status: conn.status === 'ERROR' ? 'ERROR' : conn.status === 'WARNING' ? 'WARNING' : undefined,
    });
  }
  return out;
}

/** Сущности-соединения (§103): линия между центрами деталей узла. */
export function connectionEntities(project: Project, plane: ViewPlane): EditorEntity[] {
  const out: EditorEntity[] = [];
  for (const conn of project.hardwareConnections) {
    const a = findPart(project, conn.partAId);
    const b = findPart(project, conn.partBId);
    if (!a || !b) continue;
    const pa = projectPoint(partWorldAABB(a).min, plane);
    const pb = projectPoint(partWorldAABB(b).max, plane);
    out.push({
      entityId: `conn:${conn.id}`,
      entityType: 'CONNECTION',
      transform: {
        x: Math.min(pa.x, pb.x), y: Math.min(pa.y, pb.y),
        width: Math.abs(pb.x - pa.x), height: Math.abs(pb.y - pa.y),
        rotation: 0, mirrored: false,
      },
      selectionState: 'none',
      label: conn.stableId ?? String(conn.id),
      parentId: String(conn.partAId),
      locked: false,
      hidden: false,
      status: conn.status === 'ERROR' ? 'ERROR' : conn.status === 'WARNING' ? 'WARNING' : undefined,
    });
  }
  return out;
}

/** Отверстие присадки на виде (§104/§105): окружность с центром и диаметром. */
export interface HoleSymbol {
  operationId: string;
  partId: string;
  x: number;
  y: number;
  diameter: number;
  depth: number;
}

export function holeSymbols(project: Project, plane: ViewPlane): HoleSymbol[] {
  /* Присадка ВЫВОДИТСЯ из соединений (§104): part.machining хранит только
   * ручные операции, поэтому берётся полный список из движка присадки —
   * иначе на виде не было бы видно основной, автоматической обработки. */
  const parts = new Map(allParts(project).map((p) => [String(p.id), p]));
  const out: HoleSymbol[] = [];
  for (const op of allOperations(project)) {
    const part = parts.get(String(op.partId));
    if (!part) continue;
    const world = operationWorld(part, op.face, op.x, op.y);
    const p = projectPoint(world.position, plane);
    out.push({
      operationId: String(op.id),
      partId: String(part.id),
      x: p.x,
      y: p.y,
      diameter: op.diameter ?? 0,
      depth: op.depth ?? 0,
    });
  }
  return out;
}

/** Облицованная сторона детали на виде (§106) — отрезок вдоль кромки. */
export interface EdgeSymbol {
  partId: string;
  side: 'left' | 'right' | 'top' | 'bottom';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  materialId: string;
}

export function edgeSymbols(project: Project, plane: ViewPlane): EdgeSymbol[] {
  const out: EdgeSymbol[] = [];
  for (const part of allParts(project)) {
    const rect = projectAABB(partWorldAABB(part), plane);
    const sides: Array<[EdgeSymbol['side'], string | null, [number, number, number, number]]> = [
      ['left', part.edges.left, [rect.x, rect.y, rect.x, rect.y + rect.height]],
      ['right', part.edges.right, [rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height]],
      ['top', part.edges.top, [rect.x, rect.y + rect.height, rect.x + rect.width, rect.y + rect.height]],
      ['bottom', part.edges.bottom, [rect.x, rect.y, rect.x + rect.width, rect.y]],
    ];
    for (const [side, materialId, [x1, y1, x2, y2]] of sides) {
      if (!materialId) continue;
      out.push({ partId: String(part.id), side, x1, y1, x2, y2, materialId: String(materialId) });
    }
  }
  return out;
}

export interface BuildEntitiesOptions {
  plane: ViewPlane;
  filter?: Partial<SelectionFilter>;
  /** Показывать фурнитуру условными обозначениями (§102). */
  showHardware?: boolean;
  /** Показывать соединения (§103). */
  showConnections?: boolean;
}

/** Все сущности холста для вида. */
export function buildEntities(project: Project, options: BuildEntitiesOptions): EditorEntity[] {
  const { plane } = options;
  const filter = options.filter ?? {};
  const out: EditorEntity[] = [];
  if (filter.MODULE !== false) out.push(...moduleEntities(project, plane));
  if (filter.PART !== false) out.push(...partEntities(project, plane));
  if (filter.HARDWARE !== false && options.showHardware !== false) out.push(...hardwareEntities(project, plane));
  if (filter.CONNECTION !== false && options.showConnections === true) out.push(...connectionEntities(project, plane));
  return out;
}

/** Найти сущность по идентификатору. */
export function findEntity(entities: EditorEntity[], entityId: string): EditorEntity | undefined {
  return entities.find((e) => e.entityId === entityId);
}

/** Реальная деталь проекта для сущности типа PART. */
export function partOfEntity(project: Project, entity: EditorEntity): Part | undefined {
  if (entity.entityType !== 'PART') return undefined;
  return allParts(project).find((p) => String(p.id) === entity.entityId);
}

/** Реальное изделие проекта для сущности типа MODULE. */
export function furnitureOfEntity(project: Project, entity: EditorEntity): Furniture | undefined {
  if (entity.entityType !== 'MODULE') return undefined;
  return project.furnitures.find((f) => String(f.id) === entity.entityId);
}

/** Параметрическая модель модуля, если она есть. */
export function modelOfEntity(project: Project, entity: EditorEntity) {
  const furniture = furnitureOfEntity(project, entity);
  if (!furniture || !hasParametricModel(furniture)) return null;
  return readParametricModel(furniture);
}
