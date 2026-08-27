/**
 * Запуск раскроя по всей модели: разбивка по материалам → движок на каждый
 * материал → агрегированный отчёт (CuttingReport). Отчёт — производное от
 * производственной модели; его версия фиксируется для инвалидации.
 */
import type { CuttingReport, CuttingResult, Project } from '@/core/model/types';
import { getCuttingEngine } from './CuttingEngine';
import { buildCuttingInputs, productionSignature } from './buildInput';
import { cuttingCacheKey, getCachedResult, setCachedResult } from './cache';
import { jobId, snapshotOf } from './jobs';
import type { CuttingRunControls } from './types';
import type { MaterialId } from '@/core/model/ids';

export const DEFAULT_ENGINE_ID = 'maxrects';

export function runCutting(
  project: Project,
  options: { engineId?: string; materialFilter?: MaterialId; controls?: CuttingRunControls } = {},
): CuttingReport {
  const engine = getCuttingEngine(options.engineId ?? project.cutting.settings.algorithm ?? DEFAULT_ENGINE_ID);
  if (!engine) throw new Error(`Движок раскроя «${options.engineId ?? project.cutting.settings.algorithm ?? DEFAULT_ENGINE_ID}» не найден`);

  const inputs = buildCuttingInputs(project, options.materialFilter);
  const materialName = new Map(project.materials.map((m) => [m.id, m.name]));
  const thicknessOf = new Map(project.materials.map((m) => [String(m.id), m.thickness]));

  /* Результат помечается алгоритмом, его версией и снимком настроек (§56–§59):
   * по сохранённому раскрою видно, чем и с какими параметрами он посчитан,
   * поэтому его можно воспроизвести даже после смены настроек проекта. */
  const stamp = (result: CuttingResult, input: typeof inputs[number]): CuttingResult => ({
    ...result,
    jobId: jobId(String(project.id), String(input.materialId), thicknessOf.get(String(input.materialId)) ?? 0),
    algorithm: engine.id,
    algorithmVersion: engine.version,
    settingsSnapshot: snapshotOf(input, engine.id, engine.version),
  });

  const jobs = inputs.map((input, i) => {
    // Кэш: одинаковый вход + алгоритм → прежний результат без пересчёта (§45).
    const cacheKey = cuttingCacheKey(input, engine.id);
    const cached = getCachedResult(cacheKey);
    if (cached && !options.controls) return stamp(cached, input);
    const controls: CuttingRunControls = {
      onProgress: (p) =>
        options.controls?.onProgress?.({
          fraction: (i + p.fraction) / inputs.length,
          message: `${materialName.get(input.materialId) ?? ''}: ${p.message}`,
        }),
      shouldCancel: options.controls?.shouldCancel,
    };
    const result = engine.calculate(input, controls);
    result.statistics.materialName = materialName.get(input.materialId) ?? '';
    setCachedResult(cacheKey, result);
    return stamp(result, input);
  });

  return {
    jobs,
    generatedAt: new Date().toISOString(),
    sourceVersion: productionSignature(project),
  };
}
