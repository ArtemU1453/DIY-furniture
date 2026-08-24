/**
 * SPECIFICATION — спецификация деталей (одинаковые группируются по всем
 * производственным параметрам), а также спецификация фурнитуры и кромки.
 */
import type { Part, Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { calculateEdges } from '@/engines/bom/edgeCalculator';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { finalizeScene, type Prim } from './scene';
import { tablePrims, tableWidth, type TableColumn } from './table';
import { contentArea, type DrawingDocument, type DrawingPage, type Orientation, type SheetFormat } from './sheet';

const FORMAT: SheetFormat = 'A3';
const ORIENT: Orientation = 'LANDSCAPE';
const ROW_H = 7;

export interface SpecGroupRow {
  numbers: string;
  name: string;
  quantity: number;
  length: number;
  width: number;
  thickness: number;
  materialName: string;
}

const planeDims = (p: Part) => ({ length: Math.max(p.width, p.height), width: Math.min(p.width, p.height) });

/** Сгруппировать одинаковые детали (совпадают размеры/материал/кромка/присадка). */
export function groupParts(project: Project): SpecGroupRow[] {
  const opsByPart = new Map<string, string>();
  for (const op of allOperations(project)) {
    const sig = `${op.type}:${Math.round(op.x)}:${Math.round(op.y)}:${op.diameter}:${op.depth}:${op.face}`;
    opsByPart.set(op.partId, (opsByPart.get(op.partId) ?? '') + '|' + sig);
  }
  const matName = new Map(project.materials.map((m) => [m.id, m.name]));

  const groups = new Map<string, { row: SpecGroupRow; numbers: string[] }>();
  for (const p of allParts(project)) {
    const d = planeDims(p);
    const edgesSig = `${p.edges.left}|${p.edges.right}|${p.edges.top}|${p.edges.bottom}`;
    const key = `${d.length}x${d.width}x${p.thickness}|${p.material}|${edgesSig}|${opsByPart.get(p.id) ?? ''}|${p.name}`;
    const num = (p.metadata?.number as string) ?? '';
    const existing = groups.get(key);
    if (existing) {
      existing.row.quantity += p.quantity;
      existing.numbers.push(num);
    } else {
      groups.set(key, {
        numbers: [num],
        row: { numbers: num, name: p.name, quantity: p.quantity, length: d.length, width: d.width, thickness: p.thickness, materialName: p.material ? matName.get(p.material) ?? '—' : '—' },
      });
    }
  }
  const rows = [...groups.values()].map((g) => ({ ...g.row, numbers: g.numbers.join(', ') }));
  rows.sort((a, b) => a.numbers.localeCompare(b.numbers));
  return rows;
}

/** Разбить строки таблицы на страницы формата. */
export function tablePages(
  project: Project,
  _type: DrawingDocument['type'],
  docTitle: string,
  columns: TableColumn[],
  rows: string[][],
): DrawingPage[] {
  const area = contentArea(FORMAT, ORIENT);
  const perPage = Math.max(1, Math.floor((area.h - ROW_H) / ROW_H) - 1);
  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  const pages: DrawingPage[] = [];
  for (let i = 0; i < pageCount; i++) {
    const chunk = rows.slice(i * perPage, (i + 1) * perPage);
    const w = tableWidth(columns);
    const prims: Prim[] = [
      { kind: 'text', x: 0, y: ROW_H + 6, text: docTitle, size: 4.5, bold: true, color: '#1a1b1e', anchor: 'start' },
      ...tablePrims(0, 0, columns, chunk, { rowHeight: ROW_H }),
    ];
    pages.push({
      scene: finalizeScene(prims, 6),
      format: FORMAT, orientation: ORIENT, scale: 1,
      title: {
        project: project.name, title: docTitle, material: '—', scale: '1:1',
        date: new Date().toLocaleDateString('ru-RU'), sheet: i + 1, sheetsTotal: pageCount,
      },
      metadata: { tableWidth: w },
    } as DrawingPage);
  }
  return pages;
}

export function buildSpecificationDocument(project: Project): DrawingDocument {
  const partCols: TableColumn[] = [
    { title: '№', width: 26 }, { title: 'Наименование', width: 80 }, { title: 'Кол-во', width: 18, align: 'end' },
    { title: 'Длина', width: 22, align: 'end' }, { title: 'Ширина', width: 22, align: 'end' }, { title: 'Толщ', width: 16, align: 'end' }, { title: 'Материал', width: 70 },
  ];
  const partRows = groupParts(project).map((r) => [r.numbers, r.name, String(r.quantity), String(r.length), String(r.width), String(r.thickness), r.materialName]);
  const pages = tablePages(project, 'SPECIFICATION', 'Спецификация деталей', partCols, partRows);

  // Фурнитура.
  const hwCols: TableColumn[] = [{ title: '№', width: 16 }, { title: 'Наименование', width: 100 }, { title: 'Кол-во', width: 22, align: 'end' }];
  const hwRows = buildHardwareLedger(project.hardware, project.hardwareConnections)
    .filter((r) => r.count > 0)
    .map((r, i) => [`H${String(i + 1).padStart(3, '0')}`, r.name, String(r.count)]);
  if (hwRows.length > 0) pages.push(...tablePages(project, 'SPECIFICATION', 'Спецификация фурнитуры', hwCols, hwRows));

  // Кромка.
  const edgeCols: TableColumn[] = [{ title: 'Кромка', width: 90 }, { title: 'Толщина', width: 30, align: 'end' }, { title: 'Длина, м', width: 30, align: 'end' }];
  const edgeReport = calculateEdges(allParts(project), project.edges);
  const edgeRows = edgeReport.groups.map((g) => [g.name, `${g.thickness} мм`, (g.lengthMm / 1000).toFixed(2)]);
  if (edgeRows.length > 0) pages.push(...tablePages(project, 'SPECIFICATION', 'Спецификация кромки', edgeCols, edgeRows));

  return { id: `doc-spec-${project.id}`, type: 'SPECIFICATION', projectId: project.id, title: 'Спецификация', pages };
}
