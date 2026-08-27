/**
 * Группировка и экспорт операций присадки (§49/§56/§57).
 * Источник данных — MachiningModel; вторая система не создаётся.
 */
import type { MachiningOperation, Project } from '@/core/model/types';
import { findPart } from '@/core/model/selectors';
import { machiningToWorld } from '@/core/geometry/coordinateSystem';

export interface OperationGroup {
  key: string;
  type: MachiningOperation['type'];
  diameter?: number;
  depth?: number;
  through?: boolean;
  count: number;
  operations: MachiningOperation[];
}

/**
 * Сгруппировать одинаковые операции (тип + диаметр + глубина + сквозное).
 * Группа хранит все свои операции — раскрытие показывает каждую отдельно.
 */
export function groupOperations(ops: MachiningOperation[]): OperationGroup[] {
  const groups = new Map<string, OperationGroup>();
  for (const op of ops) {
    const key = `${op.type}|${op.diameter ?? '-'}|${op.depth ?? '-'}|${op.through ? 'T' : 'B'}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.operations.push(op);
    } else {
      groups.set(key, {
        key, type: op.type, diameter: op.diameter, depth: op.depth,
        through: op.through, count: 1, operations: [op],
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * machining_operations.csv (§56).
 * Колонки: Operation ID, Part ID, Type, Face, X, Y, Diameter, Depth,
 * Direction, Connection ID, Hardware ID.
 */
export function machiningOperationsCsv(project: Project, ops: MachiningOperation[]): string {
  const header = ['Operation ID', 'Part ID', 'Type', 'Face', 'X', 'Y', 'Diameter', 'Depth', 'Direction', 'Connection ID', 'Hardware ID'];
  const rows = ops.map((op) => {
    const part = findPart(project, op.partId);
    // Направление инструмента — единичный вектор внутрь детали (§36).
    const dir = part ? machiningToWorld(part, op).inward : { x: 0, y: 0, z: 0 };
    const fmt = (n: number) => (Math.abs(n) < 1e-6 ? '0' : n.toFixed(2));
    return [
      String(op.metadata?.number ?? op.sequence ?? op.id),
      String(part?.metadata?.number ?? op.partId),
      op.type,
      op.face,
      String(Math.round(op.x)),
      String(Math.round(op.y)),
      op.diameter != null ? String(op.diameter) : '',
      // Сквозное отверстие обозначается словом, а не числом-заглушкой (§35).
      op.through ? 'THROUGH' : op.depth != null ? String(op.depth) : '',
      `${fmt(dir.x)};${fmt(dir.y)};${fmt(dir.z)}`,
      op.sourceHardwareConnectionId ? String(op.sourceHardwareConnectionId).slice(0, 8) : '',
      op.hardwareId ? String(op.hardwareId).slice(0, 8) : '',
    ];
  });
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n');
}

/** machining.json (§57) — полная структура MachiningModel. */
export function machiningToJson(project: Project, ops: MachiningOperation[]): string {
  return JSON.stringify(
    {
      projectId: project.id,
      generatedAt: new Date().toISOString(),
      constraints: project.machining.constraints,
      profile: project.machining.profile,
      overrides: project.machining.overrides ?? {},
      operations: ops,
    },
    null,
    2,
  );
}
