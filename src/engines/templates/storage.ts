/**
 * Локальное хранилище пользовательских шаблонов (localStorage, без облака).
 * Все обращения обёрнуты в try/catch — приложение работает и без доступа к
 * хранилищу (приватный режим, отключённые cookie и т.п.).
 */
import type { FurnitureTemplate } from './types';

const KEY = 'karkas.customTemplates.v1';

export function loadCustomTemplates(): FurnitureTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FurnitureTemplate[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomTemplates(templates: FurnitureTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(templates));
  } catch {
    /* хранилище недоступно — тихо игнорируем */
  }
}

export function addCustomTemplate(template: FurnitureTemplate): FurnitureTemplate[] {
  const list = loadCustomTemplates().filter((t) => t.id !== template.id);
  list.push(template);
  saveCustomTemplates(list);
  return list;
}

export function removeCustomTemplate(id: string): FurnitureTemplate[] {
  const list = loadCustomTemplates().filter((t) => t.id !== id);
  saveCustomTemplates(list);
  return list;
}
