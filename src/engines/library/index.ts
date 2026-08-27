/** Публичный API библиотеки материалов, кромки, фурнитуры и профилей. */
export {
  MaterialService,
  EdgeMaterialService,
  HardwareService,
  ManufacturingProfileService,
  SheetFormatService,
  type ServiceResult,
} from './services';
export {
  searchMaterials,
  searchHardware,
  searchEdges,
  materialThicknesses,
  type MaterialFilters,
  type HardwareFilters,
  type EdgeFilters,
} from './search';
export {
  getRules,
  hasDeclarativeRules,
  applyRule,
  applyRules,
  isApplicable,
  validateResult,
  runForConnection,
  previewRules,
  type RuleApplyResult,
  type RulePreviewRow,
  type RuleContext,
  type ApplicabilityResult,
} from './RuleEngine';
export {
  validateCompatibility,
  checkMaterialPart,
  checkEdgePart,
  checkHardwareConnection,
  type CompatibilityIssue,
  type CompatibilityReport,
  type CompatibilitySeverity,
} from './compatibility';
export {
  linkToProject,
  linkProfile,
  diffFromLibrary,
  hasLibraryUpdates,
  buildUpdatePatches,
  projectLibrarySnapshot,
  type EntityDiff,
  type FieldDiff,
  type LibraryUpdatePatch,
  type ProjectLibrarySnapshot,
} from './snapshot';
export {
  materialUsage,
  edgeUsage,
  hardwareUsage,
  profileUsage,
  materialUsageMap,
  hardwareUsageMap,
  type UsageInfo,
} from './usage';
export {
  planMaterialReplace,
  planHardwareReplace,
  type MaterialReplacePlan,
  type HardwareReplacePlan,
} from './replace';

// Модель и хранилище библиотеки.
export {
  LIBRARY_SCHEMA_VERSION,
  MATERIAL_CATEGORIES,
  GRAIN_OPTIONS,
  GRAIN_OPTION_LABELS,
  categoryOfKind,
  kindOfCategory,
  materialCategory,
  grainOptionOf,
  grainOfOption,
  type LibraryModel,
  type LibraryEntry,
  type LibrarySection,
  type SheetFormat,
  type GrainOption,
} from '@/core/library/types';
export {
  createDefaultLibrary,
  createEmptyLibrary,
  DEFAULT_PROFILE,
  WORKSHOP_PROFILE,
  PRESET_IDS,
  PRESET_MATERIALS,
  PRESET_EDGES,
  PRESET_HARDWARE,
  PRESET_SHEET_FORMATS,
} from '@/core/library/presets';
export {
  loadLibrary,
  saveLibrary,
  resetLibrary,
  clearLibraryStorage,
} from '@/core/library/storage';
export {
  serializeLibrary,
  parseLibrary,
  mergeLibrary,
  LibraryParseError,
  type ImportResult,
  type ImportIssue,
} from '@/core/library/serialization';
export {
  migrateLibrary,
  needsMigration,
  detectVersion,
  type MigrationResult,
} from '@/core/library/migration';
