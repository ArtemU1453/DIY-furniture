/**
 * Связи фурнитуры с остальной моделью (§86–§89).
 *
 * Всё выводится из ProjectModel: отдельного индекса не заводится, поэтому
 * ответы не могут устареть относительно самой модели.
 */
import type {
  HardwareConnection,
  MachiningOperation,
  Part,
  Project,
} from '@/core/model/types';
import type { HardwareId } from '@/core/model/ids';
import { findPart } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';

/** Все соединения конкретной позиции фурнитуры (§87). */
export function connectionsOfHardware(project: Project, hardwareId: HardwareId | string): HardwareConnection[] {
  return project.hardwareConnections.filter((c) => String(c.hardwareId) === String(hardwareId));
}

/** Все детали, на которых стоит позиция (§86). */
export function partsOfHardware(project: Project, hardwareId: HardwareId | string): Part[] {
  const ids = new Set<string>();
  for (const c of connectionsOfHardware(project, hardwareId)) {
    ids.add(String(c.partAId));
    ids.add(String(c.partBId));
  }
  return [...ids]
    .map((id) => findPart(project, id as Part['id']))
    .filter((p): p is Part => p !== undefined);
}

/** Все операции присадки позиции (§88). */
export function operationsOfHardware(project: Project, hardwareId: HardwareId | string): MachiningOperation[] {
  return allOperations(project).filter((op) => String(op.hardwareId) === String(hardwareId));
}

/** Операции, порождённые конкретным соединением. */
export function operationsOfConnection(project: Project, connectionId: string): MachiningOperation[] {
  return allOperations(project).filter((op) => String(op.sourceHardwareConnectionId) === connectionId);
}

/**
 * Документы, в которых встречается позиция (§89). Спецификация фурнитуры и
 * ведомость присадки содержат её всегда, чертежи деталей — только те, где
 * есть её присадка.
 */
export function documentsOfHardware(project: Project, hardwareId: HardwareId | string): string[] {
  const docs = new Set<string>();
  if (connectionsOfHardware(project, hardwareId).length > 0) {
    docs.add('hardwareList');
    docs.add('summary');
  }
  if (operationsOfHardware(project, hardwareId).length > 0) {
    docs.add('machiningList');
    docs.add('parts');
  }
  return [...docs];
}

/** Что подсветить при выборе позиции в 3D (§48). */
export interface HardwareHighlight {
  partIds: string[];
  connectionIds: string[];
  operationIds: string[];
}

export function highlightForHardware(project: Project, hardwareId: HardwareId | string): HardwareHighlight {
  return {
    partIds: partsOfHardware(project, hardwareId).map((p) => String(p.id)),
    connectionIds: connectionsOfHardware(project, hardwareId).map((c) => String(c.id)),
    operationIds: operationsOfHardware(project, hardwareId).map((op) => String(op.id)),
  };
}
