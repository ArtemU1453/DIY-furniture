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
  allowedDepth,
  type MachiningIssue,
  type MachiningSeverity,
} from './validate';
export {
  registerMachiningRule,
  getMachiningRule,
  dowelRule,
  confirmatRule,
  type MachiningRule,
  type RuleInput,
} from './rules';
export { analyzeJoint, type JointAnalysis } from './joint';
