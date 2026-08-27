/**
 * Интерфейс движка раскроя — заменяемый вычислительный модуль.
 *
 * UI и остальная система знают ТОЛЬКО этот интерфейс, а не конкретный
 * алгоритм. Более эффективный алгоритм регистрируется позже без изменения UI.
 */
import type { CuttingInput, CuttingResult, CuttingRunControls } from './types';

export interface CuttingEngine {
  readonly id: string;
  readonly name: string;
  /**
   * Версия алгоритма (§57). Меняется, когда правка движка меняет РЕЗУЛЬТАТ
   * при тех же входных данных. Версия попадает в CuttingResult, поэтому по
   * старому результату видно, каким поколением алгоритма он посчитан.
   */
  readonly version: string;
  /** Рассчитать раскрой одного материала. controls — прогресс/отмена. */
  calculate(input: CuttingInput, controls?: CuttingRunControls): CuttingResult;
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
