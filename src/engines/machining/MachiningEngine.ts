/**
 * Интерфейс движка присадки: по деталям и типу соединения порождает
 * технологические операции. В этом каркасе — пустой резолвер (операции
 * добавляются вручную). Реальные правила (конфирматы, петли, …)
 * регистрируются на следующих этапах через этот же интерфейс.
 */
import type { MachiningOperation, Part, Project } from '@/core/model/types';

export interface MachiningContext {
  project: Project;
}

export interface MachiningEngine {
  readonly id: string;
  readonly name: string;
  /** Вернуть операции для конкретной детали (не мутирует деталь). */
  resolve(part: Part, ctx: MachiningContext): MachiningOperation[];
}

const registry = new Map<string, MachiningEngine>();

export function registerMachiningEngine(engine: MachiningEngine): void {
  registry.set(engine.id, engine);
}

export function listMachiningEngines(): MachiningEngine[] {
  return [...registry.values()];
}

/** Резолвер по умолчанию: авто-присадка отсутствует (ручной ввод). */
export class NoopMachiningEngine implements MachiningEngine {
  readonly id = 'noop';
  readonly name = 'Без авто-присадки';
  resolve(): MachiningOperation[] {
    return [];
  }
}
