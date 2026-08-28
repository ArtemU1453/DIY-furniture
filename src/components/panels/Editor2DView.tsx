import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import {
  GRID_STEPS_2D,
  addGuide,
  alignEntities,
  boundsOf,
  centerInParent,
  collectIssues,
  createDimension,
  createGuide,
  dimensionInfo,
  distributeEntities,
  equalSize,
  fitBounds,
  focusBounds,
  issueSummary,
  mirrorEntities,
  modelOfEntity,
  moveEntities,
  nudgeDelta,
  parentOffsets,
  projectBounds,
  removeGuide,
  resizeEntity,
  rotateEntities,
  selectedEntities,
  setEntityPosition,
  setGuideLocked,
  setParameter,
  type AlignMode,
  type EditorEntity,
  type EditorTool,
  type EntityType,
  type ModelChange,
  type PlacementPatch,
  type ResizeHandle,
  type ViewPlane,
} from '@/engines/editor2d';
import { breakLink, resetLink } from '@/engines/parametric';
import { MODULE_TEMPLATES } from '@/engines/parametric';
import { Editor2DCanvas } from './Editor2DCanvas';
import type { PartId } from '@/core/model/ids';

const PLANE_LABEL: Record<ViewPlane, string> = { TOP: 'Сверху', FRONT: 'Спереди', SIDE: 'Сбоку' };

const TOOLS: Array<{ id: EditorTool; label: string; key: string }> = [
  { id: 'select', label: 'Выбор', key: 'V' },
  { id: 'move', label: 'Перемещение', key: 'M' },
  { id: 'rotate', label: 'Поворот', key: 'R' },
  { id: 'guide', label: 'Направляющая', key: 'G' },
  { id: 'dimension', label: 'Размер', key: 'D' },
];

const ENTITY_LABEL: Record<EntityType, string> = {
  MODULE: 'Модули', PART: 'Детали', HARDWARE: 'Фурнитура',
  CONNECTION: 'Соединения', REFERENCE: 'Опорные',
};

const STATUS_COLOR: Record<string, string> = {
  ERROR: 'var(--danger,#e05252)',
  WARNING: 'var(--warn,#e0a030)',
  DIRTY: 'var(--warn,#e0a030)',
  VALID: 'var(--ok,#4caf50)',
};

/**
 * 2D-редактор конструкции (§1).
 *
 * Слева — дерево проекта (§112), в центре — холст, справа — свойства (§113).
 * Всё, что меняет конструкцию, идёт в ProjectModel через действия стора (§3);
 * состояние интерфейса живёт в editor2d и в проект не сохраняется (§2/§131).
 */
export function Editor2DView({ onOpenPart }: { onOpenPart?: (id: PartId) => void } = {}) {
  const project = useEditorStore((s) => s.project);
  const ui = useEditorStore((s) => s.editor2d);
  const setUi = useEditorStore((s) => s.setEditor2D);
  const setPlane = useEditorStore((s) => s.setEditorPlane);
  const setSelection = useEditorStore((s) => s.setEditorSelection);
  const toggleSelect = useEditorStore((s) => s.toggleEditorSelection);
  const applyChanges = useEditorStore((s) => s.applyEditorChanges);
  const setHidden = useEditorStore((s) => s.setEditorHidden);
  const setLocked = useEditorStore((s) => s.setEditorLocked);
  const showAll = useEditorStore((s) => s.editorShowAll);
  const isolate = useEditorStore((s) => s.editorIsolate);
  const setGuides = useEditorStore((s) => s.setEditorGuides);
  const setDimensions = useEditorStore((s) => s.setEditorDimensions);
  const copy = useEditorStore((s) => s.editorCopy);
  const paste = useEditorStore((s) => s.editorPaste);
  const duplicate = useEditorStore((s) => s.editorDuplicate);
  const remove = useEditorStore((s) => s.editorDelete);
  const getEntities = useEditorStore((s) => s.editorEntities);
  const addPart = useEditorStore((s) => s.addPart);
  const createModule = useEditorStore((s) => s.createModuleFromTemplate);
  const applyParametricModel = useEditorStore((s) => s.applyParametricModel);
  const selectPart = useEditorStore((s) => s.selectPart);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const [message, setMessage] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string | null; x: number; y: number } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 600 });
  const canvasHostRef = useRef<HTMLDivElement>(null);

  /* Размер области нужен только для «вписать в экран» (§89–§91). Читается
   * через ResizeObserver, а не в ref-колбэке: колбэк выполняется на каждом
   * рендере, и запись состояния из него уводит компонент в бесконечный цикл. */
  useEffect(() => {
    const el = canvasHostRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setCanvasSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Сущности пересобираются из ProjectModel — своей копии редактор не держит (§3).
  const entities = useMemo(() => getEntities(), [getEntities, project, ui.plane, ui.filter, ui.hidden, ui.locked, ui.isolated, ui.showHardware, ui.showConnections]);
  const issues = useMemo(() => collectIssues(project), [project]);
  const summary = useMemo(() => issueSummary(issues), [issues]);
  const selected = useMemo(() => selectedEntities(entities, ui.selection), [entities, ui.selection]);
  const active = selected.at(-1);
  const activeModel = useMemo(() => (active ? modelOfEntity(project, active) : null), [project, active]);

  const notify = useCallback((text: string | null) => setMessage(text), []);

  /** Применить результат операции: изменения — в модель, отказы — пользователю. */
  const run = useCallback(
    (result: { changes: ModelChange[]; refusals: Array<{ message: string }> }) => {
      if (result.refusals.length > 0) notify(result.refusals[0].message);
      else notify(null);
      if (result.changes.length > 0) applyChanges(result.changes);
    },
    [applyChanges, notify],
  );

  /** Перевести целевые координаты в изменения модели (§40–§43). */
  const applyPlacement = useCallback(
    (patch: PlacementPatch) => {
      const changes: ModelChange[] = [];
      const refusals: Array<{ message: string }> = [];
      for (const [entityId, target] of Object.entries(patch)) {
        const entity = entities.find((e) => e.entityId === entityId);
        if (!entity) continue;
        const res = setEntityPosition(entity, ui.plane, target.x, target.y);
        changes.push(...res.changes);
        refusals.push(...res.refusals);
      }
      run({ changes, refusals });
    },
    [entities, ui.plane, run],
  );

  const onMove = useCallback(
    (ids: string[], dx: number, dy: number) => {
      const list = entities.filter((e) => ids.includes(e.entityId));
      run(moveEntities(list, ui.plane, dx, dy));
    },
    [entities, ui.plane, run],
  );

  const onResize = useCallback(
    (id: string, handle: ResizeHandle, width: number, height: number) => {
      const entity = entities.find((e) => e.entityId === id);
      if (!entity) return;
      run(resizeEntity(entity, { plane: ui.plane, handle, width, height, model: modelOfEntity(project, entity) }));
    },
    [entities, ui.plane, project, run],
  );

  const fitTo = useCallback(
    (list: EditorEntity[]) => {
      const bounds = list.length > 0 ? boundsOf(list) : projectBounds(entities);
      if (!bounds) return;
      const camera = fitBounds(bounds, canvasSize.width, canvasSize.height);
      setUi(camera);
    },
    [entities, canvasSize, setUi],
  );

  // ── Горячие клавиши (§109/§110) ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(ui.selection); return; }
      if (mod && e.key.toLowerCase() === 'c') { copy(ui.selection); return; }
      if (mod && e.key.toLowerCase() === 'v') { paste(); return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod) return;

      switch (e.key.toLowerCase()) {
        case 'v': setUi({ tool: 'select' }); return;
        case 'm': setUi({ tool: 'move' }); return;
        case 'r': setUi({ tool: 'rotate' }); return;
        case 'g': setUi({ tool: 'guide' }); return;
        case 'd': setUi({ tool: 'dimension' }); return;
      }
      if (e.key === 'Escape') { setSelection([]); setUi({ pending: null }); notify(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ui.selection.length === 0) return;
        e.preventDefault();
        const res = remove(ui.selection);
        if (res.warnings.length > 0) notify(res.warnings[0]);
        return;
      }
      // Точное перемещение стрелками (§23/§24).
      const delta = nudgeDelta(e.key, e.shiftKey);
      if (delta && ui.selection.length > 0) {
        e.preventDefault();
        onMove(ui.selection, delta.dx, delta.dy);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui.selection, setUi, setSelection, duplicate, copy, paste, undo, redo, remove, onMove, notify]);

  const btn: React.CSSProperties = { fontSize: 11, padding: '2px 8px' };
  const activeBtn: React.CSSProperties = { ...btn, borderColor: 'var(--accent)', color: 'var(--accent)' };

  return (
    /* Абсолютное позиционирование внутри .center-body (она relative) даёт
     * области определённую высоту. Без него дерево проекта на сотнях деталей
     * растягивает редактор за пределы окна и уводит холст с линейками вниз. */
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Панель инструментов (§111) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {TOOLS.map((t) => (
          <button key={t.id} data-tool={t.id} style={ui.tool === t.id ? activeBtn : btn}
            title={`${t.label} (${t.key})`} onClick={() => setUi({ tool: t.id })}>{t.label}</button>
        ))}
        <span className="sep" />
        <button style={btn} onClick={() => { const id = addPart({ name: 'Деталь', width: 600, height: 400, thickness: 16 }); setSelection([String(id)]); }}>
          + Деталь
        </button>
        <select style={{ fontSize: 11, width: 'auto' }} value="" onChange={(e) => {
          if (!e.target.value) return;
          const id = createModule(e.target.value);
          if (id) setSelection([String(id)]);
        }}>
          <option value="">+ Модуль из шаблона…</option>
          {MODULE_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="sep" />
        {(['TOP', 'FRONT', 'SIDE'] as const).map((p) => (
          <button key={p} data-plane={p} style={ui.plane === p ? activeBtn : btn} onClick={() => setPlane(p)}>
            {PLANE_LABEL[p]}
          </button>
        ))}
        <span className="sep" />
        <button style={btn} onClick={() => setUi({ zoom: Math.min(20, ui.zoom * 1.25) })}>+</button>
        <button style={btn} onClick={() => setUi({ zoom: Math.max(0.005, ui.zoom / 1.25) })}>−</button>
        <button style={btn} onClick={() => fitTo([])}>Весь проект</button>
        <button style={btn} disabled={selected.length === 0} onClick={() => fitTo(selected)}>По выбранному</button>
        <span style={{ marginLeft: 'auto' }} />
        <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={ui.readOnly} onChange={(e) => setUi({ readOnly: e.target.checked })} />
          Только чтение
        </label>
      </div>

      {/* Параметры вида: сетка, привязки, слои (§9–§13, §101) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', fontSize: 11, color: 'var(--dim,#9aa0a6)' }}>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={ui.showGrid} onChange={(e) => setUi({ showGrid: e.target.checked })} />Сетка
        </label>
        <select data-testid="grid-step" style={{ fontSize: 11, width: 'auto' }} value={ui.gridStep}
          onChange={(e) => setUi({ gridStep: Number(e.target.value) })}>
          {GRID_STEPS_2D.map((s) => <option key={s} value={s}>{s} мм</option>)}
        </select>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input data-testid="snap-grid" type="checkbox" checked={ui.snap.toGrid}
            onChange={(e) => setUi({ snap: { ...ui.snap, toGrid: e.target.checked } })} />К сетке
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={ui.snap.toObjects}
            onChange={(e) => setUi({ snap: { ...ui.snap, toObjects: e.target.checked } })} />К объектам
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          Радиус
          <input type="number" min={0} style={{ width: 48, fontSize: 11 }} value={ui.snap.distance}
            onChange={(e) => setUi({ snap: { ...ui.snap, distance: Math.max(0, Number(e.target.value) || 0) } })} />
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={ui.showRulers} onChange={(e) => setUi({ showRulers: e.target.checked })} />Линейки
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={ui.showGuides} onChange={(e) => setUi({ showGuides: e.target.checked })} />Направляющие
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={ui.showLabels} onChange={(e) => setUi({ showLabels: e.target.checked })} />Подписи
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={ui.showMachining} onChange={(e) => setUi({ showMachining: e.target.checked })} />Присадка
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={ui.showEdges} onChange={(e) => setUi({ showEdges: e.target.checked })} />Кромка
        </label>
        <span className="sep" />
        {(Object.keys(ENTITY_LABEL) as EntityType[]).filter((t) => t !== 'REFERENCE').map((type) => (
          <label key={type} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={ui.filter[type] !== false}
              onChange={(e) => setUi({ filter: { ...ui.filter, [type]: e.target.checked } })} />
            {ENTITY_LABEL[type]}
          </label>
        ))}
      </div>

      {/* Выравнивание и распределение (§40–§43) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {([['LEFT', 'По левому'], ['CENTER', 'По центру'], ['RIGHT', 'По правому'],
           ['BOTTOM', 'По низу'], ['MIDDLE', 'По середине'], ['TOP', 'По верху']] as Array<[AlignMode, string]>).map(([mode, label]) => (
          <button key={mode} style={btn} disabled={selected.length < 2}
            onClick={() => applyPlacement(alignEntities(selected, mode))}>{label}</button>
        ))}
        <span className="sep" />
        <button style={btn} disabled={selected.length < 3} onClick={() => applyPlacement(distributeEntities(selected, 'x'))}>Распределить →</button>
        <button style={btn} disabled={selected.length < 3} onClick={() => applyPlacement(distributeEntities(selected, 'y'))}>Распределить ↑</button>
        <span className="sep" />
        <button style={btn} disabled={selected.length < 2} onClick={() => {
          const patch = equalSize(selected, 'width', active?.entityId);
          const changes: ModelChange[] = [];
          for (const [id, size] of Object.entries(patch)) {
            const entity = entities.find((e) => e.entityId === id);
            if (entity && size.width != null) changes.push(...setParameter(entity, 'width', size.width).changes);
          }
          run({ changes, refusals: [] });
        }}>Равная ширина</button>
        <button style={btn} disabled={selected.length < 2} onClick={() => {
          const patch = equalSize(selected, 'height', active?.entityId);
          const changes: ModelChange[] = [];
          for (const [id, size] of Object.entries(patch)) {
            const entity = entities.find((e) => e.entityId === id);
            if (entity && size.height != null) changes.push(...setParameter(entity, 'height', size.height).changes);
          }
          run({ changes, refusals: [] });
        }}>Равная высота</button>
        <span className="sep" />
        <button style={btn} disabled={!active} onClick={() => run(rotateEntities(selected, (active?.transform.rotation ?? 0) + 90))}>Повернуть 90°</button>
        <button style={btn} disabled={selected.length === 0} onClick={() => run(mirrorEntities(selected, 'horizontal'))}>Отразить</button>
        <span className="sep" />
        <button style={btn} disabled={selected.length === 0} onClick={() => isolate(ui.selection)}>Изолировать</button>
        <button style={btn} onClick={showAll}>Показать всё</button>
      </div>

      {message && (
        <div role="alert" style={{ padding: '4px 10px', background: 'rgba(230,180,60,0.15)', color: '#e6c060', fontSize: 12 }}>
          {message}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Дерево проекта (§112/§138) */}
        <aside style={{ width: 230, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 8 }}>
          <h3 style={{ fontSize: 12, margin: '0 0 6px' }}>Дерево проекта ({entities.length})</h3>
          {entities.slice(0, 400).map((e) => (
            <div key={e.entityId} data-tree-row={e.entityId}
              onClick={(evt) => (evt.ctrlKey || evt.metaKey ? toggleSelect(e.entityId) : setSelection([e.entityId]))}
              style={{
                display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, padding: '2px 4px',
                cursor: 'pointer', borderRadius: 4, opacity: e.hidden ? 0.45 : 1,
                background: ui.selection.includes(e.entityId) ? 'var(--accent-dim, rgba(90,156,248,0.15))' : 'transparent',
              }}>
              <span style={{ color: STATUS_COLOR[e.status ?? 'VALID'] }}>●</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.number ? `${e.number} ` : ''}{e.label}
              </span>
              <span className="dim" style={{ fontSize: 9 }}>{e.entityType}</span>
            </div>
          ))}
          {entities.length > 400 && (
            <div className="dim" style={{ fontSize: 10, marginTop: 4 }}>
              Показаны первые 400 из {entities.length}. Пользуйтесь фильтрами и изоляцией.
            </div>
          )}
        </aside>

        {/* Холст */}
        <div style={{ flex: 1, minWidth: 0 }} ref={canvasHostRef}>
          <Editor2DCanvas
            project={project}
            entities={entities}
            ui={ui}
            onViewChange={(patch) => setUi(patch)}
            onSelect={(ids, additive) => {
              if (additive) ids.forEach((id) => toggleSelect(id));
              else setSelection(ids);
              const first = ids[0];
              const entity = first ? entities.find((e) => e.entityId === first) : undefined;
              if (entity?.entityType === 'PART') selectPart(entity.entityId as PartId);
            }}
            onMove={onMove}
            onResize={onResize}
            onActivate={(id) => {
              const entity = entities.find((e) => e.entityId === id);
              if (entity?.entityType === 'PART') onOpenPart?.(entity.entityId as PartId);
            }}
            onContextMenu={(id, at) => setMenu({ id, x: at.x, y: at.y })}
            onCreateGuide={(orientation, position) => {
              if (ui.tool !== 'guide' && !ui.showGuides) return;
              setGuides(addGuide(ui.guides, createGuide(orientation, Math.round(position), ui.plane)));
            }}
            onMeasure={(from, to) => setDimensions([...ui.dimensions, createDimension(from, to, ui.plane)])}
          />
        </div>

        {/* Свойства (§113–§117) */}
        <aside style={{ width: 250, borderLeft: '1px solid var(--border)', overflow: 'auto', padding: 8 }}>
          <h3 style={{ fontSize: 12, margin: '0 0 6px' }}>Свойства</h3>
          {!active && <div className="empty-hint">Выберите объект на холсте.</div>}

          {active && selected.length > 1 && (
            <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
              {/* §117: при нескольких объектах показываются только общие параметры. */}
              Выбрано: {selected.length}. Общие параметры: положение, поворот.
            </div>
          )}

          {active && (
            <>
              <Row k="Тип" v={active.entityType} />
              <Row k="Имя" v={active.label} />
              {active.number && <Row k="Позиция" v={active.number} />}

              <label className="field"><span>X, мм</span>
                <input data-testid="prop-x" type="number" value={Math.round(active.transform.x)}
                  onChange={(e) => run(setEntityPosition(active, ui.plane, Number(e.target.value), undefined))} />
              </label>
              <label className="field"><span>Y, мм</span>
                <input data-testid="prop-y" type="number" value={Math.round(active.transform.y)}
                  onChange={(e) => run(setEntityPosition(active, ui.plane, undefined, Number(e.target.value)))} />
              </label>
              <label className="field"><span>Поворот, °</span>
                <input data-testid="prop-rotation" type="number" step={90} value={active.transform.rotation}
                  onChange={(e) => run(rotateEntities([active], Number(e.target.value)))} />
              </label>

              {/* Размеры с указанием источника значения (§34–§37, §139–§142) */}
              {(['width', 'height'] as const).map((axis) => {
                const info = dimensionInfo(active, axis, activeModel);
                return (
                  <label key={axis} className="field" title={`${info.value} мм · ${info.origin ?? ''}`}>
                    <span>
                      {axis === 'width' ? 'Ширина' : 'Высота'}, мм
                      {' '}
                      <span className="dim" style={{ fontSize: 10 }}>
                        {info.source === 'LINKED' ? 'fx' : info.source === 'DERIVED' ? 'производный' : 'manual'}
                      </span>
                    </span>
                    <input
                      data-testid={`prop-${axis}`}
                      type="number"
                      value={Math.round(info.value)}
                      disabled={!info.editable || ui.readOnly}
                      onChange={(e) => run(setParameter(active, axis, Number(e.target.value)))}
                    />
                  </label>
                );
              })}

              {/* Разрыв и восстановление связи параметра (§38/§39) */}
              {activeModel && (
                <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                  <button style={btn} onClick={() => {
                    const parameters = activeModel.parameters.map((p) => (p.expression ? breakLink(p, Number(p.value) || 0) : p));
                    applyParametricModel(active.entityId as never, { ...activeModel, parameters });
                    notify('Связь параметров разорвана — значения стали ручными.');
                  }}>Разорвать связь</button>
                  <button style={btn} onClick={() => {
                    const parameters = activeModel.parameters.map(resetLink);
                    applyParametricModel(active.entityId as never, { ...activeModel, parameters });
                    notify('Связь параметров восстановлена.');
                  }}>Восстановить связь</button>
                </div>
              )}

              {/* Расстояния до границ владельца (§44) */}
              {active.parentId && (() => {
                const parent = entities.find((e) => e.entityId === active.parentId);
                if (!parent) return null;
                const o = parentOffsets(active, parent);
                return (
                  <div style={{ marginTop: 8 }}>
                    <div className="dim" style={{ fontSize: 11 }}>Отступы в модуле</div>
                    <Row k="Слева" v={`${Math.round(o.left)} мм`} />
                    <Row k="Справа" v={`${Math.round(o.right)} мм`} />
                    <Row k="Сверху" v={`${Math.round(o.top)} мм`} />
                    <Row k="Снизу" v={`${Math.round(o.bottom)} мм`} />
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      <button style={btn} onClick={() => applyPlacement(centerInParent(selected, parent, 'horizontal'))}>Центр по X</button>
                      <button style={btn} onClick={() => applyPlacement(centerInParent(selected, parent, 'vertical'))}>Центр по Y</button>
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                <button style={btn} onClick={() => setHidden(active.entityId, !ui.hidden.includes(active.entityId))}>
                  {ui.hidden.includes(active.entityId) ? 'Показать' : 'Скрыть'}
                </button>
                <button style={btn} onClick={() => setLocked(active.entityId, !ui.locked.includes(active.entityId))}>
                  {ui.locked.includes(active.entityId) ? 'Разблокировать' : 'Заблокировать'}
                </button>
                <button style={btn} onClick={() => duplicate(ui.selection)}>Дублировать</button>
                <button style={{ ...btn, color: 'var(--danger)' }} onClick={() => {
                  const res = remove(ui.selection);
                  if (res.warnings.length > 0) notify(res.warnings[0]);
                }}>Удалить</button>
              </div>
            </>
          )}

          {/* Направляющие (§49–§52) */}
          <h3 style={{ fontSize: 12, margin: '14px 0 6px' }}>Направляющие ({ui.guides.filter((g) => g.plane === ui.plane).length})</h3>
          {ui.guides.filter((g) => g.plane === ui.plane).map((g) => (
            <div key={g.id} data-guide-row={g.id} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, marginBottom: 2 }}>
              <span style={{ flex: 1 }}>{g.orientation === 'vertical' ? 'X' : 'Y'} = {Math.round(g.position)}</span>
              <button style={btn} onClick={() => setGuides(setGuideLocked(ui.guides, g.id, !g.locked))}>{g.locked ? '🔒' : '🔓'}</button>
              <button style={btn} onClick={() => setGuides(removeGuide(ui.guides, g.id))}>✕</button>
            </div>
          ))}
          {ui.guides.filter((g) => g.plane === ui.plane).length === 0 && (
            <div className="dim" style={{ fontSize: 11 }}>Потяните с линейки, чтобы добавить.</div>
          )}

          {/* Проверки (§135–§137) */}
          <h3 style={{ fontSize: 12, margin: '14px 0 6px' }}>
            Проверки{summary.errors + summary.warnings > 0 ? ` (${summary.errors}/${summary.warnings})` : ''}
          </h3>
          {issues.slice(0, 30).map((issue) => (
            <div key={issue.id} data-issue={issue.id}
              onClick={() => {
                if (issue.entityId) setSelection([issue.entityId]);
                const bounds = focusBounds(issue, entities);
                if (bounds) setUi(fitBounds(bounds, canvasSize.width, canvasSize.height));
              }}
              style={{ fontSize: 11, padding: '2px 0', cursor: issue.entityId ? 'pointer' : 'default', color: STATUS_COLOR[issue.severity] ?? undefined }}>
              {issue.message}
            </div>
          ))}
          {issues.length === 0 && <div className="dim" style={{ fontSize: 11 }}>Замечаний нет.</div>}
        </aside>
      </div>

      {/* Контекстное меню (§84) */}
      {menu && (
        <div
          data-testid="editor2d-menu"
          style={{
            position: 'fixed', left: menu.x, top: menu.y, zIndex: 40,
            background: 'var(--bg-panel, #17181b)', border: '1px solid var(--border)',
            borderRadius: 6, padding: 4, display: 'flex', flexDirection: 'column', minWidth: 150,
          }}
          onMouseLeave={() => setMenu(null)}
        >
          {[
            ['Редактировать', () => { if (menu.id) { setSelection([menu.id]); const e = entities.find((x) => x.entityId === menu.id); if (e?.entityType === 'PART') onOpenPart?.(e.entityId as PartId); } }],
            ['Дублировать', () => duplicate(menu.id ? [menu.id] : ui.selection)],
            ['Повернуть 90°', () => { const e = entities.find((x) => x.entityId === menu.id); if (e) run(rotateEntities([e], e.transform.rotation + 90)); }],
            ['Зеркалить', () => { const e = entities.find((x) => x.entityId === menu.id); if (e) run(mirrorEntities([e], 'horizontal')); }],
            ['Выровнять по левому', () => applyPlacement(alignEntities(selected, 'LEFT'))],
            ['Скрыть', () => menu.id && setHidden(menu.id, true)],
            ['Заблокировать', () => menu.id && setLocked(menu.id, true)],
            ['Удалить', () => { const res = remove(menu.id ? [menu.id] : ui.selection); if (res.warnings.length) notify(res.warnings[0]); }],
          ].map(([label, action]) => (
            <button key={label as string} style={{ ...btn, textAlign: 'left', border: 'none', background: 'transparent' }}
              onClick={() => { (action as () => void)(); setMenu(null); }}>{label as string}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '1px 0', fontSize: 11 }}>
      <span className="dim">{k}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
}
