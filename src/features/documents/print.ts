/**
 * Экспорт и печать документов. PDF формируется локально через векторную печать
 * браузера (Сохранить как PDF) — без платных API и без растрирования: печатается
 * настоящий SVG. SVG-файл экспортируется напрямую.
 */

function triggerDownload(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const sanitize = (s: string) => s.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'document';

/** Скачать одну страницу как SVG-файл. */
export function downloadSvg(title: string, svg: string): void {
  triggerDownload(`${sanitize(title)}.svg`, svg, 'image/svg+xml');
}

/** Объединить страницы в один SVG (страницы по вертикали) и скачать. */
export function downloadSvgPages(title: string, pages: string[]): void {
  if (pages.length === 1) return downloadSvg(title, pages[0]);
  const gap = 20;
  let offset = 0;
  const groups: string[] = [];
  for (const p of pages) {
    const hm = p.match(/height="([\d.]+)mm"/);
    const wm = p.match(/width="([\d.]+)mm"/);
    const h = hm ? Number(hm[1]) : 210;
    const w = wm ? Number(wm[1]) : 297;
    const inner = p.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const vb = p.match(/viewBox="([^"]+)"/)?.[1] ?? `0 0 ${w} ${h}`;
    groups.push(`<g transform="translate(0, ${offset})"><svg width="${w}mm" height="${h}mm" viewBox="${vb}">${inner}</svg></g>`);
    offset += h + gap;
  }
  const combined = `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="${offset}mm"><rect width="100%" height="100%" fill="#e6e7e9"/>${groups.join('')}</svg>`;
  triggerDownload(`${sanitize(title)}.svg`, combined, 'image/svg+xml');
}

/**
 * Печать / экспорт в PDF: открывает окно печати с векторными SVG-страницами.
 * Пользователь выбирает принтер или «Сохранить как PDF». Возвращает false, если
 * окно заблокировано браузером.
 */
export function printPages(title: string, pages: string[]): boolean {
  const win = window.open('', '_blank', 'width=1100,height=850');
  if (!win) return false;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
      @page { margin: 6mm; }
      html, body { margin: 0; padding: 0; background: #fff; }
      .page { page-break-after: always; text-align: center; }
      .page:last-child { page-break-after: auto; }
      svg { max-width: 100%; height: auto; }
    </style></head><body>
    ${pages.map((p) => `<div class="page">${p}</div>`).join('')}
    <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
    </body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
