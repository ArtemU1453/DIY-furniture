import { useMemo } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import { buildSpecification } from '@/engines/bom/specification';

/** Таблица деталировки. Клик по строке синхронно выделяет деталь в 3D. */
export function PartsTable() {
  const project = useEditorStore((s) => s.project);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectPart = useEditorStore((s) => s.selectPart);

  const parts = useMemo(() => allParts(project), [project]);
  const spec = useMemo(() => buildSpecification(parts, project.materials), [parts, project.materials]);

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-dim)' }}>
            <th style={th}>№</th>
            <th style={th}>Деталь</th>
            <th style={thR}>Кол-во</th>
            <th style={thR}>Длина</th>
            <th style={thR}>Ширина</th>
            <th style={thR}>Толщина</th>
            <th style={th}>Материал</th>
          </tr>
        </thead>
        <tbody>
          {spec.rows.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-hint">
                Нет деталей. Создайте изделие.
              </td>
            </tr>
          )}
          {spec.rows.map((r) => (
            <tr
              key={r.partId}
              onClick={() => selectPart(r.partId)}
              style={{
                cursor: 'pointer',
                background: r.partId === selectedPartId ? 'var(--accent-dim)' : 'transparent',
              }}
            >
              <td style={td}>{r.number}</td>
              <td style={td}>{r.name}</td>
              <td style={tdR}>{r.quantity}</td>
              <td style={tdR}>{Math.round(r.length)}</td>
              <td style={tdR}>{Math.round(r.width)}</td>
              <td style={tdR}>{Math.round(r.thickness)}</td>
              <td style={td}>{r.materialName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid var(--border)' };
const tdR: React.CSSProperties = { ...td, textAlign: 'right' };
