/**
 * EdgePreset — готовый набор кромки по сторонам (§14/§51–§55).
 *
 * Пресет применяется к ЯВНО выбранным деталям или к деталям одной роли, и
 * никогда — ко всему проекту разом (§55): пользователь выбрал две детали,
 * значит изменить должно ровно их.
 */
import type { EdgePreset, EdgeSide, Part, PartRole } from '@/core/model/types';
import type { EdgeMaterialId, PartId } from '@/core/model/ids';
import { EDGE_SIDES } from '@/core/model/types';
import { applyEdgeConfiguration, type EdgeSides } from './rules';
import { longSides, shortSides } from './sides';

/**
 * Встроенные пресеты (§14). Материал не зашит: он подставляется при
 * применении, поэтому один пресет работает с любой лентой из библиотеки.
 */
export function builtinPresets(materialId: EdgeMaterialId | null): EdgePreset[] {
  const all = (value: EdgeMaterialId | null): Partial<Record<EdgeSide, EdgeMaterialId | null>> =>
    Object.fromEntries(EDGE_SIDES.map((s) => [s, value]));
  return [
    { id: 'edge-none', name: 'Без кромки', sides: all(null), builtin: true },
    { id: 'edge-front', name: 'Одна сторона (передний торец)', sides: { top: materialId }, builtin: true },
    { id: 'edge-two', name: 'Две стороны (лево + право)', sides: { left: materialId, right: materialId }, builtin: true },
    { id: 'edge-all', name: 'Все стороны', sides: all(materialId), builtin: true },
    { id: 'edge-facade', name: 'Фасад стандарт', sides: all(materialId), role: 'facade', builtin: true },
  ];
}

export function findPreset(presets: EdgePreset[], id: string): EdgePreset | undefined {
  return presets.find((p) => p.id === id);
}

/**
 * Пресет с материалом, подставленным вместо шаблонного. Позволяет применить
 * «Фасад стандарт» с любой лентой, не заводя пресет на каждую ленту.
 */
export function presetWithMaterial(preset: EdgePreset, materialId: EdgeMaterialId | null): EdgePreset {
  const sides: Partial<Record<EdgeSide, EdgeMaterialId | null>> = {};
  for (const [side, value] of Object.entries(preset.sides) as Array<[EdgeSide, EdgeMaterialId | null | undefined]>) {
    if (value === undefined) continue;
    sides[side] = value === null ? null : materialId;
  }
  return { ...preset, sides };
}

/** Результат применения пресета к одной детали. */
export interface PresetApplication {
  partId: PartId;
  edges: EdgeSides;
  sources: Partial<Record<EdgeSide, 'PARAMETRIC' | 'MANUAL'>>;
}

/**
 * Применить пресет к выбранным деталям (§53). Возвращает изменения, а не
 * пишет в модель: запись делает store одной командой, поэтому обновление
 * остаётся атомарным и попадает в undo целиком (§77/§78).
 */
export function applyPresetTo(parts: Part[], preset: EdgePreset): PresetApplication[] {
  return parts.map((part) => {
    const { edges, sources } = applyEdgeConfiguration(part, { sides: preset.sides, overrideManual: true }, 'MANUAL');
    return { partId: part.id, edges, sources };
  });
}

/** Детали заданной роли (§54): «все фасады». */
export function partsOfRole(parts: Part[], role: PartRole): Part[] {
  return parts.filter((p) => p.role === role);
}

/** Пресет из текущей кромки детали — чтобы сохранить удачный набор. */
export function presetFromPart(part: Part, id: string, name: string): EdgePreset {
  return {
    id,
    name,
    sides: {
      top: part.edges.top,
      bottom: part.edges.bottom,
      left: part.edges.left,
      right: part.edges.right,
    },
    role: part.role,
  };
}

/** Пресет «кромить длинные стороны» для конкретной детали (§15/§16). */
export function longSidesPreset(part: Part, materialId: EdgeMaterialId | null): EdgePreset {
  const sides: Partial<Record<EdgeSide, EdgeMaterialId | null>> = {};
  for (const side of EDGE_SIDES) sides[side] = null;
  for (const side of longSides(part)) sides[side] = materialId;
  return { id: 'edge-long', name: 'Длинные стороны', sides };
}

/** Пресет «кромить короткие стороны» (§15/§16). */
export function shortSidesPreset(part: Part, materialId: EdgeMaterialId | null): EdgePreset {
  const sides: Partial<Record<EdgeSide, EdgeMaterialId | null>> = {};
  for (const side of EDGE_SIDES) sides[side] = null;
  for (const side of shortSides(part)) sides[side] = materialId;
  return { id: 'edge-short', name: 'Короткие стороны', sides };
}
