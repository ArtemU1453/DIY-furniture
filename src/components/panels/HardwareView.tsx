import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { createBlankHardware } from '@/core/model/factory';
import { HARDWARE_CATALOG, type HardwareTemplate } from '@/core/model/hardwareCatalog';
import { allParts } from '@/core/model/selectors';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { allOperations } from '@/engines/machining';
import { hardwareCategoryLabel } from '@/i18n/catalog';
import { HardwareEditor } from './HardwareEditor';
import { ConnectionDialog } from './ConnectionDialog';
import type { Hardware, HardwareCategory } from '@/core/model/types';

const FILTERS: Array<[HardwareCategory | 'all', string]> = [
  ['all', 'Все'], ['confirmat', 'Конфирматы'], ['dowel', 'Шканты'], ['minifix', 'Эксцентрики'],
  ['hinge', 'Петли'], ['slide', 'Направляющие'], ['handle', 'Ручки'], ['leg', 'Опоры'],
  ['screw', 'Саморезы'], ['corner', 'Уголки'], ['other', 'Другое'],
];

export function HardwareView() {
  const project = useEditorStore((s) => s.project);
  const selectedConnectionId = useEditorStore((s) => s.selectedConnectionId);
  const selectConnection = useEditorStore((s) => s.selectConnection);
  const removeConnection = useEditorStore((s) => s.removeConnection);
  const duplicateConnection = useEditorStore((s) => s.duplicateConnection);
  const selectPart = useEditorStore((s) => s.selectPart);
  const addFromTemplate = useEditorStore((s) => s.addHardwareFromTemplate);

  const [hwEdit, setHwEdit] = useState<{ hardware: Hardware; isNew: boolean } | null>(null);
  const [connOpen, setConnOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [filter, setFilter] = useState<HardwareCategory | 'all'>('all');

  const parts = useMemo(() => allParts(project), [project]);
  const ledger = useMemo(() => buildHardwareLedger(project.hardware, project.hardwareConnections), [project.hardware, project.hardwareConnections]);
  const ops = useMemo(() => allOperations(project), [project]);
  const hardwareName = (id: string) => project.hardware.find((h) => h.id === id)?.name ?? '—';
  const partName = (id: string) => {
    const p = parts.find((x) => x.id === id);
    return p ? `${p.metadata?.number ?? ''} ${p.name}`.trim() : '—';
  };

  const connections = filter === 'all' ? project.hardwareConnections
    : project.hardwareConnections.filter((c) => project.hardware.find((h) => h.id === c.hardwareId)?.category === filter);
  const selected = project.hardwareConnections.find((c) => c.id === selectedConnectionId);
  const selectedHw = selected ? project.hardware.find((h) => h.id === selected.hardwareId) : undefined;
  const selectedOps = selected ? ops.filter((o) => o.sourceHardwareConnectionId === selected.id) : [];

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, height: '100%', overflow: 'auto', alignItems: 'flex-start' }}>
      {/* Фурнитура */}
      <section style={{ flex: 1, minWidth: 240 }}>
        <div style={header}>
          <h3 style={{ margin: 0 }}>Фурнитура</h3>
          <span style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setCatalogOpen((v) => !v)}>Каталог</button>
            <button onClick={() => setHwEdit({ hardware: createBlankHardware(), isNew: true })}>+</button>
          </span>
        </div>
        {catalogOpen && (
          <div style={{ ...card, cursor: 'default' }}>
            <div className="dim" style={{ marginBottom: 4 }}>Добавить из каталога:</div>
            {HARDWARE_CATALOG.map((t: HardwareTemplate, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', cursor: 'pointer' }} onClick={() => addFromTemplate(t)}>
                <span>{t.name}</span><span className="dim">+</span>
              </div>
            ))}
          </div>
        )}
        {ledger.map((row) => {
          const hw = project.hardware.find((h) => h.id === row.hardwareId)!;
          if (filter !== 'all' && hw.category !== filter) return null;
          return (
            <div key={row.hardwareId} style={card} onClick={() => setHwEdit({ hardware: hw, isNew: false })}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{hw.name}</strong><span className="dim">{row.count} шт.</span>
              </div>
              <div className="dim">{hardwareCategoryLabel(hw.category)}{hw.article ? ` · ${hw.article}` : ''}</div>
            </div>
          );
        })}
      </section>

      {/* Соединения */}
      <section style={{ flex: 1.1, minWidth: 260 }}>
        <div style={header}>
          <h3 style={{ margin: 0 }}>Соединения</h3>
          <button onClick={() => setConnOpen(true)}>+ Создать</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {FILTERS.map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: '2px 7px', fontSize: 12, ...(filter === f ? { borderColor: 'var(--accent)', background: 'var(--accent-dim)' } : {}) }}>{label}</button>
          ))}
        </div>
        {connections.length === 0 && <div className="empty-hint">Соединений нет.</div>}
        {connections.map((c) => (
          <div key={c.id} style={{ ...card, borderColor: c.id === selectedConnectionId ? 'var(--accent)' : 'var(--border)' }} onClick={() => selectConnection(c.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{hardwareName(c.hardwareId)}</strong>
              <span className="dim">{c.jointType ?? ''}</span>
            </div>
            <div className="dim">{partName(c.partAId)} ↔ {partName(c.partBId)}</div>
          </div>
        ))}
      </section>

      {/* Свойства соединения */}
      <section style={{ flex: 1, minWidth: 220 }}>
        <h3 style={{ margin: '0 0 10px' }}>Соединение</h3>
        {!selected && <div className="empty-hint">Выберите соединение.</div>}
        {selected && selectedHw && (
          <div>
            <Row k="ID" v={selected.id.slice(0, 8)} />
            <Row k="Тип узла" v={selected.jointType ?? '—'} />
            <Row k="Фурнитура" v={selectedHw.name} />
            <Row k="Деталь A" v={partName(selected.partAId)} />
            <Row k="Деталь B" v={partName(selected.partBId)} />
            <Row k="Количество" v={String(selected.quantity ?? selected.parameters?.count ?? '—')} />
            <Row k="Операций присадки" v={String(selectedOps.length)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
              <button onClick={() => { const id = duplicateConnection(selected.id); if (id) selectConnection(id); }}>Дублировать</button>
              <button onClick={() => selectPart(selected.partAId)}>Показать A</button>
              <button onClick={() => selectPart(selected.partBId)}>Показать B</button>
              <button style={{ color: 'var(--danger)' }} onClick={() => removeConnection(selected.id)}>Удалить</button>
            </div>
          </div>
        )}
      </section>

      {hwEdit && <HardwareEditor hardware={hwEdit.hardware} isNew={hwEdit.isNew} onClose={() => setHwEdit(null)} />}
      {connOpen && <ConnectionDialog onClose={() => setConnOpen(false)} />}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="dim">{k}</span><span>{v}</span>
    </div>
  );
}

const header: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 };
const card: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 8, cursor: 'pointer', background: 'var(--bg-panel)' };
