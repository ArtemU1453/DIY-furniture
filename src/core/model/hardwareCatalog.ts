/**
 * Локальный каталог фурнитуры (данные проекта). Пользователь может добавлять
 * позиции из каталога или создавать собственные — архитектура не ограничена
 * этими значениями и не привязана к конкретному производителю.
 */
import { newHardwareId } from './ids';
import type { Hardware, HardwareCategory } from './types';

export type HardwareTemplate = Omit<Hardware, 'id'>;

export const HARDWARE_CATALOG: HardwareTemplate[] = [
  { name: 'Конфирмат 5×50', category: 'confirmat', article: '5x50', parameters: { diameter: 5, length: 50, headDiameter: 7, pilotDiameter: 3, count: 2, edgeOffset: 32 } },
  { name: 'Конфирмат 5×60', category: 'confirmat', article: '5x60', parameters: { diameter: 5, length: 60, headDiameter: 7, pilotDiameter: 3, count: 2, edgeOffset: 32 } },
  { name: 'Конфирмат 6.3×50', category: 'confirmat', article: '6.3x50', parameters: { diameter: 6.3, length: 50, headDiameter: 7, pilotDiameter: 4, count: 2, edgeOffset: 32 } },
  { name: 'Конфирмат 6.3×70', category: 'confirmat', article: '6.3x70', parameters: { diameter: 6.3, length: 70, headDiameter: 7, pilotDiameter: 4, count: 2, edgeOffset: 32 } },
  { name: 'Шкант Ø6×30', category: 'dowel', article: 'd6x30', parameters: { diameter: 6, length: 30, count: 2, edgeOffset: 50 } },
  { name: 'Шкант Ø8×30', category: 'dowel', article: 'd8x30', parameters: { diameter: 8, length: 30, count: 2, edgeOffset: 50 } },
  { name: 'Шкант Ø8×40', category: 'dowel', article: 'd8x40', parameters: { diameter: 8, length: 40, count: 2, edgeOffset: 50 } },
  { name: 'Минификс Ø15', category: 'minifix', article: 'mf15', parameters: { camDiameter: 15, camDepth: 12.5, rodDiameter: 8, rodDepth: 34, count: 2, edgeOffset: 32 } },
  { name: 'Саморез 4×30', category: 'screw', article: 's4x30', parameters: { diameter: 4, length: 30, pilotDiameter: 2.5, count: 3, edgeOffset: 40 } },
  { name: 'Уголок мебельный', category: 'corner', article: 'bracket', parameters: { diameter: 4, count: 1, edgeOffset: 30 } },
  { name: 'Петля 35 мм', category: 'hinge', article: 'hinge35', parameters: { cupDiameter: 35, cupDepth: 12.5, cupEdgeOffset: 22.5, screwDiameter: 2.5, count: 2, edgeOffset: 90 } },
  { name: 'Направляющая 450', category: 'slide', article: 'slide450', parameters: { length: 450, diameter: 4, position: 100, count: 3, edgeOffset: 30 } },
  { name: 'Опора 100 мм', category: 'leg', article: 'leg100', parameters: { height: 100, diameter: 8, depth: 12, edgeOffset: 50 } },
  { name: 'Ручка 96 мм', category: 'handle', article: 'handle96', parameters: { centerDistance: 96, diameter: 5, edgeOffset: 40 } },
  { name: 'Ручка 128 мм', category: 'handle', article: 'handle128', parameters: { centerDistance: 128, diameter: 5, edgeOffset: 40 } },
];

export function hardwareFromTemplate(t: HardwareTemplate): Hardware {
  return { id: newHardwareId(), ...t, parameters: { ...t.parameters } };
}

export function catalogByCategory(category: HardwareCategory): HardwareTemplate[] {
  return HARDWARE_CATALOG.filter((t) => t.category === category);
}
