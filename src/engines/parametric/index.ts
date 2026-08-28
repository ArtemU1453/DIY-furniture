/** Публичный API параметрического редактора. */
export {
  createParametricModel,
  DEFAULT_LIMITS,
  DEFAULT_SHELVES,
  DEFAULT_PARTITIONS,
  DEFAULT_DOORS,
  DEFAULT_DOOR_GAPS,
  DEFAULT_BACK,
  DEFAULT_LEGS,
  DEFAULT_PLINTH,
  DEFAULT_DRAWERS,
  ROLE_TO_PART_ROLE,
  type ParametricModel,
  type Parameter,
  type ParameterType,
  type ParameterValue,
  type PartDefinition,
  type ParametricPartRole,
  type ParametricRule,
  type PartSource,
  type CabinetConstructionType,
  type ShelfSettings,
  type ShelfDistribution,
  type FixedShelf,
  type PartitionSettings,
  type PartitionOrientation,
  type DoorSettings,
  type DoorGapSettings,
  type BackPanelSettings,
  type BackPanelType,
  type LegSettings,
  type PlinthSettings,
  type DrawerSettings,
  type DimensionLimits,
  type FurnitureKind,
} from '@/core/parametric/types';

export {
  buildDependencyGraph,
  dependents,
  type ParameterDependencyGraph,
  type DependencyNode,
} from './dependencyGraph';

export {
  resolveParameters,
  evaluateInModel,
  builtinScope,
  BUILTIN_NAMES,
  type ResolveResult,
  type ResolveIssue,
} from './resolve';

export {
  validateParametricModel,
  validateDimensions,
  validateGeometry,
  validateParameter,
  isValidDimension,
  MIN_PART_SIZE,
  type ParametricIssue,
  type ParametricValidation,
} from './validator';

export {
  buildDefinitions,
  computeGeometry,
  shelfOffsets,
  partitionPositions,
  sectionBounds,
  modelSections,
  rulesForKind,
  sideRule,
  topBottomRule,
  shelfRule,
  partitionRule,
  doorRule,
  backPanelRule,
  legRule,
  plinthRule,
  CABINET_PARAMETRIC_RULES,
  SHELVING_RULES,
  type CabinetGeometry,
} from './rules';

export {
  generateParts,
  applyOverride,
  resetOverride,
  partSource,
  partOverrides,
  hasOverride,
  type GenerateResult,
  type PartOverride,
} from './generator';

export {
  diffParametric,
  describeDiff,
  previewRegeneration,
  type ParametricDiff,
  type ParameterChange,
  type PartChange,
} from './diff';

export {
  createModule,
  duplicateModule,
  flattenModules,
  findModule,
  replaceModule,
  addChildModule,
  removeModule,
  alignItems,
  snapValue,
  cabinetSnapTargets,
  type FurnitureModule,
  type Alignment,
  type AlignItem,
  type SnapTarget,
} from './modules';

export {
  runCommand,
  setParameter,
  addShelf,
  removeShelf,
  addPartition,
  removePartition,
  addDoor,
  removeDoor,
  setMaterial,
  setConstruction,
  setShelfDistribution,
  setLegs,
  setPlinth,
  SETTABLE_FIELDS,
  type ParametricCommandType,
  type CommandResult,
} from './commands';

export {
  PARAMETRIC_TEMPLATES,
  PARAMETRIC_KEY,
  cabinetTemplate,
  shelvingTemplate,
  baseCabinetTemplate,
  findParametricTemplate,
  readParametricModel,
  hasParametricModel,
  fromCabinetParameters,
  toCabinetParameters,
  type ParametricTemplate,
} from './templates';
export {
  IDENTITY_TRANSFORM, MODULE_SCHEMA_VERSION, transformOf, isVisible, isLocked,
  type ModuleStatusKind, type ModuleRotation, type ModuleTransform,
} from './modules';
export {
  footprint, moveModule, translateModule, rotateModule, rotateBy, mirrorModule,
  mirrorPart, MIRROR_SIDE, GRID_STEPS, snapToGrid, snapToModules,
  alignModules, distributeModules, type AlignEdge,
} from './transform';
export {
  createGroup, newGroupId, groupModules, groupBounds, moveGroup, rotateGroup,
  ungroup, groupOfModule, rotateWithinGroup, type ModuleGroup,
} from './groups';
export {
  MODULE_TEMPLATES, findModuleTemplate, moduleFromTemplate, templateOfModule,
  type ModuleTemplate,
} from './moduleTemplates';
export {
  MODULE_LIBRARY_FORMAT, toLibraryEntry, fromLibraryEntry, migrateModule,
  readModule, importModuleLibrary, exportModuleLibrary, exportModule,
  type ModuleLibraryEntry, type ModuleLibraryFile, type ModuleImportResult,
} from './moduleLibrary';
export {
  linkStatus, breakLink, resetLink, moduleScope, resolveParameter,
  resolveLinkedParameters, hasParameter, commonValue, applyToAll,
  type LinkStatus, type ResolvedParameter, type ModuleParameterKey,
} from './link';
export {
  modulePartKeys, modulePartsOf, moduleOfPart, moduleSummary, moduleDocuments,
  highlightForModule, type ModuleSummary,
} from './moduleQueries';
export {
  DEPENDENT_SECTIONS, markDirty, statusOfModule, generateModule,
  invalidateModule, dirtyModules, invalidatedSections, refreshStatuses,
  type ModuleGenerationOutcome, type DependentSection,
} from './moduleStatus';
