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
  | 'back';

const RU: Record<PartType, string> = {
  side_left: 'Боковина левая',
  side_right: 'Боковина правая',
  top: 'Верх',
  bottom: 'Низ',
  shelf: 'Полка',
  divider: 'Перегородка',
  back: 'Задняя стенка',
};

/**
 * Читаемое имя детали по типу и порядковому номеру.
 * Для нумеруемых типов (полка, перегородка) добавляется индекс.
 */
export function partTypeName(type: PartType, index?: number): string {
  const base = RU[type] ?? type;
  if ((type === 'shelf' || type === 'divider') && index && index > 0) {
    return `${base} ${index}`;
  }
  return base;
}
