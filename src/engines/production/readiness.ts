/**
 * Готовность к производству (§63–§75, §113–§115).
 *
 * Готовность — это НЕ отдельная проверка модели: она собирает результаты уже
 * существующих проверок (валидатор проекта, соединения, раскрой, присадка,
 * кромка) в один чек-лист цеха. Второй системы валидации не появляется.
 */
import type { Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { runProductionCheck } from '@/engines/status';
import { allOperations, validateMachining } from '@/engines/machining';
import { isCuttingStale } from '@/engines/cutting';
import type { ProductionPart } from './parts';

/** Пункт чек-листа (§63). */
export type ChecklistId =
  | 'material' | 'cutting' | 'edges' | 'machining' | 'hardware' | 'marking' | 'documents';

export interface ChecklistItem {
  id: ChecklistId;
  label: string;
  ok: boolean;
  /** Пояснение, если пункт не выполнен. */
  detail?: string;
  /** Куда вести пользователя по клику (§66/§67). */
  target?: { kind: 'PART' | 'SECTION'; id: string };
}

export interface ReadinessIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** Объект, к которому относится замечание (§66/§67). */
  target?: { kind: 'PART' | 'SECTION'; id: string };
}

export interface ProductionReadiness {
  /** READY только при отсутствии критических ошибок (§69). */
  ready: boolean;
  checklist: ChecklistItem[];
  issues: ReadinessIssue[];
  errors: number;
  warnings: number;
  /** Доля выполненных пунктов, % (§114/§115). */
  progress: number;
}

const CHECKLIST_LABELS: Record<ChecklistId, string> = {
  material: 'Материал',
  cutting: 'Раскрой',
  edges: 'Кромка',
  machining: 'Присадка',
  hardware: 'Фурнитура',
  marking: 'Маркировка',
  documents: 'Документы',
};

/** Проверка материалов деталей (§70). */
export function checkMaterials(parts: ProductionPart[]): ReadinessIssue[] {
  return parts
    .filter((p) => !p.materialId || p.materialName === '—')
    .map((p) => ({
      severity: 'error' as const,
      code: 'production.material',
      message: `Детали «${p.name}» (${p.number}) не назначен материал.`,
      target: { kind: 'PART' as const, id: String(p.partId) },
    }));
}

/** Проверка размеров (§71). */
export function checkDimensions(parts: ProductionPart[]): ReadinessIssue[] {
  const out: ReadinessIssue[] = [];
  for (const part of parts) {
    if (part.width > 0 && part.height > 0 && part.thickness > 0) continue;
    out.push({
      severity: 'error',
      code: 'production.dimension',
      message: `Размеры детали «${part.name}» (${part.number}) должны быть положительными.`,
      target: { kind: 'PART', id: String(part.partId) },
    });
  }
  return out;
}

/**
 * Проверка кромки (§72).
 *
 * Отсутствие кромки — не ошибка: деталь может быть без облицовки. Ошибка —
 * ссылка на кромочный материал, которого в проекте нет.
 */
export function checkEdges(project: Project, parts: ProductionPart[]): ReadinessIssue[] {
  const known = new Set(project.edges.map((e) => String(e.id)));
  const out: ReadinessIssue[] = [];
  for (const part of parts) {
    for (const edge of part.edges) {
      if (edge.edgeMaterialId && !known.has(edge.edgeMaterialId)) {
        out.push({
          severity: 'error',
          code: 'production.edge',
          message: `Кромка ${edge.label} детали «${part.name}» ссылается на отсутствующий материал.`,
          target: { kind: 'PART', id: String(part.partId) },
        });
      }
    }
  }
  return out;
}

/** Проверка фурнитуры (§73). */
export function checkHardware(project: Project): ReadinessIssue[] {
  const known = new Set(project.hardware.map((h) => String(h.id)));
  const out: ReadinessIssue[] = [];
  for (const connection of project.hardwareConnections) {
    if (!connection.hardwareId || !known.has(String(connection.hardwareId))) {
      out.push({
        severity: 'error',
        code: 'production.hardware',
        message: `Узел ${connection.stableId ?? connection.id}: не определена фурнитура.`,
        target: { kind: 'SECTION', id: 'connections' },
      });
    }
  }
  return out;
}

/**
 * Проверка присадки (§74).
 *
 * Используется существующий валидатор присадки; здесь только перевод его
 * замечаний в термины чек-листа. MachiningIssue ссылается на операцию, поэтому
 * деталь для перехода (§66) находится по operationId.
 */
export function checkMachining(project: Project): ReadinessIssue[] {
  const ops = allOperations(project);
  const partOfOp = new Map(ops.map((op) => [String(op.id), String(op.partId)]));
  return validateMachining(ops, project).map((issue) => {
    const partId = issue.operationId ? partOfOp.get(issue.operationId) : undefined;
    return {
      severity: issue.severity === 'error' ? ('error' as const) : ('warning' as const),
      code: `production.machining.${issue.code}`,
      message: issue.message,
      target: partId
        ? { kind: 'PART' as const, id: partId }
        : { kind: 'SECTION' as const, id: 'machining' },
    };
  });
}

/** Проверка раскроя (§75): все детали должны быть размещены. */
export function checkCuttingPlacement(project: Project): ReadinessIssue[] {
  const report = project.cutting.report;
  if (!report || report.jobs.length === 0) {
    return [{
      severity: 'warning',
      code: 'production.cutting.missing',
      message: 'Раскрой ещё не рассчитан.',
      target: { kind: 'SECTION', id: 'cutting' },
    }];
  }
  const out: ReadinessIssue[] = [];
  if (isCuttingStale(project)) {
    out.push({
      severity: 'warning',
      code: 'production.cutting.stale',
      message: 'Раскрой устарел — модель изменилась после расчёта.',
      target: { kind: 'SECTION', id: 'cutting' },
    });
  }
  for (const job of report.jobs) {
    for (const piece of job.unplaced) {
      out.push({
        severity: 'error',
        code: 'production.cutting.unplaced',
        message: piece.reason ?? `Деталь ${piece.number} не размещена на листе.`,
        target: { kind: 'PART', id: String(piece.partId) },
      });
    }
  }

  const placed = new Set(
    report.jobs.flatMap((job) => job.sheets.flatMap((s) => s.placements.map((p) => String(p.partId)))),
  );
  for (const part of allParts(project)) {
    if (!part.material) continue;
    if (placed.has(String(part.id))) continue;
    out.push({
      severity: 'warning',
      code: 'production.cutting.notPlaced',
      message: `Деталь «${part.name}» отсутствует в раскрое.`,
      target: { kind: 'PART', id: String(part.id) },
    });
  }
  return out;
}

/** Проверка маркировки (§50): у каждой детали должен быть номер. */
export function checkMarking(parts: ProductionPart[]): ReadinessIssue[] {
  return parts
    .filter((p) => !/^P-\d{3,}$/.test(p.number))
    .map((p) => ({
      severity: 'warning' as const,
      code: 'production.marking',
      message: `У детали «${p.name}» нестандартный номер «${p.number}».`,
      target: { kind: 'PART' as const, id: String(p.partId) },
    }));
}

/**
 * Готовность производства (§68/§69).
 *
 * Пункт чек-листа выполнен, если по нему нет ОШИБОК: предупреждения видны, но
 * производство не блокируют — иначе устаревший раскрой останавливал бы цех.
 */
export function productionReadiness(
  project: Project,
  parts: ProductionPart[],
  ctx: { cuttingRunning?: boolean } = {},
): ProductionReadiness {
  const groups: Record<ChecklistId, ReadinessIssue[]> = {
    material: [...checkMaterials(parts), ...checkDimensions(parts)],
    cutting: checkCuttingPlacement(project),
    edges: checkEdges(project, parts),
    machining: checkMachining(project),
    hardware: checkHardware(project),
    marking: checkMarking(parts),
    documents: runProductionCheck(project, { cuttingRunning: ctx.cuttingRunning ?? false })
      .issues.map((issue) => ({
        severity: issue.severity,
        code: `production.documents.${issue.code}`,
        message: issue.message,
        target: { kind: 'SECTION' as const, id: 'documents' },
      })),
  };

  const checklist: ChecklistItem[] = (Object.keys(groups) as ChecklistId[]).map((id) => {
    const issues = groups[id];
    const error = issues.find((i) => i.severity === 'error');
    return {
      id,
      label: CHECKLIST_LABELS[id],
      ok: error === undefined,
      detail: error?.message ?? issues[0]?.message,
      target: error?.target ?? issues[0]?.target,
    };
  });

  const issues = Object.values(groups).flat();
  const errors = issues.filter((i) => i.severity === 'error').length;
  const done = checklist.filter((i) => i.ok).length;

  return {
    ready: errors === 0,
    checklist,
    issues,
    errors,
    warnings: issues.length - errors,
    progress: Math.round((done / checklist.length) * 100),
  };
}
