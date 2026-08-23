/**
 * Репозиторий проектов поверх IndexedDB: save / load / delete / list.
 * Хранит несколько проектов; список возвращается кратким описанием.
 */
import { getDb, PROJECTS_STORE } from '../indexeddb/db';
import type { Project } from '@/core/model/types';
import type { ProjectId } from '@/core/model/ids';

export interface ProjectSummary {
  id: ProjectId;
  name: string;
  updatedAt: string;
  createdAt: string;
}

export async function saveProject(project: Project): Promise<void> {
  const db = await getDb();
  await db.put(PROJECTS_STORE, project);
}

export async function loadProject(id: ProjectId): Promise<Project | undefined> {
  const db = await getDb();
  return db.get(PROJECTS_STORE, id);
}

export async function deleteProject(id: ProjectId): Promise<void> {
  const db = await getDb();
  await db.delete(PROJECTS_STORE, id);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await getDb();
  const all = await db.getAll(PROJECTS_STORE);
  return all
    .map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      createdAt: p.createdAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
