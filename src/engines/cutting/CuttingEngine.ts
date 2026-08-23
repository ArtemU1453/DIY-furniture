/**
 * Интерфейс движка раскроя — заменяемый вычислительный модуль.
 *
 * UI и остальная система знают ТОЛЬКО этот интерфейс, а не конкретный
 * алгоритм. Более эффективный алгоритм регистрируется позже без изменения UI.
 */
import type { CuttingInput, CuttingResult } from './types';

export interface CuttingEngine {
  readonly id: string;
  readonly name: string;
  calculate(input: CuttingInput): CuttingResult;
}

/** Реестр движков раскроя. */
const registry = new Map<string, CuttingEngine>();

export function registerCuttingEngine(engine: CuttingEngine): void {
  registry.set(engine.id, engine);
}

export function getCuttingEngine(id: string): CuttingEngine | undefined {
  return registry.get(id);
}

export function listCuttingEngines(): CuttingEngine[] {
  return [...registry.values()];
}
