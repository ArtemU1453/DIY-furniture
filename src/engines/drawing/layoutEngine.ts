/**
 * DrawingLayoutEngine — автоматическая раскладка чертежа на листе.
 *
 * Отвечает за подбор формата/ориентации/масштаба так, чтобы содержимое
 * помещалось и оставалось читаемым. Не изменяет производственную модель:
 * получает габариты содержимого (мм) и возвращает план раскладки. При
 * переполнении: 1) уменьшить масштаб, 2) сменить ориентацию, 3) сообщить о
 * необходимости доп. листов.
 */
import { contentArea, scaleLabel, sheetSize, type Orientation, type SheetFormat } from './sheet';

/** Область-регион на листе (мм) — вид, таблица, штамп. */
export interface LayoutRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** План раскладки: выбранный формат/ориентация/масштаб и переполнение. */
export interface LayoutPlan {
  format: SheetFormat;
  orientation: Orientation;
  scale: number;
  scaleLabel: string;
  fits: boolean;
  /** Сколько доп. листов потребуется, если не влезает даже при мин. масштабе. */
  extraSheets: number;
}

const STD = [1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100, 1 / 200, 1 / 500];
/** Минимально читаемый масштаб — ниже него не ужимаем (лучше доп. лист). */
export const MIN_READABLE_SCALE = 1 / 50;

function fitScale(rawW: number, rawH: number, format: SheetFormat, orientation: Orientation): number {
  const area = contentArea(format, orientation);
  const fit = Math.min(area.w / Math.max(rawW, 1), area.h / Math.max(rawH, 1));
  if (fit >= 1) return 1;
  return STD.find((s) => s <= fit) ?? STD[STD.length - 1];
}

/**
 * Спланировать раскладку содержимого rawW×rawH на заданном формате.
 * Пробует исходную ориентацию, затем повёрнутую; выбирает наибольший
 * читаемый масштаб. Если и это не помогает — помечает переполнение.
 */
export function planLayout(
  rawW: number,
  rawH: number,
  format: SheetFormat,
  preferred: Orientation = 'LANDSCAPE',
): LayoutPlan {
  const other: Orientation = preferred === 'LANDSCAPE' ? 'PORTRAIT' : 'LANDSCAPE';
  const candidates: Array<{ orientation: Orientation; scale: number }> = [
    { orientation: preferred, scale: fitScale(rawW, rawH, format, preferred) },
    { orientation: other, scale: fitScale(rawW, rawH, format, other) },
  ];
  // Выбираем ориентацию с наибольшим масштабом.
  candidates.sort((a, b) => b.scale - a.scale);
  const best = candidates[0];

  const fits = best.scale >= MIN_READABLE_SCALE;
  let extraSheets = 0;
  if (!fits) {
    // Оцениваем число доп. листов при минимально читаемом масштабе.
    const area = contentArea(format, best.orientation);
    const cols = Math.ceil((rawW * MIN_READABLE_SCALE) / area.w);
    const rows = Math.ceil((rawH * MIN_READABLE_SCALE) / area.h);
    extraSheets = Math.max(0, cols * rows - 1);
  }

  const scale = fits ? best.scale : MIN_READABLE_SCALE;
  return { format, orientation: best.orientation, scale, scaleLabel: scaleLabel(scale), fits, extraSheets };
}

/** Проверка пересечения регионов раскладки (для валидатора). */
export function regionsOverlap(regions: LayoutRegion[]): boolean {
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i];
      const b = regions[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) return true;
    }
  }
  return false;
}

/** Помещается ли содержимое сцены (мм) в рабочую область формата при масштабе. */
export function contentFits(
  contentW: number,
  contentH: number,
  scale: number,
  format: SheetFormat,
  orientation: Orientation,
): boolean {
  const area = contentArea(format, orientation);
  return contentW * scale <= area.w + 0.5 && contentH * scale <= area.h + 0.5;
}

export { sheetSize };
