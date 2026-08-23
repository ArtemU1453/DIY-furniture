/**
 * Валидаторы каталога и проверки использования (для безопасного удаления).
 * Чистые функции над моделью — используются и store, и UI.
 */
import type {
  EdgeMaterial,
  Hardware,
  HardwareConnection,
  Material,
  Project,
} from '../model/types';
import type { EdgeMaterialId, HardwareId, MaterialId } from '../model/ids';
import { allParts } from '../model/selectors';

export interface CatalogIssue {
  code: string;
  message: string;
}

// ── Валидаторы ────────────────────────────────────────────────────────────────

export function validateMaterial(m: Material): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  if (!m.name.trim()) issues.push({ code: 'material.name', message: 'Название материала не может быть пустым.' });
  if (!(m.thickness > 0)) issues.push({ code: 'material.thickness', message: 'Толщина должна быть больше 0.' });
  if (!(m.sheet.length > 0) || !(m.sheet.width > 0))
    issues.push({ code: 'material.sheet', message: 'Размеры листа должны быть больше 0.' });
  return issues;
}

export function validateEdge(e: EdgeMaterial): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  if (!e.name.trim()) issues.push({ code: 'edge.name', message: 'Название кромки не может быть пустым.' });
  if (!(e.thickness > 0)) issues.push({ code: 'edge.thickness', message: 'Толщина кромки должна быть больше 0.' });
  return issues;
}

export function validateHardware(h: Hardware): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  if (!h.name.trim()) issues.push({ code: 'hardware.name', message: 'Название фурнитуры не может быть пустым.' });
  for (const [key, value] of Object.entries(h.parameters ?? {})) {
    if (typeof value === 'number' && value < 0) {
      issues.push({ code: 'hardware.param', message: `Параметр «${key}» не может быть отрицательным.` });
    }
  }
  return issues;
}

export function validateConnection(
  conn: Pick<HardwareConnection, 'hardwareId' | 'partAId' | 'partBId'>,
  project: Project,
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const parts = new Set(allParts(project).map((p) => p.id));
  if (!project.hardware.some((h) => h.id === conn.hardwareId))
    issues.push({ code: 'conn.hardware', message: 'Указанная фурнитура не найдена.' });
  if (!parts.has(conn.partAId)) issues.push({ code: 'conn.partA', message: 'Деталь A не найдена.' });
  if (!parts.has(conn.partBId)) issues.push({ code: 'conn.partB', message: 'Деталь B не найдена.' });
  if (conn.partAId === conn.partBId)
    issues.push({ code: 'conn.same', message: 'Нельзя соединить деталь саму с собой.' });
  return issues;
}

// ── Использование (для безопасного удаления) ─────────────────────────────────

export function materialUsageCount(project: Project, id: MaterialId): number {
  return allParts(project).filter((p) => p.material === id).length;
}

export function edgeUsageCount(project: Project, id: EdgeMaterialId): number {
  let n = 0;
  for (const p of allParts(project)) {
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      if (p.edges[side] === id) n++;
    }
  }
  return n;
}

export function hardwareUsageCount(project: Project, id: HardwareId): number {
  return project.hardwareConnections.filter((c) => c.hardwareId === id).length;
}
