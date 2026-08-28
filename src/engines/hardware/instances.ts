/**
 * HardwareInstance — установленная единица фурнитуры (§18–§20).
 *
 * Величина ПРОИЗВОДНАЯ: выводится из соединений при каждом обращении.
 * Поэтому количество нигде не хранится отдельно (§17/§85), дублей одной и той
 * же единицы не бывает (§20), а стабильный id (§19) позволяет ссылаться на
 * неё из 3D, документов и таблицы.
 */
import type {
  HardwareConnection,
  HardwareInstance,
  Project,
} from '@/core/model/types';
import type { HardwareId, PartId } from '@/core/model/ids';
import { findPart } from '@/core/model/selectors';

/** Стабильный id единицы: соединение + порядковый номер внутри него. */
export function instanceId(connectionId: string, index: number): string {
  return `${connectionId}#${index + 1}`;
}

/** Сколько единиц крепежа ставит соединение. */
export function unitsOf(connection: HardwareConnection): number {
  const q = connection.quantity;
  return typeof q === 'number' && q > 0 ? Math.floor(q) : 1;
}

/**
 * Единицы одного соединения. Соединение с quantity = 3 (три петли на фасаде)
 * даёт три единицы, а не одну «связь с количеством» (§22).
 */
export function instancesOfConnection(
  project: Project,
  connection: HardwareConnection,
): HardwareInstance[] {
  const partA = findPart(project, connection.partAId);
  const out: HardwareInstance[] = [];
  for (let i = 0; i < unitsOf(connection); i++) {
    out.push({
      id: instanceId(String(connection.id), i),
      hardwareId: connection.hardwareId,
      connectionId: connection.id,
      partId: connection.partAId,
      counterpartId: connection.partBId,
      position: partA ? { ...partA.position } : undefined,
    });
  }
  return out;
}

/**
 * Все установленные единицы проекта.
 *
 * Это единицы соединений ПЛЮС фурнитура, поставленная на деталь напрямую
 * (этап 32). Спецификация, документы и производство читают один и тот же
 * список — второго перечня установленной фурнитуры не существует (§135).
 */
export function allHardwareInstances(project: Project): HardwareInstance[] {
  const fromConnections = project.hardwareConnections.flatMap((c) => instancesOfConnection(project, c));
  const placed = (project.hardwareInstances ?? []).filter((i) => !i.connectionId);
  return [...fromConnections, ...placed];
}

/** Единицы конкретной позиции фурнитуры (§86/§87). */
export function instancesOfHardware(project: Project, hardwareId: HardwareId): HardwareInstance[] {
  return allHardwareInstances(project).filter((i) => String(i.hardwareId) === String(hardwareId));
}

/** Есть ли среди единиц дубликаты по id — инвариант §20. */
export function findDuplicateInstances(instances: HardwareInstance[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const i of instances) {
    if (seen.has(i.id)) dupes.push(i.id);
    seen.add(i.id);
  }
  return dupes;
}

/** Детали, на которых стоит позиция фурнитуры (§86). */
export function partsWithHardware(project: Project, hardwareId: HardwareId): PartId[] {
  const ids = new Set<string>();
  for (const inst of instancesOfHardware(project, hardwareId)) {
    ids.add(String(inst.partId));
    if (inst.counterpartId) ids.add(String(inst.counterpartId));
  }
  return [...ids] as PartId[];
}
