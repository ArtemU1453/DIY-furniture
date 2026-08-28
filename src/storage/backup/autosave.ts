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
  onStatus?: (status: 'saving' | 'saved' | 'error') => void;
  /** Сообщение о неудачном сохранении — чтобы показать его пользователю. */
  onError?: (message: string) => void;
}

export function createAutosaver(options: AutosaverOptions = {}): Autosaver {
  const delayMs = options.delayMs ?? 800;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Project | null = null;

  const run = async () => {
    timer = null;
    if (!pending) return;
    const project = pending;
    options.onStatus?.('saving');
    try {
      await saveProject(project);
      /* Снимаем очередь только после УСПЕШНОЙ записи: если хранилище
       * недоступно (приватный режим, переполнение), проект остаётся в
       * очереди и будет сохранён при следующей попытке. */
      if (pending === project) pending = null;
      options.onStatus?.('saved');
    } catch (error) {
      options.onStatus?.('error');
      options.onError?.(
        error instanceof Error && error.message
          ? `Не удалось сохранить проект: ${error.message}`
          : 'Не удалось сохранить проект: локальное хранилище недоступно.',
      );
    }
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
      // run() сам обрабатывает ошибку — flush никогда не роняет вызывающий код.
      await run();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
