/**
 * CuttingValidator — проверка результата раскроя: детали в рабочей области,
 * не пересекаются, поворот допустим. Гарантирует, что карта соответствует
 * реальному математическому результату (а не «красивой картинке»).
 */
import type { CuttingInput } from './types';
import type { CuttingSheetResult, Placement } from '@/core/model/types';

export interface CuttingIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

const EPS = 1e-3;

function rectsOverlap(a: Placement, b: Placement, kerf: number): boolean {
  // Между деталями допускается зазор пропила; пересечением считаем реальное
  // перекрытие тел деталей.
  return (
    a.x < b.x + b.length - EPS &&
    a.x + a.length > b.x + EPS &&
    a.y < b.y + b.width - EPS &&
    a.y + a.width > b.y + EPS &&
    kerf >= 0
  );
}

export function validateSheet(sheet: CuttingSheetResult, input: CuttingInput): CuttingIssue[] {
  const issues: CuttingIssue[] = [];
  const usable = {
    x: input.trim.left,
    y: input.trim.bottom,
    w: input.sheet.length - input.trim.left - input.trim.right,
    h: input.sheet.width - input.trim.top - input.trim.bottom,
  };

  for (const p of sheet.placements) {
    if (
      p.x < usable.x - EPS ||
      p.y < usable.y - EPS ||
      p.x + p.length > usable.x + usable.w + EPS ||
      p.y + p.width > usable.y + usable.h + EPS
    ) {
      issues.push({
        severity: 'error',
        code: 'cutting.outOfSheet',
        message: `Деталь ${p.number} выходит за рабочую область листа ${sheet.index + 1}.`,
      });
    }
    if (p.rotation !== 0 && p.rotation !== 90) {
      issues.push({ severity: 'error', code: 'cutting.badRotation', message: `Недопустимый поворот детали ${p.number}.` });
    }
  }

  const ps = sheet.placements;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      if (rectsOverlap(ps[i], ps[j], input.kerf)) {
        issues.push({
          severity: 'error',
          code: 'cutting.overlap',
          message: `Детали ${ps[i].number} и ${ps[j].number} пересекаются на листе ${sheet.index + 1}.`,
        });
      }
    }
  }
  return issues;
}

export function validateResult(sheets: CuttingSheetResult[], input: CuttingInput): CuttingIssue[] {
  return sheets.flatMap((s) => validateSheet(s, input));
}
