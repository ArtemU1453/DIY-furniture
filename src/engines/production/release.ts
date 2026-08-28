/**
 * Снимки, выпуски и ревизии производства (§76–§84).
 *
 * Выпуск — это ЗАФИКСИРОВАННЫЙ снимок ревизий, а не копия проекта. Он не
 * меняется вслед за моделью (§80), поэтому цех всегда видит то, что ему
 * отдали, а изменения проекта определяются сравнением снимков (§82/§83).
 */
import type {
  MachiningOperation,
  ProductionJob,
  ProductionRelease,
  ProductionSnapshot,
  ProductionState,
  ProductionStatus,
  Project,
} from '@/core/model/types';
import { allOperations } from '@/engines/machining';
import { productionSignature } from '@/engines/cutting';
import type { ProductionPart } from './parts';

/** Простой детерминированный хэш строки (djb2). */
export function signature(source: string): string {
  let h = 5381;
  for (let i = 0; i < source.length; i++) h = ((h << 5) + h + source.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function machiningSignature(ops: MachiningOperation[]): string {
  return signature(
    ops
      .map((op) => `${String(op.partId)}:${op.type}:${op.face}:${Math.round(op.x)}:${Math.round(op.y)}:${op.diameter ?? 0}:${op.depth ?? 0}`)
      .sort()
      .join('|'),
  );
}

function hardwareSignature(project: Project): string {
  const connections = project.hardwareConnections
    .map((c) => `${c.stableId ?? String(c.id)}:${String(c.hardwareId ?? '-')}:${c.quantity ?? 1}`)
    .sort();
  const instances = (project.hardwareInstances ?? [])
    .map((i) => `${String(i.id)}:${String(i.hardwareId)}:${i.quantity ?? 1}`)
    .sort();
  return signature([...connections, '#', ...instances].join('|'));
}

/**
 * Снимок ревизий проекта (§76/§77).
 *
 * Сигнатуры разделов считаются по уже существующим данным: раскрой — той же
 * функцией, что определяет устаревание плана, присадка — по операциям модели.
 */
export function productionSnapshot(
  project: Project,
  parts: ProductionPart[],
  now: string = new Date().toISOString(),
): ProductionSnapshot {
  const partRevisions: Record<string, string> = {};
  for (const part of parts) partRevisions[String(part.partId)] = part.revision;

  const partsRevision = signature(
    Object.keys(partRevisions).sort().map((id) => `${id}=${partRevisions[id]}`).join('|'),
  );
  const cuttingRevision = productionSignature(project);
  const machiningRevision = machiningSignature(allOperations(project));
  const hardwareRevision = hardwareSignature(project);

  return {
    projectRevision: signature([partsRevision, cuttingRevision, machiningRevision, hardwareRevision].join('/')),
    partsRevision,
    cuttingRevision,
    machiningRevision,
    hardwareRevision,
    createdAt: now,
    parts: partRevisions,
  };
}

/** Номер выпуска в человекочитаемом виде: REL-001 (§79). */
export function releaseId(number: number): string {
  return `REL-${String(number).padStart(3, '0')}`;
}

/** Следующий номер выпуска (§79): нумерация сквозная и не переиспользуется. */
export function nextReleaseNumber(releases: ProductionRelease[]): number {
  return releases.reduce((max, r) => Math.max(max, r.number), 0) + 1;
}

/** Новое производственное задание проекта (§1/§2). */
export function createProductionJob(
  project: Project,
  now: string = new Date().toISOString(),
): ProductionJob {
  return {
    id: `job-${String(project.id)}`,
    projectId: String(project.id),
    status: 'DRAFT',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    releases: [],
  };
}

/** Задание проекта или новое, если его ещё нет. */
export function jobOf(project: Project, now?: string): ProductionJob {
  return project.production?.job ?? createProductionJob(project, now);
}

/**
 * Выпуск задания (§78/§79).
 *
 * Возвращается НОВОЕ задание: существующие выпуски копируются как есть, их
 * снимки не пересчитываются (§80).
 */
export function createRelease(
  job: ProductionJob,
  snapshot: ProductionSnapshot,
  options: { partCount: number; note?: string; now?: string } = { partCount: 0 },
): { job: ProductionJob; release: ProductionRelease } {
  const releases = job.releases ?? [];
  const number = nextReleaseNumber(releases);
  const now = options.now ?? snapshot.createdAt;
  const release: ProductionRelease = {
    id: releaseId(number),
    number,
    createdAt: now,
    snapshot: { ...snapshot, parts: { ...snapshot.parts } },
    note: options.note,
    partCount: options.partCount,
  };
  return {
    job: {
      ...job,
      status: 'IN_PROGRESS',
      snapshot,
      releases: [...releases, release],
      updatedAt: now,
    },
    release,
  };
}

/**
 * Новая ревизия задания после правки проекта (§81).
 *
 * Ревизия растёт только при фактическом изменении снимка: пересчёт без правок
 * не должен «портить» уже выпущенное задание.
 */
export function bumpRevision(
  job: ProductionJob,
  snapshot: ProductionSnapshot,
  now: string = snapshot.createdAt,
): ProductionJob {
  /* Первый снимок задаёт точку отсчёта, а не изменение: ревизия 1 остаётся
   * ревизией 1, пока проект действительно не поправили. */
  if (job.snapshot === undefined) return { ...job, snapshot, updatedAt: now };
  if (job.snapshot.projectRevision === snapshot.projectRevision) return job;
  return {
    ...job,
    revision: job.revision + 1,
    snapshot,
    updatedAt: now,
  };
}

/** Статус задания по готовности (§2/§68). */
export function jobStatusFor(
  job: ProductionJob,
  readiness: { ready: boolean; errors: number },
): ProductionStatus {
  if (readiness.errors > 0) return 'ERROR';
  if (job.status === 'COMPLETED') return 'COMPLETED';
  if ((job.releases?.length ?? 0) > 0) return 'IN_PROGRESS';
  return readiness.ready ? 'READY' : 'DRAFT';
}

/** Тип изменения детали между снимками (§82/§83). */
export type ProductionChangeKind = 'ADDED' | 'REMOVED' | 'MODIFIED';

export interface ProductionChange {
  kind: ProductionChangeKind;
  partId: string;
  /** Номер детали, если она есть в текущем расчёте. */
  number?: string;
  name?: string;
}

/** Изменения деталей между снимками (§82). */
export function detectChanges(
  previous: ProductionSnapshot | undefined,
  current: ProductionSnapshot,
  parts: ProductionPart[] = [],
): ProductionChange[] {
  if (!previous) return [];
  const info = new Map(parts.map((p) => [String(p.partId), p]));
  const out: ProductionChange[] = [];

  for (const partId of Object.keys(current.parts).sort()) {
    const before = previous.parts[partId];
    if (before === undefined) {
      out.push({ kind: 'ADDED', partId, number: info.get(partId)?.number, name: info.get(partId)?.name });
    } else if (before !== current.parts[partId]) {
      out.push({ kind: 'MODIFIED', partId, number: info.get(partId)?.number, name: info.get(partId)?.name });
    }
  }
  for (const partId of Object.keys(previous.parts).sort()) {
    if (current.parts[partId] === undefined) out.push({ kind: 'REMOVED', partId });
  }
  return out;
}

/** Разделы, изменившиеся между снимками (§83). */
export function changedSections(
  previous: ProductionSnapshot | undefined,
  current: ProductionSnapshot,
): Array<'parts' | 'cutting' | 'machining' | 'hardware'> {
  if (!previous) return [];
  const out: Array<'parts' | 'cutting' | 'machining' | 'hardware'> = [];
  if (previous.partsRevision !== current.partsRevision) out.push('parts');
  if (previous.cuttingRevision !== current.cuttingRevision) out.push('cutting');
  if (previous.machiningRevision !== current.machiningRevision) out.push('machining');
  if (previous.hardwareRevision !== current.hardwareRevision) out.push('hardware');
  return out;
}

/** Изменился ли проект после последнего выпуска (§81/§82). */
export function isReleaseOutdated(
  release: ProductionRelease | undefined,
  current: ProductionSnapshot,
): boolean {
  return release !== undefined && release.snapshot.projectRevision !== current.projectRevision;
}

/** История выпусков, новейший первым (§84). */
export function productionHistory(state: ProductionState | undefined): ProductionRelease[] {
  const releases = state?.history ?? state?.job?.releases ?? [];
  return [...releases].sort((a, b) => b.number - a.number);
}

/** Выпуск по номеру REL-00X (§84). */
export function findRelease(
  state: ProductionState | undefined,
  id: string,
): ProductionRelease | undefined {
  return productionHistory(state).find((r) => r.id === id);
}

/** Последний выпуск задания (§84). */
export function latestRelease(state: ProductionState | undefined): ProductionRelease | undefined {
  return productionHistory(state)[0];
}
