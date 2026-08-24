/**
 * Стратегии предварительной сортировки деталей перед раскроем.
 * Разные стратегии дают разные варианты; движок перебирает несколько и
 * выбирает лучший (см. MaxRectsEngine).
 */
import type { CuttingPieceInstance } from './types';

export type PieceSortingStrategy = {
  id: string;
  name: string;
  compare: (a: CuttingPieceInstance, b: CuttingPieceInstance) => number;
};

const area = (p: CuttingPieceInstance) => p.length * p.width;
const longSide = (p: CuttingPieceInstance) => Math.max(p.length, p.width);
// Тай-брейк по pieceId — детерминированность результата.
const tie = (a: CuttingPieceInstance, b: CuttingPieceInstance) => a.pieceId.localeCompare(b.pieceId);

export const SORT_STRATEGIES: PieceSortingStrategy[] = [
  { id: 'area', name: 'по площади ↓', compare: (a, b) => area(b) - area(a) || tie(a, b) },
  { id: 'longSide', name: 'по длинной стороне ↓', compare: (a, b) => longSide(b) - longSide(a) || tie(a, b) },
  { id: 'width', name: 'по ширине ↓', compare: (a, b) => b.width - a.width || tie(a, b) },
  { id: 'height', name: 'по высоте ↓', compare: (a, b) => b.length - a.length || tie(a, b) },
];

export function getSortStrategy(id: string): PieceSortingStrategy {
  return SORT_STRATEGIES.find((s) => s.id === id) ?? SORT_STRATEGIES[0];
}

export function sortedPieces(pieces: CuttingPieceInstance[], strategyId: string): CuttingPieceInstance[] {
  return [...pieces].sort(getSortStrategy(strategyId).compare);
}
