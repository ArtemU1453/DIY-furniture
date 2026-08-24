/**
 * Правила присадки: превращают конструктивную связь (HardwareConnection) в
 * технологические операции. Правила зарегистрированы по категории фурнитуры и
 * задают лишь технологию (диаметры/глубины/количество); расположение отверстий
 * выводится из геометрии соединения (joint.ts).
 *
 *   Hardware → HardwareConnection → MachiningRule → MachiningOperation[]
 */
import type {
  Hardware,
  HardwareConnection,
  MachiningOperation,
  MachiningType,
  Part,
  PartFace,
} from '@/core/model/types';
import type { HardwareCategory } from '@/core/model/types';
import type { MachiningId } from '@/core/model/ids';
import { analyzeJoint, type JointSidePlan } from './joint';

export interface RuleInput {
  connection: HardwareConnection;
  hardware: Hardware;
  partA: Part;
  partB: Part;
}

export interface MachiningRule {
  category: HardwareCategory;
  build(input: RuleInput): MachiningOperation[];
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Детерминированный id производной операции (стабилен между пересчётами). */
function genId(connectionId: string, key: string): MachiningId {
  return `gen:${connectionId}:${key}` as MachiningId;
}

interface DrillSpec {
  type: MachiningType;
  partId: Part['id'];
  face: PartFace;
  x: number;
  y: number;
  diameter: number;
  depth: number;
  through: boolean;
}

function makeOp(spec: DrillSpec, connectionId: string, key: string): MachiningOperation {
  return {
    id: genId(connectionId, key),
    type: spec.type,
    partId: spec.partId,
    face: spec.face,
    x: spec.x,
    y: spec.y,
    z: 0,
    diameter: spec.diameter,
    depth: spec.depth,
    through: spec.through,
    origin: 'generated',
    sourceHardwareConnectionId: connectionId as HardwareConnection['id'],
  };
}

function planHoles(
  plan: JointSidePlan,
  connectionId: string,
  role: string,
  type: MachiningType,
  diameter: number,
  depth: number,
  through: boolean,
): MachiningOperation[] {
  return plan.holes.map((h, i) =>
    makeOp(
      { type, partId: plan.part.id, face: plan.face, x: h.x, y: h.y, diameter, depth, through },
      connectionId,
      `${role}:${i}`,
    ),
  );
}

// ── Шкант ─────────────────────────────────────────────────────────────────────
export const dowelRule: MachiningRule = {
  category: 'dowel',
  build({ connection, hardware, partA, partB }) {
    const p = hardware.parameters ?? {};
    const diameter = num(p.diameter, 8);
    const length = num(p.length, 30);
    const count = num(connection.parameters?.count, num(p.count, 2));
    const edgeOffset = num(connection.parameters?.edgeOffset, num(p.edgeOffset, 50));

    const joint = analyzeJoint(partA, partB, { count, edgeOffset });
    if (!joint) return [];

    // Шкант — симметрично: глухое отверстие в каждой детали на половину длины.
    const halfInThrough = Math.min(length / 2, joint.through.thickness - 1);
    const depthReceiving = Math.min(length / 2, joint.receiving.thickness * 4); // в торец
    return [
      ...planHoles(joint.through, connection.id, 'through', 'dowel', diameter, halfInThrough, false),
      ...planHoles(joint.receiving, connection.id, 'recv', 'dowel', diameter, depthReceiving, false),
    ];
  },
};

// ── Конфирмат ─────────────────────────────────────────────────────────────────
export const confirmatRule: MachiningRule = {
  category: 'confirmat',
  build({ connection, hardware, partA, partB }) {
    const p = hardware.parameters ?? {};
    const diameter = num(p.diameter, 7);
    const length = num(p.length, 50);
    const pilotDiameter = num(p.pilotDiameter, 5);
    const count = num(connection.parameters?.count, num(p.count, 2));
    const edgeOffset = num(connection.parameters?.edgeOffset, num(p.edgeOffset, 32));

    const joint = analyzeJoint(partA, partB, { count, edgeOffset });
    if (!joint) return [];

    // Проходная деталь: сквозное отверстие под тело; принимающая: направляющее в торец.
    const depthReceiving = Math.max(1, length - joint.through.thickness);
    return [
      ...planHoles(joint.through, connection.id, 'through', 'confirmat', diameter, joint.through.thickness, true),
      ...planHoles(joint.receiving, connection.id, 'recv', 'confirmat', pilotDiameter, depthReceiving, false),
    ];
  },
};

// ── Реестр правил ────────────────────────────────────────────────────────────
const registry = new Map<HardwareCategory, MachiningRule>();

export function registerMachiningRule(rule: MachiningRule): void {
  registry.set(rule.category, rule);
}
export function getMachiningRule(category: HardwareCategory): MachiningRule | undefined {
  return registry.get(category);
}

registerMachiningRule(dowelRule);
registerMachiningRule(confirmatRule);
