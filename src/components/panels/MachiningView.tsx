import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { allOperations, validateMachining } from '@/engines/machining';
import { faceLabel, machiningTypeLabel, opNumber, FACE_LABELS } from '@/i18n/machining';
import { PartMachining2D } from './PartMachining2D';
import { ManualOpDialog } from './ManualOpDialog';
import type { MachiningOperation, PartFace } from '@/core/model/types';

type Grouping = 'part' | 'type' | 'connection';

export function MachiningView() {
  const project = useEditorStore((s) => s.project);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectedOperationId = useEditorStore((s) => s.selectedOperationId);
  const selectPart = useEditorStore((s) => s.selectPart);
  const selectOperation = useEditorStore((s) => s.selectOperation);
  const removeOperation = useEditorStore((s) => s.removeOperation);

  const [face, setFace] = useState<PartFace>('front');
  const [grouping, setGrouping] = useState<Grouping>('part');
  const [addOpen, setAddOpen] = useState(false);

  const parts = useMemo(() => allParts(project), [project]);
  const ops = useMemo(() => allOperations(project), [project]);
  const issues = useMemo(() => validateMachining(ops, project), [ops, project]);
  const selectedPart = selectedPartId ? findPart(project, selectedPartId) : parts[0];
  const partOps = ops.filter((o) => o.partId === selectedPart?.id);
  const selectedOp = ops.find((o) => o.id === selectedOperationId);

  const groups = useMemo(() => {
    const map = new Map<string, MachiningOperation[]>();
    const keyOf = (op: MachiningOperation): string => {
      if (grouping === 'part') return findPart(project, op.partId)?.name ?? op.partId;
      if (grouping === 'type') return machiningTypeLabel(op.type);
      return op.sourceHardwareConnectionId ? `Соединение ${op.sourceHardwareConnectionId.slice(0, 6)}` : 'Ручные';
    };
    for (const op of ops) {
      const k = keyOf(op);
      (map.get(k) ?? map.set(k, []).get(k)!).push(op);
    }
    return [...map.entries()];
  }, [ops, grouping, project]);

  const onRow = (op: MachiningOperation) => {
    selectOperation(op.id);
    selectPart(op.partId);
    setFace(op.face);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Детали */}
        <aside style={{ width: 180, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 8 }}>
          <h3 style={hdr}>Детали</h3>
          <ul className="parts-list">
            {parts.map((p) => (
              <li
                key={p.id}
                className={p.id === selectedPart?.id ? 'selected' : ''}
                onClick={() => selectPart(p.id)}
              >
                <span>{p.name}</span>
                <span className="dim">{ops.filter((o) => o.partId === p.id).length}</span>
              </li>
            ))}
          </ul>
        </aside>

        {/* 2D деталь */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 8 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {(Object.keys(FACE_LABELS) as PartFace[]).map((f) => (
              <button key={f} className={f === face ? 'active' : ''} onClick={() => setFace(f)} style={f === face ? activeBtn : undefined}>
                {f.toUpperCase()}
              </button>
            ))}
            <button style={{ marginLeft: 'auto' }} disabled={!selectedPart} onClick={() => setAddOpen(true)}>
              + Добавить отверстие
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, border: '1px solid var(--border)', borderRadius: 6, background: '#1a1b1e' }}>
            {selectedPart ? (
              <PartMachining2D
                part={selectedPart}
                face={face}
                operations={partOps}
                selectedId={selectedOperationId}
                onSelect={(id) => {
                  const op = partOps.find((o) => o.id === id);
                  if (op) onRow(op);
                }}
              />
            ) : (
              <div className="empty-hint">Нет деталей.</div>
            )}
          </div>
        </div>

        {/* Свойства операции */}
        <aside style={{ width: 240, borderLeft: '1px solid var(--border)', overflow: 'auto', padding: 8 }}>
          <h3 style={hdr}>Операция</h3>
          {!selectedOp && <div className="empty-hint">Выберите отверстие.</div>}
          {selectedOp && (
            <div>
              <Row k="№" v={opNumber(selectedOp.sequence)} />
              <Row k="Тип" v={machiningTypeLabel(selectedOp.type)} />
              <Row k="Диаметр" v={`${selectedOp.diameter ?? '—'} мм`} />
              <Row k="Глубина" v={selectedOp.through ? 'сквозное' : `${selectedOp.depth ?? '—'} мм`} />
              <Row k="X" v={`${Math.round(selectedOp.x)} мм`} />
              <Row k="Y" v={`${Math.round(selectedOp.y)} мм`} />
              <Row k="Сторона" v={faceLabel(selectedOp.face)} />
              <Row k="Источник" v={selectedOp.origin === 'generated' ? 'Авто (связь)' : 'Ручная'} />
              {selectedOp.origin === 'manual' && (
                <button style={{ marginTop: 8, color: 'var(--danger)' }} onClick={() => removeOperation(selectedOp.id)}>
                  Удалить операцию
                </button>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Таблица операций */}
      <div style={{ height: '38%', borderTop: '1px solid var(--border)', overflow: 'auto', padding: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h3 style={{ ...hdr, margin: 0 }}>Операции ({ops.length})</h3>
          <label className="dim" style={{ display: 'flex', gap: 4, alignItems: 'center', width: 'auto' }}>
            Группировка
            <select style={{ width: 'auto' }} value={grouping} onChange={(e) => setGrouping(e.target.value as Grouping)}>
              <option value="part">по детали</option>
              <option value="type">по типу</option>
              <option value="connection">по соединению</option>
            </select>
          </label>
          {issues.filter((i) => i.severity === 'error').length > 0 && (
            <span style={{ color: 'var(--danger)' }}>
              Ошибок: {issues.filter((i) => i.severity === 'error').length}
            </span>
          )}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-dim)' }}>
              <th style={th}>№</th><th style={th}>Деталь</th><th style={th}>Операция</th>
              <th style={thR}>X</th><th style={thR}>Y</th><th style={thR}>Z</th>
              <th style={thR}>Ø</th><th style={thR}>Глубина</th><th style={th}>Сторона</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([label, groupOps]) => (
              <GroupRows
                key={label}
                label={label}
                ops={groupOps}
                project={project}
                selectedId={selectedOperationId}
                onRow={onRow}
              />
            ))}
          </tbody>
        </table>
      </div>

      {addOpen && selectedPart && <ManualOpDialog part={selectedPart} face={face} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function GroupRows({
  label,
  ops,
  project,
  selectedId,
  onRow,
}: {
  label: string;
  ops: MachiningOperation[];
  project: import('@/core/model/types').Project;
  selectedId: string | null;
  onRow: (op: MachiningOperation) => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={9} style={{ ...td, color: 'var(--text-dim)', fontSize: 11, paddingTop: 10 }}>{label}</td>
      </tr>
      {ops.map((op) => (
        <tr
          key={op.id}
          onClick={() => onRow(op)}
          style={{ cursor: 'pointer', background: op.id === selectedId ? 'var(--accent-dim)' : 'transparent' }}
        >
          <td style={td}>{opNumber(op.sequence)}</td>
          <td style={td}>{findPart(project, op.partId)?.name ?? '—'}</td>
          <td style={td}>{machiningTypeLabel(op.type)}</td>
          <td style={tdR}>{Math.round(op.x)}</td>
          <td style={tdR}>{Math.round(op.y)}</td>
          <td style={tdR}>{Math.round(op.z)}</td>
          <td style={tdR}>{op.diameter ?? '—'}</td>
          <td style={tdR}>{op.through ? '⌀' : (op.depth ?? '—')}</td>
          <td style={td}>{op.face.toUpperCase()}</td>
        </tr>
      ))}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="dim">{k}</span>
      <span>{v}</span>
    </div>
  );
}

const hdr: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', margin: '0 0 8px' };
const activeBtn: React.CSSProperties = { borderColor: 'var(--accent)', background: 'var(--accent-dim)' };
const th: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid var(--border)' };
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid var(--border)' };
const tdR: React.CSSProperties = { ...td, textAlign: 'right' };
