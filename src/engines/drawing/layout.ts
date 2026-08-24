/**
 * Подбор масштаба чертежа под область листа. Геометрия авторится в мм листа
 * (умножается на подобранный коэффициент), а рендер центрирует сцену в рамке.
 */
import { contentArea, scaleLabel, type Orientation, type SheetFormat } from './sheet';

const STD = [1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100, 1 / 200, 1 / 500];

/** Подобрать стандартный масштаб, при котором содержимое влезает в область. */
export function pickScale(rawW: number, rawH: number, format: SheetFormat, orientation: Orientation): { k: number; label: string } {
  const area = contentArea(format, orientation);
  const fit = Math.min(area.w / Math.max(rawW, 1), area.h / Math.max(rawH, 1));
  if (fit >= 1) return { k: 1, label: '1:1' };
  const k = STD.find((s) => s <= fit) ?? STD[STD.length - 1];
  return { k, label: scaleLabel(k) };
}
