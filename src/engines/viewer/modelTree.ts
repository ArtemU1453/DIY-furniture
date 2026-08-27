/**
 * ModelTree — иерархия проекта для дерева модели. Группирует реальные детали
 * (по роли/типу) и фурнитуру. Дерево — производное от ProjectModel; выбор в
 * дереве и в 3D работает через один и тот же selectedPartId.
 */
import type { Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';

export interface TreeNode {
  partId: string;
  label: string;
  role: string;
  hidden: boolean;
}

export interface TreeGroup {
  id: string;
  label: string;
  nodes: TreeNode[];
}

export interface ModelTree {
  groups: TreeGroup[];
  hardware: Array<{ id: string; label: string; count: number }>;
}

const GROUP_OF: Record<string, string> = {
  side_left: 'body', side_right: 'body', top: 'body', bottom: 'body',
  shelf: 'shelves', divider: 'dividers', facade: 'facades', back: 'back', board: 'shelves',
};
const GROUP_LABELS: Record<string, string> = {
  body: 'Корпус', shelves: 'Полки', dividers: 'Перегородки', facades: 'Фасады', back: 'Задняя стенка', other: 'Прочее',
};
const GROUP_ORDER = ['body', 'shelves', 'dividers', 'facades', 'back', 'other'];

export function buildModelTree(project: Project): ModelTree {
  const buckets = new Map<string, TreeNode[]>();
  for (const p of allParts(project)) {
    const type = (p.metadata?.partType as string) ?? p.role;
    const group = GROUP_OF[type] ?? (p.role === 'back' ? 'back' : 'other');
    const number = (p.metadata?.number as string) ?? '';
    const node: TreeNode = {
      partId: String(p.id),
      label: `${number ? number + ' ' : ''}${p.name}`.trim(),
      role: p.role,
      hidden: p.metadata?.hidden === true,
    };
    (buckets.get(group) ?? buckets.set(group, []).get(group)!).push(node);
  }

  const groups: TreeGroup[] = GROUP_ORDER
    .filter((g) => buckets.has(g))
    .map((g) => ({ id: g, label: GROUP_LABELS[g], nodes: buckets.get(g)! }));

  const hardware = buildHardwareLedger(project.hardware, project.hardwareConnections)
    .filter((r) => r.count > 0)
    .map((r) => ({ id: String(r.hardwareId), label: r.name, count: r.count }));

  return { groups, hardware };
}
