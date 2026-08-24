/** Публичный API движка раскроя. */
export { getCuttingEngine, listCuttingEngines, registerCuttingEngine } from './CuttingEngine';
export type { CuttingEngine } from './CuttingEngine';
export { MaxRectsEngine } from './MaxRectsEngine';
export { runCutting, DEFAULT_ENGINE_ID } from './run';
export { buildCuttingInputs, buildPieceInstances, productionSignature, isCuttingStale } from './buildInput';
export { validateResult, validateSheet, type CuttingIssue } from './validator';
export { m2 } from './metrics';
export { sheetToSvg, resultToSvg, reportToCsv, reportToJson } from './export';
export { computeCutLines } from './cutlines';
export { isUsableRemnant } from './remnants';
export { SORT_STRATEGIES, getSortStrategy } from './sort';
export {
  CuttingCancelledError,
  type CuttingInput,
  type CuttingPieceInstance,
  type CuttingOptions,
  type CuttingRunControls,
  type CuttingProgress,
  type RemnantSheet,
} from './types';
export type {
  CuttingResult,
  CuttingSheetResult,
  CuttingRemnant,
  CutLine,
  CuttingStatistics,
  CuttingSettings,
  CuttingReport,
  CuttingState,
  UnplacedPiece,
  OptimizationMode,
  UsableRemnantCriteria,
  SheetMaterial,
  StoredRemnant,
  Placement,
  LockedPlacement,
  TrimSettings,
  PieceRotation,
} from '@/core/model/types';
