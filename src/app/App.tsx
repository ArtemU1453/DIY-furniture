import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from './store/editorStore';
import { TopBar } from '@/components/layout/TopBar';
import { LeftPanel, type NavSection } from '@/components/layout/LeftPanel';
import { StatusBar } from '@/components/layout/StatusBar';
import { PropertiesPanel } from '@/components/panels/PropertiesPanel';
import { ProjectsDialog } from '@/components/panels/ProjectsDialog';
import { SettingsDialog } from '@/components/panels/SettingsDialog';
import { Scene3D } from '@/features/designer/Scene3D';
import { createAutosaver } from '@/storage/backup/autosave';

export function App() {
  const [status, setStatus] = useState('');
  const [section, setSection] = useState<NavSection>('parts');
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
      <LeftPanel section={section} onSection={setSection} />
      <div className="center-area">
        <Scene3D />
      </div>
      <PropertiesPanel />
      <StatusBar status={status} />

      {projectsOpen && <ProjectsDialog onClose={() => setProjectsOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
