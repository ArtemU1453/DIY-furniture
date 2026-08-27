/**
 * connections.csv (§68) — ведомость соединений.
 *
 * Колонки: Connection, Type, Part A, Part B, Hardware, Quantity, Source,
 * Status, Operations. Количество операций берётся из реальной присадки, а не
 * задаётся вручную (§67).
 */
import type { Project } from '@/core/model/types';
import { findPart } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { connectionNumbers } from './identity';
import { validateConnections } from './validator';

const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function connectionsCsv(project: Project): string {
  const header = [
    'Connection', 'Stable ID', 'Type', 'Part A', 'Part B',
    'Hardware', 'Quantity', 'Source', 'Status', 'Operations',
  ];
  const numbers = connectionNumbers(project.hardwareConnections);
  const statuses = validateConnections(project).statuses;

  // Сколько операций порождает каждое соединение.
  const opCount = new Map<string, number>();
  for (const op of allOperations(project)) {
    const id = op.sourceHardwareConnectionId ? String(op.sourceHardwareConnectionId) : null;
    if (!id) continue;
    opCount.set(id, (opCount.get(id) ?? 0) + 1);
  }

  const rows = project.hardwareConnections.map((c) => {
    const id = String(c.id);
    const partA = findPart(project, c.partAId);
    const partB = findPart(project, c.partBId);
    const hardware = project.hardware.find((h) => h.id === c.hardwareId);
    return [
      numbers.get(id) ?? id,
      c.stableId ?? '',
      c.connectionType ?? '',
      (partA?.metadata?.number as string) ?? partA?.name ?? '',
      (partB?.metadata?.number as string) ?? partB?.name ?? '',
      hardware?.name ?? '',
      String(c.quantity ?? ''),
      c.source ?? 'MANUAL',
      statuses.get(id) ?? '',
      String(opCount.get(id) ?? 0),
    ];
  });

  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n');
}
