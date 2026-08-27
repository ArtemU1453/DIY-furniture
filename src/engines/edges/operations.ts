/**
 * EdgeOperation — производственная операция кромкования (§66–§68).
 *
 * Отдельная технологическая операция: с фурнитурой не связана (§65) и с
 * присадкой не смешивается. Операция производна от EdgeBanding, поэтому
 * пересчитывается вместе с деталью и не «застревает» на старых размерах.
 */
import type {
  EdgeBanding,
  EdgeOperation,
  EdgeOperationStatus,
  Project,
} from '@/core/model/types';
import { allEdgeBanding, bandingTotalLength } from './banding';

/** Припуск на кромкование из производственного профиля (§39). */
export function edgeAllowance(project: Project): number {
  return project.machining.profile?.edgeCutAllowance ?? 0;
}

/**
 * Длина операции: длина стороны × количество деталей + припуск на каждую
 * заготовку (§39/§42). Припуск технологический — на расчётную длину кромки
 * в спецификации он не влияет.
 */
export function operationLength(banding: EdgeBanding, allowance: number): number {
  return bandingTotalLength(banding) + allowance * banding.quantity;
}

/** Операция из записи кромки. */
export function operationFor(banding: EdgeBanding, allowance: number): EdgeOperation {
  return {
    id: `edge:${banding.id}`,
    partId: banding.partId,
    side: banding.side,
    materialId: banding.materialId,
    thickness: banding.thickness,
    width: banding.width,
    length: operationLength(banding, allowance),
    operationType: 'EDGE_BANDING',
    status: statusOf(banding),
  };
}

/** Состояние операции (§68) выводится из состояния самой кромки. */
export function statusOf(banding: EdgeBanding): EdgeOperationStatus {
  if (banding.status === 'ERROR') return 'ERROR';
  if (banding.status === 'OUTDATED') return 'DIRTY';
  return 'CURRENT';
}

/** Все операции кромкования проекта. */
export function edgeOperations(project: Project): EdgeOperation[] {
  const allowance = edgeAllowance(project);
  return allEdgeBanding(project).map((b) => operationFor(b, allowance));
}

/** Операции конкретной детали (§95: пересчёт только затронутого). */
export function edgeOperationsForPart(project: Project, partId: string): EdgeOperation[] {
  return edgeOperations(project).filter((op) => String(op.partId) === partId);
}
