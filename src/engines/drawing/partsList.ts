/**
 * PARTS_LIST — спецификация деталей: позиция, P-ID, наименование, количество,
 * габариты, материал, кромка. Одинаковые детали группируются. Данные берутся
 * из производственной модели (Part), без повторного расчёта.
 */
import type { Part, Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { positionNumbers } from './positions';
import { tablePages } from './specification';
import type { TableColumn } from './table';
import type { DrawingDocument } from './sheet';

const planeDims = (p: Part) => ({ length: Math.max(p.width, p.height), width: Math.min(p.width, p.height) });

/** Компактное описание кромки: стороны с кромкой (Л/П/В/Н). */
function edgeSummary(project: Project, part: Part): string {
  const has = (id: string | null) => id != null;
  const sides: string[] = [];
  if (has(part.edges.left)) sides.push('Л');
  if (has(part.edges.right)) sides.push('П');
  if (has(part.edges.top)) sides.push('В');
  if (has(part.edges.bottom)) sides.push('Н');
  if (sides.length === 0) return '—';
  // Толщина кромки берётся из первой найденной стороны.
  const firstId = part.edges.left ?? part.edges.right ?? part.edges.top ?? part.edges.bottom;
  const edge = project.edges.find((e) => e.id === firstId);
  return `${sides.join(',')}${edge ? ` (${edge.thickness})` : ''}`;
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
}

/** Сгруппированные строки спецификации деталей. */
export function partsListRows(project: Project): PartsListRow[] {
  const positions = positionNumbers(project);
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
    { title: 'Материал', width: 56 },
    { title: 'Кромка', width: 26 },
  ];
  const rows = partsListRows(project).map((r) => [
    String(r.position), r.ids, r.name, String(r.quantity),
    String(r.length), String(r.width), String(r.thickness), r.material, r.edge,
  ]);
  const pages = tablePages(project, 'PARTS_LIST', 'Спецификация деталей', cols, rows);
  return { id: `doc-partslist-${project.id}`, type: 'PARTS_LIST', projectId: project.id, title: 'Спецификация деталей', pages };
}
