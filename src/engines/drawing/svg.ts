/**
 * Рендер страницы чертежа в НАСТОЯЩИЙ SVG (векторный, не скриншот):
 * рамка листа + основная надпись + масштабированное содержимое сцены.
 * Текст рендерится в мм листа (не масштабируется), геометрия — по масштабу.
 */
import type { Prim } from './scene';
import {
  contentArea,
  MARGIN,
  resolveScale,
  sheetSize,
  titleBlockPrims,
  type DrawingDocument,
  type DrawingPage,
} from './sheet';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function primToSvg(p: Prim): string {
  switch (p.kind) {
    case 'line':
      return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${p.color ?? '#1a1b1e'}" stroke-width="${p.w ?? 0.5}"${p.dash ? ` stroke-dasharray="${p.dash}"` : ''}/>`;
    case 'rect':
      return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${p.fill ?? 'none'}" stroke="${p.stroke ?? 'none'}" stroke-width="${p.sw ?? 0.5}"${p.dash ? ` stroke-dasharray="${p.dash}"` : ''}/>`;
    case 'circle':
      return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${p.fill ?? 'none'}" stroke="${p.stroke ?? '#1a1b1e'}" stroke-width="${p.sw ?? 0.5}"/>`;
    case 'polyline': {
      const pts = p.pts.map(([x, y]) => `${x},${y}`).join(' ');
      const tag = p.closed ? 'polygon' : 'polyline';
      return `<${tag} points="${pts}" fill="${p.fill ?? 'none'}" stroke="${p.color ?? '#1a1b1e'}" stroke-width="${p.w ?? 0.5}"/>`;
    }
    case 'text': {
      const anchor = p.anchor === 'end' ? 'end' : p.anchor === 'middle' ? 'middle' : 'start';
      const baseline = p.baseline === 'middle' ? 'central' : p.baseline === 'hanging' ? 'hanging' : 'auto';
      return `<text x="${p.x}" y="${p.y}" font-size="${p.size ?? 3}" fill="${p.color ?? '#1a1b1e'}" text-anchor="${anchor}" dominant-baseline="${baseline}"${p.bold ? ' font-weight="600"' : ''} font-family="Arial, sans-serif">${esc(p.text)}</text>`;
    }
  }
}

/** Спроецировать сцену (мм, ось Y вверх) в лист (мм, ось Y вниз) с масштабом. */
function projectPrim(p: Prim, s: number, offX: number, bottomY: number, originX: number, originY: number): Prim {
  const X = (x: number) => offX + (x - originX) * s;
  const Y = (y: number) => bottomY - (y - originY) * s;
  switch (p.kind) {
    case 'line': return { ...p, x1: X(p.x1), y1: Y(p.y1), x2: X(p.x2), y2: Y(p.y2) };
    case 'rect': return { ...p, x: X(p.x), y: Y(p.y + p.h), w: p.w * s, h: p.h * s };
    case 'circle': return { ...p, cx: X(p.cx), cy: Y(p.cy), r: p.r * s };
    case 'polyline': return { ...p, pts: p.pts.map(([x, y]) => [X(x), Y(y)] as [number, number]) };
    case 'text': return { ...p, x: X(p.x), y: Y(p.y) }; // размер текста — в мм листа, не масштабируется
  }
}

export function renderPageSvg(page: DrawingPage): string {
  const sz = sheetSize(page.format, page.orientation);
  const area = contentArea(page.format, page.orientation);
  const { factor, label } = resolveScale(page.scale, page.scene, area);

  const contentW = page.scene.width * factor;
  const contentH = page.scene.height * factor;
  const offX = area.x + (area.w - contentW) / 2;
  const bottomY = area.y + area.h - (area.h - contentH) / 2;

  const body: string[] = [];
  // Рамка листа.
  body.push(`<rect x="0" y="0" width="${sz.w}" height="${sz.h}" fill="#ffffff" stroke="none"/>`);
  body.push(`<rect x="${MARGIN}" y="${MARGIN}" width="${sz.w - 2 * MARGIN}" height="${sz.h - 2 * MARGIN}" fill="none" stroke="#1a1b1e" stroke-width="0.7"/>`);
  // Содержимое.
  for (const prim of page.scene.prims) {
    body.push(primToSvg(projectPrim(prim, factor, offX, bottomY, page.scene.originX, page.scene.originY)));
  }
  // Штамп: при AUTO берём вычисленный масштаб, иначе — заданный построителем.
  const tb = { ...page.title, scale: page.scale === 'AUTO' ? label : page.title.scale };
  for (const prim of titleBlockPrims(sz.w, sz.h, tb)) body.push(primToSvg(prim));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz.w}mm" height="${sz.h}mm" viewBox="0 0 ${sz.w} ${sz.h}">${body.join('')}</svg>`;
}

/** Все страницы документа как отдельные SVG. */
export function documentToSvgPages(doc: DrawingDocument): string[] {
  return doc.pages.map((p) => renderPageSvg(p));
}
