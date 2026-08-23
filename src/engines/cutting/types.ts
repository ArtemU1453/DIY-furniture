/**
 * Типы ввода/вывода раскроя. Не зависят от конкретного алгоритма.
 */
import type { CuttingPiece, CuttingSheet, Mm } from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';

export interface StockSheet {
  materialId: MaterialId;
  length: Mm;
  width: Mm;
  trim: Mm;
  count?: number; // undefined = неограниченно
}

export interface CuttingOptions {
  respectGrain: boolean;
  minRemnant?: Mm;
  seed?: number;
}

export interface CuttingInput {
  pieces: CuttingPiece[];
  stock: StockSheet[];
  kerf: Mm;
  options: CuttingOptions;
}

export interface CuttingResult {
  sheets: CuttingSheet[];
  summary: {
    sheetsUsed: number;
    usedAreaMm2: number;
    wasteAreaMm2: number;
    utilization: number; // 0..1
  };
  unplaced: CuttingPiece[];
}
