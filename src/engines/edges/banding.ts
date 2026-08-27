/**
 * EdgeBanding — кромка стороны детали (§2).
 *
 * Величина ПРОИЗВОДНАЯ: вычисляется из Part.edges и библиотеки кромки при
 * каждом обращении. Поэтому изменение размера детали сразу меняет длину
 * кромки (§18/§19), а второй системы деталей не появляется (§6/§7): всё
 * держится на существующем PartModel.
 */
import type {
  EdgeBanding,
  EdgeMaterial,
  EdgeSide,
  EdgeSource,
  EdgeStatus,
  Part,
  Project,
} from '@/core/model/types';
import { EDGE_SIDES } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { sideDirection, sideLength } from './sides';

/** Стабильный id кромки: деталь + сторона. */
export function edgeBandingId(partId: string, side: EdgeSide): string {
  return `${partId}:${side}`;
}

/** Ширина ленты по умолчанию, если в библиотеке она не указана. */
export const DEFAULT_EDGE_WIDTH = 23;

/** Источник кромки стороны (§4). Без пометки сторона считается расчётной. */
export function edgeSourceOf(part: Part, side: EdgeSide): EdgeSource {
  return part.edgeSources?.[side] ?? 'PARAMETRIC';
}

/**
 * Кромка одной стороны детали. Возвращает null, если сторона не облицована.
 *
 * Статус отражает пригодность к производству (§5/§43/§44): пропавший из
 * библиотеки материал — WARNING (деталь ещё можно закромить, выбрав замену),
 * бессмысленные размеры — ERROR.
 */
export function edgeBandingForSide(
  project: Project,
  part: Part,
  side: EdgeSide,
): EdgeBanding | null {
  return edgeBandingWith(project.edges, part, side);
}

/**
 * То же самое, но от списка кромочных материалов, а не от всего проекта.
 * Нужно там, где Project недоступен (например в спецификации), чтобы расчёт
 * длины оставался ОДИН на всю программу и цифры в документах не расходились.
 */
export function edgeBandingWith(
  edges: EdgeMaterial[],
  part: Part,
  side: EdgeSide,
): EdgeBanding | null {
  const override = part.edgeOverrides?.[side];
  const materialId = override?.materialId !== undefined ? override.materialId : part.edges[side];
  if (!materialId) return null;

  const material: EdgeMaterial | undefined = edges.find((e) => e.id === materialId);
  const thickness = override?.thickness ?? material?.thickness ?? 0;
  const width = override?.width ?? material?.width ?? DEFAULT_EDGE_WIDTH;
  const length = sideLength(part, side);

  let status: EdgeStatus = 'VALID';
  let issue: string | undefined;
  if (!material) {
    // §44: материала больше нет в библиотеке — деталь остаётся, но требует внимания.
    status = 'WARNING';
    issue = 'Материал кромки отсутствует в библиотеке проекта.';
  } else if (thickness <= 0 || width <= 0 || length <= 0) {
    status = 'ERROR';
    issue = 'Некорректные параметры кромки: толщина, ширина и длина должны быть больше нуля.';
  }

  return {
    id: edgeBandingId(String(part.id), side),
    partId: part.id,
    side,
    materialId,
    thickness,
    width,
    length,
    quantity: part.quantity,
    direction: sideDirection(part, side),
    status,
    source: edgeSourceOf(part, side),
    override: override !== undefined,
    issue,
  };
}

/** Все кромки одной детали. */
export function edgeBandingForPart(project: Project, part: Part): EdgeBanding[] {
  return edgeBandingForPartWith(project.edges, part);
}

/** Кромки детали от списка материалов (без Project). */
export function edgeBandingForPartWith(edges: EdgeMaterial[], part: Part): EdgeBanding[] {
  const out: EdgeBanding[] = [];
  for (const side of EDGE_SIDES) {
    const banding = edgeBandingWith(edges, part, side);
    if (banding) out.push(banding);
  }
  return out;
}

/** Все кромки проекта (§30). */
export function allEdgeBanding(project: Project): EdgeBanding[] {
  return allParts(project).flatMap((part) => edgeBandingForPart(project, part));
}

/**
 * Полная длина кромки записи с учётом количества деталей (§42).
 * Расчётная величина — без припуска и без округления под закупку (§34/§72).
 */
export function bandingTotalLength(banding: EdgeBanding): number {
  return banding.length * banding.quantity;
}

/** Сколько сторон детали облицовано (§64). */
export function edgeCount(project: Project, part: Part): number {
  return edgeBandingForPart(project, part).length;
}
