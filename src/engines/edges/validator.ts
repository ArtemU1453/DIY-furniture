/**
 * Проверка кромки (§43/§44).
 *
 * Разделение важное: отсутствие материала в библиотеке — WARNING (деталь
 * сделать можно, выбрав замену), а бессмысленные размеры — ERROR (такую
 * операцию выполнить нельзя).
 */
import type { EdgeBanding, Project } from '@/core/model/types';
import { allEdgeBanding } from './banding';

export interface EdgeIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  partId: string;
  side: string;
}

/** Проверить одну кромку. */
export function checkEdgeBanding(project: Project, banding: EdgeBanding): EdgeIssue[] {
  const issues: EdgeIssue[] = [];
  const at = { partId: String(banding.partId), side: banding.side };

  const material = project.edges.find((e) => e.id === banding.materialId);
  if (!material) {
    /* Материала нет — толщина и ширина взяться неоткуда, поэтому проверять их
     * бессмысленно: сообщение про «нулевую толщину» только маскировало бы
     * настоящую причину. Ограничиваемся одним предупреждением (§44). */
    issues.push({
      severity: 'warning',
      code: 'edge.missingMaterial',
      message: 'Материал кромки отсутствует в библиотеке проекта.',
      ...at,
    });
    return issues;
  }
  if (material.archived) {
    issues.push({
      severity: 'warning',
      code: 'edge.archivedMaterial',
      message: `Кромка «${material.name}» архивная — в новых проектах не предлагается.`,
      ...at,
    });
  }

  if (banding.thickness <= 0) {
    issues.push({ severity: 'error', code: 'edge.badThickness', message: 'Толщина кромки должна быть больше нуля.', ...at });
  }
  if (banding.width <= 0) {
    issues.push({ severity: 'error', code: 'edge.badWidth', message: 'Ширина кромки должна быть больше нуля.', ...at });
  }
  if (banding.length <= 0) {
    issues.push({ severity: 'error', code: 'edge.badLength', message: 'Длина стороны должна быть больше нуля.', ...at });
  }
  if (banding.quantity <= 0) {
    issues.push({ severity: 'error', code: 'edge.badQuantity', message: 'Количество деталей должно быть больше нуля.', ...at });
  }

  // Кромка толще плиты физически не приклеится к торцу.
  return issues;
}

export interface EdgeValidationReport {
  issues: EdgeIssue[];
  errors: number;
  warnings: number;
  statuses: Map<string, EdgeBanding['status']>;
}

/** Проверить всю кромку проекта. */
export function validateEdges(project: Project): EdgeValidationReport {
  const issues: EdgeIssue[] = [];
  const statuses = new Map<string, EdgeBanding['status']>();
  for (const banding of allEdgeBanding(project)) {
    const found = checkEdgeBanding(project, banding);
    issues.push(...found);
    const status = found.some((i) => i.severity === 'error')
      ? 'ERROR'
      : found.length > 0
        ? 'WARNING'
        : 'VALID';
    statuses.set(banding.id, status);
  }
  return {
    issues,
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    statuses,
  };
}
