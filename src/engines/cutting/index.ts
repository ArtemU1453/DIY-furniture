/** Публичный API движка раскроя. */
export { getCuttingEngine, listCuttingEngines, registerCuttingEngine } from './CuttingEngine';
export type { CuttingEngine } from './CuttingEngine';
export { MaxRectsEngine } from './MaxRectsEngine';
export { runCutting, DEFAULT_ENGINE_ID } from './run';
export { buildCuttingInputs, buildPieceInstances, productionSignature, isCuttingStale } from './buildInput';
export { validatePlan, validateResult, validateSheet, type CuttingIssue } from './validator';
export { m2 } from './metrics';
export {
  sheetToSvg, resultToSvg, type SheetDrawingInfo, reportToCsv, reportToJson, cuttingPartsCsv, wasteReportCsv,
  cuttingCsv, remnantsCsv, cuttingSummary, cuttingSummaryCsv, cuttingPlanJson, cutListCsv,
  type CuttingSummaryRow,
} from './export';
export {
  instanceId, parseInstance, instanceLabel, instanceCounts, placementLabel, instancesOf,
} from './instance';
export { buildCuttingJobs, jobId, seedFor, snapshotOf, statusOf, validateJobConsistency } from './jobs';
export { classifyUnplaced, unplacedMessage, toUnplaced } from './unplaced';
export { GuillotineEngine } from './GuillotineEngine';
export { ShelfEngine } from './ShelfEngine';
export { SkylineEngine } from './SkylineEngine';
export {
  CUTTING_ALGORITHMS, DEFAULT_ALGORITHM_KIND, algorithmByEngineId, algorithmByKind,
  availableAlgorithms, engineForKind, kindOfEngine,
  type CuttingAlgorithmInfo, type CuttingAlgorithmKind,
} from './algorithms';
export {
  assembleResult, sheetResultId, type PackedResult, type PackedSheet, type Rect,
} from './assemble';
export {
  profileSignature, resolveCuttingProfile, spacingOf, trimFor, usableArea,
} from './profile';
export {
  DEFAULT_QUALITY_THRESHOLDS, applyPlans, isPlanLocked, markPlanDirty, planId, planOf,
  planStatus, qualityThresholds, refreshPlanStatuses, snapshotMatches, sourceSnapshot, toPlan,
} from './plan';
export {
  QUALITY_LABEL, classifyQuality, planQuality, utilizationPercent, validThresholds,
  wasteArea,
} from './quality';
export {
  BUILT_IN_PRESETS, allPresets, applyPreset, findPreset, matchesPreset, presetFromSettings,
  presetPatch,
} from './presets';
export {
  STANDARD_SHEET_SIZES, canRemoveSheet, filterStock, isSheetInUse, stockItems, stockSummary,
  type StockFilter, type StockItem, type StockItemStatus, type StockKind, type StockSummaryRow,
} from './stock';
export {
  cuttingLabels, labelCode, labelsCsv, parseLabelCode, partLabels,
} from './labels';
export { compareAlgorithms, type AlgorithmComparisonRow } from './compare';
export {
  prepareCuttingParts,
  groupByMaterialThickness,
  isRotationAllowed,
  type CuttingPart,
  type CuttingPartEdges,
} from './preparation';
export { cuttingCacheKey, getCachedResult, setCachedResult, clearCuttingCache, cuttingCacheSize } from './cache';
export { sheetFormats, fitsFormat, formatForPiece, type SheetFormat } from './formats';
export { sheetFormatsFor, stockQuantityOf } from './buildInput';
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
  CuttingPlanStatus,
  CuttingSourceSnapshot,
  CuttingProfile,
  CuttingPreset,
  CuttingQuality,
  QualityThresholds,
  StockMode,
  PartLabel,
  CuttingJob,
  CuttingJobStatus,
  CuttingInstance,
  CuttingSettingsSnapshot,
  UnplacedReason,
  RemnantStatus,
  CuttingResult,
  CuttingSheetResult,
  CuttingRemnant,
  CutLine,
  CuttingStatistics,
  CuttingSettings,
  CuttingReport,
  CuttingState,
  UnplacedPiece,
  CuttingPath,
  OptimizationMode,
  UsableRemnantCriteria,
  SheetMaterial,
  StoredRemnant,
  Placement,
  LockedPlacement,
  TrimSettings,
  PieceRotation,
} from '@/core/model/types';

// ── Этап 30: подготовка деталей к раскрою ────────────────────────────────────
export {
  DEFAULT_LEFTOVER_LIMITS,
  classifyLeftover,
  fitsLeftover,
  fromStoredRemnant,
  harvestLeftovers,
  leftoverOf,
  leftoverSummary,
  leftoversOfResult,
  limitsOf,
  pickLeftover,
  projectLeftovers,
  reuseOrder,
  toStoredRemnant,
  type LeftoverLimits,
  type LeftoverMatchRequest,
  type LeftoverSummary,
} from './leftovers';

export {
  availableSheets,
  consumedRemnantIds,
  freeQuantity,
  markRemnantsUsed,
  releaseJob,
  reserveForJob,
  reservationSummary,
  type ReservationRequest,
  type ReservationResult,
  type ReservationSummary,
} from './reservation';

export {
  applyManualPlacement,
  checkManualPlacement,
  freezeExcept,
  isFrozen,
  lockPlacement,
  lockSheet,
  orientedSize,
  unlockPlacements,
  upsertPlacement,
  usableRect,
  type ManualPlacementCheck,
  type ManualPlacementIssue,
  type ManualPlacementOutcome,
  type ManualPlacementRequest,
} from './manual';

export {
  cutFrames,
  cutSummary,
  isThroughCut,
  orderCuts,
  orderPlacements,
  type CutFrame,
  type CutSummary,
  type OrderedCut,
} from './sequence';

export {
  buildCuttingQueue,
  cuttingCost,
  moveQueueItem,
  projectCuttingCost,
  queueKey,
  queueOrder,
  type CuttingCost,
  type CuttingQueueItem,
} from './queue';

export {
  consistencyErrors,
  cuttingErrors,
  noFitMessage,
  placementErrors,
  projectCuttingErrors,
  summarizeErrors,
  unplacedErrors,
  type CuttingErrorCode,
  type CuttingErrorItem,
  type CuttingErrorSummary,
} from './errors';

export {
  CUTTING_JOB_FORMAT,
  CUTTING_JOB_VERSION,
  applyRebuild,
  bumpVersion,
  enrichJob,
  exportCuttingJobs,
  importCuttingJobs,
  isJobDirty,
  jobStatus,
  jobVersion,
  markJobsDirty,
  readCuttingJob,
  type CuttingJobFile,
  type CuttingJobImport,
  type RebuildOutcome,
} from './jobIo';

export {
  dxfExporter,
  getCuttingExporter,
  listCuttingExporters,
  registerCuttingExporter,
  resultToDxf,
  sheetToDxf,
  type CuttingExporter,
} from './dxf';

export {
  cuttingReport,
  leftoverTableCsv,
  reportSection,
  reportToCsvRows,
  reportTotals,
  type CuttingReportHeader,
  type CuttingReportPart,
  type CuttingReportSection,
  type CuttingReportSheet,
  type CuttingReportTotals,
} from './report';

export type { LeftoverSheet, LeftoverStatus } from '@/core/model/types';
