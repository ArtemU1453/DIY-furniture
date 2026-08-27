/**
 * HARDWARE_LIST — спецификация фурнитуры (§51/§69/§70).
 *
 * Количество берётся из соединений через движок фурнитуры — тот же расчёт,
 * что и в таблице и в CSV, поэтому документ не может разойтись с моделью.
 * Комплекты раскрываются в компоненты: заказывают именно их (§54).
 */
import type { Project } from '@/core/model/types';
import { expandedSpecification, hardwareSpecification } from '@/engines/hardware';
import { tablePages } from './specification';
import type { TableColumn } from './table';
import type { DrawingDocument } from './sheet';

export interface HardwareListRow {
  index: string; // H001…
  id: string;
  name: string;
  type: string;
  article: string;
  quantity: number;
  unit: string;
  note: string;
}

export function hardwareListRows(project: Project): HardwareListRow[] {
  return hardwareSpecification(project).map((r, i) => ({
    index: `H${String(i + 1).padStart(3, '0')}`,
    id: String(r.hardwareId).slice(0, 8),
    name: r.name,
    type: r.type,
    article: r.article || '—',
    quantity: r.quantity,
    unit: r.unit,
    note: r.note,
  }));
}

/** Строки с раскрытыми комплектами — для закупки (§54/§63). */
export function hardwareListExpandedRows(project: Project): HardwareListRow[] {
  return expandedSpecification(project).map((r, i) => ({
    index: `H${String(i + 1).padStart(3, '0')}`,
    id: String(r.hardwareId).slice(0, 8),
    name: r.name,
    type: r.type,
    article: r.article || '—',
    quantity: r.quantity,
    unit: r.unit,
    note: r.note,
  }));
}

export function buildHardwareListDocument(project: Project): DrawingDocument {
  const cols: TableColumn[] = [
    { title: '№', width: 18 },
    { title: 'ID', width: 26 },
    { title: 'Наименование', width: 78 },
    { title: 'Тип', width: 42 },
    { title: 'Артикул', width: 34 },
    { title: 'Кол-во', width: 20, align: 'end' },
    { title: 'Ед.', width: 14 },
    { title: 'Примечание', width: 40 },
  ];
  const rows = hardwareListRows(project).map((r) => [
    r.index, r.id, r.name, r.type, r.article, String(r.quantity), r.unit, r.note,
  ]);
  const pages = tablePages(project, 'HARDWARE_LIST', 'Спецификация фурнитуры', cols, rows);
  return { id: `doc-hardwarelist-${project.id}`, type: 'HARDWARE_LIST', projectId: project.id, title: 'Спецификация фурнитуры', pages };
}
