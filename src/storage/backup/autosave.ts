/**
 * Автоматическое локальное резервирование проекта (debounce).
 * Сохраняет текущий проект в IndexedDB спустя паузу после последнего изменения.
 */
import type { Project } from '@/core/model/types';
import { saveProject } from '../project/projectRepository';

export interface Autosaver {
  schedule(project: Project): void;
  flush(): Promise<void>;
  cancel(): void;
}

export function createAutosaver(delayMs = 800): Autosaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Project | null = null;

  const run = async () => {
    timer = null;
    if (!pending) return;
    const project = pending;
    pending = null;
    await saveProject(project);
  };

  return {
    schedule(project: Project) {
      pending = project;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delayMs);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await run();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
