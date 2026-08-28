/**
 * Массивы фурнитуры и симметрия (§31–§34, §83–§91).
 *
 * Массив — это СПОСОБ ПОСЧИТАТЬ И РАССТАВИТЬ, а не новая сущность: функции
 * возвращают координаты точек, а сами единицы создаёт вызывающий код из
 * существующего HardwareInstance. Второй системы фурнитуры не появляется.
 *
 * Три режима шага (§87):
 *   FIXED — ровно `spacing` между соседями, сколько поместится;
 *   EQUAL — заданное количество, промежутки равны;
 *   MAX   — `spacing` это ПОТОЛОК: количество берётся минимальным, при
 *           котором шаг не превышает потолка.
 */
import type { HardwareArraySpec, Mm, SpacingMode } from '@/core/model/types';

export interface ArrayPoint {
  /** Координата вдоль линии размещения, мм. */
  position: Mm;
  index: number;
}

const clampCount = (count: number, spec: HardwareArraySpec): number => {
  const min = spec.minCount ?? 1;
  const max = spec.maxCount ?? Number.POSITIVE_INFINITY;
  return Math.max(min, Math.min(max, Math.round(count)));
};

/**
 * Количество элементов массива (§33/§34/§85).
 *
 * `length` — рабочая длина линии (уже без отступов от краёв).
 */
export function arrayCount(length: Mm, spec: HardwareArraySpec): number {
  if (spec.count != null && Number.isFinite(spec.count)) return clampCount(spec.count, spec);

  const spacing = spec.spacing;
  if (!spacing || spacing <= 0 || length <= 0) return clampCount(spec.minCount ?? 2, spec);

  const mode: SpacingMode = spec.spacingMode ?? 'FIXED';
  if (mode === 'MAX') {
    // Шаг не должен превышать потолок: берём минимальное подходящее количество.
    return clampCount(Math.ceil(length / spacing) + 1, spec);
  }
  // FIXED и EQUAL: сколько шагов укладывается в длину, плюс замыкающая точка.
  return clampCount(Math.floor(length / spacing) + 1, spec);
}

/**
 * Точки массива на отрезке [0, length] (§84/§87/§88).
 *
 * Крайние точки отступают от края на `edgeOffset`; промежуточные ставятся по
 * выбранному режиму шага. Симметричный массив (§90) зеркален относительно
 * середины по построению: точки идут от края к краю равномерно.
 */
export function arrayPoints(length: Mm, spec: HardwareArraySpec): ArrayPoint[] {
  const edge = Math.max(0, spec.edgeOffset ?? 0);
  const usable = Math.max(0, length - edge * 2);
  const count = arrayCount(usable, spec);

  if (count <= 1) return [{ position: length / 2, index: 0 }];

  const mode: SpacingMode = spec.spacingMode ?? 'FIXED';
  const points: ArrayPoint[] = [];

  if (mode === 'FIXED' && spec.spacing && spec.spacing > 0 && !spec.count) {
    /* Фиксированный шаг: ряд начинается от края и идёт с точным шагом.
     * Ряд центрируется — остаток длины делится поровну между краями, иначе
     * крепёж «прижимался» бы к одному краю. */
    const span = spec.spacing * (count - 1);
    const start = edge + (usable - span) / 2;
    for (let i = 0; i < count; i++) points.push({ position: start + spec.spacing * i, index: i });
    return points;
  }

  // EQUAL и MAX: равные промежутки между крайними точками.
  const step = usable / (count - 1);
  for (let i = 0; i < count; i++) points.push({ position: edge + step * i, index: i });
  return points;
}

/** Фактический шаг между соседними точками, мм. */
export function actualSpacing(points: ArrayPoint[]): Mm {
  if (points.length < 2) return 0;
  return points[1].position - points[0].position;
}

/**
 * Симметричное размещение относительно центра (§90/§91).
 *
 * Каждая точка получает пару, отражённую относительно середины. Точка,
 * стоящая ровно по центру, не дублируется — иначе в центре оказались бы
 * две петли на одном месте.
 */
export function symmetricPoints(length: Mm, offsets: Mm[], tolerance = 0.5): ArrayPoint[] {
  const out: number[] = [];
  for (const offset of offsets) {
    const a = offset;
    const b = length - offset;
    out.push(a);
    if (Math.abs(a - b) > tolerance) out.push(b);
  }
  return [...new Set(out.map((v) => Math.round(v * 1000) / 1000))]
    .sort((p, q) => p - q)
    .map((position, index) => ({ position, index }));
}

/** Отразить точки массива относительно длины (§92). */
export function mirrorPoints(length: Mm, points: ArrayPoint[]): ArrayPoint[] {
  return points
    .map((p) => ({ position: length - p.position, index: p.index }))
    .sort((a, b) => a.position - b.position)
    .map((p, index) => ({ ...p, index }));
}

/** Готовые массивы для типовых задач (§85). */
export const ARRAY_PRESETS: Record<string, HardwareArraySpec> = {
  /** Полкодержатели: по два на сторону, отступ 50 мм от края (§52). */
  shelfSupports: { count: 2, edgeOffset: 50, direction: 'horizontal', minCount: 2 },
  /** Шканты вдоль торца: шаг 128 мм, не ближе 50 мм к краю (§30/§32). */
  dowelRow: { spacing: 128, spacingMode: 'MAX', edgeOffset: 50, minCount: 2, maxCount: 8 },
  /** Крепёж длинного узла: равные промежутки (§86/§87). */
  carcassFasteners: { spacing: 300, spacingMode: 'MAX', edgeOffset: 50, minCount: 2, maxCount: 6 },
  /** Отверстия ручки: два, симметрично центру (§49/§50). */
  handleHoles: { count: 2, spacing: 96, spacingMode: 'FIXED', symmetric: true },
};
