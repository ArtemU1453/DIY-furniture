/**
 * 3D-редактор мебели (§37–§40, §47–§55, §69–§94, §130–§141).
 *
 * Панель показывает FurnitureScene: дерево, свойства выбранного узла, слои,
 * камеру, сечение, разнос, измерение и проверку коллизий. Сцена собирается из
 * ProjectModel, а изменения идут обратно через действия store — собственных
 * данных о мебели здесь нет.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { Scene3D } from '@/features/designer/Scene3D';
import {
  SCENE_VIEWS,
  SCENE_VIEW_LABELS,
  VIEW_CUBE_FACES,
  VIEW_HOTKEY,
  autoDimensions,
  buildFurnitureScene,
  collisionSummary,
  debugInfo,
  filterTree,
  materialPreview,
  navigationCommands,
  partNumbers,
  sceneBounds,
  sceneCollisions,
  sceneTree,
  viewOfCubeFace,
  type SceneView,
} from '@/engines/scene';
import { allParts } from '@/core/model/selectors';

const isTextInput = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
};

export function Viewer3D({
  onOpenPart,
  onOpenCutting,
  onOpenProduction,
  onOpenBom,
}: {
  onOpenPart?: (partId: string) => void;
  onOpenCutting?: () => void;
  onOpenProduction?: () => void;
  onOpenBom?: () => void;
}) {
  const project = useEditorStore((s) => s.project);
  const scene3d = useEditorStore((s) => s.scene);
  const selectNode = useEditorStore((s) => s.selectSceneNode);
  const clearSelection = useEditorStore((s) => s.clearSceneSelection);
  const setVisibility = useEditorStore((s) => s.setSceneVisibility);
  const hideNode = useEditorStore((s) => s.hideSceneNode);
  const hideOthers = useEditorStore((s) => s.hideOtherSceneNodes);
  const isolateNode = useEditorStore((s) => s.isolateSceneNode);
  const showAll = useEditorStore((s) => s.showAllSceneNodes);
  const setView = useEditorStore((s) => s.setSceneView);
  const fitModel = useEditorStore((s) => s.fitSceneModel);
  const homeView = useEditorStore((s) => s.sceneHomeView);
  const setSection = useEditorStore((s) => s.setSceneSection);
  const setExplode = useEditorStore((s) => s.setSceneExplode);
  const addMeasurePoint = useEditorStore((s) => s.addSceneMeasurePoint);
  const clearMeasures = useEditorStore((s) => s.clearSceneMeasures);
  const toggleMeasure = useEditorStore((s) => s.toggleSceneMeasure);
  const moveNode = useEditorStore((s) => s.moveSceneNode);
  const rotateNode = useEditorStore((s) => s.rotateSceneNode);
  const setSceneState = useEditorStore((s) => s.setSceneState);
  const updatePart = useEditorStore((s) => s.updatePart);
  const removePart = useEditorStore((s) => s.removePart);
  const undo = useEditorStore((s) => s.undo);

  const [messages, setMessages] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const captureRef = useRef<{ capture: () => string } | null>(null);
  const note = (text: string) => setMessages((m) => [text, ...m].slice(0, 20));

  /* Сцена — производная от модели: пересобирается, когда меняется проект или
   * запрошена принудительная пересборка (§42/§129). */
  const scene = useMemo(
    () => buildFurnitureScene(project, { includeMachining: scene3d.visibility.showMachining }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, scene3d.visibility.showMachining, scene3d.revision],
  );

  const parts = useMemo(() => allParts(project), [project]);
  const numbers = useMemo(() => partNumbers(parts), [parts]);
  const tree = useMemo(() => sceneTree(scene), [scene]);
  const visibleTree = useMemo(
    () => filterTree(scene, tree, { ...scene3d.treeFilter, query }, numbers),
    [scene, tree, scene3d.treeFilter, query, numbers],
  );
  const collisions = useMemo(() => sceneCollisions(scene, project), [scene, project]);
  const summary = collisionSummary(collisions);
  const bounds = useMemo(() => sceneBounds(scene, scene3d.visibility), [scene, scene3d.visibility]);

  const activeId = scene3d.selection.activeId;
  const activeNode = activeId ? scene.nodes[activeId] : undefined;
  const activePart = activeNode?.kind === 'PART' && activeNode.refId
    ? parts.find((p) => String(p.id) === activeNode.refId)
    : undefined;
  const dimensions = useMemo(
    () => autoDimensions(scene, scene3d.selection.ids),
    [scene, scene3d.selection.ids],
  );
  const debug = activeId ? debugInfo(scene, activeId, scene3d.space) : null;
  const commands = useMemo(
    () => navigationCommands(scene, scene3d.selection, project),
    [scene, scene3d.selection, project],
  );
  const materials = useMemo(() => materialPreview(project, parts), [project, parts]);

  // Горячие клавиши (§139/§140).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextInput(e.target)) return;
      const key = e.key.toLowerCase();
      if (VIEW_HOTKEY[e.key]) { setView(VIEW_HOTKEY[e.key]); return; }
      if (key === 'f') { fitModel(); return; }
      if (key === 'g') { setSceneState({ mode: 'MOVE' }); return; }
      if (key === 'r') { setSceneState({ mode: 'ROTATE' }); return; }
      if (e.key === 'Escape') { clearSelection(); setSceneState({ mode: 'SELECT' }); return; }
      if (e.key === 'Delete' && activePart) {
        removePart(activePart.id);
        note(`Деталь «${activePart.name}» удалена.`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setView, fitModel, setSceneState, clearSelection, removePart, activePart]);

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }} data-testid="viewer-3d">
      {/* Дерево сцены (§82–§87) */}
      <aside style={{ width: 250, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 12 }}>
        <h3 style={hdr}>Дерево сцены</h3>
        <input
          data-testid="scene-search"
          placeholder="Поиск: имя, ID, номер"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: '100%', marginBottom: 6 }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, fontSize: 11 }}>
          {([['parts', 'Детали'], ['hardware', 'Фурнитура'], ['machining', 'Присадка']] as const).map(([key, label]) => (
            <label key={key} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              <input
                type="checkbox"
                data-testid={`tree-filter-${key}`}
                checked={scene3d.treeFilter[key] === true}
                onChange={(e) => setSceneState({
                  treeFilter: { ...scene3d.treeFilter, [key]: e.target.checked },
                })}
              />
              {label}
            </label>
          ))}
        </div>
        <div data-testid="scene-tree">
          {visibleTree.map((item) => (
            <div
              key={item.nodeId}
              data-testid="scene-tree-item"
              onClick={(e) => selectNode(item.nodeId, e.ctrlKey || e.metaKey)}
              style={{
                paddingLeft: item.depth * 10,
                fontSize: 11,
                cursor: 'pointer',
                background: scene3d.selection.ids.includes(item.nodeId) ? 'var(--accent-dim)' : undefined,
                opacity: scene3d.visibility.hidden.includes(item.nodeId) ? 0.5 : 1,
              }}
            >
              {item.label}
              <span className="dim"> · {item.kind.toLowerCase()}</span>
            </div>
          ))}
        </div>
        <div className="dim" style={{ fontSize: 10, marginTop: 6 }} data-testid="scene-stats">
          корпусов: {scene.stats.cabinets} · модулей: {scene.stats.modules} ·
          {' '}деталей: {scene.stats.parts} · фурнитуры: {scene.stats.hardware} ·
          {' '}присадки: {scene.stats.machining}
        </div>
      </aside>

      {/* Сцена и инструменты (§47–§76) */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', gap: 4, padding: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
          {SCENE_VIEWS.map((v) => (
            <button
              key={v}
              data-testid={`view-${v}`}
              className={scene3d.camera.view === v ? 'active' : ''}
              onClick={() => setView(v)}
            >{SCENE_VIEW_LABELS[v]}</button>
          ))}
          <button data-testid="view-fit" onClick={() => { fitModel(); note('Модель вписана в кадр.'); }}>Вписать</button>
          <button data-testid="view-home" onClick={() => homeView()}>Домой</button>
          <span className="sep" style={{ margin: '0 4px' }} />
          {([['SELECT', 'Выбор'], ['MOVE', 'Перемещение'], ['ROTATE', 'Поворот']] as const).map(([mode, label]) => (
            <button
              key={mode}
              data-testid={`mode-${mode}`}
              className={scene3d.mode === mode ? 'active' : ''}
              onClick={() => setSceneState({ mode })}
            >{label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '6px 8px', flexWrap: 'wrap', fontSize: 11, borderBottom: '1px solid var(--border)' }}>
          {([
            ['showEdgeBand', 'Кромка'], ['showGrain', 'Текстура'], ['showHardware', 'Фурнитура'],
            ['showMachining', 'Присадка'], ['showDimensions', 'Размеры'], ['showHelpers', 'Помощники'],
            ['showGrid', 'Сетка'], ['showAxes', 'Оси'],
          ] as const).map(([key, label]) => (
            <label key={key} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              <input
                type="checkbox"
                data-testid={`layer-${key}`}
                checked={scene3d.visibility[key]}
                onChange={(e) => setVisibility({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, position: 'relative' }} data-testid="scene-canvas">
          <Scene3D captureRef={captureRef} />
          {/* View Cube (§50/§51) */}
          <div
            data-testid="view-cube"
            /* Правый нижний угол и слой поверх встроенной панели вида: иначе
             * куб перекрывается тулбаром сцены и по нему нельзя попасть. */
            style={{
              position: 'absolute', right: 8, bottom: 8, display: 'grid',
              gridTemplateColumns: 'repeat(2, 44px)', gap: 2, opacity: 0.95, zIndex: 10,
            }}
          >
            {VIEW_CUBE_FACES.map((face) => (
              <button
                key={face.face}
                data-testid={`cube-${face.face}`}
                style={{ fontSize: 10 }}
                onClick={() => {
                  const view = viewOfCubeFace(face.face);
                  if (view) setView(view as SceneView);
                }}
              >{face.label}</button>
            ))}
          </div>
        </div>

        {/* Сечение, разнос, измерение (§69–§94) */}
        <div style={{ display: 'flex', gap: 10, padding: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border)', fontSize: 11 }}>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="checkbox"
              data-testid="section-enabled"
              checked={scene3d.section.enabled}
              onChange={(e) => setSection({ enabled: e.target.checked })}
            />
            Сечение
          </label>
          <select
            data-testid="section-axis"
            value={scene3d.section.axis}
            onChange={(e) => setSection({ axis: e.target.value as 'X' | 'Y' | 'Z' })}
          >
            <option value="X">X</option><option value="Y">Y</option><option value="Z">Z</option>
          </select>
          <input
            data-testid="section-position"
            type="number"
            style={{ width: 80 }}
            value={scene3d.section.position}
            onChange={(e) => setSection({ position: Number(e.target.value) || 0 })}
          />

          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="checkbox"
              data-testid="explode-enabled"
              checked={scene3d.explode.enabled}
              onChange={(e) => setExplode({ enabled: e.target.checked })}
            />
            Разнос
          </label>
          <input
            data-testid="explode-factor"
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={scene3d.explode.factor}
            onChange={(e) => setExplode({ factor: Number(e.target.value) })}
          />
          <button data-testid="explode-reset" onClick={() => setExplode({ enabled: false, factor: 0.5 })}>
            Сбросить разнос
          </button>

          <button
            data-testid="measure-toggle"
            className={scene3d.measure.active ? 'active' : ''}
            onClick={() => toggleMeasure()}
          >Измерение</button>
          <button data-testid="measure-point" onClick={() => {
            const node = activeNode ?? scene.nodes[scene.rootId];
            addMeasurePoint({
              x: node.world.position.x, y: node.world.position.y, z: node.world.position.z, nodeId: node.id,
            });
          }}>Точка</button>
          <button data-testid="measure-clear" onClick={() => clearMeasures()}>Очистить</button>
          <span className="dim" data-testid="measure-results">
            {scene3d.measure.results.map((r) => `${r.distance} мм (ΔX ${r.dx}, ΔY ${r.dy}, ΔZ ${r.dz})`).join('; ')}
          </span>
        </div>
      </div>

      {/* Свойства, проверки, переходы (§37–§46, §95–§100, §159) */}
      <aside style={{ width: 300, borderLeft: '1px solid var(--border)', overflow: 'auto', padding: 12 }}>
        <h3 style={hdr}>Свойства</h3>
        {activeNode ? (
          <div data-testid="scene-properties">
            <div style={row}><span className="dim">Объект</span><span>{activeNode.label}</span></div>
            <div style={row}><span className="dim">Тип</span><span>{activeNode.kind}</span></div>
            {activePart && (
              <>
                <div style={row}>
                  <span className="dim">Ширина</span>
                  <input
                    data-testid="prop-width"
                    type="number"
                    style={{ width: 90 }}
                    value={activePart.width}
                    onChange={(e) => {
                      const width = Number(e.target.value);
                      if (Number.isFinite(width) && width > 0) updatePart(activePart.id, { width });
                    }}
                  />
                </div>
                <div style={row}>
                  <span className="dim">Высота</span>
                  <input
                    data-testid="prop-height"
                    type="number"
                    style={{ width: 90 }}
                    value={activePart.height}
                    onChange={(e) => {
                      const height = Number(e.target.value);
                      if (Number.isFinite(height) && height > 0) updatePart(activePart.id, { height });
                    }}
                  />
                </div>
                <div style={row}><span className="dim">Толщина</span><span>{activePart.thickness}</span></div>
                <div style={row}>
                  <span className="dim">Материал</span>
                  <select
                    data-testid="prop-material"
                    value={String(activePart.material ?? '')}
                    onChange={(e) => updatePart(activePart.id, {
                      material: (e.target.value || null) as never,
                    })}
                  >
                    <option value="">—</option>
                    {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div style={row}><span className="dim">Текстура</span><span>{activePart.grain}</span></div>
                <div style={row}>
                  <span className="dim">Кромка</span>
                  <span>{(activeNode.edges ?? []).map((e) => e.side).join(', ') || '—'}</span>
                </div>
              </>
            )}
            {activeNode.kind === 'HARDWARE' && activeNode.hardware && (
              <>
                <div style={row}><span className="dim">Вид</span><span>{activeNode.hardware.kind}</span></div>
                <div style={row}><span className="dim">Заглушка</span><span>{activeNode.hardware.placeholder}</span></div>
                <div style={row}><span className="dim">Модель</span><span>{activeNode.hardware.modelPath ?? 'нет'}</span></div>
              </>
            )}
            {activeNode.kind === 'MACHINING' && activeNode.machining && (
              <>
                <div style={row}><span className="dim">Операция</span><span>{activeNode.machining.type}</span></div>
                <div style={row}><span className="dim">Грань</span><span>{activeNode.machining.face}</span></div>
                <div style={row}><span className="dim">X / Y</span><span>{activeNode.machining.x} / {activeNode.machining.y}</span></div>
                <div style={row}><span className="dim">Ø / глубина</span><span>{activeNode.machining.diameter} / {activeNode.machining.depth}</span></div>
              </>
            )}

            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
              <button data-testid="node-hide" onClick={() => hideNode(activeNode.id)}>Скрыть</button>
              <button data-testid="node-hide-others" onClick={() => hideOthers([activeNode.id])}>Скрыть прочие</button>
              <button data-testid="node-isolate" onClick={() => isolateNode(activeNode.id)}>Изолировать</button>
              <button data-testid="node-show-all" onClick={() => showAll()}>Показать всё</button>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              <button data-testid="node-move" onClick={() => {
                const result = moveNode(activeNode.id, { x: scene3d.snap.step, y: 0, z: 0 });
                note(result.ok ? 'Деталь перемещена.' : `Перемещение отклонено: ${result.issues.join(' ')}`);
              }}>Сдвинуть X+</button>
              <button data-testid="node-rotate" onClick={() => {
                const result = rotateNode(activeNode.id, 'y', 90);
                note(result.ok ? 'Деталь повёрнута.' : `Поворот отклонён: ${result.issues.join(' ')}`);
              }}>Повернуть Y 90°</button>
              <button data-testid="node-undo" onClick={() => undo()}>Отменить</button>
            </div>
          </div>
        ) : <span className="dim" style={{ fontSize: 11 }}>Ничего не выбрано.</span>}

        <h3 style={{ ...hdr, marginTop: 12 }}>Размеры</h3>
        <div data-testid="scene-dimensions" className="dim" style={{ fontSize: 11 }}>
          {dimensions.map((d) => (
            <div key={d.nodeId}>{d.label}: {d.width} × {d.height} × {d.depth} мм</div>
          ))}
          {dimensions.length === 0 && <div>Габарит модели: {Math.round(bounds.size.x)} × {Math.round(bounds.size.y)} × {Math.round(bounds.size.z)} мм</div>}
        </div>

        <h3 style={{ ...hdr, marginTop: 12 }}>Проверка</h3>
        <div data-testid="scene-collisions" style={{ fontSize: 11 }}>
          <div className="dim">ошибок: {summary.errors} · предупреждений: {summary.warnings}</div>
          {collisions.slice(0, 8).map((c, i) => (
            <div
              key={i}
              data-testid="collision-item"
              style={{ cursor: 'pointer', color: c.severity === 'error' ? 'var(--danger, #a33)' : 'var(--warn, #a70)' }}
              onClick={() => { if (c.nodeIds[0]) selectNode(c.nodeIds[0]); }}
            >{c.message}</div>
          ))}
        </div>

        <h3 style={{ ...hdr, marginTop: 12 }}>Переходы</h3>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} data-testid="scene-navigation">
          {commands.map((c) => (
            <button
              key={c.target}
              data-testid={`nav-${c.target}`}
              disabled={c.disabledReason !== undefined}
              title={c.disabledReason}
              onClick={() => {
                if (c.target === 'VIEW_2D' && c.partId) onOpenPart?.(c.partId);
                else if (c.target === 'CUTTING') onOpenCutting?.();
                else if (c.target === 'PRODUCTION') onOpenProduction?.();
                else if (c.target === 'BOM') onOpenBom?.();
                else if (c.partId) onOpenPart?.(c.partId);
              }}
            >{c.label}</button>
          ))}
        </div>

        <h3 style={{ ...hdr, marginTop: 12 }}>Отладка</h3>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, marginBottom: 4 }}>
          <label style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <input
              type="checkbox"
              data-testid="debug-toggle"
              checked={scene3d.debug}
              onChange={(e) => setSceneState({ debug: e.target.checked })}
            />
            3D Debug
          </label>
          <select
            data-testid="debug-space"
            value={scene3d.space}
            onChange={(e) => setSceneState({ space: e.target.value as 'LOCAL' | 'WORLD' })}
          >
            <option value="WORLD">World</option>
            <option value="LOCAL">Local</option>
          </select>
          <button data-testid="scene-screenshot" onClick={() => {
            const data = captureRef.current?.capture();
            note(data ? `Снимок: ${Math.round(data.length / 1024)} КБ` : 'Снимок недоступен.');
          }}>Снимок PNG</button>
        </div>
        {scene3d.debug && debug && (
          <div data-testid="debug-info" className="dim" style={{ fontSize: 10 }}>
            <div>Node: {debug.nodeId}</div>
            <div>Ref: {debug.refId ?? '—'}</div>
            <div>{debug.space}: {debug.position.x}, {debug.position.y}, {debug.position.z} {debug.unit}</div>
            <div>Rot: {debug.rotation.x}°, {debug.rotation.y}°, {debug.rotation.z}°</div>
            <div>BBox: {debug.bounds.size.x} × {debug.bounds.size.y} × {debug.bounds.size.z}</div>
          </div>
        )}

        <h3 style={{ ...hdr, marginTop: 12 }}>Журнал</h3>
        <div data-testid="scene-log" className="dim" style={{ fontSize: 11 }}>
          {messages.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      </aside>
    </div>
  );
}

const hdr: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-dim)', margin: '0 0 8px',
};
const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8, fontSize: 11,
};
