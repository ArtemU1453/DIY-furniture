/**
 * Производственная панель и таблицы (§113–§115, §141–§150).
 *
 * Только агрегация уже посчитанных данных: детали, партии и готовность
 * приходят готовыми, здесь их сортируют, фильтруют и складывают в сводку.
 */
import type { ProductionBatch, ProductionJob, ProductionPartStatus } from '@/core/model/types';
import type { ProductionPart } from './parts';
import type { ProductionReadiness } from './readiness';

/** Сводка производственной панели (§113). */
export interface ProductionDashboard {
  status: ProductionJob['status'];
  revision: number;
  /** Процент готовности из чек-листа (§114/§115). */
  progress: number;
  ready: boolean;
  parts: number;
  /** Количество деталей с учётом quantity. */
  quantity: number;
  batches: number;
  errors: number;
  warnings: number;
  byStatus: Record<ProductionPartStatus, number>;
  /** Номер последнего выпуска, если он есть (§84). */
  lastRelease?: string;
}

export function productionDashboard(
  job: ProductionJob,
  parts: ProductionPart[],
  batches: ProductionBatch[],
  readiness: ProductionReadiness,
): ProductionDashboard {
  const byStatus: Record<ProductionPartStatus, number> = { NEW: 0, MODIFIED: 0, READY: 0, ERROR: 0 };
  let quantity = 0;
  for (const part of parts) {
    byStatus[part.status] += 1;
    quantity += part.quantity;
  }
  const releases = job.releases ?? [];
  return {
    status: job.status,
    revision: job.revision,
    progress: readiness.progress,
    ready: readiness.ready,
    parts: parts.length,
    quantity,
    batches: batches.length,
    errors: readiness.errors,
    warnings: readiness.warnings,
    byStatus,
    lastRelease: releases.length > 0 ? releases[releases.length - 1].id : undefined,
  };
}

/** Поля сортировки производственной таблицы (§145). */
export type ProductionSortField = 'number' | 'name' | 'material' | 'size' | 'quantity' | 'status';

const STATUS_ORDER: Record<ProductionPartStatus, number> = { ERROR: 0, NEW: 1, MODIFIED: 2, READY: 3 };

/** Сортировка деталей производства (§145). */
export function sortProductionParts(
  parts: ProductionPart[],
  field: ProductionSortField,
  direction: 'asc' | 'desc' = 'asc',
): ProductionPart[] {
  const sign = direction === 'asc' ? 1 : -1;
  const value = (p: ProductionPart): number | string => {
    switch (field) {
      case 'name': return p.name;
      case 'material': return p.materialName;
      case 'size': return p.width * p.height;
      case 'quantity': return p.quantity;
      case 'status': return STATUS_ORDER[p.status];
      case 'number':
      default: return p.number;
    }
  };
  return [...parts].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign;
    return String(va).localeCompare(String(vb), 'ru') * sign;
  });
}

/** Фильтр производственной таблицы (§146). */
export interface ProductionFilter {
  query?: string;
  materialId?: string;
  status?: ProductionPartStatus;
  /** Только детали с присадкой. */
  withMachining?: boolean;
  /** Только детали с кромкой. */
  withEdges?: boolean;
}

/** Поиск и фильтрация деталей (§146/§147). */
export function filterProductionParts(
  parts: ProductionPart[],
  filter: ProductionFilter,
): ProductionPart[] {
  const query = filter.query?.trim().toLowerCase();
  return parts.filter((p) => {
    if (filter.status && p.status !== filter.status) return false;
    if (filter.materialId && String(p.materialId ?? '') !== filter.materialId) return false;
    if (filter.withMachining && p.operations.length === 0) return false;
    if (filter.withEdges && p.edges.every((e) => e.edgeMaterialId === null)) return false;
    if (query) {
      const hay = `${p.number} ${p.name} ${p.materialName}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

/** Строка таблицы присадки производства (§148). */
export interface MachiningTableRow {
  partNumber: string;
  partName: string;
  index: number;
  type: string;
  face: string;
  x: number;
  y: number;
  diameter?: number;
  depth?: number;
  through: boolean;
}

export function machiningTable(parts: ProductionPart[]): MachiningTableRow[] {
  return parts.flatMap((part) =>
    part.operations.map((op) => ({
      partNumber: part.number,
      partName: part.name,
      index: op.operationIndex,
      type: op.type,
      face: op.face,
      x: op.x,
      y: op.y,
      diameter: op.diameter,
      depth: op.depth,
      through: op.through,
    })));
}
