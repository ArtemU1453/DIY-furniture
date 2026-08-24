/**
 * PRODUCTION_REPORT — сводный производственный отчёт: проект, габариты, детали,
 * материалы, кромка, фурнитура, раскрой, листы, остатки, операции присадки.
 */
import type { Project } from '@/core/model/types';
import { allParts, totalPartCount } from '@/core/model/selectors';
import { partWorldAABB } from '@/core/geometry/partGeometry';
import { allOperations } from '@/engines/machining';
import { calculateEdges } from '@/engines/bom/edgeCalculator';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { m2 } from '@/engines/cutting';
import { finalizeScene, type Prim } from './scene';
import type { DrawingDocument, DrawingPage } from './sheet';

export function buildProductionReport(project: Project): DrawingDocument {
  const parts = allParts(project);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of parts) {
    const b = partWorldAABB(p);
    minX = Math.min(minX, b.min.x); minY = Math.min(minY, b.min.y); minZ = Math.min(minZ, b.min.z);
    maxX = Math.max(maxX, b.max.x); maxY = Math.max(maxY, b.max.y); maxZ = Math.max(maxZ, b.max.z);
  }
  const W = Number.isFinite(minX) ? Math.round(maxX - minX) : 0;
  const H = Number.isFinite(minY) ? Math.round(maxY - minY) : 0;
  const D = Number.isFinite(minZ) ? Math.round(maxZ - minZ) : 0;

  const edges = calculateEdges(parts, project.edges);
  const hardware = buildHardwareLedger(project.hardware, project.hardwareConnections).filter((r) => r.count > 0);
  const ops = allOperations(project);
  const report = project.cutting.report;
  const sheetsUsed = report ? report.jobs.reduce((n, j) => n + j.statistics.sheetCount, 0) : 0;
  const remnants = report ? report.jobs.reduce((n, j) => n + j.sheets.reduce((m, s) => m + s.remnants.length, 0), 0) : 0;

  const lines: string[] = [];
  lines.push(`ПРОИЗВОДСТВЕННЫЙ ОТЧЁТ`);
  lines.push(``);
  lines.push(`Проект: ${project.name}`);
  lines.push(`Дата: ${new Date().toLocaleString('ru-RU')}`);
  lines.push(``);
  lines.push(`1. Габариты изделия: ${W} × ${H} × ${D} мм`);
  lines.push(`2. Деталей: ${parts.length} наименований, всего ${totalPartCount(project)} шт.`);
  lines.push(`3. Материалы:`);
  for (const m of project.materials) lines.push(`     · ${m.name} (${m.thickness} мм, лист ${m.sheet.length}×${m.sheet.width})`);
  lines.push(`4. Расход кромки: ${(edges.totalMm / 1000).toFixed(2)} м`);
  for (const g of edges.groups) lines.push(`     · ${g.name}: ${(g.lengthMm / 1000).toFixed(2)} м`);
  lines.push(`5. Фурнитура:`);
  if (hardware.length === 0) lines.push(`     · нет соединений`);
  for (const h of hardware) lines.push(`     · ${h.name}: ${h.count} шт.`);
  lines.push(`6. Раскрой: листов ${sheetsUsed}, остатков ${remnants}${report ? '' : ' (не рассчитан)'}`);
  if (report) for (const j of report.jobs) lines.push(`     · ${j.statistics.materialName}: ${j.statistics.sheetCount} л., исп. ${(j.statistics.utilization * 100).toFixed(1)}%, отход ${m2(j.statistics.wasteAreaMm2)} м²`);
  lines.push(`7. Операции присадки: ${ops.length}`);

  const prims: Prim[] = lines.map((text, i) => ({
    kind: 'text' as const,
    x: 0,
    y: -i * 8,
    text,
    size: text === lines[0] ? 6 : 3.6,
    bold: i === 0 || /^\d\./.test(text),
    color: '#1a1b1e',
    anchor: 'start' as const,
    baseline: 'hanging' as const,
  }));

  const page: DrawingPage = {
    scene: finalizeScene(prims, 8),
    format: 'A4',
    orientation: 'PORTRAIT',
    scale: 1,
    title: {
      project: project.name, title: 'Производственный отчёт', material: '—', scale: '1:1',
      date: new Date().toLocaleDateString('ru-RU'), sheet: 1, sheetsTotal: 1,
    },
  };
  return { id: `doc-report-${project.id}`, type: 'PRODUCTION_REPORT', projectId: project.id, title: 'Производственный отчёт', pages: [page] };
}
