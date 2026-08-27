/** Публичный API движка кромки. */
export {
  EDGE_SIDES, EDGE_SYMBOL, OPPOSITE_SIDE, SIDE_LABELS,
  sideLength, sideDirection, longSides, shortSides, rotateSide, rotateSideFlags,
} from './sides';
export {
  edgeBandingId, edgeBandingForSide, edgeBandingWith, edgeBandingForPart, edgeBandingForPartWith, allEdgeBanding,
  bandingTotalLength, edgeCount, edgeSourceOf, DEFAULT_EDGE_WIDTH,
} from './banding';
export {
  edgeRules, registerEdgeRule, facadeRule, carcassFrontRule, defaultEdgeFor,
  applyEdgeConfiguration, edgeSidesOf, planEdges, quickActionConfig,
  type EdgeRule, type EdgeConfiguration, type EdgeSides, type EdgeQuickAction,
} from './rules';
export {
  builtinPresets, findPreset, presetWithMaterial, applyPresetTo, partsOfRole,
  presetFromPart, longSidesPreset, shortSidesPreset, type PresetApplication,
} from './presets';
export { checkEdgeBanding, validateEdges, type EdgeIssue, type EdgeValidationReport } from './validator';
export { edgeOperations, edgeOperationsForPart, operationFor, operationLength, edgeAllowance, statusOf } from './operations';
export {
  edgeSummary, totalEdgeLength, meters, purchaseRounding, roundUpTo,
  edgeCuttingJobs, rollUsage, type EdgeSummaryRow, type EdgeCuttingJob, type EdgeRollUsage,
} from './summary';
export { edgeBandingCsv, edgeSummaryCsv } from './csv';
export type {
  EdgeBanding, EdgeProfile, EdgePreset, EdgeOperation, EdgeOperationStatus,
  EdgeRoll, EdgeSide, EdgeSource, EdgeStatus, EdgeDirection, EdgeOverride,
} from '@/core/model/types';
