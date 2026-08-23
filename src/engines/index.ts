/**
 * Bootstrap реестров движков. Импортируется один раз при старте приложения.
 * Регистрирует движки по умолчанию для каждого домена.
 */
import { registerCuttingEngine } from './cutting/CuttingEngine';
import { BasicShelfEngine } from './cutting/BasicShelfEngine';
import { registerFurnitureEngine, CustomFurnitureEngine } from './furniture/FurnitureEngine';
import { registerMachiningEngine, NoopMachiningEngine } from './machining/MachiningEngine';
import { registerDrawingEngine, BoundsDrawingEngine } from './drawings/DrawingEngine';

let bootstrapped = false;

export function bootstrapEngines(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  registerCuttingEngine(new BasicShelfEngine());
  registerFurnitureEngine(new CustomFurnitureEngine());
  registerMachiningEngine(new NoopMachiningEngine());
  registerDrawingEngine(new BoundsDrawingEngine());
}

export { getCuttingEngine, listCuttingEngines } from './cutting/CuttingEngine';
export { calculateFurniture } from './furniture/FurnitureEngine';
export type { CuttingEngine } from './cutting/CuttingEngine';
export type { CuttingInput, CuttingResult, StockSheet } from './cutting/types';
