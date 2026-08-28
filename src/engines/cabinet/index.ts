/** Публичный API параметрического генератора корпусной мебели (этап 28). */
export {
  CABINET_TYPES,
  KIND_OF_CABINET_TYPE,
  DEFAULT_GROOVE_DEPTH,
  DEFAULT_GROOVE_OFFSET,
  DEFAULT_DRAWER_SIDE_THICKNESS,
  DEFAULT_DRAWER_BOTTOM_THICKNESS,
  DEFAULT_DRAWER_SIDE_CLEARANCE,
  cabinetTypeInfo,
  cabinetTypeOfKind,
  createCabinetModel,
  toCabinetModel,
  withCabinetType,
  type CabinetModel,
  type CabinetTypeInfo,
  type ResolvedBackPanel,
  type ResolvedDoors,
  type ResolvedDrawers,
  type ResolvedLegs,
  type ResolvedPlinth,
  type ResolvedShelves,
} from './model';

export {
  CABINET_DEPENDENCY_NODES,
  FIELD_TO_NODE,
  affectedByFields,
  cabinetNode,
  dependentsOf,
  directDependents,
  hasCycle,
  regenerationOrder,
  type CabinetDependencyNode,
  type CabinetNodeKind,
} from './dependencies';

export {
  MIN_SHELF_CLEARANCE,
  cabinetBounds,
  checkCabinet,
  checkDoorClearance,
  checkDrawerClearance,
  checkHardwareClearance,
  checkPartCollisions,
  checkShelfClearance,
  isPermittedOverlap,
  type CabinetCheck,
  type CabinetIssue,
  type CabinetIssueSeverity,
} from './collision';

export {
  changedFields,
  regenerateCabinet,
  type RegenerationOptions,
  type RegenerationResult,
  type RegenerationStep,
} from './regenerate';

export {
  BUILT_IN_CABINET_PRESETS,
  CABINET_PRESETS_KEY,
  CABINET_PRESET_FORMAT,
  CABINET_PRESET_VERSION,
  allCabinetPresets,
  customCabinetPresets,
  exportCabinetPresets,
  findCabinetPreset,
  importCabinetPresets,
  modelFromPreset,
  presetFromModel,
  readCabinetPreset,
  type CabinetPreset,
  type CabinetPresetFile,
  type CabinetPresetImport,
} from './presets';

export {
  CABINET_CLIPBOARD_FORMAT,
  CABINET_CLIPBOARD_VERSION,
  buildCabinet,
  cabinetModelOf,
  cabinetRemovalImpact,
  copyCabinet,
  duplicateCabinet,
  duplicateFurnitureData,
  pasteCabinet,
  previewCabinet,
  removeCabinet,
  type CabinetBuild,
  type CabinetCopy,
  type CabinetPreview,
  type CabinetRemovalImpact,
} from './operations';

export {
  bomGroupKey,
  cabinetBom,
  cabinetBomCsv,
  type CabinetBom,
  type CabinetBomRow,
} from './bom';

export {
  drawerSlots,
  doorZone,
  frontZone,
  interiorZone,
  legSpots,
  backGrooveMachining,
  drawerBottomMachining,
  drawerRule,
  LEG_SIZE,
  type DrawerSlot,
} from '@/engines/parametric/rules';
