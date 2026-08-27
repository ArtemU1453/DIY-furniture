/**
 * GENERAL_VIEW (§9/§10) — общий вид изделия в выбранных пользователем видах.
 *
 * Пользователь выбирает, какие из FRONT/BACK/LEFT/RIGHT/TOP/BOTTOM/ISOMETRIC
 * показывать, и масштаб (1:1 … 1:10, 2:1 или FIT). Своей геометрии модуль не
 * заводит: каждый вид — проекция мировых габаритов деталей на две оси.
 */
import type { Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { partWorldAABB, type AABB } from '@/core/geometry/partGeometry';
import { finalizeScene, type Prim } from './scene';
import { hDim, renderDimension, vDim } from './dimensions';
import { pickScale } from './layout';
import { fmtMm } from './notation';
import {
  VIEW_LABELS,
  type DrawingDocument,
  type DrawingPage,
  type Orientation,
  type ScaleValue,
  type SheetFormat,
  type ViewName,
} from './sheet';

const ORIENT: Orientation = 'LANDSCAPE';

/** Виды по умолчанию, если пользователь ничего не выбрал. */
export const DEFAULT_VIEWS: ViewName[] = ['FRONT', 'LEFT', 'TOP'];

interface Bounds {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

function modelBounds(boxes: AABB[]): Bounds {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.min.x); minY = Math.min(minY, b.min.y); minZ = Math.min(minZ, b.min.z);
    maxX = Math.max(maxX, b.max.x); maxY = Math.max(maxY, b.max.y); maxZ = Math.max(maxZ, b.max.z);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, minZ: 0, maxX: 800, maxY: 2000, maxZ: 600 };
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * Проекция бокса на плоскость вида: возвращает прямоугольник (u, v, du, dv)
 * в координатах вида, где u — горизонталь, v — вертикаль.
 *
 * Задняя и правая проекции зеркалят горизонталь, вид снизу — вертикаль, чтобы
 * взаимное расположение деталей соответствовало взгляду с этой стороны.
 */
function projectBox(view: ViewName, b: AABB, m: Bounds): { u: number; v: number; du: number; dv: number } {
  const W = m.maxX - m.minX, D = m.maxZ - m.minZ;
  const x0 = b.min.x - m.minX, y0 = b.min.y - m.minY, z0 = b.min.z - m.minZ;
  const dx = b.max.x - b.min.x, dy = b.max.y - b.min.y, dz = b.max.z - b.min.z;
  switch (view) {
    case 'FRONT': return { u: x0, v: y0, du: dx, dv: dy };
    case 'BACK': return { u: W - x0 - dx, v: y0, du: dx, dv: dy };
    case 'LEFT': return { u: z0, v: y0, du: dz, dv: dy };
    case 'RIGHT': return { u: D - z0 - dz, v: y0, du: dz, dv: dy };
    case 'TOP': return { u: x0, v: z0, du: dx, dv: dz };
    case 'BOTTOM': return { u: x0, v: D - z0 - dz, du: dx, dv: dz };
    case 'ISOMETRIC': {
      // Изометрия: косоугольная проекция глубины под 30° (без перспективы).
      const k = 0.5;
      return { u: x0 + z0 * k, v: y0 + z0 * k * 0.58, du: dx, dv: dy };
    }
  }
}

/** Габариты вида в мм модели. */
function viewSize(view: ViewName, m: Bounds): { w: number; h: number } {
  const W = m.maxX - m.minX, H = m.maxY - m.minY, D = m.maxZ - m.minZ;
  switch (view) {
    case 'FRONT': case 'BACK': return { w: W, h: H };
    case 'LEFT': case 'RIGHT': return { w: D, h: H };
    case 'TOP': case 'BOTTOM': return { w: W, h: D };
    case 'ISOMETRIC': return { w: W + D * 0.5, h: H + D * 0.29 };
  }
}

/** Размеры, подписываемые под видом: [ширина, высота] в мм модели. */
function viewDims(view: ViewName, m: Bounds): { w: number; h: number } {
  return viewSize(view, m);
}

export interface GeneralViewOptions {
  views?: ViewName[];
  scale?: ScaleValue;
  format?: SheetFormat;
  revision?: string;
}

export function buildGeneralViewDocument(project: Project, opts: GeneralViewOptions = {}): DrawingDocument {
  const views = (opts.views?.length ? opts.views : DEFAULT_VIEWS).slice();
  const format: SheetFormat = opts.format ?? 'A3';
  const parts = allParts(project).filter((p) => p.metadata?.hidden !== true);
  const boxes = parts.map((p) => partWorldAABB(p));
  const m = modelBounds(boxes);

  // Раскладка: виды в ряд слева направо с зазором.
  const sizes = views.map((v) => viewSize(v, m));
  const maxH = Math.max(...sizes.map((s) => s.h), 1);
  const totalW = sizes.reduce((n, s) => n + s.w, 0);
  const gap = Math.max(maxH, totalW) * 0.12 + 40;
  const rawW = totalW + gap * Math.max(views.length - 1, 0) + 60;
  const rawH = maxH + 60;

  // Масштаб: заданный пользователем либо подобранный под лист (FIT).
  const auto = pickScale(rawW, rawH, format, ORIENT);
  const scale = opts.scale ?? 'AUTO';
  const k = scale === 'AUTO' ? auto.k : scale;
  const label = scale === 'AUTO' ? auto.label : scaleText(scale);
  const S = (v: number) => v * k;

  const prims: Prim[] = [];
  let ox = 0;
  views.forEach((view, vi) => {
    const size = sizes[vi];
    for (const b of boxes) {
      const r = projectBox(view, b, m);
      prims.push({
        kind: 'rect', x: ox + S(r.u), y: S(r.v), w: S(r.du), h: S(r.dv),
        stroke: '#33373d', sw: 0.4, fill: 'none',
      });
    }
    // Подпись вида.
    prims.push({
      kind: 'text', x: ox + S(size.w) / 2, y: -8, text: VIEW_LABELS[view],
      size: 3.6, color: '#5a6472', anchor: 'middle',
    });
    // Габаритные размеры вида (значения — из модели, не из пикселей).
    const d = viewDims(view, m);
    prims.push(...renderDimension(hDim(ox, ox + S(size.w), 0, 16)).map((p) => setVal(p, d.w)));
    if (vi === 0) {
      prims.push(...renderDimension(vDim(0, S(size.h), ox, 14)).map((p) => setVal(p, d.h)));
    }
    ox += S(size.w) + S(gap);
  });

  const furniture = project.furnitures[0];
  const page: DrawingPage = {
    scene: finalizeScene(prims, 10),
    format,
    orientation: ORIENT,
    scale: 1,
    title: {
      project: project.name,
      title: furniture?.name ?? 'Общий вид',
      material: '—',
      scale: label,
      date: new Date().toLocaleDateString('ru-RU'),
      sheet: 1,
      sheetsTotal: 1,
      revision: opts.revision,
    },
  };
  return {
    id: `doc-generalview-${project.id}`,
    type: 'GENERAL_VIEW',
    projectId: project.id,
    title: 'Общий вид',
    pages: [page],
    metadata: { views },
  };
}

function scaleText(factor: number): string {
  return factor > 1 ? `${fmtMm(factor)}:1` : factor === 1 ? '1:1' : `1:${fmtMm(1 / factor)}`;
}

function setVal(p: Prim, real: number): Prim {
  if (p.kind === 'text' && /^[\d.]+$/.test(p.text)) return { ...p, text: fmtMm(real) };
  return p;
}
