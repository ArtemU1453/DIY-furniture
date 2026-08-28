/**
 * Спецификация фурнитуры (§56–§59, §137–§139).
 *
 * Количество НИГДЕ не хранится как самостоятельная величина: строка BOM —
 * это сумма установленных единиц (§59), а единицы выводятся из соединений и
 * ручных позиций. Правка количества возможна только как явный override узла
 * (§134/§135), и BOM показывает, что значение задано вручную.
 */
import { allParts } from '@/core/model/selectors';
import type { HardwareConnection, Project } from '@/core/model/types';
import { canonicalCategory } from './validate';
import { unitsOf } from './instances';

/** Строка спецификации фурнитуры (§57). */
export interface HardwareBomRow {
  hardwareId: string;
  article: string;
  name: string;
  /** Категория в канонической номенклатуре §5. */
  category: string;
  manufacturer: string;
  quantity: number;
  /** Есть ли среди узлов позиции с ручным количеством (§134). */
  hasOverride: boolean;
  /** Узлы, давшие эту строку — для перехода к соединению (§73). */
  connectionIds: string[];
  /** Детали, на которых стоит позиция (§70). */
  partIds: string[];
  status: 'VALID' | 'WARNING' | 'ERROR' | 'MISSING';
}

/**
 * Количество единиц узла с учётом ручной правки (§55/§134/§135).
 * Override побеждает расчёт правила, но не стирает его: сброс возвращает
 * вычисленное значение (§136).
 */
export function connectionUnits(connection: HardwareConnection): number {
  if (connection.quantityOverride != null && Number.isFinite(connection.quantityOverride)) {
    return Math.max(0, Math.round(connection.quantityOverride));
  }
  return unitsOf(connection);
}

/** Вычисленное правилом количество — без учёта ручной правки (§134/§136). */
export function computedUnits(connection: HardwareConnection): number {
  return unitsOf(connection);
}

/** Задано ли количество узла вручную (§134). */
export function isOverridden(connection: HardwareConnection): boolean {
  return connection.quantityOverride != null;
}

/**
 * Спецификация фурнитуры проекта (§56–§59).
 * Одинаковые позиции группируются в одну строку (§58).
 */
export function hardwareBom(project: Project): HardwareBomRow[] {
  const hardwareById = new Map(project.hardware.map((h) => [String(h.id), h]));
  const partIdsSet = new Set(allParts(project).map((p) => String(p.id)));
  const rows = new Map<string, HardwareBomRow>();

  const ensure = (hardwareId: string): HardwareBomRow => {
    const existing = rows.get(hardwareId);
    if (existing) return existing;
    const hardware = hardwareById.get(hardwareId);
    const row: HardwareBomRow = {
      hardwareId,
      article: hardware?.article ?? '',
      name: hardware?.name ?? 'Позиция не найдена',
      category: hardware ? canonicalCategory(hardware) : 'OTHER',
      manufacturer: hardware?.manufacturer ?? '',
      quantity: 0,
      hasOverride: false,
      connectionIds: [],
      partIds: [],
      // §81: ссылка на отсутствующую позицию — это MISSING, а не ошибка узла.
      status: hardware ? (hardware.archived ? 'WARNING' : 'VALID') : 'MISSING',
    };
    rows.set(hardwareId, row);
    return row;
  };

  for (const conn of project.hardwareConnections) {
    const row = ensure(String(conn.hardwareId));
    row.quantity += connectionUnits(conn);
    if (isOverridden(conn)) row.hasOverride = true;
    row.connectionIds.push(String(conn.id));
    for (const partId of [conn.partAId, conn.partBId]) {
      const key = String(partId);
      if (partIdsSet.has(key) && !row.partIds.includes(key)) row.partIds.push(key);
    }
    if (conn.status === 'ERROR') row.status = 'ERROR';
    else if (conn.status === 'WARNING' && row.status === 'VALID') row.status = 'WARNING';
  }

  // §132: ручная фурнитура без соединения тоже попадает в спецификацию.
  for (const instance of project.hardwareInstances ?? []) {
    if (instance.connectionId) continue;
    const row = ensure(String(instance.hardwareId));
    row.quantity += instance.quantity ?? 1;
    if (!row.partIds.includes(String(instance.partId))) row.partIds.push(String(instance.partId));
  }

  return [...rows.values()]
    .filter((r) => r.quantity > 0)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/** Итого единиц фурнитуры в проекте. */
export function totalHardwareQuantity(project: Project): number {
  return hardwareBom(project).reduce((n, row) => n + row.quantity, 0);
}

const cell = (value: unknown): string => {
  const s = String(value ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** hardware-bom.csv (§137). Колонки строго по §57/§118. */
export function hardwareBomCsv(project: Project): string {
  const header = ['Article', 'Name', 'Category', 'Manufacturer', 'Quantity', 'Status', 'Source'];
  const rows = hardwareBom(project).map((r) => [
    r.article, r.name, r.category, r.manufacturer, String(r.quantity), r.status,
    r.hasOverride ? 'manual' : 'rule',
  ]);
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

/**
 * Страница спецификации фурнитуры для печати (§138/§139).
 * Возвращается SVG — тот же формат, что используют остальные документы,
 * поэтому отдельного движка печати не появляется.
 */
export function hardwareBomSvg(project: Project, title = 'Спецификация фурнитуры'): string {
  const rows = hardwareBom(project);
  const lineHeight = 22;
  const top = 90;
  const width = 1200;
  const height = top + lineHeight * (rows.length + 2) + 40;
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const head = ['Артикул', 'Наименование', 'Категория', 'Производитель', 'Кол-во', 'Статус'];
  const x = [40, 200, 620, 800, 1030, 1110];

  const body: string[] = [];
  body.push(`<text x="40" y="46" font-size="26" fill="#111">${esc(title)}</text>`);
  body.push(`<text x="40" y="70" font-size="13" fill="#555">${esc(project.name)} · позиций: ${rows.length} · единиц: ${totalHardwareQuantity(project)}</text>`);
  head.forEach((h, i) => body.push(`<text x="${x[i]}" y="${top}" font-size="13" fill="#333" font-weight="600">${esc(h)}</text>`));
  body.push(`<line x1="40" y1="${top + 6}" x2="${width - 40}" y2="${top + 6}" stroke="#999"/>`);

  rows.forEach((row, i) => {
    const y = top + lineHeight * (i + 1) + 12;
    const cells = [
      row.article || '—', row.name, row.category, row.manufacturer || '—',
      `${row.quantity}${row.hasOverride ? '*' : ''}`, row.status,
    ];
    cells.forEach((c, k) => body.push(`<text x="${x[k]}" y="${y}" font-size="12" fill="#222">${esc(c)}</text>`));
  });

  if (rows.some((r) => r.hasOverride)) {
    body.push(`<text x="40" y="${height - 20}" font-size="11" fill="#666">* количество задано вручную</text>`);
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>${body.join('')}</svg>`
  );
}
