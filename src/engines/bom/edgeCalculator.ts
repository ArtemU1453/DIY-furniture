/**
 * EdgeCalculator — расчёт длины кромки по проекту на основе РЕАЛЬНЫХ размеров
 * деталей (не хранимого числа). Группировка по материалу кромки.
 *
 * Соглашение сторон: левая/правая идут вдоль «высоты» детали (part.height),
 * верхняя/нижняя — вдоль «ширины» (part.width). С учётом количества деталей.
 */
import type { EdgeMaterial, Part } from '@/core/model/types';
import type { EdgeMaterialId } from '@/core/model/ids';

export interface EdgeGroup {
  edgeId: EdgeMaterialId;
  name: string;
  thickness: number;
  lengthMm: number;
}

export interface EdgeReport {
  totalMm: number;
  groups: EdgeGroup[];
}

export function calculateEdges(parts: Part[], edges: EdgeMaterial[]): EdgeReport {
  const byId = new Map<EdgeMaterialId, EdgeMaterial>();
  for (const e of edges) byId.set(e.id, e);

  const totals = new Map<EdgeMaterialId, number>();
  const add = (id: EdgeMaterialId | null, length: number, qty: number) => {
    if (!id) return;
    totals.set(id, (totals.get(id) ?? 0) + length * qty);
  };

  for (const p of parts) {
    add(p.edges.left, p.height, p.quantity);
    add(p.edges.right, p.height, p.quantity);
    add(p.edges.top, p.width, p.quantity);
    add(p.edges.bottom, p.width, p.quantity);
  }

  const groups: EdgeGroup[] = [];
  let totalMm = 0;
  for (const [edgeId, lengthMm] of totals) {
    const mat = byId.get(edgeId);
    groups.push({
      edgeId,
      name: mat?.name ?? '—',
      thickness: mat?.thickness ?? 0,
      lengthMm,
    });
    totalMm += lengthMm;
  }
  groups.sort((a, b) => a.thickness - b.thickness);

  return { totalMm, groups };
}
