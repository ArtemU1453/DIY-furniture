/**
 * Единая система команд (§119–§122).
 *
 * Любая операция редактора — команда с идентификатором, названием и горячей
 * клавишей. UI вызывает команду, команда меняет модель ОДНИМ действием store,
 * поэтому целиком попадает в существующий undo/redo (§120).
 *
 * ТРАНЗАКЦИЯ (§121/§122): перетаскивание порождает десятки промежуточных
 * значений, но в историю должно попасть одно. Поэтому у транзакции есть начало
 * (запоминаем исходное состояние), «черновые» шаги (модель меняется, история
 * не растёт) и завершение (одна запись). Здесь описана её МОДЕЛЬ; запись в
 * проект делает store.
 */
export type CommandCategory =
  | 'selection' | 'transform' | 'structure' | 'view' | 'measure' | 'history' | 'clipboard';

export interface CommandDefinition {
  id: string;
  label: string;
  category: CommandCategory;
  /** Горячая клавиша в виде «Ctrl+D», «Delete», «V» (§126). */
  shortcut?: string;
  /** Нужна ли выбранная сущность. */
  requiresSelection?: boolean;
  description?: string;
}

/** Реестр команд редактора (§119). */
export const COMMANDS: CommandDefinition[] = [
  { id: 'select.all', label: 'Выбрать всё', category: 'selection', shortcut: 'Ctrl+A' },
  { id: 'select.none', label: 'Снять выделение', category: 'selection', shortcut: 'Escape' },
  { id: 'select.parent', label: 'Выбрать родителя', category: 'selection', requiresSelection: true },
  { id: 'select.children', label: 'Выбрать дочерние', category: 'selection', requiresSelection: true },

  { id: 'tool.select', label: 'Выбор', category: 'view', shortcut: 'V' },
  { id: 'tool.move', label: 'Перемещение', category: 'view', shortcut: 'M' },
  { id: 'tool.rotate', label: 'Поворот', category: 'view', shortcut: 'R' },
  { id: 'tool.resize', label: 'Размер', category: 'view', shortcut: 'S' },
  { id: 'tool.dimension', label: 'Размеры', category: 'view', shortcut: 'D' },
  { id: 'tool.guide', label: 'Направляющая', category: 'view', shortcut: 'G' },
  { id: 'tool.measure', label: 'Измерение', category: 'measure' },

  { id: 'transform.move', label: 'Переместить', category: 'transform', requiresSelection: true },
  { id: 'transform.rotate', label: 'Повернуть', category: 'transform', requiresSelection: true },
  { id: 'transform.mirror', label: 'Отразить', category: 'transform', requiresSelection: true },
  { id: 'transform.align', label: 'Выровнять', category: 'transform', requiresSelection: true },
  { id: 'transform.distribute', label: 'Распределить', category: 'transform', requiresSelection: true },
  { id: 'transform.offset', label: 'Сместить', category: 'transform', requiresSelection: true },
  { id: 'transform.resetOverride', label: 'Вернуть расчёт', category: 'transform', requiresSelection: true },

  { id: 'structure.addShelf', label: 'Добавить полку', category: 'structure' },
  { id: 'structure.addDivider', label: 'Добавить перегородку', category: 'structure' },
  { id: 'structure.addDoor', label: 'Добавить фасад', category: 'structure' },
  { id: 'structure.addDrawer', label: 'Добавить ящик', category: 'structure' },
  { id: 'structure.addPart', label: 'Новая деталь', category: 'structure' },
  { id: 'structure.delete', label: 'Удалить', category: 'structure', shortcut: 'Delete', requiresSelection: true },
  { id: 'structure.duplicate', label: 'Дублировать', category: 'structure', shortcut: 'Ctrl+D', requiresSelection: true },
  { id: 'structure.lock', label: 'Заблокировать', category: 'structure', requiresSelection: true },
  { id: 'structure.hide', label: 'Скрыть', category: 'structure', requiresSelection: true },
  { id: 'structure.isolate', label: 'Изолировать', category: 'structure', requiresSelection: true },

  { id: 'clipboard.copy', label: 'Копировать', category: 'clipboard', shortcut: 'Ctrl+C', requiresSelection: true },
  { id: 'clipboard.paste', label: 'Вставить', category: 'clipboard', shortcut: 'Ctrl+V' },

  { id: 'history.undo', label: 'Отменить', category: 'history', shortcut: 'Ctrl+Z' },
  { id: 'history.redo', label: 'Повторить', category: 'history', shortcut: 'Ctrl+Shift+Z' },

  { id: 'view.focus', label: 'Приблизить к выбранному', category: 'view', requiresSelection: true },
  { id: 'view.fitAll', label: 'Показать всё', category: 'view' },
  { id: 'view.resetCamera', label: 'Сбросить камеру', category: 'view' },
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export function findCommand(id: string): CommandDefinition | undefined {
  return BY_ID.get(id);
}

export function commandsOfCategory(category: CommandCategory): CommandDefinition[] {
  return COMMANDS.filter((c) => c.category === category);
}

/** Доступна ли команда при текущем выделении (§128). */
export function isCommandEnabled(id: string, selectionCount: number): boolean {
  const command = BY_ID.get(id);
  if (!command) return false;
  return command.requiresSelection ? selectionCount > 0 : true;
}

// ── Транзакции (§121/§122) ───────────────────────────────────────────────────

export type TransactionKind = 'drag' | 'resize' | 'dimension' | 'parameter';

export interface Transaction<T = unknown> {
  id: string;
  kind: TransactionKind;
  label: string;
  /** Состояние на начало — к нему возвращает отмена (§142). */
  origin: T;
  /** Сколько промежуточных шагов было сделано. */
  steps: number;
  open: boolean;
}

let counter = 0;

/** Начать транзакцию: с этого момента промежуточные шаги историю не растят. */
export function beginTransaction<T>(kind: TransactionKind, label: string, origin: T): Transaction<T> {
  counter += 1;
  return { id: `tx-${counter}`, kind, label, origin, steps: 0, open: true };
}

/** Промежуточный шаг перетаскивания (§122): модель меняется, история — нет. */
export function stepTransaction<T>(tx: Transaction<T>): Transaction<T> {
  return tx.open ? { ...tx, steps: tx.steps + 1 } : tx;
}

/** Завершить транзакцию — одна запись в истории (§121). */
export function commitTransaction<T>(tx: Transaction<T>): Transaction<T> {
  return { ...tx, open: false };
}

/** Отменить транзакцию: вернуть состояние начала (§142). */
export function rollbackTransaction<T>(tx: Transaction<T>): T {
  return tx.origin;
}
