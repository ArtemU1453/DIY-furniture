import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import {
  GRID_STEPS,
  MODULE_TEMPLATES,
  commonValue,
  exportModuleLibrary,
  hasParametricModel,
  importModuleLibrary,
  readParametricModel,
  toLibraryEntry,
  createModule,
  type ModuleParameterKey,
} from '@/engines/parametric';
import { allEdgeBanding, bandingTotalLength } from '@/engines/edges';
import { allOperations } from '@/engines/machining';
import { downloadText } from '@/features/documents/print';
import type { Furniture, Project } from '@/core/model/types';
import type { ParametricModel } from '@/core/parametric/types';
import type { FurnitureId, PartId } from '@/core/model/ids';

type StatusKind = 'VALID' | 'WARNING' | 'ERROR' | 'DIRTY' | 'OUTDATED';

/**
 * Дерево модулей и редактор параметров (§45–§52/§115–§119).
 *
 * Модуль — это изделие проекта с параметрической моделью. Второй системы
 * изделий не заводится: панель читает и правит существующий ProjectModel.
 */
export function ModulesView({ onOpenPart, onOpen3D }: {
  onOpenPart?: (id: PartId) => void;
  onOpen3D?: () => void;
} = {}) {
  const project = useEditorStore((s) => s.project);
  const activeId = useEditorStore((s) => s.activeFurnitureId);
  const setActive = useEditorStore((s) => s.setActiveFurniture);
  const selectPart = useEditorStore((s) => s.selectPart);
  const createFromTemplate = useEditorStore((s) => s.createModuleFromTemplate);
  const duplicate = useEditorStore((s) => s.duplicateFurniture);
  const mirror = useEditorStore((s) => s.mirrorFurniture);
  const rotate = useEditorStore((s) => s.rotateFurniture);
  const move = useEditorStore((s) => s.moveFurniture);
  const setVisible = useEditorStore((s) => s.setFurnitureVisible);
  const setLocked = useEditorStore((s) => s.setFurnitureLocked);
  const applyToModules = useEditorStore((s) => s.applyToModules);
  const applyModel = useEditorStore((s) => s.applyParametricModel);
  const removeFurniture = useEditorStore((s) => s.removeFurniture);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [visibleOnly, setVisibleOnly] = useState(false);
  const [selection, setSelection] = useState<FurnitureId[]>([]);
  const [gridStep, setGridStep] = useState(0);
  const [multiValue, setMultiValue] = useState('');
  const [multiKey, setMultiKey] = useState<ModuleParameterKey>('width');

  const modelOf = (f: Furniture): ParametricModel | null =>
    hasParametricModel(f) ? readParametricModel(f) : null;

  /** Сводка модуля: детали, кромка, присадка — из тех же движков, что и везде. */
  const summaryOf = useMemo(() => {
    const edges = allEdgeBanding(project);
    const ops = allOperations(project);
    return (f: Furniture) => {
      const ids = new Set(f.assemblies.flatMap((a) => a.parts.map((p) => String(p.id))));
      const parts = f.assemblies.flatMap((a) => a.parts);
      return {
        partCount: parts.reduce((n, p) => n + p.quantity, 0),
        edgeMeters: edges.filter((b) => ids.has(String(b.partId)))
          .reduce((n, b) => n + bandingTotalLength(b), 0) / 1000,
        operationCount: ops.filter((op) => ids.has(String(op.partId))).length,
      };
    };
  }, [project]);

  const statusOf = (f: Furniture): StatusKind => {
    const model = modelOf(f);
    if (!model) return 'VALID';
    if (model.width <= 0 || model.height <= 0 || model.depth <= 0) return 'ERROR';
    if (f.assemblies.every((a) => a.parts.length === 0)) return 'DIRTY';
    return 'VALID';
  };

  /* Поиск (§115) и фильтры (§116) сужают дерево; они независимы. */
  const modules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return project.furnitures.filter((f) => {
      if (typeFilter && (modelOf(f)?.kind ?? '') !== typeFilter) return false;
      if (visibleOnly && f.metadata?.hidden === true) return false;
      if (!q) return true;
      return [f.name, String(f.id), modelOf(f)?.kind ?? ''].some((v) => v.toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.furnitures, search, typeFilter, visibleOnly]);

  const kinds = useMemo(
    () => [...new Set(project.furnitures.map((f) => modelOf(f)?.kind).filter((k): k is NonNullable<typeof k> => !!k))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.furnitures],
  );

  const selectedModels = selection
    .map((id) => project.furnitures.find((f) => f.id === id))
    .filter((f): f is Furniture => !!f)
    .map(modelOf)
    .filter((m): m is ParametricModel => m !== null);

  const shared = selectedModels.length > 0 ? commonValue(selectedModels, multiKey) : null;

  const toggleSelect = (id: FurnitureId, additive: boolean) => {
    setSelection((prev) => {
      if (!additive) return [id];
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    });
  };

  const active = project.furnitures.find((f) => f.id === activeId);
  const activeModel = active ? modelOf(active) : null;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Дерево модулей */}
      <aside style={{ width: 320, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 10 }}>
        <h3 style={hdr}>Модули ({modules.length})</h3>

        <select
          value=""
          style={{ width: '100%', marginBottom: 8, fontSize: 12 }}
          onChange={(e) => { if (e.target.value) createFromTemplate(e.target.value); }}
        >
          <option value="">Создать модуль из шаблона…</option>
          {MODULE_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>{t.name} — {t.description}</option>
          ))}
        </select>

        <input
          placeholder="Поиск: название, ID, тип"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', marginBottom: 6, fontSize: 12 }}
        />
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={sel}>
            <option value="">Все типы</option>
            {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={visibleOnly} onChange={(e) => setVisibleOnly(e.target.checked)} />
            Только видимые
          </label>
        </div>

        {modules.map((f) => {
          const model = modelOf(f);
          const summary = summaryOf(f);
          const status = statusOf(f);
          const selected = selection.includes(f.id);
          const hidden = f.metadata?.hidden === true;
          const locked = f.metadata?.locked === true;
          return (
            <div
              key={f.id}
              style={{
                border: `1px solid ${f.id === activeId ? 'var(--accent)' : selected ? '#5a7fbf' : 'var(--border)'}`,
                borderRadius: 6, padding: '6px 8px', marginBottom: 6, cursor: 'pointer',
                background: selected ? 'var(--accent-dim)' : 'transparent',
                opacity: hidden ? 0.5 : 1,
              }}
              onClick={(e) => { setActive(f.id); toggleSelect(f.id, e.ctrlKey || e.metaKey || e.shiftKey); }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                <strong style={{ fontSize: 12 }}>{f.name}</strong>
                <span style={{ fontSize: 10, color: STATUS_COLOR[status] }}>{status}</span>
              </div>
              <div className="dim" style={{ fontSize: 11 }}>
                {model ? `${model.kind} · ${model.width}×${model.height}×${model.depth}` : 'без параметров'}
              </div>
              <div className="dim" style={{ fontSize: 10 }}>
                {summary.partCount} дет. · {summary.edgeMeters.toFixed(1)} м кромки · {summary.operationCount} опер.
                {locked && ' · заблокирован'}
              </div>
            </div>
          );
        })}
        {modules.length === 0 && <div className="empty-hint">Ничего не найдено.</div>}
      </aside>

      {/* Свойства модуля */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 12 }}>
        {!active && <div className="empty-hint">Выберите модуль слева.</div>}
        {active && (
          <>
            <h3 style={hdr}>{active.name}</h3>

            {/* Трансформации (§81–§90) */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
              <button style={btn} onClick={() => duplicate(active.id)}>Дублировать</button>
              <button style={btn} onClick={() => mirror(active.id)}>Отразить</button>
              <button style={btn} onClick={() => rotate(active.id, 90)}>Повернуть 90°</button>
              <button style={btn} onClick={() => rotate(active.id, 180)}>180°</button>
              <button style={btn} onClick={() => rotate(active.id, 0)}>Сбросить поворот</button>
              <button style={btn} onClick={() => setVisible(active.id, active.metadata?.hidden === true)}>
                {active.metadata?.hidden === true ? 'Показать' : 'Скрыть'}
              </button>
              <button style={btn} onClick={() => setLocked(active.id, active.metadata?.locked !== true)}>
                {active.metadata?.locked === true ? 'Разблокировать' : 'Заблокировать'}
              </button>
              <button style={{ ...btn, color: 'var(--danger)' }} onClick={() => removeFurniture(active.id)}>Удалить</button>
            </div>

            {/* Размещение и привязка (§87–§90) */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="dim" style={{ fontSize: 11 }}>Положение</span>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <label key={axis} style={{ fontSize: 11, display: 'flex', gap: 3, alignItems: 'center' }}>
                  {axis.toUpperCase()}
                  <input
                    type="number"
                    value={Math.round(active.position[axis])}
                    style={{ width: 72, fontSize: 11 }}
                    onChange={(e) => move(active.id, { [axis]: Number(e.target.value) }, gridStep)}
                  />
                </label>
              ))}
              <label style={{ fontSize: 11, display: 'flex', gap: 3, alignItems: 'center' }}>
                Сетка
                <select value={gridStep} onChange={(e) => setGridStep(Number(e.target.value))} style={sel}>
                  <option value={0}>выкл</option>
                  {GRID_STEPS.map((step) => <option key={step} value={step}>{step} мм</option>)}
                </select>
              </label>
            </div>

            {/* Параметры модуля (§48) */}
            {activeModel && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
                {(['width', 'height', 'depth', 'thickness'] as const).map((key) => (
                  <label key={key} className="field">
                    <span>{PARAM_LABELS[key]}</span>
                    <input
                      type="number"
                      value={activeModel[key]}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        // §9: недопустимое значение не пишется в модель.
                        if (!Number.isFinite(value) || value <= 0) return;
                        applyModel(active.id, { ...activeModel, [key]: value });
                      }}
                    />
                  </label>
                ))}
                <label className="field">
                  <span>Полки</span>
                  <input
                    type="number" min={0}
                    value={activeModel.shelves.count}
                    onChange={(e) => applyModel(active.id, {
                      ...activeModel, shelves: { ...activeModel.shelves, count: Math.max(0, Number(e.target.value)) },
                    })}
                  />
                </label>
                <label className="field">
                  <span>Фасады</span>
                  <input
                    type="number" min={0}
                    value={activeModel.doors.count}
                    onChange={(e) => applyModel(active.id, {
                      ...activeModel, doors: { ...activeModel.doors, count: Math.max(0, Number(e.target.value)) },
                    })}
                  />
                </label>
                <label className="field">
                  <span>Ящики</span>
                  <input
                    type="number" min={0}
                    value={activeModel.drawers.count}
                    onChange={(e) => applyModel(active.id, {
                      ...activeModel, drawers: { ...activeModel.drawers, count: Math.max(0, Number(e.target.value)) },
                    })}
                  />
                </label>
                <label className="field">
                  <span>Задняя стенка, мм</span>
                  <input
                    type="number" min={0}
                    value={activeModel.backPanel.thickness}
                    onChange={(e) => applyModel(active.id, {
                      ...activeModel, backPanel: { ...activeModel.backPanel, thickness: Math.max(0, Number(e.target.value)) },
                    })}
                  />
                </label>
              </div>
            )}

            {/* Групповое редактирование (§117–§119) */}
            {selection.length > 1 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginBottom: 12 }}>
                <strong style={{ fontSize: 12 }}>Выбрано модулей: {selection.length}</strong>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                  <select value={multiKey} onChange={(e) => setMultiKey(e.target.value as ModuleParameterKey)} style={sel}>
                    {(['width', 'height', 'depth', 'thickness'] as const).map((k) => (
                      <option key={k} value={k}>{PARAM_LABELS[k]}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder={shared != null ? String(shared) : 'разные значения'}
                    value={multiValue}
                    onChange={(e) => setMultiValue(e.target.value)}
                    style={{ width: 100, fontSize: 12 }}
                  />
                  <button
                    style={btn}
                    onClick={() => {
                      const value = Number(multiValue);
                      if (!Number.isFinite(value) || value <= 0) return;
                      const res = applyToModules(selection, multiKey, value);
                      alert(`Изменено модулей: ${res.applied}${res.skipped ? `, пропущено: ${res.skipped}` : ''}`);
                    }}
                  >Применить ко всем</button>
                </div>
              </div>
            )}

            {/* Библиотека модулей (§99–§104) */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <button
                style={btn}
                onClick={() => {
                  const model = modelOf(active);
                  const module = createModule({ name: active.name, parameters: model ?? undefined });
                  downloadText('module.json', exportModuleLibrary([toLibraryEntry(module, active.name)]), 'application/json');
                }}
              >Экспорт module.json</button>
              <label style={{ fontSize: 11, cursor: 'pointer', textDecoration: 'underline dotted', alignSelf: 'center' }}>
                Импорт module.json
                <input
                  type="file" accept="application/json,.json" style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const res = importModuleLibrary(await file.text());
                    e.target.value = '';
                    if (!res.ok) { alert(res.error ?? 'Не удалось прочитать библиотеку модулей.'); return; }
                    alert(`Прочитано модулей: ${res.entries.length}${res.skipped ? `, пропущено: ${res.skipped}` : ''}`);
                  }}
                />
              </label>
              <button style={btn} onClick={onOpen3D}>Показать в 3D</button>
            </div>

            {/* Детали модуля (§59) */}
            <h3 style={hdr}>Детали</h3>
            <ul className="parts-list">
              {active.assemblies.flatMap((a) => a.parts).map((p) => (
                <li key={p.id} onClick={() => { selectPart(p.id); onOpenPart?.(p.id); }}>
                  <span>{(p.metadata?.number as string) ?? ''} {p.name}</span>
                  <span className="dim">{Math.round(p.width)}×{Math.round(p.height)}</span>
                </li>
              ))}
            </ul>
            {allParts(project as Project).length === 0 && <div className="empty-hint">Деталей нет.</div>}
          </>
        )}
      </div>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  VALID: 'var(--ok)',
  WARNING: '#e6c060',
  ERROR: 'var(--danger)',
  DIRTY: '#e6c060',
  OUTDATED: '#e6c060',
};

const PARAM_LABELS: Record<string, string> = {
  width: 'Ширина, мм',
  height: 'Высота, мм',
  depth: 'Глубина, мм',
  thickness: 'Толщина, мм',
};

const hdr: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', margin: '0 0 8px' };
const btn: React.CSSProperties = { fontSize: 11 };
const sel: React.CSSProperties = { width: 'auto', fontSize: 11 };
