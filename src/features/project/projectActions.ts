/**
 * Прикладные действия над проектом: связывают store, хранилище и
 * сериализацию. UI вызывает эти функции, не зная деталей IndexedDB/файлов.
 */
import { useEditorStore } from '@/app/store/editorStore';
import {
  deleteProject as repoDelete,
  listProjects as repoList,
  loadProject as repoLoad,
  saveProject as repoSave,
  type ProjectSummary,
} from '@/storage/project/projectRepository';
import {
  deserializeProject,
  serializeProject,
  PROJECT_FILE_EXTENSION,
} from '@/storage/project/serialization';
import type { Project } from '@/core/model/types';
import type { ProjectId } from '@/core/model/ids';

/** Сохранить текущий проект в локальное хранилище. */
export async function saveCurrentProject(): Promise<void> {
  const project = useEditorStore.getState().project;
  await repoSave(project);
}

/** Загрузить проект из хранилища в редактор. */
export async function openProjectById(id: ProjectId): Promise<boolean> {
  const project = await repoLoad(id);
  if (!project) return false;
  useEditorStore.getState().loadProject(project);
  return true;
}

export async function deleteProjectById(id: ProjectId): Promise<void> {
  await repoDelete(id);
}

export async function listSavedProjects(): Promise<ProjectSummary[]> {
  return repoList();
}

function sanitizeFileName(name: string): string {
  return name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'project';
}

/** Экспортировать текущий проект в файл *.furniture.json. */
export function exportCurrentProjectToFile(): void {
  const project = useEditorStore.getState().project;
  const json = serializeProject(project);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFileName(project.name)}${PROJECT_FILE_EXTENSION}`;
  // Некоторые браузеры инициируют скачивание только для элемента в DOM.
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Разобрать JSON-строку в проект (для импорта из файла). */
export function importProjectFromJson(json: string): Project {
  const project = deserializeProject(json);
  useEditorStore.getState().loadProject(project);
  return project;
}
