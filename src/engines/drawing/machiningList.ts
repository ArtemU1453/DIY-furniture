/**
 * MACHINING_LIST (§26) — ведомость присадки.
 * Колонки: Operation ID, Part ID, Type, Face, X, Y, Diameter, Depth,
 * Connection, Hardware.
 *
 * Операции берутся из MachiningModel как есть — присадка здесь НЕ
 * пересчитывается (§13).
 */
import type { Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { faceLabel, machiningTypeLabel } from '@/i18n/machining';
import { fmtMm, holeNotation, operationDatum } from './notation';
import { tablePages } from './specification';
import type { TableColumn } from './table';
import type { DrawingDocument } from './sheet';

export interface MachiningListRow {
  operationId: string;
  partId: string;
  partNumber: string;
  type: string;
  face: string;
  x: number;
  y: number;
  diameter: string;
  depth: string;
  datum: string;
  notation: string;
  connection: string;
  hardware: string;
}

/** Строки ведомости присадки в порядке: деталь → последовательность операции. */
export function machiningListRows(project: Project): MachiningListRow[] {
  const partNumber = new Map<string, string>(
    allParts(project).map((p) => [p.id as string, (p.metadata?.number as string) ?? String(p.id)]),
  );
  const hardwareName = new Map<string, string>(project.hardware.map((h) => [h.id as string, h.name]));
  const connNumber = new Map<string, string>(
    project.hardwareConnections.map((c, i) => [c.id as string, `C${String(i + 1).padStart(3, '0')}`]),
  );

  const rows = allOperations(project).map((op) => ({
    operationId: op.metadata?.number as string ?? op.id,
    partId: partNumber.get(op.partId as string) ?? String(op.partId),
    partNumber: partNumber.get(op.partId as string) ?? '',
    type: machiningTypeLabel(op.type),
    face: faceLabel(op.face).replace(/\s*\(.*\)/, ''),
    x: op.x,
    y: op.y,
    diameter: op.diameter != null ? fmtMm(op.diameter) : '—',
    depth: op.through ? 'THRU' : op.depth != null ? fmtMm(op.depth) : '—',
    datum: operationDatum(op),
    notation: holeNotation(op),
    connection: op.sourceHardwareConnectionId
      ? connNumber.get(op.sourceHardwareConnectionId as string) ?? String(op.sourceHardwareConnectionId)
      : '',
    hardware: op.hardwareId ? hardwareName.get(op.hardwareId as string) ?? '' : '',
  }));

  rows.sort((a, b) => a.partId.localeCompare(b.partId, 'ru') || a.operationId.localeCompare(b.operationId, 'ru'));
  return rows;
}

export function buildMachiningListDocument(project: Project): DrawingDocument {
  const cols: TableColumn[] = [
    { title: 'Operation ID', width: 30 },
    { title: 'Part ID', width: 24 },
    { title: 'Type', width: 28 },
    { title: 'Face', width: 24 },
    { title: 'X', width: 18, align: 'end' },
    { title: 'Y', width: 18, align: 'end' },
    { title: 'Ø', width: 16, align: 'end' },
    { title: 'Depth', width: 18, align: 'end' },
    { title: 'База', width: 14 },
    { title: 'Connection', width: 24 },
    { title: 'Hardware', width: 38 },
  ];
  const rows = machiningListRows(project).map((r) => [
    r.operationId, r.partId, r.type, r.face,
    fmtMm(r.x), fmtMm(r.y), r.diameter, r.depth, r.datum, r.connection, r.hardware,
  ]);
  const pages = tablePages(project, 'MACHINING_LIST', 'Ведомость присадки', cols, rows);
  return { id: `doc-machininglist-${project.id}`, type: 'MACHINING_LIST', projectId: project.id, title: 'Ведомость присадки', pages };
}
