import { useMemo } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { findPart } from '@/core/model/selectors';
import { allOperations, resolveConnectionType, CONNECTION_TYPES, CONNECTION_TYPE_LABELS } from '@/engines/machining';
import type { ConnectionType, HardwareConnection } from '@/core/model/types';
import type { HardwareConnectionId, PartId } from '@/core/model/ids';

/**
 * Дерево соединений (§44): C001 Конфирмат → P001 / P002.
 * Выбор соединения подсвечивает связанные детали и его операции (§40).
 */
export function ConnectionsPanel() {
  const project = useEditorStore((s) => s.project);
  const selectedConnectionId = useEditorStore((s) => s.selectedConnectionId);
  const selectConnection = useEditorStore((s) => s.selectConnection);
  const selectPart = useEditorStore((s) => s.selectPart);
  const setConnectionType = useEditorStore((s) => s.setConnectionType);
  const removeConnection = useEditorStore((s) => s.removeConnection);

  const ops = useMemo(() => allOperations(project), [project]);
  const opCount = (id: string) => ops.filter((o) => String(o.sourceHardwareConnectionId) === id).length;

  const label = (c: HardwareConnection, i: number) =>
    `C${String(i + 1).padStart(3, '0')} ${CONNECTION_TYPE_LABELS[resolveConnectionType(project, c)]}`;
  const partLabel = (id: PartId) => {
    const p = findPart(project, id);
    return p ? `${p.metadata?.number ?? ''} ${p.name}`.trim() : '—';
  };

  return (
    <div style={{ padding: 10, overflow: 'auto', height: '100%' }}>
      <h3 style={hdr}>Соединения ({project.hardwareConnections.length})</h3>
      {project.hardwareConnections.length === 0 && <div className="empty-hint">Соединений нет.</div>}
      {project.hardwareConnections.map((c, i) => {
        const selected = c.id === selectedConnectionId;
        return (
          <div
            key={c.id}
            style={{
              border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 6, padding: '6px 8px', marginBottom: 6, cursor: 'pointer',
              background: selected ? 'var(--accent-dim)' : 'transparent',
            }}
            onClick={() => selectConnection(c.id as HardwareConnectionId)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <strong style={{ fontSize: 12 }}>{label(c, i)}</strong>
              <span className="dim" style={{ fontSize: 11 }}>{opCount(String(c.id))} опер.</span>
            </div>
            <div className="dim" style={{ fontSize: 11, paddingLeft: 8 }}>
              ├── <span style={lnk} onClick={(e) => { e.stopPropagation(); selectPart(c.partAId); }}>{partLabel(c.partAId)}</span>
            </div>
            <div className="dim" style={{ fontSize: 11, paddingLeft: 8 }}>
              └── <span style={lnk} onClick={(e) => { e.stopPropagation(); selectPart(c.partBId); }}>{partLabel(c.partBId)}</span>
            </div>
            {selected && (
              <div style={{ marginTop: 6, display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  style={{ width: 'auto', fontSize: 11 }}
                  value={resolveConnectionType(project, c)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setConnectionType(c.id as HardwareConnectionId, e.target.value as ConnectionType)}
                >
                  {CONNECTION_TYPES.map((t) => <option key={t} value={t}>{CONNECTION_TYPE_LABELS[t]}</option>)}
                </select>
                <button
                  style={{ fontSize: 11, color: 'var(--danger)' }}
                  onClick={(e) => { e.stopPropagation(); removeConnection(c.id as HardwareConnectionId); }}
                >Удалить</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const hdr: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', margin: '0 0 8px' };
const lnk: React.CSSProperties = { textDecoration: 'underline dotted', cursor: 'pointer' };
