/**
 * ProductionCheck — проверка готовности проекта к производству/документации.
 * Агрегирует валидацию модели и статусы модулей.
 */
import type { Project } from '@/core/model/types';
import { validateProjectModel, type ProjectIssue } from './projectValidator';
import { computeModuleStatuses, type ModuleStatus } from './moduleStatus';
import { validateConnections } from './connectionCheck';

export interface ProductionCheckResult {
  ready: boolean;
  issues: ProjectIssue[];
  statuses: ModuleStatus[];
}

export function runProductionCheck(project: Project, ctx: { cuttingRunning: boolean }): ProductionCheckResult {
  const validation = validateProjectModel(project);
  const statuses = computeModuleStatuses(project, ctx);
  const issues = [...validation.issues, ...validateConnections(project)];

  // Устаревшие/незавершённые расчёты — предупреждения перед экспортом документов.
  for (const s of statuses) {
    if (s.state === 'dirty') {
      issues.push({ severity: 'warning', code: `module.${s.id}.dirty`, message: `Модуль «${s.label}» устарел — требуется пересчёт.` });
    }
    if (s.state === 'calculating') {
      issues.push({ severity: 'warning', code: `module.${s.id}.calc`, message: `Модуль «${s.label}» ещё рассчитывается.` });
    }
  }

  const ready = issues.every((i) => i.severity !== 'error');
  return { ready, issues, statuses };
}
