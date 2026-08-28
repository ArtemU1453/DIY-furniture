/** Публичный API движка сцены (этап 33). */
export {
  IDENTITY_TRANSFORM, composeTransform, round01, transform,
  type FurnitureScene, type NodeEdgeBand, type NodeHardware, type NodeMachining,
  type NodeMaterial, type NodeSize, type NodeTransform, type SceneNode, type SceneNodeKind,
} from './types';

export {
  ancestors, buildFurnitureScene, descendants, nodeOfPart, nodesOfKind, sceneSignature,
  type SceneBuildOptions,
} from './build';

export {
  NEUTRAL_COLOR, grainAngle, hasTexture, materialPreview, nodeEdges, nodeMaterial,
  type MaterialPreviewItem,
} from './materials';

export {
  machiningNode, machiningShape, machiningSize, type MachiningNodeInput,
} from './machiningViz';

export {
  SUPPORTED_MODEL_FORMATS, hardwareNode, hardwareSize, isSupportedModel, modelPathOf,
  placeholderOf, type HardwareNodeInput,
} from './hardwareViz';

export {
  DEFAULT_VISIBILITY, hideOthers, isVisible, isolate, showAll, toggleHidden, visibleNodes,
  type SceneVisibility,
} from './visibility';

export {
  DEFAULT_GRID, HOME_CAMERA, SCENE_VIEWS, SCENE_VIEW_LABELS, VIEW_CUBE_FACES,
  VIEW_DIRECTIONS, VIEW_HOTKEY, cameraPosition, fitModel, homeView, sceneBounds,
  setView, snapToGrid, viewOfCubeFace,
  type CameraState, type GridSettings, type SceneBounds, type SceneView,
} from './camera';

export {
  DEFAULT_SECTION, isCut, moveSection, sectionNodes, setSectionAxis, toggleSection,
  type SectionAxis, type SectionState,
} from './section';

export {
  DEFAULT_EXPLODE, explodeOffset, explodedPosition, resetExplode, setExplodeFactor,
  toggleExplode, type ExplodeState,
} from './explode';

export {
  DEFAULT_MEASURE, addMeasurePoint, autoDimensions, clearMeasures, measureBetween,
  nodeDimensions, toggleMeasure,
  type MeasurePoint, type MeasureResult, type MeasureState, type NodeDimensions,
} from './measure';

export {
  DEFAULT_CLEARANCE, collisionSummary, sceneCollisions, type SceneCollision,
} from './collision';

export {
  DEFAULT_TREE_FILTER, filterTree, partNumbers, sceneTree,
  type SceneTreeItem, type TreeFilter,
} from './tree';

export {
  EMPTY_SELECTION, clearSelection, normalizeBox, partOfSelection, raycast, selectInBox,
  selectNode, selectionForPart, toggleNode,
  type Ray, type SceneSelection, type SelectionBox,
} from './select';

export {
  dependentNodes, diffScenes, isSceneStale, rebuildScene, updateScene,
  type SceneDiff, type SceneUpdate,
} from './update';

export {
  debugInfo, nodeBoundingBox, type BoundingBox, type CoordinateSpace, type DebugInfo,
} from './debug';

export {
  isAvailable, navigationCommands, type NavigationCommand, type NavigationTarget,
} from './navigation';

export {
  DEFAULT_SNAP, allowedScale, partBounds, planMove, planRotate, snapAxis, snapCandidates,
  type MoveRequest, type MoveResult, type RotateResult, type SnapCandidate,
  type SnapSettings, type TransformMode,
} from './transformTools';
