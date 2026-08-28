/**
 * Выделение на холсте (§17–§21).
 *
 * Выделение — состояние ИНТЕРФЕЙСА: это список идентификаторов, а не копия
 * объектов (§2). Порядок значим: последний элемент — активный, именно его
 * параметры показывает панель свойств.
 */
import { rectContains, rectIntersects, rectOf } from './projection';
import type { Bounds2D, EditorEntity, EntityType, SelectionFilter } from './types';

/** Одиночный выбор (§17). */
export function selectSingle(entityId: string | null): string[] {
  return entityId ? [entityId] : [];
}

/** Добавить/убрать из выделения по Ctrl/Cmd + click (§18). */
export function toggleSelection(selection: string[], entityId: string): string[] {
  return selection.includes(entityId)
    ? selection.filter((id) => id !== entityId)
    : [...selection, entityId];
}

/**
 * Выделение рамкой (§19). `crossing` — «касанием»: попадают объекты, которые
 * рамка задевает; иначе только те, что внутри целиком.
 */
export function selectInRect(
  entities: EditorEntity[],
  bounds: Bounds2D,
  options: { crossing?: boolean; filter?: SelectionFilter } = {},
): string[] {
  const test = options.crossing ? rectIntersects : rectContains;
  return entities
    .filter((e) => !e.hidden)
    .filter((e) => (options.filter ? options.filter[e.entityType] !== false : true))
    .filter((e) => test(rectOf(e), bounds))
    .map((e) => e.entityId);
}

/** Нормализовать рамку, нарисованную в любом направлении. */
export function normalizeBounds(a: { x: number; y: number }, b: { x: number; y: number }): Bounds2D {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** Сущность под точкой; верхней считается последняя подходящая (§17). */
export function entityAt(
  entities: EditorEntity[],
  point: { x: number; y: number },
  filter?: SelectionFilter,
): EditorEntity | undefined {
  let found: EditorEntity | undefined;
  for (const e of entities) {
    if (e.hidden) continue;
    if (filter && filter[e.entityType] === false) continue;
    const r = rectOf(e);
    if (point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height) {
      /* Мелкий объект перекрывает крупный: иначе фурнитуру и отверстия
       * невозможно было бы выбрать внутри детали, а деталь — внутри модуля. */
      if (!found || r.width * r.height <= rectOf(found).width * rectOf(found).height) found = e;
    }
  }
  return found;
}

/** Применить фильтр типов к выделению (§20). */
export function applyFilter(
  entities: EditorEntity[],
  selection: string[],
  filter: SelectionFilter,
): string[] {
  const allowed = new Map(entities.map((e) => [e.entityId, e.entityType] as const));
  return selection.filter((id) => {
    const type = allowed.get(id);
    return type ? filter[type] !== false : false;
  });
}

/** Проставить состояние выделения сущностям (§4). */
export function markSelection(entities: EditorEntity[], selection: string[]): EditorEntity[] {
  const active = selection[selection.length - 1];
  const set = new Set(selection);
  return entities.map((e) =>
    set.has(e.entityId)
      ? { ...e, selectionState: e.entityId === active ? ('active' as const) : ('selected' as const) }
      : e.selectionState === 'none'
        ? e
        : { ...e, selectionState: 'none' as const },
  );
}

/** Выбранные сущности в порядке выделения. */
export function selectedEntities(entities: EditorEntity[], selection: string[]): EditorEntity[] {
  const byId = new Map(entities.map((e) => [e.entityId, e]));
  return selection.map((id) => byId.get(id)).filter((e): e is EditorEntity => e !== undefined);
}

/** Активная (последняя выбранная) сущность. */
export function activeEntity(entities: EditorEntity[], selection: string[]): EditorEntity | undefined {
  return selectedEntities(entities, selection).at(-1);
}

/** Типы в текущем выделении — по ним панель свойств решает, что показать (§117). */
export function selectionTypes(entities: EditorEntity[], selection: string[]): EntityType[] {
  return [...new Set(selectedEntities(entities, selection).map((e) => e.entityType))];
}

/** ESC: снять выделение и отменить операцию (§21). */
export function clearSelection(): string[] {
  return [];
}

/** Сущности, доступные для перемещения: не заблокированные и не скрытые (§85/§86). */
export function movableEntities(entities: EditorEntity[], selection: string[]): EditorEntity[] {
  return selectedEntities(entities, selection).filter((e) => !e.locked && !e.hidden);
}
