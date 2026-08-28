/** Публичный API производственного модуля (этап 31). */
export {
  EDGE_LABELS,
  findProductionPart,
  partIssues,
  partNumber,
  partRevision,
  productionEdges,
  productionOperations,
  productionParts,
  rawDimensions,
  type ProductionEdge,
  type ProductionOperation,
  type ProductionPart,
} from './parts';

export {
  batchLabel,
  batchSummary,
  productionBatches,
  type BatchKind,
  type BatchSummary,
} from './batches';

export {
  checkCuttingPlacement,
  checkDimensions,
  checkEdges,
  checkHardware,
  checkMachining,
  checkMarking,
  checkMaterials,
  productionReadiness,
  type ChecklistId,
  type ChecklistItem,
  type ProductionReadiness,
  type ReadinessIssue,
} from './readiness';

export {
  bumpRevision,
  changedSections,
  createProductionJob,
  createRelease,
  detectChanges,
  findRelease,
  isReleaseOutdated,
  jobOf,
  jobStatusFor,
  latestRelease,
  nextReleaseNumber,
  productionHistory,
  productionSnapshot,
  releaseId,
  signature,
  type ProductionChange,
  type ProductionChangeKind,
} from './release';

export {
  CARD_VIEWS,
  CARD_VIEW_LABELS,
  cardEdges,
  cardOperations,
  cardViews,
  operationNotation,
  partCard,
  partCards,
  type CardEdgeRow,
  type CardOperationRow,
  type CardView,
  type CardViewInfo,
  type PartCard,
} from './card';

export {
  DEFAULT_LABEL_SIZE,
  LABEL_SIZES,
  labelPreview,
  labelSheets,
  labelSize,
  productionLabels,
  type LabelSheet,
  type LabelSize,
  type ProductionLabel,
} from './label';

export {
  clearQrGenerators,
  getQrGenerator,
  listQrGenerators,
  parseQrPayload,
  qrMatrix,
  qrMatrixToSvg,
  qrPayload,
  registerQrGenerator,
  type QrGenerator,
  type QrMatrix,
  type QrPayload,
} from './qr';

export {
  barcodeBars,
  barcodeSvg,
  barcodeWidth,
  isBarcodeChar,
  toBarcodeText,
  type BarcodeBar,
} from './barcode';

export {
  PRODUCTION_DOCUMENTS,
  PRODUCTION_DOCUMENT_LABELS,
  PRODUCTION_FILE_FORMAT,
  PRODUCTION_FILE_VERSION,
  exportProductionJob,
  importProductionJob,
  packageContents,
  productionBatchesCsv,
  productionFileName,
  productionPackage,
  productionPartsCsv,
  type ProductionDocumentKind,
  type ProductionFile,
  type ProductionJobFile,
  type ProductionJobImport,
} from './io';

export {
  filterProductionParts,
  machiningTable,
  productionDashboard,
  sortProductionParts,
  type MachiningTableRow,
  type ProductionDashboard,
  type ProductionFilter,
  type ProductionSortField,
} from './dashboard';

export type {
  ProductionBatch,
  ProductionJob,
  ProductionPartStatus,
  ProductionRelease,
  ProductionSnapshot,
  ProductionState,
  ProductionStatus,
} from '@/core/model/types';
