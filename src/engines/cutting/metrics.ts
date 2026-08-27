/**
 * CuttingMetrics — вычисление показателей раскроя (использование, отход,
 * статистика). Все величины считаются от реальных размещений; внутренние
 * расчёты не округляются заранее.
 */
import type { CuttingSheetResult, CuttingStatistics, Placement } from './types';
import type { MaterialId } from '@/core/model/ids';

export function placementsArea(placements: Placement[]): number {
  return placements.reduce((a, p) => a + p.length * p.width, 0);
}

/**
 * Показатели листа. Свободная площадь делится на ПОЛЕЗНЫЕ остатки (REMNANT,
 * пригодны к повторному использованию) и безвозвратный ОТХОД (WASTE).
 */
export function computeSheetStats(
  placements: Placement[],
  usableAreaMm2: number,
  remnantAreaMm2 = 0,
): {
  used: number;
  remnant: number;
  waste: number;
  utilization: number;
} {
  const used = placementsArea(placements);
  const free = Math.max(0, usableAreaMm2 - used);
  const remnant = Math.min(Math.max(0, remnantAreaMm2), free);
  const waste = Math.max(0, free - remnant);
  const utilization = usableAreaMm2 > 0 ? used / usableAreaMm2 : 0;
  return { used, remnant, waste, utilization };
}

export function computeStatistics(
  materialId: MaterialId,
  sheets: CuttingSheetResult[],
  _unplacedCount: number,
  materialName = '',
): CuttingStatistics {
  const pieceCount = sheets.reduce((n, s) => n + s.placements.length, 0);
  const piecesAreaMm2 = sheets.reduce((a, s) => a + s.usedAreaMm2, 0);
  const sheetsUsableAreaMm2 = sheets.reduce((a, s) => a + s.usableAreaMm2, 0);
  const remnantAreaMm2 = sheets.reduce((a, s) => a + (s.remnantAreaMm2 ?? 0), 0);
  const wasteAreaMm2 = Math.max(0, sheetsUsableAreaMm2 - piecesAreaMm2 - remnantAreaMm2);
  const utilization = sheetsUsableAreaMm2 > 0 ? piecesAreaMm2 / sheetsUsableAreaMm2 : 0;
  return {
    materialId,
    materialName,
    pieceCount,
    sheetCount: sheets.length,
    piecesAreaMm2,
    sheetsUsableAreaMm2,
    remnantAreaMm2,
    wasteAreaMm2,
    utilization,
  };
}

/** мм² → м² с округлением до 2 знаков (для отображения). */
export const m2 = (mm2: number): number => Math.round((mm2 / 1_000_000) * 100) / 100;
