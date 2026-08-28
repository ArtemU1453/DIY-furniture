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

// ── Этап 27: размещение, массивы, шаблоны, проверки, спецификация, сборка ──
export {
  PLACEMENT_PRESETS, mirrorPlacement, mirrorPlacementRule, placementScope,
  resolvePlacement, withinPart, type PlacementResult,
} from './placement';
export {
  ARRAY_PRESETS, actualSpacing, arrayCount, arrayPoints, mirrorPoints, symmetricPoints,
  type ArrayPoint,
} from './arrays';
export {
  CANONICAL_CATEGORIES, CANONICAL_OF_CATEGORY, CATEGORY_OF_CANONICAL, HARDWARE_TEMPLATES,
  customHardware, findHardwareTemplate, hardwareFromTemplateSpec,
  type CanonicalCategory, type HardwareTemplateSpec,
} from './templates';
export {
  canonicalCategory, checkHardwareOnPart, checkInstancePlacement, checkMachiningBounds,
  validateHardwareItem, validateHardwarePlacement,
  type HardwareValidationIssue, type HardwareIssueSeverity,
} from './validate';
export {
  computedUnits, connectionUnits, hardwareBom, hardwareBomCsv, hardwareBomSvg,
  isOverridden, totalHardwareQuantity, type HardwareBomRow,
} from './bom';
export {
  assemblyCenter, assemblyFrames, displayPosition, explodedTransforms, offsetForPart,
  projectExploded, type AssemblyFrame, type AssemblyMode, type ExplodeOptions,
  type ExplodedTransform,
} from './assembly';
