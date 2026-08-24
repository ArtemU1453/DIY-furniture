/**
 * Генерация присадки из конструкции проекта.
 *
 * Производные (GENERATED) операции вычисляются из HardwareConnection при каждом
 * обращении — поэтому они всегда актуальны при изменении параметров шкафа
 * (координаты не «застревают»). Ручные (MANUAL) операции хранятся в деталях.
 */
import type { MachiningOperation, Part, Project } from '@/core/model/types';
import { allParts, findPart } from '@/core/model/selectors';
import { getMachiningRule } from './rules';

/** Производные операции из всех связей фурнитуры. */
export function generateMachining(project: Project): MachiningOperation[] {
  const ops: MachiningOperation[] = [];
  for (const conn of project.hardwareConnections) {
    const hardware = project.hardware.find((h) => h.id === conn.hardwareId);
    const partA = findPart(project, conn.partAId);
    const partB = findPart(project, conn.partBId);
    if (!hardware || !partA || !partB) continue;
    const rule = getMachiningRule(hardware.category);
    if (!rule) continue;
    ops.push(...rule.build({ connection: conn, hardware, partA, partB }));
  }
  return ops;
}

/** Ручные операции (хранятся в деталях). */
export function manualOperations(project: Project): MachiningOperation[] {
  return allParts(project).flatMap((p) => p.machining);
}

/** Все операции присадки: производные + ручные, с назначенной нумерацией. */
export function allOperations(project: Project): MachiningOperation[] {
  const combined = [...generateMachining(project), ...manualOperations(project)];
  // Стабильный порядок: по детали, затем по грани, затем по координатам.
  combined.sort((a, b) => {
    if (a.partId !== b.partId) return a.partId.localeCompare(b.partId);
    if (a.face !== b.face) return a.face.localeCompare(b.face);
    return a.x - b.x || a.y - b.y;
  });
  return combined.map((op, i) => ({ ...op, sequence: i + 1 }));
}

/** Операции конкретной детали. */
export function operationsForPart(project: Project, part: Part): MachiningOperation[] {
  return allOperations(project).filter((op) => op.partId === part.id);
}
