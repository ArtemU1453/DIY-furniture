/**
 * Задание раскроя как файл (§116–§123).
 *
 * Задание версионируется и хранит снимок расчёта: алгоритм, настройки, размер
 * листа, пропил, обрезку, размещения и повороты (§119). По такому файлу
 * раскрой воспроизводится позже, даже если проект уже изменился.
 *
 * БЕЗОПАСНОСТЬ (§117): импортируемый JSON — ДАННЫЕ. Он разбирается JSON.parse
 * и полем за полем переносится в типизированную структуру; ничего не
 * вычисляется и не выполняется, чужой файл отклоняется.
 */
import type {
  CuttingJob,
  CuttingJobStatus,
  CuttingResult,
  Project,
} from '@/core/model/types';
import { isCuttingStale, productionSignature } from './buildInput';
import { leftoversOfResult, type LeftoverLimits } from './leftovers';

export const CUTTING_JOB_FORMAT = 'karkas-cutting-job';
export const CUTTING_JOB_VERSION = 1;

export interface CuttingJobFile {
  format: typeof CUTTING_JOB_FORMAT;
  version: number;
  exportedAt: string;
  projectSignature: string;
  jobs: CuttingJob[];
}

/** Версия задания (§118). Старые задания читаются как версия 1. */
export function jobVersion(job: CuttingJob): number {
  return job.version ?? 1;
}

/** Повысить версию после успешного пересчёта (§118). */
export function bumpVersion(job: CuttingJob): CuttingJob {
  return { ...job, version: jobVersion(job) + 1, updatedAt: new Date().toISOString() };
}

/**
 * Состояние задания (§123).
 *
 * DIRTY важнее результата: если детали изменились, «посчитано» больше не
 * значит «актуально».
 */
export function jobStatus(job: CuttingJob, options: { dirty?: boolean; running?: boolean } = {}): CuttingJobStatus {
  if (options.running) return 'CALCULATING';
  if (options.dirty || job.dirty) return 'DIRTY';
  if (!job.result) return 'READY';
  if (job.result.unplaced.length > 0) return 'ERROR';
  if (job.result.warnings.length > 0) return 'WARNING';
  return 'VALID';
}

/** Пометить задания требующими пересчёта (§120). */
export function markJobsDirty(jobs: CuttingJob[]): CuttingJob[] {
  return jobs.map((job) => ({ ...job, dirty: true, status: 'DIRTY' as CuttingJobStatus }));
}

/** Изменились ли исходные данные проекта относительно расчёта (§120). */
export function isJobDirty(project: Project, job: CuttingJob): boolean {
  if (job.dirty) return true;
  if (!job.result) return false;
  return isCuttingStale(project);
}

/** Дополнить задание остатками и версией — то, что уходит в файл (§3/§118). */
export function enrichJob(
  job: CuttingJob,
  project: Project,
  limits?: LeftoverLimits,
): CuttingJob {
  const material = project.materials.find((m) => String(m.id) === String(job.materialId));
  return {
    ...job,
    version: jobVersion(job),
    leftovers: job.result ? leftoversOfResult(job.result, material, limits) : [],
    dirty: isJobDirty(project, job),
    status: jobStatus({ ...job, dirty: isJobDirty(project, job) }),
  };
}

/** Экспорт задания (§116). */
export function exportCuttingJobs(project: Project, jobs: CuttingJob[]): string {
  const file: CuttingJobFile = {
    format: CUTTING_JOB_FORMAT,
    version: CUTTING_JOB_VERSION,
    exportedAt: new Date().toISOString(),
    projectSignature: productionSignature(project),
    jobs: jobs.map((job) => enrichJob(job, project)),
  };
  return JSON.stringify(file, null, 2);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface CuttingJobImport {
  ok: boolean;
  jobs: CuttingJob[];
  /** Сигнатура проекта, для которого файл был выгружен. */
  projectSignature?: string;
  /** Совпадает ли файл с текущим проектом (§120). */
  matchesProject?: boolean;
  errors: string[];
}

/** Разобрать одно задание. Непригодная запись отбрасывается, а не ломает файл. */
export function readCuttingJob(raw: unknown): CuttingJob | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const materialId = raw.materialId;
  if (!id || materialId === undefined || materialId === null) return null;
  const thickness = typeof raw.thickness === 'number' ? raw.thickness : 0;
  return {
    id,
    projectId: typeof raw.projectId === 'string' ? raw.projectId : '',
    materialId: materialId as CuttingJob['materialId'],
    thickness,
    sheetFormatId: typeof raw.sheetFormatId === 'string' ? raw.sheetFormatId : undefined,
    instances: Array.isArray(raw.instances) ? (raw.instances as CuttingJob['instances']) : [],
    settings: (isRecord(raw.settings) ? raw.settings : {}) as unknown as CuttingJob['settings'],
    result: isRecord(raw.result) ? (raw.result as unknown as CuttingResult) : undefined,
    status: (typeof raw.status === 'string' ? raw.status : 'READY') as CuttingJobStatus,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    version: typeof raw.version === 'number' ? raw.version : 1,
    leftovers: Array.isArray(raw.leftovers) ? (raw.leftovers as CuttingJob['leftovers']) : undefined,
    dirty: raw.dirty === true,
  };
}

/** Импорт задания (§117). */
export function importCuttingJobs(json: string, project?: Project): CuttingJobImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, jobs: [], errors: ['Файл повреждён: это не JSON.'] };
  }
  if (!isRecord(parsed) || parsed.format !== CUTTING_JOB_FORMAT) {
    return { ok: false, jobs: [], errors: ['Это не файл задания раскроя Karkas.'] };
  }

  const errors: string[] = [];
  const jobs: CuttingJob[] = [];
  for (const item of Array.isArray(parsed.jobs) ? parsed.jobs : []) {
    const job = readCuttingJob(item);
    if (job) jobs.push(job);
    else errors.push('Пропущено задание без идентификатора или материала.');
  }

  const projectSignature = typeof parsed.projectSignature === 'string' ? parsed.projectSignature : undefined;
  return {
    ok: jobs.length > 0,
    jobs,
    projectSignature,
    matchesProject: project && projectSignature
      ? productionSignature(project) === projectSignature
      : undefined,
    errors,
  };
}

// ── Атомарный пересчёт (§121/§122) ───────────────────────────────────────────

export interface RebuildOutcome {
  ok: boolean;
  /** Задание после пересчёта; при отказе — ПРЕЖНЕЕ (§122). */
  job: CuttingJob;
  errors: string[];
}

/**
 * Применить новый результат к заданию (§121/§122).
 *
 * Невалидный результат — не результат: если деталей не размещено или листов
 * нет вовсе, прежний раскрой сохраняется, и производство не остаётся ни с чем.
 */
export function applyRebuild(job: CuttingJob, next: CuttingResult | null | undefined): RebuildOutcome {
  if (!next) {
    return { ok: false, job, errors: ['Пересчёт не дал результата: прежний раскрой сохранён.'] };
  }
  if (next.sheets.length === 0 && job.result && job.result.sheets.length > 0) {
    return { ok: false, job, errors: ['Новый раскрой пуст: прежний раскрой сохранён.'] };
  }
  const errors = next.unplaced.map((p) => p.reason ?? `Деталь ${p.number} не размещена.`);
  const updated: CuttingJob = bumpVersion({
    ...job,
    result: next,
    dirty: false,
    status: next.unplaced.length > 0 ? 'ERROR' : next.warnings.length > 0 ? 'WARNING' : 'VALID',
  });
  return { ok: true, job: updated, errors };
}
