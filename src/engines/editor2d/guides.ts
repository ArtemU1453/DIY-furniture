/**
 * Ручные направляющие (§48–§52).
 *
 * Направляющая — вспомогательная линия интерфейса: она живёт в Editor2DState
 * и НЕ попадает в ProjectModel (§2/§131). Заблокированную направляющую нельзя
 * ни сдвинуть, ни удалить — блокировка защищает, а не только предупреждает.
 */
import type { Guide2D, ViewPlane } from './types';

let counter = 0;

/** Идентификатор направляющей. Детерминированный префикс + счётчик сессии. */
export function guideId(): string {
  counter += 1;
  return `guide-${counter}`;
}

/** Создать направляющую (§49). */
export function createGuide(
  orientation: Guide2D['orientation'],
  position: number,
  plane: ViewPlane,
  id: string = guideId(),
): Guide2D {
  return { id, orientation, position, locked: false, plane };
}

/** Добавить направляющую в список. */
export function addGuide(guides: Guide2D[], guide: Guide2D): Guide2D[] {
  return [...guides, guide];
}

/** Переместить направляющую (§50). Заблокированная не двигается (§52). */
export function moveGuide(guides: Guide2D[], id: string, position: number): Guide2D[] {
  return guides.map((g) => (g.id === id && !g.locked ? { ...g, position } : g));
}

/** Удалить направляющую (§51). Заблокированная не удаляется. */
export function removeGuide(guides: Guide2D[], id: string): Guide2D[] {
  return guides.filter((g) => !(g.id === id && !g.locked));
}

/** Заблокировать/разблокировать (§52). */
export function setGuideLocked(guides: Guide2D[], id: string, locked: boolean): Guide2D[] {
  return guides.map((g) => (g.id === id ? { ...g, locked } : g));
}

/** Удалить все незаблокированные направляющие вида. */
export function clearGuides(guides: Guide2D[], plane?: ViewPlane): Guide2D[] {
  return guides.filter((g) => g.locked || (plane != null && g.plane !== plane));
}

/** Направляющие текущего вида: у каждого вида своя система координат. */
export function guidesOfPlane(guides: Guide2D[], plane: ViewPlane): Guide2D[] {
  return guides.filter((g) => g.plane === plane);
}

/** Направляющая рядом с координатой — для захвата мышью. */
export function guideAt(
  guides: Guide2D[],
  point: { x: number; y: number },
  tolerance: number,
): Guide2D | undefined {
  return guides.find((g) =>
    g.orientation === 'vertical'
      ? Math.abs(g.position - point.x) <= tolerance
      : Math.abs(g.position - point.y) <= tolerance,
  );
}
