import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CuttingSheetResult, GrainDirection, Placement } from '@/core/model/types';

const SHEET_GAP = 200; // мм между листами на карте

/** Флаги наличия кромки по сторонам детали (в системе координат раскладки). */
export interface EdgeFlags {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

/** Императивный API управления масштабом карты. */
export interface CuttingMapHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  reset100: () => void;
}

interface SheetLayout {
  sheet: CuttingSheetResult;
  originX: number;
  originY: number;
}

interface Props {
  sheets: CuttingSheetResult[];
  selectedPieceId: string | null;
  manual: boolean;
  showCuts?: boolean;
  onSelect: (pieceId: string | null) => void;
  onMove: (pieceId: string, sheetIndex: number, x: number, y: number) => void;
  grainOf?: (p: Placement) => GrainDirection;
  edgesOf?: (p: Placement) => EdgeFlags | undefined;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Карта раскроя: SVG-визуализация реального результата с zoom/pan и выбором. */
export const CuttingMap = forwardRef<CuttingMapHandle, Props>(function CuttingMap(
  { sheets, selectedPieceId, manual, showCuts = true, onSelect, onMove, grainOf, edgesOf },
  ref,
) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const layouts = useMemo<SheetLayout[]>(() => {
    const out: SheetLayout[] = [];
    let y = 0;
    for (const sheet of sheets) {
      out.push({ sheet, originX: 0, originY: y });
      y += sheet.width + SHEET_GAP;
    }
    return out;
  }, [sheets]);

  const contentBox = useMemo<ViewBox>(() => {
    const maxL = Math.max(1, ...sheets.map((s) => s.length));
    const totalH = layouts.length ? layouts[layouts.length - 1].originY + sheets[sheets.length - 1].width : 1;
    const pad = maxL * 0.06;
    return { x: -pad, y: -pad, w: maxL + 2 * pad, h: totalH + 2 * pad };
  }, [sheets, layouts]);

  const [vb, setVb] = useState<ViewBox>(contentBox);
  useEffect(() => setVb(contentBox), [contentBox]);

  // Императивный API масштаба.
  useImperativeHandle(ref, () => ({
    zoomIn: () => setVb((v) => zoomAroundCenter(v, 1 / 1.25)),
    zoomOut: () => setVb((v) => zoomAroundCenter(v, 1.25)),
    fit: () => setVb(contentBox),
    reset100: () => {
      // 100%: 1 мм = 1 px по текущему размеру viewport.
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      setVb((v) => ({ x: v.x + v.w / 2 - rect.width / 2, y: v.y + v.h / 2 - rect.height / 2, w: rect.width, h: rect.height }));
    },
  }), [contentBox]);

  const toWorld = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const w = pt.matrixTransform(m.inverse());
    return { x: w.x, y: w.y };
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    setVb((v) => ({ x: p.x - (p.x - v.x) * factor, y: p.y - (p.y - v.y) * factor, w: v.w * factor, h: v.h * factor }));
  };

  const pan = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ pieceId: string; sheetIndex: number; length: number; width: number; dx: number; dy: number } | null>(null);
  const [ghost, setGhost] = useState<{ pieceId: string; x: number; y: number } | null>(null);

  const onPointerDownBg = (e: React.PointerEvent) => {
    if (drag.current) return;
    pan.current = toWorld(e.clientX, e.clientY);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = toWorld(e.clientX, e.clientY);
    if (drag.current) {
      setGhost({ pieceId: drag.current.pieceId, x: p.x - drag.current.dx, y: p.y - drag.current.dy });
      return;
    }
    if (pan.current) {
      setVb((v) => ({ x: v.x - (p.x - pan.current!.x), y: v.y - (p.y - pan.current!.y), w: v.w, h: v.h }));
    }
  };
  const onPointerUp = () => {
    if (drag.current && ghost) {
      const d = drag.current;
      const layout = layouts[d.sheetIndex];
      const localX = ghost.x - layout.originX;
      const localY = layout.sheet.width - (ghost.y - layout.originY) - d.width;
      onMove(d.pieceId, d.sheetIndex, Math.round(localX), Math.round(localY));
    }
    drag.current = null;
    pan.current = null;
    setGhost(null);
  };

  const startDrag = (e: React.PointerEvent, layout: SheetLayout, p: Placement, worldX: number, worldY: number) => {
    if (!manual) return;
    e.stopPropagation();
    const w = toWorld(e.clientX, e.clientY);
    drag.current = { pieceId: p.pieceId, sheetIndex: layout.sheet.index, length: p.length, width: p.width, dx: w.x - worldX, dy: w.y - worldY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ background: '#0f1012', cursor: pan.current ? 'grabbing' : 'default', touchAction: 'none' }}
      onWheel={onWheel}
      onPointerDown={onPointerDownBg}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      data-vb={`${Math.round(vb.w)}`}
    >
      {layouts.map((layout) => {
        const { sheet, originX, originY } = layout;
        const flipY = (y: number, h: number) => originY + (sheet.width - (y + h));
        const sw = vb.w * 0.001;
        return (
          <g key={sheet.id}>
            <rect x={originX} y={originY} width={sheet.length} height={sheet.width} fill="#16171a" stroke="#5a6472" strokeWidth={vb.w * 0.0015} />
            <rect
              x={originX + sheet.trim.left}
              y={originY + sheet.trim.top}
              width={sheet.length - sheet.trim.left - sheet.trim.right}
              height={sheet.width - sheet.trim.top - sheet.trim.bottom}
              fill="none"
              stroke="#3a3d43"
              strokeDasharray={`${vb.w * 0.006} ${vb.w * 0.004}`}
              strokeWidth={sw}
            />
            <text x={originX} y={originY - vb.w * 0.012} fill="#9aa0a6" fontSize={vb.w * 0.02}>
              Лист {sheet.index + 1}{sheet.fromRemnant ? ' (остаток)' : ''} · {Math.round(sheet.utilization * 100)}%
            </text>

            {/* Линии реза. */}
            {showCuts && sheet.cuts.map((c) => (
              <line
                key={c.id}
                x1={originX + c.x1}
                y1={c.orientation === 'horizontal' ? flipY(c.y1, 0) : flipY(c.y1, 0)}
                x2={originX + c.x2}
                y2={c.orientation === 'horizontal' ? flipY(c.y2, 0) : flipY(c.y2, 0)}
                stroke="#39506e"
                strokeWidth={sw * 0.7}
                strokeDasharray={`${vb.w * 0.008} ${vb.w * 0.005}`}
              />
            ))}

            {/* Остатки: полезные — зелёные, отход — серые. */}
            {sheet.remnants.map((r) => (
              <rect key={r.id} x={originX + r.x} y={flipY(r.y, r.height)} width={r.width} height={r.height} fill="none" stroke={r.usable ? '#4caf7d' : '#6b6f76'} strokeDasharray={`${vb.w * 0.004} ${vb.w * 0.004}`} strokeWidth={sw} />
            ))}

            {/* Детали. */}
            {sheet.placements.map((p) => {
              const wx = originX + p.x;
              const wy = flipY(p.y, p.width);
              const sel = p.pieceId === selectedPieceId;
              const gh = ghost?.pieceId === p.pieceId ? ghost : null;
              const grain = grainOf?.(p) ?? 'none';
              const edges = edgesOf?.(p);
              return (
                <g
                  key={p.pieceId}
                  transform={gh ? `translate(${gh.x - wx}, ${gh.y - wy})` : undefined}
                  onClick={(e) => { e.stopPropagation(); onSelect(p.pieceId); }}
                  onPointerDown={(e) => startDrag(e, layout, p, wx, wy)}
                  style={{ cursor: manual ? 'move' : 'pointer' }}
                >
                  <title>{`${p.number} ${p.name}\n${Math.round(p.length)} × ${Math.round(p.width)}${p.rotation ? ' (повёрнута)' : ''}`}</title>
                  <rect x={wx} y={wy} width={p.length} height={p.width} fill={sel ? '#37507a' : p.origin === 'manual' ? '#4a3b2a' : '#28303c'} stroke={sel ? '#4c8dff' : '#7f8ea3'} strokeWidth={vb.w * (sel ? 0.002 : 0.001)} />
                  {/* Кромка (толстые линии по сторонам с кромкой). */}
                  {edges && <EdgeLines x={wx} y={wy} w={p.length} h={p.width} edges={edges} sw={sw * 2.5} />}
                  {/* Стрелка направления текстуры. */}
                  {grain !== 'none' && (
                    <GrainArrow x={wx} y={wy} w={p.length} h={p.width} grain={grain} rotation={p.rotation} />
                  )}
                  <text x={wx + p.length / 2} y={wy + p.width / 2} fill="#e6e7e9" fontSize={Math.min(p.length, p.width) * 0.3} textAnchor="middle" dominantBaseline="middle" style={{ pointerEvents: 'none' }}>{p.number}</text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
});

function zoomAroundCenter(v: ViewBox, factor: number): ViewBox {
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  return { x: cx - (v.w * factor) / 2, y: cy - (v.h * factor) / 2, w: v.w * factor, h: v.h * factor };
}

/** Толстые линии по сторонам детали, где есть кромка. */
function EdgeLines({ x, y, w, h, edges, sw }: { x: number; y: number; w: number; h: number; edges: EdgeFlags; sw: number }) {
  const c = '#e0a94c';
  return (
    <g style={{ pointerEvents: 'none' }}>
      {edges.left && <line x1={x} y1={y} x2={x} y2={y + h} stroke={c} strokeWidth={sw} />}
      {edges.right && <line x1={x + w} y1={y} x2={x + w} y2={y + h} stroke={c} strokeWidth={sw} />}
      {edges.top && <line x1={x} y1={y} x2={x + w} y2={y} stroke={c} strokeWidth={sw} />}
      {edges.bottom && <line x1={x} y1={y + h} x2={x + w} y2={y + h} stroke={c} strokeWidth={sw} />}
    </g>
  );
}

/** Стрелка направления волокна (→ вдоль длины листа, ↓ поперёк). */
function GrainArrow({ x, y, w, h, grain, rotation }: { x: number; y: number; w: number; h: number; grain: GrainDirection; rotation: number }) {
  // Грань «длины» детали идёт вдоль X, если деталь не повёрнута.
  const alongX = (grain === 'length') !== (rotation === 90);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const len = Math.min(w, h) * 0.3;
  const p = alongX
    ? { x1: cx - len, y1: cy, x2: cx + len, y2: cy }
    : { x1: cx, y1: cy - len, x2: cx, y2: cy + len };
  const head = alongX
    ? `${p.x2},${p.y2} ${p.x2 - len * 0.3},${p.y2 - len * 0.25} ${p.x2 - len * 0.3},${p.y2 + len * 0.25}`
    : `${p.x2},${p.y2} ${p.x2 - len * 0.25},${p.y2 - len * 0.3} ${p.x2 + len * 0.25},${p.y2 - len * 0.3}`;
  return (
    <g stroke="#8fa3c4" fill="#8fa3c4" strokeWidth={Math.min(w, h) * 0.02} style={{ pointerEvents: 'none' }}>
      <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} />
      <polygon points={head} />
    </g>
  );
}
