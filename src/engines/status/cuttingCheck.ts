/**
 * CuttingCheck — производственная проверка раскроя.
 *
 * Проверяет: все ли детали размещены, актуален ли результат (CURRENT), нет ли
 * пересечений/выхода за лист/ошибок текстуры (через валидатор движка), а также
 * корректность материала/толщины листа. Использует СУЩЕСТВУЮЩИЙ результат
 * раскроя (project.cutting.report) без повторного расчёта.
 */
import type { Project } from '@/core/model/types';
import { buildCuttingInputs, isCuttingStale, validateResult } from '@/engines/cutting';
import type { ProjectIssue } from './projectValidator';

export function validateCutting(project: Project): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const report = project.cutting.report;

  if (!report) {
    issues.push({ severity: 'warning', code: 'cut.notRun', message: 'Раскрой не рассчитан.' });
    return issues;
  }

  // Актуальность (CURRENT vs OUTDATED).
  if (isCuttingStale(project)) {
    issues.push({ severity: 'warning', code: 'cut.stale', message: 'Раскрой устарел — модель изменилась, требуется пересчёт.' });
  }

  const inputsByMaterial = new Map(buildCuttingInputs(project).map((i) => [i.materialId, i]));
  const materials = new Map(project.materials.map((m) => [m.id, m]));

  for (const job of report.jobs) {
    const material = materials.get(job.materialId);
    if (!material) {
      issues.push({ severity: 'error', code: 'cut.badMaterial', message: 'Раскрой ссылается на несуществующий материал.' });
      continue;
    }

    // Неразмещённые детали.
    if (job.unplaced.length > 0) {
      issues.push({
        severity: 'error',
        code: 'cut.unplaced',
        message: `Раскрой «${material.name}»: не размещено ${job.unplaced.length} дет. (${job.unplaced.map((p) => p.number).join(', ')}).`,
      });
    }

    // Предупреждения движка (нехватка материала и т.п.).
    for (const w of job.warnings ?? []) {
      issues.push({ severity: 'warning', code: 'cut.warning', message: `Раскрой «${material.name}»: ${w}` });
    }

    // Толщина: выбранный формат листа должен совпадать с толщиной материала.
    const chosenSheet = project.sheets.find((s) => s.id === job.sheets[0]?.sheetMaterialId);
    if (chosenSheet && chosenSheet.thickness !== material.thickness) {
      issues.push({
        severity: 'warning',
        code: 'cut.thickness',
        message: `Раскрой «${material.name}»: толщина листа (${chosenSheet.thickness} мм) не совпадает с толщиной материала (${material.thickness} мм).`,
      });
    }

    // Геометрия: пересечения / выход за лист / поворот.
    const input = inputsByMaterial.get(job.materialId);
    if (input) {
      const geomIssues = validateResult(job.sheets, input);
      for (const gi of geomIssues) {
        issues.push({ severity: gi.severity, code: gi.code, message: gi.message });
      }
    }
  }

  return issues;
}
