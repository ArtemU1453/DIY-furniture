/**
 * Центральное состояние редактора (Zustand + Immer).
 *
 * ОТВЕТСТВЕННОСТЬ: хранение состояния проекта, выбора и истории (undo/redo).
 * Store НЕ содержит бизнес-логики расчёта мебели/раскроя — это задача движков
 * (engines/*). Все мутации модели проходят через commit() и попадают в историю.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  EdgeMaterialId,
  FurnitureId,
  HardwareConnectionId,
  HardwareId,
  MachiningId,
  MaterialId,
  PartId,
} from '@/core/model/ids';
import {
  newEdgeMaterialId,
  newHardwareConnectionId,
  newHardwareId,
  newMachiningId,
  newMaterialId,
  newPartId,
} from '@/core/model/ids';
import {
  PARAMETRIC_KEY,
  applyOverride as applyPartOverride,
  describeDiff,
  diffParametric,
  findParametricTemplate,
  generateParts,
  readParametricModel,
  hasParametricModel,
  findModuleTemplate,
  moduleFromTemplate,
  mirrorPart,
  snapToGrid,
  resetOverride as resetPartOverrideFields,
  runCommand as runParametricCommandPure,
  type ParametricCommandType,
  type ParametricDiff,
  type ParametricModel,
  type PartOverride,
} from '@/engines/parametric';
import {
  buildCabinet as buildCabinetPure,
  cabinetBom,
  cabinetRemovalImpact,
  checkCabinet,
  copyCabinet as copyCabinetPure,
  createCabinetModel,
  duplicateFurnitureData,
  findCabinetPreset,
  importCabinetPresets as importCabinetPresetsPure,
  modelFromPreset,
  pasteCabinet as pasteCabinetPure,
  presetFromModel,
  previewCabinet,
  regenerateCabinet,
  removeCabinet as removeCabinetPure,
  toCabinetModel,
  CABINET_PRESETS_KEY,
  type CabinetBom,
  type CabinetCheck,
  type CabinetModel,
  type CabinetPreset,
  type CabinetPreview,
} from '@/engines/cabinet';
import type { CabinetType } from '@/core/parametric/types';
import {
  DEFAULT_GIZMO,
  DEFAULT_SNAP_3D,
  EMPTY_MEASURE,
  EMPTY_SELECTION,
  clearSelection as clearSelectionPure,
  dragDivider,
  dragDoor,
  dragDrawer,
  dragShelf,
  dragTargetOf,
  indexOfPart,
  measureClick,
  normalizeBox3,
  resetToFormula,
  resizePart,
  selectAll as selectAllPure,
  selectChildren as selectChildrenPure,
  selectInBox,
  selectParent as selectParentPure,
  selectSingle as selectSinglePure,
  toggleSelection as toggleSelectionPure,
  type DragOutcome,
  type GizmoState,
  type Guide3D,
  type MeasurePoint,
  type MeasureState,
  type SelectionLevel,
  type SelectionState as InteractionSelection,
  type SizeField,
  type SnapSettings3D,
} from '@/engines/interaction';
import { importHardwareLibrary, planPresetApplication } from '@/engines/hardware';
import {
  applyEdgeConfiguration,
  applyPresetTo,
  quickActionConfig,
  type EdgeQuickAction,
} from '@/engines/edges';
import {
  cabinetConnectionContext,
  planConnections,
  pruneDeadConnections,
  reconcileConnections,
} from '@/engines/connections';
import {
  buildUpdatePatches,
  linkProfile,
  linkToProject,
  loadLibrary,
  planHardwareReplace,
  planMaterialReplace,
  saveLibrary,
  type LibraryModel,
} from '@/engines/library';
import type {
  CuttingReport,
  CuttingSettings,
  QualityThresholds,
  EdgeMaterial,
  Furniture,
  Hardware,
  HardwareConnection,
  LockedPlacement,
  MachiningOperation,
  Material,
  Part,
  PartFace,
  MachiningOverride,
  ConnectionType,
  DocumentLayoutOverrides,
  DrawingSettings,
  Project,
  ProjectSettings,
  SheetMaterial,
  StoredRemnant,
  ManufacturingProfile,
  HardwarePreset,
  EdgeSide,
  EdgePreset,
  EdgeOverride,
  PartRole,
  RemnantStatus,
} from '@/core/model/types';
import { newSheetMaterialId, newStoredRemnantId } from '@/core/model/ids';
import { runCuttingInWorker, type CuttingHandle } from '@/workers/cuttingClient';
import type { CuttingProgress } from '@/engines/cutting';
import {
  findHardwareTemplate,
  hardwareFromTemplateSpec,
} from '@/engines/hardware';
import { createConnection, findConnectionPreset } from '@/engines/connections';
import {
  DEFAULT_EDITOR_2D,
  buildEntities,
  copyEntities,
  deleteImpact,
  markStatuses,
  preparePaste,
  prepareDuplicate,
  collectIssues,
  type Constraint2D,
  type Dimension2D,
  type EditorEntity,
  type Editor2DState,
  type Guide2D,
  type ModelChange,
  type ViewPlane,
} from '@/engines/editor2d';
import {
  applyPlans,
  applyPreset,
  canRemoveSheet,
  findPreset,
  presetFromSettings,
  refreshPlanStatuses,
  validThresholds,
} from '@/engines/cutting';
import { documentsSignature, nextDocVersion } from '@/engines/drawing';
import { runProductionCheck } from '@/engines/status';
import type { ProjectIssue } from '@/engines/status';
import {
  allOperations,
  categoryOfConnectionType,
  cutoutOperation,
  grooveOperation,
  inferJointType,
  millingOperation,
  pocketOperation,
  regenerate,
} from '@/engines/machining';
import { hardwareFromTemplate, type HardwareTemplate, catalogByCategory } from '@/core/model/hardwareCatalog';
import {
  instantiateTemplate,
  findTemplate,
  validateTemplateValues,
  defaultValues,
  loadCustomTemplates,
  addCustomTemplate,
  type TemplateValues,
  type TemplateIssue,
  type TemplateBinding,
  type FurnitureTemplate,
} from '@/engines/templates';
import type { HardwareCategory } from '@/core/model/types';
import { createAssembly, createFurniture, createPart, createProject } from '@/core/model/factory';
import {
  allParts,
  findAssemblyOfPart,
  findFurniture,
  findFurnitureOfPart,
  findPart,
  firstAssembly,
} from '@/core/model/selectors';
import {
  edgeUsageCount,
  hardwareUsageCount,
  materialUsageCount,
  validateConnection,
} from '@/core/validation/catalog';
import type { CreatePartInput } from '@/core/model/factory';
import {
  buildCabinet,
  normalizeCabinetParameters,
  readCabinetParameters,
  rebuildCabinet,
  defaultCabinetParameters,
  type CabinetParameters,
} from '@/engines/furniture/cabinet';

export interface DeleteResult {
  ok: boolean;
  message?: string;
}
export interface CreateConnectionResult {
  ok: boolean;
  id?: HardwareConnectionId;
  message?: string;
}

const HISTORY_LIMIT = 100;

/** Инструмент интерактивного редактора (§126/§130). */
export type InteractionTool =
  | 'select' | 'move' | 'rotate' | 'resize' | 'dimension' | 'guide' | 'measure';

/**
 * Состояние интерактивного редактирования (§1/§96).
 *
 * Живёт в интерфейсе, а не в проекте: выделение, инструмент, привязки и
 * направляющие не являются производственными данными. 2D и 3D читают ОДНО это
 * состояние, поэтому показывают одно и то же выделение.
 */
export interface InteractionUiState {
  selection: InteractionSelection;
  tool: InteractionTool;
  gizmo: GizmoState;
  snap: SnapSettings3D;
  guides: Guide3D[];
  measure: MeasureState;
  /** Показывать ограничения (§110). */
  showConstraints: boolean;
  /** Положение курсора в мире, мм (§131). */
  cursor: { x: number; y: number; z: number } | null;
  /** Открытая транзакция перетаскивания (§121/§122). */
  transaction: { id: string; kind: string; label: string; steps: number } | null;
}

/** Ввод мастера создания шкафа (§90–§92). */
export interface CreateCabinetInput {
  type?: CabinetType;
  presetId?: string;
  name?: string;
  width?: number;
  height?: number;
  depth?: number;
  thickness?: number;
  materialId?: MaterialId | null;
  construction?: ParametricModel['construction'];
}

/**
 * Модель шкафа по вводу мастера (§91/§92). Пресет даёт стартовые значения,
 * явно указанные габариты и материал их перекрывают, а материал корпуса
 * подставляет свою толщину — как и в остальном редакторе.
 */
function cabinetModelFromInput(project: Project, input: CreateCabinetInput): CabinetModel | null {
  const preset = input.presetId ? findCabinetPreset(project, input.presetId) : undefined;
  if (input.presetId && !preset) return null;

  const base = preset
    ? modelFromPreset(preset)
    : createCabinetModel(input.type ?? 'CABINET');

  const material = input.materialId !== undefined
    ? project.materials.find((m) => String(m.id) === String(input.materialId))
    : (project.materials.find((m) => m.kind === 'ldsp') ?? project.materials[0]);

  return toCabinetModel({
    ...base,
    ...(input.type ? { cabinetType: input.type } : {}),
    ...(input.width != null ? { width: input.width } : {}),
    ...(input.height != null ? { height: input.height } : {}),
    ...(input.depth != null ? { depth: input.depth } : {}),
    ...(input.construction ? { construction: input.construction } : {}),
    materialId: material?.id ?? base.materialId,
    thickness: input.thickness ?? material?.thickness ?? base.thickness,
  });
}

/** Итог применения параметрической модели (§37/§67/§69). */
export interface ParametricApplyResult {
  ok: boolean;
  /** Что изменилось — для истории и предупреждений. */
  diff?: ParametricDiff;
  added: number;
  removed: number;
  changed: number;
  errors: string[];
  description: string;
}

// ── Оформление документов ────────────────────────────────────────────────────
// Настройки чертежа — это ОФОРМЛЕНИЕ, а не производственная модель: они не
// входят в documentsSignature, поэтому правка оформления никогда не делает
// документацию OUTDATED (§37). На перерисовку влияет layoutVersion — она
// входит в ключ кэша документов (§55).

function emptyLayout(): DocumentLayoutOverrides {
  return { moved: {}, locked: {}, hiddenViews: {}, notes: {} };
}

/** Гарантировать наличие блока настроек чертежа в проекте. */
function ensureDrawingSettings(p: Project): DrawingSettings {
  if (!p.documents.settings) {
    p.documents.settings = { scaleOverrides: {}, hidden: {} };
  }
  return p.documents.settings;
}

/** Гарантировать наличие блока ручного оформления. */
function ensureLayout(p: Project): DocumentLayoutOverrides {
  const s = ensureDrawingSettings(p);
  if (!s.layout) s.layout = emptyLayout();
  return s.layout;
}

/** Увеличить версию оформления — инвалидирует кэш документов, но не модель. */
function bumpLayoutVersion(p: Project): void {
  const s = ensureDrawingSettings(p);
  s.layoutVersion = (s.layoutVersion ?? 0) + 1;
}

/** Максимальный номер детали (Pxxx) в проекте — для назначения новых номеров. */
function allPartNumbers(project: Project): number {
  let max = 0;
  for (const f of project.furnitures) {
    for (const a of f.assemblies) {
      for (const p of a.parts) {
        const n = Number(String(p.metadata?.number ?? '').replace(/^P/, ''));
        if (Number.isFinite(n)) max = Math.max(max, n);
      }
    }
  }
  return max;
}

export type DisplayMode = 'solid' | 'wireframe' | 'edges' | 'transparent';

/** UI-состояние 3D-редактора. Не сохраняется в производственную модель. */
export type ViewerTool = 'select' | 'move';

/** Режим показа присадки в 3D (§38). */
export type MachiningMode = 'off' | 'all' | 'selected';

export interface ViewerUiState {
  tool: ViewerTool;
  machiningMode: MachiningMode;
  displayMode: DisplayMode;
  showGrid: boolean;
  showAxes: boolean;
  showDimensions: boolean;
  showHardware: boolean;
  showMachining: boolean;
  isolatedPartId: PartId | null;
  snap: number; // мм
}

export const DEFAULT_VIEWER: ViewerUiState = {
  tool: 'select',
  machiningMode: 'off',
  displayMode: 'solid',
  showGrid: true,
  showAxes: false,
  showDimensions: false,
  showHardware: true,
  showMachining: false,
  isolatedPartId: null,
  snap: 10,
};

export interface EditorState {
  project: Project;
  selectedPartId: PartId | null;
  activeFurnitureId: FurnitureId | null;
  selectedConnectionId: HardwareConnectionId | null;
  selectedOperationId: MachiningId | null;
  selectedCuttingPieceId: string | null;
  cuttingRunning: boolean;
  cuttingProgress: CuttingProgress | null;
  cuttingError: string | null;
  saveState: 'saved' | 'unsaved' | 'saving';
  focusNonce: number;
  past: Project[];
  future: Project[];

  // ── Состояние 3D-редактора (только интерфейс, не производственные данные) ──
  viewer: ViewerUiState;

  /**
   * Состояние 2D-редактора (§2). ТОЛЬКО интерфейс: инструмент, камера, сетка,
   * привязки, направляющие, замеры, ограничения, выделение. Производственных
   * данных здесь нет и в экспорт проекта оно не попадает (§131).
   */
  editor2d: Editor2DState;
  /** Ограничения конструкции (§58) — вспомогательные, как направляющие. */
  constraints: Constraint2D[];
  /** Внутренний буфер обмена редактора (§80). */
  clipboard: ReturnType<typeof copyEntities> | null;
  /**
   * Режим просмотра сборки (§146–§148). Это состояние ИНТЕРФЕЙСА: разнос
   * считается на лету и на конструкцию не влияет.
   */
  assembly: { mode: 'ASSEMBLY' | 'EXPLODED'; factor: number };

  // ── Проект ────────────────────────────────────────────────────────────────
  newProject: (name?: string) => void;
  /** Загрузить готовый проект (из хранилища/импорта). Сбрасывает историю. */
  loadProject: (project: Project) => void;
  setProjectName: (name: string) => void;
  updateSettings: (patch: Partial<ProjectSettings>) => void;

  /** Буфер копирования шкафа (§96): живёт в сессии, а не в проекте. */
  cabinetClipboard: string | null;

  // ── Интерактивное редактирование (этап 29) ────────────────────────────────
  /** Состояние интерактивного редактора: общее для 2D и 3D (§96). */
  interaction: InteractionUiState;

  // ── Изделия ────────────────────────────────────────────────────────────────
  addFurniture: (name?: string) => void;
  removeFurniture: (id: Furniture['id']) => void;
  setActiveFurniture: (id: FurnitureId | null) => void;

  // ── Параметрический шкаф ────────────────────────────────────────────────────
  createCabinet: (name?: string) => FurnitureId;
  updateCabinetParams: (id: FurnitureId, patch: Partial<CabinetParameters>) => void;

  // ── Параметрический редактор (этап 18) ──────────────────────────────────────
  /** Прочитать параметрическую модель изделия (или вывести из старых параметров). */
  getParametricModel: (id: FurnitureId) => ParametricModel | null;
  /** Записать модель и пересобрать детали. Возвращает отчёт генератора. */
  applyParametricModel: (id: FurnitureId, model: ParametricModel) => ParametricApplyResult;
  /** Выполнить команду параметрического редактора (§51). */
  runParametricCommand: (
    id: FurnitureId,
    type: ParametricCommandType,
    payload?: Record<string, unknown>,
  ) => ParametricApplyResult;
  /** Создать изделие из параметрического шаблона (§58–§60). */
  createParametricFurniture: (templateId: string, name?: string) => FurnitureId | null;

  // ── Генератор корпусной мебели (этап 28) ──────────────────────────────────
  /** Модель шкафа со всеми заполненными блоками (§1). */
  getCabinetModel: (id: FurnitureId) => CabinetModel | null;
  /** Создать шкаф: тип, габариты, материал, пресет (§90–§94). */
  createParametricCabinet: (input: CreateCabinetInput) => FurnitureId | null;
  /** Сводка будущего шкафа до его создания (§93). */
  previewParametricCabinet: (input: CreateCabinetInput) => CabinetPreview | null;
  /** Изменить несколько параметров одной транзакцией undo (§117). */
  applyCabinetPatch: (
    id: FurnitureId,
    patch: Partial<ParametricModel>,
    description?: string,
  ) => ParametricApplyResult;
  /** Проверка конструкции: пересечения и зазоры (§79–§85). */
  checkCabinetConstruction: (id: FurnitureId) => CabinetCheck | null;
  /** Ведомость деталей и фурнитуры (§108–§114). */
  getCabinetBom: (id?: FurnitureId) => CabinetBom;
  /** Распределить полки равномерно (§18/§21). */
  distributeShelvesEqually: (id: FurnitureId) => ParametricApplyResult;
  /** Задать положение одной полки вручную (§19/§20). */
  setShelfPosition: (id: FurnitureId, index: number, offset: number) => ParametricApplyResult;
  /** Вернуть полку под автоматический расчёт (§21). */
  resetShelfPosition: (id: FurnitureId, index: number) => ParametricApplyResult;
  /** Скопировать шкаф в буфер (§96). */
  copyCabinetToClipboard: (id: FurnitureId) => string | null;
  /** Вставить шкаф из буфера (§96). */
  pasteCabinetFromClipboard: (json?: string, name?: string) => FurnitureId | null;
  /** Удалить шкаф вместе с зависимостями (§97). */
  deleteCabinet: (id: FurnitureId) => boolean;
  /** Сохранить текущую модель как пресет (§87/§88). */
  saveCabinetPreset: (id: FurnitureId, name: string) => CabinetPreset | null;
  /** Удалить пользовательский пресет. */
  removeCabinetPreset: (presetId: string) => boolean;
  /** Импортировать пресеты из JSON (§89). */
  importCabinetPresetsFile: (json: string) => { ok: boolean; added: number; errors: string[] };

  // ── Интерактивное редактирование (этап 29) ────────────────────────────────
  /** Активный инструмент (§126/§130). */
  setInteractionTool: (tool: InteractionTool) => void;
  /** Выбор объекта; additive — Ctrl/Cmd + click (§2/§3). */
  selectEntity: (id: string | null, options?: { additive?: boolean }) => void;
  /** Предварительная подсветка под курсором (§11). */
  hoverEntity: (id: string | null) => void;
  /** Ctrl/Cmd + A (§5). */
  selectAllEntities: () => void;
  /** Esc (§6). */
  clearInteractionSelection: () => void;
  /** Select Parent / Select Children (§8/§9). */
  selectParentEntity: () => void;
  selectChildrenEntities: () => void;
  /** Уровень выбора: деталь, модуль или изделие (§7). */
  setSelectionLevel: (level: SelectionLevel) => void;
  /** Выделение объёмной рамкой (§4). */
  boxSelectEntities: (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    crossing?: boolean,
  ) => string[];
  /** Настройки гизмо и привязок (§12–§18, §111–§118). */
  setGizmoState: (patch: Partial<GizmoState>) => void;
  setSnapSettings: (patch: Partial<SnapSettings3D>) => void;
  /** Направляющие (§58–§64). */
  addInteractionGuide: (axis: Guide3D['axis'], position: number, label?: string) => string;
  moveInteractionGuide: (id: string, position: number) => void;
  removeInteractionGuide: (id: string) => void;
  clearInteractionGuides: () => void;
  /** Положение курсора для статус-бара (§131). */
  setInteractionCursor: (point: { x: number; y: number; z: number } | null) => void;
  /** Перетаскивание конструктивного элемента (§25–§32). */
  dragConstructivePart: (partId: PartId, value: number) => DragOutcome;
  /** Ручное изменение размера детали с Override (§19–§23). */
  resizeSelectedPart: (partId: PartId, field: SizeField, value: number) => { ok: boolean; message?: string };
  /** Вернуть расчётное значение (§24). */
  resetPartFormula: (partId: PartId, fields?: SizeField[]) => void;
  /** Блокировка положения и размера (§81/§82). */
  setPartLock: (partId: PartId, patch: { position?: boolean; size?: boolean }) => void;
  /** Инструмент измерения (§54–§57). */
  setMeasureActive: (active: boolean) => void;
  measureAt: (point: MeasurePoint) => MeasureState;
  /** Показ ограничений (§110). */
  toggleConstraintsVisible: () => void;
  /** Транзакция перетаскивания: одна запись в истории (§121/§122). */
  beginInteractionTransaction: (kind: string, label: string) => void;
  endInteractionTransaction: () => void;
  cancelInteractionTransaction: () => void;

  // ── Модули (этап 24) ──────────────────────────────────────────────────────
  /** Создать модуль из шаблона (§109). */
  createModuleFromTemplate: (templateId: string, name?: string) => FurnitureId | null;
  /** Дублировать изделие целиком с новыми идентификаторами (§81/§82). */
  duplicateFurniture: (id: FurnitureId, name?: string) => FurnitureId | null;
  /** Зеркально отразить изделие: кромка и присадка переезжают (§83/§84). */
  mirrorFurniture: (id: FurnitureId) => boolean;
  /** Повернуть изделие в сцене, не меняя размеров деталей (§85/§86). */
  rotateFurniture: (id: FurnitureId, rotation: 0 | 90 | 180 | 270) => boolean;
  /** Переместить изделие с необязательной привязкой к сетке (§87–§90). */
  moveFurniture: (id: FurnitureId, position: { x?: number; y?: number; z?: number }, gridStep?: number) => boolean;
  /** Показать/скрыть изделие (§96). */
  setFurnitureVisible: (id: FurnitureId, visible: boolean) => void;
  /** Заблокировать изделие от случайного перемещения (§97/§98). */
  setFurnitureLocked: (id: FurnitureId, locked: boolean) => void;
  /** Изменить общий параметр у нескольких изделий (§118/§119). */
  applyToModules: (ids: FurnitureId[], key: 'width' | 'height' | 'depth' | 'thickness', value: number) => { applied: number; skipped: number };
  /** Ручная правка параметрической детали (§43). */
  setPartOverride: (partId: PartId, patch: PartOverride) => void;
  /** «Вернуть расчётное значение» (§44). */
  resetPartOverride: (partId: PartId, fields?: Array<keyof PartOverride>) => void;

  // ── Соединения (этап 19) ────────────────────────────────────────────────────
  /** Пересобрать соединения изделия по правилам (§27/§47). */
  regenerateConnections: (id: FurnitureId) => {
    ok: boolean; added: number; removed: number; manual: number; orphaned: number;
  };
  /** Убрать соединения, потерявшие деталь (§49). */
  pruneConnections: () => number;

  // ── Типовые конструкции (шаблоны) ──────────────────────────────────────────
  createFromTemplate: (templateId: string, values?: TemplateValues, name?: string) => { ok: boolean; id?: FurnitureId; errors?: TemplateIssue[] };
  updateTemplateValues: (id: FurnitureId, values: TemplateValues) => void;
  detachTemplate: (id: FurnitureId) => void;
  saveFurnitureAsTemplate: (id: FurnitureId, name: string) => FurnitureTemplate | null;

  // ── Детали ────────────────────────────────────────────────────────────────
  addPart: (input?: CreatePartInput) => PartId;
  addElement: (kind: 'panel' | 'shelf' | 'divider' | 'facade' | 'back') => PartId;
  removePart: (id: PartId) => void;
  updatePart: (id: PartId, patch: Partial<Part>) => void;

  // ── Кромка (этап 21) ──────────────────────────────────────────────────────
  /** Назначить кромку одной стороны детали вручную (§11). */
  setPartEdge: (id: PartId, side: EdgeSide, materialId: EdgeMaterialId | null) => void;
  /** Быстрое действие: все / длинные / короткие стороны, снять кромку (§15). */
  applyEdgeQuickAction: (ids: PartId[], action: EdgeQuickAction, materialId: EdgeMaterialId | null) => number;
  /** Применить пресет к ЯВНО выбранным деталям (§53/§55). */
  applyEdgePreset: (ids: PartId[], preset: EdgePreset) => number;
  /** Применить пресет ко всем деталям роли (§54). */
  applyEdgePresetToRole: (role: PartRole, preset: EdgePreset) => number;
  /** Ручная правка параметров одной кромки (§45). */
  setEdgeOverride: (id: PartId, side: EdgeSide, override: EdgeOverride | null) => void;
  /** Вернуть расчётные значения кромки стороны (§46). */
  resetEdgeOverride: (id: PartId, side: EdgeSide) => void;
  duplicatePart: (id: PartId) => PartId | null;
  setPartFlag: (id: PartId, patch: { hidden?: boolean; locked?: boolean }) => void;
  renameFurniture: (id: FurnitureId, name: string) => void;

  // ── 3D-редактор (UI) ────────────────────────────────────────────────────────
  setViewer: (patch: Partial<ViewerUiState>) => void;
  showAllParts: () => void;
  isolatePart: (id: PartId | null) => void;

  // ── Сохранение / фокус ──────────────────────────────────────────────────────
  setSaveState: (state: 'saved' | 'unsaved' | 'saving') => void;
  requestFocus: () => void;

  // ── Документы ────────────────────────────────────────────────────────────────
  markDocumentsGenerated: () => void;
  /** Сформировать документы: сначала ProductionCheck; при ERROR не генерирует. */
  generateDocuments: () => { ok: boolean; errors: ProjectIssue[] };
  setDocumentScale: (docKey: string, scale: number | 'AUTO') => void;
  toggleDrawingLayer: (layer: string) => void;
  /** Формат листа документа: A4 / A3 / A2 (§8). */
  setDocumentFormat: (docKey: string, format: 'A4' | 'A3' | 'A2') => void;
  /** Выбранные виды изделия для общего вида (§9). */
  setDocumentViews: (views: string[]) => void;
  /** Фильтр деталей в деталировке (§65). */
  setDocumentPartFilter: (filter: string) => void;
  /** Переместить элемент оформления — размер, текст (§37). */
  moveDocumentElement: (elementId: string, dx: number, dy: number) => void;
  /** Зафиксировать/освободить автоматически созданный элемент (§38). */
  lockDocumentElement: (elementId: string, locked: boolean) => void;
  /** Скрыть/показать вид на чертеже (§37). */
  toggleDocumentView: (viewId: string) => void;
  /** Добавить примечание на документ (§36). */
  addDocumentNote: (docKey: string, note: { x: number; y: number; text: string }) => string;
  /** Удалить примечание. */
  removeDocumentNote: (docKey: string, noteId: string) => void;
  /** «Сбросить оформление» — вернуть автоматический layout (§39). */
  resetDocumentLayout: (docKey?: string) => void;

  // ── Материалы ───────────────────────────────────────────────────────────────
  addMaterial: (material: Material) => void;
  updateMaterial: (id: MaterialId, patch: Partial<Material>) => void;
  removeMaterial: (id: MaterialId) => DeleteResult;

  // ── Кромка ──────────────────────────────────────────────────────────────────
  addEdge: (edge: EdgeMaterial) => void;
  updateEdge: (id: EdgeMaterialId, patch: Partial<EdgeMaterial>) => void;
  removeEdge: (id: EdgeMaterialId) => DeleteResult;
  /** Правка производственного профиля (пропил, припуски, округление). */
  updateManufacturingProfile: (patch: Partial<ManufacturingProfile>) => void;

  // ── Фурнитура ─────────────────────────────────────────────────────────────
  addHardware: (hardware: Hardware) => void;
  updateHardware: (id: HardwareId, patch: Partial<Hardware>) => void;
  removeHardware: (id: HardwareId) => DeleteResult;

  // ── Соединения фурнитуры ────────────────────────────────────────────────────
  addConnection: (input: {
    hardwareId: HardwareId;
    partAId: PartId;
    partBId: PartId;
    quantity?: number;
    parameters?: HardwareConnection['parameters'];
  }) => CreateConnectionResult;
  updateConnection: (id: HardwareConnectionId, patch: Partial<HardwareConnection>) => void;
  duplicateConnection: (id: HardwareConnectionId) => HardwareConnectionId | null;
  removeConnection: (id: HardwareConnectionId) => void;
  selectConnection: (id: HardwareConnectionId | null) => void;
  addHardwareFromTemplate: (template: HardwareTemplate) => HardwareId;

  // ── Библиотека (глобальная, localStorage) ───────────────────────────────────
  /** Текущее состояние глобальной библиотеки. */
  library: LibraryModel;
  /** Перечитать библиотеку из локального хранилища. */
  reloadLibrary: () => void;
  /** Записать библиотеку целиком (после операции сервиса) и сохранить локально. */
  setLibrary: (library: LibraryModel) => void;
  /** Добавить материал из библиотеки в проект (копия + ссылка, §60). */
  addMaterialFromLibrary: (libraryId: string) => MaterialId | null;
  /** Добавить кромку из библиотеки в проект. */
  addEdgeFromLibrary: (libraryId: string) => EdgeMaterialId | null;
  /** Добавить фурнитуру из библиотеки в проект. */
  addHardwareFromLibrary: (libraryId: string) => HardwareId | null;
  /** Назначить проекту производственный профиль из библиотеки. */
  applyProfileFromLibrary: (libraryId: string) => boolean;
  /** Обновить данные проекта из библиотеки (§62). */
  updateFromLibrary: (projectIds?: string[]) => number;
  /** Массовая замена материала в проекте (§47). */
  replaceMaterial: (fromId: string, toId: string, partIds?: string[]) => number;
  /** Массовая замена фурнитуры в проекте (§48). */
  replaceHardware: (fromId: string, toId: string, connectionIds?: string[]) => number;

  // ── Присадка (ручные операции) ──────────────────────────────────────────────
  addManualOperation: (input: {
    partId: PartId;
    face: PartFace;
    x: number;
    y: number;
    diameter: number;
    depth: number;
    through?: boolean;
  }) => MachiningId;
  removeOperation: (id: MachiningId) => void;
  /** Изменить ручную операцию (§33). */
  updateManualOperation: (id: MachiningId, patch: Partial<MachiningOperation>) => boolean;
  /** Добавить паз / карман / вырез / фрезеровку (§26–§29). */
  addShapeOperation: (input: {
    partId: PartId;
    face: PartFace;
    kind: 'groove' | 'pocket' | 'cutout' | 'mill';
    x: number;
    y: number;
    width?: number;
    height?: number;
    length?: number;
    depth?: number;
    diameter?: number;
  }) => MachiningId | null;
  /** Пересчитать присадку (§78). Прежний набор сохраняется при ошибке (§80). */
  regenerateMachining: () => { ok: boolean; operations: number; errors: string[]; warnings: string[] };
  /** Ручная правка автоматической операции (MANUAL OVERRIDE, §41/§42). */
  setOperationOverride: (id: MachiningId, patch: MachiningOverride) => void;
  /** «Сбросить правило» — удалить ручную правку, операция снова из правила (§43). */
  resetOperationToRule: (id: MachiningId) => void;
  /** Сменить способ соединения (CONFIRMAT/DOWEL/…) — подбирает крепёж (§65/§66). */
  /** Ручная правка количества крепежа в узле (§134/§135). */
  setConnectionQuantityOverride: (id: HardwareConnectionId, quantity: number | null) => void;
  /** Создать узел по пресету или вручную (§125/§126). */
  createConnectionFrom: (input: {
    partAId: PartId; partBId: PartId; presetId?: string;
    type?: ConnectionType; hardwareId?: HardwareId; quantity?: number;
  }) => { ok: boolean; id?: HardwareConnectionId; error?: string; warnings: string[] };
  /** Создать позицию каталога из шаблона (§105). */
  createHardwareFromTemplate: (templateId: string, name?: string) => HardwareId | null;
  /** Отправить позицию в архив или вернуть (§153–§155). */
  setHardwareArchived: (id: HardwareId, archived: boolean) => void;
  /** Дублировать позицию каталога с новым id (§152). */
  duplicateHardware: (id: HardwareId) => HardwareId | null;
  /** Добавить единицу фурнитуры без соединения (§132). */
  addManualHardwareInstance: (input: {
    hardwareId: HardwareId; partId: PartId; quantity?: number;
  }) => string | null;
  removeManualHardwareInstance: (id: string) => void;
  /** Режим 3D: собранное изделие или разнесённый вид (§146–§148). */
  setAssemblyMode: (mode: 'ASSEMBLY' | 'EXPLODED', factor?: number) => void;
  setConnectionType: (id: HardwareConnectionId, type: ConnectionType) => void;

  // ── Фурнитура (этап 22) ───────────────────────────────────────────────────
  /** Заменить фурнитуру соединения вручную (§57/§62). */
  setConnectionHardware: (id: HardwareConnectionId, hardwareId: HardwareId) => void;
  /** Вернуть расчётную фурнитуру узла (§63). */
  resetConnectionHardware: (id: HardwareConnectionId) => boolean;
  /** Применить пресет фурнитуры к выбранным деталям либо ко всему проекту (§65/§66). */
  applyHardwarePreset: (preset: HardwarePreset, partIds?: PartId[]) => number;
  /** Перевести позицию в архив вместо удаления (§12/§13). */
  archiveHardware: (id: HardwareId, archived: boolean) => void;
  /** Назначить замену вместо отсутствующей позиции (§80). */
  replaceMissingHardware: (missingId: string, hardwareId: HardwareId) => number;
  /** Импорт библиотеки фурнитуры из JSON (§74). */
  importHardwareLibraryJson: (json: string) => { ok: boolean; added: number; skipped: number; error?: string };
  selectOperation: (id: MachiningId | null) => void;

  // ── Раскрой ──────────────────────────────────────────────────────────────
  updateCuttingSettings: (patch: Partial<CuttingSettings>) => void;
  recalculateCutting: () => Promise<void>;
  cancelCutting: () => void;
  setLockedPlacement: (placement: LockedPlacement) => void;
  /** Применить готовый результат раскроя (напр. выбранный в сравнении алгоритмов). */
  applyCuttingReport: (report: CuttingReport, algorithmId?: string) => void;
  clearLockedPlacements: () => void;
  toggleLockedPlacement: (placement: LockedPlacement) => void;
  rotatePlacement: (placement: LockedPlacement) => void;
  selectCuttingPiece: (pieceId: string | null) => void;
  /** Зафиксировать/освободить карту раскроя материала (§90/§92). */
  setPlanLocked: (materialId: MaterialId, locked: boolean) => void;
  /** Снять фиксацию со всех карт (§92). */
  unlockAllPlans: () => void;
  /** Применить пресет раскроя (§82). */
  applyCuttingPreset: (presetId: string) => boolean;
  /** Сохранить текущие настройки как пользовательский пресет (§84). */
  saveCuttingPreset: (name: string) => string;
  removeCuttingPreset: (presetId: string) => void;
  /** Задать пороги классификации качества (§133). */
  setQualityThresholds: (thresholds: QualityThresholds) => boolean;
  // Библиотека листов.
  addSheetMaterial: (sheet: Omit<SheetMaterial, 'id'>) => string;
  updateSheetMaterial: (id: string, patch: Partial<SheetMaterial>) => void;
  /** Удалить формат листа. Отказ, если он используется активной картой (§79). */
  removeSheetMaterial: (id: string) => { ok: boolean; reason?: string };
  /** Отправить формат в архив или вернуть из архива (§80). */
  setSheetArchived: (id: string, archived: boolean) => void;
  // Библиотека остатков.
  saveRemnant: (remnant: Omit<StoredRemnant, 'id' | 'createdAt'>) => string;
  saveUsableRemnantsFromResult: () => number;
  removeRemnant: (id: string) => void;
  /** Сменить состояние остатка (§91/§92): AVAILABLE / RESERVED / USED / ARCHIVED. */
  setRemnantStatus: (id: string, status: RemnantStatus) => void;
  clearRemnants: () => void;

  // ── 2D-редактор ───────────────────────────────────────────────────────────
  /** Правка состояния интерфейса редактора. В историю НЕ попадает (§2/§121). */
  setEditor2D: (patch: Partial<Editor2DState>) => void;
  /** Сменить технический вид (§92–§97). */
  setEditorPlane: (plane: ViewPlane) => void;
  /** Заменить выделение (§17). */
  setEditorSelection: (ids: string[]) => void;
  /** Добавить/убрать объект из выделения (§18). */
  toggleEditorSelection: (id: string) => void;
  /**
   * Применить изменения модели одной транзакцией (§122–§124): перетаскивание,
   * изменение размера и групповая правка дают ОДНУ запись в истории.
   */
  applyEditorChanges: (changes: ModelChange[]) => { applied: number; skipped: number };
  /** Скрыть/показать объект на холсте (§86). */
  setEditorHidden: (id: string, hidden: boolean) => void;
  /** Заблокировать/разблокировать объект (§85). */
  setEditorLocked: (id: string, locked: boolean) => void;
  /** Показать всё (§87). */
  editorShowAll: () => void;
  /** Изолировать выбранное (§88). */
  editorIsolate: (ids: string[]) => void;
  /** Направляющие (§49–§52). */
  setEditorGuides: (guides: Guide2D[]) => void;
  /** Замеры (§53–§55). */
  setEditorDimensions: (dimensions: Dimension2D[]) => void;
  /** Ограничения (§58–§64). */
  setConstraints: (constraints: Constraint2D[]) => void;
  /** Скопировать выбранное во внутренний буфер (§79/§80). */
  editorCopy: (ids: string[]) => number;
  /** Вставить из буфера (§79/§81). */
  editorPaste: () => string[];
  /** Дублировать выбранное (§78). */
  editorDuplicate: (ids: string[]) => string[];
  /** Удалить выбранное (§82/§83). */
  editorDelete: (ids: string[]) => { removed: number; warnings: string[] };
  /** Сущности холста для текущего вида (со статусами проверок). */
  editorEntities: () => EditorEntity[];

  // ── Выбор ────────────────────────────────────────────────────────────────
  selectPart: (id: PartId | null) => void;

  // ── История ────────────────────────────────────────────────────────────────
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useEditorStore = create<EditorState>()(
  immer((set, get) => {
    // Хэндл текущего расчёта раскроя (вне состояния — для отмены).
    let cuttingHandle: CuttingHandle | null = null;

    /* Снимок проекта на начало перетаскивания (§121). Держится вне состояния:
     * это служебное значение операции, а не данные редактора. */
    let transactionOrigin: Project | null = null;

    /** Изделие, которому принадлежит деталь. */
    const furnitureOfPartId = (project: Project, partId: string): string | null => {
      for (const furniture of project.furnitures) {
        for (const assembly of furniture.assemblies) {
          if (assembly.parts.some((p) => String(p.id) === partId)) return String(furniture.id);
        }
      }
      return null;
    };

    /**
     * Применить изменение модели с записью в историю.
     *
     * Пока открыта транзакция (§121/§122 этапа 29), промежуточные изменения
     * историю НЕ растят: перетаскивание порождает десятки шагов, а в undo
     * должно попасть одно состояние — то, что было до начала операции. Его
     * записывает endInteractionTransaction.
     */
    const commit = (recipe: (project: Project) => void) => {
      const prev = get().project; // финализированный неизменяемый снимок
      set((state) => {
        if (transactionOrigin === null) {
          state.past.push(prev);
          if (state.past.length > HISTORY_LIMIT) state.past.shift();
          state.future = [];
        } else if (state.interaction.transaction) {
          state.interaction.transaction.steps += 1;
        }
        recipe(state.project);
        state.project.updatedAt = new Date().toISOString();
        state.saveState = 'unsaved';
      });
    };

    /**
     * Пересобрать все шкафы, использующие материал как корпусной, синхронизируя
     * их толщину с толщиной материала (мутирует переданный черновик проекта).
     */
    const syncCabinetsToMaterial = (project: Project, materialId: MaterialId) => {
      for (const f of project.furnitures) {
        if (f.type !== 'cabinet') continue;
        const params = readCabinetParameters(f.params);
        if (params.material !== materialId) continue;
        const material = project.materials.find((m) => m.id === materialId);
        if (!material) continue;
        const next = normalizeCabinetParameters({ thickness: material.thickness }, params);
        const assembly = f.assemblies[0];
        const built = rebuildCabinet(assembly ? assembly.parts : [], next);
        if (assembly) assembly.parts = built.parts;
        f.sections = built.sections;
        f.params = next as unknown as Record<string, unknown>;
      }
    };

    return {
      project: createProject(),
      selectedPartId: null,
      activeFurnitureId: null,
      selectedConnectionId: null,
      cabinetClipboard: null,
      interaction: {
        selection: { ...EMPTY_SELECTION },
        tool: 'select',
        gizmo: { ...DEFAULT_GIZMO },
        snap: { ...DEFAULT_SNAP_3D },
        guides: [],
        measure: { ...EMPTY_MEASURE },
        showConstraints: false,
        cursor: null,
        transaction: null,
      },
      selectedOperationId: null,
      selectedCuttingPieceId: null,
      cuttingRunning: false,
      cuttingProgress: null,
      cuttingError: null,
      saveState: 'saved',
      focusNonce: 0,
      past: [],
      future: [],
      viewer: { ...DEFAULT_VIEWER },
      editor2d: {
        ...DEFAULT_EDITOR_2D,
        snap: { ...DEFAULT_EDITOR_2D.snap },
        filter: { ...DEFAULT_EDITOR_2D.filter },
        guides: [],
        dimensions: [],
        selection: [],
        isolated: [],
        hidden: [],
        locked: [],
      },
      constraints: [],
      clipboard: null,
      assembly: { mode: 'ASSEMBLY', factor: 1 },

      setViewer: (patch) => set((s) => void Object.assign(s.viewer, patch)),

      // ── 2D-редактор ─────────────────────────────────────────────────────
      /* Всё, что ниже до applyEditorChanges, меняет ТОЛЬКО интерфейс, поэтому
       * идёт через set, а не commit: положение камеры и выделение не должны
       * попадать в Undo/Redo и в файл проекта (§2/§121/§131). */
      setEditor2D: (patch) => set((s) => void Object.assign(s.editor2d, patch)),

      setEditorPlane: (plane) =>
        set((s) => {
          s.editor2d.plane = plane;
          // Выделение переживает смену вида: это те же объекты модели (§96).
          s.editor2d.pending = null;
        }),

      setEditorSelection: (ids) => set((s) => void (s.editor2d.selection = [...ids])),

      toggleEditorSelection: (id) =>
        set((s) => {
          const list = s.editor2d.selection;
          const i = list.indexOf(id);
          if (i >= 0) list.splice(i, 1);
          else list.push(id);
        }),

      /**
       * Единственная точка записи изменений холста в ProjectModel (§3).
       * Все изменения набора применяются ОДНОЙ транзакцией (§122–§124).
       */
      applyEditorChanges: (changes) => {
        if (changes.length === 0) return { applied: 0, skipped: 0 };
        // §134: в режиме только для чтения модель не меняется вовсе.
        if (get().editor2d.readOnly) return { applied: 0, skipped: changes.length };

        let applied = 0;
        let skipped = 0;
        const parametric: Array<{ id: FurnitureId; key: string; value: number }> = [];

        commit((p) => {
          for (const change of changes) {
            if (change.kind === 'move') {
              if (change.entityType === 'MODULE') {
                const furniture = p.furnitures.find((f) => String(f.id) === change.entityId);
                if (!furniture) { skipped++; continue; }
                furniture.position = {
                  x: furniture.position.x + change.dx,
                  y: furniture.position.y + change.dy,
                  z: furniture.position.z + change.dz,
                };
                /* Изделие двигается вместе с содержимым: детали хранят мировые
                 * координаты, поэтому сдвиг переносится и на них. */
                for (const assembly of furniture.assemblies) {
                  for (const part of assembly.parts) {
                    part.position = {
                      x: part.position.x + change.dx,
                      y: part.position.y + change.dy,
                      z: part.position.z + change.dz,
                    };
                  }
                }
                applied++;
                continue;
              }
              const part = p.furnitures
                .flatMap((f) => f.assemblies)
                .flatMap((a) => a.parts)
                .find((x) => String(x.id) === change.entityId);
              if (!part) { skipped++; continue; }
              part.position = {
                x: part.position.x + change.dx,
                y: part.position.y + change.dy,
                z: part.position.z + change.dz,
              };
              applied++;
              continue;
            }

            if (change.kind === 'rotate') {
              if (change.entityType === 'MODULE') {
                const furniture = p.furnitures.find((f) => String(f.id) === change.entityId);
                if (!furniture) { skipped++; continue; }
                furniture.rotation = { ...furniture.rotation, y: change.rotation };
                applied++;
                continue;
              }
              const part = p.furnitures
                .flatMap((f) => f.assemblies)
                .flatMap((a) => a.parts)
                .find((x) => String(x.id) === change.entityId);
              if (!part) { skipped++; continue; }
              part.rotation = { ...part.rotation, y: change.rotation };
              applied++;
              continue;
            }

            if (change.kind === 'parameter') {
              // Параметры применяются существующим движком после транзакции.
              parametric.push({ id: change.entityId as FurnitureId, key: change.key, value: change.value });
              continue;
            }

            if (change.kind === 'mirror') {
              const furniture = p.furnitures.find((f) => String(f.id) === change.entityId);
              if (!furniture) { skipped++; continue; }
              const metadata = { ...(furniture.metadata ?? {}) };
              metadata.mirrored = metadata.mirrored !== true;
              furniture.metadata = metadata;
              for (const assembly of furniture.assemblies) {
                assembly.parts = assembly.parts.map(mirrorPart);
              }
              applied++;
            }
          }
        });

        /* Изменение параметра модуля идёт через существующий параметрический
         * движок (§31/§32): он перегенерирует детали, соединения и присадку.
         * Второй системы генерации не появляется. */
        for (const item of parametric) {
          const furniture = findFurniture(get().project, item.id);
          if (!furniture || !hasParametricModel(furniture)) { skipped++; continue; }
          const model = readParametricModel(furniture);
          const res = get().applyParametricModel(item.id, { ...model, [item.key]: item.value });
          if (res.ok) applied++; else skipped++;
        }

        return { applied, skipped };
      },

      setEditorHidden: (id, hidden) =>
        set((s) => {
          const list = s.editor2d.hidden.filter((x) => x !== id);
          s.editor2d.hidden = hidden ? [...list, id] : list;
        }),

      setEditorLocked: (id, locked) =>
        set((s) => {
          const list = s.editor2d.locked.filter((x) => x !== id);
          s.editor2d.locked = locked ? [...list, id] : list;
        }),

      editorShowAll: () =>
        set((s) => {
          s.editor2d.hidden = [];
          s.editor2d.isolated = [];
        }),

      editorIsolate: (ids) => set((s) => void (s.editor2d.isolated = [...ids])),

      setEditorGuides: (guides) => set((s) => void (s.editor2d.guides = [...guides])),
      setEditorDimensions: (dimensions) => set((s) => void (s.editor2d.dimensions = [...dimensions])),
      setConstraints: (constraints) => set((s) => void (s.constraints = [...constraints])),

      editorCopy: (ids) => {
        const clipboard = copyEntities(get().project, ids);
        set((s) => void (s.clipboard = clipboard));
        return clipboard.items.length;
      },

      editorPaste: () => {
        if (get().editor2d.readOnly) return [];
        const prepared = preparePaste(get().clipboard);
        if (prepared.furnitures.length === 0 && prepared.parts.length === 0) return [];
        const ids: string[] = [];
        commit((p) => {
          for (const furniture of prepared.furnitures) {
            p.furnitures.push(furniture);
            ids.push(String(furniture.id));
          }
          if (prepared.parts.length > 0) {
            const assembly = firstAssembly(p);
            if (assembly) {
              for (const part of prepared.parts) {
                assembly.parts.push(part);
                ids.push(String(part.id));
              }
            }
          }
        });
        set((s) => void (s.editor2d.selection = ids));
        return ids;
      },

      editorDuplicate: (ids) => {
        if (get().editor2d.readOnly) return [];
        const prepared = prepareDuplicate(get().project, ids);
        if (prepared.furnitures.length === 0 && prepared.parts.length === 0) return [];
        const created: string[] = [];
        commit((p) => {
          for (const furniture of prepared.furnitures) {
            p.furnitures.push(furniture);
            created.push(String(furniture.id));
          }
          if (prepared.parts.length > 0) {
            const assembly = firstAssembly(p);
            if (assembly) {
              for (const part of prepared.parts) {
                assembly.parts.push(part);
                created.push(String(part.id));
              }
            }
          }
        });
        set((s) => void (s.editor2d.selection = created));
        return created;
      },

      editorDelete: (ids) => {
        if (get().editor2d.readOnly) return { removed: 0, warnings: [] };
        /* §83: зависимости не удаляются молча — о них сообщается, а сами
         * соединения снимаются по существующим правилам модели. */
        const impacts = deleteImpact(get().project, ids);
        const warnings = impacts
          .filter((i) => !i.safe)
          .map((i) => `Удаление затронет соединений: ${i.connections.length}.`);

        const target = new Set(ids);
        let removed = 0;
        commit((p) => {
          const before = p.furnitures.length;
          p.furnitures = p.furnitures.filter((f) => !target.has(String(f.id)));
          removed += before - p.furnitures.length;
          for (const furniture of p.furnitures) {
            for (const assembly of furniture.assemblies) {
              const n = assembly.parts.length;
              assembly.parts = assembly.parts.filter((x) => !target.has(String(x.id)));
              removed += n - assembly.parts.length;
            }
          }
          // Соединения на исчезнувшие детали больше не имеют смысла.
          const alive = new Set(
            p.furnitures.flatMap((f) => f.assemblies).flatMap((a) => a.parts).map((x) => String(x.id)),
          );
          p.hardwareConnections = p.hardwareConnections.filter(
            (c) => alive.has(String(c.partAId)) && alive.has(String(c.partBId)),
          );
        });
        set((s) => {
          s.editor2d.selection = s.editor2d.selection.filter((id) => !target.has(id));
        });
        return { removed, warnings };
      },

      editorEntities: () => {
        const state = get();
        const ui = state.editor2d;
        const entities = buildEntities(state.project, {
          plane: ui.plane,
          filter: ui.filter,
          showHardware: ui.showHardware,
          showConnections: ui.showConnections,
        });
        const hidden = new Set(ui.hidden);
        const locked = new Set(ui.locked);
        const isolated = new Set(ui.isolated);
        const withFlags = entities
          // §88: при изоляции остальные объекты не показываются вовсе.
          .filter((e) => isolated.size === 0 || isolated.has(e.entityId) || isolated.has(e.parentId ?? ''))
          .map((e) => ({
            ...e,
            hidden: e.hidden || hidden.has(e.entityId),
            locked: e.locked || locked.has(e.entityId),
          }));
        return markStatuses(withFlags, collectIssues(state.project));
      },

      showAllParts: () =>
        commit((p) => {
          for (const f of p.furnitures) for (const a of f.assemblies) for (const part of a.parts) {
            if (part.metadata?.hidden) part.metadata = { ...part.metadata, hidden: false };
          }
        }),
      isolatePart: (id) => set((s) => void (s.viewer.isolatedPartId = id)),

      newProject: (name) => {
        set((state) => {
          state.project = createProject(name ? { name } : {});
          state.selectedPartId = null;
          state.activeFurnitureId = null;
          state.selectedConnectionId = null;
          state.selectedOperationId = null;
          state.selectedCuttingPieceId = null;
          state.cuttingRunning = false;
          state.cuttingProgress = null;
          state.cuttingError = null;
          state.past = [];
          state.future = [];
        });
      },

      loadProject: (project) => {
        set((state) => {
          state.project = project;
          state.selectedPartId = null;
          state.activeFurnitureId =
            project.furnitures.find((f) => f.type === 'cabinet')?.id ?? null;
          state.selectedConnectionId = null;
          state.selectedOperationId = null;
          state.selectedCuttingPieceId = null;
          state.cuttingRunning = false;
          state.cuttingProgress = null;
          state.cuttingError = null;
          state.past = [];
          state.future = [];
        });
      },

      setProjectName: (name) => commit((p) => void (p.name = name)),

      updateSettings: (patch) =>
        commit((p) => {
          Object.assign(p.settings, patch);
        }),

      addFurniture: (name) =>
        commit((p) => {
          p.furnitures.push(createFurniture(name ?? `Изделие ${p.furnitures.length + 1}`));
        }),

      /* Удаление изделия убирает и его соединения (§97): иначе остались бы
       * узлы, ссылающиеся на исчезнувшие детали, и «мёртвая» присадка. */
      removeFurniture: (id) => {
        const next = removeCabinetPure(get().project, id);
        commit((p) => {
          p.furnitures = next.furnitures;
          p.hardwareConnections = next.connections;
        });
        if (get().activeFurnitureId === id) set((s) => void (s.activeFurnitureId = null));
      },

      setActiveFurniture: (id) => set((s) => void (s.activeFurnitureId = id)),

      createCabinet: (name) => {
        const project = get().project;
        const bodyMaterial =
          project.materials.find((m) => m.kind === 'ldsp')?.id ??
          project.materials[0]?.id ??
          null;
        const backMaterial =
          project.materials.find((m) => m.kind === 'other')?.id ?? bodyMaterial;
        const params = defaultCabinetParameters({ material: bodyMaterial, backMaterial });

        const furniture = createFurniture(name ?? `Шкаф ${project.furnitures.length + 1}`);
        furniture.type = 'cabinet';
        furniture.assemblies = [createAssembly('Корпус')];
        furniture.params = params as unknown as Record<string, unknown>;

        const built = buildCabinet(params);
        furniture.assemblies[0].parts = built.parts;
        furniture.sections = built.sections;

        commit((p) => {
          p.furnitures.push(furniture);
        });
        set((s) => void (s.activeFurnitureId = furniture.id));
        return furniture.id;
      },

      updateCabinetParams: (id, patch) =>
        commit((p) => {
          const furniture = findFurniture(p, id);
          if (!furniture || furniture.type !== 'cabinet') return;
          const current = readCabinetParameters(furniture.params);
          const next = normalizeCabinetParameters(patch, current);
          const assembly = furniture.assemblies[0];
          const existing = assembly ? assembly.parts : [];
          const built = rebuildCabinet(existing, next);
          if (assembly) assembly.parts = built.parts;
          furniture.sections = built.sections;
          furniture.params = next as unknown as Record<string, unknown>;
        }),


      // ── Параметрический редактор ──────────────────────────────────────────
      getParametricModel: (id) => {
        const furniture = findFurniture(get().project, id);
        return furniture ? readParametricModel(furniture) : null;
      },

      /* Единственный путь изменения геометрии (§50): модель → генератор →
       * ProjectModel. Всё делается одной командой commit, поэтому пересчёт
       * целиком ложится в undo/redo (§52). */
      applyParametricModel: (id, model) => {
        const project = get().project;
        const furniture = findFurniture(project, id);
        if (!furniture) {
          return { ok: false, added: 0, removed: 0, changed: 0, errors: ['Изделие не найдено.'], description: '' };
        }
        const before = readParametricModel(furniture);
        const existing = furniture.assemblies[0]?.parts ?? [];

        /* Единственный маршрут пересчёта (§60): проверка → детали → фурнитура →
         * соединения → присадка → раскрой/2D/3D. Пересчёт атомарен: при ошибке
         * валидации в проект не попадает ничего (§61). */
        const result = regenerateCabinet(project, id, model, { previous: before });
        if (!result.applied) {
          return {
            ok: false, added: 0, removed: 0, changed: 0,
            errors: result.issues.filter((i) => i.severity === 'error').map((i) => i.message),
            description: '',
          };
        }
        const diff = diffParametric(before, model, existing);

        /* Соединения записываются в ТОМ ЖЕ commit, что и детали (§47):
         * иначе undo откатил бы детали, оставив соединения от новой
         * конструкции. Ручные соединения при этом сохраняются (§50). */
        commit((p) => {
          const f = findFurniture(p, id);
          if (!f) return;
          const assembly = f.assemblies[0];
          if (assembly) assembly.parts = result.parts;
          // Модель хранится в изделии, поэтому переживает сохранение (§90).
          f.params = { ...(f.params ?? {}), [PARAMETRIC_KEY]: model } as Record<string, unknown>;

          const ownPartIds = new Set(result.parts.map((x) => String(x.id)));
          const foreign = p.hardwareConnections.filter(
            (c) => !ownPartIds.has(String(c.partAId)) && !ownPartIds.has(String(c.partBId)),
          );
          p.hardwareConnections = [...foreign, ...result.connections];
        });

        return {
          ok: true,
          diff,
          added: result.added,
          removed: result.removed,
          changed: result.changed,
          errors: [],
          description: describeDiff(diff),
        };
      },

      runParametricCommand: (id, type, payload = {}) => {
        const furniture = findFurniture(get().project, id);
        if (!furniture) {
          return { ok: false, added: 0, removed: 0, changed: 0, errors: ['Изделие не найдено.'], description: '' };
        }
        const model = readParametricModel(furniture);
        const command = runParametricCommandPure(model, type, payload);
        if (!command.ok) {
          return {
            ok: false, added: 0, removed: 0, changed: 0,
            errors: command.message ? [command.message] : [], description: '',
          };
        }
        const applied = get().applyParametricModel(id, command.model);
        // Описание команды информативнее описания диффа.
        return applied.ok ? { ...applied, description: command.description } : applied;
      },

      // ── Генератор корпусной мебели (этап 28) ────────────────────────────

      getCabinetModel: (id) => {
        const furniture = findFurniture(get().project, id);
        return furniture ? toCabinetModel(readParametricModel(furniture)) : null;
      },

      /* Мастер создания (§92): тип → размеры → материал → схема → создать.
       * Пресет задаёт стартовые значения, явные размеры их перекрывают. */
      createParametricCabinet: (input) => {
        const project = get().project;
        const model = cabinetModelFromInput(project, input);
        if (!model) return null;
        const built = buildCabinetPure(project, model, input.name);
        // Детали не собрались — в проект не попадает ничего (§61).
        if (built.furniture.assemblies[0]?.parts.length === 0) return null;

        commit((p) => {
          p.furnitures.push(built.furniture);
          p.hardwareConnections = [...p.hardwareConnections, ...built.connections];
        });
        set((st) => void (st.activeFurnitureId = built.furniture.id));
        return built.furniture.id;
      },

      previewParametricCabinet: (input) => {
        const project = get().project;
        const model = cabinetModelFromInput(project, input);
        return model ? previewCabinet(project, model) : null;
      },

      /* Несколько параметров — одна транзакция undo (§117): патч уходит в
       * модель целиком, а не полем за полем. */
      applyCabinetPatch: (id, patch, description) => {
        const model = get().getCabinetModel(id);
        if (!model) {
          return { ok: false, added: 0, removed: 0, changed: 0, errors: ['Изделие не найдено.'], description: '' };
        }
        const applied = get().applyParametricModel(id, toCabinetModel({ ...model, ...patch }));
        return description && applied.ok ? { ...applied, description } : applied;
      },

      checkCabinetConstruction: (id) => {
        const project = get().project;
        const furniture = findFurniture(project, id);
        if (!furniture) return null;
        return checkCabinet(project, readParametricModel(furniture), furniture.assemblies[0]?.parts ?? []);
      },

      getCabinetBom: (id) => {
        const project = get().project;
        const furniture = id ? findFurniture(project, id) : undefined;
        return cabinetBom(project, furniture ?? undefined);
      },

      /* «Распределить равномерно» (§18): ручные положения полок снимаются,
       * дальше работает обычный расчёт. */
      distributeShelvesEqually: (id) => {
        const model = get().getCabinetModel(id);
        if (!model) {
          return { ok: false, added: 0, removed: 0, changed: 0, errors: ['Изделие не найдено.'], description: '' };
        }
        return get().applyCabinetPatch(
          id,
          { shelves: { ...model.shelves, distribution: 'AUTO_EQUAL', fixedShelves: [] } },
          'Полки распределены равномерно',
        );
      },

      /* Ручное положение полки (§19/§20): остальные параметры продолжают
       * работать, полка получает override. */
      setShelfPosition: (id, index, offset) => {
        const model = get().getCabinetModel(id);
        if (!model) {
          return { ok: false, added: 0, removed: 0, changed: 0, errors: ['Изделие не найдено.'], description: '' };
        }
        const fixedShelves = [
          ...model.shelves.fixedShelves.filter((f) => f.index !== index),
          { index, offset, fixed: true },
        ].sort((a, b) => a.index - b.index);
        return get().applyCabinetPatch(
          id,
          { shelves: { ...model.shelves, fixedShelves } },
          `Полка ${index}: положение ${Math.round(offset)} мм`,
        );
      },

      resetShelfPosition: (id, index) => {
        const model = get().getCabinetModel(id);
        if (!model) {
          return { ok: false, added: 0, removed: 0, changed: 0, errors: ['Изделие не найдено.'], description: '' };
        }
        return get().applyCabinetPatch(
          id,
          { shelves: { ...model.shelves, fixedShelves: model.shelves.fixedShelves.filter((f) => f.index !== index) } },
          `Полка ${index}: возвращён расчёт`,
        );
      },

      copyCabinetToClipboard: (id) => {
        const json = copyCabinetPure(get().project, id);
        if (json) set((st) => void (st.cabinetClipboard = json));
        return json;
      },

      pasteCabinetFromClipboard: (json, name) => {
        const source = json ?? get().cabinetClipboard;
        if (!source) return null;
        const copy = pasteCabinetPure(source, name);
        if (!copy) return null;
        commit((p) => {
          p.furnitures.push(copy.furniture);
          p.hardwareConnections = [...p.hardwareConnections, ...copy.connections];
        });
        return copy.furniture.id;
      },

      /* Удаление шкафа (§97): вместе с ним исчезают его соединения, а значит и
       * производная присадка — «мёртвых» ссылок не остаётся. */
      deleteCabinet: (id) => {
        const project = get().project;
        const impact = cabinetRemovalImpact(project, id);
        if (!impact) return false;
        const next = removeCabinetPure(project, id);
        commit((p) => {
          p.furnitures = next.furnitures;
          p.hardwareConnections = next.connections;
        });
        if (get().activeFurnitureId === id) set((st) => void (st.activeFurnitureId = null));
        return true;
      },

      saveCabinetPreset: (id, name) => {
        const model = get().getCabinetModel(id);
        if (!model || !name.trim()) return null;
        const preset = presetFromModel(model, name.trim());
        commit((p) => {
          const custom = Array.isArray(p.metadata?.[CABINET_PRESETS_KEY])
            ? (p.metadata![CABINET_PRESETS_KEY] as CabinetPreset[])
            : [];
          p.metadata = { ...(p.metadata ?? {}), [CABINET_PRESETS_KEY]: [...custom, preset] };
        });
        return preset;
      },

      removeCabinetPreset: (presetId) => {
        const custom = Array.isArray(get().project.metadata?.[CABINET_PRESETS_KEY])
          ? (get().project.metadata![CABINET_PRESETS_KEY] as CabinetPreset[])
          : [];
        if (!custom.some((p) => p.id === presetId)) return false;
        commit((p) => {
          p.metadata = {
            ...(p.metadata ?? {}),
            [CABINET_PRESETS_KEY]: custom.filter((x) => x.id !== presetId),
          };
        });
        return true;
      },

      importCabinetPresetsFile: (json) => {
        const result = importCabinetPresetsPure(json);
        if (!result.ok) return { ok: false, added: 0, errors: result.errors };
        const custom = Array.isArray(get().project.metadata?.[CABINET_PRESETS_KEY])
          ? (get().project.metadata![CABINET_PRESETS_KEY] as CabinetPreset[])
          : [];
        const existing = new Set(custom.map((p) => p.id));
        const fresh = result.presets.filter((p) => !existing.has(p.id));
        commit((p) => {
          p.metadata = { ...(p.metadata ?? {}), [CABINET_PRESETS_KEY]: [...custom, ...fresh] };
        });
        return { ok: true, added: fresh.length, errors: result.errors };
      },

      // ── Интерактивное редактирование (этап 29) ──────────────────────────

      setInteractionTool: (tool) => set((s) => {
        s.interaction.tool = tool;
        s.interaction.measure.active = tool === 'measure';
        if (tool !== 'measure') { s.interaction.measure.from = null; }
      }),

      /* Выбор синхронизирован во всех видах (§96–§98): один список
       * идентификаторов на 2D, 3D и панель свойств. */
      selectEntity: (id, options = {}) => set((s) => {
        const current = s.interaction.selection;
        const next = id === null
          ? clearSelectionPure(current)
          : options.additive
            ? toggleSelectionPure(current, id)
            : selectSinglePure(current, id);
        s.interaction.selection = next;
        s.editor2d.selection = [...next.ids];
        const active = next.ids[next.ids.length - 1] ?? null;
        s.selectedPartId = (active && findPart(s.project, active as PartId) ? active : null) as PartId | null;
      }),

      hoverEntity: (id) => set((s) => void (s.interaction.selection.hovered = id)),

      selectAllEntities: () => set((s) => {
        const next = selectAllPure(s.project, s.interaction.selection, s.editor2d.hidden);
        s.interaction.selection = next;
        s.editor2d.selection = [...next.ids];
      }),

      clearInteractionSelection: () => set((s) => {
        s.interaction.selection = clearSelectionPure(s.interaction.selection);
        s.editor2d.selection = [];
        s.selectedPartId = null;
      }),

      selectParentEntity: () => set((s) => {
        const next = selectParentPure(s.project, s.interaction.selection);
        s.interaction.selection = next;
        s.editor2d.selection = [...next.ids];
      }),

      selectChildrenEntities: () => set((s) => {
        const next = selectChildrenPure(s.project, s.interaction.selection);
        s.interaction.selection = next;
        s.editor2d.selection = [...next.ids];
      }),

      setSelectionLevel: (level) => set((s) => void (s.interaction.selection.level = level)),

      boxSelectEntities: (a, b, crossing = true) => {
        const state = get();
        const ids = selectInBox(state.project, normalizeBox3(a, b), {
          crossing,
          hidden: state.editor2d.hidden,
        });
        set((s) => {
          s.interaction.selection = { ...s.interaction.selection, ids };
          s.editor2d.selection = [...ids];
        });
        return ids;
      },

      setGizmoState: (patch) => set((s) => void Object.assign(s.interaction.gizmo, patch)),
      setSnapSettings: (patch) => set((s) => void Object.assign(s.interaction.snap, patch)),

      addInteractionGuide: (axis, position, label) => {
        const id = `guide-${axis}-${Math.round(position)}-${get().interaction.guides.length + 1}`;
        set((s) => void s.interaction.guides.push({ id, axis, position, label }));
        return id;
      },

      moveInteractionGuide: (id, position) => set((s) => {
        const guide = s.interaction.guides.find((g) => g.id === id);
        if (guide && !guide.locked) guide.position = position;
      }),

      removeInteractionGuide: (id) => set((s) => {
        s.interaction.guides = s.interaction.guides.filter((g) => g.id !== id);
      }),

      clearInteractionGuides: () => set((s) => void (s.interaction.guides = [])),

      setInteractionCursor: (point) => set((s) => void (s.interaction.cursor = point)),

      /* Перетаскивание конструктивной детали меняет ПАРАМЕТР шкафа, а не
       * координату детали (§25–§32): модель остаётся согласованной. */
      dragConstructivePart: (partId, value) => {
        const project = get().project;
        const part = findPart(project, partId);
        if (!part) {
          return { ok: false, model: {} as never, description: '', refusal: { code: 'drag.noPart', message: 'Деталь не найдена.' } };
        }
        const furnitureId = furnitureOfPartId(project, String(part.id));
        const furniture = furnitureId ? findFurniture(project, furnitureId as FurnitureId) : null;
        if (!furniture) {
          return { ok: false, model: {} as never, description: '', refusal: { code: 'drag.noCabinet', message: 'Изделие детали не найдено.' } };
        }
        const model = readParametricModel(furniture);
        const index = indexOfPart(part);
        const target = dragTargetOf(part);

        let outcome: DragOutcome;
        switch (target) {
          case 'SHELF': outcome = dragShelf(model, index, value); break;
          case 'DIVIDER': outcome = dragDivider(model, index, value); break;
          case 'DRAWER': outcome = dragDrawer(model, index, value); break;
          case 'DOOR': outcome = dragDoor(model, 'left', value - model.doors.gaps.leftGap); break;
          default:
            outcome = {
              ok: false, model, description: '',
              refusal: { code: 'drag.notConstructive', message: `Деталь «${part.name}» не управляется параметрами: перемещайте её как обычную деталь.` },
            };
        }
        if (!outcome.ok) return outcome;

        const applied = get().applyParametricModel(furniture.id, outcome.model);
        if (!applied.ok) {
          return { ...outcome, ok: false, refusal: { code: 'drag.rejected', message: applied.errors[0] ?? 'Пересчёт отклонён.' } };
        }
        return outcome;
      },

      /* Ручной размер детали (§19/§23): формула остаётся, значение получает
       * Override и переживает пересчёт до сброса. */
      resizeSelectedPart: (partId, field, value) => {
        const part = findPart(get().project, partId);
        if (!part) return { ok: false, message: 'Деталь не найдена.' };
        const outcome = resizePart(part, field, value);
        if (!outcome.ok) return { ok: false, message: outcome.refusal?.message };
        get().setPartOverride(partId, outcome.override ?? {});
        return { ok: true };
      },

      resetPartFormula: (partId, fields) => {
        const part = findPart(get().project, partId);
        if (!part) return;
        const cleaned = resetToFormula(part, fields);
        commit((p) => {
          const target = findPart(p, partId);
          if (target) target.metadata = cleaned.metadata;
        });
        const furnitureId = furnitureOfPartId(get().project, String(partId));
        if (furnitureId) {
          const furniture = findFurniture(get().project, furnitureId as FurnitureId);
          if (furniture) get().applyParametricModel(furniture.id, readParametricModel(furniture));
        }
      },

      setPartLock: (partId, patch) => commit((p) => {
        const part = findPart(p, partId);
        if (!part) return;
        part.metadata = {
          ...(part.metadata ?? {}),
          ...(patch.position !== undefined ? { lockedPosition: patch.position } : {}),
          ...(patch.size !== undefined ? { lockedSize: patch.size } : {}),
        };
      }),

      setMeasureActive: (active) => set((s) => {
        s.interaction.measure = { ...EMPTY_MEASURE, active };
        if (active) s.interaction.tool = 'measure';
      }),

      measureAt: (point) => {
        const next = measureClick(get().interaction.measure, point);
        set((s) => void (s.interaction.measure = next));
        return next;
      },

      toggleConstraintsVisible: () => set((s) => {
        s.interaction.showConstraints = !s.interaction.showConstraints;
      }),

      /* Транзакция (§121/§122): промежуточные шаги перетаскивания меняют
       * модель, но историю не растят — в неё попадает одно состояние начала. */
      beginInteractionTransaction: (kind, label) => {
        const origin = get().project;
        transactionOrigin = origin;
        set((s) => {
          s.interaction.transaction = { id: `tx-${Date.now().toString(36)}`, kind, label, steps: 0 };
        });
      },

      endInteractionTransaction: () => {
        const origin = transactionOrigin;
        transactionOrigin = null;
        set((s) => {
          if (origin && s.interaction.transaction && s.interaction.transaction.steps > 0) {
            s.past.push(origin);
            if (s.past.length > HISTORY_LIMIT) s.past.shift();
            s.future = [];
          }
          s.interaction.transaction = null;
        });
      },

      cancelInteractionTransaction: () => {
        const origin = transactionOrigin;
        transactionOrigin = null;
        set((s) => {
          if (origin) s.project = origin;
          s.interaction.transaction = null;
        });
      },

      createModuleFromTemplate: (templateId, name) => {
        const template = findModuleTemplate(templateId);
        if (!template) return null;
        const module = moduleFromTemplate(template, name);
        const project = get().project;
        const body = project.materials.find((m) => m.kind === 'ldsp') ?? project.materials[0];
        const model: ParametricModel = { ...module.parameters, materialId: body?.id ?? null };
        if (body) model.thickness = body.thickness;

        const furniture = createFurniture(module.name);
        furniture.type = 'cabinet';
        const result = generateParts(model, []);
        /* Соединения создаются в ТОМ ЖЕ commit, что и детали: иначе undo
         * откатил бы детали, оставив узлы от прежней конструкции. */
        const reconciled = reconcileConnections(project, result.parts, {
          jointCategory: model.jointType,
          construction: model.construction,
          handles: model.doors.handleEnabled,
        });
        commit((p) => {
          furniture.params = { [PARAMETRIC_KEY]: model } as Record<string, unknown>;
          furniture.metadata = { ...(furniture.metadata ?? {}), moduleTemplateId: template.id };
          if (furniture.assemblies[0]) furniture.assemblies[0].parts = result.parts;
          p.furnitures.push(furniture);
          p.hardwareConnections = [...p.hardwareConnections, ...reconciled.connections];
        });
        set((s) => void (s.activeFurnitureId = furniture.id));
        return furniture.id;
      },

      /* Копия получает НОВЫЕ идентификаторы (§82): иначе копия и оригинал
       * делили бы детали, и правка одной меняла бы другую. */
      /* Дубликат изделия (§95): копия полностью независима — новые id деталей,
       * сборок, соединений и присадки. Логика общая с «вставить из буфера». */
      duplicateFurniture: (id, name) => {
        const project = get().project;
        const source = findFurniture(project, id);
        if (!source) return null;
        const copy = duplicateFurnitureData(
          source, project.hardwareConnections, name ?? `${source.name} (копия)`,
        );
        commit((p) => {
          p.furnitures.push(copy.furniture);
          p.hardwareConnections.push(...copy.connections);
        });
        return copy.furniture.id;
      },

      mirrorFurniture: (id) => {
        const furniture = findFurniture(get().project, id);
        if (!furniture || furniture.metadata?.locked === true) return false;
        commit((p) => {
          const target = findFurniture(p, id);
          if (!target) return;
          for (const assembly of target.assemblies) {
            assembly.parts = assembly.parts.map(mirrorPart);
          }
          target.metadata = { ...(target.metadata ?? {}), mirrored: !(target.metadata?.mirrored === true) };
        });
        return true;
      },

      rotateFurniture: (id, rotation) => {
        const furniture = findFurniture(get().project, id);
        if (!furniture || furniture.metadata?.locked === true) return false;
        commit((p) => {
          const target = findFurniture(p, id);
          // §86: меняется только разворот изделия, локальные размеры деталей нет.
          if (target) target.rotation = { ...target.rotation, y: rotation };
        });
        return true;
      },

      moveFurniture: (id, position, gridStep = 0) => {
        const furniture = findFurniture(get().project, id);
        if (!furniture || furniture.metadata?.locked === true) return false;
        commit((p) => {
          const target = findFurniture(p, id);
          if (!target) return;
          const snap = (v: number) => snapToGrid(v, gridStep);
          target.position = {
            x: position.x != null ? snap(position.x) : target.position.x,
            y: position.y != null ? snap(position.y) : target.position.y,
            z: position.z != null ? snap(position.z) : target.position.z,
          };
        });
        return true;
      },

      setFurnitureVisible: (id, visible) =>
        commit((p) => {
          const target = findFurniture(p, id);
          if (target) target.metadata = { ...(target.metadata ?? {}), hidden: !visible };
        }),

      setFurnitureLocked: (id, locked) =>
        commit((p) => {
          const target = findFurniture(p, id);
          if (target) target.metadata = { ...(target.metadata ?? {}), locked };
        }),

      applyToModules: (ids, key, value) => {
        let applied = 0;
        let skipped = 0;
        for (const id of ids) {
          const furniture = findFurniture(get().project, id);
          const model = furniture ? readParametricModel(furniture) : null;
          // §119: у изделия без параметрической модели такого параметра нет —
          // молча выдумывать его нельзя.
          if (!furniture || !model || !hasParametricModel(furniture)) { skipped += 1; continue; }
          const res = get().applyParametricModel(id, { ...model, [key]: value });
          if (res.ok) applied += 1;
          else skipped += 1;
        }
        return { applied, skipped };
      },

      createParametricFurniture: (templateId, name) => {
        const template = findParametricTemplate(templateId);
        if (!template) return null;
        const project = get().project;
        const body = project.materials.find((m) => m.kind === 'ldsp') ?? project.materials[0];
        const model: ParametricModel = { ...template.build(), materialId: body?.id ?? null };
        if (body) model.thickness = body.thickness;

        const furniture = createFurniture(name ?? template.name);
        furniture.type = 'cabinet';
        const result = generateParts(model, []);
        // Соединения создаются сразу вместе с деталями (§27).
        const reconciled = reconcileConnections(project, result.parts, {
          jointCategory: model.jointType,
          construction: model.construction,
          handles: model.doors.handleEnabled,
        });
        commit((p) => {
          furniture.params = { [PARAMETRIC_KEY]: model } as Record<string, unknown>;
          if (furniture.assemblies[0]) furniture.assemblies[0].parts = result.parts;
          p.furnitures.push(furniture);
          p.hardwareConnections = [...p.hardwareConnections, ...reconciled.connections];
        });
        return furniture.id;
      },


      // ── Соединения ────────────────────────────────────────────────────────
      /* Пересборка соединений по правилам (§27/§47). Ручные соединения
       * переживают пересчёт, соединения исчезнувших деталей удаляются. */
      regenerateConnections: (id) => {
        const project = get().project;
        const furniture = findFurniture(project, id);
        if (!furniture) return { ok: false, added: 0, removed: 0, manual: 0, orphaned: 0 };

        const model = readParametricModel(furniture);
        const parts = furniture.assemblies[0]?.parts ?? [];
        const result = reconcileConnections(project, parts, {
          jointCategory: model.jointType,
          construction: model.construction,
          handles: model.doors.handleEnabled,
        });

        commit((p) => {
          // Соединения деталей ДРУГИХ изделий не трогаем.
          const ownPartIds = new Set(parts.map((x) => String(x.id)));
          const foreign = p.hardwareConnections.filter(
            (c) => !ownPartIds.has(String(c.partAId)) && !ownPartIds.has(String(c.partBId)),
          );
          p.hardwareConnections = [...foreign, ...result.connections];
        });

        return {
          ok: true,
          added: result.added.length,
          removed: result.removed.length,
          manual: result.manual.length,
          orphaned: result.orphaned.length,
        };
      },

      pruneConnections: () => {
        const { connections, removed } = pruneDeadConnections(get().project);
        if (removed.length === 0) return 0;
        commit((p) => void (p.hardwareConnections = connections));
        return removed.length;
      },

      setPartOverride: (partId, patch) =>
        commit((p) => {
          const part = findPart(p, partId);
          if (!part) return;
          Object.assign(part, applyPartOverride(part, patch));
        }),

      resetPartOverride: (partId, fields) =>
        commit((p) => {
          const part = findPart(p, partId);
          if (!part) return;
          const cleared = resetPartOverrideFields(part, fields);
          part.metadata = cleared.metadata;
        }),

      createFromTemplate: (templateId, values, name) => {
        const project = get().project;
        const template = findTemplate(templateId, loadCustomTemplates());
        if (!template) return { ok: false, errors: [{ severity: 'error', code: 'tpl.notFound', message: 'Шаблон не найден.' }] };
        const vals = values ?? defaultValues(template);
        const errors = validateTemplateValues(template, vals).filter((i) => i.severity === 'error');
        if (errors.length > 0) return { ok: false, errors };

        const body = project.materials.find((m) => m.kind === 'ldsp')?.id ?? project.materials[0]?.id ?? null;
        const back = project.materials.find((m) => m.kind === 'other')?.id ?? body;
        const { params } = instantiateTemplate(template, vals, { body, back, front: body });

        const furniture = createFurniture(name ?? template.name);
        furniture.type = 'cabinet';
        furniture.assemblies = [createAssembly('Корпус')];
        const built = buildCabinet(params);
        furniture.assemblies[0].parts = built.parts;
        furniture.sections = built.sections;
        furniture.params = params as unknown as Record<string, unknown>;
        const binding: TemplateBinding = { templateId, generator: template.generator, values: vals };
        furniture.metadata = { ...(furniture.metadata ?? {}), template: binding };

        /* Соединения шаблонного изделия строит тот же движок правил, что и у
         * параметрических (§1/§27): вторая система соединений не заводится,
         * поэтому у них есть stableId, статус и источник. */
        const ctx = cabinetConnectionContext(params);
        const newHardware: Hardware[] = [];
        const resolveHardware = (category: HardwareCategory): HardwareId | null => {
          const existing = project.hardware.find((h) => h.category === category)
            ?? newHardware.find((h) => h.category === category);
          if (existing) return existing.id;
          const tpl = catalogByCategory(category)[0];
          if (!tpl) return null;
          const hw = hardwareFromTemplate(tpl);
          newHardware.push(hw);
          return hw.id;
        };
        // Крепёж нужных категорий должен существовать до пересборки —
        // иначе движок пропустит соединение (нет фурнитуры — нет узла).
        for (const plan of planConnections({ ...ctx, parts: built.parts })) {
          resolveHardware(plan.category);
        }
        const reconciled = reconcileConnections(
          { ...project, hardware: [...project.hardware, ...newHardware] },
          built.parts,
          ctx,
        );

        commit((p) => {
          for (const hw of newHardware) p.hardware.push(hw);
          p.furnitures.push(furniture);
          p.hardwareConnections = [...p.hardwareConnections, ...reconciled.connections];
        });
        set((s) => void (s.activeFurnitureId = furniture.id));
        return { ok: true, id: furniture.id };
      },

      updateTemplateValues: (id, values) =>
        commit((p) => {
          const furniture = findFurniture(p, id);
          if (!furniture || furniture.type !== 'cabinet') return;
          const binding = furniture.metadata?.template as TemplateBinding | undefined;
          if (!binding || binding.detached) return;
          const template = findTemplate(binding.templateId, loadCustomTemplates());
          if (!template) return;
          const merged = { ...binding.values, ...values };
          const body = p.materials.find((m) => m.kind === 'ldsp')?.id ?? p.materials[0]?.id ?? null;
          const back = p.materials.find((m) => m.kind === 'other')?.id ?? body;
          const { params } = instantiateTemplate(template, merged, { body, back, front: body });
          const assembly = furniture.assemblies[0];
          const existing = assembly ? assembly.parts : [];
          const built = rebuildCabinet(existing, params);
          if (assembly) assembly.parts = built.parts;
          furniture.sections = built.sections;
          furniture.params = params as unknown as Record<string, unknown>;
          furniture.metadata = { ...furniture.metadata, template: { ...binding, values: merged } };

          // Пересобрать соединения, порождённые шаблоном (ручные — сохранить).
          /* Соединения пересобираются тем же движком правил, в ТОМ ЖЕ commit,
           * что и детали (§47): stableId сохраняет id узлов, поэтому ручные
           * правки присадки переживают смену параметров, а узлы исчезнувших
           * деталей уходят вместе с ними (§49/§50). */
          const ctx = cabinetConnectionContext(params);
          const resolveHardware = (category: HardwareCategory): HardwareId | null => {
            const existingHw = p.hardware.find((h) => h.category === category);
            if (existingHw) return existingHw.id;
            const tpl = catalogByCategory(category)[0];
            if (!tpl) return null;
            const hw = hardwareFromTemplate(tpl);
            p.hardware.push(hw);
            return hw.id;
          };
          for (const plan of planConnections({ ...ctx, parts: built.parts })) {
            resolveHardware(plan.category);
          }
          const reconciled = reconcileConnections(p, built.parts, ctx);
          // Соединения деталей ДРУГИХ изделий не трогаем.
          const ownPartIds = new Set(built.parts.map((x) => String(x.id)));
          const foreign = p.hardwareConnections.filter(
            (c) => !ownPartIds.has(String(c.partAId)) && !ownPartIds.has(String(c.partBId)),
          );
          p.hardwareConnections = [...foreign, ...reconciled.connections];
        }),

      detachTemplate: (id) =>
        commit((p) => {
          const furniture = findFurniture(p, id);
          if (!furniture) return;
          const binding = furniture.metadata?.template as TemplateBinding | undefined;
          if (!binding) return;
          furniture.metadata = { ...furniture.metadata, template: { ...binding, detached: true } };
        }),

      saveFurnitureAsTemplate: (id, name) => {
        const furniture = findFurniture(get().project, id);
        if (!furniture || furniture.type !== 'cabinet') return null;
        const params = readCabinetParameters(furniture.params);
        const template: FurnitureTemplate = {
          id: `tpl-user-${Date.now()}`,
          name,
          category: 'OTHER',
          description: 'Пользовательский шаблон.',
          generator: 'cabinet',
          version: '1.0',
          preview: '⭐',
          builtin: false,
          parameters: [
            { id: 'width', name: 'Ширина', type: 'NUMBER', defaultValue: params.width, min: 50, max: 3000, step: 1, unit: 'мм', required: true },
            { id: 'height', name: 'Высота', type: 'NUMBER', defaultValue: params.height, min: 50, max: 3000, step: 1, unit: 'мм', required: true },
            { id: 'depth', name: 'Глубина', type: 'NUMBER', defaultValue: params.depth, min: 50, max: 3000, step: 1, unit: 'мм', required: true },
            { id: 'materialThickness', name: 'Толщина', type: 'NUMBER', defaultValue: params.thickness, min: 8, max: 40, step: 1, unit: 'мм', required: true },
            { id: 'shelfCount', name: 'Полки', type: 'NUMBER', defaultValue: params.shelves, min: 0, max: 12, step: 1, unit: 'шт', required: true },
            { id: 'verticalPartitionCount', name: 'Перегородки', type: 'NUMBER', defaultValue: params.dividers, min: 0, max: 6, step: 1, unit: 'шт', required: true },
            { id: 'doorCount', name: 'Фасады', type: 'NUMBER', defaultValue: params.doors, min: 0, max: 6, step: 1, unit: 'шт', required: true },
          ],
        };
        addCustomTemplate(template);
        return template;
      },

      addPart: (input) => {
        const part = createPart(input);
        commit((p) => {
          const assembly = firstAssembly(p);
          if (assembly) assembly.parts.push(part);
        });
        return part.id;
      },

      addElement: (kind) => {
        const project = get().project;
        const material = project.materials.find((m) => m.kind === 'ldsp')?.id ?? project.materials[0]?.id ?? null;
        const back = project.materials.find((m) => m.kind === 'other')?.id ?? material;
        const presets: Record<string, CreatePartInput> = {
          panel: { name: 'Панель', role: 'custom', width: 600, height: 300, thickness: 16, material },
          shelf: { name: 'Полка', role: 'shelf', width: 600, height: 300, thickness: 16, material },
          divider: { name: 'Перегородка', role: 'divider', width: 300, height: 600, thickness: 16, material },
          facade: { name: 'Фасад', role: 'facade', width: 400, height: 700, thickness: 16, material },
          back: { name: 'Задняя стенка', role: 'back', width: 800, height: 2000, thickness: 3, material: back },
        };
        const part = createPart(presets[kind]);
        part.metadata = { number: '', addedManually: true };
        const targetAssembly = get().activeFurnitureId
          ? findFurniture(project, get().activeFurnitureId!)?.assemblies[0]
          : firstAssembly(project);
        commit((p) => {
          const assembly = targetAssembly
            ? p.furnitures.flatMap((f) => f.assemblies).find((a) => a.id === targetAssembly.id)
            : firstAssembly(p);
          if (assembly) {
            // назначаем следующий свободный номер Pxxx
            const maxN = allPartNumbers(p);
            part.metadata = { ...part.metadata, number: `P${String(maxN + 1).padStart(3, '0')}` };
            assembly.parts.push(part);
          }
        });
        return part.id;
      },

      duplicatePart: (id) => {
        const source = findPart(get().project, id);
        if (!source) return null;
        const copy: Part = {
          ...structuredClone(source),
          id: newPartId(),
          name: `${source.name} (копия)`,
          position: { ...source.position, x: source.position.x + source.thickness + 20 },
          machining: source.machining.map((op) => ({ ...op, id: newMachiningId() })),
          metadata: { ...source.metadata, number: '', addedManually: true, duplicatedFrom: source.id },
        };
        commit((p) => {
          const assembly = findAssemblyOfPart(p, id) ?? firstAssembly(p);
          if (assembly) {
            const maxN = allPartNumbers(p);
            copy.metadata = { ...copy.metadata, number: `P${String(maxN + 1).padStart(3, '0')}` };
            assembly.parts.push(copy);
          }
        });
        return copy.id;
      },

      setPartFlag: (id, patch) =>
        commit((p) => {
          const part = findPart(p, id);
          if (part) part.metadata = { ...part.metadata, ...patch };
        }),

      renameFurniture: (id, name) =>
        commit((p) => {
          const f = findFurniture(p, id);
          if (f) f.name = name;
        }),

      setSaveState: (state) => set((s) => void (s.saveState = state)),
      requestFocus: () => set((s) => void (s.focusNonce = s.focusNonce + 1)),

      markDocumentsGenerated: () =>
        commit((p) => {
          const version = documentsSignature(p);
          p.documents.version = version;
          const docVersion = nextDocVersion(p.documents.docVersion);
          p.documents.docVersion = docVersion;
          if (!p.documents.history) p.documents.history = [];
          p.documents.history.push({
            generatedAt: new Date().toISOString(),
            modelVersion: version,
            docVersion,
            documents: ['summary', 'assembly', 'partsList', 'hardwareList', 'parts', 'machining', 'cutting'],
            status: 'CURRENT',
          });
          // Ограничиваем историю последними 50 записями.
          if (p.documents.history.length > 50) p.documents.history = p.documents.history.slice(-50);
        }),

      generateDocuments: () => {
        const project = get().project;
        const check = runProductionCheck(project, { cuttingRunning: get().cuttingRunning });
        const errors = check.issues.filter((i) => i.severity === 'error');
        // ERROR блокирует генерацию комплекта; WARNING — не блокирует (§30).
        if (errors.length > 0) return { ok: false, errors };
        get().markDocumentsGenerated();
        return { ok: true, errors: [] };
      },

      setDocumentScale: (docKey, scale) =>
        commit((p) => {
          ensureDrawingSettings(p).scaleOverrides[docKey] = scale;
        }),

      toggleDrawingLayer: (layer) =>
        commit((p) => {
          const s = ensureDrawingSettings(p);
          s.hidden[layer] = !s.hidden[layer];
        }),

      setDocumentFormat: (docKey, format) =>
        commit((p) => {
          const s = ensureDrawingSettings(p);
          if (!s.formatOverrides) s.formatOverrides = {};
          s.formatOverrides[docKey] = format;
        }),

      setDocumentViews: (views) =>
        commit((p) => {
          ensureDrawingSettings(p).views = [...views];
        }),

      setDocumentPartFilter: (filter) =>
        commit((p) => {
          ensureDrawingSettings(p).partFilter = filter;
        }),

      /* Перемещение элемента — это ОФОРМЛЕНИЕ. Модель деталей не трогаем, и
       * документы от этого не становятся OUTDATED (§37): сигнатура модели
       * настройки чертежа не учитывает. Растёт только layoutVersion — она
       * входит в ключ кэша, чтобы страница перерисовалась (§55). */
      moveDocumentElement: (elementId, dx, dy) =>
        commit((p) => {
          const layout = ensureLayout(p);
          const prev = layout.moved[elementId] ?? { dx: 0, dy: 0 };
          layout.moved[elementId] = { dx: prev.dx + dx, dy: prev.dy + dy };
          layout.locked[elementId] = true; // ручная правка фиксирует элемент (§38)
          bumpLayoutVersion(p);
        }),

      lockDocumentElement: (elementId, locked) =>
        commit((p) => {
          const layout = ensureLayout(p);
          if (locked) layout.locked[elementId] = true;
          else delete layout.locked[elementId];
          bumpLayoutVersion(p);
        }),

      toggleDocumentView: (viewId) =>
        commit((p) => {
          const layout = ensureLayout(p);
          if (layout.hiddenViews[viewId]) delete layout.hiddenViews[viewId];
          else layout.hiddenViews[viewId] = true;
          bumpLayoutVersion(p);
        }),

      addDocumentNote: (docKey, note) => {
        const id = `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        commit((p) => {
          const layout = ensureLayout(p);
          if (!layout.notes[docKey]) layout.notes[docKey] = [];
          layout.notes[docKey].push({ id, ...note });
          bumpLayoutVersion(p);
        });
        return id;
      },

      removeDocumentNote: (docKey, noteId) =>
        commit((p) => {
          const layout = ensureLayout(p);
          if (!layout.notes[docKey]) return;
          layout.notes[docKey] = layout.notes[docKey].filter((n) => n.id !== noteId);
          bumpLayoutVersion(p);
        }),

      /* «Сбросить оформление» (§39): убираем ручные правки и возвращаемся к
       * автоматическому расчёту. Без docKey сбрасывается всё оформление. */
      resetDocumentLayout: (docKey) =>
        commit((p) => {
          const s = ensureDrawingSettings(p);
          if (docKey) {
            delete s.scaleOverrides[docKey];
            if (s.formatOverrides) delete s.formatOverrides[docKey];
            if (s.layout?.notes) delete s.layout.notes[docKey];
          } else {
            s.scaleOverrides = {};
            s.formatOverrides = {};
            s.hidden = {};
            s.views = undefined;
            s.partFilter = undefined;
            s.layout = emptyLayout();
          }
          bumpLayoutVersion(p);
        }),

      removePart: (id) => {
        commit((p) => {
          const assembly = findAssemblyOfPart(p, id);
          if (assembly) assembly.parts = assembly.parts.filter((x) => x.id !== id);
        });
        if (get().selectedPartId === id) set((s) => void (s.selectedPartId = null));
      },

      updatePart: (id, patch) =>
        commit((p) => {
          const part = findPart(p, id);
          if (part) Object.assign(part, patch);
        }),

      /* Кромка пишется в Part.edges — единственный источник истины (§6/§7).
       * EdgeBanding и EdgeOperation производны и пересчитываются сами, поэтому
       * одна команда commit обновляет деталь, кромку и операции атомарно
       * (§76/§77) и целиком попадает в undo (§78). */
      setPartEdge: (id, side, materialId) =>
        commit((p) => {
          const part = findPart(p, id);
          if (!part) return;
          (part.edges as Record<EdgeSide, EdgeMaterialId | null>)[side] = materialId;
          part.edgeSources = { ...(part.edgeSources ?? {}), [side]: 'MANUAL' };
        }),

      applyEdgeQuickAction: (ids, action, materialId) => {
        const project = get().project;
        const targets = ids.map((id) => findPart(project, id)).filter((x): x is Part => !!x);
        if (targets.length === 0) return 0;
        commit((p) => {
          for (const target of targets) {
            const part = findPart(p, target.id);
            if (!part) return;
            const { edges, sources } = applyEdgeConfiguration(
              part, quickActionConfig(part, action, materialId), 'MANUAL',
            );
            part.edges = edges;
            part.edgeSources = sources;
          }
        });
        return targets.length;
      },

      applyEdgePreset: (ids, preset) => {
        const project = get().project;
        // Пресет применяется РОВНО к выбранным деталям (§55).
        const targets = ids.map((id) => findPart(project, id)).filter((x): x is Part => !!x);
        if (targets.length === 0) return 0;
        const changes = applyPresetTo(targets, preset);
        commit((p) => {
          for (const change of changes) {
            const part = findPart(p, change.partId);
            if (!part) continue;
            part.edges = change.edges;
            part.edgeSources = change.sources;
          }
        });
        return changes.length;
      },

      applyEdgePresetToRole: (role, preset) => {
        const targets = allParts(get().project).filter((x) => x.role === role);
        return get().applyEdgePreset(targets.map((x) => x.id), preset);
      },

      setEdgeOverride: (id, side, override) =>
        commit((p) => {
          const part = findPart(p, id);
          if (!part) return;
          const next = { ...(part.edgeOverrides ?? {}) };
          if (override === null) delete next[side];
          else next[side] = override;
          part.edgeOverrides = Object.keys(next).length > 0 ? next : undefined;
        }),

      resetEdgeOverride: (id, side) => get().setEdgeOverride(id, side, null),

      addMaterial: (material) => commit((p) => void p.materials.push(material)),

      updateMaterial: (id, patch) =>
        commit((p) => {
          const material = p.materials.find((m) => m.id === id);
          if (!material) return;
          const thicknessChanged = patch.thickness !== undefined && patch.thickness !== material.thickness;
          Object.assign(material, patch);
          if (thicknessChanged) syncCabinetsToMaterial(p, id);
        }),

      removeMaterial: (id) => {
        const used = materialUsageCount(get().project, id);
        if (used > 0) {
          return {
            ok: false,
            message: `Материал используется в ${used} деталях. Сначала назначьте другой материал.`,
          };
        }
        commit((p) => void (p.materials = p.materials.filter((m) => m.id !== id)));
        return { ok: true };
      },

      addEdge: (edge) => commit((p) => void p.edges.push(edge)),

      updateEdge: (id, patch) =>
        commit((p) => {
          const edge = p.edges.find((e) => e.id === id);
          if (edge) Object.assign(edge, patch);
        }),

      removeEdge: (id) => {
        const used = edgeUsageCount(get().project, id);
        if (used > 0) {
          return {
            ok: false,
            message: `Кромка используется на ${used} сторонах деталей. Сначала снимите её назначение.`,
          };
        }
        commit((p) => void (p.edges = p.edges.filter((e) => e.id !== id)));
        return { ok: true };
      },

      updateManufacturingProfile: (patch) =>
        commit((p) => {
          if (p.machining.profile) Object.assign(p.machining.profile, patch);
        }),

      addHardware: (hardware) => commit((p) => void p.hardware.push(hardware)),

      // ── Этап 27: фурнитура и соединения ──────────────────────────────────
      /* §134/§135: ручное количество не стирает расчёт правила, а перекрывает
       * его. Передача null — сброс (§136), после которого снова действует
       * вычисленное значение. */
      setConnectionQuantityOverride: (id, quantity) =>
        commit((p) => {
          const connection = p.hardwareConnections.find((c) => c.id === id);
          if (!connection) return;
          if (quantity == null || !Number.isFinite(quantity) || quantity < 0) {
            delete connection.quantityOverride;
          } else {
            connection.quantityOverride = Math.round(quantity);
          }
        }),

      createConnectionFrom: (input) => {
        const project = get().project;
        const partA = findPart(project, input.partAId);
        const partB = findPart(project, input.partBId);
        if (!partA || !partB) {
          return { ok: false, error: 'Одна из деталей не найдена.', warnings: [] };
        }
        const preset = input.presetId ? findConnectionPreset(project, input.presetId) : undefined;
        const id = newHardwareConnectionId();
        const result = createConnection(
          project,
          { partA, partB, preset, type: input.type, hardwareId: input.hardwareId, quantity: input.quantity },
          id,
        );
        // §21: несовместимый узел не создаётся вовсе — модель не портится.
        if (!result.connection) return { ok: false, error: result.error, warnings: result.warnings };
        commit((p) => void p.hardwareConnections.push(result.connection!));
        return { ok: true, id, warnings: result.warnings };
      },

      createHardwareFromTemplate: (templateId, name) => {
        const template = findHardwareTemplate(templateId);
        if (!template) return null;
        const id = newHardwareId();
        const hardware = hardwareFromTemplateSpec(template, id, name ? { name } : {});
        commit((p) => void p.hardware.push(hardware));
        return id;
      },

      /* §153: позиция, на которую ссылаются узлы, физически не удаляется —
       * иначе соединения остались бы с «висящей» ссылкой. Она уходит в архив
       * (§154) и может быть возвращена (§155). */
      setHardwareArchived: (id, archived) =>
        commit((p) => {
          const hardware = p.hardware.find((h) => h.id === id);
          if (hardware) hardware.archived = archived;
        }),

      duplicateHardware: (id) => {
        const source = get().project.hardware.find((h) => h.id === id);
        if (!source) return null;
        const copy: Hardware = {
          ...JSON.parse(JSON.stringify(source)) as Hardware,
          id: newHardwareId(),
          name: `${source.name} (копия)`,
          archived: false,
        };
        commit((p) => void p.hardware.push(copy));
        return copy.id;
      },

      addManualHardwareInstance: (input) => {
        const project = get().project;
        if (!project.hardware.some((h) => h.id === input.hardwareId)) return null;
        if (!findPart(project, input.partId)) return null;
        const id = `manual:${input.partId}:${Date.now().toString(36)}`;
        commit((p) => {
          const list = p.hardwareInstances ?? [];
          list.push({
            id,
            hardwareId: input.hardwareId,
            partId: input.partId,
            quantity: Math.max(1, Math.round(input.quantity ?? 1)),
            source: 'manual',
          });
          p.hardwareInstances = list;
        });
        return id;
      },

      removeManualHardwareInstance: (id) =>
        commit((p) => {
          p.hardwareInstances = (p.hardwareInstances ?? []).filter((x) => x.id !== id);
        }),

      // Режим просмотра — состояние интерфейса, в историю не пишется (§146).
      setAssemblyMode: (mode, factor) =>
        set((s) => {
          s.assembly.mode = mode;
          if (factor != null && Number.isFinite(factor)) {
            s.assembly.factor = Math.max(0, Math.min(1, factor));
          }
        }),


      updateHardware: (id, patch) =>
        commit((p) => {
          const hw = p.hardware.find((h) => h.id === id);
          if (hw) Object.assign(hw, patch);
        }),

      removeHardware: (id) => {
        const used = hardwareUsageCount(get().project, id);
        if (used > 0) {
          return {
            ok: false,
            message: `Фурнитура используется в ${used} соединениях. Сначала удалите соединения.`,
          };
        }
        commit((p) => void (p.hardware = p.hardware.filter((h) => h.id !== id)));
        return { ok: true };
      },

      addConnection: (input) => {
        const project = get().project;
        const issues = validateConnection(input, project);
        if (issues.length > 0) {
          return { ok: false, message: issues[0].message };
        }
        const partA = findPart(project, input.partAId);
        const partB = findPart(project, input.partBId);
        const connection: HardwareConnection = {
          id: newHardwareConnectionId(),
          hardwareId: input.hardwareId,
          partAId: input.partAId,
          partBId: input.partBId,
          jointType: partA && partB ? inferJointType(partA, partB) : undefined,
          quantity: input.quantity,
          parameters: input.parameters,
        };
        commit((p) => void p.hardwareConnections.push(connection));
        return { ok: true, id: connection.id };
      },

      updateConnection: (id, patch) =>
        commit((p) => {
          const c = p.hardwareConnections.find((x) => x.id === id);
          if (c) Object.assign(c, patch);
        }),

      duplicateConnection: (id) => {
        const src = get().project.hardwareConnections.find((c) => c.id === id);
        if (!src) return null;
        // Новый HCxxx; производные операции (Mxxx) регенерируются от нового id.
        const copy: HardwareConnection = {
          ...structuredClone(src),
          id: newHardwareConnectionId(),
        };
        commit((p) => void p.hardwareConnections.push(copy));
        return copy.id;
      },

      removeConnection: (id) => {
        // Удаляем связь; производные операции присадки исчезают вместе с ней
        // (они вычисляются из связей — «висячих» операций не остаётся).
        commit((p) => void (p.hardwareConnections = p.hardwareConnections.filter((c) => c.id !== id)));
        if (get().selectedConnectionId === id) set((s) => void (s.selectedConnectionId = null));
      },

      selectConnection: (id) => set((s) => void (s.selectedConnectionId = id)),

      addHardwareFromTemplate: (template) => {
        const hardware = hardwareFromTemplate(template);
        commit((p) => void p.hardware.push(hardware));
        return hardware.id;
      },

      // ── Библиотека ────────────────────────────────────────────────────────
      /* Библиотека глобальная и живёт в localStorage, проект хранит СВОИ копии
       * (§59–§61): правка библиотеки сама по себе проект не меняет. */
      library: loadLibrary(),

      reloadLibrary: () => set((s) => void (s.library = loadLibrary())),

      setLibrary: (library) => {
        saveLibrary(library);
        set((s) => void (s.library = library));
      },

      addMaterialFromLibrary: (libraryId) => {
        const entry = get().library.materials.find((e) => String(e.value.id) === libraryId);
        if (!entry) return null;
        const material = linkToProject(entry);
        // В проекте у объекта свой id: библиотечный остаётся только в ссылке.
        material.id = newMaterialId();
        commit((p) => void p.materials.push(material));
        return material.id;
      },

      addEdgeFromLibrary: (libraryId) => {
        const entry = get().library.edges.find((e) => String(e.value.id) === libraryId);
        if (!entry) return null;
        const edge = linkToProject(entry);
        edge.id = newEdgeMaterialId();
        commit((p) => void p.edges.push(edge));
        return edge.id;
      },

      addHardwareFromLibrary: (libraryId) => {
        const entry = get().library.hardware.find((e) => String(e.value.id) === libraryId);
        if (!entry) return null;
        const hardware = linkToProject(entry);
        hardware.id = newHardwareId();
        commit((p) => void p.hardware.push(hardware));
        return hardware.id;
      },

      applyProfileFromLibrary: (libraryId) => {
        const entry = get().library.profiles.find((e) => e.value.id === libraryId);
        if (!entry) return false;
        const profile = linkProfile(entry);
        commit((p) => void (p.machining.profile = profile));
        return true;
      },

      /* «Обновить из библиотеки» (§62): применяем подготовленные патчи одной
       * командой, чтобы вся операция легла в undo/redo целиком. */
      updateFromLibrary: (projectIds) => {
        const patches = buildUpdatePatches(get().project, get().library, projectIds);
        if (patches.length === 0) return 0;
        commit((p) => {
          for (const patch of patches) {
            if (patch.section === 'materials') {
              const index = p.materials.findIndex((m) => String(m.id) === patch.projectId);
              if (index >= 0) {
                const before = p.materials[index];
                p.materials[index] = patch.value as Material;
                // Толщина материала ведёт за собой толщину деталей (§29).
                if (Math.abs(before.thickness - (patch.value as Material).thickness) > 0.01) {
                  syncCabinetsToMaterial(p, before.id);
                }
              }
            } else if (patch.section === 'edges') {
              const index = p.edges.findIndex((e) => String(e.id) === patch.projectId);
              if (index >= 0) p.edges[index] = patch.value as EdgeMaterial;
            } else {
              const index = p.hardware.findIndex((h) => String(h.id) === patch.projectId);
              if (index >= 0) p.hardware[index] = patch.value as Hardware;
            }
          }
        });
        return patches.length;
      },

      /* Массовая замена (§47): меняем материал детали и подтягиваем толщину.
       * Габариты детали не трогаем — их задаёт конструкция, а не материал (§46). */
      replaceMaterial: (fromId, toId, partIds) => {
        const plan = planMaterialReplace(get().project, fromId, toId, { partIds });
        if (!plan || plan.partIds.length === 0) return 0;
        const target = new Set(plan.partIds);
        commit((p) => {
          const to = p.materials.find((m) => String(m.id) === toId);
          if (!to) return;
          for (const f of p.furnitures) {
            for (const a of f.assemblies) {
              for (const part of a.parts) {
                if (!target.has(String(part.id))) continue;
                part.material = to.id;
                part.thickness = to.thickness;
              }
            }
          }
        });
        return plan.partIds.length;
      },

      replaceHardware: (fromId, toId, connectionIds) => {
        const plan = planHardwareReplace(get().project, fromId, toId, { connectionIds });
        if (!plan || plan.connectionIds.length === 0) return 0;
        const target = new Set(plan.connectionIds);
        commit((p) => {
          const to = p.hardware.find((h) => String(h.id) === toId);
          if (!to) return;
          for (const c of p.hardwareConnections) {
            if (target.has(String(c.id))) c.hardwareId = to.id;
          }
        });
        return plan.connectionIds.length;
      },

      addManualOperation: (input) => {
        const op: MachiningOperation = {
          id: newMachiningId(),
          type: 'drilling',
          partId: input.partId,
          face: input.face,
          x: input.x,
          y: input.y,
          z: 0,
          diameter: input.diameter,
          depth: input.depth,
          through: input.through ?? false,
          origin: 'manual',
        };
        commit((p) => {
          const part = findPart(p, input.partId);
          if (part) part.machining.push(op);
        });
        return op.id;
      },

      updateManualOperation: (id, patch) => {
        let found = false;
        commit((p) => {
          for (const f of p.furnitures) {
            for (const a of f.assemblies) {
              for (const part of a.parts) {
                const op = part.machining.find((o) => o.id === id);
                if (!op) continue;
                Object.assign(op, patch);
                // Сквозное отверстие всегда глубиной в толщину детали (§23):
                // хранить рядом другое число значило бы держать две правды.
                if (op.through) op.depth = part.thickness;
                found = true;
              }
            }
          }
        });
        return found;
      },

      addShapeOperation: (input) => {
        const part = findPart(get().project, input.partId);
        if (!part) return null;
        const common = { part, face: input.face, x: input.x, y: input.y, source: 'MANUAL' as const };
        let op: MachiningOperation;
        switch (input.kind) {
          case 'groove':
            op = grooveOperation({ ...common, length: input.length ?? 100, width: input.width ?? 8, depth: input.depth ?? 6 });
            break;
          case 'pocket':
            op = pocketOperation({ ...common, width: input.width ?? 50, height: input.height ?? 50, depth: input.depth ?? 6 });
            break;
          case 'cutout':
            op = cutoutOperation({ ...common, width: input.width ?? 50, height: input.height ?? 50 });
            break;
          case 'mill':
          default:
            op = millingOperation({ ...common, contour: [], depth: input.depth ?? 6, diameter: input.diameter });
            break;
        }
        commit((p) => {
          const target = findPart(p, input.partId);
          if (target) target.machining.push(op);
        });
        return op.id;
      },

      /* Пересчёт атомарен (§79/§80): набор операций производен от связей, но
       * при ошибках расчёта мы НЕ трогаем ручные операции детали — прежняя
       * проверенная технология остаётся на месте. */
      regenerateMachining: () => {
        const project = get().project;
        const outcome = regenerate(project, allOperations(project));
        if (!outcome.ok) {
          return { ok: false, operations: outcome.operations.length, errors: outcome.errors, warnings: outcome.warnings };
        }
        // Успешный пересчёт: производные операции уже вычисляются из связей,
        // поэтому достаточно снять признак устаревания документов.
        return { ok: true, operations: outcome.operations.length, errors: [], warnings: outcome.warnings };
      },

      removeOperation: (id) => {
        // Удаляются только ручные операции (производные вычисляются из связей).
        commit((p) => {
          for (const f of p.furnitures) {
            for (const a of f.assemblies) {
              for (const part of a.parts) {
                part.machining = part.machining.filter((op) => op.id !== id);
              }
            }
          }
        });
        if (get().selectedOperationId === id) set((s) => void (s.selectedOperationId = null));
      },

      setOperationOverride: (id, patch) =>
        commit((p) => {
          if (!p.machining.overrides) p.machining.overrides = {};
          p.machining.overrides[id] = { ...p.machining.overrides[id], ...patch };
        }),

      resetOperationToRule: (id) =>
        commit((p) => {
          if (p.machining.overrides) delete p.machining.overrides[id];
        }),

      /* Замена фурнитуры узла — одна команда: присадка производна от связи и
       * пересчитывается сама, поэтому количество, операции и 3D обновляются
       * согласованно, а откат возвращает прежнюю позицию целиком (§58/§102). */
      setConnectionHardware: (id, hardwareId) =>
        commit((p) => {
          const connection = p.hardwareConnections.find((c) => c.id === id);
          if (!connection) return;
          // Прежняя позиция запоминается, чтобы «вернуть расчётную» знало, к чему возвращаться.
          const previous = String(connection.hardwareId);
          connection.hardwareId = hardwareId;
          connection.metadata = { ...(connection.metadata ?? {}), hardwareOverride: previous };
        }),

      resetConnectionHardware: (id) => {
        const connection = get().project.hardwareConnections.find((c) => c.id === id);
        const previous = connection?.metadata?.hardwareOverride as string | undefined;
        if (!connection || !previous) return false;
        commit((p) => {
          const target = p.hardwareConnections.find((c) => c.id === id);
          if (!target) return;
          target.hardwareId = previous as HardwareId;
          const meta = { ...(target.metadata ?? {}) };
          delete meta.hardwareOverride;
          target.metadata = Object.keys(meta).length > 0 ? meta : undefined;
        });
        return true;
      },

      applyHardwarePreset: (preset, partIds = []) => {
        const changes = planPresetApplication(get().project, preset, partIds);
        if (changes.length === 0) return 0;
        commit((p) => {
          for (const change of changes) {
            const connection = p.hardwareConnections.find((c) => String(c.id) === change.connectionId);
            if (!connection) continue;
            connection.metadata = { ...(connection.metadata ?? {}), hardwareOverride: String(connection.hardwareId) };
            connection.hardwareId = change.hardwareId;
          }
        });
        return changes.length;
      },

      /* Архив вместо удаления (§12): позиция, использованная в проекте,
       * физически не исчезает — иначе узлы остались бы без фурнитуры. */
      archiveHardware: (id, archived) =>
        commit((p) => {
          const item = p.hardware.find((h) => h.id === id);
          if (item) item.archived = archived || undefined;
        }),

      replaceMissingHardware: (missingId, hardwareId) => {
        let replaced = 0;
        commit((p) => {
          for (const connection of p.hardwareConnections) {
            if (String(connection.hardwareId) !== missingId) continue;
            connection.hardwareId = hardwareId;
            replaced += 1;
          }
        });
        return replaced;
      },

      importHardwareLibraryJson: (json) => {
        const result = importHardwareLibrary(json);
        if (!result.ok) return { ok: false, added: 0, skipped: result.skipped, error: result.error };
        commit((p) => {
          const existing = new Set(p.hardware.map((h) => String(h.id)));
          for (const item of result.hardware) {
            // Повторный импорт того же файла обновляет позицию, а не плодит дубли.
            if (existing.has(String(item.id))) {
              const at = p.hardware.findIndex((h) => String(h.id) === String(item.id));
              p.hardware[at] = { ...p.hardware[at], ...item };
            } else {
              p.hardware.push(item);
            }
          }
          if (result.kits.length > 0) {
            const kits = p.hardwareKits ?? [];
            for (const kit of result.kits) {
              const at = kits.findIndex((k) => k.id === kit.id);
              if (at >= 0) kits[at] = kit;
              else kits.push(kit);
            }
            p.hardwareKits = kits;
          }
        });
        return { ok: true, added: result.hardware.length, skipped: result.skipped };
      },

      setConnectionType: (id, type) =>
        commit((p) => {
          const conn = p.hardwareConnections.find((c) => c.id === id);
          if (!conn) return;
          conn.connectionType = type;
          // Подбираем крепёж соответствующей категории: существующий или из каталога.
          const category = categoryOfConnectionType(type);
          const existing = p.hardware.find((h) => h.category === category);
          if (existing) {
            conn.hardwareId = existing.id;
            return;
          }
          const tpl = catalogByCategory(category)[0];
          if (tpl) {
            const hw = hardwareFromTemplate(tpl);
            p.hardware.push(hw);
            conn.hardwareId = hw.id;
          }
        }),

      selectOperation: (id) => set((s) => void (s.selectedOperationId = id)),

      updateCuttingSettings: (patch) =>
        commit((p) => {
          Object.assign(p.cutting.settings, patch);
        }),

      recalculateCutting: async () => {
        cuttingHandle?.cancel();
        set((s) => {
          s.cuttingRunning = true;
          s.cuttingError = null;
          s.cuttingProgress = { fraction: 0, message: 'Запуск…' };
        });
        const project = get().project;
        const handle = runCuttingInWorker(project, (pr) =>
          set((s) => void (s.cuttingProgress = pr)),
        );
        cuttingHandle = handle;
        try {
          const report: CuttingReport = await handle.promise;
          set((s) => {
            /* §86/§87: новый отчёт становится активным только целиком и
             * только после успешного расчёта; зафиксированные карты (§91)
             * переносятся из прежнего отчёта нетронутыми. */
            s.project.cutting.report = applyPlans(s.project, report);
            s.cuttingRunning = false;
            s.cuttingProgress = null;
          });
        } catch (err) {
          set((s) => {
            s.cuttingRunning = false;
            s.cuttingProgress = null;
            s.cuttingError = err instanceof Error && err.name === 'CuttingCancelledError' ? null : (err instanceof Error ? err.message : 'Ошибка расчёта');
          });
        } finally {
          if (cuttingHandle === handle) cuttingHandle = null;
        }
      },

      cancelCutting: () => {
        cuttingHandle?.cancel();
        cuttingHandle = null;
        set((s) => {
          s.cuttingRunning = false;
          s.cuttingProgress = null;
        });
      },

      applyCuttingReport: (report, algorithmId) =>
        commit((p) => {
          p.cutting.report = applyPlans(p, report);
          if (algorithmId) p.cutting.settings.algorithm = algorithmId;
        }),

      setLockedPlacement: (placement) =>
        commit((p) => {
          const list = p.cutting.settings.locked.filter((l) => l.pieceId !== placement.pieceId);
          list.push(placement);
          p.cutting.settings.locked = list;
        }),

      clearLockedPlacements: () =>
        commit((p) => {
          p.cutting.settings.locked = [];
        }),

      // Переключить блокировку детали: закрепить на текущем месте или снять.
      toggleLockedPlacement: (placement) =>
        commit((p) => {
          const existing = p.cutting.settings.locked.find((l) => l.pieceId === placement.pieceId);
          if (existing) {
            p.cutting.settings.locked = p.cutting.settings.locked.filter((l) => l.pieceId !== placement.pieceId);
          } else {
            p.cutting.settings.locked.push(placement);
          }
        }),

      // Повернуть деталь на 90° (закрепляет её вручную с новым поворотом).
      rotatePlacement: (placement) =>
        commit((p) => {
          const list = p.cutting.settings.locked.filter((l) => l.pieceId !== placement.pieceId);
          list.push({ ...placement, rotation: placement.rotation === 90 ? 0 : 90 });
          p.cutting.settings.locked = list;
        }),

      selectCuttingPiece: (pieceId) => set((s) => void (s.selectedCuttingPieceId = pieceId)),

      // ── Карты раскроя: фиксация, пресеты, качество ───────────────────────
      setPlanLocked: (materialId, locked) =>
        commit((p) => {
          const map = p.cutting.settings.lockedPlans ?? {};
          if (locked) map[String(materialId)] = true;
          else delete map[String(materialId)];
          p.cutting.settings.lockedPlans = map;
          const refreshed = refreshPlanStatuses(p);
          if (refreshed) p.cutting.report = refreshed;
        }),

      unlockAllPlans: () =>
        commit((p) => {
          p.cutting.settings.lockedPlans = {};
          const refreshed = refreshPlanStatuses(p);
          if (refreshed) p.cutting.report = refreshed;
        }),

      applyCuttingPreset: (presetId) => {
        const preset = findPreset(get().project.cutting.settings, presetId);
        if (!preset) return false;
        commit((p) => {
          p.cutting.settings = applyPreset(p.cutting.settings, preset);
        });
        return true;
      },

      saveCuttingPreset: (name) => {
        const id = `preset-user-${Date.now().toString(36)}`;
        commit((p) => {
          const preset = presetFromSettings(p.cutting.settings, id, name.trim() || 'Мой пресет');
          p.cutting.settings.presets = [...(p.cutting.settings.presets ?? []), preset];
          p.cutting.settings.activePresetId = id;
        });
        return id;
      },

      removeCuttingPreset: (presetId) =>
        commit((p) => {
          // Встроенные пресеты не удаляются (§83) — они не лежат в проекте.
          p.cutting.settings.presets = (p.cutting.settings.presets ?? []).filter((x) => x.id !== presetId);
          if (p.cutting.settings.activePresetId === presetId) delete p.cutting.settings.activePresetId;
        }),

      setQualityThresholds: (thresholds) => {
        if (!validThresholds(thresholds)) return false;
        commit((p) => {
          p.cutting.settings.qualityThresholds = { ...thresholds };
        });
        return true;
      },

      // ── Библиотека листов ────────────────────────────────────────────────
      addSheetMaterial: (sheet) => {
        const id = newSheetMaterialId();
        commit((p) => void p.sheets.push({ ...sheet, id }));
        return id;
      },
      updateSheetMaterial: (id, patch) =>
        commit((p) => {
          const s = p.sheets.find((x) => x.id === id);
          if (s) Object.assign(s, patch);
        }),
      /* §79: формат, на котором построена активная карта, не удаляется —
       * иначе сохранённый раскрой становится невоспроизводимым. Для вывода
       * из оборота есть архив (§80). */
      removeSheetMaterial: (id) => {
        const guard = canRemoveSheet(get().project, id);
        if (!guard.ok) return guard;
        commit((p) => {
          p.sheets = p.sheets.filter((s) => s.id !== id);
          // Снять выбор формата, ссылавшийся на удалённый лист.
          for (const [mat, sel] of Object.entries(p.cutting.settings.sheetSelection)) {
            if (sel === id) delete p.cutting.settings.sheetSelection[mat];
          }
          for (const [mat, list] of Object.entries(p.cutting.settings.sheetPriority)) {
            p.cutting.settings.sheetPriority[mat] = list.filter((x) => x !== id);
          }
        });
        return { ok: true };
      },

      setSheetArchived: (id, archived) =>
        commit((p) => {
          const sheet = p.sheets.find((x) => x.id === id);
          if (sheet) sheet.archived = archived;
        }),

      // ── Библиотека остатков ──────────────────────────────────────────────
      saveRemnant: (remnant) => {
        const id = newStoredRemnantId();
        commit((p) => void p.remnants.push({ status: 'AVAILABLE', ...remnant, id, createdAt: new Date().toISOString() }));
        return id;
      },
      // Сохранить все «полезные» остатки текущего результата раскроя в библиотеку.
      saveUsableRemnantsFromResult: () => {
        const project = get().project;
        const report = project.cutting.report;
        if (!report) return 0;
        const thicknessByMat = new Map(project.materials.map((m) => [m.id, m.thickness]));
        const grainByMat = new Map(project.materials.map((m) => [m.id, m.grain]));
        const toAdd: StoredRemnant[] = [];
        for (const job of report.jobs) {
          for (const sheet of job.sheets) {
            for (const r of sheet.remnants) {
              if (!r.usable) continue;
              toAdd.push({
                id: newStoredRemnantId(),
                materialId: r.materialId,
                thickness: thicknessByMat.get(r.materialId) ?? 0,
                width: r.width,
                height: r.height,
                grainDirection: grainByMat.get(r.materialId) ?? 'none',
                sourceSheetId: r.sheetId,
                createdAt: new Date().toISOString(),
                status: 'AVAILABLE',
              });
            }
          }
        }
        if (toAdd.length > 0) commit((p) => void p.remnants.push(...toAdd));
        return toAdd.length;
      },
      removeRemnant: (id) => commit((p) => void (p.remnants = p.remnants.filter((r) => r.id !== id))),
      /* Архивация вместо удаления (§91): остаток исчезает из подбора, но
       * история раскроя, из которого он получен, остаётся прослеживаемой. */
      setRemnantStatus: (id, status) =>
        commit((p) => {
          const remnant = p.remnants.find((r) => r.id === id);
          if (remnant) remnant.status = status;
        }),
      clearRemnants: () => commit((p) => void (p.remnants = [])),

      selectPart: (id) =>
        set((state) => {
          state.selectedPartId = id;
          if (id) {
            const furniture = findFurnitureOfPart(state.project, id);
            if (furniture) state.activeFurnitureId = furniture.id;
          }
        }),

      undo: () => {
        const cur = get().project;
        if (get().past.length === 0) return;
        set((state) => {
          const prev = state.past.pop()!;
          state.future.unshift(cur);
          state.project = prev;
          if (state.selectedPartId && !findPart(prev, state.selectedPartId)) {
            state.selectedPartId = null;
          }
        });
      },

      redo: () => {
        const cur = get().project;
        if (get().future.length === 0) return;
        set((state) => {
          const next = state.future.shift()!;
          state.past.push(cur);
          state.project = next;
          if (state.selectedPartId && !findPart(next, state.selectedPartId)) {
            state.selectedPartId = null;
          }
        });
      },

      canUndo: () => get().past.length > 0,
      canRedo: () => get().future.length > 0,
    };
  }),
);
