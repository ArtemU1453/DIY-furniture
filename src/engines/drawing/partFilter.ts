/**
 * Фильтр деталей для деталировки (§65): все / корпус / фасады / полки /
 * перегородки / задняя стенка / другие.
 *
 * Фильтр — это оформление документа, а не изменение модели: он влияет только на
 * то, какие страницы попадут в чертёж, и никогда не трогает ProjectModel.
 */
import type { Part } from '@/core/model/types';

export type PartFilterKey = 'all' | 'carcass' | 'facades' | 'shelves' | 'dividers' | 'back' | 'other';

export const PART_FILTERS: Array<{ key: PartFilterKey; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'carcass', label: 'Корпус' },
  { key: 'facades', label: 'Фасады' },
  { key: 'shelves', label: 'Полки' },
  { key: 'dividers', label: 'Перегородки' },
  { key: 'back', label: 'Задняя стенка' },
  { key: 'other', label: 'Другие' },
];

/** Роли, относящиеся к корпусу (боковины, крыша, дно). */
const CARCASS_ROLES = new Set(['side', 'top', 'bottom']);

export function matchesPartFilter(part: Part, filter: PartFilterKey | undefined): boolean {
  if (!filter || filter === 'all') return true;
  const role = part.role;
  switch (filter) {
    case 'carcass': return CARCASS_ROLES.has(role);
    case 'facades': return role === 'facade';
    case 'shelves': return role === 'shelf';
    case 'dividers': return role === 'divider';
    case 'back': return role === 'back';
    case 'other':
      return !CARCASS_ROLES.has(role) && role !== 'facade' && role !== 'shelf'
        && role !== 'divider' && role !== 'back';
  }
}

/** Отфильтровать детали, сохранив исходный порядок. */
export function filterParts(parts: Part[], filter: PartFilterKey | undefined): Part[] {
  if (!filter || filter === 'all') return parts;
  return parts.filter((p) => matchesPartFilter(p, filter));
}
