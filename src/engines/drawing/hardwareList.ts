/**
 * HARDWARE_LIST — спецификация фурнитуры: №, ID, наименование, тип, артикул,
 * количество. Одинаковая фурнитура группируется (количество из связей).
 */
import type { Project } from '@/core/model/types';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { hardwareCategoryLabel } from '@/i18n/catalog';
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
}

export function hardwareListRows(project: Project): HardwareListRow[] {
  const byId = new Map(project.hardware.map((h) => [h.id, h]));
  return buildHardwareLedger(project.hardware, project.hardwareConnections)
    .filter((r) => r.count > 0)
    .map((r, i) => {
      const hw = byId.get(r.hardwareId);
      return {
        index: `H${String(i + 1).padStart(3, '0')}`,
        id: String(r.hardwareId).slice(0, 8),
        name: r.name,
        type: hw ? hardwareCategoryLabel(hw.category) : '—',
        article: hw?.article ?? '—',
        quantity: r.count,
      };
    });
}

export function buildHardwareListDocument(project: Project): DrawingDocument {
  const cols: TableColumn[] = [
    { title: '№', width: 18 },
    { title: 'ID', width: 26 },
    { title: 'Наименование', width: 78 },
    { title: 'Тип', width: 42 },
    { title: 'Артикул', width: 34 },
    { title: 'Кол-во', width: 20, align: 'end' },
  ];
  const rows = hardwareListRows(project).map((r) => [r.index, r.id, r.name, r.type, r.article, String(r.quantity)]);
  const pages = tablePages(project, 'HARDWARE_LIST', 'Спецификация фурнитуры', cols, rows);
  return { id: `doc-hardwarelist-${project.id}`, type: 'HARDWARE_LIST', projectId: project.id, title: 'Спецификация фурнитуры', pages };
}
