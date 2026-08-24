/**
 * Локализация названий деталей. Движок оперирует ТИПАМИ деталей (ключами),
 * русский текст живёт здесь. UI/оркестрация получает читаемое имя.
 */

export type PartType =
  | 'side_left'
  | 'side_right'
  | 'top'
  | 'bottom'
  | 'shelf'
  | 'divider'
  | 'back'
  | 'facade'
  | 'board';

const RU: Record<PartType, string> = {
  side_left: 'Боковина левая',
  side_right: 'Боковина правая',
  top: 'Верх',
  bottom: 'Низ',
  shelf: 'Полка',
  divider: 'Перегородка',
  back: 'Задняя стенка',
  facade: 'Фасад',
  board: 'Полка',
};

/**
 * Читаемое имя детали по типу и порядковому номеру.
 * Для нумеруемых типов (полка, перегородка, фасад) добавляется индекс.
 */
export function partTypeName(type: PartType, index?: number): string {
  const base = RU[type] ?? type;
  if ((type === 'shelf' || type === 'divider' || type === 'facade') && index && index > 0) {
    return `${base} ${index}`;
  }
  return base;
}
