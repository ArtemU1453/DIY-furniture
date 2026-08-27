import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import {
  EdgeMaterialService,
  HardwareService,
  MaterialService,
  ManufacturingProfileService,
  SheetFormatService,
  MATERIAL_CATEGORIES,
  GRAIN_OPTIONS,
  GRAIN_OPTION_LABELS,
  diffFromLibrary,
  edgeUsage,
  grainOptionOf,
  hardwareUsage,
  materialCategory,
  materialThicknesses,
  materialUsage,
  previewRules,
  profileUsage,
  parseLibrary,
  mergeLibrary,
  resetLibrary,
  searchEdges,
  searchHardware,
  searchMaterials,
  serializeLibrary,
  type GrainOption,
  type LibraryModel,
} from '@/engines/library';
import { MATERIAL_CATEGORY_LABELS, HARDWARE_CATEGORY_LABELS } from '@/i18n/catalog';
import { downloadText } from '@/features/documents/print';
import type { HardwareCategory, MaterialCategory } from '@/core/model/types';

type Section = 'materials' | 'edges' | 'hardware' | 'profiles';

const SECTIONS: Array<[Section, string]> = [
  ['materials', 'Материалы'],
  ['edges', 'Кромка'],
  ['hardware', 'Фурнитура'],
  ['profiles', 'Профили'],
];

const HW_FILTERS: Array<[HardwareCategory | 'all', string]> = [
  ['all', 'Все'], ['confirmat', 'Конфирматы'], ['dowel', 'Шканты'], ['minifix', 'Минификсы'],
  ['hinge', 'Петли'], ['handle', 'Ручки'], ['screw', 'Саморезы'], ['other', 'Другое'],
];

export function LibraryView() {
  const library = useEditorStore((s) => s.library);
  const setLibrary = useEditorStore((s) => s.setLibrary);
  const project = useEditorStore((s) => s.project);
  const addMaterialFromLibrary = useEditorStore((s) => s.addMaterialFromLibrary);
  const addEdgeFromLibrary = useEditorStore((s) => s.addEdgeFromLibrary);
  const addHardwareFromLibrary = useEditorStore((s) => s.addHardwareFromLibrary);
  const applyProfileFromLibrary = useEditorStore((s) => s.applyProfileFromLibrary);
  const updateFromLibrary = useEditorStore((s) => s.updateFromLibrary);

  const [section, setSection] = useState<Section>('materials');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MaterialCategory | 'all'>('all');
  const [thickness, setThickness] = useState<number | 'all'>('all');
  const [grain, setGrain] = useState<GrainOption | 'all'>('all');
  const [hwCategory, setHwCategory] = useState<HardwareCategory | 'all'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const allMaterials = MaterialService.list(library);
  const allEdges = EdgeMaterialService.list(library);
  const allHardware = HardwareService.list(library);
  const allProfiles = ManufacturingProfileService.list(library);

  const materials = useMemo(
    () => searchMaterials(allMaterials, { query, category, thickness, grain, includeArchived: showArchived }),
    [allMaterials, query, category, thickness, grain, showArchived],
  );
  const edges = useMemo(
    () => searchEdges(allEdges, { query, includeArchived: showArchived }),
    [allEdges, query, showArchived],
  );
  const hardware = useMemo(
    () => searchHardware(allHardware, { query, category: hwCategory, includeArchived: showArchived }),
    [allHardware, query, hwCategory, showArchived],
  );
  const profiles = useMemo(
    () => allProfiles.filter((p) => showArchived || !p.archived),
    [allProfiles, showArchived],
  );

  // Обновления, доступные проекту из библиотеки (§62).
  const updates = useMemo(() => diffFromLibrary(project, library), [project, library]);

  const apply = (result: { ok: boolean; library: LibraryModel; message?: string }) => {
    if (result.ok) setLibrary(result.library);
    setMessage(result.message ?? null);
  };

  /** Использование записи в текущем проекте (§49–§51). */
  const usageOf = (id: string) => {
    if (section === 'materials') return materialUsage(project, id);
    if (section === 'edges') return edgeUsage(project, id);
    if (section === 'hardware') return hardwareUsage(project, id);
    return profileUsage(project, id);
  };

  const serviceOf = () => {
    if (section === 'materials') return MaterialService;
    if (section === 'edges') return EdgeMaterialService;
    if (section === 'hardware') return HardwareService;
    return ManufacturingProfileService;
  };

  const onDuplicate = (id: string) => apply(serviceOf().duplicate(library, id));
  const onArchive = (id: string, archived: boolean) => apply(serviceOf().setArchived(library, id, archived));
  const onDelete = (id: string) => {
    const used = usageOf(id).usedCount;
    const result = serviceOf().remove(library, id, used);
    apply(result);
  };

  const onExport = (only?: Section) => {
    const subset: LibraryModel = only
      ? { ...library, materials: only === 'materials' ? library.materials : [],
          edges: only === 'edges' ? library.edges : [],
          hardware: only === 'hardware' ? library.hardware : [],
          profiles: only === 'profiles' ? library.profiles : [],
          sheetFormats: only === 'materials' ? library.sheetFormats : [] }
      : library;
    const name = only ? `${only}.json` : 'library.json';
    downloadText(name, serializeLibrary(subset), 'application/json');
  };

  const onImport = async (file: File) => {
    const text = await file.text();
    const result = parseLibrary(text);
    if (!result.ok) {
      setMessage(`Импорт отклонён: ${result.issues[0]?.message ?? 'файл повреждён'}`);
      return;
    }
    // Импорт не затирает библиотеку — он с ней сливается (§56).
    setLibrary(mergeLibrary(library, result.library));
    const migrated = result.migration ? `, миграция ${result.migration.fromVersion}→${result.migration.toVersion}` : '';
    const warnings = result.issues.filter((i) => i.severity === 'warning').length;
    setMessage(`Импортировано: материалов ${result.counts.materials}, кромки ${result.counts.edges}, фурнитуры ${result.counts.hardware}${migrated}${warnings ? `, предупреждений ${warnings}` : ''}.`);
  };

  const selectedHardware = section === 'hardware' ? allHardware.find((h) => String(h.id) === selectedId) : undefined;
  const rulePreview = selectedHardware ? previewRules(selectedHardware) : [];

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Структура библиотеки (§32/§35) */}
      <aside style={{ width: 230, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 10 }}>
        <h3 style={hdr}>Библиотека</h3>
        <ul className="nav-list">
          {SECTIONS.map(([key, label]) => (
            <li key={key} className={key === section ? 'active' : ''}
                onClick={() => { setSection(key); setSelectedId(null); setMessage(null); }}>
              {label}
            </li>
          ))}
        </ul>

        {section === 'materials' && (
          <div className="panel-section" style={sect}>
            <span className="dim">Категории</span>
            <ul className="nav-list">
              <li className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>Все</li>
              {MATERIAL_CATEGORIES.map((c) => (
                <li key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>
                  {MATERIAL_CATEGORY_LABELS[c]}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="panel-section" style={sect}>
          <span className="dim">Импорт / экспорт</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            <button onClick={() => onExport()}>Экспорт библиотеки</button>
            <button onClick={() => onExport('materials')}>materials.json</button>
            <button onClick={() => onExport('hardware')}>hardware.json</button>
            <button onClick={() => onExport('profiles')}>profiles.json</button>
            <label className="btn-like" style={importLabel}>
              Импорт JSON
              <input
                type="file" accept="application/json" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ''; }}
              />
            </label>
            <button onClick={() => { setLibrary(resetLibrary()); setMessage('Библиотека сброшена к поставке.'); }}>
              Сбросить к поставке
            </button>
          </div>
        </div>

        {updates.length > 0 && (
          <div className="panel-section" style={sect}>
            <div className="issue warning" style={{ marginBottom: 6 }}>
              Для проекта доступно обновлений: {updates.length}
            </div>
            <button style={{ width: '100%' }} onClick={() => {
              const n = updateFromLibrary();
              setMessage(`Обновлено объектов проекта: ${n}.`);
            }}>
              Обновить из библиотеки
            </button>
          </div>
        )}
      </aside>

      {/* Список карточек (§36) */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={toolbar}>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: название, категория, код, производитель"
            style={{ flex: 1, minWidth: 200 }}
          />
          {section === 'materials' && (
            <>
              <select value={String(thickness)} onChange={(e) => setThickness(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                <option value="all">Толщина: все</option>
                {materialThicknesses(allMaterials).map((t) => <option key={t} value={t}>{t} мм</option>)}
              </select>
              <select value={grain} onChange={(e) => setGrain(e.target.value as GrainOption | 'all')}>
                <option value="all">Текстура: любая</option>
                {GRAIN_OPTIONS.map((g) => <option key={g} value={g}>{GRAIN_OPTION_LABELS[g]}</option>)}
              </select>
            </>
          )}
          {section === 'hardware' && (
            <select value={hwCategory} onChange={(e) => setHwCategory(e.target.value as HardwareCategory | 'all')}>
              {HW_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <span className="dim">Показать архив</span>
          </label>
        </div>

        {message && <div className="issue warning" style={{ margin: '8px 10px' }}>{message}</div>}

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 10, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', alignContent: 'start' }}>
          {section === 'materials' && materials.map((m) => {
            const usage = materialUsage(project, String(m.id));
            return (
              <article key={m.id} className="card" style={cardStyle(m.archived)} onClick={() => setSelectedId(String(m.id))}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 16, height: 16, borderRadius: 3, background: m.color, border: '1px solid var(--border)' }} />
                  <strong>{m.name}</strong>
                  {m.archived && <span className="dim" style={badge}>архив</span>}
                </div>
                <div className="dim" style={meta}>
                  {MATERIAL_CATEGORY_LABELS[materialCategory(m)]} · {m.thickness} мм · {m.sheet.length}×{m.sheet.width}
                </div>
                <div className="dim" style={meta}>
                  {GRAIN_OPTION_LABELS[grainOptionOf(m.grain)]}
                  {SheetFormatService.list(library, String(m.id)).length > 1
                    ? ` · форматов: ${SheetFormatService.list(library, String(m.id)).length}` : ''}
                </div>
                {usage.usedCount > 0 && (
                  <div className="dim" style={meta}>Используется: {usage.references.join(', ')}</div>
                )}
                <div style={actions}>
                  <button onClick={(e) => { e.stopPropagation(); addMaterialFromLibrary(String(m.id)); setMessage(`«${m.name}» добавлен в проект.`); }}>В проект</button>
                  <button onClick={(e) => { e.stopPropagation(); onDuplicate(String(m.id)); }}>Копия</button>
                  <button onClick={(e) => { e.stopPropagation(); onArchive(String(m.id), !m.archived); }}>
                    {m.archived ? 'Вернуть' : 'В архив'}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onDelete(String(m.id)); }}>Удалить</button>
                </div>
              </article>
            );
          })}

          {section === 'edges' && edges.map((e) => (
            <article key={e.id} className="card" style={cardStyle(e.archived)} onClick={() => setSelectedId(String(e.id))}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 16, height: 16, borderRadius: 3, background: e.color, border: '1px solid var(--border)' }} />
                <strong>{e.name}</strong>
                {e.archived && <span className="dim" style={badge}>архив</span>}
              </div>
              <div className="dim" style={meta}>{e.thickness} мм{e.width ? ` × ${e.width}` : ''}{e.material ? ` · ${e.material}` : ''}</div>
              {(e.manufacturer || e.code) && (
                <div className="dim" style={meta}>{e.manufacturer ?? '—'} · {e.code ?? '—'}</div>
              )}
              <div style={actions}>
                <button onClick={(ev) => { ev.stopPropagation(); addEdgeFromLibrary(String(e.id)); setMessage(`«${e.name}» добавлена в проект.`); }}>В проект</button>
                <button onClick={(ev) => { ev.stopPropagation(); onDuplicate(String(e.id)); }}>Копия</button>
                <button onClick={(ev) => { ev.stopPropagation(); onArchive(String(e.id), !e.archived); }}>{e.archived ? 'Вернуть' : 'В архив'}</button>
                <button onClick={(ev) => { ev.stopPropagation(); onDelete(String(e.id)); }}>Удалить</button>
              </div>
            </article>
          ))}

          {section === 'hardware' && hardware.map((h) => {
            const usage = hardwareUsage(project, String(h.id));
            const params = Object.entries(h.parameters ?? {}).slice(0, 3);
            return (
              <article key={h.id} className="card" style={cardStyle(h.archived)} onClick={() => setSelectedId(String(h.id))}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong>{h.name}</strong>
                  {h.archived && <span className="dim" style={badge}>архив</span>}
                </div>
                <div className="dim" style={meta}>{HARDWARE_CATEGORY_LABELS[h.category]}</div>
                <div className="dim" style={meta}>
                  {h.manufacturer || '—'} · {h.article || h.model || '—'}
                </div>
                {params.length > 0 && (
                  <div className="dim" style={meta}>{params.map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>
                )}
                {usage.usedCount > 0 && (
                  <div className="dim" style={meta}>Используется: {usage.references.join(', ')}</div>
                )}
                <div style={actions}>
                  <button onClick={(e) => { e.stopPropagation(); addHardwareFromLibrary(String(h.id)); setMessage(`«${h.name}» добавлена в проект.`); }}>В проект</button>
                  <button onClick={(e) => { e.stopPropagation(); onDuplicate(String(h.id)); }}>Копия</button>
                  <button onClick={(e) => { e.stopPropagation(); onArchive(String(h.id), !h.archived); }}>{h.archived ? 'Вернуть' : 'В архив'}</button>
                  <button onClick={(e) => { e.stopPropagation(); onDelete(String(h.id)); }}>Удалить</button>
                </div>
              </article>
            );
          })}

          {section === 'profiles' && profiles.map((p) => (
            <article key={p.id} className="card" style={cardStyle(p.archived)} onClick={() => setSelectedId(p.id)}>
              <strong>{p.name}</strong>
              <div className="dim" style={meta}>Пропил {p.sawKerf} мм · обрезка {p.trimAllowance ?? 0} мм</div>
              <div className="dim" style={meta}>Остаток от {p.minimumRemnant ?? 0} мм · отступ {p.minHoleEdgeDistance} мм</div>
              <div className="dim" style={meta}>Глубина сверления {p.defaultDrillDepth} мм · {p.defaultJointType}</div>
              <div style={actions}>
                <button onClick={(e) => { e.stopPropagation(); applyProfileFromLibrary(p.id); setMessage(`Профиль «${p.name}» назначен проекту.`); }}>Применить</button>
                <button onClick={(e) => { e.stopPropagation(); onDuplicate(p.id); }}>Копия</button>
                <button onClick={(e) => { e.stopPropagation(); onArchive(p.id, !p.archived); }}>{p.archived ? 'Вернуть' : 'В архив'}</button>
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* Предпросмотр (§39/§43) */}
      <aside style={{ width: 260, borderLeft: '1px solid var(--border)', overflow: 'auto', padding: 10 }}>
        <h3 style={hdr}>Предпросмотр</h3>
        {!selectedId && <div className="dim">Выберите позицию библиотеки.</div>}

        {selectedId && section === 'materials' && (() => {
          const m = allMaterials.find((x) => String(x.id) === selectedId);
          if (!m) return <div className="dim">Позиция не найдена.</div>;
          const formats = SheetFormatService.list(library, String(m.id));
          return (
            <div>
              <strong>{m.name}</strong>
              <Row label="Категория" value={MATERIAL_CATEGORY_LABELS[materialCategory(m)]} />
              <Row label="Толщина" value={`${m.thickness} мм`} />
              <Row label="Формат" value={`${m.sheet.length}×${m.sheet.width}`} />
              <Row label="Текстура" value={GRAIN_OPTION_LABELS[grainOptionOf(m.grain)]} />
              {formats.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <span className="dim">Форматы листа</span>
                  {formats.map((f) => (
                    <div key={f.id} className="dim" style={meta}>
                      {f.length}×{f.width} · приоритет {f.priority}{f.active ? '' : ' · выкл.'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {selectedId && section === 'hardware' && selectedHardware && (
          <div>
            <strong>{selectedHardware.name}</strong>
            <Row label="Категория" value={HARDWARE_CATEGORY_LABELS[selectedHardware.category]} />
            <Row label="Производитель" value={selectedHardware.manufacturer || '—'} />
            <Row label="Артикул" value={selectedHardware.article || '—'} />
            <div style={{ marginTop: 8 }}>
              <span className="dim">Параметры</span>
              {Object.entries(selectedHardware.parameters ?? {}).map(([k, v]) => (
                <div key={k} className="dim" style={meta}>{k}: {String(v)}</div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <span className="dim">Будет создано</span>
              {rulePreview.length === 0
                ? <div className="dim" style={meta}>Правило по категории крепежа.</div>
                : rulePreview.map((r, i) => <div key={i} style={meta}>{r.label}</div>)}
            </div>
          </div>
        )}

        {updates.length > 0 && (
          <div className="panel-section" style={sect}>
            <span className="dim">Изменения из библиотеки</span>
            {updates.map((d) => (
              <div key={d.projectId} style={{ marginTop: 6 }}>
                <strong style={{ fontSize: 12 }}>{d.name}</strong>
                <span className="dim" style={{ fontSize: 11 }}> rev {d.fromRevision} → {d.toRevision}</span>
                {d.fields.map((f) => (
                  <div key={f.field} className="dim" style={meta}>
                    {f.label}: {f.before} → {f.after}
                  </div>
                ))}
                {d.affectsProduction && (
                  <div className="issue warning" style={{ marginTop: 4 }}>Затронет раскрой и документы.</div>
                )}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
      <span className="dim">{label}</span>
      <span>{value}</span>
    </div>
  );
}

const hdr: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-dim)', margin: '0 0 8px',
};
const sect: React.CSSProperties = { padding: 0, marginTop: 12, borderBottom: 'none' };
const toolbar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px',
  borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
};
const meta: React.CSSProperties = { fontSize: 11, marginTop: 2 };
const badge: React.CSSProperties = {
  fontSize: 10, border: '1px solid var(--border)', borderRadius: 3, padding: '0 4px',
};
const actions: React.CSSProperties = { display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' };
const importLabel: React.CSSProperties = {
  display: 'inline-block', textAlign: 'center', cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12,
};
const cardStyle = (archived?: boolean): React.CSSProperties => ({
  padding: 10, border: '1px solid var(--border)', borderRadius: 8,
  cursor: 'pointer', opacity: archived ? 0.55 : 1,
});
