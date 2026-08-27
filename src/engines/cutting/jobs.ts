/**
 * CuttingJob — задание раскроя (§3).
 *
 * Одно задание = ОДИН материал одной толщины (§25/§26). Разные материалы и
 * разные толщины дают РАЗНЫЕ задания (§75), поэтому 16 мм и 18 мм физически
 * не могут попасть на один лист.
 *
 * Задание — производное от ProjectModel: оно не хранит копии деталей, только
 * ссылки-экземпляры (partId + instanceIndex), поэтому второй системы деталей
 * не появляется (§5/§81).
 */
import type {
  CuttingJob,
  CuttingJobStatus,
  CuttingResult,
  CuttingSettingsSnapshot,
  Material,
  Project,
} from '@/core/model/types';
import type { CuttingInput } from './types';
import { buildCuttingInputs } from './buildInput';
import { parseInstance } from './instance';
import { getCuttingEngine } from './CuttingEngine';
import { DEFAULT_ENGINE_ID } from './run';

/**
 * Детерминированное зерно расчёта (§20). Раскрой не использует случайность:
 * зерно выводится из самих входных данных, поэтому один и тот же проект с
 * теми же настройками всегда даёт один и тот же результат (§103). Поле
 * существует, чтобы это свойство было видно в снимке, а не подразумевалось.
 */
export function seedFor(input: CuttingInput): number {
  let h = 5381;
  const src = [
    input.materialId,
    input.sheet.length,
    input.sheet.width,
    input.kerf,
    ...input.pieces.map((p) => `${p.pieceId}:${p.length}x${p.width}`),
  ].join('|');
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  return h;
}

/** Снимок параметров расчёта (§58/§59). */
export function snapshotOf(input: CuttingInput, algorithm: string, algorithmVersion: string): CuttingSettingsSnapshot {
  return {
    algorithm,
    algorithmVersion,
    kerf: input.kerf,
    trim: { ...input.trim },
    respectGrain: input.options.respectGrain,
    attempts: input.options.attempts,
    sortStrategy: input.options.sortStrategy,
    optimizationMode: input.options.optimizationMode,
    usableRemnant: { ...input.options.usableRemnant },
    sheet: { ...input.sheet },
    sheetMaterialId: input.sheetMaterialId,
    seed: seedFor(input),
  };
}

/** Стабильный id задания: проект + материал + толщина. */
export function jobId(projectId: string, materialId: string, thickness: number): string {
  return `job-${projectId}-${materialId}-${thickness}`;
}

/**
 * Построить задания раскроя проекта. Задания создаются из тех же входов, что
 * и сам расчёт, поэтому job и result всегда описывают одно и то же.
 */
export function buildCuttingJobs(project: Project, engineId?: string): CuttingJob[] {
  const id = engineId ?? project.cutting.settings.algorithm ?? DEFAULT_ENGINE_ID;
  const engine = getCuttingEngine(id);
  const version = engine?.version ?? '0';
  const materials = new Map<string, Material>(project.materials.map((m) => [String(m.id), m]));
  const now = new Date().toISOString();
  const results = new Map<string, CuttingResult>(
    (project.cutting.report?.jobs ?? []).map((r) => [String(r.materialId), r]),
  );

  return buildCuttingInputs(project).map((input) => {
    const material = materials.get(String(input.materialId));
    const thickness = material?.thickness ?? 0;
    const result = results.get(String(input.materialId));
    return {
      id: jobId(String(project.id), String(input.materialId), thickness),
      projectId: String(project.id),
      materialId: input.materialId,
      thickness,
      sheetFormatId: input.sheetMaterialId,
      instances: input.pieces
        .map((p) => parseInstance(p.pieceId))
        .filter((x): x is NonNullable<typeof x> => x !== null),
      settings: snapshotOf(input, id, version),
      result,
      status: statusOf(result),
      createdAt: now,
      updatedAt: now,
    };
  });
}

/**
 * Статус задания (§3). Задание без результата ещё не считалось; результат с
 * неразмещёнными деталями — ошибка, о которой пользователь должен узнать.
 */
export function statusOf(result: CuttingResult | undefined): CuttingJobStatus {
  if (!result) return 'PENDING';
  return result.unplaced.length > 0 ? 'ERROR' : 'DONE';
}

/**
 * Проверка однородности задания (§25/§26): в одном задании не должно быть
 * деталей разных материалов или разных толщин.
 */
export function validateJobConsistency(job: CuttingJob, project: Project): string[] {
  const errors: string[] = [];
  const byId = new Map(project.materials.map((m) => [String(m.id), m]));
  const partById = new Map<string, { material: string | null; thickness: number }>();
  for (const f of project.furnitures) {
    for (const a of f.assemblies) {
      for (const p of a.parts) {
        partById.set(String(p.id), { material: p.material ? String(p.material) : null, thickness: p.thickness });
      }
    }
  }
  for (const inst of job.instances) {
    const part = partById.get(String(inst.partId));
    if (!part) continue;
    if (part.material !== String(job.materialId)) {
      errors.push(`Деталь ${inst.id}: материал не совпадает с материалом задания.`);
    }
    const material = byId.get(String(job.materialId));
    if (material && Math.abs(material.thickness - job.thickness) > 1e-6) {
      errors.push(`Задание ${job.id}: толщина листа не совпадает с толщиной материала.`);
    }
  }
  return errors;
}
