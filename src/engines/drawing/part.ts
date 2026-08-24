/**
 * PART_DRAWING — чертёж детали: главный/боковой/верхний виды, размеры, кромка
 * (визуально + таблица), присадка (отверстия + таблица). Размеры берутся из Part.
 */
import type { MachiningOperation, Part, Project } from '@/core/model/types';
import { allOperations } from '@/engines/machining';
import { faceLabel, machiningTypeLabel, opNumber } from '@/i18n/machining';
import { finalizeScene, type Prim } from './scene';
import { hDim, renderDimension, vDim } from './dimensions';
import { tablePrims, type TableColumn } from './table';
import { pickScale } from './layout';
import type { DrawingDocument, DrawingPage, SheetFormat, Orientation } from './sheet';

const FORMAT: SheetFormat = 'A3';
const ORIENT: Orientation = 'LANDSCAPE';

const EDGE_COLOR = (id: string | null, project: Project): string | undefined => {
  if (!id) return undefined;
  return project.edges.find((e) => e.id === id)?.color;
};

/** Построить страницу чертежа одной детали. */
export function buildPartPage(project: Project, part: Part, ops: MachiningOperation[], sheet: number, total: number): DrawingPage {
  const w = part.width;
  const h = part.height;
  const t = part.thickness;
  const gap = Math.max(w, h) * 0.18 + 30;

  // Масштаб под область (учитываем виды: ширина w+gap+t, высота h+gap+t).
  const { k, label } = pickScale(w + gap + t + 40, h + gap + t + 40, FORMAT, ORIENT);
  const S = (v: number) => v * k;

  const prims: Prim[] = [];
  // ── Главный вид (front) ─────────────────────────────────────────────────
  prims.push({ kind: 'rect', x: 0, y: 0, w: S(w), h: S(h), stroke: '#1a1b1e', sw: 0.6, fill: '#fbfbfa' });

  // Кромка на сторонах главного вида.
  const eL = EDGE_COLOR(part.edges.left, project);
  const eR = EDGE_COLOR(part.edges.right, project);
  const eT = EDGE_COLOR(part.edges.top, project);
  const eB = EDGE_COLOR(part.edges.bottom, project);
  if (eL) prims.push({ kind: 'line', x1: 0, y1: 0, x2: 0, y2: S(h), color: eL, w: 2 });
  if (eR) prims.push({ kind: 'line', x1: S(w), y1: 0, x2: S(w), y2: S(h), color: eR, w: 2 });
  if (eT) prims.push({ kind: 'line', x1: 0, y1: S(h), x2: S(w), y2: S(h), color: eT, w: 2 });
  if (eB) prims.push({ kind: 'line', x1: 0, y1: 0, x2: S(w), y2: 0, color: eB, w: 2 });

  // ── Присадка на видах ────────────────────────────────────────────────────
  const sideView = { x: S(w) + S(gap), y: 0, w: S(t), h: S(h) };
  const topView = { x: 0, y: -S(gap) - S(t), w: S(w), h: S(t) };
  prims.push({ kind: 'rect', x: sideView.x, y: sideView.y, w: sideView.w, h: sideView.h, stroke: '#1a1b1e', sw: 0.6, fill: '#fbfbfa' });
  prims.push({ kind: 'rect', x: topView.x, y: topView.y, w: topView.w, h: topView.h, stroke: '#1a1b1e', sw: 0.6, fill: '#fbfbfa' });
  prims.push({ kind: 'text', x: S(w) / 2, y: -S(gap) - S(t) - 5, text: 'вид сверху', size: 3, color: '#8a919b', anchor: 'middle' });
  prims.push({ kind: 'text', x: sideView.x + sideView.w / 2, y: -5, text: 'вид сбоку', size: 3, color: '#8a919b', anchor: 'middle' });

  for (const op of ops) {
    const d = ((op.diameter ?? 6) / 2) * k;
    let cx: number, cy: number;
    if (op.face === 'front' || op.face === 'back') { cx = S(op.x); cy = S(op.y); }
    else if (op.face === 'left' || op.face === 'right') { cx = sideView.x + (op.x / Math.max(t, 1)) * sideView.w; cy = S(op.y); }
    else { cx = S(op.x); cy = topView.y + (op.y / Math.max(t, 1)) * topView.h; }
    const color = op.through ? '#e5534b' : '#4c8dff';
    prims.push({ kind: 'circle', cx, cy, r: Math.max(d, 1.2), stroke: color, sw: 0.6 });
    if (op.through) {
      const r = Math.max(d, 1.2);
      prims.push({ kind: 'line', x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r, color, w: 0.5 });
      prims.push({ kind: 'line', x1: cx - r, y1: cy + r, x2: cx + r, y2: cy - r, color, w: 0.5 });
    }
    prims.push({ kind: 'text', x: cx + Math.max(d, 1.2) + 1, y: cy, text: opNumber(op.sequence), size: 2.4, color, anchor: 'start', baseline: 'middle' });
  }

  // ── Размеры (из модели) ────────────────────────────────────────────────────
  prims.push(...renderDimension(hDim(0, S(w), 0, S(gap) + S(t) + 10)).map((p) => remapValue(p, w)));
  prims.push(...renderDimension(vDim(0, S(h), 0, 12)).map((p) => remapValue(p, h)));
  prims.push(...renderDimension(hDim(sideView.x, sideView.x + sideView.w, 0, 12)).map((p) => remapValue(p, t)));

  const geometryScene = finalizeScene(prims, 6);

  // ── Таблицы (кромка + присадка) справа от вида, в мм листа ──────────────────
  const tablePrimsAll: Prim[] = [];
  const tx = geometryScene.originX + geometryScene.width + 12;
  let ty = geometryScene.originY + geometryScene.height;

  // Кромка.
  const edgeName = (id: string | null) => (id ? project.edges.find((e) => e.id === id)?.name ?? '—' : 'нет');
  const edgeCols: TableColumn[] = [{ title: 'Сторона', width: 30 }, { title: 'Кромка', width: 50 }];
  tablePrimsAll.push({ kind: 'text', x: tx, y: ty + 4, text: 'Кромка', size: 3.2, bold: true, color: '#1a1b1e', anchor: 'start' });
  tablePrimsAll.push(...tablePrims(tx, ty, edgeCols, [
    ['Левая', edgeName(part.edges.left)],
    ['Правая', edgeName(part.edges.right)],
    ['Верх', edgeName(part.edges.top)],
    ['Низ', edgeName(part.edges.bottom)],
  ], { rowHeight: 6, fontSize: 2.8 }));
  ty -= 6 * 5 + 14;

  // Присадка.
  if (ops.length > 0) {
    const mCols: TableColumn[] = [
      { title: '№', width: 12 }, { title: 'Тип', width: 24 }, { title: 'Ø', width: 12, align: 'end' },
      { title: 'Глуб', width: 14, align: 'end' }, { title: 'X', width: 14, align: 'end' }, { title: 'Y', width: 14, align: 'end' }, { title: 'Сторона', width: 22 },
    ];
    tablePrimsAll.push({ kind: 'text', x: tx, y: ty + 4, text: 'Присадка', size: 3.2, bold: true, color: '#1a1b1e', anchor: 'start' });
    tablePrimsAll.push(...tablePrims(tx, ty, mCols, ops.map((op) => [
      opNumber(op.sequence),
      machiningTypeLabel(op.type),
      String(op.diameter ?? '—'),
      op.through ? '⌀' : String(op.depth ?? '—'),
      String(Math.round(op.x)),
      String(Math.round(op.y)),
      faceLabel(op.face).replace(/\s*\(.*\)/, ''),
    ]), { rowHeight: 6, fontSize: 2.6 }));
  }

  const scene = finalizeScene([...geometryScene.prims, ...tablePrimsAll], 8);

  return {
    scene,
    format: FORMAT,
    orientation: ORIENT,
    scale: 1,
    partId: part.id,
    title: {
      project: project.name,
      title: part.name,
      partNumber: (part.metadata?.number as string) ?? '',
      material: project.materials.find((m) => m.id === part.material)?.name ?? '—',
      scale: label,
      date: new Date().toLocaleDateString('ru-RU'),
      sheet,
      sheetsTotal: total,
    },
  };
}

/** Заменить отображаемое значение размера на реальное (мм из модели). */
function remapValue(p: Prim, realValue: number): Prim {
  if (p.kind === 'text' && /^\d+$/.test(p.text)) return { ...p, text: String(Math.round(realValue)) };
  return p;
}

/** Документ «Деталировка»: по странице на каждую деталь. */
export function buildPartsDocument(project: Project): DrawingDocument {
  const ops = allOperations(project);
  const parts = project.furnitures.flatMap((f) => f.assemblies.flatMap((a) => a.parts)).filter((p) => p.metadata?.hidden !== true);
  const pages = parts.map((part, i) =>
    buildPartPage(project, part, ops.filter((o) => o.partId === part.id), i + 1, parts.length),
  );
  return { id: `doc-parts-${project.id}`, type: 'PART_DRAWING', projectId: project.id, title: 'Деталировка', pages };
}
