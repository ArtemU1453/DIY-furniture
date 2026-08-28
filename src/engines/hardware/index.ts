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

// ── Этап 32: каталог, параметрические виды, установленная фурнитура ─────────
export {
  HARDWARE_KINDS, HARDWARE_KIND_SPECS, KIND_CATEGORY, faceToWorld, kindOfHardware,
  kindOfItem, kindSpec, placementOf, resolveHardwareItem,
  HINGE_DEFAULTS, HANDLE_DEFAULTS, SLIDE_DEFAULTS, SHELF_PIN_DEFAULTS,
  CONFIRMAT_DEFAULTS, CONNECTOR_DEFAULTS, DOWEL_DEFAULTS, MINIFIX_DEFAULTS,
  HANDLE_POSITIONS, SLIDE_TYPES,
  distributePoints, faceSize, handleAxis, handleCenter, hingeCount, hingePositions,
  mergeParams, pinRowCount, pinRowPositions, slideMountingPoints,
  type HandlePosition, type HardwareAnchor, type HardwareKindSpec, type ParametricContext,
  type ParametricIssue, type ParametricResult, type SlideType, type TemplateOperation,
} from './parametric';

export {
  BUILTIN_CATALOG_PRESETS, HARDWARE_CATALOG_VERSION, builtinCatalog, catalogKinds,
  catalogManufacturers, createCustomEntry, duplicateEntry, favorites, filterCatalog,
  findEntry, presetEntries, removeEntry, searchCatalog, toggleFavorite, updateEntry,
  type CatalogFilter, type CustomHardwareInput, type HardwarePresetSet,
} from './catalog';

export {
  HARDWARE_CATALOG_FILE, HARDWARE_CATALOG_FORMAT, exportCatalog, importCatalog,
  mergeCatalog, migrateEntry, type CatalogImportResult, type HardwareCatalogFile,
} from './catalogIo';

export { loadCatalog, resetCatalog, saveCatalog } from './catalogStorage';

export {
  createItem, createSet, duplicateItem, findItem, hardwareOfItem, hideItem, isItemOverridden,
  itemLayout, itemsOfPart, localPosition, lockItem, mirrorItem, moveItem, nextItemId,
  nudgeItem, partOfItem, projectItems, projectSets, removalImpact, resetItem, setItems,
  setQuantity, visibleItems, worldPosition,
  type CreateItemInput, type RemovalImpact,
} from './items';

export {
  MIN_HOLE_CLEARANCE, canPlaceItem, checkItem, checkItemConflicts, validateHardwareItems,
  type HardwareItemIssue,
} from './itemValidate';

export {
  hardwareItemReport, hardwareItemReportCsv, hardwareMachiningCsv, hardwareMachiningReport,
  type HardwareMachiningRow, type HardwareReportRow,
} from './itemReport';

export {
  diagramToSvg, installationDiagram, projectDiagrams,
  type DiagramDimension, type DiagramHole, type InstallationDiagram,
} from './diagram';

export type {
  HardwareCatalog, HardwareCatalogEntry, HardwareItem, HardwareKind, HardwareSet,
} from '@/core/model/types';
