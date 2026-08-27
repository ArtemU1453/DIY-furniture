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
