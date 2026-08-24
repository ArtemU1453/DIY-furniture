/**
 * Планировщик соединений корпуса из шаблона.
 *
 * Возвращает план соединений (по стабильным ключам деталей и категории
 * крепежа). Оркестрация (store) сопоставляет ключи с partId и категорию с
 * конкретной фурнитурой, затем создаёт HardwareConnection штатным способом
 * (с проверкой контакта). Здесь НЕ создаются сущности напрямую.
 */
import type { Part } from '@/core/model/types';
import type { HardwareCategory } from '@/core/model/types';
import type { CabinetParameters } from '@/engines/furniture/cabinet';

export interface ConnectionPlan {
  category: HardwareCategory;
  aKey: string;
  bKey: string;
  quantity?: number;
}

const keyOf = (p: Part): string | undefined => p.metadata?.key as string | undefined;
const typeOf = (p: Part): string | undefined => p.metadata?.partType as string | undefined;

/** Число петель по высоте фасада (простое правило, параметры редактируемы). */
export function hingeCountForHeight(height: number): number {
  if (height <= 900) return 2;
  if (height <= 1500) return 3;
  if (height <= 2000) return 4;
  return 5;
}

/**
 * Построить план соединений: корпусные стыки выбранным крепежом + петли и ручки
 * для фасадов.
 */
export function planCabinetConnections(parts: Part[], params: CabinetParameters): ConnectionPlan[] {
  if (params.boardOnly) return [];
  const plans: ConnectionPlan[] = [];
  const joint = params.jointType as HardwareCategory; // confirmat | dowel | minifix

  const byKey = new Map<string, Part>();
  for (const p of parts) { const k = keyOf(p); if (k) byKey.set(k, p); }
  const has = (k: string) => byKey.has(k);

  const sideL = 'side_left', sideR = 'side_right';
  // Верх/низ к боковинам.
  for (const horiz of ['top', 'bottom']) {
    if (has(horiz) && has(sideL)) plans.push({ category: joint, aKey: horiz, bKey: sideL, quantity: 2 });
    if (has(horiz) && has(sideR)) plans.push({ category: joint, aKey: horiz, bKey: sideR, quantity: 2 });
  }
  // Полки к боковинам.
  for (const p of parts) {
    if (typeOf(p) === 'shelf') {
      const k = keyOf(p)!;
      if (has(sideL)) plans.push({ category: joint, aKey: k, bKey: sideL, quantity: 2 });
      if (has(sideR)) plans.push({ category: joint, aKey: k, bKey: sideR, quantity: 2 });
    }
    // Перегородки к верху/низу.
    if (typeOf(p) === 'divider') {
      const k = keyOf(p)!;
      if (has('top')) plans.push({ category: joint, aKey: k, bKey: 'top', quantity: 1 });
      if (has('bottom')) plans.push({ category: joint, aKey: k, bKey: 'bottom', quantity: 1 });
    }
  }

  // Фасады: петли к ближайшей боковине + ручка.
  const facades = parts.filter((p) => typeOf(p) === 'facade');
  facades.forEach((f, i) => {
    const k = keyOf(f)!;
    const sideKey = i === 0 ? sideL : sideR;
    if (has(sideKey)) {
      plans.push({ category: 'hinge', aKey: k, bKey: sideKey, quantity: hingeCountForHeight(f.height) });
      if (params.handleEnabled) plans.push({ category: 'handle', aKey: k, bKey: sideKey, quantity: 1 });
    }
  });

  return plans;
}
