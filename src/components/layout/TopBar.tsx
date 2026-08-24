import { useRef } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import {
  exportCurrentProjectToFile,
  importProjectFromJson,
  saveCurrentProject,
} from '@/features/project/projectActions';
import { ProjectParseError } from '@/storage/project/serialization';

interface Props {
  onOpenProjects: () => void;
  onOpenSettings: () => void;
  onNewProject: () => void;
  setStatus: (message: string) => void;
}

export function TopBar({ onOpenProjects, onOpenSettings, onNewProject, setStatus }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);

  const handleSave = async () => {
    await saveCurrentProject();
    useEditorStore.getState().setSaveState('saved');
    setStatus('Проект сохранён локально');
  };

  const handleExport = () => {
    exportCurrentProjectToFile();
    setStatus('Проект экспортирован в JSON');
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const project = importProjectFromJson(text);
      setStatus(`Импортирован проект «${project.name}»`);
    } catch (err) {
      const msg = err instanceof ProjectParseError ? err.message : 'Ошибка импорта файла';
      setStatus(`Ошибка: ${msg}`);
    }
  };

  return (
    <div className="top-bar">
      <span className="brand">Karkas</span>
      <button onClick={onNewProject}>Новый</button>
      <button onClick={onOpenProjects}>Открыть</button>
      <button onClick={handleSave}>Сохранить</button>
      <span className="sep" />
      <button onClick={() => fileInputRef.current?.click()}>Импорт</button>
      <button onClick={handleExport}>Экспорт</button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none', width: 'auto' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportFile(file);
          e.target.value = '';
        }}
      />
      <span className="sep" />
      <button onClick={undo} disabled={!canUndo} title="Отменить">
        ↶ Отменить
      </button>
      <button onClick={redo} disabled={!canRedo} title="Повторить">
        ↷ Повторить
      </button>
      <span className="sep" />
      <button onClick={onOpenSettings}>Настройки</button>
    </div>
  );
}
