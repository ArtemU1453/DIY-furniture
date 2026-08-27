/** Публичный API движка присадки. */
export {
  generateMachining,
  manualOperations,
  allOperations,
  operationsForPart,
} from './generate';
export {
  validateMachining,
  validateDrillingDepth,
  validateBounds,
  validateCollisions,
  validateEdgeDistance,
  validateReferences,
  allowedDepth,
  type MachiningIssue,
  type MachiningSeverity,
} from './validate';
export {
  registerMachiningRule,
  getMachiningRule,
  dowelRule,
  confirmatRule,
  minifixRule,
  camLockRule,
  screwRule,
  hingeRule,
  handleRule,
  type MachiningRule,
  type RuleInput,
} from './rules';
export { analyzeJoint, inferJointType, type JointAnalysis } from './joint';
export {
  connectionTypeOfCategory,
  categoryOfConnectionType,
  resolveConnectionType,
  CONNECTION_TYPES,
  CONNECTION_TYPE_LABELS,
} from './connectionType';
export {
  symmetricPositions,
  isSymmetric,
  fastenerCountForLength,
  DEFAULT_FASTENER_COUNT,
  type FastenerCountRule,
} from './symmetry';
export {
  groupOperations,
  machiningOperationsCsv,
  machiningToJson,
  type OperationGroup,
} from './report';
