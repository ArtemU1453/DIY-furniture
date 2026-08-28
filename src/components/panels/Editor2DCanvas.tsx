import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PLANE_AXES,
  cullEntities,
  distanceHints,
  edgeSymbols,
  entityAt,
  holeSymbols,
  markSelection,
  normalizeBounds,
  rectOf,
  screenToWorld,
  selectInRect,
  snapRect,
  worldToScreen,
  type EditorEntity,
  type Editor2DState,
  type ResizeHandle,
  type SnapCandidate,
  type Viewport,
} from '@/engines/editor2d';
import type { Project } from '@/core/model/types';

const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Минимальный экранный габарит объекта, при котором показываются ручки. */
const HANDLE_MIN_PX = 26;
/** Вынос ручек за границу габарита, пикселей. */
const HANDLE_OFFSET = 5;

/** Цвет сущности — только через переменные темы (§107/§108). */
const FILL: Record<EditorEntity['entityType'], string> = {
  MODULE: 'var(--editor-module, rgba(90,156,248,0.10))',
  PART: 'var(--editor-part, rgba(150,160,175,0.18))',
  HARDWARE: 'var(--editor-hardware, rgba(224,160,48,0.35))',
  CONNECTION: 'transparent',
  REFERENCE: 'transparent',
};

const STATUS_STROKE: Record<string, string> = {
  ERROR: 'var(--danger, #e05252)',
  WARNING: 'var(--warn, #e0a030)',
  DIRTY: 'var(--warn, #e0a030)',
  VALID: 'var(--border, #3a3d43)',
};

export interface Editor2DCanvasProps {
  project: Project;
  entities: EditorEntity[];
  ui: Editor2DState;
  /** Изменение камеры — состояние интерфейса, не модель. */
  onViewChange: (patch: { zoom?: number; panX?: number; panY?: number }) => void;
  onSelect: (ids: string[], additive: boolean) => void;
  /** Завершённое перемещение: дельта в мм на плоскости вида (§153). */
  onMove: (ids: string[], dx: number, dy: number) => void;
  /** Завершённое изменение размера (§153). */
  onResize: (id: string, handle: ResizeHandle, width: number, height: number) => void;
  /** Двойной клик по объекту. */
  onActivate?: (id: string) => void;
  onContextMenu?: (id: string | null, at: { x: number; y: number }) => void;
  /** Создать направляющую перетаскиванием с линейки (§49). */
  onCreateGuide?: (orientation: 'horizontal' | 'vertical', position: number) => void;
  /** Точки замера для инструмента «Размер» (§53/§54). */
  onMeasure?: (from: { x: number; y: number }, to: { x: number; y: number }) => void;
}

interface DragState {
  kind: 'move' | 'resize' | 'marquee' | 'pan' | 'measure';
  startScreen: { x: number; y: number };
  startWorld: { x: number; y: number };
  currentWorld: { x: number; y: number };
  handle?: ResizeHandle;
  entityId?: string;
  /** Камера на момент старта — для панорамы. */
  startPan?: { x: number; y: number };
}

const RULER = 22;

/**
 * Холст 2D-редактора (§6/§7).
 *
 * Рисуется в SVG: один элемент на сущность, а не на пиксель (§121). За
 * пределами видимой области объекты не рисуются вовсе (§127/§128) — на
 * проекте в тысячи деталей это и есть виртуализация.
 *
 * Экранные координаты живут только здесь: наружу отдаются миллиметры (§8).
 */
export function Editor2DCanvas({
  project, entities, ui, onViewChange, onSelect, onMove, onResize,
  onActivate, onContextMenu, onCreateGuide, onMeasure,
}: Editor2DCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const view: Viewport = useMemo(
    () => ({ zoom: ui.zoom, panX: ui.panX, panY: ui.panY, widthPx: size.width, heightPx: size.height }),
    [ui.zoom, ui.panX, ui.panY, size.width, size.height],
  );

  const marked = useMemo(() => markSelection(entities, ui.selection), [entities, ui.selection]);
  const visible = useMemo(() => cullEntities(marked.filter((e) => !e.hidden), view), [marked, view]);

  const selected = useMemo(
    () => marked.filter((e) => ui.selection.includes(e.entityId)),
    [marked, ui.selection],
  );

  const holes = useMemo(
    () => (ui.showMachining ? holeSymbols(project, ui.plane) : []),
    [project, ui.plane, ui.showMachining],
  );
  const edges = useMemo(
    () => (ui.showEdges ? edgeSymbols(project, ui.plane) : []),
    [project, ui.plane, ui.showEdges],
  );

  /** Экранная точка события в мировых координатах, мм. */
  const worldAt = useCallback(
    (e: { clientX: number; clientY: number }): { x: number; y: number } => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, view);
    },
    [view],
  );

  // Живое смещение текущей операции с учётом привязки (§152).
  const liveDelta = useMemo(() => {
    if (!drag || (drag.kind !== 'move' && drag.kind !== 'resize')) return { dx: 0, dy: 0, matches: [] as SnapCandidate[] };
    const raw = { dx: drag.currentWorld.x - drag.startWorld.x, dy: drag.currentWorld.y - drag.startWorld.y };
    const first = selected[0];
    if (!first || drag.kind === 'resize') return { ...raw, matches: [] as SnapCandidate[] };
    const r = rectOf(first);
    const snapped = snapRect(
      { x: r.x + raw.dx, y: r.y + raw.dy, width: r.width, height: r.height },
      {
        settings: ui.snap,
        gridStep: ui.gridStep,
        entities: marked,
        guides: ui.guides.filter((g) => g.plane === ui.plane),
        excludeIds: ui.selection,
      },
    );
    return { dx: snapped.x - r.x, dy: snapped.y - r.y, matches: snapped.matches };
  }, [drag, selected, marked, ui.snap, ui.gridStep, ui.guides, ui.plane, ui.selection]);

  const hints = useMemo(() => {
    if (!drag || drag.kind !== 'move' || selected.length === 0) return [];
    return distanceHints(selected[0], marked.filter((e) => !ui.selection.includes(e.entityId)));
  }, [drag, selected, marked, ui.selection]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const world = worldAt(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);

    // Средняя кнопка или пробел-перетаскивание — панорама (§7).
    if (e.button === 1 || e.altKey) {
      setDrag({ kind: 'pan', startScreen: { x: e.clientX, y: e.clientY }, startWorld: world, currentWorld: world, startPan: { x: ui.panX, y: ui.panY } });
      return;
    }

    if (ui.tool === 'dimension') {
      setDrag({ kind: 'measure', startScreen: { x: e.clientX, y: e.clientY }, startWorld: world, currentWorld: world });
      return;
    }

    const handle = (e.target as HTMLElement).dataset?.handle as ResizeHandle | undefined;
    const handleFor = (e.target as HTMLElement).dataset?.handleFor;
    if (handle && handleFor) {
      setDrag({ kind: 'resize', startScreen: { x: e.clientX, y: e.clientY }, startWorld: world, currentWorld: world, handle, entityId: handleFor });
      return;
    }

    const hit = entityAt(visible, world, ui.filter);
    if (!hit) {
      setDrag({ kind: 'marquee', startScreen: { x: e.clientX, y: e.clientY }, startWorld: world, currentWorld: world });
      if (!e.ctrlKey && !e.metaKey) onSelect([], false);
      return;
    }

    if (!ui.selection.includes(hit.entityId)) onSelect([hit.entityId], e.ctrlKey || e.metaKey);
    else if (e.ctrlKey || e.metaKey) onSelect([hit.entityId], true);

    setDrag({ kind: 'move', startScreen: { x: e.clientX, y: e.clientY }, startWorld: world, currentWorld: world, entityId: hit.entityId });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const world = worldAt(e);
    if (drag.kind === 'pan' && drag.startPan) {
      onViewChange({
        panX: drag.startPan.x - (world.x - drag.startWorld.x),
        panY: drag.startPan.y - (world.y - drag.startWorld.y),
      });
      return;
    }
    setDrag({ ...drag, currentWorld: world });
  };

  const finish = (e: React.PointerEvent) => {
    if (!drag) return;
    const world = worldAt(e);

    if (drag.kind === 'marquee') {
      const bounds = normalizeBounds(drag.startWorld, world);
      const ids = selectInRect(marked, bounds, { crossing: true, filter: ui.filter });
      if (ids.length > 0) onSelect(ids, e.ctrlKey || e.metaKey);
    } else if (drag.kind === 'move' && (Math.abs(liveDelta.dx) > 0.01 || Math.abs(liveDelta.dy) > 0.01)) {
      // §153: изменение записывается в модель только по отпусканию кнопки.
      onMove(ui.selection, liveDelta.dx, liveDelta.dy);
    } else if (drag.kind === 'resize' && drag.entityId && drag.handle) {
      const entity = marked.find((x) => x.entityId === drag.entityId);
      if (entity) {
        const r = rectOf(entity);
        const dx = world.x - drag.startWorld.x;
        const dy = world.y - drag.startWorld.y;
        const width = drag.handle.includes('e') ? r.width + dx : drag.handle.includes('w') ? r.width - dx : r.width;
        const height = drag.handle.includes('n') ? r.height + dy : drag.handle.includes('s') ? r.height - dy : r.height;
        onResize(entity.entityId, drag.handle, Math.max(1, width), Math.max(1, height));
      }
    } else if (drag.kind === 'measure') {
      onMeasure?.(drag.startWorld, world);
    }
    setDrag(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const before = screenToWorld(screen, view);
    const zoom = Math.max(0.005, Math.min(20, view.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    const after = screenToWorld(screen, { ...view, zoom });
    onViewChange({ zoom, panX: view.panX + (before.x - after.x), panY: view.panY + (before.y - after.y) });
  };

  // Отмена операции клавишей Esc (§150/§151).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag) setDrag(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag]);

  const axes = PLANE_AXES[ui.plane];
  const gridLines = useMemo(() => {
    if (!ui.showGrid) return [];
    const step = ui.gridStep;
    // Разрежаем сетку, чтобы на мелком масштабе не рисовать тысячи линий (§121).
    const pxStep = step * view.zoom;
    const factor = pxStep < 6 ? Math.ceil(6 / pxStep) : 1;
    const s = step * factor;
    const bounds = {
      minX: Math.floor(view.panX / s) * s,
      minY: Math.floor(view.panY / s) * s,
      maxX: view.panX + size.width / view.zoom,
      maxY: view.panY + size.height / view.zoom,
    };
    const lines: Array<{ key: string; x1: number; y1: number; x2: number; y2: number }> = [];
    for (let x = bounds.minX; x <= bounds.maxX; x += s) {
      const p = worldToScreen({ x, y: 0 }, view);
      lines.push({ key: `v${x}`, x1: p.x, y1: 0, x2: p.x, y2: size.height });
    }
    for (let y = bounds.minY; y <= bounds.maxY; y += s) {
      const p = worldToScreen({ x: 0, y }, view);
      lines.push({ key: `h${y}`, x1: 0, y1: p.y, x2: size.width, y2: p.y });
    }
    return lines;
  }, [ui.showGrid, ui.gridStep, view, size.width, size.height]);

  const moveOffset = drag?.kind === 'move' ? liveDelta : { dx: 0, dy: 0 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {ui.showRulers && (
        <div style={{ display: 'flex', height: RULER, borderBottom: '1px solid var(--border)', fontSize: 9, color: 'var(--dim,#9aa0a6)' }}>
          <div style={{ width: RULER, borderRight: '1px solid var(--border)', textAlign: 'center', lineHeight: `${RULER}px` }}>мм</div>
          <div
            data-testid="ruler-h"
            style={{ flex: 1, position: 'relative', cursor: 'ns-resize' }}
            onPointerDown={(e) => onCreateGuide?.('horizontal', worldAt(e).y)}
            title="Потяните вниз, чтобы создать горизонтальную направляющую"
          >
            {rulerTicks(view, size.width, 'h').map((t) => (
              <span key={t.value} style={{ position: 'absolute', left: t.px + 2, top: 2 }}>{t.value}</span>
            ))}
            <span style={{ position: 'absolute', right: 4, top: 2 }}>{axes.h}</span>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {ui.showRulers && (
          <div
            data-testid="ruler-v"
            style={{ width: RULER, borderRight: '1px solid var(--border)', position: 'relative', fontSize: 9, color: 'var(--dim,#9aa0a6)', cursor: 'ew-resize' }}
            onPointerDown={(e) => onCreateGuide?.('vertical', worldAt(e).x)}
            title="Потяните вправо, чтобы создать вертикальную направляющую"
          >
            {rulerTicks(view, size.height, 'v').map((t) => (
              <span key={t.value} style={{ position: 'absolute', top: t.px + 2, left: 2 }}>{t.value}</span>
            ))}
            <span style={{ position: 'absolute', bottom: 4, left: 4 }}>{axes.v}</span>
          </div>
        )}

        <div
          ref={hostRef}
          data-testid="editor2d-canvas"
          style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', background: 'var(--bg-canvas, var(--bg, #0f1012))', touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={() => setDrag(null)}
          onWheel={onWheel}
          onDoubleClick={(e) => {
            const hit = entityAt(visible, worldAt(e), ui.filter);
            if (hit) onActivate?.(hit.entityId);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const hit = entityAt(visible, worldAt(e), ui.filter);
            onContextMenu?.(hit?.entityId ?? null, { x: e.clientX, y: e.clientY });
          }}
        >
          <svg width={size.width} height={size.height} style={{ display: 'block' }}>
            {/* Сетка (§9/§10) */}
            {gridLines.map((l) => (
              <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="var(--grid, rgba(120,130,145,0.14))" strokeWidth={1} />
            ))}

            {/* Направляющие (§48) */}
            {ui.showGuides && ui.guides.filter((g) => g.plane === ui.plane).map((g) => {
              const p = worldToScreen({ x: g.position, y: g.position }, view);
              return g.orientation === 'vertical' ? (
                <line key={g.id} data-guide={g.id} x1={p.x} y1={0} x2={p.x} y2={size.height}
                  stroke={g.locked ? 'var(--dim,#9aa0a6)' : 'var(--accent,#5a9cf8)'} strokeDasharray="6 4" strokeWidth={1} />
              ) : (
                <line key={g.id} data-guide={g.id} x1={0} y1={p.y} x2={size.width} y2={p.y}
                  stroke={g.locked ? 'var(--dim,#9aa0a6)' : 'var(--accent,#5a9cf8)'} strokeDasharray="6 4" strokeWidth={1} />
              );
            })}

            {/* Сущности (§4) */}
            {visible.map((entity) => {
              const r = rectOf(entity);
              const isSelected = ui.selection.includes(entity.entityId);
              const dx = isSelected ? moveOffset.dx : 0;
              const dy = isSelected ? moveOffset.dy : 0;
              const topLeft = worldToScreen({ x: r.x + dx, y: r.y + r.height + dy }, view);
              const w = r.width * view.zoom;
              const h = r.height * view.zoom;
              const stroke = entity.status ? STATUS_STROKE[entity.status] : STATUS_STROKE.VALID;
              return (
                <g key={entity.entityId} data-entity={entity.entityId} data-entity-type={entity.entityType}>
                  <rect
                    x={topLeft.x} y={topLeft.y} width={Math.max(1, w)} height={Math.max(1, h)}
                    fill={FILL[entity.entityType]}
                    stroke={isSelected ? 'var(--accent,#5a9cf8)' : stroke}
                    strokeWidth={isSelected ? 2 : 1}
                    strokeDasharray={entity.entityType === 'MODULE' ? '8 5' : undefined}
                  />
                  {entity.entityType === 'HARDWARE' && (
                    <circle cx={topLeft.x + w / 2} cy={topLeft.y + h / 2} r={Math.max(3, w / 3)}
                      fill="none" stroke="var(--warn,#e0a030)" strokeWidth={1.5} />
                  )}
                  {ui.showLabels && w > 44 && h > 16 && (
                    <text x={topLeft.x + 4} y={topLeft.y + 13} fontSize={11} fill="var(--fg, #e6e7e9)">
                      {entity.number ? `${entity.number} ` : ''}{entity.label}
                    </text>
                  )}
                  {entity.locked && w > 20 && (
                    <text x={topLeft.x + w - 12} y={topLeft.y + 13} fontSize={11} fill="var(--dim,#9aa0a6)">🔒</text>
                  )}
                  {entity.status === 'ERROR' && (
                    <text x={topLeft.x + w - 24} y={topLeft.y + 13} fontSize={11} fill="var(--danger,#e05252)">!</text>
                  )}
                </g>
              );
            })}

            {/* Присадка (§104/§105) */}
            {holes.map((hole) => {
              const p = worldToScreen({ x: hole.x, y: hole.y }, view);
              const rr = Math.max(2, (hole.diameter / 2) * view.zoom);
              return (
                <g key={hole.operationId}>
                  <circle cx={p.x} cy={p.y} r={rr} fill="none" stroke="var(--accent,#5a9cf8)" strokeWidth={1} />
                  <line x1={p.x - rr - 2} y1={p.y} x2={p.x + rr + 2} y2={p.y} stroke="var(--accent,#5a9cf8)" strokeWidth={0.5} />
                  <line x1={p.x} y1={p.y - rr - 2} x2={p.x} y2={p.y + rr + 2} stroke="var(--accent,#5a9cf8)" strokeWidth={0.5} />
                </g>
              );
            })}

            {/* Кромка (§106) */}
            {edges.map((edge, i) => {
              const a = worldToScreen({ x: edge.x1, y: edge.y1 }, view);
              const b = worldToScreen({ x: edge.x2, y: edge.y2 }, view);
              return <line key={`${edge.partId}-${edge.side}-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="var(--ok,#4caf50)" strokeWidth={2.5} strokeLinecap="round" />;
            })}

            {/* Замеры (§53/§55) */}
            {ui.dimensions.filter((d) => d.plane === ui.plane).map((d) => {
              const a = worldToScreen(d.from, view);
              const b = worldToScreen(d.to, view);
              const length = Math.round(Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y));
              return (
                <g key={d.id} data-dimension={d.id}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent,#5a9cf8)" strokeWidth={1} />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} fontSize={11} textAnchor="middle" fill="var(--accent,#5a9cf8)">
                    {length}{d.reference ? ' (спр.)' : ''}
                  </text>
                </g>
              );
            })}

            {/* Умные направляющие текущей операции (§46/§47) */}
            {liveDelta.matches.map((m, i) => {
              const p = worldToScreen({ x: m.value, y: m.value }, view);
              return m.axis === 'x'
                ? <line key={`sm${i}`} x1={p.x} y1={0} x2={p.x} y2={size.height} stroke="var(--warn,#e0a030)" strokeWidth={1} strokeDasharray="3 3" />
                : <line key={`sm${i}`} x1={0} y1={p.y} x2={size.width} y2={p.y} stroke="var(--warn,#e0a030)" strokeWidth={1} strokeDasharray="3 3" />;
            })}

            {/* Расстояния до соседей (§45) */}
            {hints.map((hint, i) => (
              <text key={`d${i}`} x={8} y={size.height - 8 - i * 14} fontSize={11} fill="var(--warn,#e0a030)">
                {hint.axis === 'x' ? '↔' : '↕'} {Math.round(hint.distance)} мм
              </text>
            ))}

            {/* Ручки изменения размера (§146) */}
            {selected.length === 1 && !selected[0].locked && (() => {
              const r = rectOf(selected[0]);
              const w = r.width * view.zoom;
              const h = r.height * view.zoom;
              /* Ручки показываются только у достаточно крупного на экране
               * объекта и вынесены НАРУЖУ габарита: иначе у тонкой панели они
               * накрывают её целиком и деталь невозможно перетащить. */
              if (w < HANDLE_MIN_PX || h < HANDLE_MIN_PX) return null;
              const tl = worldToScreen({ x: r.x, y: r.y + r.height }, view);
              const o = HANDLE_OFFSET;
              const at: Record<ResizeHandle, { x: number; y: number }> = {
                nw: { x: tl.x - o, y: tl.y - o }, n: { x: tl.x + w / 2, y: tl.y - o }, ne: { x: tl.x + w + o, y: tl.y - o },
                e: { x: tl.x + w + o, y: tl.y + h / 2 }, se: { x: tl.x + w + o, y: tl.y + h + o },
                s: { x: tl.x + w / 2, y: tl.y + h + o }, sw: { x: tl.x - o, y: tl.y + h + o }, w: { x: tl.x - o, y: tl.y + h / 2 },
              };
              return HANDLES.map((handle) => (
                <rect
                  key={handle}
                  data-handle={handle}
                  data-handle-for={selected[0].entityId}
                  x={at[handle].x - 4} y={at[handle].y - 4} width={8} height={8}
                  fill="var(--accent,#5a9cf8)" stroke="var(--bg,#0f1012)" strokeWidth={1}
                  style={{ cursor: 'pointer' }}
                />
              ));
            })()}

            {/* Рамка выделения (§19) */}
            {drag?.kind === 'marquee' && (() => {
              const a = worldToScreen(drag.startWorld, view);
              const b = worldToScreen(drag.currentWorld, view);
              return (
                <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)}
                  width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)}
                  fill="rgba(90,156,248,0.12)" stroke="var(--accent,#5a9cf8)" strokeDasharray="4 3" />
              );
            })()}

            {/* Предварительный замер (§152) */}
            {drag?.kind === 'measure' && (() => {
              const a = worldToScreen(drag.startWorld, view);
              const b = worldToScreen(drag.currentWorld, view);
              const length = Math.round(Math.hypot(drag.currentWorld.x - drag.startWorld.x, drag.currentWorld.y - drag.startWorld.y));
              return (
                <g>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent,#5a9cf8)" strokeDasharray="4 3" />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} fontSize={11} textAnchor="middle" fill="var(--accent,#5a9cf8)">{length}</text>
                </g>
              );
            })()}
          </svg>

          {/* Текущий размер во время операции (§149) и координаты курсора (§16) */}
          <div style={{ position: 'absolute', right: 8, bottom: 6, fontSize: 11, color: 'var(--dim,#9aa0a6)', pointerEvents: 'none' }}>
            <span data-testid="editor2d-status">
              {axes.title} · {Math.round(view.zoom * 100)}%
              {selected.length === 1 && ` · W ${Math.round(rectOf(selected[0]).width)} × H ${Math.round(rectOf(selected[0]).height)}`}
              {drag?.kind === 'move' && ` · Δ ${Math.round(liveDelta.dx)}, ${Math.round(liveDelta.dy)}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Отметки линейки (§14/§15): подписи в миллиметрах модели. */
function rulerTicks(view: Viewport, lengthPx: number, axis: 'h' | 'v'): Array<{ value: number; px: number }> {
  const targetPx = 90;
  const rawStep = targetPx / view.zoom;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, rawStep))));
  const step = magnitude * (rawStep / magnitude > 5 ? 10 : rawStep / magnitude > 2 ? 5 : 1);
  const start = axis === 'h' ? view.panX : view.panY;
  const first = Math.ceil(start / step) * step;
  const out: Array<{ value: number; px: number }> = [];
  for (let v = first; out.length < 40; v += step) {
    const px = axis === 'h' ? (v - view.panX) * view.zoom : lengthPx - (v - view.panY) * view.zoom;
    if (px < 0 || px > lengthPx) { if (px > lengthPx && axis === 'h') break; if (px < 0 && axis === 'v') break; continue; }
    out.push({ value: Math.round(v), px });
  }
  return out;
}
