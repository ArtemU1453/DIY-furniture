/**
 * Сборка сцены из ProjectModel (§2–§15).
 *
 * Единственный источник данных — Project. Геометрия детали вычисляется из её
 * параметров существующим адаптером (partTransform), фурнитура — движком
 * фурнитуры, присадка — движком присадки. Ни один размер здесь не хранится
 * повторно: сцена собирается заново из модели, поэтому расходиться нечему.
 */
import type { MachiningOperation, Part, Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { partTransform } from '@/engines/viewer';
import { allOperations } from '@/engines/machining';
import {
  faceToWorld, itemLayout, kindOfItem, projectItems,
} from '@/engines/hardware';
import { faceInfo, partFrame } from '@/core/geometry/coordinateSystem';
import { nodeEdges, nodeMaterial } from './materials';
import { machiningNode } from './machiningViz';
import { hardwareNode } from './hardwareViz';
import {
  composeTransform,
  transform,
  type FurnitureScene,
  type NodeTransform,
  type SceneNode,
} from './types';

export interface SceneBuildOptions {
  /** Включать узлы присадки (§28). Пересчёт операций — самая дорогая часть. */
  includeMachining?: boolean;
  /** Включать узлы фурнитуры (§27). */
  includeHardware?: boolean;
}

const ZERO = { x: 0, y: 0, z: 0 };

function nodeId(kind: string, id: string): string {
  return `${kind}:${id}`;
}

/** Простой детерминированный хэш строки (djb2). */
function hash(source: string): string {
  let h = 5381;
  for (let i = 0; i < source.length; i++) h = ((h << 5) + h + source.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/**
 * Сигнатура модели для отслеживания изменений (§127).
 *
 * В неё входит ровно то, что видно в сцене: детали, их материалы и кромка,
 * фурнитура и присадка. Изменилась сигнатура — сцена устарела.
 */
export function sceneSignature(project: Project, options: SceneBuildOptions = {}): string {
  const parts = allParts(project)
    .map((p) => [
      String(p.id), p.width, p.height, p.thickness, String(p.material ?? '-'), p.grain,
      p.position.x, p.position.y, p.position.z, p.rotation.x, p.rotation.y, p.rotation.z,
      p.edges.left ?? '', p.edges.right ?? '', p.edges.top ?? '', p.edges.bottom ?? '',
    ].join(':'))
    .join('|');
  const items = (project.hardwareInstances ?? [])
    .map((i) => `${i.id}:${String(i.hardwareId)}:${String(i.partId)}:${i.override?.x ?? 0}:${i.override?.y ?? 0}:${i.hidden ? 1 : 0}`)
    .join('|');
  const ops = options.includeMachining === false
    ? ''
    : String(allOperations(project).length);
  return hash([parts, items, ops, project.materials.map((m) => `${String(m.id)}:${m.color}`).join(',')].join('#'));
}

/** Узел детали: геометрия и материал выводятся из Part (§7/§14/§15). */
function partNode(part: Part, project: Project, parentId: string, parentWorld: NodeTransform): SceneNode {
  const t = partTransform(part);
  const local = transform(t.position, t.rotation);
  return {
    id: nodeId('part', String(part.id)),
    kind: 'PART',
    label: part.name,
    parentId,
    childIds: [],
    refId: String(part.id),
    local,
    world: composeTransform(parentWorld, local),
    size: { ...t.size },
    material: nodeMaterial(part, project.materials),
    edges: nodeEdges(part, project.edges),
    hidden: part.metadata?.hidden === true,
  };
}

/**
 * Сборка сцены (§2–§9).
 *
 * Иерархия: Project → Cabinet → Module → Part → Hardware/Machining.
 * Модуль появляется, только если он есть в модели (Assembly) — пустых уровней
 * сцена не выдумывает.
 */
export function buildFurnitureScene(project: Project, options: SceneBuildOptions = {}): FurnitureScene {
  const includeMachining = options.includeMachining !== false;
  const includeHardware = options.includeHardware !== false;

  const nodes: Record<string, SceneNode> = {};
  const order: string[] = [];

  const add = (node: SceneNode): SceneNode => {
    nodes[node.id] = node;
    order.push(node.id);
    if (node.parentId && nodes[node.parentId]) nodes[node.parentId].childIds.push(node.id);
    return node;
  };

  const rootId = nodeId('project', String(project.id));
  const root = add({
    id: rootId,
    kind: 'PROJECT',
    label: project.name,
    parentId: null,
    childIds: [],
    refId: String(project.id),
    local: transform(ZERO, ZERO),
    world: transform(ZERO, ZERO),
    size: { x: 0, y: 0, z: 0 },
  });

  const partNodeByPartId = new Map<string, SceneNode>();
  let parts = 0;
  let modules = 0;

  for (const furniture of project.furnitures) {
    const cabinetLocal = transform(furniture.position, {
      x: furniture.rotation.x, y: furniture.rotation.y, z: furniture.rotation.z,
    });
    const cabinet = add({
      id: nodeId('cabinet', String(furniture.id)),
      kind: 'CABINET',
      label: furniture.name,
      parentId: rootId,
      childIds: [],
      refId: String(furniture.id),
      local: cabinetLocal,
      world: composeTransform(root.world, cabinetLocal),
      size: { x: 0, y: 0, z: 0 },
    });

    for (const assembly of furniture.assemblies) {
      modules += 1;
      const moduleLocal = transform(ZERO, ZERO);
      const moduleNode = add({
        id: nodeId('module', String(assembly.id)),
        kind: 'MODULE',
        label: assembly.name,
        parentId: cabinet.id,
        childIds: [],
        refId: String(assembly.id),
        local: moduleLocal,
        world: composeTransform(cabinet.world, moduleLocal),
        size: { x: 0, y: 0, z: 0 },
      });

      for (const part of assembly.parts) {
        parts += 1;
        const node = add(partNode(part, project, moduleNode.id, moduleNode.world));
        partNodeByPartId.set(String(part.id), node);
      }

      // Габарит модуля — по деталям, а не отдельным полем модели (§15).
      const own = assembly.parts.map((p) => partTransform(p));
      if (own.length > 0) {
        const min = { x: Infinity, y: Infinity, z: Infinity };
        const max = { x: -Infinity, y: -Infinity, z: -Infinity };
        for (const t of own) {
          min.x = Math.min(min.x, t.position.x - t.size.x / 2);
          min.y = Math.min(min.y, t.position.y - t.size.y / 2);
          min.z = Math.min(min.z, t.position.z - t.size.z / 2);
          max.x = Math.max(max.x, t.position.x + t.size.x / 2);
          max.y = Math.max(max.y, t.position.y + t.size.y / 2);
          max.z = Math.max(max.z, t.position.z + t.size.z / 2);
        }
        moduleNode.size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
        cabinet.size = {
          x: Math.max(cabinet.size.x, moduleNode.size.x),
          y: Math.max(cabinet.size.y, moduleNode.size.y),
          z: Math.max(cabinet.size.z, moduleNode.size.z),
        };
      }
    }
  }

  // ── Фурнитура (§8) ────────────────────────────────────────────────────────
  let hardwareCount = 0;
  if (includeHardware) {
    const partsById = new Map(allParts(project).map((p) => [String(p.id), p]));
    for (const item of projectItems(project)) {
      const hardware = project.hardware.find((h) => String(h.id) === String(item.hardwareId));
      const layout = itemLayout(project, item);
      if (!hardware || !layout) continue;
      const parentNode = partNodeByPartId.get(String(item.partId))
        ?? [...partNodeByPartId.values()].find((n) => n.refId === String(item.partId));
      if (!parentNode) continue;
      const part = partsById.get(parentNode.refId ?? '');
      if (!part) continue;

      layout.anchors.forEach((anchor, index) => {
        hardwareCount += 1;
        const world = faceToWorld(part, anchor.face, anchor.x, anchor.y);
        const local = transform(
          {
            x: world.x - parentNode.world.position.x,
            y: world.y - parentNode.world.position.y,
            z: world.z - parentNode.world.position.z,
          },
          { x: 0, y: 0, z: (anchor.rotation * Math.PI) / 180 },
        );
        add(hardwareNode({
          id: nodeId('hardware', `${item.id}:${index}`),
          parentId: parentNode.id,
          parentWorld: parentNode.world,
          local,
          item,
          hardware,
          kind: kindOfItem(item, hardware),
          label: `${hardware.name}${layout.anchors.length > 1 ? ` #${index + 1}` : ''}`,
        }));
      });
    }
  }

  // ── Присадка (§9) ─────────────────────────────────────────────────────────
  let machiningCount = 0;
  if (includeMachining) {
    const partsById = new Map(allParts(project).map((p) => [String(p.id), p]));
    const ops: MachiningOperation[] = allOperations(project);
    for (const op of ops) {
      const parentNode = partNodeByPartId.get(String(op.partId));
      const part = partsById.get(String(op.partId));
      if (!parentNode || !part) continue;
      machiningCount += 1;
      const info = faceInfo(partFrame(part), op.face);
      const world = {
        x: info.corner.x + info.u.x * op.x + info.v.x * op.y,
        y: info.corner.y + info.u.y * op.x + info.v.y * op.y,
        z: info.corner.z + info.u.z * op.x + info.v.z * op.y,
      };
      add(machiningNode({
        id: nodeId('machining', String(op.id)),
        parentId: parentNode.id,
        parentWorld: parentNode.world,
        local: transform(
          {
            x: world.x - parentNode.world.position.x,
            y: world.y - parentNode.world.position.y,
            z: world.z - parentNode.world.position.z,
          },
          ZERO,
        ),
        operation: op,
        normal: info.normal,
      }));
    }
  }

  return {
    rootId,
    nodes,
    order,
    signature: sceneSignature(project, options),
    stats: {
      cabinets: project.furnitures.length,
      modules,
      parts,
      hardware: hardwareCount,
      machining: machiningCount,
    },
  };
}

/** Узлы сцены заданного вида. */
export function nodesOfKind(scene: FurnitureScene, kind: SceneNode['kind']): SceneNode[] {
  return scene.order.map((id) => scene.nodes[id]).filter((n) => n.kind === kind);
}

/** Узел детали по её идентификатору (§84/§85). */
export function nodeOfPart(scene: FurnitureScene, partId: string): SceneNode | undefined {
  return scene.nodes[nodeId('part', partId)];
}

/** Все дети узла, включая вложенные (§13). */
export function descendants(scene: FurnitureScene, id: string): SceneNode[] {
  const out: SceneNode[] = [];
  const stack = [...(scene.nodes[id]?.childIds ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    const node = scene.nodes[next];
    if (!node) continue;
    out.push(node);
    stack.push(...node.childIds);
  }
  return out;
}

/** Цепочка родителей узла до корня (§83). */
export function ancestors(scene: FurnitureScene, id: string): SceneNode[] {
  const out: SceneNode[] = [];
  let current = scene.nodes[id]?.parentId ?? null;
  while (current) {
    const node = scene.nodes[current];
    if (!node) break;
    out.push(node);
    current = node.parentId;
  }
  return out;
}
