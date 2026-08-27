/**
 * Имена файлов экспорта (§47) — предсказуемые, от названия проекта:
 *
 *   ProjectName.pdf
 *   ProjectName_parts.csv
 *   ProjectName_hardware.csv
 *   ProjectName_machining.csv
 *   ProjectName_materials.csv
 *   ProjectName_cutting.csv
 *   ProjectName.json
 *
 * Никаких случайных имён и меток времени в имени.
 */

/** Привести название проекта к безопасному имени файла (без расширения). */
export function sanitizeFileName(name: string): string {
  return name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'project';
}

export type ExportKind =
  | 'pdf' | 'json' | 'parts' | 'hardware' | 'machining' | 'materials' | 'cutting';

const SUFFIX: Record<ExportKind, { suffix: string; ext: string }> = {
  pdf: { suffix: '', ext: 'pdf' },
  json: { suffix: '', ext: 'json' },
  parts: { suffix: '_parts', ext: 'csv' },
  hardware: { suffix: '_hardware', ext: 'csv' },
  machining: { suffix: '_machining', ext: 'csv' },
  materials: { suffix: '_materials', ext: 'csv' },
  cutting: { suffix: '_cutting', ext: 'csv' },
};

/** Имя файла экспорта для проекта: exportFileName('Шкаф', 'parts') → 'Шкаф_parts.csv'. */
export function exportFileName(projectName: string, kind: ExportKind): string {
  const { suffix, ext } = SUFFIX[kind];
  return `${sanitizeFileName(projectName)}${suffix}.${ext}`;
}

/** Имя файла одного документа: 'Шкаф_Сборочный_чертёж.svg'. */
export function documentFileName(projectName: string, docTitle: string, ext: 'svg' | 'png' | 'pdf'): string {
  return `${sanitizeFileName(projectName)}_${sanitizeFileName(docTitle)}.${ext}`;
}
