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

export interface AutosaverOptions {
  delayMs?: number;
  onStatus?: (status: 'saving' | 'saved') => void;
}

export function createAutosaver(options: AutosaverOptions = {}): Autosaver {
  const delayMs = options.delayMs ?? 800;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Project | null = null;

  const run = async () => {
    timer = null;
    if (!pending) return;
    const project = pending;
    pending = null;
    options.onStatus?.('saving');
    await saveProject(project);
    options.onStatus?.('saved');
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
