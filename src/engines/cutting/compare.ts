/**
 * Сравнение алгоритмов раскроя (§18/§50).
 *
 * Один и тот же вход прогоняется несколькими зарегистрированными движками;
 * результаты сводятся в таблицу, чтобы пользователь выбрал лучший вариант.
 * Приоритет сравнения зафиксирован (§19):
 *   1) минимум неразмещённых, 2) минимум листов, 3) максимум использования.
 */
import type { CuttingReport, Project } from '@/core/model/types';
import { getCuttingEngine, listCuttingEngines } from './CuttingEngine';
import { buildCuttingInputs, productionSignature } from './buildInput';
import { cuttingCacheKey, getCachedResult, setCachedResult } from './cache';
import type { MaterialId } from '@/core/model/ids';

export interface AlgorithmComparisonRow {
  algorithmId: string;
  algorithmName: string;
  sheetCount: number;
  unplacedCount: number;
  piecesAreaMm2: number;
  sheetsUsableAreaMm2: number;
  remnantAreaMm2: number;
  wasteAreaMm2: number;
  /** КПД: площадь деталей / рабочая площадь листов. */
  efficiency: number;
  /** Доля отхода от рабочей площади листов. */
  wasteRatio: number;
  report: CuttingReport;
}

/**
 * Рассчитать раскрой всеми (или указанными) алгоритмами и вернуть сводку,
 * отсортированную по приоритету оптимизации.
 */
export function compareAlgorithms(
  project: Project,
  options: { algorithmIds?: string[]; materialFilter?: MaterialId; preferFewerSheets?: boolean } = {},
): AlgorithmComparisonRow[] {
  const ids = options.algorithmIds ?? listCuttingEngines().map((e) => e.id);
  const inputs = buildCuttingInputs(project, options.materialFilter);
  const materialName = new Map(project.materials.map((m) => [m.id, m.name]));
  const sourceVersion = productionSignature(project);
  const preferFewerSheets = options.preferFewerSheets ?? project.cutting.settings.preferFewerSheets;

  const rows: AlgorithmComparisonRow[] = [];
  for (const id of ids) {
    const engine = getCuttingEngine(id);
    if (!engine) continue;

    const jobs = inputs.map((input) => {
      const key = cuttingCacheKey(input, id);
      const cached = getCachedResult(key);
      if (cached) return cached;
      const result = engine.calculate(input);
      result.statistics.materialName = materialName.get(input.materialId) ?? '';
      setCachedResult(key, result);
      return result;
    });

    const report: CuttingReport = { jobs, generatedAt: new Date().toISOString(), sourceVersion };
    const sheetCount = jobs.reduce((n, j) => n + j.statistics.sheetCount, 0);
    const unplacedCount = jobs.reduce((n, j) => n + j.unplaced.length, 0);
    const piecesAreaMm2 = jobs.reduce((a, j) => a + j.statistics.piecesAreaMm2, 0);
    const sheetsUsableAreaMm2 = jobs.reduce((a, j) => a + j.statistics.sheetsUsableAreaMm2, 0);
    const remnantAreaMm2 = jobs.reduce((a, j) => a + j.statistics.remnantAreaMm2, 0);
    const wasteAreaMm2 = jobs.reduce((a, j) => a + j.statistics.wasteAreaMm2, 0);

    rows.push({
      algorithmId: id,
      algorithmName: engine.name,
      sheetCount,
      unplacedCount,
      piecesAreaMm2,
      sheetsUsableAreaMm2,
      remnantAreaMm2,
      wasteAreaMm2,
      efficiency: sheetsUsableAreaMm2 > 0 ? piecesAreaMm2 / sheetsUsableAreaMm2 : 0,
      wasteRatio: sheetsUsableAreaMm2 > 0 ? wasteAreaMm2 / sheetsUsableAreaMm2 : 0,
      report,
    });
  }

  // Приоритет: неразмещённые → листы (или КПД) → КПД.
  rows.sort((a, b) => {
    if (a.unplacedCount !== b.unplacedCount) return a.unplacedCount - b.unplacedCount;
    if (preferFewerSheets && a.sheetCount !== b.sheetCount) return a.sheetCount - b.sheetCount;
    if (Math.abs(a.efficiency - b.efficiency) > 1e-9) return b.efficiency - a.efficiency;
    return a.sheetCount - b.sheetCount;
  });
  return rows;
}
