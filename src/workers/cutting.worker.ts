/**
 * Web Worker раскроя: тяжёлый расчёт выполняется вне главного потока, чтобы не
 * блокировать интерфейс. Поддерживает прогресс и кооперативную отмену.
 *
 *   UI → Worker → CuttingEngine → Result → UI
 */
import { runCutting, CuttingCancelledError } from '@/engines/cutting';
import { bootstrapEngines } from '@/engines';
import type { Project } from '@/core/model/types';

// Воркер — отдельный контекст: регистрируем движки в нём.
bootstrapEngines();

const ctx = self as unknown as {
  postMessage: (m: unknown) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};

let cancelled = false;

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data as { type: string; project?: Project };
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (msg.type === 'run' && msg.project) {
    cancelled = false;
    try {
      const report = runCutting(msg.project, {
        controls: {
          onProgress: (p) => ctx.postMessage({ type: 'progress', fraction: p.fraction, message: p.message }),
          shouldCancel: () => cancelled,
        },
      });
      ctx.postMessage({ type: 'done', report });
    } catch (err) {
      if (err instanceof CuttingCancelledError) ctx.postMessage({ type: 'cancelled' });
      else ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
};
