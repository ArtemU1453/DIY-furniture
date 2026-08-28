import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from './store/editorStore';
import { TopBar } from '@/components/layout/TopBar';
import { LeftPanel, type NavSection } from '@/components/layout/LeftPanel';
import { RightPanel } from '@/components/layout/RightPanel';
import { StatusBar } from '@/components/layout/StatusBar';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { EmptyProject } from '@/components/panels/EmptyProject';
import { ProjectsDialog } from '@/components/panels/ProjectsDialog';
import { SettingsDialog } from '@/components/panels/SettingsDialog';
import { CreateFurnitureDialog } from '@/components/panels/CreateFurnitureDialog';
import { NewProjectDialog } from '@/components/panels/NewProjectDialog';
import { PartsTable } from '@/components/panels/PartsTable';
import { MaterialsView } from '@/components/panels/MaterialsView';
import { HardwareView } from '@/components/panels/HardwareView';
import { MachiningView } from '@/components/panels/MachiningView';
import { CuttingView } from '@/components/panels/CuttingView';
import { DocumentsView } from '@/components/panels/DocumentsView';
import { LibraryView } from '@/components/panels/LibraryView';
import { ProductionView } from '@/components/panels/ProductionView';
import { ModulesView } from '@/components/panels/ModulesView';
import { Editor2DView } from '@/components/panels/Editor2DView';
import { ConnectionsView } from '@/components/panels/ConnectionsView';
import { CabinetDesigner } from '@/components/panels/CabinetDesigner';
import { InteractiveEditor } from '@/components/panels/InteractiveEditor';
import { CuttingPrep } from '@/components/panels/CuttingPrep';
import { ProductionCenter } from '@/components/panels/ProductionCenter';
import { HardwareCatalogView } from '@/components/panels/HardwareCatalogView';
import { Viewer3D } from '@/components/panels/Viewer3D';
import { ParametricPanel } from '@/components/panels/ParametricPanel';
import { Scene3D, type CameraApi } from '@/features/designer/Scene3D';
import { ModelTree } from '@/components/panels/ModelTree';
import { PartProperties } from '@/components/panels/PartProperties';
import { EditorToolbar } from '@/components/panels/EditorToolbar';
import { overallDimensions } from '@/engines/viewer';
import { allParts } from '@/core/model/selectors';
import { View2D } from '@/features/designer/View2D';
import { createAutosaver } from '@/storage/backup/autosave';
import { loadLastProject } from '@/storage/project/projectRepository';
import { saveCurrentProject } from '@/features/project/projectActions';

type CenterView = '3d' | 'editor2d' | 'interactive' | 'cabinet' | 'cuttingPrep' | 'connections' | 'table' | 'materials' | 'hardware' | 'machining' | 'cutting' | 'documents' | 'library' | 'parametric' | 'production' | 'productionCenter' | 'modules' | 'hardwareCatalog' | 'viewer3d';
type ViewMode = '3d' | '2d' | 'split';

/** Разделы центральной области и их подписи (один список на вкладки и заголовки). */
const CENTER_VIEWS: Array<[CenterView, string]> = [
  ['3d', '3D'],
  ['editor2d', '2D-редактор'],
  ['table', 'Детали'],
  ['materials', 'Материалы'],
  ['hardware', 'Фурнитура'],
  ['connections', 'Соединения'],
  ['machining', 'Присадка'],
  ['cutting', 'Раскрой'],
  ['cuttingPrep', 'Подготовка'],
  ['interactive', 'Редактор'],
  ['cabinet', 'Шкаф'],
  ['modules', 'Модули'],
  ['parametric', 'Параметры'],
  ['production', 'Производство'],
  ['productionCenter', 'Цех'],
  ['hardwareCatalog', 'Каталог фурнитуры'],
  ['viewer3d', '3D-редактор'],
  ['documents', 'Документы'],
  ['library', 'Библиотека'],
];

const CENTER_VIEW_LABELS = Object.fromEntries(CENTER_VIEWS) as Record<CenterView, string>;

export function App() {
  const [status, setStatus] = useState('');
  const [section, setSection] = useState<NavSection>('parts');
  const [centerView, setCenterView] = useState<CenterView>('3d');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [showNumbers, setShowNumbers] = useState(false);
  const assembly = useEditorStore((s) => s.assembly);
  const setAssemblyMode = useEditorStore((s) => s.setAssemblyMode);
  const [bodyMode, setBodyMode] = useState<'construction' | 'body'>('construction');
  const [showTree, setShowTree] = useState(true);
  const captureRef = useRef<{ capture: () => string } | null>(null);
  const cameraRef = useRef<CameraApi | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const project = useEditorStore((s) => s.project);
  const selectPart = useEditorStore((s) => s.selectPart);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  /* Восстановление после перезагрузки и аварийного закрытия: автосохранение
   * пишет проект в IndexedDB, поэтому при старте мы возвращаем последний
   * сохранённый, а не начинаем с пустого. Подписка на автосохранение
   * включается только после этого, чтобы не перезаписать восстановленное. */
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadLastProject().then((saved) => {
      if (cancelled) return;
      if (saved) useEditorStore.getState().loadProject(saved);
      setRestored(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Автобэкап + индикатор статуса сохранения.
  const autosaver = useRef(createAutosaver({
    onStatus: (st) => useEditorStore.getState().setSaveState(st),
    onError: (message) => setStatus(message),
  }));
  useEffect(() => {
    if (!restored) return;
    const saver = autosaver.current;
    const unsub = useEditorStore.subscribe((state, prev) => {
      // Автосохраняем только при реальном изменении проекта.
      if (state.project !== prev.project) saver.schedule(state.project);
    });
    return () => {
      unsub();
      void saver.flush();
    };
  }, [restored]);

  /* Первое изделие должно быть видно целиком: камера стоит на фиксированном
   * расстоянии, и шкаф 2400 мм выходил за кадр (этап 36). Подгоняем вид, когда
   * сцена впервые показывает детали — ждём, пока камера будет создана. */
  const partCount = allParts(project).length;
  const fitted = useRef(false);
  useEffect(() => {
    if (partCount === 0) { fitted.current = false; return; }
    if (fitted.current || centerView !== '3d') return;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const parts = allParts(useEditorStore.getState().project);
      if (cameraRef.current && parts.length > 0) {
        cameraRef.current.fitAll(overallDimensions(parts));
        fitted.current = true;
      }
      if (fitted.current || attempts >= 10) window.clearInterval(timer);
    }, 120);
    return () => window.clearInterval(timer);
  }, [partCount, centerView]);

  // Горячие клавиши.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;
      const s = useEditorStore.getState();

      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void saveCurrentProject().then(() => s.setSaveState('saved')); setStatus('Проект сохранён'); return; }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (s.selectedPartId) { const id = s.duplicatePart(s.selectedPartId); if (id) s.selectPart(id); }
        return;
      }
      if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && s.selectedPartId) {
        e.preventDefault();
        const part = allParts(s.project).find((p) => String(p.id) === String(s.selectedPartId));
        s.removePart(s.selectedPartId);
        // Безопасное удаление: видно, ЧТО удалено и как вернуть (§«undo»).
        setStatus(`Удалена деталь «${part?.name ?? '—'}». Ctrl+Z — отменить.`);
        return;
      }
      if (e.key === 'Escape') { s.selectPart(null); s.selectOperation(null); s.selectConnection(null); s.selectCuttingPiece(null); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  return (
    <div className="editor">
      <TopBar
        onOpenProjects={() => setProjectsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onNewProject={() => setNewProjectOpen(true)}
        setStatus={setStatus}
      />
      <LeftPanel
        section={section}
        onSection={(s) => {
          setSection(s);
          if (s === 'parts') setCenterView('table');
          else if (s === 'materials') setCenterView('materials');
          else if (s === 'hardware') setCenterView('hardware');
          else if (s === 'cutting') setCenterView('cutting');
          else if (s === 'drawings' || s === 'documents') setCenterView('documents');
          else if (s === 'furniture' || s === 'project') setCenterView('3d');
        }}
        onCreateFurniture={() => setCreateOpen(true)}
      />
      <div className="center-area">
        <div className="center-tabs">
          {CENTER_VIEWS.map(([v, label]) => (
            <button key={v} className={centerView === v ? 'active' : ''} onClick={() => setCenterView(v)}>
              {label}
            </button>
          ))}
          {centerView === '3d' && (
            <>
              <span className="sep" style={{ margin: '0 6px' }} />
              {(['3d', '2d', 'split'] as ViewMode[]).map((m) => (
                <button key={m} className={viewMode === m ? 'active' : ''} onClick={() => setViewMode(m)}>
                  {m === '3d' ? '3D' : m === '2d' ? '2D' : '2D | 3D'}
                </button>
              ))}
              <label className="num-toggle">
                <input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} />
                № деталей
              </label>
              <label className="num-toggle" style={{ marginLeft: 12 }}>
                <input type="checkbox" checked={showTree} onChange={(e) => setShowTree(e.target.checked)} />
                Дерево модели
              </label>
              <span className="sep" style={{ margin: '0 6px' }} />
              {/* §146–§148: сборка и разнесённый вид — режимы просмотра. */}
              {(['ASSEMBLY', 'EXPLODED'] as const).map((m) => (
                <button key={m} data-assembly={m} className={assembly.mode === m ? 'active' : ''}
                  onClick={() => setAssemblyMode(m)}>
                  {m === 'ASSEMBLY' ? 'Сборка' : 'Разнести'}
                </button>
              ))}
              {assembly.mode === 'EXPLODED' && (
                <input
                  data-testid="explode-factor"
                  type="range" min={0} max={1} step={0.1} value={assembly.factor}
                  onChange={(e) => setAssemblyMode('EXPLODED', Number(e.target.value))}
                  style={{ width: 90, marginLeft: 6 }}
                  title="Насколько разнести детали"
                />
              )}
              <span className="sep" style={{ margin: '0 6px' }} />
              {(['construction', 'body'] as const).map((m) => (
                <button key={m} className={bodyMode === m ? 'active' : ''} onClick={() => setBodyMode(m)}>
                  {m === 'construction' ? 'Конструкция' : 'Корпус'}
                </button>
              ))}
            </>
          )}
        </div>
        {/* Сбой раздела не должен обнулять приложение: key сбрасывает границу
            при переходе в другой раздел (этап 35). */}
        <ErrorBoundary key={centerView} title={CENTER_VIEW_LABELS[centerView]}>
        <div className="center-body">
          {/* Первый экран пустого проекта: понятный следующий шаг (этап 35). */}
          {centerView === '3d' && allParts(project).length === 0 ? (
            <EmptyProject
              onCreateFurniture={() => setCreateOpen(true)}
              onOpenCabinetDesigner={() => setCenterView('cabinet')}
            />
          ) : null}
          {centerView === '3d' && allParts(project).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minHeight: 0 }}>
              <EditorToolbar
                onSetView={(v) => cameraRef.current?.setView(v)}
                onFit={() => cameraRef.current?.fitAll(overallDimensions(allParts(project)))}
                onCapture={() => {
                  const data = captureRef.current?.capture();
                  if (!data) return;
                  const a = document.createElement('a');
                  a.href = data;
                  a.download = `${project.name || 'scene'}.png`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                }}
              />
              <div style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%' }}>
                {showTree && (
                  <aside style={{ width: 210, borderRight: '1px solid var(--border)', minHeight: 0 }}>
                    <ModelTree />
                  </aside>
                )}
                {(viewMode === '2d' || viewMode === 'split') && (
                  <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--border)' }}>
                    <View2D />
                  </div>
                )}
                {(viewMode === '3d' || viewMode === 'split') && (
                  <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                    <Scene3D showNumbers={showNumbers} bodyMode={bodyMode} captureRef={captureRef} cameraRef={cameraRef} />
                  </div>
                )}
                <aside style={{ width: 230, borderLeft: '1px solid var(--border)', minHeight: 0 }}>
                  <PartProperties />
                </aside>
              </div>
            </div>
          )}
          {centerView === 'editor2d' && (
            <Editor2DView onOpenPart={(id) => { selectPart(id); setCenterView('table'); }} />
          )}
          {centerView === 'connections' && (
            <ConnectionsView onOpenPart={(id) => { selectPart(id); setCenterView('table'); }} />
          )}
          {centerView === 'table' && <PartsTable />}
          {centerView === 'materials' && <MaterialsView />}
          {centerView === 'hardware' && <HardwareView />}
          {centerView === 'machining' && <MachiningView />}
          {centerView === 'cutting' && (
            <CuttingView
              onOpenDrawing={(partId) => { selectPart(partId); setCenterView('documents'); }}
              onOpenIn3D={(partId) => { selectPart(partId); setCenterView('3d'); }}
              onOpenPart={(partId) => { selectPart(partId); setCenterView('table'); }}
            />
          )}
          {centerView === 'cuttingPrep' && (
            <CuttingPrep onOpenPart={(id) => { selectPart(id as never); setCenterView('table'); }} />
          )}
          {centerView === 'interactive' && (
            <InteractiveEditor onOpen3D={() => setCenterView('3d')} />
          )}
          {centerView === 'cabinet' && (
            <CabinetDesigner
              onOpenPart={(id) => { selectPart(id); setCenterView('table'); }}
              onOpen3D={() => setCenterView('3d')}
            />
          )}
          {centerView === 'parametric' && <ParametricPanel />}
          {centerView === 'modules' && (
            <ModulesView
              onOpenPart={(id) => { selectPart(id); setCenterView('table'); }}
              onOpen3D={() => setCenterView('3d')}
            />
          )}
          {centerView === 'library' && <LibraryView />}
          {centerView === 'production' && (
            <ProductionView
              onOpenPart={(id) => { selectPart(id); setCenterView('table'); }}
              onOpenCutting={() => setCenterView('cutting')}
            />
          )}
          {centerView === 'productionCenter' && (
            <ProductionCenter
              onOpenPart={(id) => { selectPart(id as never); setCenterView('table'); }}
              onOpenCutting={() => setCenterView('cutting')}
              onOpenDocuments={() => setCenterView('documents')}
            />
          )}
          {centerView === 'hardwareCatalog' && (
            <HardwareCatalogView onOpenPart={(id) => { selectPart(id as never); setCenterView('table'); }} />
          )}
          {centerView === 'viewer3d' && (
            <Viewer3D
              onOpenPart={(id) => { selectPart(id as never); setCenterView('table'); }}
              onOpenCutting={() => setCenterView('cutting')}
              onOpenProduction={() => setCenterView('productionCenter')}
              onOpenBom={() => setCenterView('production')}
            />
          )}
          {centerView === 'documents' && (
            <DocumentsView
              onOpenIn3D={() => setCenterView('3d')}
              onOpenInCutting={() => setCenterView('cutting')}
              onOpenInMachining={() => setCenterView('machining')}
            />
          )}
        </div>
        </ErrorBoundary>
      </div>
      <RightPanel />
      <StatusBar status={status} />

      {projectsOpen && <ProjectsDialog onClose={() => setProjectsOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {createOpen && <CreateFurnitureDialog onClose={() => setCreateOpen(false)} />}
      {newProjectOpen && <NewProjectDialog onClose={() => setNewProjectOpen(false)} />}
    </div>
  );
}
