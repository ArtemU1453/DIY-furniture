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
import { inferJointType } from '@/engines/machining';
import { hardwareFromTemplate, type HardwareTemplate } from '@/core/model/hardwareCatalog';
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

  // ── Детали ────────────────────────────────────────────────────────────────
  addPart: (input?: CreatePartInput) => PartId;
  addElement: (kind: 'panel' | 'shelf' | 'divider' | 'facade' | 'back') => PartId;
  removePart: (id: PartId) => void;
  updatePart: (id: PartId, patch: Partial<Part>) => void;
  duplicatePart: (id: PartId) => PartId | null;
  setPartFlag: (id: PartId, patch: { hidden?: boolean; locked?: boolean }) => void;
  renameFurniture: (id: FurnitureId, name: string) => void;

  // ── Сохранение / фокус ──────────────────────────────────────────────────────
  setSaveState: (state: 'saved' | 'unsaved' | 'saving') => void;
  requestFocus: () => void;

  // ── Документы ────────────────────────────────────────────────────────────────
  markDocumentsGenerated: () => void;
  /** Сформировать документы: сначала ProductionCheck; при ERROR не генерирует. */
  generateDocuments: () => { ok: boolean; errors: ProjectIssue[] };
  setDocumentScale: (docKey: string, scale: number | 'AUTO') => void;
  toggleDrawingLayer: (layer: string) => void;

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
  selectOperation: (id: MachiningId | null) => void;

  // ── Раскрой ──────────────────────────────────────────────────────────────
  updateCuttingSettings: (patch: Partial<CuttingSettings>) => void;
  recalculateCutting: () => Promise<void>;
  cancelCutting: () => void;
  setLockedPlacement: (placement: LockedPlacement) => void;
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
          if (!p.documents.settings) p.documents.settings = { scaleOverrides: {}, hidden: {} };
          p.documents.settings.scaleOverrides[docKey] = scale;
        }),

      toggleDrawingLayer: (layer) =>
        commit((p) => {
          if (!p.documents.settings) p.documents.settings = { scaleOverrides: {}, hidden: {} };
          p.documents.settings.hidden[layer] = !p.documents.settings.hidden[layer];
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
