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
import { newHardwareConnectionId, newMachiningId, newPartId } from '@/core/model/ids';
import type {
  CuttingReport,
  CuttingSettings,
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
} from '@/core/model/types';
import { newSheetMaterialId, newStoredRemnantId } from '@/core/model/ids';
import { runCuttingInWorker, type CuttingHandle } from '@/workers/cuttingClient';
import type { CuttingProgress } from '@/engines/cutting';
import { documentsSignature, nextDocVersion } from '@/engines/drawing';
import { runProductionCheck } from '@/engines/status';
import type { ProjectIssue } from '@/engines/status';
import { inferJointType, categoryOfConnectionType } from '@/engines/machining';
import { hardwareFromTemplate, type HardwareTemplate, catalogByCategory } from '@/core/model/hardwareCatalog';
import {
  instantiateTemplate,
  planCabinetConnections,
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

  // ── Проект ────────────────────────────────────────────────────────────────
  newProject: (name?: string) => void;
  /** Загрузить готовый проект (из хранилища/импорта). Сбрасывает историю. */
  loadProject: (project: Project) => void;
  setProjectName: (name: string) => void;
  updateSettings: (patch: Partial<ProjectSettings>) => void;

  // ── Изделия ────────────────────────────────────────────────────────────────
  addFurniture: (name?: string) => void;
  removeFurniture: (id: Furniture['id']) => void;
  setActiveFurniture: (id: FurnitureId | null) => void;

  // ── Параметрический шкаф ────────────────────────────────────────────────────
  createCabinet: (name?: string) => FurnitureId;
  updateCabinetParams: (id: FurnitureId, patch: Partial<CabinetParameters>) => void;

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
  /** Ручная правка автоматической операции (MANUAL OVERRIDE, §41/§42). */
  setOperationOverride: (id: MachiningId, patch: MachiningOverride) => void;
  /** «Сбросить правило» — удалить ручную правку, операция снова из правила (§43). */
  resetOperationToRule: (id: MachiningId) => void;
  /** Сменить способ соединения (CONFIRMAT/DOWEL/…) — подбирает крепёж (§65/§66). */
  setConnectionType: (id: HardwareConnectionId, type: ConnectionType) => void;
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
  // Библиотека листов.
  addSheetMaterial: (sheet: Omit<SheetMaterial, 'id'>) => string;
  updateSheetMaterial: (id: string, patch: Partial<SheetMaterial>) => void;
  removeSheetMaterial: (id: string) => void;
  // Библиотека остатков.
  saveRemnant: (remnant: Omit<StoredRemnant, 'id' | 'createdAt'>) => string;
  saveUsableRemnantsFromResult: () => number;
  removeRemnant: (id: string) => void;
  clearRemnants: () => void;

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

    /** Применить изменение модели с записью в историю. */
    const commit = (recipe: (project: Project) => void) => {
      const prev = get().project; // финализированный неизменяемый снимок
      set((state) => {
        state.past.push(prev);
        if (state.past.length > HISTORY_LIMIT) state.past.shift();
        state.future = [];
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

      setViewer: (patch) => set((s) => void Object.assign(s.viewer, patch)),
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

      removeFurniture: (id) => {
        commit((p) => {
          p.furnitures = p.furnitures.filter((f) => f.id !== id);
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

        // Резолвим фурнитуру по категориям и планируем соединения.
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
        const keyToPart = new Map<string, PartId>();
        for (const part of built.parts) {
          const k = part.metadata?.key as string | undefined;
          if (k) keyToPart.set(k, part.id);
        }
        const connections: HardwareConnection[] = [];
        for (const plan of planCabinetConnections(built.parts, params)) {
          const hwId = resolveHardware(plan.category);
          const aId = keyToPart.get(plan.aKey);
          const bId = keyToPart.get(plan.bKey);
          if (!hwId || !aId || !bId) continue;
          const a = built.parts.find((x) => x.id === aId)!;
          const b = built.parts.find((x) => x.id === bId)!;
          connections.push({
            id: newHardwareConnectionId(),
            hardwareId: hwId,
            partAId: aId,
            partBId: bId,
            jointType: inferJointType(a, b),
            quantity: plan.quantity,
            parameters: { gen: 'template' },
          });
        }

        commit((p) => {
          for (const hw of newHardware) p.hardware.push(hw);
          p.furnitures.push(furniture);
          for (const c of connections) p.hardwareConnections.push(c);
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
          const partIds = new Set(built.parts.map((x) => x.id));
          p.hardwareConnections = p.hardwareConnections.filter((c) => {
            const isTemplateGen = (c.parameters as Record<string, unknown> | undefined)?.gen === 'template';
            const belongs = partIds.has(c.partAId) || partIds.has(c.partBId);
            return !(isTemplateGen && belongs);
          });
          const keyToPart = new Map<string, PartId>();
          for (const part of built.parts) {
            const k = part.metadata?.key as string | undefined;
            if (k) keyToPart.set(k, part.id);
          }
          const resolveHardware = (category: HardwareCategory): HardwareId | null => {
            const existingHw = p.hardware.find((h) => h.category === category);
            if (existingHw) return existingHw.id;
            const tpl = catalogByCategory(category)[0];
            if (!tpl) return null;
            const hw = hardwareFromTemplate(tpl);
            p.hardware.push(hw);
            return hw.id;
          };
          for (const plan of planCabinetConnections(built.parts, params)) {
            const hwId = resolveHardware(plan.category);
            const aId = keyToPart.get(plan.aKey);
            const bId = keyToPart.get(plan.bKey);
            if (!hwId || !aId || !bId) continue;
            const a = built.parts.find((x) => x.id === aId)!;
            const b = built.parts.find((x) => x.id === bId)!;
            p.hardwareConnections.push({
              id: newHardwareConnectionId(),
              hardwareId: hwId, partAId: aId, partBId: bId,
              jointType: inferJointType(a, b), quantity: plan.quantity,
              parameters: { gen: 'template' },
            });
          }
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

      addHardware: (hardware) => commit((p) => void p.hardware.push(hardware)),

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
            s.project.cutting.report = report;
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
          p.cutting.report = report;
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
      removeSheetMaterial: (id) =>
        commit((p) => {
          p.sheets = p.sheets.filter((s) => s.id !== id);
          // Снять выбор формата, ссылавшийся на удалённый лист.
          for (const [mat, sel] of Object.entries(p.cutting.settings.sheetSelection)) {
            if (sel === id) delete p.cutting.settings.sheetSelection[mat];
          }
        }),

      // ── Библиотека остатков ──────────────────────────────────────────────
      saveRemnant: (remnant) => {
        const id = newStoredRemnantId();
        commit((p) => void p.remnants.push({ ...remnant, id, createdAt: new Date().toISOString() }));
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
              });
            }
          }
        }
        if (toAdd.length > 0) commit((p) => void p.remnants.push(...toAdd));
        return toAdd.length;
      },
      removeRemnant: (id) => commit((p) => void (p.remnants = p.remnants.filter((r) => r.id !== id))),
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
