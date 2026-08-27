/**
 * CuttingValidator (§128/§129) — проверка результата раскроя.
 *
 * Проверяются: выход за рабочую область, пересечения деталей, соблюдение
 * технологического зазора, материал и толщина детали, направление текстуры,
 * допустимость поворота, повторные размещения одного экземпляра и
 * неразмещённые детали. Гарантирует, что карта соответствует реальному
 * математическому результату, а не «красивой картинке».
 */
import type { CuttingInput, CuttingPieceInstance } from './types';
import type { CuttingResult, CuttingSheetResult, Placement, Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { spacingOf } from './profile';

export interface CuttingIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

const EPS = 1e-3;

function rectsOverlap(a: Placement, b: Placement): boolean {
  // Пересечением считается реальное перекрытие тел деталей.
  return (
    a.x < b.x + b.length - EPS &&
    a.x + a.length > b.x + EPS &&
    a.y < b.y + b.width - EPS &&
    a.y + a.width > b.y + EPS
  );
}

/** Расстояние между телами деталей по обеим осям (отрицательное — перекрытие). */
function gapBetween(a: Placement, b: Placement): number {
  const dx = Math.max(b.x - (a.x + a.length), a.x - (b.x + b.length));
  const dy = Math.max(b.y - (a.y + a.width), a.y - (b.y + b.width));
  return Math.max(dx, dy);
}

export function validateSheet(sheet: CuttingSheetResult, input: CuttingInput): CuttingIssue[] {
  const issues: CuttingIssue[] = [];
  /* Рабочая область берётся из самого листа: формат мог отличаться от
   * предпочтительного (§23), а у листа из остатка обрезки нет вовсе. */
  const area = sheet.fromRemnant
    ? { x: 0, y: 0, w: sheet.length, h: sheet.width }
    : {
        x: sheet.trim.left,
        y: sheet.trim.bottom,
        w: sheet.length - sheet.trim.left - sheet.trim.right,
        h: sheet.width - sheet.trim.top - sheet.trim.bottom,
      };

  const byPiece = new Map<string, CuttingPieceInstance>(input.pieces.map((p) => [p.pieceId, p]));
  const spacing = spacingOf({ kerf: input.kerf, minGap: input.minGap });
  const seen = new Set<string>();

  for (const p of sheet.placements) {
    // §36/§139: деталь целиком внутри рабочей области.
    if (
      p.x < area.x - EPS ||
      p.y < area.y - EPS ||
      p.x + p.length > area.x + area.w + EPS ||
      p.y + p.width > area.y + area.h + EPS
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

    // §129: повторное размещение одного экземпляра.
    if (seen.has(p.pieceId)) {
      issues.push({
        severity: 'error',
        code: 'cutting.duplicatePlacement',
        message: `Экземпляр ${p.number} размещён более одного раза.`,
      });
    }
    seen.add(p.pieceId);

    const piece = byPiece.get(p.pieceId);
    if (!piece) continue;

    // §129: материал детали должен совпадать с материалом карты.
    if (String(piece.materialId) !== String(sheet.materialId)) {
      issues.push({
        severity: 'error',
        code: 'cutting.materialMismatch',
        message: `Деталь ${p.number} из другого материала попала на лист ${sheet.index + 1}.`,
      });
    }

    // §34/§136: поворот запрещён — деталь не должна быть повёрнута.
    const rotateAllowed = piece.allowRotate && !(input.options.respectGrain && piece.grain !== 'none');
    if (p.rotation === 90 && !rotateAllowed) {
      issues.push({
        severity: 'error',
        code: 'cutting.rotationForbidden',
        message: `Деталь ${p.number} повёрнута, хотя поворот запрещён (текстура или материал).`,
      });
    }

    // §35: размер размещения должен соответствовать детали в её ориентации.
    const expected = p.rotation === 90
      ? { l: piece.width, w: piece.length }
      : { l: piece.length, w: piece.width };
    if (Math.abs(p.length - expected.l) > EPS || Math.abs(p.width - expected.w) > EPS) {
      issues.push({
        severity: 'error',
        code: 'cutting.sizeMismatch',
        message: `Размер детали ${p.number} на карте не совпадает с деталью проекта.`,
      });
    }
  }

  // §37/§39/§138: пересечения и нарушение технологического зазора.
  const ps = sheet.placements;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      if (rectsOverlap(ps[i], ps[j])) {
        issues.push({
          severity: 'error',
          code: 'cutting.overlap',
          message: `Детали ${ps[i].number} и ${ps[j].number} пересекаются на листе ${sheet.index + 1}.`,
        });
      } else if (spacing > 0 && gapBetween(ps[i], ps[j]) < spacing - EPS) {
        issues.push({
          severity: 'warning',
          code: 'cutting.gapTooSmall',
          message: `Между деталями ${ps[i].number} и ${ps[j].number} меньше ${spacing} мм (пропил и зазор).`,
        });
      }
    }
  }
  return issues;
}

export function validateResult(sheets: CuttingSheetResult[], input: CuttingInput): CuttingIssue[] {
  return sheets.flatMap((s) => validateSheet(s, input));
}

/**
 * Проверка карты раскроя относительно проекта (§129/§130): толщина деталей,
 * полнота размещения. Дополняет геометрические проверки листа.
 */
export function validatePlan(project: Project, plan: CuttingResult): CuttingIssue[] {
  const issues: CuttingIssue[] = [];
  const material = project.materials.find((m) => m.id === plan.materialId);
  const parts = new Map(allParts(project).map((p) => [String(p.id), p]));

  for (const sheet of plan.sheets) {
    for (const pl of sheet.placements) {
      const part = parts.get(String(pl.partId));
      if (!part) {
        issues.push({
          severity: 'error',
          code: 'cutting.unknownPart',
          message: `Деталь ${pl.number} на карте отсутствует в проекте.`,
        });
        continue;
      }
      if (material && Math.abs(part.thickness - material.thickness) > EPS) {
        issues.push({
          severity: 'error',
          code: 'cutting.thicknessMismatch',
          message: `Толщина детали ${pl.number} (${part.thickness} мм) не совпадает с материалом карты (${material.thickness} мм).`,
        });
      }
    }
  }

  // §130: хотя бы одна неразмещённая деталь — карта не полностью корректна.
  if (plan.unplaced.length > 0) {
    issues.push({
      severity: 'error',
      code: 'cutting.unplaced',
      message: `Не размещено деталей: ${plan.unplaced.length}. Раскрой неполный.`,
    });
  }
  return issues;
}
