/**
 * hardware.csv (§71/§72).
 * Колонки: Name, Article, Type, Quantity, Unit, Notes.
 *
 * Количество берётся из спецификации, то есть в конечном счёте из соединений:
 * выгрузка не может разойтись с моделью (§85/§99).
 */
import type { Project } from '@/core/model/types';
import { expandedSpecification, hardwareSpecification } from './specification';

function csv(header: string[], rows: string[][]): string {
  const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n');
}

/** hardware.csv — спецификация как есть (комплект остаётся одной строкой). */
export function hardwareCsv(project: Project): string {
  const header = ['Name', 'Article', 'Type', 'Quantity', 'Unit', 'Notes'];
  const rows = hardwareSpecification(project).map((r) => [
    r.name, r.article, r.type, String(r.quantity), r.unit, r.note,
  ]);
  return csv(header, rows);
}

/** hardware_expanded.csv — комплекты раскрыты в компоненты (§54). */
export function hardwareExpandedCsv(project: Project): string {
  const header = ['Name', 'Article', 'Type', 'Quantity', 'Unit', 'Notes'];
  const rows = expandedSpecification(project).map((r) => [
    r.name, r.article, r.type, String(r.quantity), r.unit, r.note,
  ]);
  return csv(header, rows);
}
