import { useMemo } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import { buildSpecification } from '@/engines/bom/specification';
import { calculateEdges } from '@/engines/bom/edgeCalculator';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';

/** Таблица деталировки. Клик по строке синхронно выделяет деталь в 3D. */
export function PartsTable() {
  const project = useEditorStore((s) => s.project);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectPart = useEditorStore((s) => s.selectPart);

  const parts = useMemo(() => allParts(project), [project]);
  const spec = useMemo(
    () => buildSpecification(parts, project.materials, project.edges),
    [parts, project.materials, project.edges],
  );
  const edgeReport = useMemo(() => calculateEdges(parts, project.edges), [parts, project.edges]);
  const ledger = useMemo(
    () => buildHardwareLedger(project.hardware, project.hardwareConnections).filter((r) => r.count > 0),
    [project.hardware, project.hardwareConnections],
  );

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
            <th style={th}>Л</th>
            <th style={th}>П</th>
            <th style={th}>В</th>
            <th style={th}>Н</th>
          </tr>
        </thead>
        <tbody>
          {spec.rows.length === 0 && (
            <tr>
              <td colSpan={11} className="empty-hint">
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
              <td style={tdEdge}>{r.edgeLeft}</td>
              <td style={tdEdge}>{r.edgeRight}</td>
              <td style={tdEdge}>{r.edgeTop}</td>
              <td style={tdEdge}>{r.edgeBottom}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 20 }}>
        <section>
          <h3 style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-dim)' }}>КРОМКА</h3>
          {edgeReport.groups.length === 0 && <div className="empty-hint">Кромка не назначена.</div>}
          {edgeReport.groups.map((g) => (
            <div key={g.edgeId} className="dim">
              {g.name}: {(g.lengthMm / 1000).toFixed(2)} м
            </div>
          ))}
          {edgeReport.groups.length > 0 && (
            <div style={{ marginTop: 4 }}>Итого: {(edgeReport.totalMm / 1000).toFixed(2)} м</div>
          )}
        </section>

        <section>
          <h3 style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-dim)' }}>ФУРНИТУРА</h3>
          {ledger.length === 0 && <div className="empty-hint">Соединений нет.</div>}
          {ledger.map((r) => (
            <div key={r.hardwareId} className="dim">
              {r.name}: {r.count} шт.
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid var(--border)' };
const tdR: React.CSSProperties = { ...td, textAlign: 'right' };
const tdEdge: React.CSSProperties = { ...td, fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' };
