/**
 * Интерфейс параметрического движка мебели: из изделия порождает детали.
 *
 * В этом каркасе есть только тип «custom» — детали создаются пользователем
 * вручную, и движок возвращает их без изменений (identity). Настоящие
 * генераторы корпусов (шкаф, тумба, …) регистрируются на следующих этапах,
 * реализуя этот же интерфейс, без изменения вызывающего кода.
 *
 *   UI → calculateFurniture() → FurnitureEngine → Part[]
 */
import type { Furniture, Part, Project } from '@/core/model/types';

export interface FurnitureContext {
  project: Project;
}

export interface FurnitureEngine {
  readonly type: string;
  readonly name: string;
  generate(furniture: Furniture, ctx: FurnitureContext): Part[];
}

const registry = new Map<string, FurnitureEngine>();

export function registerFurnitureEngine(engine: FurnitureEngine): void {
  registry.set(engine.type, engine);
}

export function getFurnitureEngine(type: string): FurnitureEngine | undefined {
  return registry.get(type);
}

export function listFurnitureEngines(): FurnitureEngine[] {
  return [...registry.values()];
}

/** Фасад для UI: рассчитать детали изделия через соответствующий движок. */
export function calculateFurniture(
  furniture: Furniture,
  ctx: FurnitureContext,
): Part[] {
  const engine = getFurnitureEngine(furniture.type);
  if (!engine) return [];
  return engine.generate(furniture, ctx);
}

/** Движок произвольного изделия: детали заданы пользователем как есть. */
export class CustomFurnitureEngine implements FurnitureEngine {
  readonly type = 'custom';
  readonly name = 'Произвольное изделие';
  generate(furniture: Furniture): Part[] {
    return furniture.assemblies.flatMap((a) => a.parts);
  }
}
