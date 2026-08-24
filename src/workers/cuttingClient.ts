/**
 * Клиент Web Worker раскроя: запускает расчёт, отдаёт прогресс и позволяет
 * отменить его. Fallback на синхронный расчёт, если Worker недоступен.
 */
import type { CuttingReport, Project } from '@/core/model/types';
import { CuttingCancelledError, runCutting, type CuttingProgress } from '@/engines/cutting';

export interface CuttingHandle {
  promise: Promise<CuttingReport>;
  cancel: () => void;
}

export function runCuttingInWorker(
  project: Project,
  onProgress?: (p: CuttingProgress) => void,
): CuttingHandle {
  if (typeof Worker === 'undefined') {
    // Среда без Worker (напр. тесты) — синхронный расчёт.
    return { promise: Promise.resolve(runCutting(project, { controls: { onProgress } })), cancel: () => {} };
  }

  const worker = new Worker(new URL('./cutting.worker.ts', import.meta.url), { type: 'module' });
  let settled = false;

  const promise = new Promise<CuttingReport>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; fraction?: number; message?: string; report?: CuttingReport };
      if (m.type === 'progress') onProgress?.({ fraction: m.fraction ?? 0, message: m.message ?? '' });
      else if (m.type === 'done') { settled = true; resolve(m.report as CuttingReport); worker.terminate(); }
      else if (m.type === 'cancelled') { settled = true; reject(new CuttingCancelledError()); worker.terminate(); }
      else if (m.type === 'error') { settled = true; reject(new Error(m.message ?? 'Ошибка расчёта')); worker.terminate(); }
    };
    worker.onerror = (ev) => {
      if (!settled) { settled = true; reject(new Error(ev.message || 'Ошибка Worker')); worker.terminate(); }
    };
  });

  worker.postMessage({ type: 'run', project });

  return {
    promise,
    cancel: () => {
      worker.postMessage({ type: 'cancel' });
      // страховка: если воркер не ответил быстро — завершаем и отклоняем.
      setTimeout(() => {
        if (!settled) { settled = true; worker.terminate(); }
      }, 300);
    },
  };
}
