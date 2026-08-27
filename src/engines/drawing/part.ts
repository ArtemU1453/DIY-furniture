/**
 * PART_DRAWING (§11, §18) — чертёж детали.
 *
 * Главный вид (ширина × высота) плюс дополнительные виды по толщине
 * (800 × 16), габаритные размеры из PartModel, кромка (визуально + таблица
 * L1–L4), направление текстуры, присадка из MachiningModel и её таблица с
 * базами. Присадка здесь НЕ пересчитывается (§13) — операции берутся как есть.
 */
import type { MachiningOperation, Part, Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { faceLabel, machiningTypeLabel, opNumber } from '@/i18n/machining';
import { finalizeScene, type Prim } from './scene';
import { hDim, layoutDimensions, renderDimension, vDim, type Dimension } from './dimensions';
import { tablePrims, type TableColumn } from './table';
import { pickScale } from './layout';
import { filterParts, type PartFilterKey } from './partFilter';
import {
  EDGE_CODES,
  EDGE_SIDE_LABELS,
  EDGE_SIDE_ORDER,
  edgeValue,
  fmtMm,
  grainAlongHeight,
  grainNotation,
  holeNotation,
  operationDatum,
  partMaterialNotation,
} from './notation';
import type { DrawingDocument, DrawingPage, SheetFormat, Orientation } from './sheet';

const FORMAT: SheetFormat = 'A3';
const ORIENT: Orientation = 'LANDSCAPE';

const EDGE_COLOR = (id: string | null, project: Project): string | undefined => {
  if (!id) return undefined;
  return project.edges.find((e) => e.id === id)?.color;
};

export interface PartPageOptions {
  revision?: string;
}

/** Построить страницу чертежа одной детали. */
export function buildPartPage(
  project: Project,
  part: Part,
  ops: MachiningOperation[],
  sheet: number,
  total: number,
  opts: PartPageOptions = {},
): DrawingPage {
  const w = part.width;
  const h = part.height;
  const t = part.thickness;
  const gap = Math.max(w, h) * 0.18 + 30;

  // Масштаб под область (учитываем виды: ширина w+gap+t, высота h+gap+t).
  const { k, label } = pickScale(w + gap + t + 40, h + gap + t + 40, FORMAT, ORIENT);
  const S = (v: number) => v * k;

  const prims: Prim[] = [];
  // ── Главный вид (пласть, w × h) ──────────────────────────────────────────
  prims.push({ kind: 'rect', x: 0, y: 0, w: S(w), h: S(h), stroke: '#1a1b1e', sw: 0.6, fill: '#fbfbfa' });

  // Кромка на сторонах главного вида + обозначения L1–L4 (§16).
  const eL = EDGE_COLOR(part.edges.left, project);
  const eR = EDGE_COLOR(part.edges.right, project);
  const eT = EDGE_COLOR(part.edges.top, project);
  const eB = EDGE_COLOR(part.edges.bottom, project);
  if (eL) prims.push({ kind: 'line', x1: 0, y1: 0, x2: 0, y2: S(h), color: eL, w: 2 });
  if (eR) prims.push({ kind: 'line', x1: S(w), y1: 0, x2: S(w), y2: S(h), color: eR, w: 2 });
  if (eT) prims.push({ kind: 'line', x1: 0, y1: S(h), x2: S(w), y2: S(h), color: eT, w: 2 });
  if (eB) prims.push({ kind: 'line', x1: 0, y1: 0, x2: S(w), y2: 0, color: eB, w: 2 });

  const edgeTag = (x: number, y: number, side: 'left' | 'right' | 'top' | 'bottom') => {
    if (!part.edges[side]) return;
    prims.push({
      kind: 'text', x, y, text: EDGE_CODES[side], size: 2.8, bold: true,
      color: '#4b6a45', anchor: 'middle', baseline: 'middle',
    });
  };
  edgeTag(-4, S(h) / 2, 'left');
  edgeTag(S(w) + 4, S(h) / 2, 'right');
  edgeTag(S(w) / 2, S(h) + 4, 'top');
  edgeTag(S(w) / 2, -4, 'bottom');

  // ── Направление текстуры (§19) ───────────────────────────────────────────
  const grain = grainNotation(part);
  if (grain) {
    const alongY = grainAlongHeight(part);
    const cx = S(w) / 2;
    const cy = S(h) / 2;
    const len = Math.min(S(w), S(h)) * 0.3;
    const gc = '#7a8aa8';
    if (alongY) {
      prims.push({ kind: 'line', x1: cx, y1: cy - len, x2: cx, y2: cy + len, color: gc, w: 0.6 });
      prims.push({ kind: 'polyline', pts: [[cx - len * 0.2, cy + len - len * 0.25], [cx, cy + len], [cx + len * 0.2, cy + len - len * 0.25]], color: gc, w: 0.6 });
      prims.push({ kind: 'text', x: cx + 3, y: cy, text: grain, size: 2.8, color: gc, anchor: 'start', baseline: 'middle' });
    } else {
      prims.push({ kind: 'line', x1: cx - len, y1: cy, x2: cx + len, y2: cy, color: gc, w: 0.6 });
      prims.push({ kind: 'polyline', pts: [[cx + len - len * 0.25, cy - len * 0.2], [cx + len, cy], [cx + len - len * 0.25, cy + len * 0.2]], color: gc, w: 0.6 });
      prims.push({ kind: 'text', x: cx, y: cy + 3, text: grain, size: 2.8, color: gc, anchor: 'middle', baseline: 'hanging' });
    }
  }

  // ── Дополнительные виды по толщине (§11): h × t справа и w × t сверху ─────
  const sideView = { x: S(w) + S(gap), y: 0, w: S(t), h: S(h) };
  const topView = { x: 0, y: -S(gap) - S(t), w: S(w), h: S(t) };
  prims.push({ kind: 'rect', x: sideView.x, y: sideView.y, w: sideView.w, h: sideView.h, stroke: '#1a1b1e', sw: 0.6, fill: '#fbfbfa' });
  prims.push({ kind: 'rect', x: topView.x, y: topView.y, w: topView.w, h: topView.h, stroke: '#1a1b1e', sw: 0.6, fill: '#fbfbfa' });
  prims.push({ kind: 'text', x: S(w) / 2, y: -S(gap) - S(t) - 5, text: `вид сверху ${fmtMm(w)} × ${fmtMm(t)}`, size: 3, color: '#8a919b', anchor: 'middle' });
  prims.push({ kind: 'text', x: sideView.x + sideView.w / 2, y: -5, text: `вид сбоку ${fmtMm(h)} × ${fmtMm(t)}`, size: 3, color: '#8a919b', anchor: 'middle' });

  // ── Присадка на видах (§13) ──────────────────────────────────────────────
  for (const op of ops) {
    const d = ((op.diameter ?? 6) / 2) * k;
    let cx: number, cy: number;
    if (op.face === 'front' || op.face === 'back') { cx = S(op.x); cy = S(op.y); }
    else if (op.face === 'left' || op.face === 'right') { cx = sideView.x + (op.x / Math.max(t, 1)) * sideView.w; cy = S(op.y); }
    else { cx = S(op.x); cy = topView.y + (op.y / Math.max(t, 1)) * topView.h; }
    const color = op.through ? '#e5534b' : '#4c8dff';
    const r = Math.max(d, 1.2);
    prims.push({ kind: 'circle', cx, cy, r, stroke: color, sw: 0.6 });
    if (op.through) {
      prims.push({ kind: 'line', x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r, color, w: 0.5 });
      prims.push({ kind: 'line', x1: cx - r, y1: cy + r, x2: cx + r, y2: cy - r, color, w: 0.5 });
    }
    // Выноска с единым обозначением: «1 Ø5 THRU» / «2 Ø8 × 12» (§15).
    prims.push({
      kind: 'text', x: cx + r + 1, y: cy, text: `${opNumber(op.sequence)} ${holeNotation(op)}`,
      size: 2.4, color, anchor: 'start', baseline: 'middle',
    });
  }

  // ── Габаритные размеры из модели (§12), разведённые без наложений (§35) ───
  const dims: Dimension[] = layoutDimensions([
    { ...hDim(0, S(w), 0, S(gap) + S(t) + 10), value: w },
    { ...vDim(0, S(h), 0, 12), value: h },
    { ...hDim(sideView.x, sideView.x + sideView.w, 0, 12), value: t },
  ]);
  for (const d of dims) prims.push(...renderDimension(d));

  const geometryScene = finalizeScene(prims, 6);

  // ── Таблицы (кромка + присадка) справа от вида, в мм листа ────────────────
  const tablePrimsAll: Prim[] = [];
  const tx = geometryScene.originX + geometryScene.width + 12;
  let ty = geometryScene.originY + geometryScene.height;

  // Кромка: код L1–L4, сторона, толщина, материал кромки (§16).
  const edgeName = (id: string | null) => (id ? project.edges.find((e) => e.id === id)?.name ?? '—' : 'нет');
  const edgeCols: TableColumn[] = [
    { title: 'Код', width: 12 }, { title: 'Сторона', width: 24 },
    { title: 'Толщ', width: 14, align: 'end' }, { title: 'Кромка', width: 44 },
  ];
  tablePrimsAll.push({ kind: 'text', x: tx, y: ty + 4, text: 'Кромка', size: 3.2, bold: true, color: '#1a1b1e', anchor: 'start' });
  tablePrimsAll.push(...tablePrims(tx, ty, edgeCols, EDGE_SIDE_ORDER.map((side) => [
    EDGE_CODES[side],
    EDGE_SIDE_LABELS[side],
    edgeValue(project, part, side),
    edgeName(part.edges[side]),
  ]), { rowHeight: 6, fontSize: 2.8 }));
  ty -= 6 * 5 + 14;

  // Присадка: обозначение, координаты, база, поверхность (§13/§14).
  if (ops.length > 0) {
    const mCols: TableColumn[] = [
      { title: '№', width: 10 }, { title: 'Тип', width: 22 }, { title: 'Обозначение', width: 28 },
      { title: 'X', width: 14, align: 'end' }, { title: 'Y', width: 14, align: 'end' },
      { title: 'База', width: 12 }, { title: 'Сторона', width: 22 },
    ];
    tablePrimsAll.push({ kind: 'text', x: tx, y: ty + 4, text: 'Присадка', size: 3.2, bold: true, color: '#1a1b1e', anchor: 'start' });
    tablePrimsAll.push(...tablePrims(tx, ty, mCols, ops.map((op) => [
      opNumber(op.sequence),
      machiningTypeLabel(op.type),
      holeNotation(op),
      fmtMm(op.x),
      fmtMm(op.y),
      operationDatum(op),
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
      material: partMaterialNotation(project, part),
      scale: label,
      date: new Date().toLocaleDateString('ru-RU'),
      sheet,
      sheetsTotal: total,
      revision: opts.revision,
    },
  };
}

export interface PartsDocumentOptions {
  /** Фильтр деталей (§65) — только оформление, модель не меняется. */
  filter?: string;
  revision?: string;
  /** Построить чертёж только этой детали (печать одной детали, §63). */
  onlyPartId?: string;
}

/** Документ «Деталировка»: по странице на каждую деталь. */
export function buildPartsDocument(project: Project, opts: PartsDocumentOptions = {}): DrawingDocument {
  const ops = allOperations(project);
  let parts = allParts(project).filter((p) => p.metadata?.hidden !== true);
  parts = filterParts(parts, opts.filter as PartFilterKey | undefined);
  if (opts.onlyPartId) parts = parts.filter((p) => String(p.id) === opts.onlyPartId);

  const pages = parts.map((part, i) =>
    buildPartPage(project, part, ops.filter((o) => o.partId === part.id), i + 1, parts.length, { revision: opts.revision }),
  );
  return {
    id: `doc-parts-${project.id}`,
    type: 'PART_DRAWING',
    projectId: project.id,
    partId: opts.onlyPartId ? parts[0]?.id : undefined,
    title: 'Деталировка',
    pages,
    metadata: { filter: opts.filter ?? 'all', partCount: parts.length },
  };
}
