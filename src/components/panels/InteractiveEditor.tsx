/**
 * Интерактивный редактор (§1–§144).
 *
 * Панель — это ПУЛЬТ: она показывает выбранное, размеры, привязки и команды, а
 * геометрию считают движки. Выделение общее с 3D и 2D (§96–§98), поэтому клик
 * по детали в сцене подсвечивает её здесь, и наоборот.
 */
import { useEffect, useMemo, useState } from 'react';
import { useEditorStore, type InteractionTool } from '@/app/store/editorStore';
import {
  COMMANDS,
  beginDimensionEdit,
  buildStatusLine,
  changePreview,
  commandForKey,
  dependencyPreview,
  dimensionsOfPart,
  formatMm,
  gizmoBounds,
  isCommandEnabled,
  issuesByPart,
  linkIndicator,
  measureDistance,
  measurePart,
  menuFor,
  overriddenFields,
  previewDimension,
  selectedParts,
  snapPreview,
  type DimensionEdit,
  type MenuItem,
} from '@/engines/interaction';
import { alignEntities, distributeEntities, type AlignMode } from '@/engines/editor2d';
import { allParts, findPart } from '@/core/model/selectors';
import type { Part } from '@/core/model/types';
import type { PartId } from '@/core/model/ids';

const TOOLS: Array<[InteractionTool, string, string]> = [
  ['select', 'Выбор', 'V'],
  ['move', 'Перемещение', 'M'],
  ['rotate', 'Поворот', 'R'],
  ['resize', 'Размер', 'S'],
  ['dimension', 'Размеры', 'D'],
  ['guide', 'Направляющая', 'G'],
  ['measure', 'Измерение', ''],
];

const ALIGN_MODES: Array<[AlignMode, string]> = [
  ['LEFT', 'Левый край'],
  ['CENTER', 'Центр по X'],
  ['RIGHT', 'Правый край'],
  ['TOP', 'Верх'],
  ['MIDDLE', 'Середина'],
  ['BOTTOM', 'Низ'],
];

export function InteractiveEditor({ onOpen3D }: { onOpen3D?: () => void }) {
  const project = useEditorStore((s) => s.project);
  const interaction = useEditorStore((s) => s.interaction);
  const setTool = useEditorStore((s) => s.setInteractionTool);
  const selectEntity = useEditorStore((s) => s.selectEntity);
  const hoverEntity = useEditorStore((s) => s.hoverEntity);
  const selectAllEntities = useEditorStore((s) => s.selectAllEntities);
  const clearSelection = useEditorStore((s) => s.clearInteractionSelection);
  const selectParentEntity = useEditorStore((s) => s.selectParentEntity);
  const selectChildrenEntities = useEditorStore((s) => s.selectChildrenEntities);
  const setSnapSettings = useEditorStore((s) => s.setSnapSettings);
  const setGizmoState = useEditorStore((s) => s.setGizmoState);
  const addGuide = useEditorStore((s) => s.addInteractionGuide);
  const moveGuide = useEditorStore((s) => s.moveInteractionGuide);
  const removeGuide = useEditorStore((s) => s.removeInteractionGuide);
  const dragPart = useEditorStore((s) => s.dragConstructivePart);
  const resizePartAction = useEditorStore((s) => s.resizeSelectedPart);
  const resetFormula = useEditorStore((s) => s.resetPartFormula);
  const setPartLock = useEditorStore((s) => s.setPartLock);
  const measureAt = useEditorStore((s) => s.measureAt);
  const setEditorHidden = useEditorStore((s) => s.setEditorHidden);
  const editorIsolate = useEditorStore((s) => s.editorIsolate);
  const editorDuplicate = useEditorStore((s) => s.editorDuplicate);
  const editorDelete = useEditorStore((s) => s.editorDelete);
  const editorCopy = useEditorStore((s) => s.editorCopy);
  const editorPaste = useEditorStore((s) => s.editorPaste);
  const updatePart = useEditorStore((s) => s.updatePart);
  const beginTx = useEditorStore((s) => s.beginInteractionTransaction);
  const endTx = useEditorStore((s) => s.endInteractionTransaction);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const hidden = useEditorStore((s) => s.editor2d.hidden);
  const isolated = useEditorStore((s) => s.editor2d.isolated);

  const [messages, setMessages] = useState<string[]>([]);
  const [edit, setEdit] = useState<DimensionEdit | null>(null);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [guideValue, setGuideValue] = useState('0');
  const [guideAxis, setGuideAxis] = useState<'x' | 'y' | 'z'>('y');

  const parts = useMemo(() => allParts(project), [project]);
  const selection = interaction.selection;
  const selected = useMemo(() => selectedParts(project, selection), [project, selection]);
  const active: Part | null = selected.length > 0 ? selected[selected.length - 1] : null;
  const bounds = useMemo(() => gizmoBounds(selected), [selected]);
  const issues = useMemo(() => issuesByPart(project), [project]);
  const dimensions = useMemo(
    () => (active ? dimensionsOfPart(active, { overridden: overriddenFields(active) }) : []),
    [active],
  );

  const status = buildStatusLine({
    cursor: interaction.cursor,
    selectedNames: selected.map((p) => p.name),
    tool: TOOLS.find(([id]) => id === interaction.tool)?.[1] ?? interaction.tool,
    snapEnabled: interaction.snap.enabled,
  });

  const note = (text: string) => setMessages((m) => [text, ...m].slice(0, 20));

  // Горячие клавиши: не срабатывают внутри полей ввода (§126/§127).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = commandForKey(event, event.target as HTMLElement | null);
      if (!command) return;
      event.preventDefault();
      runCommand(command.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const runCommand = (id: string) => {
    const ids = selection.ids;
    switch (id) {
      case 'select.all': selectAllEntities(); break;
      case 'select.none': clearSelection(); setEdit(null); setMenu(null); break;
      case 'select.parent': selectParentEntity(); break;
      case 'select.children': selectChildrenEntities(); break;
      case 'tool.select': setTool('select'); break;
      case 'tool.move': setTool('move'); break;
      case 'tool.rotate': setTool('rotate'); break;
      case 'tool.resize': setTool('resize'); break;
      case 'tool.dimension': setTool('dimension'); break;
      case 'tool.guide': setTool('guide'); break;
      case 'tool.measure': setTool('measure'); break;
      case 'structure.delete': {
        const result = editorDelete(ids);
        note(`Удалено: ${result.removed}`);
        break;
      }
      case 'structure.duplicate': note(`Дублировано: ${editorDuplicate(ids).length}`); break;
      case 'structure.hide': for (const x of ids) setEditorHidden(x, true); note('Скрыто'); break;
      case 'structure.isolate': editorIsolate(ids); note('Изолировано'); break;
      case 'structure.lock':
        if (active) { setPartLock(active.id as PartId, { position: true, size: true }); note('Заблокировано'); }
        break;
      case 'transform.resetOverride':
        if (active) { resetFormula(active.id as PartId); note('Значения возвращены к расчёту'); }
        break;
      case 'clipboard.copy': note(`Скопировано: ${editorCopy(ids)}`); break;
      case 'clipboard.paste': note(`Вставлено: ${editorPaste().length}`); break;
      case 'history.undo': undo(); break;
      case 'history.redo': redo(); break;
      case 'view.fitAll': onOpen3D?.(); break;
      default: break;
    }
    setMenu(null);
  };

  const commitDimension = () => {
    if (!edit || !active) return;
    const preview = previewDimension(edit, draft);
    if (!preview.ok) { note(preview.message ?? 'Значение отклонено.'); return; }
    if (edit.field) {
      const result = resizePartAction(active.id as PartId, edit.field, preview.after);
      note(result.ok
        ? `${edit.field}: ${formatMm(edit.original)} → ${formatMm(preview.after)}`
        : result.message ?? 'Изменение отклонено.');
    }
    setEdit(null);
  };

  const alignSelected = (mode: AlignMode) => {
    if (selected.length < 2) { note('Для выравнивания выберите хотя бы две детали.'); return; }
    const entities = selected.map((p) => ({
      entityId: String(p.id), entityType: 'PART' as const,
      transform: { x: p.position.x, y: p.position.y, width: p.width, height: p.height, rotation: 0, mirrored: false },
      selectionState: 'selected' as const, label: p.name, locked: false, hidden: false,
    }));
    const patches = alignEntities(entities, mode);
    beginTx('align', `Выравнивание: ${mode}`);
    for (const [entityId, patch] of Object.entries(patches)) {
      const part = findPart(project, entityId as PartId);
      if (!part) continue;
      updatePart(part.id as PartId, {
        position: { ...part.position, x: patch.x ?? part.position.x, y: patch.y ?? part.position.y },
      });
    }
    endTx();
    note(`Выровнено деталей: ${Object.keys(patches).length}`);
  };

  const distributeSelected = (axis: 'x' | 'y') => {
    if (selected.length < 3) { note('Для распределения выберите хотя бы три детали.'); return; }
    const entities = selected.map((p) => ({
      entityId: String(p.id), entityType: 'PART' as const,
      transform: { x: p.position.x, y: p.position.y, width: p.width, height: p.height, rotation: 0, mirrored: false },
      selectionState: 'selected' as const, label: p.name, locked: false, hidden: false,
    }));
    const patches = distributeEntities(entities, axis);
    beginTx('distribute', 'Распределение');
    for (const [entityId, patch] of Object.entries(patches)) {
      const part = findPart(project, entityId as PartId);
      if (!part) continue;
      updatePart(part.id as PartId, {
        position: { ...part.position, x: patch.x ?? part.position.x, y: patch.y ?? part.position.y },
      });
    }
    endTx();
    note(`Распределено деталей: ${Object.keys(patches).length}`);
  };

  const dragActive = (value: number) => {
    if (!active) return;
    beginTx('drag', `Перетаскивание «${active.name}»`);
    const outcome = dragPart(active.id as PartId, value);
    endTx();
    note(outcome.ok ? outcome.description : outcome.refusal?.message ?? 'Перетаскивание отклонено.');
  };

  const snapInfo = active
    ? snapPreview(
        { x: active.position.x, y: active.position.y, z: active.position.z },
        { project, guides: interaction.guides, settings: interaction.snap, excludeIds: [String(active.id)] },
      )
    : null;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, items: menuFor(active ? 'PART' : null) });
      }}
    >
      {/* Панель инструментов (§130) */}
      <div style={toolbar} data-testid="interaction-toolbar">
        {TOOLS.map(([id, label, key]) => (
          <button key={id} data-testid={`tool-${id}`}
            className={interaction.tool === id ? 'active' : ''}
            title={key ? `${label} (${key})` : label}
            onClick={() => setTool(id)}>
            {label}
          </button>
        ))}
        <span className="sep" style={{ margin: '0 6px' }} />
        <button data-testid="align-left" onClick={() => alignSelected('LEFT')}>Выровнять</button>
        <button data-testid="distribute-x" onClick={() => distributeSelected('x')}>Распределить</button>
        <button data-testid="mirror-x" onClick={() => {
          if (!active) { note('Выберите деталь.'); return; }
          beginTx('mirror', 'Зеркало');
          updatePart(active.id as PartId, { position: { ...active.position, x: -active.position.x } });
          endTx();
          note('Деталь отражена по X');
        }}>Отразить</button>
        <span className="sep" style={{ margin: '0 6px' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input data-testid="snap-enabled" type="checkbox" checked={interaction.snap.enabled}
            onChange={(e) => setSnapSettings({ enabled: e.target.checked })} />
          <span className="dim" style={{ fontSize: 11 }}>Привязка</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="dim" style={{ fontSize: 11 }}>Сетка</span>
          <input data-testid="grid-size" type="number" style={{ width: 60 }} value={interaction.snap.gridSize}
            onChange={(e) => setSnapSettings({ gridSize: Number(e.target.value) })} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="dim" style={{ fontSize: 11 }}>Радиус</span>
          <input data-testid="snap-tolerance" type="number" style={{ width: 60 }} value={interaction.snap.tolerance}
            onChange={(e) => setSnapSettings({ tolerance: Number(e.target.value) })} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input data-testid="ortho" type="checkbox" checked={interaction.gizmo.orthogonal}
            onChange={(e) => setGizmoState({ orthogonal: e.target.checked })} />
          <span className="dim" style={{ fontSize: 11 }}>Ортогонально</span>
        </label>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Дерево объектов (§7/§10/§11) */}
        <aside style={{ width: 240, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 10 }}>
          <h3 style={hdr}>Объекты</h3>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <button data-testid="select-all" onClick={() => runCommand('select.all')}>Все</button>
            <button data-testid="select-none" onClick={() => runCommand('select.none')}>Снять</button>
            <button data-testid="select-parent" onClick={() => runCommand('select.parent')}>↑ Родитель</button>
          </div>
          {parts.map((part) => {
            const id = String(part.id);
            const link = linkIndicator(part);
            return (
              <div
                key={id}
                data-testid="object-row"
                onMouseEnter={() => hoverEntity(id)}
                onMouseLeave={() => hoverEntity(null)}
                onClick={(e) => selectEntity(id, { additive: e.ctrlKey || e.metaKey })}
                style={{
                  padding: '2px 4px', borderRadius: 3, cursor: 'pointer', fontSize: 12,
                  background: selection.ids.includes(id) ? 'var(--accent-dim)'
                    : selection.hovered === id ? 'rgba(255,255,255,0.06)' : 'transparent',
                  opacity: hidden.includes(id) ? 0.45 : 1,
                }}
              >
                {part.name}
                <span className="dim" style={{ fontSize: 10, marginLeft: 4 }}>{link.label}</span>
              </div>
            );
          })}
          {isolated.length > 0 && (
            <button style={{ marginTop: 6 }} onClick={() => editorIsolate([])}>Показать всё</button>
          )}
        </aside>

        {/* Свойства, размеры, перетаскивание (§44–§53, §77–§80, §99–§103) */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 12 }}>
          {!active && <p className="dim">Выберите деталь в дереве или в 3D-сцене.</p>}

          {active && (
            <>
              <h3 style={hdr}>Свойства детали</h3>
              <div style={{ marginBottom: 8 }}>
                <strong data-testid="active-name">{active.name}</strong>
                <span className="dim"> · {active.role}</span>
                <span style={badge} data-testid="link-state">{linkIndicator(active).label}</span>
              </div>

              {/* Прямое редактирование размеров (§44–§50) */}
              <section style={section}>
                <span className="dim">Размеры</span>
                {dimensions.map((d) => (
                  <div key={d.id} style={row}>
                    <span className="dim">
                      {d.label}
                      {d.computed && d.field && <em style={badge}>fx</em>}
                      {d.overridden && <em style={{ ...badge, color: '#e6c060' }}>Override</em>}
                    </span>
                    {edit?.dimensionId === d.id ? (
                      <span style={{ display: 'flex', gap: 4 }}>
                        <input
                          data-testid="dimension-input"
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitDimension();
                            if (e.key === 'Escape') { setEdit(null); note('Изменение отменено'); }
                          }}
                          style={{ width: 80 }}
                        />
                        <button data-testid="dimension-apply" onClick={commitDimension}>OK</button>
                      </span>
                    ) : (
                      <button
                        data-testid={`dimension-${d.kind}`}
                        onClick={() => {
                          if (!d.field) { note('Справочный размер не редактируется.'); return; }
                          const next = beginDimensionEdit(d);
                          setEdit(next);
                          setDraft(next.draft);
                        }}
                      >
                        {formatMm(d.value)}
                      </button>
                    )}
                  </div>
                ))}
                {edit && (
                  <div className="dim" style={{ fontSize: 11 }} data-testid="dimension-preview">
                    Предпросмотр: {formatMm(edit.original)} → {formatMm(previewDimension(edit, draft).after)}
                    {!previewDimension(edit, draft).ok && ` · ${previewDimension(edit, draft).message}`}
                  </div>
                )}
              </section>

              {/* Числовое перемещение и поворот (§77–§80) */}
              <section style={section}>
                <span className="dim">Transform</span>
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <div key={axis} style={row}>
                    <span className="dim">{axis.toUpperCase()}</span>
                    <input
                      data-testid={`transform-${axis}`}
                      type="number"
                      style={{ width: 90 }}
                      defaultValue={Math.round(active.position[axis])}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (!Number.isFinite(value)) return;
                        beginTx('move', 'Числовое перемещение');
                        updatePart(active.id as PartId, { position: { ...active.position, [axis]: value } });
                        endTx();
                        note(`${axis.toUpperCase()} = ${value}`);
                      }}
                    />
                  </div>
                ))}
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <div key={`r${axis}`} style={row}>
                    <span className="dim">Поворот {axis.toUpperCase()}</span>
                    <input
                      data-testid={`rotation-${axis}`}
                      type="number"
                      style={{ width: 90 }}
                      defaultValue={Math.round(active.rotation[axis])}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (!Number.isFinite(value)) return;
                        beginTx('rotate', 'Числовой поворот');
                        updatePart(active.id as PartId, { rotation: { ...active.rotation, [axis]: value } });
                        endTx();
                        note(`Поворот ${axis.toUpperCase()} = ${value}°`);
                      }}
                    />
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <button data-testid="lock-position"
                    onClick={() => { setPartLock(active.id as PartId, { position: true }); note('Положение заблокировано'); }}>
                    Lock Position
                  </button>
                  <button data-testid="lock-size"
                    onClick={() => { setPartLock(active.id as PartId, { size: true }); note('Размер заблокирован'); }}>
                    Lock Size
                  </button>
                  <button data-testid="reset-override"
                    onClick={() => runCommand('transform.resetOverride')}>
                    Вернуть расчёт
                  </button>
                </div>
              </section>

              {/* Перетаскивание конструктивного элемента (§25–§32) */}
              <section style={section}>
                <span className="dim">Перетаскивание</span>
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                  <button data-testid="drag-up" onClick={() => dragActive(active.position.y + 100)}>
                    Сдвинуть +100
                  </button>
                  <button data-testid="drag-down" onClick={() => dragActive(active.position.y - 100)}>
                    Сдвинуть −100
                  </button>
                </div>
                {snapInfo && (
                  <div className="dim" style={{ fontSize: 11, marginTop: 4 }} data-testid="snap-preview">
                    Привязка: {snapInfo.description}
                  </div>
                )}
              </section>

              {/* Предпросмотр зависимостей (§138–§140) */}
              <section style={section}>
                <span className="dim">Зависимости</span>
                <div className="dim" style={{ fontSize: 11 }} data-testid="dependency-preview">
                  {dependencyPreview(project, 'width').description}
                </div>
                <div className="dim" style={{ fontSize: 11 }} data-testid="change-preview">
                  {changePreview(project, 'width').summary}
                </div>
              </section>
            </>
          )}

          {/* Измерение (§54–§57) */}
          <section style={section}>
            <span className="dim">Измерение</span>
            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              <button data-testid="measure-part" disabled={!active} onClick={() => {
                if (active) note(measurePart(active).label);
              }}>Габариты детали</button>
              <button data-testid="measure-distance" disabled={selected.length < 2} onClick={() => {
                if (selected.length >= 2) note(measureDistance(selected[0], selected[1]).label);
              }}>Расстояние между деталями</button>
              <button data-testid="measure-points" onClick={() => {
                const first = measureAt({ x: 0, y: 0, z: 0 });
                const second = measureAt({ x: 0, y: 1000, z: 0 });
                note(second.result ? `Замер: ${second.result.label}` : 'Задайте вторую точку');
                void first;
              }}>Замер двух точек</button>
            </div>
          </section>

          {/* Направляющие (§58–§64) */}
          <section style={section}>
            <span className="dim">Направляющие</span>
            <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
              <select data-testid="guide-axis" value={guideAxis} onChange={(e) => setGuideAxis(e.target.value as 'x' | 'y' | 'z')}>
                <option value="x">X</option>
                <option value="y">Y</option>
                <option value="z">Z</option>
              </select>
              <input data-testid="guide-position" type="number" style={{ width: 80 }} value={guideValue}
                onChange={(e) => setGuideValue(e.target.value)} />
              <button data-testid="guide-add" onClick={() => {
                addGuide(guideAxis, Number(guideValue) || 0);
                note(`Направляющая ${guideAxis} = ${guideValue}`);
              }}>Добавить</button>
              <button data-testid="guide-center" onClick={() => {
                const value = bounds ? bounds.center[guideAxis] : 0;
                addGuide(guideAxis, value, 'center');
                note(`Направляющая по центру: ${Math.round(value)}`);
              }}>Center</button>
            </div>
            {interaction.guides.map((g) => (
              <div key={g.id} style={row} data-testid="guide-row">
                <span className="dim">{g.axis.toUpperCase()} = {Math.round(g.position)} мм</span>
                <span style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => moveGuide(g.id, g.position + 10)}>+10</button>
                  <button onClick={() => removeGuide(g.id)}>×</button>
                </span>
              </div>
            ))}
          </section>

          {/* Ошибки и предупреждения у объектов (§135/§136) */}
          {issues.length > 0 && (
            <section style={section} data-testid="object-issues">
              <span className="dim">Замечания конструкции</span>
              {issues.slice(0, 8).map((issue, i) => (
                <div key={i} className={`issue ${issue.severity === 'error' ? 'error' : 'warning'}`}>
                  {issue.partName}: {issue.message}
                </div>
              ))}
            </section>
          )}

          <section style={section}>
            <span className="dim">История действий</span>
            {messages.length === 0 && <div className="dim" style={{ fontSize: 11 }}>Пока пусто.</div>}
            {messages.map((m, i) => <div key={i} className="dim" style={{ fontSize: 11 }}>{m}</div>)}
          </section>
        </div>

        {/* Команды (§119/§130) */}
        <aside style={{ width: 210, borderLeft: '1px solid var(--border)', overflow: 'auto', padding: 10 }}>
          <h3 style={hdr}>Команды</h3>
          {COMMANDS.filter((c) => c.category !== 'view').map((c) => (
            <button
              key={c.id}
              data-testid={`command-${c.id}`}
              disabled={!isCommandEnabled(c.id, selection.ids.length)}
              onClick={() => runCommand(c.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 11, marginBottom: 2 }}
            >
              {c.label}{c.shortcut ? ` · ${c.shortcut}` : ''}
            </button>
          ))}
          <h3 style={{ ...hdr, marginTop: 10 }}>Выравнивание</h3>
          {ALIGN_MODES.map(([mode, label]) => (
            <button key={mode} style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 11, marginBottom: 2 }}
              onClick={() => alignSelected(mode)}>
              {label}
            </button>
          ))}
        </aside>
      </div>

      {/* Строка состояния (§131) */}
      <div style={statusBar} data-testid="status-bar">
        <span>Инструмент: {status.tool}</span>
        <span>Выбор: {status.selection}</span>
        <span>{status.snap}</span>
        <span>
          Курсор: {status.cursor
            ? `${Math.round(status.cursor.x)}, ${Math.round(status.cursor.y)}, ${Math.round(status.cursor.z)}`
            : '—'} {status.units}
        </span>
      </div>

      {/* Контекстное меню (§128/§129) */}
      {menu && (
        <div
          data-testid="context-menu"
          style={{
            position: 'fixed', left: menu.x, top: menu.y, zIndex: 50,
            background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 4,
          }}
          onMouseLeave={() => setMenu(null)}
        >
          {menu.items.map((item) => (
            <button
              key={item.commandId}
              style={{
                display: 'block', width: '100%', textAlign: 'left', fontSize: 11,
                borderTop: item.separatorBefore ? '1px solid var(--border)' : undefined,
              }}
              onClick={() => runCommand(item.commandId)}
            >
              {item.label}{item.shortcut ? ` · ${item.shortcut}` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const hdr: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-dim)', margin: '0 0 8px',
};
const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8,
};
const section: React.CSSProperties = {
  paddingTop: 8, marginTop: 8, borderTop: '1px solid var(--border)',
};
const badge: React.CSSProperties = {
  marginLeft: 6, padding: '0 4px', fontSize: 10, fontStyle: 'normal',
  border: '1px solid var(--border)', borderRadius: 3,
};
const toolbar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', flexWrap: 'wrap',
  borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)',
};
const statusBar: React.CSSProperties = {
  display: 'flex', gap: 16, padding: '4px 8px', fontSize: 11,
  borderTop: '1px solid var(--border)', background: 'var(--bg-panel)', color: 'var(--text-dim)',
};
