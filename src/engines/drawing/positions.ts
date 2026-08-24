/**
 * Позиционные номера деталей для сборочного чертежа и спецификации.
 *
 * Позиция (1, 2, 3, …) — это НЕ P-ID. P-ID остаётся техническим идентификатором
 * детали; позиция — порядковый номер на сборочном чертеже. Одинаковые детали
 * (совпадают по имени/размерам/материалу) получают одну позицию.
 */
import type { Part, Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';

const planeDims = (p: Part) => ({ length: Math.max(p.width, p.height), width: Math.min(p.width, p.height) });

function groupKey(p: Part): string {
  const d = planeDims(p);
  return `${p.name}|${d.length}x${d.width}x${p.thickness}|${p.material}`;
}

/** Карта partId → позиция (одинаковые детали делят позицию). */
export function positionNumbers(project: Project): Map<string, number> {
  const map = new Map<string, number>();
  const keyToPos = new Map<string, number>();
  let next = 1;
  for (const p of allParts(project)) {
    const key = groupKey(p);
    let pos = keyToPos.get(key);
    if (pos === undefined) {
      pos = next++;
      keyToPos.set(key, pos);
    }
    map.set(p.id, pos);
  }
  return map;
}
