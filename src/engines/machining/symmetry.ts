/**
 * SymmetryRule (§24) — симметричное распределение крепежа по длине детали.
 *
 * Позиции всегда симметричны относительно середины: первое и последнее
 * отверстие отстоят от краёв на один и тот же отступ. Это же правило задаёт
 * КОЛИЧЕСТВО крепежа по длине (§23) — значения конфигурируемы, не случайны.
 */

/** Симметричные позиции вдоль отрезка длиной `size` (мм). */
export function symmetricPositions(size: number, count: number, edgeOffset: number): number[] {
  if (count <= 0 || size <= 0) return [];
  const offset = Math.min(edgeOffset, Math.max(0, size / 2 - 1));
  if (count === 1) return [size / 2];
  const first = offset;
  const last = size - offset;
  const step = (last - first) / (count - 1);
  return Array.from({ length: count }, (_, i) => first + i * step);
}

/** Проверка симметрии набора позиций относительно середины отрезка. */
export function isSymmetric(positions: number[], size: number, tolerance = 0.01): boolean {
  if (positions.length === 0) return true;
  const sorted = [...positions].sort((a, b) => a - b);
  for (let i = 0, j = sorted.length - 1; i <= j; i++, j--) {
    if (Math.abs(sorted[i] - (size - sorted[j])) > tolerance) return false;
  }
  return true;
}

/** Конфигурация правила «количество крепежа по длине детали» (§23). */
export interface FastenerCountRule {
  /** Пороги длины (мм) по возрастанию и соответствующее количество. */
  steps: Array<{ upTo: number; count: number }>;
  /** Количество для длин больше последнего порога. */
  beyond: number;
}

export const DEFAULT_FASTENER_COUNT: FastenerCountRule = {
  steps: [
    { upTo: 300, count: 2 },
    { upTo: 800, count: 3 },
    { upTo: 1500, count: 4 },
  ],
  beyond: 5,
};

/** Количество крепежа для длины детали по конфигурируемому правилу. */
export function fastenerCountForLength(length: number, rule: FastenerCountRule = DEFAULT_FASTENER_COUNT): number {
  for (const step of rule.steps) {
    if (length <= step.upTo) return step.count;
  }
  return rule.beyond;
}
