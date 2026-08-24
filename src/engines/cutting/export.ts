/**
 * Экспорт карты раскроя в SVG / CSV / JSON. Экспорт — визуализация реального
 * CuttingResult (координаты из движка), а не отдельно нарисованная картинка.
 */
import type { CuttingReport, CuttingResult, CuttingSheetResult } from '@/core/model/types';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SVG одного листа (координаты в мм; ось Y отражена — низ листа снизу). */
export function sheetToSvg(sheet: CuttingSheetResult, materialName: string): string {
  const { length: L, width: W, trim } = sheet;
  const flipY = (y: number, h: number) => W - (y + h);
  const parts: string[] = [];

  parts.push(`<rect x="0" y="0" width="${L}" height="${W}" fill="#141518" stroke="#5a6472" stroke-width="2"/>`);
  parts.push(
    `<rect x="${trim.left}" y="${trim.top}" width="${L - trim.left - trim.right}" height="${W - trim.top - trim.bottom}" fill="none" stroke="#3a3d43" stroke-dasharray="8 6" stroke-width="1"/>`,
  );

  // Линии реза.
  for (const c of sheet.cuts) {
    const y1 = c.orientation === 'horizontal' ? flipY(c.y1, 0) : flipY(c.y1, 0);
    const y2 = c.orientation === 'horizontal' ? flipY(c.y2, 0) : flipY(c.y2, 0);
    parts.push(`<line x1="${c.x1}" y1="${y1}" x2="${c.x2}" y2="${y2}" stroke="#39506e" stroke-width="0.6" stroke-dasharray="10 6"/>`);
  }

  for (const p of sheet.placements) {
    const y = flipY(p.y, p.width);
    const font = Math.min(p.length, p.width) * 0.25;
    parts.push(
      `<g><rect x="${p.x}" y="${y}" width="${p.length}" height="${p.width}" fill="${p.origin === 'manual' ? '#4a3b2a' : '#2f3a4a'}" stroke="#7f8ea3" stroke-width="1"/>` +
        `<line x1="${p.x + p.length / 2}" y1="${y + 6}" x2="${p.x + p.length / 2}" y2="${y + p.width - 6}" stroke="#556" stroke-width="1"/>` +
        `<text x="${p.x + p.length / 2}" y="${y + p.width / 2}" fill="#e6e7e9" font-size="${font}" text-anchor="middle" dominant-baseline="middle">${esc(p.number)}</text>` +
        `<text x="${p.x + p.length / 2}" y="${y + p.width / 2 + Math.min(p.length, p.width) * 0.28}" fill="#9aa0a6" font-size="${Math.min(p.length, p.width) * 0.12}" text-anchor="middle" dominant-baseline="middle">${Math.round(p.length)}×${Math.round(p.width)}${p.rotation ? ' ↻' : ''}</text></g>`,
    );
  }

  for (const r of sheet.remnants) {
    const y = flipY(r.y, r.height);
    const stroke = r.usable ? '#4caf7d' : '#6b6f76';
    parts.push(
      `<rect x="${r.x}" y="${y}" width="${r.width}" height="${r.height}" fill="none" stroke="${stroke}" stroke-dasharray="4 4" stroke-width="1"/>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -40 ${L + 40} ${W + 80}" width="${L}" height="${W + 60}">` +
    `<text x="0" y="-12" fill="#e6e7e9" font-size="40">${esc(materialName)} — лист ${sheet.index + 1}${sheet.fromRemnant ? ' (остаток)' : ''} (${Math.round(sheet.utilization * 100)}%)</text>` +
    parts.join('') +
    `</svg>`
  );
}

/** SVG всего отчёта (листы одного материала, вертикально). */
export function resultToSvg(result: CuttingResult): string {
  const gap = 120;
  let offset = 0;
  const groups: string[] = [];
  let maxL = 0;
  for (const sheet of result.sheets) {
    groups.push(`<g transform="translate(0, ${offset})">${stripSvg(sheetToSvg(sheet, result.statistics.materialName))}</g>`);
    offset += sheet.width + gap;
    maxL = Math.max(maxL, sheet.length);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -60 ${maxL + 80} ${offset + 60}" width="${maxL}" height="${offset}">${groups.join('')}</svg>`;
}

function stripSvg(svg: string): string {
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

/**
 * CSV карты раскроя по всем материалам. Каждая деталь связана со своим P-ID.
 * thicknessById — толщина по материалу (мм), опционально.
 */
export function reportToCsv(report: CuttingReport, thicknessById?: Record<string, number>): string {
  const header = [
    'Лист', 'P-ID', 'Наименование', 'Длина', 'Ширина', 'X', 'Y', 'Поворот', 'Материал', 'Толщина',
  ];
  const rows: string[][] = [];
  for (const job of report.jobs) {
    const th = thicknessById?.[job.materialId as string];
    for (const sheet of job.sheets) {
      for (const p of sheet.placements) {
        rows.push([
          `${sheet.index + 1}${sheet.fromRemnant ? ' (остаток)' : ''}`,
          p.number,
          p.name,
          String(Math.round(p.length)),
          String(Math.round(p.width)),
          String(Math.round(p.x)),
          String(Math.round(p.y)),
          `${p.rotation}`,
          job.statistics.materialName,
          th != null ? String(th) : '',
        ]);
      }
    }
  }
  const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n');
}

/** JSON-экспорт результата раскроя (полный сохранённый отчёт). */
export function reportToJson(report: CuttingReport): string {
  return JSON.stringify(report, null, 2);
}
