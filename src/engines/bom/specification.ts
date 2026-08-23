/**
 * Спецификация деталировки — вычисляется из деталей (проекция модели).
 * Показываются только реально рассчитанные величины: количество, площадь
 * материала, предварительная длина кромки. Раскрой листов здесь НЕ имитируется.
 */
import type { EdgeMaterial, Material, Part } from '@/core/model/types';
import type { MaterialId, PartId } from '@/core/model/ids';

export interface SpecRow {
  partId: PartId;
  number: string;
  name: string;
  quantity: number;
  length: number; // мм (большая плоскостная сторона)
  width: number; // мм (меньшая плоскостная сторона)
  thickness: number;
  materialId: MaterialId | null;
  materialName: string;
  edgeLeft: string;
  edgeRight: string;
  edgeTop: string;
  edgeBottom: string;
}

export interface SpecTotals {
  partCount: number; // с учётом quantity
  uniqueParts: number;
  materialAreaM2: number;
  edgeLengthM: number; // предварительно
}

export interface Specification {
  rows: SpecRow[];
  totals: SpecTotals;
}

function planeDims(part: Part): { length: number; width: number } {
  const a = part.width;
  const b = part.height;
  return { length: Math.max(a, b), width: Math.min(a, b) };
}

export function buildSpecification(
  parts: Part[],
  materials: Material[],
  edges: EdgeMaterial[] = [],
): Specification {
  const matName = new Map<MaterialId, string>();
  for (const m of materials) matName.set(m.id, m.name);
  const edgeName = new Map<string, string>();
  for (const e of edges) edgeName.set(e.id, e.name);
  const edgeLabel = (id: string | null): string => (id ? (edgeName.get(id) ?? '—') : '—');

  const rows: SpecRow[] = [];
  let partCount = 0;
  let areaMm2 = 0;
  let edgeMm = 0;

  for (const part of parts) {
    const { length, width } = planeDims(part);
    partCount += part.quantity;
    areaMm2 += length * width * part.quantity;

    // Предварительная длина кромки: сумма облицованных сторон.
    if (part.edges.left) edgeMm += part.height * part.quantity;
    if (part.edges.right) edgeMm += part.height * part.quantity;
    if (part.edges.top) edgeMm += part.width * part.quantity;
    if (part.edges.bottom) edgeMm += part.width * part.quantity;

    rows.push({
      partId: part.id,
      number: (part.metadata?.number as string) ?? '',
      name: part.name,
      quantity: part.quantity,
      length,
      width,
      thickness: part.thickness,
      materialId: part.material,
      materialName: part.material ? (matName.get(part.material) ?? '—') : '—',
      edgeLeft: edgeLabel(part.edges.left),
      edgeRight: edgeLabel(part.edges.right),
      edgeTop: edgeLabel(part.edges.top),
      edgeBottom: edgeLabel(part.edges.bottom),
    });
  }

  rows.sort((a, b) => a.number.localeCompare(b.number));

  return {
    rows,
    totals: {
      partCount,
      uniqueParts: parts.length,
      materialAreaM2: areaMm2 / 1_000_000,
      edgeLengthM: edgeMm / 1000,
    },
  };
}
