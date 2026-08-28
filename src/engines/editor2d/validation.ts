/**
 * Панель проверок редактора (§135–§138).
 *
 * Своих правил здесь нет: собираются результаты УЖЕ СУЩЕСТВУЮЩИХ проверок —
 * производственной, соединений, кромки и присадки — и привязываются к
 * сущностям холста, чтобы по клику можно было перейти к проблемному объекту
 * (§136) и увидеть значок рядом с ним (§137).
 */
import type { Project } from '@/core/model/types';
import { validateProjectModel } from '@/engines/status';
import { validateProjectConnections } from '@/engines/connections';
import { validateEdges } from '@/engines/edges';
import { allOperations, validateProjectMachining } from '@/engines/machining';
import { boundsOf, rectOf } from './projection';
import type { Bounds2D, EditorEntity } from './types';

export type IssueSeverity = 'ERROR' | 'WARNING' | 'INFO';

/** Замечание, привязанное к сущности холста. */
export interface EditorIssue {
  id: string;
  severity: IssueSeverity;
  message: string;
  /** Сущность холста, к которой относится замечание (§136/§137). */
  entityId?: string;
  /** Раздел-источник: производство, соединения, кромка, присадка. */
  source: 'production' | 'connections' | 'edges' | 'machining';
}

const severityOf = (value: string | undefined): IssueSeverity =>
  value === 'error' || value === 'ERROR' ? 'ERROR' : value === 'info' ? 'INFO' : 'WARNING';

/** Собрать замечания проекта для панели редактора (§135). */
export function collectIssues(project: Project): EditorIssue[] {
  const out: EditorIssue[] = [];

  /* Проверка модели проекта — существующий валидатор (§135): собственных
   * правил редактор не заводит. `targetId` уже указывает на деталь или
   * изделие, поэтому он прямо ложится на сущность холста (§136). */
  const production = validateProjectModel(project);
  production.issues.forEach((issue, i) => {
    out.push({
      id: `prod-${i}`,
      severity: severityOf(issue.severity),
      message: issue.message,
      entityId: issue.targetId ? String(issue.targetId) : undefined,
      source: 'production',
    });
  });

  const connections = validateProjectConnections(project);
  connections.issues.forEach((issue, i) => {
    out.push({
      id: `conn-${i}`,
      severity: severityOf(issue.severity),
      message: issue.message,
      entityId: issue.connectionId ? String(issue.connectionId) : undefined,
      source: 'connections',
    });
  });

  const edges = validateEdges(project);
  edges.issues.forEach((issue, i) => {
    out.push({
      id: `edge-${i}`,
      severity: severityOf(issue.severity),
      message: issue.message,
      entityId: issue.partId ? String(issue.partId) : undefined,
      source: 'edges',
    });
  });

  /* Замечание присадки указывает на ОПЕРАЦИЮ; на холсте видна деталь,
   * поэтому операция сопоставляется со своей деталью. */
  const operations = allOperations(project);
  const partOfOperation = new Map<string, string>(
    operations.map((op) => [String(op.id), String(op.partId)]),
  );
  const machining = validateProjectMachining(project, operations);
  machining.issues.forEach((issue, i) => {
    out.push({
      id: `mach-${i}`,
      severity: severityOf(issue.severity),
      message: issue.message,
      entityId: issue.operationId ? partOfOperation.get(String(issue.operationId)) : undefined,
      source: 'machining',
    });
  });

  return out;
}

/** Статус сущности по её замечаниям (§137/§138). */
export function statusOfEntity(entityId: string, issues: EditorIssue[]): 'VALID' | 'WARNING' | 'ERROR' {
  const own = issues.filter((i) => i.entityId === entityId);
  if (own.some((i) => i.severity === 'ERROR')) return 'ERROR';
  if (own.some((i) => i.severity === 'WARNING')) return 'WARNING';
  return 'VALID';
}

/** Проставить статусы сущностям холста (§137). */
export function markStatuses(entities: EditorEntity[], issues: EditorIssue[]): EditorEntity[] {
  if (issues.length === 0) return entities;
  const byEntity = new Map<string, IssueSeverity>();
  for (const issue of issues) {
    if (!issue.entityId) continue;
    const current = byEntity.get(issue.entityId);
    if (current === 'ERROR') continue;
    byEntity.set(issue.entityId, issue.severity === 'ERROR' ? 'ERROR' : current ?? issue.severity);
  }
  return entities.map((e) => {
    const severity = byEntity.get(e.entityId);
    if (!severity || severity === 'INFO') return e;
    return { ...e, status: severity };
  });
}

/**
 * Куда перевести вид, чтобы показать проблемный объект (§136). Возвращает
 * границы объекта; камеру по ним считает projection.fitBounds.
 */
export function focusBounds(issue: EditorIssue, entities: EditorEntity[]): Bounds2D | null {
  if (!issue.entityId) return null;
  const entity = entities.find((e) => e.entityId === issue.entityId);
  if (!entity) return null;
  const r = rectOf(entity);
  // Небольшой запас вокруг объекта: он не должен упираться в края области.
  const pad = Math.max(50, Math.max(r.width, r.height) * 0.25);
  return { minX: r.x - pad, minY: r.y - pad, maxX: r.x + r.width + pad, maxY: r.y + r.height + pad };
}

/** Границы всего проекта на виде (§90). */
export function projectBounds(entities: EditorEntity[]): Bounds2D | null {
  return boundsOf(entities.filter((e) => !e.hidden));
}

/** Сводка замечаний для заголовка панели. */
export function issueSummary(issues: EditorIssue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((i) => i.severity === 'ERROR').length,
    warnings: issues.filter((i) => i.severity === 'WARNING').length,
  };
}
