/**
 * CSV-экспорт спецификаций со стабильными названиями колонок (§48).
 *   parts · hardware · machining · materials · cutting
 * Данные берутся из производственной модели и готового CuttingResult —
 * ни раскрой, ни присадка здесь не пересчитываются.
 */
import type { Project } from '@/core/model/types';
import { partsListRows } from './partsList';
import { hardwareListRows } from './hardwareList';
import { machiningListRows } from './machiningList';
import { materialListRows } from './materialList';
import { fmtMm } from './notation';

const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const toCsv = (header: string[], rows: string[][]): string =>
  [header, ...rows].map((r) => r.map(q).join(',')).join('\n');

/** parts.csv — спецификация деталей (§23). */
export function partsListCsv(project: Project): string {
  const header = ['Позиция', 'ID', 'Наименование', 'Количество', 'Длина', 'Ширина', 'Толщина', 'Материал', 'Кромка', 'Примечание'];
  const rows = partsListRows(project).map((r) => [
    String(r.position), r.ids, r.name, String(r.quantity),
    fmtMm(r.length), fmtMm(r.width), fmtMm(r.thickness), r.material, r.edge, r.note,
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

/** machining.csv — ведомость присадки (§26/§48). */
export function machiningListCsv(project: Project): string {
  const header = [
    'Operation ID', 'Part ID', 'Type', 'Face', 'X', 'Y',
    'Diameter', 'Depth', 'Datum', 'Notation', 'Connection', 'Hardware',
  ];
  const rows = machiningListRows(project).map((r) => [
    r.operationId, r.partId, r.type, r.face,
    fmtMm(r.x), fmtMm(r.y), r.diameter, r.depth, r.datum, r.notation, r.connection, r.hardware,
  ]);
  return toCsv(header, rows);
}

/** materials.csv — ведомость материалов (§25/§48). */
export function materialListCsv(project: Project): string {
  const header = ['Материал', 'Толщина', 'Количество деталей', 'Общая площадь, м²', 'Примечание'];
  const rows = materialListRows(project).map((r) => [
    r.material, fmtMm(r.thickness), String(r.partCount), r.areaM2.toFixed(3), r.note,
  ]);
  return toCsv(header, rows);
}
