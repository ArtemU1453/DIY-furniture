/**
 * Единицы измерения.
 *
 * ВНУТРИ вычислительного ядра используется единственная базовая единица —
 * миллиметр (мм). Все размеры в модели проекта хранятся в мм.
 * Преобразование в/из других единиц выполняется ТОЛЬКО на границе UI.
 */

/** Базовая единица хранения и вычислений. */
export type BaseUnit = 'mm';

/** Единицы, доступные для отображения в интерфейсе. */
export type DisplayUnit = 'mm' | 'cm' | 'm' | 'in';

/** Коэффициент перевода одной единицы в миллиметры. */
const TO_MM: Record<DisplayUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

/** Перевести значение из указанной единицы в миллиметры (база). */
export function toMm(value: number, from: DisplayUnit): number {
  return value * TO_MM[from];
}

/** Перевести значение из миллиметров в указанную единицу отображения. */
export function fromMm(valueMm: number, to: DisplayUnit): number {
  return valueMm / TO_MM[to];
}

/** Перевод между двумя произвольными единицами (через базу). */
export function convert(value: number, from: DisplayUnit, to: DisplayUnit): number {
  return fromMm(toMm(value, from), to);
}

/** Округление до заданного числа знаков (по умолчанию — целые мм). */
export function round(value: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Человекочитаемое обозначение единицы. */
export function unitLabel(unit: DisplayUnit): string {
  return unit;
}
