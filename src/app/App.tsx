import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from './store/editorStore';
import { TopBar } from '@/components/layout/TopBar';
import { LeftPanel, type NavSection } from '@/components/layout/LeftPanel';
import { RightPanel } from '@/components/layout/RightPanel';
import { StatusBar } from '@/components/layout/StatusBar';
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
import { Scene3D } from '@/features/designer/Scene3D';
import { View2D } from '@/features/designer/View2D';
import { createAutosaver } from '@/storage/backup/autosave';
import { saveCurrentProject } from '@/features/project/projectActions';

type CenterView = '3d' | 'table' | 'materials' | 'hardware' | 'machining' | 'cutting' | 'documents';
type ViewMode = '3d' | '2d' | 'split';

export function App() {
  const [status, setStatus] = useState('');
  const [section, setSection] = useState<NavSection>('parts');
  const [centerView, setCenterView] = useState<CenterView>('3d');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [showNumbers, setShowNumbers] = useState(false);
  const [showMachining, setShowMachining] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  // Автобэкап + индикатор статуса сохранения.
  const autosaver = useRef(createAutosaver({ onStatus: (st) => useEditorStore.getState().setSaveState(st) }));
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      // Автосохраняем только при реальном изменении проекта.
      if (state.project !== prev.project) autosaver.current.schedule(state.project);
    });
    return () => {
      unsub();
      void autosaver.current.flush();
    };
  }, []);

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
        s.removePart(s.selectedPartId);
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
          {(
            [
              ['3d', '3D'],
              ['table', 'Детали'],
              ['materials', 'Материалы'],
              ['hardware', 'Фурнитура'],
              ['machining', 'Присадка'],
              ['cutting', 'Раскрой'],
              ['documents', 'Документы'],
            ] as Array<[CenterView, string]>
          ).map(([v, label]) => (
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
                <input type="checkbox" checked={showMachining} onChange={(e) => setShowMachining(e.target.checked)} />
                Присадка
              </label>
            </>
          )}
        </div>
        <div className="center-body">
          {centerView === '3d' && (
            <div style={{ display: 'flex', height: '100%', width: '100%' }}>
              {(viewMode === '2d' || viewMode === 'split') && (
                <div style={{ flex: 1, minWidth: 0, borderRight: viewMode === 'split' ? '1px solid var(--border)' : undefined }}>
                  <View2D />
                </div>
              )}
              {(viewMode === '3d' || viewMode === 'split') && (
                <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                  <Scene3D showNumbers={showNumbers} showMachining={showMachining} />
                </div>
              )}
            </div>
          )}
          {centerView === 'table' && <PartsTable />}
          {centerView === 'materials' && <MaterialsView />}
          {centerView === 'hardware' && <HardwareView />}
          {centerView === 'machining' && <MachiningView />}
          {centerView === 'cutting' && <CuttingView />}
          {centerView === 'documents' && <DocumentsView />}
        </div>
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
