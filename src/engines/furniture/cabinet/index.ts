/** Публичный API параметрического шкафа. */
export { CabinetEngine } from './CabinetEngine';
export {
  defaultCabinetParameters,
  normalizeCabinetParameters,
  readCabinetParameters,
  toCabinetParameters,
  type CabinetParameters,
  type TopMount,
  type BottomMount,
  type BackType,
  type JointType,
  type DoorOpening,
  type ConstructionSettings,
} from './parameters';
export {
  validateCabinet,
  validateCabinetParameters,
  validateCabinetGeometry,
  type FurnitureIssue,
  type Severity,
} from './validator';
