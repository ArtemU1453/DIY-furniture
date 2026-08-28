/**
 * Штрихкод детали (§110/§112) — локальный Code 39.
 *
 * Code 39 выбран потому, что кодируется таблицей без внешних библиотек и
 * читается любым цеховым сканером. Всё считается на месте: ни одна строка не
 * уходит на внешний сервис (§112).
 */

/** Узкий/широкий элемент: 1 — узкий, 2 — широкий; чередование бар/пробел. */
const PATTERNS: Record<string, string> = {
  '0': '111221211', '1': '211211112', '2': '112211112', '3': '212211111',
  '4': '111221112', '5': '211221111', '6': '112221111', '7': '111211212',
  '8': '211211211', '9': '112211211', 'A': '211112112', 'B': '112112112',
  'C': '212112111', 'D': '111122112', 'E': '211122111', 'F': '112122111',
  'G': '111112212', 'H': '211112211', 'I': '112112211', 'J': '111122211',
  'K': '211111122', 'L': '112111122', 'M': '212111121', 'N': '111121122',
  'O': '211121121', 'P': '112121121', 'Q': '111111222', 'R': '211111221',
  'S': '112111221', 'T': '111121221', 'U': '221111112', 'V': '122111112',
  'W': '222111111', 'X': '121121112', 'Y': '221121111', 'Z': '122121111',
  '-': '121111212', '.': '221111211', ' ': '122111211', '$': '121212111',
  '/': '121211121', '+': '121112121', '%': '111212121', '*': '121121211',
};

/** Символы, которые Code 39 умеет кодировать. */
export function isBarcodeChar(ch: string): boolean {
  return ch !== '*' && Object.prototype.hasOwnProperty.call(PATTERNS, ch);
}

/**
 * Привести текст к алфавиту Code 39: верхний регистр, неподдерживаемые
 * символы — в дефис. Так номер детали P-001 кодируется как есть.
 */
export function toBarcodeText(text: string): string {
  return [...text.toUpperCase()].map((ch) => (isBarcodeChar(ch) ? ch : '-')).join('');
}

/** Один элемент штрихкода. */
export interface BarcodeBar {
  /** true — чёрная полоса, false — пробел. */
  bar: boolean;
  /** Ширина в узких модулях: 1 или 2. */
  units: 1 | 2;
}

/**
 * Элементы штрихкода Code 39 со старт/стоп-символом «*» и узкими
 * межсимвольными пробелами.
 */
export function barcodeBars(text: string): BarcodeBar[] {
  const chars = ['*', ...toBarcodeText(text), '*'];
  const out: BarcodeBar[] = [];
  chars.forEach((ch, index) => {
    const pattern = PATTERNS[ch] ?? PATTERNS['-'];
    for (let i = 0; i < pattern.length; i++) {
      out.push({ bar: i % 2 === 0, units: pattern[i] === '2' ? 2 : 1 });
    }
    if (index < chars.length - 1) out.push({ bar: false, units: 1 });
  });
  return out;
}

/** Ширина штрихкода в узких модулях. */
export function barcodeWidth(text: string): number {
  return barcodeBars(text).reduce((sum, b) => sum + b.units, 0);
}

/** SVG штрихкода: ширина в мм задаётся вызывающим кодом. */
export function barcodeSvg(text: string, width = 60, height = 12): string {
  const bars = barcodeBars(text);
  const total = bars.reduce((sum, b) => sum + b.units, 0);
  const unit = total > 0 ? width / total : 0;
  let x = 0;
  const rects: string[] = [];
  for (const b of bars) {
    const w = b.units * unit;
    if (b.bar) rects.push(`<rect x="${x.toFixed(3)}" y="0" width="${w.toFixed(3)}" height="${height}" />`);
    x += w;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="#111"><rect width="${width}" height="${height}" fill="#fff"/>${rects.join('')}</svg>`;
}
