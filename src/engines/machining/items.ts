/**
 * Присадка от установленной фурнитуры (этап 32, §82–§85).
 *
 * Операции ПРОИЗВОДНЫЕ: они пересчитываются из положения единицы и правила её
 * вида при каждом обращении. Поэтому перемещение фурнитуры или изменение
 * детали сразу двигает отверстия — хранить координаты не нужно.
 *
 * Модуль импортирует только чистые правила видов (без обратной зависимости на
 * движок фурнитуры), поэтому цикла между movками не возникает.
 */
import type { MachiningOperation, MachiningOverride, Project } from '@/core/model/types';
import type { MachiningId } from '@/core/model/ids';
import { allParts } from '@/core/model/selectors';
import { resolveHardwareItem, resolveItemPart } from '@/engines/hardware/parametric';

/** Стабильный id операции единицы фурнитуры (§84). */
export function itemOperationId(itemId: string, key: string): string {
  return `hw:${itemId}:${key}`;
}

function applyOverride(op: MachiningOperation, overrides: Record<string, MachiningOverride>): MachiningOperation {
  const patch = overrides[op.id];
  return patch ? { ...op, ...patch, override: true } : op;
}

/**
 * Операции присадки от всех единиц фурнитуры проекта (§82/§134).
 *
 * Единицы, порождённые соединениями, здесь пропускаются: их присадку уже
 * строит существующий генератор по связям — второй раз считать нельзя.
 */
export function generateItemMachining(project: Project): MachiningOperation[] {
  const items = project.hardwareInstances ?? [];
  if (items.length === 0) return [];

  const overrides = project.machining.overrides ?? {};
  const ops: MachiningOperation[] = [];
  const parts = allParts(project);

  for (const item of items) {
    if (item.connectionId) continue;
    const hardware = project.hardware.find((h) => h.id === item.hardwareId);
    const part = resolveItemPart(parts, item);
    if (!hardware || !part) continue;

    const result = resolveHardwareItem(item, hardware, part);
    for (const op of result.operations) {
      ops.push(applyOverride({
        id: itemOperationId(item.id, op.key) as unknown as MachiningId,
        type: op.type,
        partId: part.id,
        face: op.face,
        x: op.x,
        y: op.y,
        z: op.z ?? 0,
        diameter: op.diameter,
        depth: op.depth,
        length: op.length,
        width: op.width,
        through: op.through,
        origin: 'generated',
        hardwareId: hardware.id,
        source: 'HARDWARE_RULE',
        parameters: { role: op.role, itemId: item.id },
      }, overrides));
    }
  }
  return ops;
}
