import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { createBlankHardware } from '@/core/model/factory';
import { HARDWARE_CATALOG, type HardwareTemplate } from '@/core/model/hardwareCatalog';
import { allParts } from '@/core/model/selectors';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { allOperations } from '@/engines/machining';
import { hardwareCategoryLabel } from '@/i18n/catalog';
import {
  builtinHardwarePresets, exportHardwareLibrary, expandedSpecification,
  hardwareCsv, hardwareSpecification, missingHardwareIds,
  validateHardwareCompatibility, validateHardwareReferences,
} from '@/engines/hardware';
import { downloadText } from '@/features/documents/print';
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
  const [search, setSearch] = useState('');
  const [maker, setMaker] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [expandKits, setExpandKits] = useState(false);
  const [specOpen, setSpecOpen] = useState(true);

  const setConnectionHardware = useEditorStore((s) => s.setConnectionHardware);
  const resetConnectionHardware = useEditorStore((s) => s.resetConnectionHardware);
  const applyPreset = useEditorStore((s) => s.applyHardwarePreset);
  const archiveHardware = useEditorStore((s) => s.archiveHardware);
  const replaceMissing = useEditorStore((s) => s.replaceMissingHardware);
  const importLibrary = useEditorStore((s) => s.importHardwareLibraryJson);

  const parts = useMemo(() => allParts(project), [project]);
  const ledger = useMemo(() => buildHardwareLedger(project.hardware, project.hardwareConnections), [project.hardware, project.hardwareConnections]);
  const ops = useMemo(() => allOperations(project), [project]);
  /* Спецификация считает количество из соединений (§17/§85): отдельного
   * ручного количества нет, поэтому таблица не может разойтись с моделью. */
  const spec = useMemo(
    () => (expandKits ? expandedSpecification(project) : hardwareSpecification(project)),
    [project, expandKits],
  );
  const refIssues = useMemo(() => validateHardwareReferences(project), [project]);
  const compatIssues = useMemo(() => validateHardwareCompatibility(project), [project]);
  const missing = useMemo(() => missingHardwareIds(project), [project]);
  const presets = useMemo(() => builtinHardwarePresets(project.hardware), [project.hardware]);
  const makers = useMemo(
    () => [...new Set(project.hardware.map((h) => h.manufacturer).filter((m): m is string => !!m))],
    [project.hardware],
  );

  /* Поиск (§14) и фильтры (§15) сужают список позиций; архивные скрыты, пока
   * их не попросят показать — иначе они мешают выбирать в новых узлах. */
  const visibleHardware = useMemo(() => {
    const q = search.trim().toLowerCase();
    return project.hardware.filter((h) => {
      if (filter !== 'all' && h.category !== filter) return false;
      if (maker && h.manufacturer !== maker) return false;
      if (!showArchived && h.archived) return false;
      if (!q) return true;
      return [h.name, h.article ?? '', hardwareCategoryLabel(h.category), h.manufacturer ?? '']
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [project.hardware, filter, maker, showArchived, search]);

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

        {/* Поиск (§14) и фильтры (§15). */}
        <input
          placeholder="Поиск: название, артикул, тип, производитель"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', marginBottom: 6, fontSize: 12 }}
        />
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {makers.length > 0 && (
            <select value={maker} onChange={(e) => setMaker(e.target.value)} style={{ width: 'auto', fontSize: 11 }}>
              <option value="">Все производители</option>
              {makers.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Архивные
          </label>
        </div>

        {/* Отсутствующие позиции: узел не удаляется, предлагается замена (§79/§80). */}
        {missing.length > 0 && (
          <div className="issue error" style={{ marginBottom: 8, padding: 8 }}>
            <div>Отсутствует позиций: {missing.length}. Соединения сохранены — назначьте замену.</div>
            {missing.map((id) => (
              <div key={id} style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
                <span className="dim" style={{ fontSize: 11 }}>{id.slice(0, 8)}</span>
                <select
                  defaultValue=""
                  style={{ width: 'auto', fontSize: 11 }}
                  onChange={(e) => { if (e.target.value) replaceMissing(id, e.target.value as Hardware['id']); }}
                >
                  <option value="">Назначить…</option>
                  {project.hardware.filter((h) => !h.archived).map((h) => (
                    <option key={h.id} value={String(h.id)}>{h.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
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
        {visibleHardware.map((hw) => {
          const count = ledger.find((r) => String(r.hardwareId) === String(hw.id))?.count ?? 0;
          return (
            <div key={hw.id} style={card} onClick={() => setHwEdit({ hardware: hw, isNew: false })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                <strong>{hw.name}</strong>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {hw.archived && <span className="dim" style={{ fontSize: 10 }}>архив</span>}
                  <span className="dim">{count} шт.</span>
                </span>
              </div>
              <div className="dim">{hardwareCategoryLabel(hw.category)}{hw.article ? ` · ${hw.article}` : ''}</div>
              <button
                style={{ fontSize: 10, marginTop: 4 }}
                onClick={(e) => { e.stopPropagation(); archiveHardware(hw.id, !hw.archived); }}
              >{hw.archived ? 'Вернуть из архива' : 'В архив'}</button>
            </div>
          );
        })}
        {visibleHardware.length === 0 && <div className="empty-hint">Ничего не найдено.</div>}

        {/* Спецификация: количество только из соединений (§49–§53). */}
        <div style={{ ...header, marginTop: 14 }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>Спецификация</h3>
          <button style={{ fontSize: 11 }} onClick={() => setSpecOpen((v) => !v)}>{specOpen ? '−' : '+'}</button>
        </div>
        {specOpen && (
          <>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={expandKits} onChange={(e) => setExpandKits(e.target.checked)} />
                Раскрыть комплекты
              </label>
              <span style={{ marginLeft: 'auto' }} />
              <button style={{ fontSize: 11 }} onClick={() => downloadText('hardware.csv', hardwareCsv(project), 'text/csv;charset=utf-8')}>hardware.csv</button>
              <button
                style={{ fontSize: 11 }}
                onClick={() => downloadText('hardware-library.json', exportHardwareLibrary(project.hardware, project.hardwareKits ?? []), 'application/json')}
              >Экспорт JSON</button>
              <label style={{ fontSize: 11, cursor: 'pointer', textDecoration: 'underline dotted' }}>
                Импорт JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const res = importLibrary(await file.text());
                    e.target.value = '';
                    if (!res.ok) alert(res.error ?? 'Не удалось прочитать библиотеку.');
                    else alert(`Импортировано позиций: ${res.added}${res.skipped ? `, пропущено: ${res.skipped}` : ''}`);
                  }}
                />
              </label>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-dim)' }}>
                  <th style={{ fontWeight: 400 }}>№</th>
                  <th style={{ fontWeight: 400 }}>Наименование</th>
                  <th style={{ fontWeight: 400 }}>Артикул</th>
                  <th style={{ fontWeight: 400, textAlign: 'right' }}>Кол-во</th>
                  <th style={{ fontWeight: 400 }}>Ед.</th>
                </tr>
              </thead>
              <tbody>
                {spec.map((r) => (
                  <tr key={String(r.hardwareId)} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="dim">{r.position}</td>
                    <td>
                      {r.name}
                      {r.note && <div className="dim" style={{ fontSize: 10 }}>{r.note}</div>}
                    </td>
                    <td className="dim">{r.article}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.quantity}</td>
                    <td className="dim">{r.unit}</td>
                  </tr>
                ))}
                {spec.length === 0 && <tr><td colSpan={5} className="dim">Фурнитура ещё не используется.</td></tr>}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* Соединения */}
      <section style={{ flex: 1.1, minWidth: 260 }}>
        <div style={header}>
          <h3 style={{ margin: 0 }}>Соединения</h3>
          <button onClick={() => setConnOpen(true)}>+ Создать</button>
        </div>
        {/* Пресеты фурнитуры (§64/§65): применяются к проекту целиком, а к
            выбранным деталям — из раздела свойств детали. */}
        {presets.length > 0 && (
          <select
            value=""
            style={{ width: '100%', marginBottom: 6, fontSize: 12 }}
            onChange={(e) => {
              const preset = presets.find((x) => x.id === e.target.value);
              if (!preset) return;
              const n = applyPreset(preset);
              alert(n > 0 ? `Пресет применён к ${n} узлам.` : 'Пресет ничего не изменил: фурнитура уже соответствует.');
            }}
          >
            <option value="">Применить пресет фурнитуры…</option>
            {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
        )}

        {(refIssues.length > 0 || compatIssues.length > 0) && (
          <div style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {refIssues.filter((i) => i.severity === 'error').length > 0 && (
              <span className="issue error" style={{ fontSize: 11, padding: '0 4px' }}>
                Ошибок ссылок: {refIssues.filter((i) => i.severity === 'error').length}
              </span>
            )}
            {compatIssues.length > 0 && (
              <span className="issue warning" style={{ fontSize: 11, padding: '0 4px' }} title={compatIssues[0].message}>
                Совместимость: {compatIssues.length}
              </span>
            )}
          </div>
        )}

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

            {/* Замена фурнитуры узла (§57/§62). Присадка производна от связи,
                поэтому пересчитывается сама, а «вернуть расчётную» знает,
                к какой позиции возвращаться (§63). */}
            <label className="field" style={{ marginTop: 8 }}>
              <span>Заменить фурнитуру</span>
              <select
                value={String(selected.hardwareId)}
                onChange={(e) => setConnectionHardware(selected.id, e.target.value as Hardware['id'])}
              >
                {project.hardware.filter((h) => !h.archived || String(h.id) === String(selected.hardwareId)).map((h) => (
                  <option key={h.id} value={String(h.id)}>{h.name}</option>
                ))}
              </select>
            </label>
            {selected.metadata?.hardwareOverride != null && (
              <button
                style={{ fontSize: 11, marginTop: 4 }}
                onClick={() => resetConnectionHardware(selected.id)}
              >Вернуть расчётную фурнитуру</button>
            )}

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
