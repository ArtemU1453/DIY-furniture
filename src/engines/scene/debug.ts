/**
 * Отладочный режим сцены (§130–§136).
 *
 * Показывает то, что уже есть в узле: идентификаторы, положение, поворот и
 * габаритный бокс. Значения округляются до 0.1 мм — как и везде в проекте.
 */
import type { FurnitureScene, SceneNode } from './types';
import { round01 } from './types';

export interface BoundingBox {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  center: { x: number; y: number; z: number };
}

/** Габаритный бокс узла (§132). */
export function nodeBoundingBox(node: SceneNode): BoundingBox {
  const p = node.world.position;
  const half = { x: node.size.x / 2, y: node.size.y / 2, z: node.size.z / 2 };
  return {
    min: { x: round01(p.x - half.x), y: round01(p.y - half.y), z: round01(p.z - half.z) },
    max: { x: round01(p.x + half.x), y: round01(p.y + half.y), z: round01(p.z + half.z) },
    size: { x: round01(node.size.x), y: round01(node.size.y), z: round01(node.size.z) },
    center: { x: round01(p.x), y: round01(p.y), z: round01(p.z) },
  };
}

/** Система координат для показа значений (§134). */
export type CoordinateSpace = 'LOCAL' | 'WORLD';

export interface DebugInfo {
  nodeId: string;
  kind: string;
  refId: string | null;
  space: CoordinateSpace;
  position: { x: number; y: number; z: number };
  /** Поворот в градусах — читать удобнее, чем радианы. */
  rotation: { x: number; y: number; z: number };
  bounds: BoundingBox;
  /** Единицы измерения — всегда мм (§135). */
  unit: 'мм';
}

const deg = (rad: number): number => round01((rad * 180) / Math.PI);

/** Отладочные данные узла (§131/§133/§134). */
export function debugInfo(scene: FurnitureScene, nodeId: string, space: CoordinateSpace = 'WORLD'): DebugInfo | null {
  const node = scene.nodes[nodeId];
  if (!node) return null;
  const t = space === 'WORLD' ? node.world : node.local;
  return {
    nodeId: node.id,
    kind: node.kind,
    refId: node.refId,
    space,
    position: { x: round01(t.position.x), y: round01(t.position.y), z: round01(t.position.z) },
    rotation: { x: deg(t.rotation.x), y: deg(t.rotation.y), z: deg(t.rotation.z) },
    bounds: nodeBoundingBox(node),
    unit: 'мм',
  };
}
