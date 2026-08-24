import { useMemo } from 'react';
import { faceInfo, partFrame } from '@/core/geometry/coordinateSystem';
import type { MachiningOperation, Part, PartFace } from '@/core/model/types';
import type { MachiningId } from '@/core/model/ids';

interface Props {
  part: Part;
  face: PartFace;
  operations: MachiningOperation[];
  selectedId: MachiningId | null;
  onSelect: (id: MachiningId) => void;
}

/** Простое 2D-представление грани детали с отверстиями (SVG). */
export function PartMachining2D({ part, face, operations, selectedId, onSelect }: Props) {
  const fi = useMemo(() => faceInfo(partFrame(part), face), [part, face]);
  const faceOps = operations.filter((op) => op.face === face);

  const W = Math.max(fi.uSize, 1);
  const H = Math.max(fi.vSize, 1);
  const pad = Math.max(W, H) * 0.08;
  const vb = `${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`;

  return (
    <svg width="100%" height="100%" viewBox={vb} style={{ maxHeight: '100%' }} preserveAspectRatio="xMidYMid meet">
      {/* Контур детали (ось Y вверх → отражаем по вертикали) */}
      <g transform={`translate(0, ${H}) scale(1, -1)`}>
        <rect x={0} y={0} width={W} height={H} fill="#2e3035" stroke="#5a6472" strokeWidth={Math.max(W, H) * 0.004} />
        {faceOps.map((op) => {
          const sel = op.id === selectedId;
          const r = Math.max((op.diameter ?? 6) / 2, Math.max(W, H) * 0.006);
          const color = sel ? '#ffcf4c' : op.origin === 'manual' ? '#e0803c' : '#e5534b';
          return (
            <circle
              key={op.id}
              cx={op.x}
              cy={op.y}
              r={r}
              fill={color}
              stroke="#1a1b1e"
              strokeWidth={r * 0.15}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(op.id)}
            />
          );
        })}
      </g>
    </svg>
  );
}
