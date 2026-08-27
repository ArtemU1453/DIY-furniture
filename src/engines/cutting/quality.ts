/**
 * Производственная классификация качества раскроя (§132/§133).
 *
 * Класс определяется ТОЛЬКО формулой по utilization и настраиваемым порогам.
 * Субъективных оценок в коде нет: изменил пороги — изменилась классификация.
 */
import type { CuttingQuality, CuttingResult, CuttingStatistics, QualityThresholds } from '@/core/model/types';
import { DEFAULT_QUALITY_THRESHOLDS } from './plan';

/** Использование, % (§62): площадь деталей / полезная площадь листов × 100. */
export function utilizationPercent(stats: Pick<CuttingStatistics, 'piecesAreaMm2' | 'sheetsUsableAreaMm2'>): number {
  if (stats.sheetsUsableAreaMm2 <= 0) return 0;
  return (stats.piecesAreaMm2 / stats.sheetsUsableAreaMm2) * 100;
}

/** Отход, мм² (§60): полезная площадь листов − площадь деталей. */
export function wasteArea(stats: Pick<CuttingStatistics, 'piecesAreaMm2' | 'sheetsUsableAreaMm2'>): number {
  return Math.max(0, stats.sheetsUsableAreaMm2 - stats.piecesAreaMm2);
}

/** Класс качества по порогам. Пороги — нижние границы в процентах. */
export function classifyQuality(
  utilization: number,
  thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
): CuttingQuality {
  if (utilization >= thresholds.excellent) return 'EXCELLENT';
  if (utilization >= thresholds.good) return 'GOOD';
  if (utilization >= thresholds.average) return 'AVERAGE';
  return 'POOR';
}

export const QUALITY_LABEL: Record<CuttingQuality, string> = {
  EXCELLENT: 'Отличный',
  GOOD: 'Хороший',
  AVERAGE: 'Средний',
  POOR: 'Низкий',
};

/** Класс качества карты раскроя. */
export function planQuality(plan: CuttingResult, thresholds?: QualityThresholds): CuttingQuality {
  return classifyQuality(plan.statistics.utilization * 100, thresholds);
}

/** Пороги корректны: excellent ≥ good ≥ average, все в диапазоне 0…100. */
export function validThresholds(t: QualityThresholds): boolean {
  const inRange = (v: number) => Number.isFinite(v) && v >= 0 && v <= 100;
  return inRange(t.excellent) && inRange(t.good) && inRange(t.average) &&
    t.excellent >= t.good && t.good >= t.average;
}
