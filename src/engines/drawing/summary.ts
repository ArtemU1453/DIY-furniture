/**
 * PROJECT_SUMMARY — итоговая информация о проекте: название, габариты, число
 * деталей и листов, площади материала/отхода, использование, число фурнитуры и
 * операций присадки. Всё выводится из существующей модели (без пересчёта).
 */
import type { Project } from '@/core/model/types';
import { allParts, totalPartCount } from '@/core/model/selectors';
import { partWorldAABB } from '@/core/geometry/partGeometry';
import { allOperations } from '@/engines/machining';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { m2 } from '@/engines/cutting';
import { finalizeScene, type Prim } from './scene';
import type { DrawingDocument, DrawingPage } from './sheet';

export interface ProjectSummaryData {
  name: string;
  width: number;
  height: number;
  depth: number;
  partCount: number; // наименований
  partTotal: number; // штук
  sheetCount: number;
  materialAreaM2: number;
  wasteAreaM2: number;
  utilization: number; // 0..1
  hardwareCount: number;
  machiningCount: number;
}

export function projectSummaryData(project: Project): ProjectSummaryData {
  const parts = allParts(project);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of parts) {
    const b = partWorldAABB(p);
    minX = Math.min(minX, b.min.x); minY = Math.min(minY, b.min.y); minZ = Math.min(minZ, b.min.z);
    maxX = Math.max(maxX, b.max.x); maxY = Math.max(maxY, b.max.y); maxZ = Math.max(maxZ, b.max.z);
  }
  const report = project.cutting.report;
  const sheetCount = report ? report.jobs.reduce((n, j) => n + j.statistics.sheetCount, 0) : 0;
  const usableArea = report ? report.jobs.reduce((n, j) => n + j.statistics.sheetsUsableAreaMm2, 0) : 0;
  const piecesArea = report ? report.jobs.reduce((n, j) => n + j.statistics.piecesAreaMm2, 0) : 0;
  const wasteArea = report ? report.jobs.reduce((n, j) => n + j.statistics.wasteAreaMm2, 0) : 0;
  const utilization = usableArea > 0 ? piecesArea / usableArea : 0;
  const hardwareCount = buildHardwareLedger(project.hardware, project.hardwareConnections).reduce((n, r) => n + r.count, 0);

  return {
    name: project.name,
    width: Number.isFinite(minX) ? Math.round(maxX - minX) : 0,
    height: Number.isFinite(minY) ? Math.round(maxY - minY) : 0,
    depth: Number.isFinite(minZ) ? Math.round(maxZ - minZ) : 0,
    partCount: parts.length,
    partTotal: totalPartCount(project),
    sheetCount,
    materialAreaM2: m2(usableArea),
    wasteAreaM2: m2(wasteArea),
    utilization,
    hardwareCount,
    machiningCount: allOperations(project).length,
  };
}

export function buildProjectSummaryDocument(project: Project): DrawingDocument {
  const d = projectSummaryData(project);
  const lines: Array<[string, string]> = [
    ['Проект', d.name],
    ['Габариты изделия', `${d.width} × ${d.height} × ${d.depth} мм`],
    ['Деталей (наименований)', String(d.partCount)],
    ['Деталей (штук)', String(d.partTotal)],
    ['Листов раскроя', d.sheetCount > 0 ? String(d.sheetCount) : 'не рассчитан'],
    ['Площадь материала', `${d.materialAreaM2} м²`],
    ['Площадь отходов', `${d.wasteAreaM2} м²`],
    ['Использование материала', `${(d.utilization * 100).toFixed(1)}%`],
    ['Единиц фурнитуры', String(d.hardwareCount)],
    ['Операций присадки', String(d.machiningCount)],
  ];

  const prims: Prim[] = [];
  prims.push({ kind: 'text', x: 0, y: 0, text: 'ИТОГОВАЯ ИНФОРМАЦИЯ', size: 6, bold: true, color: '#1a1b1e', anchor: 'start', baseline: 'hanging' });
  lines.forEach(([k, v], i) => {
    const y = -14 - i * 9;
    prims.push({ kind: 'text', x: 0, y, text: k, size: 3.6, color: '#5a6472', anchor: 'start', baseline: 'hanging' });
    prims.push({ kind: 'text', x: 90, y, text: v, size: 3.8, bold: true, color: '#1a1b1e', anchor: 'start', baseline: 'hanging' });
  });

  const page: DrawingPage = {
    scene: finalizeScene(prims, 8),
    format: 'A4',
    orientation: 'PORTRAIT',
    scale: 1,
    title: {
      project: project.name, title: 'Итоговая информация', material: '—', scale: '1:1',
      date: new Date().toLocaleDateString('ru-RU'), sheet: 1, sheetsTotal: 1,
    },
  };
  return { id: `doc-summary-${project.id}`, type: 'PROJECT_SUMMARY', projectId: project.id, title: 'Итоговая информация', pages: [page] };
}
