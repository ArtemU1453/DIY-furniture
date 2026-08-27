/**
 * PARTS_LIST — спецификация деталей: позиция, P-ID, наименование, количество,
 * габариты, материал, кромка. Одинаковые детали группируются. Данные берутся
 * из производственной модели (Part), без повторного расчёта.
 */
import type { Part, Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { edgeCount } from '@/engines/edges';
import { edgeCode, fmtMm } from './notation';
import { positionNumbers } from './positions';
import { tablePages } from './specification';
import type { TableColumn } from './table';
import type { DrawingDocument } from './sheet';

const planeDims = (p: Part) => ({ length: Math.max(p.width, p.height), width: Math.min(p.width, p.height) });

/**
 * Кромка в едином формате проекта (§16): L1/L2/L3/L4 = низ/право/верх/лево,
 * например «0.4/2/2/0.4». Тот же формат идёт и на чертёж детали, и в CSV.
 */
function edgeSummary(project: Project, part: Part): string {
  return edgeCode(project, part);
}

export interface PartsListRow {
  position: number;
  ids: string; // P-ID(ы)
  name: string;
  quantity: number;
  length: number;
  width: number;
  thickness: number;
  material: string;
  edge: string;
  /** Сколько соединений приходится на деталь (§65). */
  connections: number;
  /** Сколько сторон детали облицовано кромкой (§64). */
  edgeCount: number;
  /** Примечание: не выдумывается, берётся из metadata.note или пустое (§24). */
  note: string;
}

/** Сгруппированные строки спецификации деталей. */
export function partsListRows(project: Project): PartsListRow[] {
  const positions = positionNumbers(project);
  // Число соединений детали считается из модели, а не вводится вручную (§65).
  const connectionCount = new Map<string, number>();
  for (const c of project.hardwareConnections) {
    for (const id of [String(c.partAId), String(c.partBId)]) {
      connectionCount.set(id, (connectionCount.get(id) ?? 0) + 1);
    }
  }
  const matName = new Map(project.materials.map((m) => [m.id, m.name]));
  const opsByPart = new Map<string, string>();
  for (const op of allOperations(project)) {
    const sig = `${op.type}:${Math.round(op.x)}:${Math.round(op.y)}:${op.diameter}:${op.depth}:${op.face}`;
    opsByPart.set(op.partId, (opsByPart.get(op.partId) ?? '') + '|' + sig);
  }

  const groups = new Map<string, { row: PartsListRow; ids: string[] }>();
  for (const p of allParts(project)) {
    const d = planeDims(p);
    const edgesSig = `${p.edges.left}|${p.edges.right}|${p.edges.top}|${p.edges.bottom}`;
    const key = `${d.length}x${d.width}x${p.thickness}|${p.material}|${edgesSig}|${opsByPart.get(p.id) ?? ''}|${p.name}`;
    const num = (p.metadata?.number as string) ?? '';
    const existing = groups.get(key);
    if (existing) {
      existing.row.quantity += p.quantity;
      existing.row.connections += connectionCount.get(String(p.id)) ?? 0;
      existing.ids.push(num);
    } else {
      groups.set(key, {
        ids: [num],
        row: {
          position: positions.get(p.id) ?? 0,
          ids: num,
          name: p.name,
          quantity: p.quantity,
          length: d.length,
          width: d.width,
          thickness: p.thickness,
          material: p.material ? matName.get(p.material) ?? '—' : '—',
          edge: edgeSummary(project, p),
          connections: connectionCount.get(String(p.id)) ?? 0,
          edgeCount: edgeCount(project, p),
          note: (p.metadata?.note as string) ?? '',
        },
      });
    }
  }
  const rows = [...groups.values()].map((g) => ({ ...g.row, ids: g.ids.join(', ') }));
  rows.sort((a, b) => a.position - b.position);
  return rows;
}

export function buildPartsListDocument(project: Project): DrawingDocument {
  const cols: TableColumn[] = [
    { title: 'Поз', width: 12, align: 'end' },
    { title: 'ID', width: 26 },
    { title: 'Наименование', width: 66 },
    { title: 'Кол', width: 12, align: 'end' },
    { title: 'Длина', width: 20, align: 'end' },
    { title: 'Ширина', width: 20, align: 'end' },
    { title: 'Толщ', width: 14, align: 'end' },
    { title: 'Материал', width: 50 },
    { title: 'Кромка', width: 28 },
    { title: 'EB', width: 12, align: 'end' },
    { title: 'Соед.', width: 14, align: 'end' },
    { title: 'Примечание', width: 28 },
  ];
  const rows = partsListRows(project).map((r) => [
    String(r.position), r.ids, r.name, String(r.quantity),
    fmtMm(r.length), fmtMm(r.width), fmtMm(r.thickness), r.material, r.edge,
    String(r.edgeCount), String(r.connections), r.note,
  ]);
  const pages = tablePages(project, 'PARTS_LIST', 'Спецификация деталей', cols, rows);
  return { id: `doc-partslist-${project.id}`, type: 'PARTS_LIST', projectId: project.id, title: 'Спецификация деталей', pages };
}
