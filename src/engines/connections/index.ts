/** Публичный API соединений и присадки. */
export {
  partKey,
  connectionStableId,
  connectionKey,
  isDuplicate,
  dedupeConnections,
  connectionNumber,
  connectionNumbers,
  machiningStableId,
} from './identity';

export {
  connectionRules,
  registerConnectionRule,
  planConnections,
  fastenersForSpan,
  hingeCountForHeight,
  hingeLayout,
  DEFAULT_HINGE_THRESHOLDS,
  carcassRule,
  shelfRule,
  partitionRule,
  doorRule,
  drawerConnectionRule,
  type ConnectionRule,
  type ConnectionRuleContext,
  type ConnectionPlanItem,
  type HingeThreshold,
  type HingeLayout,
} from './rules';

export {
  checkConnection,
  checkNewConnection,
  validateConnections as validateProjectConnections,
  type ConnectionIssue,
  type ConnectionCheck,
  type ConnectionValidationReport,
  type ConnectionSeverity,
} from './validator';

export {
  reconcileConnections,
  ensureConnectionHardware,
  pruneDeadConnections,
  affectedConnections,
  connectionSource,
  type ReconcileResult,
} from './reconcile';

export {
  operationKind,
  machiningTypeOfKind,
  validateOperation,
  findIntersections,
  depthLimitForFace,
  OPERATION_KINDS,
  OPERATION_KIND_LABELS,
  type OperationIssue,
} from './operations';

export { connectionsCsv } from './csv';
export { cabinetConnectionContext } from './cabinetContext';

// ── Этап 27: жизненный цикл узла и пресеты соединений ──
export {
  CONNECTION_RULE_VERSION, applyConnections, connectionStatus, isDirty, isOutdated,
  markDirty as markConnectionDirty, partsSignature, refreshConnectionStatuses,
  snapshotOfConnection, withPartsSignature,
} from './lifecycle';
export {
  BUILT_IN_CONNECTION_PRESETS, allConnectionPresets, connectionRemovalImpact,
  createConnection, findConnectionPreset, hardwareForPreset,
  type ConnectionPreset, type ConnectionRemovalImpact, type CreateConnectionInput,
  type CreateConnectionResult,
} from './presets';
