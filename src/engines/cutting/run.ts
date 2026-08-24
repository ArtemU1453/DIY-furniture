/**
 * Запуск раскроя по всей модели: разбивка по материалам → движок на каждый
 * материал → агрегированный отчёт (CuttingReport). Отчёт — производное от
 * производственной модели; его версия фиксируется для инвалидации.
 */
import type { CuttingReport, Project } from '@/core/model/types';
import { getCuttingEngine } from './CuttingEngine';
import { buildCuttingInputs, productionSignature } from './buildInput';
import type { CuttingRunControls } from './types';
import type { MaterialId } from '@/core/model/ids';

export const DEFAULT_ENGINE_ID = 'maxrects';

export function runCutting(
  project: Project,
  options: { engineId?: string; materialFilter?: MaterialId; controls?: CuttingRunControls } = {},
): CuttingReport {
  const engine = getCuttingEngine(options.engineId ?? DEFAULT_ENGINE_ID);
  if (!engine) throw new Error(`Движок раскроя «${options.engineId ?? DEFAULT_ENGINE_ID}» не найден`);

  const inputs = buildCuttingInputs(project, options.materialFilter);
  const materialName = new Map(project.materials.map((m) => [m.id, m.name]));

  const jobs = inputs.map((input, i) => {
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
    return result;
  });

  return {
    jobs,
    generatedAt: new Date().toISOString(),
    sourceVersion: productionSignature(project),
  };
}
