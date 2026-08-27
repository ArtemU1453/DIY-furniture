/**
 * CuttingPreparationService — подготовка деталей к раскрою.
 *
 * ВАЖНО: не создаёт новых производственных сущностей. CuttingPart — это ССЫЛКА
 * на Part.id с количеством; десять одинаковых деталей остаются одной Part с
 * quantity = 10. Разворот в экземпляры выполняется только внутри алгоритма.
 *
 *   Part[] → фильтр → группировка → CuttingPart[]
 */
import type { EdgeMaterialId, MaterialId, PartId } from '@/core/model/ids';
import type { GrainDirection, Mm, Part, Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';

export interface CuttingPartEdges {
  left: EdgeMaterialId | null;
  right: EdgeMaterialId | null;
  top: EdgeMaterialId | null;
  bottom: EdgeMaterialId | null;
}

/** Деталь для раскроя: ссылка на Part + производственные свойства. */
export interface CuttingPart {
  partId: PartId;
  name: string;
  number: string;
  width: Mm;
  height: Mm;
  materialId: MaterialId;
  thickness: Mm;
  quantity: number;
  grainDirection: GrainDirection;
  edgeData: CuttingPartEdges;
  rotationAllowed: boolean;
  /** Ключ группировки (материал+толщина+размер+текстура+кромка+поворот). */
  groupKey: string;
}

const planeDims = (p: Part) => ({
  length: Math.max(p.width, p.height),
  width: Math.min(p.width, p.height),
});

/**
 * Разрешён ли поворот детали на 90°. Запрещён, если материал не допускает
 * поворот ИЛИ у детали задано направление текстуры при respectGrain.
 */
export function isRotationAllowed(part: Part, materialAllowsRotate: boolean, respectGrain: boolean): boolean {
  if (!materialAllowsRotate) return false;
  if (respectGrain && part.grain !== 'none') return false;
  return true;
}

/** Подходит ли деталь для листового раскроя. */
function needsCutting(part: Part): boolean {
  if (part.metadata?.hidden === true) return false;
  if (!part.material) return false;
  return part.width > 0 && part.height > 0 && part.quantity > 0;
}

/**
 * Подготовить детали к раскрою: отфильтровать, вычислить свойства и
 * сгруппировать одинаковые (количество суммируется).
 */
export function prepareCuttingParts(project: Project): CuttingPart[] {
  const materials = new Map(project.materials.map((m) => [m.id, m]));
  const respectGrain = project.cutting.settings.respectGrain;
  const groups = new Map<string, CuttingPart>();

  for (const part of allParts(project)) {
    if (!needsCutting(part)) continue;
    const material = materials.get(part.material!);
    if (!material) continue;

    const d = planeDims(part);
    const rotationAllowed = isRotationAllowed(part, material.allowRotate, respectGrain);
    const edgeData: CuttingPartEdges = { ...part.edges };
    const edgeSig = `${edgeData.left}|${edgeData.right}|${edgeData.top}|${edgeData.bottom}`;
    // Критерии группировки: материал, толщина, размеры, текстура, поворот, кромка.
    const groupKey = [
      part.material, part.thickness, d.length, d.width,
      part.grain, rotationAllowed, edgeSig, part.name,
    ].join('|');

    const existing = groups.get(groupKey);
    if (existing) {
      existing.quantity += part.quantity;
      continue;
    }
    groups.set(groupKey, {
      partId: part.id,
      name: part.name,
      number: (part.metadata?.number as string) ?? '',
      width: d.length,
      height: d.width,
      materialId: part.material!,
      thickness: part.thickness,
      quantity: part.quantity,
      grainDirection: part.grain,
      edgeData,
      rotationAllowed,
      groupKey,
    });
  }

  return [...groups.values()].sort((a, b) => a.number.localeCompare(b.number) || a.groupKey.localeCompare(b.groupKey));
}

/** Группировка подготовленных деталей по материалу+толщине (раскрой раздельный). */
export function groupByMaterialThickness(parts: CuttingPart[]): Map<string, CuttingPart[]> {
  const out = new Map<string, CuttingPart[]>();
  for (const p of parts) {
    const key = `${p.materialId}|${p.thickness}`;
    (out.get(key) ?? out.set(key, []).get(key)!).push(p);
  }
  return out;
}
