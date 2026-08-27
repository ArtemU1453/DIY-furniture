/**
 * JSON-экспорт проекта (§49).
 *
 * project.json содержит ПОЛНУЮ модель проекта и восстанавливается импортом
 * один в один. Данных рендера в нём нет по построению: ProjectModel хранит
 * только производственную модель — камера, свет, сетка и состояние 3D-вида
 * живут в UI-состоянии и в модель не попадают.
 */
import type { Project } from '@/core/model/types';
import { serializeProject } from '@/storage/project/serialization';

export interface ProjectJsonOptions {
  /**
   * Не включать производные данные, которые можно пересчитать: сохранённый
   * отчёт раскроя и историю генерации документов. Проект остаётся полностью
   * восстановимым, но файл меньше — раскрой после импорта нужно пересчитать.
   */
  lean?: boolean;
}

/** Проект → строка project.json. */
export function projectJson(project: Project, opts: ProjectJsonOptions = {}): string {
  if (!opts.lean) return serializeProject(project);
  const lean: Project = {
    ...project,
    cutting: { ...project.cutting, report: undefined },
    documents: { ...project.documents, history: [] },
  };
  return serializeProject(lean);
}

/** Размер экспорта в байтах (для показа перед скачиванием). */
export function projectJsonSize(project: Project, opts: ProjectJsonOptions = {}): number {
  return new TextEncoder().encode(projectJson(project, opts)).length;
}
