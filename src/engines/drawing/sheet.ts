/**
 * Форматы листов (A4–A0), масштаб, рамка и основная надпись (штамп).
 */
import type { Prim, Scene2D } from './scene';
import type { PartId, ProjectId } from '@/core/model/ids';

export type SheetFormat = 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
export type Orientation = 'PORTRAIT' | 'LANDSCAPE';
export type ScaleValue = number | 'AUTO';

export type DocumentType =
  | 'ASSEMBLY_DRAWING'
  | 'PART_DRAWING'
  | 'CUTTING_DRAWING'
  | 'MACHINING_DRAWING'
  | 'SPECIFICATION'
  | 'HARDWARE_LIST'
  | 'PRODUCTION_REPORT';

export interface TitleBlock {
  project: string;
  title: string;
  partNumber?: string;
  material?: string;
  scale: string;
  date: string;
  sheet: number;
  sheetsTotal: number;
}

export interface DrawingPage {
  scene: Scene2D;
  title: TitleBlock;
  format: SheetFormat;
  orientation: Orientation;
  scale: ScaleValue;
  partId?: PartId;
}

export interface DrawingDocument {
  id: string;
  type: DocumentType;
  projectId: ProjectId;
  partId?: PartId;
  title: string;
  pages: DrawingPage[];
  metadata?: Record<string, unknown>;
}

/** Размеры формата в мм (базово — альбомная ориентация). */
const A_LANDSCAPE: Record<SheetFormat, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
  A1: { w: 841, h: 594 },
  A0: { w: 1189, h: 841 },
};

export function sheetSize(format: SheetFormat, orientation: Orientation): { w: number; h: number } {
  const base = A_LANDSCAPE[format];
  return orientation === 'PORTRAIT' ? { w: base.h, h: base.w } : base;
}

export const MARGIN = 10;
export const TITLE_W = 185;
export const TITLE_H = 40;

const STD_SCALES = [1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100, 1 / 200];

/** Область для содержимого чертежа внутри рамки (мм). */
export function contentArea(format: SheetFormat, orientation: Orientation): { x: number; y: number; w: number; h: number } {
  const s = sheetSize(format, orientation);
  return {
    x: MARGIN + 4,
    y: MARGIN + 4,
    w: s.w - 2 * MARGIN - 8,
    h: s.h - 2 * MARGIN - 8 - TITLE_H,
  };
}

/** Подобрать стандартный масштаб под область (AUTO). */
export function resolveScale(scale: ScaleValue, scene: Scene2D, area: { w: number; h: number }): { factor: number; label: string } {
  if (scale !== 'AUTO') {
    return { factor: scale, label: scaleLabel(scale) };
  }
  const fit = Math.min(area.w / Math.max(scene.width, 1), area.h / Math.max(scene.height, 1));
  const chosen = STD_SCALES.find((s) => s <= fit) ?? STD_SCALES[STD_SCALES.length - 1];
  const factor = fit >= 1 ? 1 : chosen;
  return { factor, label: scaleLabel(factor) };
}

export function scaleLabel(factor: number): string {
  if (factor >= 1) return '1:1';
  const denom = Math.round(1 / factor);
  return `1:${denom}`;
}

/** Примитивы штампа (в координатах листа, мм — не масштабируются). */
export function titleBlockPrims(sheetW: number, sheetH: number, tb: TitleBlock): Prim[] {
  const x = sheetW - MARGIN - TITLE_W;
  const y = sheetH - MARGIN - TITLE_H;
  const out: Prim[] = [];
  out.push({ kind: 'rect', x, y, w: TITLE_W, h: TITLE_H, stroke: '#c8cdd6', sw: 0.6, fill: 'none' });
  // горизонтальные линии
  out.push({ kind: 'line', x1: x, y1: y + 13, x2: x + TITLE_W, y2: y + 13, color: '#c8cdd6', w: 0.4 });
  out.push({ kind: 'line', x1: x, y1: y + 26, x2: x + TITLE_W, y2: y + 26, color: '#c8cdd6', w: 0.4 });
  const cell = (cx: number, cy: number, label: string, value: string) => {
    out.push({ kind: 'text', x: cx, y: cy, text: label, size: 2.4, color: '#8a919b', anchor: 'start', baseline: 'hanging' });
    out.push({ kind: 'text', x: cx, y: cy + 4.5, text: value, size: 3.2, color: '#1a1b1e', anchor: 'start', baseline: 'hanging', bold: true });
  };
  cell(x + 3, y + 2, 'Проект', tb.project);
  cell(x + TITLE_W / 2 + 3, y + 2, 'Деталь', `${tb.partNumber ? tb.partNumber + ' ' : ''}${tb.title}`);
  cell(x + 3, y + 15, 'Материал', tb.material ?? '—');
  cell(x + TITLE_W / 2 + 3, y + 15, 'Масштаб', tb.scale);
  cell(x + 3, y + 28, 'Дата', tb.date);
  cell(x + TITLE_W / 2 + 3, y + 28, 'Лист', `${tb.sheet} / ${tb.sheetsTotal}`);
  return out;
}
