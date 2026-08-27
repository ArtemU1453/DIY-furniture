/** Публичный API движка фурнитуры. */
export {
  instanceId, unitsOf, instancesOfConnection, allHardwareInstances,
  instancesOfHardware, findDuplicateInstances, partsWithHardware,
} from './instances';
export {
  projectKits, findKit, kitOfHardware, expandKit, minifixKit,
  type ExpandedComponent,
} from './kits';
export {
  findHardware, hardwareStatus, missingHardwareConnections, missingHardwareIds,
  validateHardwareReferences, type HardwareIssue,
} from './status';
export {
  compatibilityRules, registerCompatibilityRule, checkConnectionCompatibility,
  validateHardwareCompatibility, thicknessRule, materialRule, cupDepthRule,
  type HardwareCompatibilityRule,
} from './compatibility';
export {
  hardwareCounts, hardwareSpecification, expandedSpecification,
  totalHardwareUnits, HARDWARE_UNIT, type HardwareSpecRow,
} from './specification';
export {
  connectionsOfHardware, partsOfHardware, operationsOfHardware,
  operationsOfConnection, documentsOfHardware, highlightForHardware,
  type HardwareHighlight,
} from './queries';
export {
  DEFAULT_HARDWARE_RULES, ruleSettings, shelfSupportCount, shelfSupportsTotal,
  backFixingCount, drawerSlideSpec, slideLengthFor, slidesTotal, SLIDE_LENGTHS,
  type HardwareRuleSettings, type DrawerSlideSpec,
} from './rules';
export {
  HARDWARE_PROFILES, profileOf, profileByKind, builtinHardwarePresets,
  planPresetApplication, presetFromProject, affectedConnections,
  type HardwareChange,
} from './presets';
export {
  importHardwareLibrary, exportHardwareLibrary, readHardware, readKit,
  HARDWARE_LIBRARY_FORMAT, HARDWARE_LIBRARY_VERSION,
  type HardwareLibraryFile, type ImportResult,
} from './io';
export { hardwareCsv, hardwareExpandedCsv } from './csv';
export type {
  Hardware, HardwareKit, HardwareComponent, HardwareInstance, HardwarePreset,
  HardwareProfile, HardwareProfileKind, HardwareStatus, HardwareCategory,
} from '@/core/model/types';
