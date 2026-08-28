/**
 * Контекстное меню (§128/§129).
 *
 * Состав меню зависит от того, по чему щёлкнули: у детали свои действия, у
 * изделия — структурные. Пункты ссылаются на команды реестра, поэтому меню и
 * горячие клавиши не расходятся.
 */
import { findCommand, type CommandDefinition } from './commands';
import type { SelectionKind } from './selection';

export interface MenuItem {
  commandId: string;
  label: string;
  shortcut?: string;
  separatorBefore?: boolean;
}

const item = (commandId: string, separatorBefore = false): MenuItem => {
  const command: CommandDefinition | undefined = findCommand(commandId);
  return {
    commandId,
    label: command?.label ?? commandId,
    shortcut: command?.shortcut,
    separatorBefore,
  };
};

/** Меню детали (§128). */
export const PART_MENU: MenuItem[] = [
  item('transform.move'),
  item('tool.resize'),
  item('structure.duplicate', true),
  item('structure.delete'),
  item('structure.hide', true),
  item('structure.isolate'),
  item('structure.lock'),
  item('transform.resetOverride', true),
];

/** Меню шкафа (§129). */
export const CABINET_MENU: MenuItem[] = [
  item('structure.addShelf'),
  item('structure.addDivider'),
  item('structure.addDoor'),
  item('structure.addDrawer'),
  item('structure.duplicate', true),
  item('structure.delete'),
];

/** Меню пустого места: общие действия вида. */
export const EMPTY_MENU: MenuItem[] = [
  item('select.all'),
  item('view.fitAll', true),
  item('view.resetCamera'),
  item('clipboard.paste', true),
];

export function menuFor(kind: SelectionKind | null): MenuItem[] {
  if (kind === 'CABINET') return CABINET_MENU;
  if (kind === null) return EMPTY_MENU;
  return PART_MENU;
}
