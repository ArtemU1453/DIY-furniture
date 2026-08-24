/**
 * ProjectValidator — целостность единой Project Model.
 * Проверяет обязательные поля, уникальность ID, размеры, существование
 * материалов/деталей, корректность связей, присадки и раскроя.
 */
import type { Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { validatePart } from '@/core/validation';
import { validateConnection } from '@/core/validation/catalog';
import { allOperations, validateMachining } from '@/engines/machining';

export type IssueSeverity = 'error' | 'warning';

export interface ProjectIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  targetId?: string;
}

export interface ProjectValidationResult {
  valid: boolean;
  issues: ProjectIssue[];
}

export function validateProjectModel(project: Project): ProjectValidationResult {
  const issues: ProjectIssue[] = [];

  if (!project.version) {
    issues.push({ severity: 'error', code: 'project.noVersion', message: 'В проекте отсутствует версия формата (schemaVersion).' });
  }
  if (!project.id || !project.name) {
    issues.push({ severity: 'error', code: 'project.noId', message: 'В проекте отсутствуют обязательные поля id/name.' });
  }

  const parts = allParts(project);

  // Уникальность ID деталей.
  const seen = new Set<string>();
  for (const p of parts) {
    if (seen.has(p.id)) {
      issues.push({ severity: 'error', code: 'part.duplicateId', message: `Дубль ID детали: ${p.name}.`, targetId: p.id });
    }
    seen.add(p.id);
  }

  const materialIds = new Set(project.materials.map((m) => m.id));
  const edgeIds = new Set(project.edges.map((e) => e.id));

  for (const p of parts) {
    // Корректность размеров (переиспользуем базовую валидацию детали).
    for (const issue of validatePart(p)) {
      issues.push({ severity: issue.severity, code: issue.code, message: issue.message, targetId: p.id });
    }
    // Существование материала.
    if (!p.material) {
      issues.push({ severity: 'warning', code: 'part.noMaterial', message: `Для детали ${p.name} не назначен материал.`, targetId: p.id });
    } else if (!materialIds.has(p.material)) {
      issues.push({ severity: 'error', code: 'part.badMaterial', message: `Деталь ${p.name} ссылается на несуществующий материал.`, targetId: p.id });
    }
    // Существование кромки.
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const e = p.edges[side];
      if (e && !edgeIds.has(e)) {
        issues.push({ severity: 'error', code: 'part.badEdge', message: `Деталь ${p.name}: кромка ${side} ссылается на несуществующий материал.`, targetId: p.id });
      }
    }
  }

  // Корректность связей фурнитуры.
  for (const conn of project.hardwareConnections) {
    for (const ci of validateConnection(conn, project)) {
      issues.push({ severity: 'error', code: ci.code, message: ci.message, targetId: conn.id });
    }
  }

  // Корректность присадки.
  const ops = allOperations(project);
  for (const mi of validateMachining(ops, project)) {
    if (mi.severity !== 'info') {
      issues.push({ severity: mi.severity, code: mi.code, message: mi.message, targetId: mi.operationId });
    }
  }

  // Корректность раскроя (если рассчитан).
  const report = project.cutting.report;
  if (report) {
    for (const job of report.jobs) {
      if (!materialIds.has(job.materialId)) {
        issues.push({ severity: 'error', code: 'cutting.badMaterial', message: 'Раскрой ссылается на несуществующий материал.' });
      }
      if (job.unplaced.length > 0) {
        issues.push({ severity: 'warning', code: 'cutting.unplaced', message: `Раскрой: ${job.unplaced.length} дет. не размещены (${job.statistics.materialName}).` });
      }
    }
  }

  return { valid: issues.every((i) => i.severity !== 'error'), issues };
}
