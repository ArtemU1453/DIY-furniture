import { useMemo } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import { partWorldAABB } from '@/core/geometry/partGeometry';

/**
 * Простое 2D-представление (вид спереди): проекция деталей на плоскость XY.
 * Выбор синхронизирован с 3D и деревом по одному ID.
 */
export function View2D() {
  const project = useEditorStore((s) => s.project);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectPart = useEditorStore((s) => s.selectPart);

  const rects = useMemo(() => {
    return allParts(project)
      .filter((p) => p.metadata?.hidden !== true)
      .map((p) => {
        const b = partWorldAABB(p);
        return {
          id: p.id,
          number: (p.metadata?.number as string) ?? '',
          x: b.min.x,
          y: b.min.y,
          w: b.max.x - b.min.x,
          h: b.max.y - b.min.y,
          depth: b.max.z - b.min.z,
        };
      })
      .sort((a, b) => b.depth - a.depth); // дальние (глубокие) — сначала
  }, [project]);

  const bounds = useMemo(() => {
    if (rects.length === 0) return { x: -500, y: -100, w: 1000, h: 2200 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    }
    const pad = (maxX - minX) * 0.1 + 50;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  }, [rects]);

  const flipY = (y: number, h: number) => bounds.y + (bounds.h - ((y - bounds.y) + h));

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ background: '#0f1012' }}
      onClick={() => selectPart(null)}
    >
      {rects.map((r) => {
        const sel = r.id === selectedPartId;
        return (
          <g key={r.id} onClick={(e) => { e.stopPropagation(); selectPart(r.id); }} style={{ cursor: 'pointer' }}>
            <rect x={r.x} y={flipY(r.y, r.h)} width={r.w} height={r.h} fill={sel ? '#37507a' : '#28303c'} stroke={sel ? '#4c8dff' : '#7f8ea3'} strokeWidth={bounds.w * (sel ? 0.003 : 0.0015)} />
            {r.number && (
              <text x={r.x + r.w / 2} y={flipY(r.y, r.h) + r.h / 2} fill="#e6e7e9" fontSize={Math.min(r.w, r.h) * 0.25} textAnchor="middle" dominantBaseline="middle" style={{ pointerEvents: 'none' }}>{r.number}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
