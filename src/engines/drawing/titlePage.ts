/**
 * TITLE_PAGE (§30) — титульная страница комплекта документации.
 *
 * Показывает название проекта, дату, версию, число деталей и листов и перечень
 * материалов. Никакой рекламы и внешних сервисов — только данные проекта.
 */
import type { Project } from '@/core/model/types';
import { allParts, totalPartCount } from '@/core/model/selectors';
import { finalizeScene, type Prim } from './scene';
import { fmtMm } from './notation';
import type { DrawingDocument, DrawingPage, Orientation, SheetFormat } from './sheet';

const FORMAT: SheetFormat = 'A4';
const ORIENT: Orientation = 'PORTRAIT';

/** Сводка материалов проекта: название, толщина, число деталей. */
export function titlePageMaterials(project: Project): Array<{ name: string; thickness: number; parts: number }> {
  const byMaterial = new Map<string, { name: string; thickness: number; parts: number }>();
  for (const p of allParts(project)) {
    const m = project.materials.find((x) => x.id === p.material);
    const key = `${p.material ?? 'none'}|${p.thickness}`;
    const entry = byMaterial.get(key);
    if (entry) entry.parts += p.quantity;
    else byMaterial.set(key, { name: m?.name ?? 'Материал не задан', thickness: p.thickness, parts: p.quantity });
  }
  return [...byMaterial.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.thickness - b.thickness);
}

export function buildTitlePageDocument(project: Project): DrawingDocument {
  const parts = allParts(project);
  const sheetCount = project.cutting.report
    ? project.cutting.report.jobs.reduce((n, j) => n + j.statistics.sheetCount, 0)
    : 0;
  const materials = titlePageMaterials(project);
  const revision = project.documents.docVersion ?? '1.0';
  const date = new Date().toLocaleDateString('ru-RU');

  const prims: Prim[] = [];
  // Заголовок — крупно по центру верхней трети листа.
  let y = 0;
  prims.push({ kind: 'text', x: 0, y, text: project.name || 'Проект', size: 11, bold: true, color: '#1a1b1e', anchor: 'start' });
  y -= 8;
  prims.push({ kind: 'text', x: 0, y, text: 'Комплект производственной документации', size: 4.2, color: '#5a6472', anchor: 'start' });
  y -= 6;
  prims.push({ kind: 'line', x1: 0, y1: y, x2: 170, y2: y, color: '#1a1b1e', w: 0.6 });
  y -= 12;

  const field = (label: string, value: string) => {
    prims.push({ kind: 'text', x: 0, y, text: label, size: 3.4, color: '#8a919b', anchor: 'start' });
    prims.push({ kind: 'text', x: 55, y, text: value, size: 3.8, bold: true, color: '#1a1b1e', anchor: 'start' });
    y -= 7;
  };

  field('Дата', date);
  field('Версия документации', `Rev. ${revision}`);
  field('Наименований деталей', String(parts.length));
  field('Всего деталей, шт', String(totalPartCount(project)));
  field('Листов материала', sheetCount > 0 ? String(sheetCount) : 'раскрой не рассчитан');

  y -= 5;
  prims.push({ kind: 'text', x: 0, y, text: 'Материалы', size: 4.2, bold: true, color: '#1a1b1e', anchor: 'start' });
  y -= 7;
  if (materials.length === 0) {
    prims.push({ kind: 'text', x: 0, y, text: '—', size: 3.4, color: '#8a919b', anchor: 'start' });
    y -= 6;
  }
  for (const m of materials) {
    prims.push({ kind: 'text', x: 0, y, text: `${m.name} ${fmtMm(m.thickness)} мм`, size: 3.4, color: '#1a1b1e', anchor: 'start' });
    prims.push({ kind: 'text', x: 120, y, text: `${m.parts} дет.`, size: 3.4, color: '#5a6472', anchor: 'end' });
    y -= 6;
  }

  const page: DrawingPage = {
    scene: finalizeScene(prims, 6),
    format: FORMAT,
    orientation: ORIENT,
    scale: 1,
    title: {
      project: project.name,
      title: 'Титульный лист',
      material: '—',
      scale: '1:1',
      date,
      sheet: 1,
      sheetsTotal: 1,
      revision: `Rev. ${revision}`,
    },
  };
  return { id: `doc-title-${project.id}`, type: 'TITLE_PAGE', projectId: project.id, title: 'Титульный лист', pages: [page] };
}
