/**
 * Движок корпусного шкафа как реализация FurnitureEngine.
 *
 * С этапа 35 собственной генерации здесь НЕТ: детали строит единый
 * параметрический движок (engines/parametric), а этот класс лишь подключает
 * его к реестру движков мебели. Так любой путь — мастер, шаблон, панель
 * параметров или calculateFurniture — даёт одни и те же детали.
 */
import type { Furniture, Part } from '@/core/model/types';
import { generateParts } from '@/engines/parametric/generator';
import { readParametricModel } from '@/engines/parametric/templates';
import type { FurnitureEngine } from '../FurnitureEngine';

export class CabinetEngine implements FurnitureEngine {
  readonly type = 'cabinet';
  readonly name = 'Шкаф';

  generate(furniture: Furniture): Part[] {
    const existing = furniture.assemblies.flatMap((a) => a.parts);
    const result = generateParts(readParametricModel(furniture), existing);
    // Ошибка модели не должна стирать уже существующие детали.
    return result.ok ? result.parts : existing;
  }
}
