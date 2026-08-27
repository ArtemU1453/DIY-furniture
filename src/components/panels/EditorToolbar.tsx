import { useEffect } from 'react';
import { useEditorStore, type DisplayMode, type MachiningMode } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { partsToStl, partsToObj, VIEW_HOTKEYS, type StandardView } from '@/engines/viewer';
import type { PartId } from '@/core/model/ids';

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

const MODES: Array<[DisplayMode, string]> = [
  ['solid', 'Заливка'],
  ['wireframe', 'Каркас'],
  ['edges', 'Рёбра'],
  ['transparent', 'Прозрачно'],
];
const SNAPS = [1, 5, 10];

/** Панель инструментов 3D-редактора + горячие клавиши. */
export function EditorToolbar({
  onSetView,
  onFit,
  onCapture,
}: {
  onSetView: (v: StandardView) => void;
  onFit: () => void;
  onCapture: () => void;
}) {
  const project = useEditorStore((s) => s.project);
  const viewer = useEditorStore((s) => s.viewer);
  const setViewer = useEditorStore((s) => s.setViewer);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectPart = useEditorStore((s) => s.selectPart);
  const addElement = useEditorStore((s) => s.addElement);
  const duplicatePart = useEditorStore((s) => s.duplicatePart);
  const removePart = useEditorStore((s) => s.removePart);
  const setPartFlag = useEditorStore((s) => s.setPartFlag);
  const showAllParts = useEditorStore((s) => s.showAllParts);
  const isolatePart = useEditorStore((s) => s.isolatePart);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const deleteSelected = () => {
    if (!selectedPartId) return;
    const part = findPart(project, selectedPartId);
    if (!part) return;
    // Удаление меняет производственную модель — подтверждаем (§43).
    if (!window.confirm(`Удалить деталь «${part.name}»? Раскрой и документы станут неактуальными.`)) return;
    removePart(selectedPartId);
  };

  // Горячие клавиши. Не перехватываем ввод в полях (§57).
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const k = e.key;
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedPartId) { const id = duplicatePart(selectedPartId); if (id) selectPart(id); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey) return;
      if (k === 'Delete') { e.preventDefault(); deleteSelected(); return; }
      if (k === 'Escape') { isolatePart(null); selectPart(null); return; }
      if (k.toLowerCase() === 'f') { onFit(); return; }
      const view = VIEW_HOTKEYS[k];
      if (view) onSetView(view);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const parts = allParts(project);
  const isolated = viewer.isolatedPartId !== null;

  return (
    <div className="editor-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', fontSize: 12 }}>
      <button className={viewer.tool === 'select' ? 'active' : ''} onClick={() => setViewer({ tool: 'select' })}>Выбрать</button>
      <button className={viewer.tool === 'move' ? 'active' : ''} onClick={() => setViewer({ tool: 'move' })}>Переместить</button>
      <span className="sep" />
      <button onClick={() => { const id = addElement('panel'); selectPart(id); }}>Добавить</button>
      <button disabled={!selectedPartId} onClick={() => { if (selectedPartId) { const id = duplicatePart(selectedPartId); if (id) selectPart(id); } }}>Дублировать</button>
      <button disabled={!selectedPartId} onClick={deleteSelected} style={{ color: 'var(--danger)' }}>Удалить</button>
      <span className="sep" />
      <button disabled={!selectedPartId} onClick={() => selectedPartId && setPartFlag(selectedPartId as PartId, { hidden: true })}>Скрыть</button>
      <button disabled={!selectedPartId} onClick={() => isolatePart(isolated ? null : selectedPartId)} className={isolated ? 'active' : ''}>Изолировать</button>
      <button onClick={() => { showAllParts(); isolatePart(null); }}>Показать всё</button>
      <span className="sep" />
      <button onClick={onFit}>Показать всё (камера)</button>
      <label style={lbl}>Вид
        <select style={{ width: 'auto' }} value={viewer.displayMode} onChange={(e) => setViewer({ displayMode: e.target.value as DisplayMode })}>
          {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label style={lbl}>Шаг
        <select style={{ width: 'auto' }} value={viewer.snap} onChange={(e) => setViewer({ snap: Number(e.target.value) })}>
          {SNAPS.map((s) => <option key={s} value={s}>{s} мм</option>)}
        </select>
      </label>
      <label style={chk}><input type="checkbox" checked={viewer.showGrid} onChange={(e) => setViewer({ showGrid: e.target.checked })} />Сетка</label>
      <label style={chk}><input type="checkbox" checked={viewer.showAxes} onChange={(e) => setViewer({ showAxes: e.target.checked })} />Оси</label>
      <label style={chk}><input type="checkbox" checked={viewer.showDimensions} onChange={(e) => setViewer({ showDimensions: e.target.checked })} />Габариты</label>
      <label style={chk}><input type="checkbox" checked={viewer.showHardware} onChange={(e) => setViewer({ showHardware: e.target.checked })} />Фурнитура</label>
      <label style={lbl}>Присадка
        <select style={{ width: 'auto' }} value={viewer.machiningMode} onChange={(e) => setViewer({ machiningMode: e.target.value as MachiningMode })}>
          <option value="off">Выкл.</option>
          <option value="all">Все детали</option>
          <option value="selected">Только выбранная</option>
        </select>
      </label>
      <span style={{ marginLeft: 'auto' }} />
      <button onClick={() => download('model.stl', partsToStl(parts, project.name), 'model/stl')}>STL</button>
      <button onClick={() => download('model.obj', partsToObj(parts, project.name), 'model/obj')}>OBJ</button>
      <button onClick={onCapture}>PNG</button>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', width: 'auto', color: 'var(--text-dim)' };
const chk: React.CSSProperties = { display: 'flex', gap: 3, alignItems: 'center', width: 'auto', color: 'var(--text-dim)' };
