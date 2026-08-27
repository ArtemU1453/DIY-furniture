/**
 * Экспорт присадки (§86–§94).
 *
 * MachineExporter — абстракция, а не постпроцессор: под конкретный станок его
 * добавят позже, зарегистрировав ещё одну реализацию. G-code здесь СОЗНАТЕЛЬНО
 * не генерируется (§93): без реального постпроцессора это был бы правдоподобно
 * выглядящий, но неработающий файл — хуже, чем его отсутствие.
 */
import type { MachiningOperation, Part, Project } from '@/core/model/types';
import { allParts, findPart } from '@/core/model/selectors';
import { allOperations } from './generate';
import { sortOperations } from './operations';
import { pickTool, toolLibrary } from './tools';
import { MACHINING_RULE_VERSION } from './result';

export interface MachineExporter {
  id: string;
  name: string;
  /** Расширение файла без точки. */
  extension: string;
  mimeType: string;
  export(project: Project, operations: MachiningOperation[]): string;
}

const sourceOf = (op: MachiningOperation): string =>
  op.source ?? (op.origin === 'manual' ? 'MANUAL' : 'HARDWARE_RULE');

function csv(header: string[], rows: string[][]): string {
  const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n');
}

/**
 * machining.csv (§87/§88).
 * Колонки: Part ID, Operation ID, Type, Tool, Diameter, Depth, X, Y, Face, Source, Status.
 */
export const csvExporter: MachineExporter = {
  id: 'csv',
  name: 'CSV (таблица операций)',
  extension: 'csv',
  mimeType: 'text/csv;charset=utf-8',
  export(project, operations) {
    const header = ['Part ID', 'Operation ID', 'Type', 'Tool', 'Diameter', 'Depth', 'X', 'Y', 'Face', 'Source', 'Status'];
    const tools = toolLibrary(project);
    const rows = sortOperations(operations).map((op) => {
      const part = findPart(project, op.partId);
      const tool = pickTool(tools, op);
      return [
        (part?.metadata?.number as string) ?? String(op.partId),
        String(op.id),
        op.type,
        tool?.name ?? '',
        op.diameter != null ? String(op.diameter) : '',
        op.depth != null ? String(op.depth) : '',
        String(Math.round(op.x * 100) / 100),
        String(Math.round(op.y * 100) / 100),
        op.face,
        sourceOf(op),
        op.status ?? 'VALID',
      ];
    });
    return csv(header, rows);
  },
};

/** machining.json (§86) — полный набор данных, пригодный для обратного импорта. */
export const jsonExporter: MachineExporter = {
  id: 'json',
  name: 'JSON (полные данные)',
  extension: 'json',
  mimeType: 'application/json',
  export(project, operations) {
    const parts = new Map(allParts(project).map((p) => [String(p.id), p]));
    return JSON.stringify({
      format: 'karkas-machining',
      version: 1,
      ruleVersion: MACHINING_RULE_VERSION,
      generatedAt: new Date().toISOString(),
      profile: project.machining.profile ?? null,
      parts: [...parts.values()].map((part) => ({
        id: String(part.id),
        number: (part.metadata?.number as string) ?? '',
        name: part.name,
        width: part.width,
        height: part.height,
        thickness: part.thickness,
        operations: sortOperations(operations.filter((op) => String(op.partId) === String(part.id))).map((op) => ({
          id: String(op.id),
          type: op.type,
          face: op.face,
          x: op.x,
          y: op.y,
          z: op.z,
          diameter: op.diameter ?? null,
          depth: op.depth ?? null,
          through: op.through === true,
          toolType: op.toolType ?? null,
          source: sourceOf(op),
          sequence: op.sequence ?? null,
        })),
      })),
    }, null, 2);
  },
};

const REGISTRY: MachineExporter[] = [jsonExporter, csvExporter];

export function machineExporters(): MachineExporter[] {
  return [...REGISTRY];
}

export function registerMachineExporter(exporter: MachineExporter): void {
  const at = REGISTRY.findIndex((e) => e.id === exporter.id);
  if (at >= 0) REGISTRY[at] = exporter;
  else REGISTRY.push(exporter);
}

export function getMachineExporter(id: string): MachineExporter | undefined {
  return REGISTRY.find((e) => e.id === id);
}

/** Экспорт всей присадки проекта выбранным форматом. */
export function exportMachining(project: Project, exporterId = 'json'): string {
  const exporter = getMachineExporter(exporterId);
  if (!exporter) throw new Error(`Экспортёр «${exporterId}» не зарегистрирован.`);
  return exporter.export(project, allOperations(project));
}

// ── Импорт (§94) ─────────────────────────────────────────────────────────────

export interface ImportedOperation {
  partId: string;
  operation: Partial<MachiningOperation>;
}

export interface MachiningImportResult {
  ok: boolean;
  operations: ImportedOperation[];
  skipped: number;
  error?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Импорт machining.json (§94). Файл — ДАННЫЕ: он разбирается полем за полем,
 * неизвестные ключи отбрасываются, ничего не выполняется.
 */
export function importMachining(json: string): MachiningImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, operations: [], skipped: 0, error: 'Файл не является корректным JSON.' };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.parts)) {
    return { ok: false, operations: [], skipped: 0, error: 'Ожидался файл присадки со списком деталей.' };
  }

  const operations: ImportedOperation[] = [];
  let skipped = 0;
  for (const rawPart of parsed.parts) {
    if (!isRecord(rawPart) || typeof rawPart.id !== 'string' || !Array.isArray(rawPart.operations)) {
      skipped += 1;
      continue;
    }
    for (const rawOp of rawPart.operations) {
      const x = isRecord(rawOp) ? num(rawOp.x) : undefined;
      const y = isRecord(rawOp) ? num(rawOp.y) : undefined;
      if (!isRecord(rawOp) || x == null || y == null || typeof rawOp.face !== 'string') {
        skipped += 1;
        continue;
      }
      operations.push({
        partId: rawPart.id,
        operation: {
          type: (typeof rawOp.type === 'string' ? rawOp.type : 'drilling') as MachiningOperation['type'],
          face: rawOp.face as MachiningOperation['face'],
          x,
          y,
          z: num(rawOp.z) ?? 0,
          diameter: num(rawOp.diameter),
          depth: num(rawOp.depth),
          through: rawOp.through === true,
        },
      });
    }
  }
  return { ok: true, operations, skipped };
}

/** Детали, у которых есть присадка — для постраничной выдачи чертежей (§90). */
export function partsWithMachining(project: Project): Part[] {
  const withOps = new Set(allOperations(project).map((op) => String(op.partId)));
  return allParts(project).filter((p) => withOps.has(String(p.id)));
}
