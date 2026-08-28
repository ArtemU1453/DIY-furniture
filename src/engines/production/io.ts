/**
 * Производственный пакет: документы, CSV и production-job.json (§116–§140).
 *
 * Все данные берутся из уже существующих экспортов (parts.csv, hardware.csv,
 * machining.csv) — второй системы выгрузок не создаётся. Всё считается
 * локально: файлы отдаются строками, сохранение остаётся за слоем UI (§112).
 */
import type { ProductionJob, ProductionRelease, Project } from '@/core/model/types';
import { partsListCsv, machiningListCsv } from '@/engines/drawing/csv';
import { hardwareCsv } from '@/engines/hardware';
import { sanitizeFileName } from '@/engines/drawing';
import type { ProductionPart } from './parts';
import type { ProductionBatch } from '@/core/model/types';
import type { ProductionReadiness } from './readiness';

export const PRODUCTION_FILE_FORMAT = 'karkas-production-job';
export const PRODUCTION_FILE_VERSION = 1;

const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const toCsv = (header: string[], rows: string[][]): string =>
  [header, ...rows].map((r) => r.map(q).join(',')).join('\n');

/** Типы документов производственного центра (§116). */
export type ProductionDocumentKind =
  | 'PART_CARDS' | 'MACHINING' | 'HARDWARE' | 'LABELS'
  | 'PARTS_CSV' | 'MACHINING_CSV' | 'HARDWARE_CSV';

export const PRODUCTION_DOCUMENT_LABELS: Record<ProductionDocumentKind, string> = {
  PART_CARDS: 'Карты деталей',
  MACHINING: 'Карта присадки',
  HARDWARE: 'Спецификация фурнитуры',
  LABELS: 'Этикетки деталей',
  PARTS_CSV: 'Детали (CSV)',
  MACHINING_CSV: 'Присадка (CSV)',
  HARDWARE_CSV: 'Фурнитура (CSV)',
};

/** Все типы документов пакета в порядке печати (§116/§117). */
export const PRODUCTION_DOCUMENTS: ProductionDocumentKind[] = [
  'PART_CARDS', 'MACHINING', 'HARDWARE', 'LABELS', 'PARTS_CSV', 'MACHINING_CSV', 'HARDWARE_CSV',
];

/** Файл производственного пакета (§137). */
export interface ProductionFile {
  name: string;
  mime: string;
  content: string;
}

/**
 * Имя файла производства (§139): предсказуемое, от названия проекта, без
 * меток времени и случайных суффиксов.
 */
export function productionFileName(
  projectName: string,
  kind: 'job' | 'parts' | 'machining' | 'hardware' | 'batches',
): string {
  const base = sanitizeFileName(projectName);
  const map: Record<string, { suffix: string; ext: string }> = {
    job: { suffix: '_production-job', ext: 'json' },
    parts: { suffix: '_production-parts', ext: 'csv' },
    machining: { suffix: '_machining', ext: 'csv' },
    hardware: { suffix: '_hardware', ext: 'csv' },
    batches: { suffix: '_production-batches', ext: 'csv' },
  };
  const { suffix, ext } = map[kind];
  return `${base}${suffix}.${ext}`;
}

/** production-parts.csv — производственные размеры и статусы деталей (§133). */
export function productionPartsCsv(parts: ProductionPart[]): string {
  const header = [
    'Номер', 'Наименование', 'Материал', 'Толщина', 'Ширина', 'Высота',
    'Заготовка Ш', 'Заготовка В', 'Кол-во', 'Текстура', 'Кромка', 'Операций', 'Ревизия', 'Статус',
  ];
  const rows = parts.map((p) => [
    p.number, p.name, p.materialName, String(p.thickness), String(p.width), String(p.height),
    String(p.rawWidth), String(p.rawHeight), String(p.quantity), p.grain,
    p.edges.filter((e) => e.edgeMaterialId).map((e) => e.label).join(' ') || '—',
    String(p.operations.length), p.revision, p.status,
  ]);
  return toCsv(header, rows);
}

/** production-batches.csv — партии по материалам и видам обработки (§59/§60). */
export function productionBatchesCsv(batches: ProductionBatch[]): string {
  const header = ['Партия', 'Обработка', 'Материал', 'Толщина', 'Деталей', 'Количество', 'Статус'];
  const rows = batches.map((b) => [
    b.id, b.kind, b.materialName, String(b.thickness),
    String(b.partIds.length), String(b.quantity), b.status,
  ]);
  return toCsv(header, rows);
}

/** Содержимое production-job.json (§136). */
export interface ProductionJobFile {
  format: typeof PRODUCTION_FILE_FORMAT;
  version: number;
  projectId: string;
  projectName: string;
  exportedAt: string;
  job: ProductionJob;
  parts: ProductionPart[];
  batches: ProductionBatch[];
  releases: ProductionRelease[];
  readiness?: { ready: boolean; errors: number; warnings: number; progress: number };
}

/** Экспорт производственного задания в JSON (§136). */
export function exportProductionJob(
  project: Project,
  data: {
    job: ProductionJob;
    parts: ProductionPart[];
    batches: ProductionBatch[];
    releases?: ProductionRelease[];
    readiness?: ProductionReadiness;
    now?: string;
  },
): string {
  const file: ProductionJobFile = {
    format: PRODUCTION_FILE_FORMAT,
    version: PRODUCTION_FILE_VERSION,
    projectId: String(project.id),
    projectName: project.name,
    exportedAt: data.now ?? new Date().toISOString(),
    job: data.job,
    parts: data.parts,
    batches: data.batches,
    releases: data.releases ?? data.job.releases ?? [],
    readiness: data.readiness
      ? {
        ready: data.readiness.ready,
        errors: data.readiness.errors,
        warnings: data.readiness.warnings,
        progress: data.readiness.progress,
      }
      : undefined,
  };
  return JSON.stringify(file, null, 2);
}

export interface ProductionJobImport {
  ok: boolean;
  file?: ProductionJobFile;
  error?: string;
}

/**
 * Импорт production-job.json (§140).
 *
 * Импорт НЕ подменяет модель проекта: он возвращает разобранные данные, а
 * решение об их применении принимает вызывающий код.
 */
export function importProductionJob(text: string): ProductionJobImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Файл повреждён: не удалось прочитать JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'Файл не содержит производственного задания.' };
  }
  const file = parsed as Partial<ProductionJobFile>;
  if (file.format !== PRODUCTION_FILE_FORMAT) {
    return { ok: false, error: 'Неподходящий формат файла — ожидается производственное задание Karkas.' };
  }
  if (typeof file.version !== 'number' || file.version > PRODUCTION_FILE_VERSION) {
    return { ok: false, error: `Версия файла ${String(file.version)} новее поддерживаемой (${PRODUCTION_FILE_VERSION}).` };
  }
  if (!file.job || !Array.isArray(file.parts)) {
    return { ok: false, error: 'В файле нет задания или списка деталей.' };
  }
  return {
    ok: true,
    file: {
      format: PRODUCTION_FILE_FORMAT,
      version: file.version,
      projectId: String(file.projectId ?? ''),
      projectName: String(file.projectName ?? ''),
      exportedAt: String(file.exportedAt ?? ''),
      job: file.job,
      parts: file.parts,
      batches: Array.isArray(file.batches) ? file.batches : [],
      releases: Array.isArray(file.releases) ? file.releases : [],
      readiness: file.readiness,
    },
  };
}

/**
 * Производственный пакет целиком (§137/§138): JSON задания и CSV-выгрузки.
 * Чертежи и карты остаются документами — они печатаются отдельно.
 */
export function productionPackage(
  project: Project,
  data: {
    job: ProductionJob;
    parts: ProductionPart[];
    batches: ProductionBatch[];
    readiness?: ProductionReadiness;
    now?: string;
  },
): ProductionFile[] {
  return [
    {
      name: productionFileName(project.name, 'job'),
      mime: 'application/json',
      content: exportProductionJob(project, data),
    },
    {
      name: productionFileName(project.name, 'parts'),
      mime: 'text/csv',
      content: productionPartsCsv(data.parts),
    },
    {
      name: productionFileName(project.name, 'batches'),
      mime: 'text/csv',
      content: productionBatchesCsv(data.batches),
    },
    {
      name: productionFileName(project.name, 'machining'),
      mime: 'text/csv',
      content: machiningListCsv(project),
    },
    {
      name: productionFileName(project.name, 'hardware'),
      mime: 'text/csv',
      content: hardwareCsv(project),
    },
    {
      name: `${sanitizeFileName(project.name)}_parts.csv`,
      mime: 'text/csv',
      content: partsListCsv(project),
    },
  ];
}

/** Состав пакета для предпросмотра (§138). */
export function packageContents(files: ProductionFile[]): Array<{ name: string; size: number }> {
  return files.map((f) => ({ name: f.name, size: f.content.length }));
}
