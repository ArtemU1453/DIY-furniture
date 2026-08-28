/**
 * Визуализация присадки (§9, §101–§107).
 *
 * Операции берутся из существующей системы присадки как есть: сцена только
 * решает, чем их нарисовать — отверстием, пазом, карманом или вырезом.
 */
import type { MachiningOperation, Vec3 } from '@/core/model/types';
import { composeTransform, type NodeMachining, type NodeTransform, type SceneNode } from './types';

/** Как рисовать операцию (§101–§105). */
export function machiningShape(type: MachiningOperation['type']): NodeMachining['shape'] {
  switch (type) {
    case 'slot':
    case 'groove': return 'GROOVE';
    case 'pocket': return 'POCKET';
    case 'cutout':
    case 'cut':
    case 'mill': return 'CUTOUT';
    case 'drilling':
    case 'boring':
    case 'dowel':
    case 'confirmat':
    default: return 'HOLE';
  }
}

/** Размер визуального элемента операции, мм. */
export function machiningSize(op: MachiningOperation): { x: number; y: number; z: number } {
  const shape = machiningShape(op.type);
  const depth = op.through ? Math.max(op.depth ?? 0, 1) : (op.depth ?? 1);
  if (shape === 'HOLE') {
    const d = op.diameter ?? 5;
    return { x: d, y: d, z: depth };
  }
  return {
    x: op.length ?? op.diameter ?? 10,
    y: op.width ?? op.diameter ?? 10,
    z: depth,
  };
}

export interface MachiningNodeInput {
  id: string;
  parentId: string;
  parentWorld: NodeTransform;
  local: NodeTransform;
  operation: MachiningOperation;
  /** Внешняя нормаль грани — направление сверления (§102). */
  normal: Vec3;
}

/** Узел операции присадки (§9/§106/§107). */
export function machiningNode(input: MachiningNodeInput): SceneNode {
  const op = input.operation;
  const visual: NodeMachining = {
    operationId: String(op.id),
    type: op.type,
    face: op.face,
    x: op.x,
    y: op.y,
    diameter: op.diameter ?? 0,
    depth: op.depth ?? 0,
    length: op.length,
    width: op.width,
    through: op.through === true,
    // Сверлят внутрь детали, поэтому направление противоположно нормали грани.
    direction: { x: -input.normal.x, y: -input.normal.y, z: -input.normal.z },
    shape: machiningShape(op.type),
  };
  return {
    id: input.id,
    kind: 'MACHINING',
    label: `${op.type} ${op.diameter ? `Ø${op.diameter}` : ''}`.trim(),
    parentId: input.parentId,
    childIds: [],
    refId: String(op.id),
    local: input.local,
    world: composeTransform(input.parentWorld, input.local),
    size: machiningSize(op),
    machining: visual,
  };
}
