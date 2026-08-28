/**
 * Горячие клавиши (§126/§127).
 *
 * Клавиши берутся из реестра команд, а не описываются вторым списком: команда
 * и её сочетание живут в одном месте. Внутри текстового поля горячие клавиши
 * не срабатывают (§127) — иначе набор «800» в поле ширины удалял бы деталь.
 */
import { COMMANDS, type CommandDefinition } from './commands';

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string;
}

/** Курсор внутри поля ввода: горячие клавиши выключены (§127). */
export function isTextInput(target: TargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Нормализованное сочетание: «Ctrl+Shift+Z», «Delete», «V». */
export function keyChord(event: KeyEventLike): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');

  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key);
  return parts.join('+');
}

/** Команда по сочетанию клавиш; в поле ввода — ничего (§127). */
export function commandForKey(
  event: KeyEventLike,
  target?: TargetLike | null,
): CommandDefinition | undefined {
  if (isTextInput(target)) return undefined;
  const chord = keyChord(event);
  // Backspace работает как Delete.
  const normalized = chord === 'Backspace' ? 'Delete' : chord;
  return COMMANDS.find((c) => c.shortcut === normalized);
}

/** Список сочетаний для подсказки пользователю. */
export function shortcutList(): Array<{ shortcut: string; label: string }> {
  return COMMANDS.filter((c) => c.shortcut).map((c) => ({ shortcut: c.shortcut!, label: c.label }));
}
