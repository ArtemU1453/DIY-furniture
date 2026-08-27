/**
 * Жизненный цикл карты раскроя (§25/§86–§95).
 *
 * CuttingPlan — это существующий CuttingResult с отметками состояния: id,
 * версия, снимок исходных данных и признак фиксации. Второй сущности плана
 * не заводится, в проекте по-прежнему хранится CuttingReport.
 *
 *   исходные данные → снимок → расчёт → план (VALID)
 *                      ↓ изменились
 *                    DIRTY / OUTDATED → пересчёт → новая версия
 */
import type {
  CuttingPlanStatus,
  CuttingReport,
  CuttingResult,
  CuttingSourceSnapshot,
  Material,
  Project,
  QualityThresholds,
} from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';
import { allParts } from '@/core/model/selectors';
import { isCuttingStale } from './buildInput';
import { profileSignature, resolveCuttingProfile } from './profile';

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = { excellent: 85, good: 75, average: 60 };

/** Стабильный id карты раскроя (§25). */
export function planId(materialId: MaterialId): string {
  return `plan:${materialId}`;
}

/** Зафиксирована ли карта материала (§90). */
export function isPlanLocked(project: Project, materialId: MaterialId): boolean {
  return project.cutting.settings.lockedPlans?.[String(materialId)] === true;
}

/** Снимок исходных данных карты (§94). */
export function sourceSnapshot(project: Project, materialId: MaterialId): CuttingSourceSnapshot {
  const material: Material | undefined = project.materials.find((m) => m.id === materialId);
  const quantities: Record<string, number> = {};
  for (const part of allParts(project)) {
    if (part.material !== materialId) continue;
    quantities[String(part.id)] =
      (quantities[String(part.id)] ?? 0) + part.quantity;
  }
  const stock = [
    ...project.sheets
      .filter((s) => s.materialId === materialId && s.archived !== true)
      .map((s) => `${s.id}:${s.height}x${s.width}:${s.availableQuantity}:${s.stockMode ?? ''}`)
      .sort(),
    ...project.remnants
      .filter((r) => r.materialId === materialId && (r.status ?? 'AVAILABLE') === 'AVAILABLE')
      .map((r) => `rem:${r.id}:${r.width}x${r.height}`)
      .sort(),
  ].join('|');

  return {
    material: material
      ? `${material.id}:${material.thickness}:${material.grain}:${material.allowRotate}`
      : String(materialId),
    profile: profileSignature(resolveCuttingProfile(project, material)),
    quantities,
    stock,
    createdAt: new Date().toISOString(),
  };
}

/** Совпадает ли снимок плана с текущим состоянием проекта (§95). */
export function snapshotMatches(project: Project, plan: CuttingResult): boolean {
  const snap = plan.sourceSnapshot;
  if (!snap) return true; // планы до этапа 25 не считаются устаревшими без причины
  const current = sourceSnapshot(project, plan.materialId);
  return (
    snap.material === current.material &&
    snap.profile === current.profile &&
    snap.stock === current.stock &&
    JSON.stringify(snap.quantities) === JSON.stringify(current.quantities)
  );
}

export function qualityThresholds(project: Project): QualityThresholds {
  return project.cutting.settings.qualityThresholds ?? DEFAULT_QUALITY_THRESHOLDS;
}

/**
 * Состояние карты (§88–§95). Порядок проверок — от «данные недоступны» к
 * «данные устарели» и только потом к качеству результата: заблокированная
 * карта остаётся LOCKED, даже если исходные данные изменились (§91).
 */
export function planStatus(project: Project, plan: CuttingResult): CuttingPlanStatus {
  if (isPlanLocked(project, plan.materialId) || plan.locked) return 'LOCKED';
  if (plan.unplaced.length > 0) return 'ERROR'; // §130
  if (!snapshotMatches(project, plan)) return 'OUTDATED'; // §95
  if (isCuttingStale(project)) return 'DIRTY'; // §88
  const t = qualityThresholds(project);
  if (plan.statistics.utilization * 100 < t.average) return 'WARNING'; // §131
  return 'VALID'; // §89
}

/** Пометить карту как требующую пересчёта (§88). */
export function markPlanDirty(plan: CuttingResult): CuttingResult {
  return plan.status === 'LOCKED' || plan.locked ? plan : { ...plan, status: 'DIRTY' };
}

/**
 * Оформить свежий результат как карту раскроя: id, версия, снимок (§93/§94).
 * `previous` — прежняя карта того же материала, её версия наращивается.
 */
export function toPlan(project: Project, result: CuttingResult, previous?: CuttingResult): CuttingResult {
  const plan: CuttingResult = {
    ...result,
    planId: planId(result.materialId),
    planVersion: (previous?.planVersion ?? 0) + 1,
    sourceSnapshot: sourceSnapshot(project, result.materialId),
    locked: false,
  };
  return { ...plan, status: planStatus(project, plan) };
}

/** Карта материала из сохранённого отчёта. */
export function planOf(project: Project, materialId: MaterialId): CuttingResult | undefined {
  return project.cutting.report?.jobs.find((j) => j.materialId === materialId);
}

/**
 * Атомарное применение нового отчёта (§86/§87/§91).
 *
 * Заблокированные карты переносятся из прежнего отчёта без изменений, для
 * остальных берётся свежий расчёт. Если новый отчёт пуст или сломан —
 * возвращается прежний: «частично применённого» раскроя не бывает.
 */
export function applyPlans(project: Project, next: CuttingReport): CuttingReport {
  const previous = project.cutting.report;
  if (!next || !Array.isArray(next.jobs)) return previous ?? next;

  const prevByMaterial = new Map((previous?.jobs ?? []).map((j) => [String(j.materialId), j]));
  const jobs: CuttingResult[] = [];
  const seen = new Set<string>();

  for (const job of next.jobs) {
    const key = String(job.materialId);
    seen.add(key);
    const prev = prevByMaterial.get(key);
    if (prev && isPlanLocked(project, job.materialId)) {
      // §91: автоматический пересчёт не меняет зафиксированную карту.
      jobs.push({ ...prev, locked: true, status: 'LOCKED' });
      continue;
    }
    jobs.push(toPlan(project, job, prev));
  }

  // Зафиксированные карты материалов, которых нет в новом расчёте, сохраняются.
  for (const [key, prev] of prevByMaterial) {
    if (seen.has(key) || !isPlanLocked(project, prev.materialId)) continue;
    jobs.push({ ...prev, locked: true, status: 'LOCKED' });
  }

  return { ...next, jobs };
}

/** Пересчитать статусы карт сохранённого отчёта (§88/§89/§95). */
export function refreshPlanStatuses(project: Project): CuttingReport | undefined {
  const report = project.cutting.report;
  if (!report) return undefined;
  return {
    ...report,
    jobs: report.jobs.map((plan) => ({
      ...plan,
      locked: isPlanLocked(project, plan.materialId),
      status: planStatus(project, plan),
    })),
  };
}
