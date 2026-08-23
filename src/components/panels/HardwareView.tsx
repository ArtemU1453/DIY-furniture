import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { createBlankHardware } from '@/core/model/factory';
import { allParts } from '@/core/model/selectors';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { hardwareCategoryLabel } from '@/i18n/catalog';
import { HardwareEditor } from './HardwareEditor';
import { ConnectionDialog } from './ConnectionDialog';
import type { Hardware } from '@/core/model/types';

export function HardwareView() {
  const project = useEditorStore((s) => s.project);
  const selectedConnectionId = useEditorStore((s) => s.selectedConnectionId);
  const selectConnection = useEditorStore((s) => s.selectConnection);
  const removeConnection = useEditorStore((s) => s.removeConnection);

  const [hwEdit, setHwEdit] = useState<{ hardware: Hardware; isNew: boolean } | null>(null);
  const [connOpen, setConnOpen] = useState(false);

  const parts = useMemo(() => allParts(project), [project]);
  const ledger = useMemo(
    () => buildHardwareLedger(project.hardware, project.hardwareConnections),
    [project.hardware, project.hardwareConnections],
  );
  const hardwareName = (id: string) => project.hardware.find((h) => h.id === id)?.name ?? '—';
  const partName = (id: string) => {
    const p = parts.find((x) => x.id === id);
    return p ? `${p.metadata?.number ?? ''} ${p.name}`.trim() : '—';
  };

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, height: '100%', overflow: 'auto', alignItems: 'flex-start' }}>
      <section style={{ flex: 1, minWidth: 260 }}>
        <div style={header}>
          <h3 style={{ margin: 0 }}>Фурнитура</h3>
          <button onClick={() => setHwEdit({ hardware: createBlankHardware(), isNew: true })}>+ Добавить</button>
        </div>
        {ledger.map((row) => {
          const hw = project.hardware.find((h) => h.id === row.hardwareId)!;
          return (
            <div key={row.hardwareId} style={card} onClick={() => setHwEdit({ hardware: hw, isNew: false })}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{hw.name}</strong>
                <span className="dim">{row.count} шт.</span>
              </div>
              <div className="dim">{hardwareCategoryLabel(hw.category)}</div>
            </div>
          );
        })}
      </section>

      <section style={{ flex: 1.3, minWidth: 300 }}>
        <div style={header}>
          <h3 style={{ margin: 0 }}>Соединения</h3>
          <button onClick={() => setConnOpen(true)}>+ Создать соединение</button>
        </div>
        {project.hardwareConnections.length === 0 && (
          <div className="empty-hint">Соединений нет. Свяжите детали крепежом.</div>
        )}
        {project.hardwareConnections.map((c) => (
          <div
            key={c.id}
            style={{ ...card, borderColor: c.id === selectedConnectionId ? 'var(--accent)' : 'var(--border)' }}
            onClick={() => selectConnection(c.id)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{hardwareName(c.hardwareId)}</strong>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeConnection(c.id);
                }}
              >
                ✕
              </button>
            </div>
            <div className="dim">
              {partName(c.partAId)} ↔ {partName(c.partBId)}
            </div>
          </div>
        ))}
      </section>

      {hwEdit && <HardwareEditor hardware={hwEdit.hardware} isNew={hwEdit.isNew} onClose={() => setHwEdit(null)} />}
      {connOpen && <ConnectionDialog onClose={() => setConnOpen(false)} />}
    </div>
  );
}

const header: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 };
const card: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  marginBottom: 8,
  cursor: 'pointer',
  background: 'var(--bg-panel)',
};
