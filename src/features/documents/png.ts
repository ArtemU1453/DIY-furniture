/**
 * PNG-экспорт страницы чертежа (§41).
 *
 * Растрируется ОТРЕНДЕРЕННЫЙ Drawing: тот же SVG, что идёт в файл и на печать,
 * загружается в <img> и рисуется на canvas. Это не скриншот экрана — источник
 * тот же вектор, поэтому PNG можно отдать в любом разрешении через scale.
 * Всё происходит локально в браузере, без внешних сервисов.
 */

export interface PngOptions {
  /** Множитель разрешения: 2 — вдвое больше пикселей на мм. */
  scale?: number;
  /** Фон подложки; по умолчанию белый (иначе прозрачный). */
  background?: string | null;
}

/** Размеры листа из атрибутов SVG (мм). */
export function svgSizeMm(svg: string): { w: number; h: number } {
  const w = Number(svg.match(/width="([\d.]+)mm"/)?.[1] ?? 297);
  const h = Number(svg.match(/height="([\d.]+)mm"/)?.[1] ?? 210);
  return { w, h };
}

/** SVG-строка → PNG Blob. Отклоняется, если SVG не удалось загрузить. */
export function svgToPngBlob(svg: string, opts: PngOptions = {}): Promise<Blob> {
  const scale = opts.scale ?? 2;
  const background = opts.background === undefined ? '#ffffff' : opts.background;
  const { w, h } = svgSizeMm(svg);
  // 1 мм ≈ 3.7795 px при 96 dpi.
  const pxW = Math.max(1, Math.round(w * 3.7795 * scale));
  const pxH = Math.max(1, Math.round(h * 3.7795 * scale));

  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = pxW;
        canvas.height = pxH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D недоступен.');
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, pxW, pxH);
        }
        ctx.drawImage(img, 0, 0, pxW, pxH);
        canvas.toBlob((out) => {
          URL.revokeObjectURL(url);
          if (out) resolve(out);
          else reject(new Error('Не удалось получить PNG из canvas.'));
        }, 'image/png');
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось загрузить SVG для растрирования.'));
    };
    img.src = url;
  });
}

/** Скачать страницу как PNG-файл. */
export async function downloadPng(fileName: string, svg: string, opts: PngOptions = {}): Promise<void> {
  const blob = await svgToPngBlob(svg, opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
