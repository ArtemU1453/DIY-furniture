/**
 * Производственные партии (§59–§62).
 *
 * Партия — способ ГРУППИРОВКИ уже посчитанных деталей по тому, что с ними
 * делает цех: пилит, кромит, сверлит. Ни размеров, ни операций партия не
 * хранит — только ссылки на детали.
 */
import type { ProductionBatch } from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';
import type { ProductionPart } from './parts';

export type BatchKind = ProductionBatch['kind'];

const KIND_LABEL: Record<BatchKind, string> = {
  CUT: 'Раскрой',
  EDGE: 'Кромкование',
  MACHINING: 'Присадка',
};

export function batchLabel(kind: BatchKind): string {
  return KIND_LABEL[kind];
}

/** Нужна ли детали эта обработка. */
function belongsTo(part: ProductionPart, kind: BatchKind): boolean {
  if (kind === 'CUT') return true;
  if (kind === 'EDGE') return part.edges.some((e) => e.edgeMaterialId !== null);
  return part.operations.length > 0;
}

/**
 * Партии проекта (§60): по материалу, толщине и виду обработки.
 *
 * Состояние партии — худшее состояние её деталей: одна деталь с ошибкой
 * делает партию ERROR, иначе деталь со статусом MODIFIED даёт WARNING.
 */
export function productionBatches(parts: ProductionPart[]): ProductionBatch[] {
  const kinds: BatchKind[] = ['CUT', 'EDGE', 'MACHINING'];
  const batches = new Map<string, ProductionBatch>();

  for (const kind of kinds) {
    for (const part of parts) {
      if (!belongsTo(part, kind)) continue;
      const key = `${kind}:${String(part.materialId)}:${part.thickness}`;
      const batch = batches.get(key) ?? {
        id: key,
        materialId: (part.materialId ?? '') as MaterialId,
        materialName: part.materialName,
        thickness: part.thickness,
        kind,
        partIds: [],
        quantity: 0,
        status: 'READY' as ProductionBatch['status'],
      };
      batch.partIds.push(part.partId);
      batch.quantity += part.quantity;
      if (part.status === 'ERROR') batch.status = 'ERROR';
      else if (part.status === 'MODIFIED' && batch.status !== 'ERROR') batch.status = 'WARNING';
      batches.set(key, batch);
    }
  }

  return [...batches.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.materialName.localeCompare(b.materialName) || a.thickness - b.thickness);
}

/** Сводка по партиям — то, что видно на панели (§61/§62). */
export interface BatchSummary {
  total: number;
  parts: number;
  ready: number;
  warning: number;
  error: number;
}

export function batchSummary(batches: ProductionBatch[]): BatchSummary {
  return {
    total: batches.length,
    parts: batches.reduce((sum, b) => sum + b.quantity, 0),
    ready: batches.filter((b) => b.status === 'READY').length,
    warning: batches.filter((b) => b.status === 'WARNING').length,
    error: batches.filter((b) => b.status === 'ERROR').length,
  };
}
