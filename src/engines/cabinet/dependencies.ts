/**
 * Граф зависимостей корпуса (§59).
 *
 *   Cabinet.width → Side Panels → Shelves → Doors → Hardware → Machining → Cutting
 *
 * Граф ОПИСЫВАЕТ порядок пересчёта, а не выполняет его: сам пересчёт делает
 * regenerate.ts, а фактические значения по-прежнему считают правила этапа 18.
 * Здесь нет второй системы расчёта — только маршрут, по которому изменение
 * параметра доходит до раскроя и документов.
 */

export type CabinetNodeKind = 'PARAMETER' | 'PART' | 'STAGE';

export interface CabinetDependencyNode {
  id: string;
  label: string;
  kind: CabinetNodeKind;
  /** От каких узлов зависит этот узел. */
  dependsOn: string[];
}

/** Узлы графа: параметры → детали → производство. */
export const CABINET_DEPENDENCY_NODES: CabinetDependencyNode[] = [
  { id: 'width', label: 'Ширина', kind: 'PARAMETER', dependsOn: [] },
  { id: 'height', label: 'Высота', kind: 'PARAMETER', dependsOn: [] },
  { id: 'depth', label: 'Глубина', kind: 'PARAMETER', dependsOn: [] },
  { id: 'thickness', label: 'Толщина материала', kind: 'PARAMETER', dependsOn: [] },
  { id: 'material', label: 'Материал', kind: 'PARAMETER', dependsOn: [] },
  { id: 'construction', label: 'Схема корпуса', kind: 'PARAMETER', dependsOn: [] },
  { id: 'backPanel', label: 'Задняя стенка', kind: 'PARAMETER', dependsOn: ['thickness', 'depth'] },
  { id: 'shelfSettings', label: 'Настройки полок', kind: 'PARAMETER', dependsOn: [] },
  { id: 'partitionSettings', label: 'Настройки перегородок', kind: 'PARAMETER', dependsOn: [] },
  { id: 'doorSettings', label: 'Настройки фасадов', kind: 'PARAMETER', dependsOn: [] },
  { id: 'drawerSettings', label: 'Настройки ящиков', kind: 'PARAMETER', dependsOn: [] },
  { id: 'legSettings', label: 'Настройки опор', kind: 'PARAMETER', dependsOn: [] },
  { id: 'plinthSettings', label: 'Настройки цоколя', kind: 'PARAMETER', dependsOn: [] },

  { id: 'sides', label: 'Боковины', kind: 'PART', dependsOn: ['width', 'height', 'depth', 'thickness', 'material', 'construction'] },
  { id: 'topBottom', label: 'Верх и низ', kind: 'PART', dependsOn: ['width', 'depth', 'thickness', 'material', 'construction', 'sides'] },
  { id: 'partitions', label: 'Перегородки', kind: 'PART', dependsOn: ['width', 'height', 'depth', 'thickness', 'partitionSettings', 'drawers', 'topBottom'] },
  { id: 'shelves', label: 'Полки', kind: 'PART', dependsOn: ['width', 'height', 'depth', 'thickness', 'shelfSettings', 'partitions', 'drawers'] },
  { id: 'back', label: 'Задняя стенка', kind: 'PART', dependsOn: ['width', 'height', 'depth', 'backPanel', 'sides', 'topBottom'] },
  { id: 'drawers', label: 'Ящики', kind: 'PART', dependsOn: ['width', 'height', 'depth', 'thickness', 'drawerSettings', 'doorSettings'] },
  { id: 'doors', label: 'Фасады', kind: 'PART', dependsOn: ['width', 'height', 'depth', 'thickness', 'doorSettings', 'drawers'] },
  { id: 'legs', label: 'Опоры', kind: 'PART', dependsOn: ['width', 'depth', 'legSettings'] },
  { id: 'plinth', label: 'Цоколь', kind: 'PART', dependsOn: ['width', 'depth', 'thickness', 'plinthSettings'] },

  { id: 'hardware', label: 'Фурнитура', kind: 'STAGE', dependsOn: ['sides', 'topBottom', 'shelves', 'partitions', 'doors', 'drawers', 'back'] },
  { id: 'connections', label: 'Соединения', kind: 'STAGE', dependsOn: ['hardware'] },
  { id: 'machining', label: 'Присадка', kind: 'STAGE', dependsOn: ['connections', 'back'] },
  { id: 'edges', label: 'Кромка', kind: 'STAGE', dependsOn: ['sides', 'topBottom', 'shelves', 'partitions', 'doors', 'drawers'] },
  { id: 'cutting', label: 'Раскрой', kind: 'STAGE', dependsOn: ['edges', 'machining'] },
  { id: 'view3d', label: '3D', kind: 'STAGE', dependsOn: ['machining'] },
  { id: 'view2d', label: '2D', kind: 'STAGE', dependsOn: ['machining'] },
  { id: 'bom', label: 'Спецификация', kind: 'STAGE', dependsOn: ['cutting', 'hardware'] },
  { id: 'documents', label: 'Документы', kind: 'STAGE', dependsOn: ['bom', 'view2d'] },
];

const NODES = new Map(CABINET_DEPENDENCY_NODES.map((n) => [n.id, n]));

export function cabinetNode(id: string): CabinetDependencyNode | undefined {
  return NODES.get(id);
}

/** Узлы, которые зависят от заданного напрямую. */
export function directDependents(id: string): string[] {
  return CABINET_DEPENDENCY_NODES.filter((n) => n.dependsOn.includes(id)).map((n) => n.id);
}

/**
 * Все узлы, до которых доходит изменение (транзитивно). Порядок — как в
 * порядке пересчёта: сначала детали, затем производство.
 */
export function dependentsOf(id: string): string[] {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of directDependents(current)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return regenerationOrder().filter((n) => seen.has(n));
}

/**
 * Топологический порядок пересчёта (§59/§60). Цикл в графе означал бы ошибку
 * описания, поэтому оставшиеся узлы добавляются в конец, а не молча теряются.
 */
export function regenerationOrder(): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string): void => {
    if (visited.has(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const dep of NODES.get(id)?.dependsOn ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
    result.push(id);
  };

  for (const node of CABINET_DEPENDENCY_NODES) visit(node.id);
  return result;
}

/** Есть ли в графе цикл (проверка описания, а не данных). */
export function hasCycle(): boolean {
  return regenerationOrder().length !== CABINET_DEPENDENCY_NODES.length;
}

/** Какие параметрические поля модели соответствуют узлам графа. */
export const FIELD_TO_NODE: Record<string, string> = {
  width: 'width',
  height: 'height',
  depth: 'depth',
  thickness: 'thickness',
  materialId: 'material',
  construction: 'construction',
  backPanel: 'backPanel',
  shelves: 'shelfSettings',
  partitions: 'partitionSettings',
  doors: 'doorSettings',
  drawers: 'drawerSettings',
  legs: 'legSettings',
  plinth: 'plinthSettings',
  edge: 'edges',
};

/** Что придётся пересчитать после изменения перечисленных полей модели. */
export function affectedByFields(fields: string[]): string[] {
  const nodes = new Set<string>();
  for (const field of fields) {
    const node = FIELD_TO_NODE[field];
    if (!node) continue;
    nodes.add(node);
    for (const dependent of dependentsOf(node)) nodes.add(dependent);
  }
  return regenerationOrder().filter((n) => nodes.has(n));
}
