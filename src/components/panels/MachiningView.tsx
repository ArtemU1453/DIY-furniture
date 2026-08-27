import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import {
  allOperations, validateMachining, groupOperations,
  machiningOperationsCsv, machiningToJson,
} from '@/engines/machining';
import { faceLabel, machiningTypeLabel, opNumber, FACE_LABELS } from '@/i18n/machining';
import { PartMachining2D } from './PartMachining2D';
import { ConnectionsPanel } from './ConnectionsPanel';
import { ManualOpDialog } from './ManualOpDialog';
import type { MachiningOperation, PartFace } from '@/core/model/types';

type Grouping = 'part' | 'type' | 'connection' | 'identical';
type SortKey = 'part' | 'type' | 'face' | 'connection';

/** Фильтры по видам операций (§46). */
const FILTERS: Array<[string, string]> = [
  ['all', 'Все'],
  ['drilling', 'Сверление'],
  ['hinge', 'Петли'],
  ['confirmat', 'Конфирматы'],
  ['dowel', 'Шканты'],
  ['handle', 'Ручки'],
  ['other', 'Другие'],
];

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Соответствие операции выбранному фильтру. */
function matchesFilter(op: MachiningOperation, filter: string, hardwareCategory?: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'handle') return hardwareCategory === 'handle';
  if (filter === 'hinge') return op.type === 'hinge' || hardwareCategory === 'hinge';
  if (filter === 'confirmat') return op.type === 'confirmat' || hardwareCategory === 'confirmat';
  if (filter === 'dowel') return op.type === 'dowel' || hardwareCategory === 'dowel';
  if (filter === 'drilling') return op.type === 'drilling';
  return !['drilling', 'hinge', 'confirmat', 'dowel'].includes(op.type);
}

export function MachiningView() {
  const project = useEditorStore((s) => s.project);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectedOperationId = useEditorStore((s) => s.selectedOperationId);
  const selectPart = useEditorStore((s) => s.selectPart);
  const selectOperation = useEditorStore((s) => s.selectOperation);
  const removeOperation = useEditorStore((s) => s.removeOperation);
  const setOverride = useEditorStore((s) => s.setOperationOverride);
  const resetToRule = useEditorStore((s) => s.resetOperationToRule);

  const [face, setFace] = useState<PartFace>('front');
  const [grouping, setGrouping] = useState<Grouping>('part');
  const [filter, setFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('part');
  const [addOpen, setAddOpen] = useState(false);

  const parts = useMemo(() => allParts(project), [project]);
  const allOps = useMemo(() => allOperations(project), [project]);
  const categoryOf = useMemo(() => {
    const byHw = new Map(project.hardware.map((h) => [String(h.id), h.category]));
    return (op: MachiningOperation) => (op.hardwareId ? byHw.get(String(op.hardwareId)) : undefined);
  }, [project.hardware]);

  // Фильтрация (§46) + сортировка (§48).
  const ops = useMemo(() => {
    const filtered = allOps.filter((op) => matchesFilter(op, filter, categoryOf(op)));
    const partName = (id: string) => findPart(project, id as MachiningOperation['partId'])?.metadata?.number ?? id;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'type': return a.type.localeCompare(b.type) || (a.sequence ?? 0) - (b.sequence ?? 0);
        case 'face': return a.face.localeCompare(b.face) || (a.sequence ?? 0) - (b.sequence ?? 0);
        case 'connection':
          return String(a.sourceHardwareConnectionId ?? '').localeCompare(String(b.sourceHardwareConnectionId ?? ''))
            || (a.sequence ?? 0) - (b.sequence ?? 0);
        case 'part':
        default: return String(partName(a.partId)).localeCompare(String(partName(b.partId))) || (a.sequence ?? 0) - (b.sequence ?? 0);
      }
    });
  }, [allOps, filter, sortKey, categoryOf, project]);
  const issues = useMemo(() => validateMachining(ops, project), [ops, project]);
  const selectedPart = selectedPartId ? findPart(project, selectedPartId) : parts[0];
  const partOps = ops.filter((o) => o.partId === selectedPart?.id);
  const selectedOp = ops.find((o) => o.id === selectedOperationId);

  const groups = useMemo(() => {
    const map = new Map<string, MachiningOperation[]>();
    if (grouping === 'identical') {
      // Одинаковые операции (§49): «DRILL Ø5 — 20 шт.», раскрытие показывает все.
      return groupOperations(ops).map((g) => [
        `${machiningTypeLabel(g.type)} Ø${g.diameter ?? '—'} ${g.through ? 'сквозное' : g.depth ?? '—'} — ${g.count} шт.`,
        g.operations,
      ] as [string, MachiningOperation[]]);
    }
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
        <aside style={{ width: 210, borderRight: '1px solid var(--border)', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* Дерево присадки по деталям (§45). */}
          <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
            <h3 style={hdr}>Детали</h3>
            <ul className="parts-list">
              {parts.map((p) => (
                <li
                  key={p.id}
                  className={p.id === selectedPart?.id ? 'selected' : ''}
                  onClick={() => selectPart(p.id)}
                >
                  <span>{p.name}</span>
                  <span className="dim">{allOps.filter((o) => o.partId === p.id).length}</span>
                </li>
              ))}
            </ul>
          </div>
          {/* Дерево соединений (§44). */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <ConnectionsPanel />
          </div>
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
              <Row k="Соединение" v={selectedOp.sourceHardwareConnectionId ? String(selectedOp.sourceHardwareConnectionId).slice(0, 8) : '—'} />
              <Row k="Фурнитура" v={selectedOp.hardwareId ? String(selectedOp.hardwareId).slice(0, 8) : '—'} />
              <Row k="Источник" v={selectedOp.origin === 'generated' ? (selectedOp.override ? 'Авто + ручная правка' : 'Авто (связь)') : 'Ручная'} />

              {/* Ручная правка автоматической операции (MANUAL OVERRIDE, §41/§42). */}
              {selectedOp.origin === 'generated' && (
                <div style={{ marginTop: 10 }}>
                  <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>Ручная правка</div>
                  <label className="field"><span>Диаметр, мм</span>
                    <input type="number" min={1} step={0.1} defaultValue={selectedOp.diameter ?? 0}
                      onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== selectedOp.diameter) setOverride(selectedOp.id, { diameter: v }); }} />
                  </label>
                  <label className="field"><span>Глубина, мм</span>
                    <input type="number" min={1} step={0.5} defaultValue={selectedOp.depth ?? 0} disabled={selectedOp.through}
                      onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== selectedOp.depth) setOverride(selectedOp.id, { depth: v }); }} />
                  </label>
                  {selectedOp.override && (
                    <button style={{ width: '100%', marginTop: 6 }} onClick={() => resetToRule(selectedOp.id)}>
                      Сбросить правило
                    </button>
                  )}
                </div>
              )}

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
              <option value="identical">одинаковые</option>
            </select>
          </label>
          <label className="dim" style={{ display: 'flex', gap: 4, alignItems: 'center', width: 'auto' }}>
            Сортировка
            <select style={{ width: 'auto' }} value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
              <option value="part">Деталь</option>
              <option value="type">Тип</option>
              <option value="face">Сторона</option>
              <option value="connection">Соединение</option>
            </select>
          </label>
          <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {FILTERS.map(([f, label]) => (
              <button key={f} onClick={() => setFilter(f)} style={{ padding: '2px 7px', fontSize: 11, ...(filter === f ? activeBtn : {}) }}>{label}</button>
            ))}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button onClick={() => download('machining_operations.csv', machiningOperationsCsv(project, ops), 'text/csv')}>CSV</button>
            <button onClick={() => download('machining.json', machiningToJson(project, ops), 'application/json')}>JSON</button>
          </span>
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
              <th style={th}>Соединение</th><th style={th}>Фурнитура</th>
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
        <td colSpan={11} style={{ ...td, color: 'var(--text-dim)', fontSize: 11, paddingTop: 10 }}>{label}</td>
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
          <td style={td}>{op.sourceHardwareConnectionId ? String(op.sourceHardwareConnectionId).slice(0, 6) : '—'}</td>
          <td style={td}>{op.hardwareId ? String(op.hardwareId).slice(0, 6) : '—'}</td>
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
