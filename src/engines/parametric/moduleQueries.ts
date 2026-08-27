/**
 * Связи модуля с остальной моделью (§58–§68).
 *
 * Всё выводится из ProjectModel: модуль хранит только КЛЮЧИ своих деталей,
 * а детали, фурнитура, кромка, присадка и раскрой берутся из соответствующих
 * движков. Поэтому ответы не могут устареть относительно самой модели, и
 * второй системы деталей не появляется.
 */
import type { Part, Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { allEdgeBanding, bandingTotalLength } from '@/engines/edges';
import { allOperations } from '@/engines/machining';
import { hardwareSpecification } from '@/engines/hardware';
import { flattenModules, isVisible, type FurnitureModule, type ModuleStatusKind } from './modules';

/** Детали модуля и всех вложенных (§59). */
export function modulePartKeys(module: FurnitureModule): Set<string> {
  return new Set(flattenModules(module).flatMap((m) => m.parts));
}

export function modulePartsOf(project: Project, module: FurnitureModule): Part[] {
  const keys = modulePartKeys(module);
  return allParts(project).filter((p) => {
    const key = p.metadata?.key as string | undefined;
    return (key != null && keys.has(key)) || keys.has(String(p.id));
  });
}

/** Модуль, которому принадлежит деталь (§58). */
export function moduleOfPart(modules: FurnitureModule[], part: Part): FurnitureModule | undefined {
  const key = (part.metadata?.key as string | undefined) ?? String(part.id);
  for (const root of modules) {
    for (const m of flattenModules(root)) {
      if (m.parts.includes(key)) return m;
    }
  }
  return undefined;
}

/** Сводка модуля по всем производственным разделам (§60–§64). */
export interface ModuleSummary {
  moduleId: string;
  name: string;
  partCount: number;
  /** Площадь деталей, м². */
  areaM2: number;
  /** Расход кромки, м (§61). */
  edgeMeters: number;
  /** Операций присадки (§63). */
  operationCount: number;
  /** Позиций фурнитуры (§62). */
  hardwareCount: number;
  /** Листов по последнему расчёту раскроя (§60); null — раскрой не считался. */
  sheetCount: number | null;
  status: ModuleStatusKind;
  visible: boolean;
}

export function moduleSummary(project: Project, module: FurnitureModule): ModuleSummary {
  const parts = modulePartsOf(project, module);
  const partIds = new Set(parts.map((p) => String(p.id)));

  const areaMm2 = parts.reduce((n, p) => n + p.width * p.height * p.quantity, 0);
  const edgeMm = allEdgeBanding(project)
    .filter((b) => partIds.has(String(b.partId)))
    .reduce((n, b) => n + bandingTotalLength(b), 0);
  const operationCount = allOperations(project).filter((op) => partIds.has(String(op.partId))).length;

  // Фурнитура считается по узлам, обе детали которых принадлежат модулю:
  // узел между двумя модулями не принадлежит ни одному целиком.
  const connections = project.hardwareConnections.filter(
    (c) => partIds.has(String(c.partAId)) && partIds.has(String(c.partBId)),
  );
  const hardwareIds = new Set(connections.map((c) => String(c.hardwareId)));
  const hardwareCount = hardwareSpecification(project)
    .filter((r) => hardwareIds.has(String(r.hardwareId)))
    .reduce((n, r) => n + r.quantity, 0);

  const report = project.cutting.report;
  const sheetCount = report
    ? report.jobs.reduce((n, j) => n + j.statistics.sheetCount, 0)
    : null;

  return {
    moduleId: module.id,
    name: module.name,
    partCount: parts.reduce((n, p) => n + p.quantity, 0),
    areaM2: areaMm2 / 1_000_000,
    edgeMeters: edgeMm / 1000,
    operationCount,
    hardwareCount,
    sheetCount,
    status: module.status ?? 'VALID',
    visible: isVisible(module),
  };
}

/** Документы, в которых участвует модуль (§64). */
export function moduleDocuments(project: Project, module: FurnitureModule): string[] {
  const parts = modulePartsOf(project, module);
  if (parts.length === 0) return [];
  const docs = ['partsList', 'parts', 'summary'];
  if (allOperations(project).some((op) => parts.some((p) => String(p.id) === String(op.partId)))) {
    docs.push('machiningList');
  }
  if (project.cutting.report) docs.push('cutting');
  return docs;
}

/** Что подсветить при выборе модуля (§57). */
export function highlightForModule(project: Project, module: FurnitureModule): string[] {
  return modulePartsOf(project, module).map((p) => String(p.id));
}
