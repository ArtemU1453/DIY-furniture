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
import { faceInfo, partFrame } from '@/core/geometry/coordinateSystem';

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
    const count = resolveCount(connection, hardware, num(p.count, 2));
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
    const count = resolveCount(connection, hardware, num(p.count, 2));
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

// ── Общие помощники расположения на грани одной детали ────────────────────────
const resolveCount = (c: HardwareConnection, h: Hardware, fallback: number): number =>
  num(c.quantity, num(c.parameters?.count, num(h.parameters?.count, fallback)));

/** Равномерно распределить `count` точек вдоль размера с отступом от краёв. */
function distribute(size: number, count: number, edgeOffset: number): number[] {
  const clampOff = Math.min(edgeOffset, size / (count + 1));
  if (count <= 1) return [size / 2];
  const usable = size - 2 * clampOff;
  return Array.from({ length: count }, (_, i) => clampOff + usable * (i / (count - 1)));
}

/** Отверстия на конкретной грани одной детали. */
function faceHoles(
  part: Part,
  face: PartFace,
  connectionId: string,
  role: string,
  type: MachiningType,
  holes: Array<{ x: number; y: number }>,
  diameter: number,
  depth: number,
  through: boolean,
): MachiningOperation[] {
  return holes.map((hpt, i) => makeOp({ type, partId: part.id, face, x: hpt.x, y: hpt.y, diameter, depth, through }, connectionId, `${role}:${i}`));
}

// ── Минификс / эксцентрик ─────────────────────────────────────────────────────
export const minifixRule: MachiningRule = {
  category: 'minifix',
  build({ connection, hardware, partA, partB }) {
    const p = hardware.parameters ?? {};
    const count = resolveCount(connection, hardware, 2);
    const edgeOffset = num(connection.parameters?.edgeOffset, num(p.edgeOffset, 32));
    const joint = analyzeJoint(partA, partB, { count, edgeOffset });
    if (!joint) return [];
    const camD = num(p.camDiameter, 15);
    const camDepth = Math.min(num(p.camDepth, joint.through.thickness / 2 + 1), joint.through.thickness - 1);
    const rodD = num(p.rodDiameter, 8);
    const rodDepth = num(p.rodDepth, 34);
    // Корпус эксцентрика (глухая присадка) в пласть проходной детали + шток в торец.
    return [
      ...planHoles(joint.through, connection.id, 'cam', 'boring', camD, camDepth, false),
      ...planHoles(joint.receiving, connection.id, 'rod', 'dowel', rodD, rodDepth, false),
    ];
  },
};

// ── Саморез ───────────────────────────────────────────────────────────────────
export const screwRule: MachiningRule = {
  category: 'screw',
  build({ connection, hardware, partA, partB }) {
    const p = hardware.parameters ?? {};
    const count = resolveCount(connection, hardware, 3);
    const edgeOffset = num(connection.parameters?.edgeOffset, num(p.edgeOffset, 40));
    const joint = analyzeJoint(partA, partB, { count, edgeOffset });
    if (!joint) return [];
    const clearance = num(p.diameter, 4) + 1;
    const pilot = num(p.pilotDiameter, num(p.diameter, 4) - 1.5);
    const length = num(p.length, 30);
    return [
      ...planHoles(joint.through, connection.id, 'clear', 'drilling', clearance, joint.through.thickness, true),
      ...planHoles(joint.receiving, connection.id, 'pilot', 'drilling', pilot, Math.max(1, length - joint.through.thickness), false),
    ];
  },
};

// ── Уголок (bracket) ──────────────────────────────────────────────────────────
export const cornerRule: MachiningRule = {
  category: 'corner',
  build({ connection, hardware, partA, partB }) {
    const p = hardware.parameters ?? {};
    const count = resolveCount(connection, hardware, 1);
    const edgeOffset = num(connection.parameters?.edgeOffset, num(p.edgeOffset, 30));
    const joint = analyzeJoint(partA, partB, { count, edgeOffset });
    if (!joint) return [];
    const d = num(p.diameter, 4);
    return [
      ...planHoles(joint.through, connection.id, 'a', 'drilling', d, Math.max(1, joint.through.thickness / 2), false),
      ...planHoles(joint.receiving, connection.id, 'b', 'drilling', d, Math.max(1, joint.receiving.thickness / 2), false),
    ];
  },
};

// ── Петля ─────────────────────────────────────────────────────────────────────
export const hingeRule: MachiningRule = {
  category: 'hinge',
  build({ connection, hardware, partA, partB }) {
    const p = hardware.parameters ?? {};
    const count = resolveCount(connection, hardware, 2);
    const cupD = num(p.cupDiameter, 35);
    const cupDepth = Math.min(num(p.cupDepth, 12.5), Math.max(1, partA.thickness - 1));
    const cupOffset = num(p.cupEdgeOffset, 22.5);
    const screwD = num(p.screwDiameter, 2.5);
    const facEdge = num(p.edgeOffset, 90);
    // Чашка петли на фасаде (partA), тыльная грань.
    const facFace = faceInfo(partFrame(partA), 'back');
    const ys = distribute(facFace.vSize, count, facEdge);
    const cups = faceHoles(partA, 'back', connection.id, 'cup', 'hinge', ys.map((y) => ({ x: Math.min(cupOffset, facFace.uSize - 5), y })), cupD, cupDepth, false);
    const facScrews = ys.flatMap((y, i) =>
      [-1, 1].map((s, j) => makeOp({ type: 'drilling', partId: partA.id, face: 'back', x: Math.min(cupOffset, facFace.uSize - 5), y: y + s * 24, diameter: screwD, depth: 8, through: false }, connection.id, `fscrew:${i}:${j}`)),
    );
    // Ответная планка на боковине (partB).
    const sideFace = faceInfo(partFrame(partB), 'front');
    const sideYs = distribute(sideFace.vSize, count, facEdge);
    const sideScrews = faceHoles(partB, 'front', connection.id, 'sscrew', 'drilling', sideYs.map((y) => ({ x: Math.min(37, sideFace.uSize - 5), y })), screwD, 8, false);
    return [...cups, ...facScrews, ...sideScrews];
  },
};

// ── Ручка ─────────────────────────────────────────────────────────────────────
export const handleRule: MachiningRule = {
  category: 'handle',
  build({ connection, hardware, partA }) {
    const p = hardware.parameters ?? {};
    const cd = num(p.centerDistance, 96);
    const holeD = num(p.diameter, 5);
    const fi = faceInfo(partFrame(partA), 'front');
    const cx = fi.uSize / 2;
    const y = Math.min(num(p.edgeOffset, 40), fi.vSize - 10);
    return [
      makeOp({ type: 'drilling', partId: partA.id, face: 'front', x: Math.max(2, cx - cd / 2), y, diameter: holeD, depth: partA.thickness, through: true }, connection.id, 'h:0'),
      makeOp({ type: 'drilling', partId: partA.id, face: 'front', x: Math.min(fi.uSize - 2, cx + cd / 2), y, diameter: holeD, depth: partA.thickness, through: true }, connection.id, 'h:1'),
    ];
  },
};

// ── Опора (ножка) ─────────────────────────────────────────────────────────────
export const legRule: MachiningRule = {
  category: 'leg',
  build({ connection, hardware, partA }) {
    const p = hardware.parameters ?? {};
    const inset = num(p.edgeOffset, 50);
    const d = num(p.diameter, 8);
    const depth = Math.min(num(p.depth, 12), Math.max(1, partA.thickness - 2));
    const fi = faceInfo(partFrame(partA), 'bottom');
    const xs = [inset, Math.max(inset, fi.uSize - inset)];
    const ys = [inset, Math.max(inset, fi.vSize - inset)];
    const holes = xs.flatMap((x) => ys.map((y) => ({ x, y })));
    return faceHoles(partA, 'bottom', connection.id, 'leg', 'drilling', holes, d, depth, false);
  },
};

// ── Направляющая ящика ────────────────────────────────────────────────────────
export const slideRule: MachiningRule = {
  category: 'slide',
  build({ connection, hardware, partA, partB }) {
    const p = hardware.parameters ?? {};
    const count = resolveCount(connection, hardware, 3);
    const d = num(p.diameter, 4);
    const faceA = faceInfo(partFrame(partA), 'front');
    const yA = Math.min(num(p.position, 100), faceA.vSize - 10);
    const rowA = faceHoles(partA, 'front', connection.id, 'sa', 'drilling', distribute(faceA.uSize, count, num(p.edgeOffset, 30)).map((x) => ({ x, y: yA })), d, 8, false);
    const faceB = faceInfo(partFrame(partB), 'front');
    const yB = Math.min(num(p.position, 100), faceB.vSize - 10);
    const rowB = faceHoles(partB, 'front', connection.id, 'sb', 'drilling', distribute(faceB.uSize, count, num(p.edgeOffset, 30)).map((x) => ({ x, y: yB })), d, 8, false);
    return [...rowA, ...rowB];
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
registerMachiningRule(minifixRule);
registerMachiningRule(screwRule);
registerMachiningRule(cornerRule);
registerMachiningRule(hingeRule);
registerMachiningRule(handleRule);
registerMachiningRule(legRule);
registerMachiningRule(slideRule);
