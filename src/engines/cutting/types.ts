/**
 * Типы ввода раскроя и управления расчётом. Типы РЕЗУЛЬТАТА (Placement,
 * CuttingSheetResult, CuttingResult, CuttingRemnant, …) определены в модели
 * (core/model), так как сохраняются в проекте; здесь они ре-экспортируются.
 */
import type { EdgeMaterialId, MaterialId, PartId } from '@/core/model/ids';
import type { GrainDirection, Mm } from '@/core/model/types';

export type {
  PieceRotation,
  PlacementOrigin,
  TrimSettings,
  LockedPlacement,
  Placement,
  CuttingRemnant,
  CutLine,
  CuttingSheetResult,
  CuttingStatistics,
  CuttingResult,
  UnplacedPiece,
  CuttingSettings,
  CuttingReport,
  CuttingState,
  OptimizationMode,
  UsableRemnantCriteria,
  SheetMaterial,
  StoredRemnant,
} from '@/core/model/types';

import type {
  LockedPlacement,
  TrimSettings,
  OptimizationMode,
  UsableRemnantCriteria,
} from '@/core/model/types';

/** Экземпляр детали для раскроя (разворачивается из Part по количеству). */
export interface CuttingPieceInstance {
  pieceId: string; // напр. "<partId>#1"
  partId: PartId;
  name: string;
  number: string; // Pxxx
  length: Mm;
  width: Mm;
  grain: GrainDirection;
  allowRotate: boolean;
  materialId: MaterialId;
  edges?: { left: EdgeMaterialId | null; right: EdgeMaterialId | null; top: EdgeMaterialId | null; bottom: EdgeMaterialId | null };
}

export interface CuttingOptions {
  respectGrain: boolean;
  attempts: number;
  sortStrategy: string;
  minRemnant: Mm;
  optimizationMode: OptimizationMode;
  usableRemnant: UsableRemnantCriteria;
}

/** Переиспользуемый остаток как «лист» ограниченного размера. */
export interface RemnantSheet {
  id: string; // StoredRemnant.id
  length: Mm;
  width: Mm;
}

/** Вход раскроя ОДНОГО материала. */
export interface CuttingInput {
  materialId: MaterialId;
  pieces: CuttingPieceInstance[];
  sheet: { length: Mm; width: Mm };
  /** Идентификатор формата листа из библиотеки (для отчёта). */
  sheetMaterialId?: string;
  /** Ограниченный запас основных листов (0/undefined — без ограничения). */
  availableQuantity?: number;
  /** Альтернативные форматы листа (по убыванию приоритета) — §23/§24. */
  alternateSheets?: Array<{ id: string; length: Mm; width: Mm; availableQuantity: number }>;
  /** Переиспользуемые остатки (используются перед новыми листами). */
  remnantSheets?: RemnantSheet[];
  kerf: Mm;
  /**
   * Минимальный технологический зазор между деталями сверх пропила (§39).
   * Отсутствие поля = 0 — поведение до этапа 25 сохраняется.
   */
  minGap?: Mm;
  trim: TrimSettings;
  options: CuttingOptions;
  locked?: LockedPlacement[];
}

export interface CuttingProgress {
  fraction: number; // 0..1
  message: string;
}

/** Опциональные хуки прогресса/отмены для длительного расчёта. */
export interface CuttingRunControls {
  onProgress?: (p: CuttingProgress) => void;
  shouldCancel?: () => boolean;
}

export class CuttingCancelledError extends Error {
  constructor() {
    super('Расчёт отменён');
    this.name = 'CuttingCancelledError';
  }
}
