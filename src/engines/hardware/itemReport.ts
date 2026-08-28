/**
 * Отчёты по установленной фурнитуре (§122–§124).
 *
 * Отчёт собирает уже посчитанные данные: позиции каталога, единицы на деталях
 * и операции присадки. Второй спецификации не появляется — существующий
 * hardwareBom по связям остаётся на месте, этот отчёт описывает единицы.
 */
import type { Project } from '@/core/model/types';
import { itemLayout, itemPart, projectItems } from './items';
import { kindOfItem } from './parametric';

/** Строка отчёта по фурнитуре (§123). */
export interface HardwareReportRow {
  index: number;
  name: string;
  article: string;
  kind: string;
  quantity: number;
  /** Где используется: детали, на которых стоит позиция (§94/§123). */
  usage: string[];
}

/**
 * Отчёт по фурнитуре (§122/§123).
 *
 * Одинаковые позиции группируются (§92), количество суммируется (§93),
 * использование перечисляется (§94).
 */
export function hardwareItemReport(project: Project): HardwareReportRow[] {
  const groups = new Map<string, { name: string; article: string; kind: string; quantity: number; usage: Set<string> }>();

  for (const item of projectItems(project)) {
    const hardware = project.hardware.find((h) => h.id === item.hardwareId);
    if (!hardware) continue;
    const key = String(hardware.id);
    const part = itemPart(project, item);
    const layout = itemLayout(project, item);
    /* Количество единиц: у петли на фасаде их столько, сколько чашек, — это
     * видно по опорным точкам, а не по полю quantity. */
    const units = item.quantity ?? layout?.anchors.filter((a) => a.role !== 'pin-row').length ?? 1;

    const group = groups.get(key) ?? {
      name: hardware.name,
      article: hardware.article ?? '',
      kind: kindOfItem(item, hardware),
      quantity: 0,
      usage: new Set<string>(),
    };
    group.quantity += Math.max(1, units);
    if (part) group.usage.add(part.name);
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'ru'))
    .map((g, i) => ({
      index: i + 1,
      name: g.name,
      article: g.article,
      kind: g.kind,
      quantity: g.quantity,
      usage: [...g.usage].sort((a, b) => a.localeCompare(b, 'ru')),
    }));
}

/** Строка отчёта присадки от фурнитуры (§124). */
export interface HardwareMachiningRow {
  partName: string;
  hardwareName: string;
  operation: string;
  face: string;
  x: number;
  y: number;
  diameter: number;
  depth: number;
}

/** Отчёт присадки по установленной фурнитуре (§124). */
export function hardwareMachiningReport(project: Project): HardwareMachiningRow[] {
  const rows: HardwareMachiningRow[] = [];
  for (const item of projectItems(project)) {
    const hardware = project.hardware.find((h) => h.id === item.hardwareId);
    const part = itemPart(project, item);
    const layout = itemLayout(project, item);
    if (!hardware || !part || !layout) continue;
    for (const op of layout.operations) {
      rows.push({
        partName: part.name,
        hardwareName: hardware.name,
        operation: op.type,
        face: op.face,
        x: Math.round(op.x * 10) / 10,
        y: Math.round(op.y * 10) / 10,
        diameter: op.diameter ?? 0,
        depth: op.depth ?? 0,
      });
    }
  }
  return rows.sort((a, b) =>
    a.partName.localeCompare(b.partName, 'ru') || a.x - b.x || a.y - b.y);
}

const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const toCsv = (header: string[], rows: string[][]): string =>
  [header, ...rows].map((r) => r.map(q).join(',')).join('\n');

/** hardware-report.csv (§123/§136). */
export function hardwareItemReportCsv(project: Project): string {
  return toCsv(
    ['№', 'Наименование', 'Артикул', 'Тип', 'Количество', 'Использование'],
    hardwareItemReport(project).map((r) => [
      String(r.index), r.name, r.article, r.kind, String(r.quantity), r.usage.join('; '),
    ]),
  );
}

/** hardware-machining.csv (§124). */
export function hardwareMachiningCsv(project: Project): string {
  return toCsv(
    ['Деталь', 'Фурнитура', 'Операция', 'Грань', 'X', 'Y', 'Диаметр', 'Глубина'],
    hardwareMachiningReport(project).map((r) => [
      r.partName, r.hardwareName, r.operation, r.face,
      String(r.x), String(r.y), String(r.diameter), String(r.depth),
    ]),
  );
}
