/**
 * Экспорт карты раскроя в SVG и CSV. Экспорт — визуализация реального
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

  // Лист и технологическая рамка.
  parts.push(`<rect x="0" y="0" width="${L}" height="${W}" fill="#141518" stroke="#5a6472" stroke-width="2"/>`);
  parts.push(
    `<rect x="${trim.left}" y="${trim.top}" width="${L - trim.left - trim.right}" height="${W - trim.top - trim.bottom}" fill="none" stroke="#3a3d43" stroke-dasharray="8 6" stroke-width="1"/>`,
  );

  for (const p of sheet.placements) {
    const y = flipY(p.y, p.width);
    parts.push(
      `<g><rect x="${p.x}" y="${y}" width="${p.length}" height="${p.width}" fill="${p.origin === 'manual' ? '#4a3b2a' : '#2f3a4a'}" stroke="#7f8ea3" stroke-width="1"/>` +
        // направление текстуры (линия вдоль длины детали)
        `<line x1="${p.x + p.length / 2}" y1="${y + 6}" x2="${p.x + p.length / 2}" y2="${y + p.width - 6}" stroke="#556" stroke-width="1"/>` +
        `<text x="${p.x + p.length / 2}" y="${y + p.width / 2}" fill="#e6e7e9" font-size="${Math.min(p.length, p.width) * 0.25}" text-anchor="middle" dominant-baseline="middle">${esc(p.number)}</text>` +
        `<text x="${p.x + p.length / 2}" y="${y + p.width / 2 + Math.min(p.length, p.width) * 0.28}" fill="#9aa0a6" font-size="${Math.min(p.length, p.width) * 0.12}" text-anchor="middle" dominant-baseline="middle">${Math.round(p.length)}×${Math.round(p.width)}${p.rotation ? ' ↻' : ''}</text></g>`,
    );
  }

  // Остатки.
  for (const r of sheet.remnants) {
    const y = flipY(r.y, r.height);
    parts.push(
      `<rect x="${r.x}" y="${y}" width="${r.width}" height="${r.height}" fill="none" stroke="#4caf7d" stroke-dasharray="4 4" stroke-width="1"/>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -40 ${L + 40} ${W + 80}" width="${L}" height="${W + 60}">` +
    `<text x="0" y="-12" fill="#e6e7e9" font-size="40">${esc(materialName)} — лист ${sheet.index + 1} (${Math.round(sheet.utilization * 100)}%)</text>` +
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

/** CSV карты раскроя по всем материалам. */
export function reportToCsv(report: CuttingReport): string {
  const header = ['Лист', 'Материал', '№ детали', 'Наименование', 'Количество', 'X', 'Y', 'Длина', 'Ширина', 'Поворот'];
  const rows: string[][] = [];
  for (const job of report.jobs) {
    for (const sheet of job.sheets) {
      for (const p of sheet.placements) {
        rows.push([
          String(sheet.index + 1),
          job.statistics.materialName,
          p.number,
          p.name,
          '1',
          String(Math.round(p.x)),
          String(Math.round(p.y)),
          String(Math.round(p.length)),
          String(Math.round(p.width)),
          `${p.rotation}`,
        ]);
      }
    }
  }
  const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n');
}
