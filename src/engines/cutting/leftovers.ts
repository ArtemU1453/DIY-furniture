/**
 * Остатки листа (§37–§46, §100).
 *
 * Прямоугольники остатков считает раскрой (CuttingRemnant в результате листа);
 * здесь они получают ПРОИЗВОДСТВЕННЫЙ смысл: годен ли остаток к повторному
 * использованию, оприходован ли он на склад, зарезервирован ли под задание.
 * Второй геометрии не появляется — LeftoverSheet ссылается на исходный лист.
 */
import type {
  CuttingRemnant,
  CuttingResult,
  GrainDirection,
  LeftoverSheet,
  LeftoverStatus,
  Material,
  Project,
  StoredRemnant,
  UsableRemnantCriteria,
} from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';
import { isUsableRemnant } from './remnants';

/** Минимальные размеры полезного остатка (§41). */
export interface LeftoverLimits {
  minimumUsableWidth: number;
  minimumUsableHeight: number;
  minimumUsableArea: number;
}

export const DEFAULT_LEFTOVER_LIMITS: LeftoverLimits = {
  minimumUsableWidth: 100,
  minimumUsableHeight: 100,
  minimumUsableArea: 40_000,
};

/** Критерии проекта в виде минимальных размеров (§41). */
export function limitsOf(criteria: UsableRemnantCriteria | undefined): LeftoverLimits {
  if (!criteria) return { ...DEFAULT_LEFTOVER_LIMITS };
  return {
    minimumUsableWidth: criteria.minWidth,
    minimumUsableHeight: criteria.minLength,
    minimumUsableArea: criteria.minArea,
  };
}

function criteriaOf(limits: LeftoverLimits): UsableRemnantCriteria {
  return {
    minWidth: limits.minimumUsableWidth,
    minLength: limits.minimumUsableHeight,
    minArea: limits.minimumUsableArea,
  };
}

/** Годен ли остаток по минимальным размерам (§40/§41). */
export function classifyLeftover(
  width: number,
  height: number,
  limits: LeftoverLimits = DEFAULT_LEFTOVER_LIMITS,
): LeftoverStatus {
  return isUsableRemnant(width, height, criteriaOf(limits)) ? 'USABLE' : 'TOO_SMALL';
}

/**
 * Остатки результата раскроя (§37). Толщина и текстура берутся у материала:
 * остаток наследует свойства листа, из которого вырезан.
 */
export function leftoversOfResult(
  result: CuttingResult,
  material: Material | undefined,
  limits: LeftoverLimits = DEFAULT_LEFTOVER_LIMITS,
): LeftoverSheet[] {
  const out: LeftoverSheet[] = [];
  for (const sheet of result.sheets) {
    for (const remnant of sheet.remnants) {
      out.push(leftoverOf(remnant, sheet.id, material, limits));
    }
  }
  return out;
}

export function leftoverOf(
  remnant: CuttingRemnant,
  sheetId: string,
  material: Material | undefined,
  limits: LeftoverLimits = DEFAULT_LEFTOVER_LIMITS,
): LeftoverSheet {
  return {
    id: remnant.id,
    width: remnant.width,
    height: remnant.height,
    thickness: material?.thickness ?? 0,
    materialId: remnant.materialId,
    sourceSheetId: sheetId,
    grainDirection: material?.grain ?? 'none',
    status: classifyLeftover(remnant.width, remnant.height, limits),
    stockSheetId: remnant.stockSheetId,
    area: remnant.area,
  };
}

/** Остатки всего проекта (§37/§111). */
export function projectLeftovers(
  project: Project,
  limits: LeftoverLimits = DEFAULT_LEFTOVER_LIMITS,
): LeftoverSheet[] {
  const materials = new Map(project.materials.map((m) => [String(m.id), m]));
  return (project.cutting.report?.jobs ?? []).flatMap((result) =>
    leftoversOfResult(result, materials.get(String(result.materialId)), limits));
}

// ── Склад остатков (§42) ─────────────────────────────────────────────────────

/** Остаток раскроя → складская запись (§42). */
export function toStoredRemnant(
  leftover: LeftoverSheet,
  options: { note?: string; stockSheetId?: string } = {},
): StoredRemnant {
  return {
    id: leftover.id,
    materialId: leftover.materialId,
    thickness: leftover.thickness,
    width: leftover.width,
    height: leftover.height,
    grainDirection: leftover.grainDirection,
    sourceSheetId: leftover.sourceSheetId,
    createdAt: new Date().toISOString(),
    status: 'AVAILABLE',
    stockSheetId: options.stockSheetId ?? leftover.stockSheetId,
    note: options.note,
  };
}

/** Складская запись → остаток с вычисленным состоянием (§40). */
export function fromStoredRemnant(
  stored: StoredRemnant,
  limits: LeftoverLimits = DEFAULT_LEFTOVER_LIMITS,
): LeftoverSheet {
  const stockStatus = stored.status ?? 'AVAILABLE';
  const status: LeftoverStatus = stockStatus === 'USED'
    ? 'USED'
    : stockStatus === 'RESERVED'
      ? 'RESERVED'
      : classifyLeftover(stored.width, stored.height, limits);
  return {
    id: stored.id,
    width: stored.width,
    height: stored.height,
    thickness: stored.thickness,
    materialId: stored.materialId,
    sourceSheetId: stored.sourceSheetId,
    grainDirection: stored.grainDirection,
    status,
    stockSheetId: stored.stockSheetId,
    area: stored.width * stored.height,
  };
}

/** Оприходовать полезные остатки результата на склад (§42). */
export function harvestLeftovers(
  result: CuttingResult,
  material: Material | undefined,
  existing: StoredRemnant[],
  limits: LeftoverLimits = DEFAULT_LEFTOVER_LIMITS,
): StoredRemnant[] {
  const known = new Set(existing.map((r) => r.id));
  const fresh = leftoversOfResult(result, material, limits)
    .filter((l) => l.status === 'USABLE' && !known.has(l.id))
    .map((l) => toStoredRemnant(l));
  return [...existing, ...fresh];
}

// ── Повторное использование (§43–§46) ────────────────────────────────────────

export interface LeftoverMatchRequest {
  materialId: MaterialId;
  thickness: number;
  /** Требуемый габарит детали, мм. */
  width: number;
  height: number;
  /** Учитывать направление текстуры (§46). */
  respectGrain?: boolean;
  grainDirection?: GrainDirection;
}

/** Помещается ли деталь в остаток с учётом текстуры (§46). */
export function fitsLeftover(leftover: LeftoverSheet, request: LeftoverMatchRequest): boolean {
  if (String(leftover.materialId) !== String(request.materialId)) return false; // §45
  if (Math.abs(leftover.thickness - request.thickness) > 1e-6) return false; // §45
  if (leftover.status !== 'USABLE') return false;

  const fitsDirect = request.width <= leftover.width && request.height <= leftover.height;
  // Поворот на 90° допустим, только если текстура его не запрещает (§18/§46).
  const grainLocks = request.respectGrain === true
    && leftover.grainDirection !== 'none'
    && request.grainDirection !== undefined
    && request.grainDirection !== 'none';
  const fitsRotated = !grainLocks
    && request.height <= leftover.width && request.width <= leftover.height;
  return fitsDirect || fitsRotated;
}

/**
 * Подобрать остаток под деталь (§43/§44).
 *
 * Побеждает САМЫЙ ТЕСНЫЙ подходящий остаток: крупные листы остаются целыми и
 * пригодятся для больших деталей. При равной площади — стабильный порядок по id.
 */
export function pickLeftover(
  leftovers: LeftoverSheet[],
  request: LeftoverMatchRequest,
): LeftoverSheet | undefined {
  return leftovers
    .filter((l) => fitsLeftover(l, request))
    .sort((a, b) => a.area - b.area || a.id.localeCompare(b.id))[0];
}

/**
 * Порядок источников листа (§44): сначала подходящие остатки (от тесного к
 * просторному), затем новые листы. Возвращаются идентификаторы источников.
 */
export function reuseOrder(leftovers: LeftoverSheet[], request: LeftoverMatchRequest): string[] {
  return leftovers
    .filter((l) => fitsLeftover(l, request))
    .sort((a, b) => a.area - b.area || a.id.localeCompare(b.id))
    .map((l) => l.id);
}

/** Сводка по остаткам (§111). */
export interface LeftoverSummary {
  total: number;
  usable: number;
  tooSmall: number;
  reserved: number;
  used: number;
  usableAreaM2: number;
}

export function leftoverSummary(leftovers: LeftoverSheet[]): LeftoverSummary {
  const usable = leftovers.filter((l) => l.status === 'USABLE');
  return {
    total: leftovers.length,
    usable: usable.length,
    tooSmall: leftovers.filter((l) => l.status === 'TOO_SMALL').length,
    reserved: leftovers.filter((l) => l.status === 'RESERVED').length,
    used: leftovers.filter((l) => l.status === 'USED').length,
    usableAreaM2: Math.round((usable.reduce((sum, l) => sum + l.area, 0) / 1_000_000) * 100) / 100,
  };
}
