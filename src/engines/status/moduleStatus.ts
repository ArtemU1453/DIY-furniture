/**
 * Статусы производных модулей и зависимости.
 *
 *   Part → Machining → Cutting → Documents → Specification
 *
 * Присадка, спецификация и чертежи вычисляются «на лету» из модели — они всегда
 * актуальны (CURRENT). Раскрой кэшируется в проекте, поэтому может устареть
 * (DIRTY) при изменении модели — это отслеживается сигнатурой.
 */
import type { Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { isCuttingStale } from '@/engines/cutting';
import { allOperations, validateMachining } from '@/engines/machining';

export type ModuleState = 'current' | 'dirty' | 'calculating' | 'error' | 'empty';

export interface ModuleStatus {
  id: string;
  label: string;
  state: ModuleState;
  note?: string;
}

export interface StatusContext {
  cuttingRunning: boolean;
}

export function computeModuleStatuses(project: Project, ctx: StatusContext): ModuleStatus[] {
  const parts = allParts(project);
  const hasParts = parts.length > 0;

  // Присадка (live).
  const ops = allOperations(project);
  const machiningErrors = validateMachining(ops, project).filter((i) => i.severity === 'error').length;

  // Раскрой (кэшируется).
  let cuttingState: ModuleState;
  let cuttingNote: string | undefined;
  if (ctx.cuttingRunning) cuttingState = 'calculating';
  else if (!project.cutting.report) { cuttingState = 'empty'; cuttingNote = 'не рассчитан'; }
  else if (isCuttingStale(project)) { cuttingState = 'dirty'; cuttingNote = 'требует пересчёта'; }
  else cuttingState = 'current';

  return [
    { id: 'parts', label: 'Детали', state: hasParts ? 'current' : 'empty' },
    {
      id: 'machining',
      label: 'Присадка',
      state: machiningErrors > 0 ? 'error' : 'current',
      note: machiningErrors > 0 ? `${machiningErrors} ошибок` : 'актуально',
    },
    { id: 'cutting', label: 'Раскрой', state: cuttingState, note: cuttingNote },
    { id: 'documents', label: 'Документы', state: hasParts ? 'current' : 'empty', note: 'вычисляются автоматически' },
  ];
}

export const MODULE_STATE_LABEL: Record<ModuleState, string> = {
  current: 'CURRENT',
  dirty: 'DIRTY',
  calculating: 'CALCULATING',
  error: 'ERROR',
  empty: '—',
};

export const MODULE_STATE_COLOR: Record<ModuleState, string> = {
  current: 'var(--ok)',
  dirty: '#e6c060',
  calculating: 'var(--accent)',
  error: 'var(--danger)',
  empty: 'var(--text-dim)',
};
