/**
 * CUTTING_DRAWING — карта раскроя из СУЩЕСТВУЮЩЕГО CuttingResult (без повторного
 * расчёта). На каждый лист: границы, детали с номерами и размерами, текстура,
 * технологические отступы, остатки.
 */
import type { CuttingSheetResult, Project } from '@/core/model/types';
import { finalizeScene, type Prim } from './scene';
import { pickScale } from './layout';
import type { DrawingDocument, DrawingPage, Orientation, SheetFormat } from './sheet';

const FORMAT: SheetFormat = 'A3';
const ORIENT: Orientation = 'LANDSCAPE';

function buildSheetPage(project: Project, sheet: CuttingSheetResult, materialName: string, page: number, total: number): DrawingPage {
  const { k, label } = pickScale(sheet.length + 40, sheet.width + 40, FORMAT, ORIENT);
  const S = (v: number) => v * k;
  const prims: Prim[] = [];

  prims.push({ kind: 'rect', x: 0, y: 0, w: S(sheet.length), h: S(sheet.width), stroke: '#1a1b1e', sw: 0.7, fill: '#ffffff' });
  prims.push({
    kind: 'rect',
    x: S(sheet.trim.left), y: S(sheet.trim.bottom),
    w: S(sheet.length - sheet.trim.left - sheet.trim.right), h: S(sheet.width - sheet.trim.top - sheet.trim.bottom),
    stroke: '#9aa0a6', sw: 0.4, fill: 'none', dash: '4 3',
  });

  for (const p of sheet.placements) {
    prims.push({ kind: 'rect', x: S(p.x), y: S(p.y), w: S(p.length), h: S(p.width), stroke: '#33373d', sw: 0.4, fill: '#eef1f5' });
    // Направление текстуры.
    prims.push({ kind: 'line', x1: S(p.x + p.length / 2), y1: S(p.y) + 2, x2: S(p.x + p.length / 2), y2: S(p.y + p.width) - 2, color: '#c8cdd6', w: 0.3 });
    prims.push({ kind: 'text', x: S(p.x + p.length / 2), y: S(p.y + p.width / 2) + 2, text: p.number, size: Math.min(4, Math.max(2.4, S(Math.min(p.length, p.width)) * 0.15)), color: '#1a1b1e', anchor: 'middle', baseline: 'middle', bold: true });
    prims.push({ kind: 'text', x: S(p.x + p.length / 2), y: S(p.y + p.width / 2) - 3, text: `${Math.round(p.length)}×${Math.round(p.width)}${p.rotation ? ' ↻' : ''}`, size: 2.4, color: '#8a919b', anchor: 'middle', baseline: 'middle' });
  }
  // Линии реза (из фактического расположения деталей и пропила).
  for (const c of sheet.cuts) {
    prims.push({ kind: 'line', x1: S(c.x1), y1: S(c.y1), x2: S(c.x2), y2: S(c.y2), color: '#b9c2cf', w: 0.2 });
  }
  for (const r of sheet.remnants) {
    prims.push({ kind: 'rect', x: S(r.x), y: S(r.y), w: S(r.width), h: S(r.height), stroke: r.usable ? '#4caf7d' : '#b0b4ba', sw: 0.4, fill: 'none', dash: '3 3' });
  }

  const scene = finalizeScene(prims, 8);
  return {
    scene,
    format: FORMAT,
    orientation: ORIENT,
    scale: 1,
    title: {
      project: project.name,
      title: `Раскрой — лист ${sheet.index + 1} (${Math.round(sheet.utilization * 100)}%)`,
      material: materialName,
      scale: label,
      date: new Date().toLocaleDateString('ru-RU'),
      sheet: page,
      sheetsTotal: total,
    },
  };
}

export function buildCuttingDocument(project: Project): DrawingDocument {
  const report = project.cutting.report;
  const allSheets = report ? report.jobs.flatMap((j) => j.sheets.map((s) => ({ sheet: s, name: j.statistics.materialName }))) : [];
  const pages = allSheets.map((s, i) => buildSheetPage(project, s.sheet, s.name, i + 1, allSheets.length));
  if (pages.length === 0) {
    // Пустая страница-заглушка, если раскрой не рассчитан.
    pages.push({
      scene: finalizeScene([{ kind: 'text', x: 0, y: 0, text: 'Раскрой не рассчитан — откройте вкладку «Раскрой» и нажмите «Пересчитать».', size: 5, color: '#8a919b' }], 20),
      format: FORMAT, orientation: ORIENT, scale: 1,
      title: { project: project.name, title: 'Карта раскроя', material: '—', scale: '1:1', date: new Date().toLocaleDateString('ru-RU'), sheet: 1, sheetsTotal: 1 },
    });
  }
  return { id: `doc-cutting-${project.id}`, type: 'CUTTING_DRAWING', projectId: project.id, title: 'Карта раскроя', pages };
}
