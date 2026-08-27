/**
 * Генерация присадки из конструкции проекта.
 *
 * Производные (GENERATED) операции вычисляются из HardwareConnection при каждом
 * обращении — поэтому они всегда актуальны при изменении параметров шкафа
 * (координаты не «застревают»). Ручные (MANUAL) операции хранятся в деталях.
 */
import type { MachiningOperation, MachiningOverride, Part, Project } from '@/core/model/types';
import { allParts, findPart } from '@/core/model/selectors';
import { getMachiningRule } from './rules';

/**
 * Применить ручную правку к автоматической операции (§42). Правка хранится в
 * project.machining.overrides по id операции и переживает пересчёт; операция
 * помечается override: true.
 */
function applyOverride(op: MachiningOperation, overrides: Record<string, MachiningOverride>): MachiningOperation {
  const patch = overrides[op.id];
  if (!patch) return op;
  return { ...op, ...patch, override: true };
}

/**
 * Производные операции из всех связей фурнитуры.
 * Каждая операция ссылается на связь (sourceHardwareConnectionId) и на
 * фурнитуру (hardwareId), чтобы её можно было проследить до крепежа (§31/§60).
 */
export function generateMachining(project: Project): MachiningOperation[] {
  const ops: MachiningOperation[] = [];
  const overrides = project.machining.overrides ?? {};
  for (const conn of project.hardwareConnections) {
    const hardware = project.hardware.find((h) => h.id === conn.hardwareId);
    const partA = findPart(project, conn.partAId);
    const partB = findPart(project, conn.partBId);
    if (!hardware || !partA || !partB) continue;
    const rule = getMachiningRule(hardware.category);
    if (!rule) continue;
    for (const op of rule.build({ connection: conn, hardware, partA, partB })) {
      ops.push(applyOverride({ ...op, hardwareId: hardware.id }, overrides));
    }
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
