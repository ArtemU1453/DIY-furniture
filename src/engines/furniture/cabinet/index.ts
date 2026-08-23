/** Публичный API параметрического шкафа. */
export { CabinetEngine, buildCabinet, type CabinetBuildResult } from './CabinetEngine';
export { rebuildCabinet } from './reconcile';
export {
  defaultCabinetParameters,
  normalizeCabinetParameters,
  readCabinetParameters,
  type CabinetParameters,
  type TopMount,
  type BottomMount,
  type BackType,
  type ConstructionSettings,
} from './parameters';
export {
  validateCabinet,
  validateCabinetParameters,
  validateCabinetGeometry,
  type FurnitureIssue,
  type Severity,
} from './validator';
