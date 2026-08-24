/**
 * CSV-экспорт спецификаций со стабильными названиями колонок (§34).
 *   PartsList.csv · HardwareList.csv · CuttingList.csv
 * Данные берутся из производственной модели и готового CuttingResult.
 */
import type { Project } from '@/core/model/types';
import { partsListRows } from './partsList';
import { hardwareListRows } from './hardwareList';

const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const toCsv = (header: string[], rows: string[][]): string =>
  [header, ...rows].map((r) => r.map(q).join(',')).join('\n');

/** PartsList.csv — спецификация деталей. */
export function partsListCsv(project: Project): string {
  const header = ['Позиция', 'ID', 'Наименование', 'Количество', 'Длина', 'Ширина', 'Толщина', 'Материал', 'Кромка'];
  const rows = partsListRows(project).map((r) => [
    String(r.position), r.ids, r.name, String(r.quantity),
    String(r.length), String(r.width), String(r.thickness), r.material, r.edge,
  ]);
  return toCsv(header, rows);
}

/** HardwareList.csv — спецификация фурнитуры. */
export function hardwareListCsv(project: Project): string {
  const header = ['№', 'ID', 'Наименование', 'Тип', 'Артикул', 'Количество'];
  const rows = hardwareListRows(project).map((r) => [r.index, r.id, r.name, r.type, r.article, String(r.quantity)]);
  return toCsv(header, rows);
}

/** CuttingList.csv — размещение деталей на листах (из готового CuttingResult). */
export function cuttingListCsv(project: Project): string {
  const header = ['Лист', 'P-ID', 'Наименование', 'Длина', 'Ширина', 'X', 'Y', 'Поворот', 'Материал'];
  const rows: string[][] = [];
  const report = project.cutting.report;
  if (report) {
    for (const job of report.jobs) {
      for (const sheet of job.sheets) {
        for (const p of sheet.placements) {
          rows.push([
            `${sheet.index + 1}${sheet.fromRemnant ? ' (остаток)' : ''}`,
            p.number, p.name,
            String(Math.round(p.length)), String(Math.round(p.width)),
            String(Math.round(p.x)), String(Math.round(p.y)), String(p.rotation),
            job.statistics.materialName,
          ]);
        }
      }
    }
  }
  return toCsv(header, rows);
}
