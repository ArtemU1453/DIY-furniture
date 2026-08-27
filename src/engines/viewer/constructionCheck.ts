/**
 * ConstructionValidator (3D) — проверка допустимости изменения детали перед
 * записью в ProjectModel: существование детали, положительные размеры,
 * блокировка, коллизии после изменения.
 */
import type { Part, Project } from '@/core/model/types';
import { findPart } from '@/core/model/selectors';
import { detectCollisions } from './collision';

export interface ChangeIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

/** Проверить предполагаемое изменение детали (patch) до применения. */
export function validatePartChange(project: Project, partId: string, patch: Partial<Part>): ChangeIssue[] {
  const issues: ChangeIssue[] = [];
  const part = findPart(project, partId as Part['id']);
  if (!part) {
    issues.push({ severity: 'error', code: 'chg.noPart', message: 'Деталь не найдена.' });
    return issues;
  }
  if (part.metadata?.locked === true) {
    issues.push({ severity: 'error', code: 'chg.locked', message: 'Деталь заблокирована — перемещение/изменение запрещено.' });
  }
  const next = { ...part, ...patch } as Part;
  for (const [v, label] of [[next.width, 'Ширина'], [next.height, 'Высота'], [next.thickness, 'Толщина']] as Array<[number, string]>) {
    if (!Number.isFinite(v) || v <= 0) {
      issues.push({ severity: 'error', code: 'chg.dim', message: `${label} должна быть больше 0 мм.` });
    }
  }
  return issues;
}

/** Проверить коллизии для набора деталей (после изменения). Предупреждение. */
export function collisionWarnings(parts: Part[]): ChangeIssue[] {
  return detectCollisions(parts).map((c) => ({
    severity: 'warning' as const,
    code: 'chg.collision',
    message: `Детали пересекаются: ${c.aName} ↔ ${c.bName}.`,
  }));
}
