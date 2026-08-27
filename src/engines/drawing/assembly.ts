/**
 * ASSEMBLY_DRAWING — сборочный чертёж изделия: вид спереди / сбоку / сверху с
 * габаритными размерами (ширина/высота/глубина). Всё выводится из модели.
 */
import type { Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { partWorldAABB, type AABB } from '@/core/geometry/partGeometry';
import { finalizeScene, type Prim } from './scene';
import { hDim, renderDimension, vDim } from './dimensions';
import { pickScale } from './layout';
import { positionNumbers } from './positions';
import { fmtMm } from './notation';
import type { Balloon } from './drawingModel';
import type { DrawingDocument, DrawingPage, Orientation, SheetFormat } from './sheet';

const FORMAT: SheetFormat = 'A3';
const ORIENT: Orientation = 'LANDSCAPE';

export function buildAssemblyDocument(project: Project): DrawingDocument {
  const parts = allParts(project).filter((p) => p.metadata?.hidden !== true);
  const boxes: AABB[] = parts.map((p) => partWorldAABB(p));

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.min.x); minY = Math.min(minY, b.min.y); minZ = Math.min(minZ, b.min.z);
    maxX = Math.max(maxX, b.max.x); maxY = Math.max(maxY, b.max.y); maxZ = Math.max(maxZ, b.max.z);
  }
  if (!Number.isFinite(minX)) { minX = minY = minZ = 0; maxX = 800; maxY = 2000; maxZ = 600; }
  const W = maxX - minX, H = maxY - minY, D = maxZ - minZ;
  const gap = Math.max(W, H, D) * 0.2 + 60;

  const { k, label } = pickScale(W + gap + D + 60, H + gap + D + 60, FORMAT, ORIENT);
  const S = (v: number) => v * k;
  const prims: Prim[] = [];

  const rect = (x: number, y: number, w: number, h: number) => prims.push({ kind: 'rect', x, y, w, h, stroke: '#33373d', sw: 0.4, fill: 'none' });

  // Вид спереди (XY) + позиционные выноски (§21/§22).
  const positions = positionNumbers(project);
  const shownPositions = new Set<number>();
  /* Балоны — позиционные номера, а не P-ID. Связь позиция → partId сохраняется
   * в metadata документа, чтобы по клику на выноске можно было открыть деталь. */
  const balloons: Balloon[] = [];
  parts.forEach((p, i) => {
    const b = boxes[i];
    rect(S(b.min.x - minX), S(b.min.y - minY), S(b.max.x - b.min.x), S(b.max.y - b.min.y));
    const pos = positions.get(p.id);
    // Балон позиции — по одному на каждую уникальную позицию (не загромождаем).
    if (pos !== undefined && !shownPositions.has(pos)) {
      shownPositions.add(pos);
      const cx = S((b.min.x + b.max.x) / 2 - minX);
      const cy = S((b.min.y + b.max.y) / 2 - minY);
      prims.push({ kind: 'circle', cx, cy, r: 5, stroke: '#1a1b1e', sw: 0.4, fill: '#ffffff' });
      prims.push({ kind: 'text', x: cx, y: cy, text: String(pos), size: 3.4, bold: true, color: '#1a1b1e', anchor: 'middle', baseline: 'middle' });
      balloons.push({ id: `balloon-${pos}`, position: pos, partId: p.id, x: cx, y: cy });
    }
  });
  // Вид сбоку (ZY) справа.
  const sideOx = S(W) + S(gap);
  for (const b of boxes) rect(sideOx + S(b.min.z - minZ), S(b.min.y - minY), S(b.max.z - b.min.z), S(b.max.y - b.min.y));
  // Вид сверху (XZ) снизу.
  const topOy = -S(gap) - S(D);
  for (const b of boxes) rect(S(b.min.x - minX), topOy + S(b.min.z - minZ), S(b.max.x - b.min.x), S(b.max.z - b.min.z));

  prims.push({ kind: 'text', x: S(W) / 2, y: S(H) + 6, text: 'спереди', size: 3.5, color: '#8a919b', anchor: 'middle' });
  prims.push({ kind: 'text', x: sideOx + S(D) / 2, y: S(H) + 6, text: 'сбоку', size: 3.5, color: '#8a919b', anchor: 'middle' });
  prims.push({ kind: 'text', x: S(W) / 2, y: topOy - 6, text: 'сверху', size: 3.5, color: '#8a919b', anchor: 'middle' });

  // Габаритные размеры.
  prims.push(...renderDimension(hDim(0, S(W), 0, S(gap) + S(D) + 16)).map((p) => setVal(p, W)));
  prims.push(...renderDimension(vDim(0, S(H), 0, 16)).map((p) => setVal(p, H)));
  prims.push(...renderDimension(hDim(sideOx, sideOx + S(D), 0, 16)).map((p) => setVal(p, D)));

  const scene = finalizeScene(prims, 10);
  const furniture = project.furnitures[0];
  const page: DrawingPage = {
    scene,
    format: FORMAT,
    orientation: ORIENT,
    scale: 1,
    title: {
      project: project.name,
      title: furniture?.name ?? 'Изделие',
      material: '—',
      scale: label,
      date: new Date().toLocaleDateString('ru-RU'),
      sheet: 1,
      sheetsTotal: 1,
    },
  };
  return {
    id: `doc-assembly-${project.id}`,
    type: 'ASSEMBLY_DRAWING',
    projectId: project.id,
    title: 'Сборочный чертёж',
    pages: [page],
    metadata: {
      balloons,
      // Связь позиция → partId (§21): позиция не заменяет P-ID, а ссылается на него.
      positionToPart: Object.fromEntries(balloons.map((b) => [b.position, String(b.partId)])),
      hardwareCount: project.hardware.length,
      connectionCount: project.hardwareConnections.length,
    },
  };
}

function setVal(p: Prim, real: number): Prim {
  if (p.kind === 'text' && /^[\d.]+$/.test(p.text)) return { ...p, text: fmtMm(real) };
  return p;
}
