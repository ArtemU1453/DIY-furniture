/**
 * Экземпляры деталей в раскрое (§78–§82).
 *
 * Деталь с quantity = 3 раскладывается тремя экземплярами, но PartModel
 * остаётся ОДИН (§5/§81). Экземпляр — это пара (partId, instanceIndex);
 * идентификатор экземпляра `<partId>#<n>` уже используется движком как
 * pieceId, поэтому здесь он только разбирается и форматируется — второй
 * системы деталей не заводится.
 */
import type { CuttingInstance, Placement } from '@/core/model/types';
import type { PartId } from '@/core/model/ids';

/** Идентификатор экземпляра из детали и номера. */
export function instanceId(partId: PartId | string, instanceIndex: number): string {
  return `${partId}#${instanceIndex}`;
}

/** Разобрать pieceId обратно в экземпляр. */
export function parseInstance(pieceId: string): CuttingInstance | null {
  const at = pieceId.lastIndexOf('#');
  if (at <= 0) return null;
  const index = Number(pieceId.slice(at + 1));
  if (!Number.isInteger(index) || index < 1) return null;
  return { id: pieceId, partId: pieceId.slice(0, at) as PartId, instanceIndex: index };
}

/**
 * Метка экземпляра для карты раскроя (§79): P001-3.
 *
 * Если деталь единственная в своём роде, номер экземпляра не добавляется —
 * «P001-1» на карте из одной детали только зашумляет чертёж.
 */
export function instanceLabel(number: string, instanceIndex: number, totalInstances = 1): string {
  if (totalInstances <= 1) return number;
  return `${number}-${instanceIndex}`;
}

/** Сколько экземпляров у каждой детали в наборе размещений. */
export function instanceCounts(placements: Placement[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of placements) {
    const key = String(p.partId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Метка размещения с учётом того, сколько экземпляров у его детали. */
export function placementLabel(placement: Placement, counts: Map<string, number>): string {
  const parsed = parseInstance(placement.pieceId);
  const total = counts.get(String(placement.partId)) ?? 1;
  if (!parsed) return placement.number;
  return instanceLabel(placement.number, parsed.instanceIndex, total);
}

/** Все экземпляры набора размещений (§80). */
export function instancesOf(placements: Placement[]): CuttingInstance[] {
  const out: CuttingInstance[] = [];
  for (const p of placements) {
    const parsed = parseInstance(p.pieceId);
    if (parsed) out.push(parsed);
  }
  return out;
}
