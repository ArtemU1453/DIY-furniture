/**
 * Конструктивные пресеты корпуса (§86–§89).
 *
 * Пресет — это НАБОР ПАРАМЕТРОВ, а не отдельная модель мебели: применение
 * пресета даёт обычный CabinetModel, который дальше живёт по общим правилам.
 * Пользовательские пресеты хранятся в самом проекте (§88) — ни сервера, ни
 * облака, ни регистрации для этого не нужно.
 *
 * БЕЗОПАСНОСТЬ (§89): импортируемый JSON — данные, а не код. Он разбирается
 * JSON.parse и полем за полем переносится в типизированную структуру; ничего
 * не вычисляется и не выполняется.
 */
import type { Project } from '@/core/model/types';
import type { CabinetType, ParametricModel } from '@/core/parametric/types';
import { createParametricModel } from '@/core/parametric/types';
import { toCabinetModel, type CabinetModel } from './model';

export const CABINET_PRESET_FORMAT = 'karkas-cabinet-presets';
export const CABINET_PRESET_VERSION = 1;

export interface CabinetPreset {
  id: string;
  name: string;
  description?: string;
  type: CabinetType;
  /** Параметры, которые пресет задаёт поверх типовых. */
  patch: Partial<ParametricModel>;
  builtIn?: boolean;
}

/** Ключ, под которым пользовательские пресеты живут в проекте (§88). */
export const CABINET_PRESETS_KEY = 'cabinetPresets';

/** Встроенные пресеты (§86). */
export const BUILT_IN_CABINET_PRESETS: CabinetPreset[] = [
  {
    id: 'cab-standard',
    name: 'Стандартный корпус',
    description: 'Боковины, верх, низ, задняя стенка и полки. Без фасадов.',
    type: 'CABINET',
    builtIn: true,
    patch: {
      width: 800, height: 2000, depth: 600, thickness: 16,
      construction: 'BETWEEN_SIDES',
      shelves: { count: 3, distribution: 'AUTO_EQUAL', spacing: 0, startOffset: 0, endOffset: 0, fixedShelves: [], depthReduction: 20, mode: 'ADJUSTABLE' },
      backPanel: { type: 'INSET', thickness: 3, offset: 0, material: null },
    },
  },
  {
    id: 'cab-doors',
    name: 'Шкаф с дверями',
    description: 'Корпус с полками и двумя распашными фасадами на петлях.',
    type: 'CABINET',
    builtIn: true,
    patch: {
      width: 800, height: 2000, depth: 600, thickness: 16,
      shelves: { count: 4, distribution: 'AUTO_EQUAL', spacing: 0, startOffset: 0, endOffset: 0, fixedShelves: [], depthReduction: 20, mode: 'ADJUSTABLE' },
      doors: {
        count: 2,
        gaps: { topGap: 2, bottomGap: 2, leftGap: 2, rightGap: 2, betweenGap: 3 },
        opening: 'double', handleEnabled: true, material: null,
        overlay: 'FULL', kind: 'double',
      },
      backPanel: { type: 'GROOVE', thickness: 4, offset: 0, material: null, grooveDepth: 8, grooveOffset: 10 },
    },
  },
  {
    id: 'cab-drawers',
    name: 'Шкаф с ящиками',
    description: 'Тумба с тремя ящиками на направляющих и ручками.',
    type: 'BASE_UNIT',
    builtIn: true,
    patch: {
      width: 800, height: 820, depth: 560, thickness: 16,
      shelves: { count: 0, distribution: 'AUTO_EQUAL', spacing: 0, startOffset: 0, endOffset: 0, fixedShelves: [], depthReduction: 20 },
      doors: {
        count: 0,
        gaps: { topGap: 2, bottomGap: 2, leftGap: 2, rightGap: 2, betweenGap: 3 },
        opening: 'double', handleEnabled: true, material: null,
      },
      drawers: { count: 3, frontHeight: 0, gap: 3, distribution: 'AUTO_EQUAL' },
      legs: { enabled: true, height: 100, insetX: 50, insetY: 50, count: 4, placement: 'CORNERS' },
      backPanel: { type: 'INSET', thickness: 3, offset: 0, material: null },
    },
  },
  {
    id: 'cab-shelving',
    name: 'Стеллаж',
    description: 'Открытый стеллаж: боковины, верх, низ и полки без задней стенки.',
    type: 'SHELF_UNIT',
    builtIn: true,
    patch: {
      width: 900, height: 1800, depth: 350, thickness: 18,
      shelves: { count: 4, distribution: 'AUTO_EQUAL', spacing: 0, startOffset: 0, endOffset: 0, fixedShelves: [], depthReduction: 0, mode: 'FIXED' },
      backPanel: { type: 'NONE', thickness: 3, offset: 0, material: null },
      doors: {
        count: 0,
        gaps: { topGap: 2, bottomGap: 2, leftGap: 2, rightGap: 2, betweenGap: 3 },
        opening: 'double', handleEnabled: false, material: null,
      },
    },
  },
];

/** Пользовательские пресеты проекта (§87/§88). */
export function customCabinetPresets(project: Project): CabinetPreset[] {
  const raw = project.metadata?.[CABINET_PRESETS_KEY];
  return Array.isArray(raw) ? (raw as CabinetPreset[]) : [];
}

export function allCabinetPresets(project: Project): CabinetPreset[] {
  return [...BUILT_IN_CABINET_PRESETS, ...customCabinetPresets(project)];
}

export function findCabinetPreset(project: Project, id: string): CabinetPreset | undefined {
  return allCabinetPresets(project).find((p) => p.id === id);
}

/** Собрать модель по пресету (§91). */
export function modelFromPreset(preset: CabinetPreset, patch: Partial<ParametricModel> = {}): CabinetModel {
  return toCabinetModel(createParametricModel({
    cabinetType: preset.type,
    ...preset.patch,
    ...patch,
  }));
}

/** Сохранить текущую модель как новый пресет (§87). */
export function presetFromModel(model: ParametricModel, name: string, id?: string): CabinetPreset {
  const m = toCabinetModel(model);
  return {
    id: id ?? `cab-custom-${Date.now().toString(36)}`,
    name,
    type: m.cabinetType,
    patch: {
      kind: m.kind,
      width: m.width, height: m.height, depth: m.depth, thickness: m.thickness,
      construction: m.construction,
      shelves: m.shelves,
      partitions: m.partitions,
      doors: m.doors,
      drawers: m.drawers,
      backPanel: m.backPanel,
      legs: m.legs,
      plinth: m.plinth,
      edge: m.edge,
      jointType: m.jointType,
    },
  };
}

// ── Импорт и экспорт (§89) ───────────────────────────────────────────────────

export interface CabinetPresetFile {
  format: typeof CABINET_PRESET_FORMAT;
  version: number;
  exportedAt: string;
  presets: CabinetPreset[];
}

export function exportCabinetPresets(presets: CabinetPreset[]): string {
  const file: CabinetPresetFile = {
    format: CABINET_PRESET_FORMAT,
    version: CABINET_PRESET_VERSION,
    exportedAt: new Date().toISOString(),
    presets: presets.map((p) => ({ ...p, builtIn: undefined })),
  };
  return JSON.stringify(file, null, 2);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface CabinetPresetImport {
  ok: boolean;
  presets: CabinetPreset[];
  errors: string[];
}

/** Разобрать один пресет. Непригодная запись отбрасывается, а не ломает файл. */
export function readCabinetPreset(raw: unknown): CabinetPreset | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : null;
  if (!name) return null;
  const patch = isRecord(raw.patch) ? (raw.patch as Partial<ParametricModel>) : {};
  const type = typeof raw.type === 'string' ? (raw.type as CabinetType) : 'CABINET';
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `cab-import-${Math.random().toString(36).slice(2, 8)}`,
    name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    type,
    patch,
  };
}

export function importCabinetPresets(json: string): CabinetPresetImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, presets: [], errors: ['Файл повреждён: это не JSON.'] };
  }
  if (!isRecord(parsed) || parsed.format !== CABINET_PRESET_FORMAT) {
    return { ok: false, presets: [], errors: ['Это не файл пресетов корпуса Karkas.'] };
  }
  const list = Array.isArray(parsed.presets) ? parsed.presets : [];
  const presets: CabinetPreset[] = [];
  const errors: string[] = [];
  for (const item of list) {
    const preset = readCabinetPreset(item);
    if (preset) presets.push(preset);
    else errors.push('Пропущена запись без названия.');
  }
  return { ok: presets.length > 0, presets, errors };
}
