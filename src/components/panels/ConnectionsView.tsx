import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import {
  BUILT_IN_CONNECTION_PRESETS,
  connectionRemovalImpact,
  connectionStatus,
} from '@/engines/connections';
import {
  HARDWARE_TEMPLATES,
  canonicalCategory,
  computedUnits,
  connectionUnits,
  hardwareBom,
  hardwareBomCsv,
  hardwareBomSvg,
  isOverridden,
  validateHardwarePlacement,
} from '@/engines/hardware';
import { downloadText, printPages } from '@/features/documents/print';
import type { ConnectionStatus, ConnectionType, HardwareConnection } from '@/core/model/types';
import type { HardwareConnectionId, HardwareId, PartId } from '@/core/model/ids';

const STATUS_COLOR: Record<string, string> = {
  VALID: 'var(--ok,#4caf50)',
  WARNING: 'var(--warn,#e0a030)',
  ERROR: 'var(--danger,#e05252)',
  DIRTY: 'var(--warn,#e0a030)',
  OUTDATED: 'var(--warn,#e0a030)',
  MISSING: 'var(--danger,#e05252)',
};

const TYPES: ConnectionType[] = ['CONFIRMAT', 'DOWEL', 'MINIFIX', 'SCREW', 'CAM_LOCK', 'CUSTOM', 'OTHER'];

/**
 * Раздел СОЕДИНЕНИЯ И ФУРНИТУРА (§117–§130).
 *
 * Две таблицы — узлы и спецификация фурнитуры — плюс мастер создания узла.
 * Собственных расчётов нет: количество, статусы и спецификация берутся из
 * движков, а изменения идут в ProjectModel через действия стора.
 */
export function ConnectionsView({ onOpenPart }: { onOpenPart?: (id: PartId) => void } = {}) {
  const project = useEditorStore((s) => s.project);
  const selectPart = useEditorStore((s) => s.selectPart);
  const selectConnection = useEditorStore((s) => s.selectConnection);
  const selectedConnectionId = useEditorStore((s) => s.selectedConnectionId);
  const removeConnection = useEditorStore((s) => s.removeConnection);
  const setOverride = useEditorStore((s) => s.setConnectionQuantityOverride);
  const createConnectionFrom = useEditorStore((s) => s.createConnectionFrom);
  const createFromTemplate = useEditorStore((s) => s.createHardwareFromTemplate);
  const setArchived = useEditorStore((s) => s.setHardwareArchived);
  const duplicateHardware = useEditorStore((s) => s.duplicateHardware);

  const [tab, setTab] = useState<'connections' | 'hardware'>('connections');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ConnectionType | ''>('');
  const [statusFilter, setStatusFilter] = useState<ConnectionStatus | ''>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [manufacturerFilter, setManufacturerFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Мастер создания узла (§126).
  const [partA, setPartA] = useState<PartId | ''>('');
  const [partB, setPartB] = useState<PartId | ''>('');
  const [presetId, setPresetId] = useState(BUILT_IN_CONNECTION_PRESETS[0].id);

  const parts = useMemo(() => allParts(project), [project]);
  const hardwareById = useMemo(
    () => new Map(project.hardware.map((h) => [String(h.id), h])),
    [project.hardware],
  );
  const partName = (id: PartId) => findPart(project, id)?.name ?? '—';

  const rows = useMemo(
    () => project.hardwareConnections.map((c) => ({ connection: c, status: connectionStatus(project, c) })),
    [project],
  );

  const filteredConnections = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(({ connection, status }) => {
      if (typeFilter && connection.connectionType !== typeFilter) return false;
      if (statusFilter && status !== statusFilter) return false;
      if (!q) return true;
      const hardware = hardwareById.get(String(connection.hardwareId));
      return (
        String(connection.id).toLowerCase().includes(q) ||
        (connection.stableId ?? '').toLowerCase().includes(q) ||
        partName(connection.partAId).toLowerCase().includes(q) ||
        partName(connection.partBId).toLowerCase().includes(q) ||
        (hardware?.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, typeFilter, statusFilter, search, hardwareById, project]);

  const bom = useMemo(() => hardwareBom(project), [project]);
  const issues = useMemo(() => validateHardwarePlacement(project), [project]);

  const filteredBom = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bom.filter((row) => {
      if (categoryFilter && row.category !== categoryFilter) return false;
      if (manufacturerFilter && row.manufacturer !== manufacturerFilter) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q) || row.article.toLowerCase().includes(q);
    });
  }, [bom, categoryFilter, manufacturerFilter, statusFilter, search]);

  const catalog = useMemo(
    () => project.hardware.filter((h) => showArchived || !h.archived),
    [project.hardware, showArchived],
  );

  const manufacturers = useMemo(
    () => [...new Set(project.hardware.map((h) => h.manufacturer).filter(Boolean) as string[])],
    [project.hardware],
  );
  const categories = useMemo(() => [...new Set(bom.map((r) => r.category))], [bom]);

  const onCreate = () => {
    if (!partA || !partB) { setMessage('Выберите обе детали.'); return; }
    const res = createConnectionFrom({ partAId: partA as PartId, partBId: partB as PartId, presetId });
    if (!res.ok) { setMessage(res.error ?? 'Соединение не создано.'); return; }
    setMessage(res.warnings.length > 0 ? res.warnings[0] : null);
    if (res.id) selectConnection(res.id);
  };

  const onDelete = (id: HardwareConnectionId) => {
    const impact = connectionRemovalImpact(project, String(id));
    removeConnection(id);
    setMessage(
      impact.operations > 0
        ? `Узел удалён. Присадка, порождённая им (${impact.operations} операций), пересчитана.`
        : 'Узел удалён.',
    );
  };

  const btn: React.CSSProperties = { fontSize: 11, padding: '2px 8px' };
  const sel: React.CSSProperties = { fontSize: 12, width: 'auto' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <button data-tab="connections" style={tab === 'connections' ? { ...btn, borderColor: 'var(--accent)', color: 'var(--accent)' } : btn}
          onClick={() => setTab('connections')}>Соединения ({project.hardwareConnections.length})</button>
        <button data-tab="hardware" style={tab === 'hardware' ? { ...btn, borderColor: 'var(--accent)', color: 'var(--accent)' } : btn}
          onClick={() => setTab('hardware')}>Фурнитура ({bom.length})</button>
        <span className="sep" />
        <input data-testid="hw-search" placeholder="Поиск: артикул, название, деталь"
          value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: '1 1 200px', fontSize: 12 }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ConnectionStatus | '')} style={sel}>
          <option value="">Любой статус</option>
          {(['VALID', 'WARNING', 'ERROR', 'DIRTY', 'OUTDATED'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {tab === 'connections' ? (
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ConnectionType | '')} style={sel}>
            <option value="">Все типы</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : (
          <>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={sel}>
              <option value="">Все категории</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={manufacturerFilter} onChange={(e) => setManufacturerFilter(e.target.value)} style={sel}>
              <option value="">Все производители</option>
              {manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </>
        )}
        <span style={{ marginLeft: 'auto' }} />
        <button style={btn} onClick={() => downloadText('hardware-bom.csv', hardwareBomCsv(project), 'text/csv')}>
          hardware-bom.csv
        </button>
        <button style={btn} onClick={() => printPages('Спецификация фурнитуры', [hardwareBomSvg(project)])}>
          PDF спецификации
        </button>
      </div>

      {/* Мастер создания узла (§125/§126/§127) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', fontSize: 12 }}>
        <span className="dim">Создать соединение</span>
        <select data-testid="conn-part-a" value={partA} onChange={(e) => setPartA(e.target.value as PartId)} style={sel}>
          <option value="">Деталь A…</option>
          {parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select data-testid="conn-part-b" value={partB} onChange={(e) => setPartB(e.target.value as PartId)} style={sel}>
          <option value="">Деталь B…</option>
          {parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select data-testid="conn-preset" value={presetId} onChange={(e) => setPresetId(e.target.value)} style={sel}>
          {BUILT_IN_CONNECTION_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button data-testid="conn-create" style={btn} onClick={onCreate}>Создать</button>
        <span className="sep" />
        <span className="dim">Каталог из шаблона</span>
        <select data-testid="hw-template" value="" style={sel} onChange={(e) => {
          if (!e.target.value) return;
          const id = createFromTemplate(e.target.value);
          setMessage(id ? 'Позиция добавлена в библиотеку.' : 'Шаблон не найден.');
        }}>
          <option value="">Выбрать шаблон…</option>
          {HARDWARE_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Показывать архив
        </label>
      </div>

      {message && (
        <div role="alert" style={{ padding: '6px 10px', background: 'rgba(230,180,60,0.15)', color: '#e6c060', fontSize: 12 }}>
          {message}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 10 }}>
        {tab === 'connections' ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--dim,#9aa0a6)' }}>
                <th>Тип</th><th>Деталь A</th><th>Деталь B</th><th>Фурнитура</th>
                <th>Кол-во</th><th>Статус</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filteredConnections.map(({ connection, status }) => (
                <tr key={connection.id} data-connection-row={connection.id}
                  onClick={() => selectConnection(connection.id)}
                  style={{
                    borderTop: '1px solid var(--border)', cursor: 'pointer',
                    background: selectedConnectionId === connection.id ? 'var(--accent-dim, rgba(90,156,248,0.12))' : undefined,
                  }}>
                  <td>{connection.connectionType ?? '—'}</td>
                  <td onClick={() => { selectPart(connection.partAId); onOpenPart?.(connection.partAId); }}>
                    {partName(connection.partAId)}
                  </td>
                  <td onClick={() => { selectPart(connection.partBId); onOpenPart?.(connection.partBId); }}>
                    {partName(connection.partBId)}
                  </td>
                  <td>{hardwareById.get(String(connection.hardwareId))?.name ?? 'не найдена'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      data-testid={`conn-qty-${connection.id}`}
                      type="number" min={0} style={{ width: 56, fontSize: 11 }}
                      value={connectionUnits(connection)}
                      onChange={(e) => setOverride(connection.id, Number(e.target.value))}
                    />
                    {isOverridden(connection) && (
                      <>
                        <span className="dim" style={{ fontSize: 10 }}> вручную ({computedUnits(connection)})</span>
                        <button style={{ ...btn, fontSize: 10 }} onClick={() => setOverride(connection.id, null)}>Сброс</button>
                      </>
                    )}
                  </td>
                  <td style={{ color: STATUS_COLOR[status] }} data-connection-status>{status}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button style={{ ...btn, color: 'var(--danger)' }} onClick={() => onDelete(connection.id)}>✕</button>
                  </td>
                </tr>
              ))}
              {filteredConnections.length === 0 && (
                <tr><td colSpan={7} className="dim">Соединений нет или все отфильтрованы.</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--dim,#9aa0a6)' }}>
                  <th>Артикул</th><th>Название</th><th>Категория</th><th>Производитель</th><th>Кол-во</th><th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {filteredBom.map((row) => (
                  <tr key={row.hardwareId} data-bom-row={row.hardwareId} style={{ borderTop: '1px solid var(--border)' }}>
                    <td>{row.article || '—'}</td>
                    <td>{row.name}</td>
                    <td>{row.category}</td>
                    <td className="dim">{row.manufacturer || '—'}</td>
                    <td>
                      {row.quantity}
                      {row.hasOverride && <span className="dim" style={{ fontSize: 10 }}> *</span>}
                    </td>
                    <td style={{ color: STATUS_COLOR[row.status] }}>{row.status}</td>
                  </tr>
                ))}
                {filteredBom.length === 0 && (
                  <tr><td colSpan={6} className="dim">Спецификация пуста.</td></tr>
                )}
              </tbody>
            </table>

            <h3 style={{ fontSize: 12, margin: '0 0 6px' }}>Библиотека фурнитуры ({catalog.length})</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--dim,#9aa0a6)' }}>
                  <th>Название</th><th>Категория</th><th>Артикул</th><th>Толщина</th><th></th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((h) => (
                  <tr key={h.id} data-catalog-row={h.id} style={{ borderTop: '1px solid var(--border)', opacity: h.archived ? 0.5 : 1 }}>
                    <td>{h.name}</td>
                    <td>{canonicalCategory(h)}</td>
                    <td className="dim">{h.article || '—'}</td>
                    <td className="dim">
                      {h.thicknessRange?.min != null ? `от ${h.thicknessRange.min}` : '—'}
                      {h.thicknessRange?.max != null ? ` до ${h.thicknessRange.max}` : ''}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button style={btn} onClick={() => duplicateHardware(h.id as HardwareId)}>Копия</button>
                      <button style={btn} onClick={() => setArchived(h.id as HardwareId, !h.archived)}>
                        {h.archived ? 'Вернуть' : 'В архив'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {issues.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 12, margin: '0 0 6px' }}>Проверки ({issues.length})</h3>
            {issues.slice(0, 20).map((issue, i) => (
              <div key={i} data-hw-issue style={{ fontSize: 11, color: STATUS_COLOR[issue.severity === 'error' ? 'ERROR' : 'WARNING'] }}>
                {issue.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export type { HardwareConnection };
