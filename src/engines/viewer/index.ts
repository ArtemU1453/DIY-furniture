/** Публичный API движка визуализации (чистая логика 3D-редактора, без three). */
export {
  MM_TO_UNIT,
  partTransform,
  partWorldCorners,
  rotationMatrix,
  partWorldAABB,
  type PartTransform,
  type AABB,
} from './transform';
export {
  detectCollisions,
  boxesCollide,
  type CollisionPair,
} from './collision';
export { partsToStl, partsToObj } from './exporters';
export { buildModelTree, type ModelTree, type TreeGroup, type TreeNode } from './modelTree';
export {
  VIEW_PRESETS,
  VIEW_LABELS,
  VIEW_HOTKEYS,
  MATERIAL_PRESETS,
  getMaterialPreset,
  type StandardView,
  type MaterialPreset,
} from './presets';
export { overallDimensions, distance3D, type OverallDimensions } from './dimension';
export {
  validatePartChange,
  collisionWarnings,
  type ChangeIssue,
} from './constructionCheck';
