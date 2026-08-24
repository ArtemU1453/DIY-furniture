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
} from '@/core/model/types';
import { runCuttingInWorker, type CuttingHandle } from '@/workers/cuttingClient';
import type { CuttingProgress } from '@/engines/cutting';
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
    parameters?: HardwareConnection['parameters'];
  }) => CreateConnectionResult;
  removeConnection: (id: HardwareConnectionId) => void;
  selectConnection: (id: HardwareConnectionId | null) => void;

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
  selectCuttingPiece: (pieceId: string | null) => void;

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
        const issues = validateConnection(input, get().project);
        if (issues.length > 0) {
          return { ok: false, message: issues[0].message };
        }
        const connection: HardwareConnection = {
          id: newHardwareConnectionId(),
          hardwareId: input.hardwareId,
          partAId: input.partAId,
          partBId: input.partBId,
          parameters: input.parameters,
        };
        commit((p) => void p.hardwareConnections.push(connection));
        return { ok: true, id: connection.id };
      },

      removeConnection: (id) => {
        commit((p) => void (p.hardwareConnections = p.hardwareConnections.filter((c) => c.id !== id)));
        if (get().selectedConnectionId === id) set((s) => void (s.selectedConnectionId = null));
      },

      selectConnection: (id) => set((s) => void (s.selectedConnectionId = id)),

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

      selectCuttingPiece: (pieceId) => set((s) => void (s.selectedCuttingPieceId = pieceId)),

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
