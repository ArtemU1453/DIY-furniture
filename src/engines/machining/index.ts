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
export {
  DEFAULT_TOOLS, toolLibrary, findTool, toolTypeFor, pickTool,
  checkTooling, checkProjectTooling, type ToolIssue,
} from './tools';
export {
  faceExtent, scopeFor, resolveValue, resolvePosition, resolvedMap,
  fromEdge, fromCenter, atPoint, fromOperation, type PositionScope,
} from './position';
export {
  operationId, applyTemplates, drillTemplate, boreTemplate, grooveTemplate,
  type TemplateContext,
} from './templates';
export {
  manualOperationId, drillOperation, boreOperation, grooveOperation,
  pocketOperation, cutoutOperation, millingOperation, contourOf, sortOperations,
} from './operations';
export {
  MACHINING_RULE_VERSION, validateProjectMachining, machiningResultFor,
  machiningResults, partStatus, regenerate, operationsOfPart, partOfOperation,
  type MachiningValidationReport, type PartMachiningStatus, type RegenerationOutcome,
} from './result';
export {
  machineExporters, registerMachineExporter, getMachineExporter, exportMachining,
  importMachining, partsWithMachining, csvExporter, jsonExporter,
  type MachineExporter, type MachiningImportResult,
} from './exporters';
export type {
  MachiningOperation, MachiningResult, MachiningType, MachiningSource,
  MachiningStatusKind, ToolItem, ToolType, PositionReference, OperationTemplate,
} from '@/core/model/types';
