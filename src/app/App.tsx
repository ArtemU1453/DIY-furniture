import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from './store/editorStore';
import { TopBar } from '@/components/layout/TopBar';
import { LeftPanel, type NavSection } from '@/components/layout/LeftPanel';
import { RightPanel } from '@/components/layout/RightPanel';
import { StatusBar } from '@/components/layout/StatusBar';
import { ProjectsDialog } from '@/components/panels/ProjectsDialog';
import { SettingsDialog } from '@/components/panels/SettingsDialog';
import { CreateFurnitureDialog } from '@/components/panels/CreateFurnitureDialog';
import { PartsTable } from '@/components/panels/PartsTable';
import { MaterialsView } from '@/components/panels/MaterialsView';
import { HardwareView } from '@/components/panels/HardwareView';
import { Scene3D } from '@/features/designer/Scene3D';
import { createAutosaver } from '@/storage/backup/autosave';

type CenterView = '3d' | 'table' | 'materials' | 'hardware';

export function App() {
  const [status, setStatus] = useState('');
  const [section, setSection] = useState<NavSection>('parts');
  const [centerView, setCenterView] = useState<CenterView>('3d');
  const [showNumbers, setShowNumbers] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const newProject = useEditorStore((s) => s.newProject);

  // Автобэкап: сохраняем проект в IndexedDB спустя паузу после изменений.
  const autosaver = useRef(createAutosaver());
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state) => {
      autosaver.current.schedule(state.project);
    });
    return () => {
      unsub();
      void autosaver.current.flush();
    };
  }, []);

  // Горячие клавиши Undo/Redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  return (
    <div className="editor">
      <TopBar
        onOpenProjects={() => setProjectsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onNewProject={() => {
          newProject();
          setStatus('Создан новый проект');
        }}
        setStatus={setStatus}
      />
      <LeftPanel
        section={section}
        onSection={(s) => {
          setSection(s);
          if (s === 'parts') setCenterView('table');
          else if (s === 'materials') setCenterView('materials');
          else if (s === 'hardware') setCenterView('hardware');
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
            ] as Array<[CenterView, string]>
          ).map(([v, label]) => (
            <button key={v} className={centerView === v ? 'active' : ''} onClick={() => setCenterView(v)}>
              {label}
            </button>
          ))}
          {centerView === '3d' && (
            <label className="num-toggle">
              <input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} />
              № деталей
            </label>
          )}
        </div>
        <div className="center-body">
          {centerView === '3d' && <Scene3D showNumbers={showNumbers} />}
          {centerView === 'table' && <PartsTable />}
          {centerView === 'materials' && <MaterialsView />}
          {centerView === 'hardware' && <HardwareView />}
        </div>
      </div>
      <RightPanel />
      <StatusBar status={status} />

      {projectsOpen && <ProjectsDialog onClose={() => setProjectsOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {createOpen && <CreateFurnitureDialog onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
