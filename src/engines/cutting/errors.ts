/**
 * Панель ошибок раскроя (§124–§129).
 *
 * Ошибка — не строка в консоли: у неё есть деталь, причина, лист и координаты,
 * иначе оператор не поймёт, что чинить. Сообщения на русском и без внутренних
 * подробностей реализации.
 */
import type {
  CuttingResult,
  CuttingSheetResult,
  Material,
  Part,
  Project,
} from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { checkManualPlacement } from './manual';

export type CuttingErrorCode =
  | 'NO_FIT' | 'GRAIN' | 'MATERIAL' | 'THICKNESS' | 'OVERLAP' | 'BOUNDS' | 'DUPLICATE';

export interface CuttingErrorItem {
  code: CuttingErrorCode;
  severity: 'error' | 'warning';
  /** Деталь, к которой относится ошибка. */
  partId?: string;
  partName: string;
  /** Лист, на котором обнаружена ошибка; пусто — деталь не размещена. */
  sheetId?: string;
  /** Координаты на листе, мм. */
  x?: number;
  y?: number;
  message: string;
}

const size = (w: number, h: number): string => `${Math.round(w)} × ${Math.round(h)}`;

/** «Деталь 1200 × 800 не помещается на выбранный лист.» (§125) */
export function noFitMessage(width: number, height: number): string {
  return `Деталь ${size(width, height)} не помещается на выбранный лист.`;
}

/** Ошибки неразмещённых деталей (§124/§125). */
export function unplacedErrors(result: CuttingResult): CuttingErrorItem[] {
  return result.unplaced.map((piece) => ({
    code: 'NO_FIT' as const,
    severity: 'error' as const,
    partId: String(piece.partId),
    partName: piece.name,
    message: piece.reason ?? noFitMessage(piece.length, piece.width),
  }));
}

/** Пересечения и выходы за лист в готовом результате (§129/§32/§33). */
export function placementErrors(sheet: CuttingSheetResult, kerf: number): CuttingErrorItem[] {
  const out: CuttingErrorItem[] = [];
  for (const placement of sheet.placements) {
    const check = checkManualPlacement(sheet, {
      pieceId: placement.pieceId,
      x: placement.x,
      y: placement.y,
      rotation: placement.rotation,
      kerf,
    });
    for (const issue of check.issues) {
      if (issue.code === 'rotation' || issue.code === 'locked') continue;
      out.push({
        code: issue.code === 'bounds' || issue.code === 'trim' ? 'BOUNDS' : 'OVERLAP',
        severity: 'error',
        partId: String(placement.partId),
        partName: placement.name,
        sheetId: sheet.id,
        x: placement.x,
        y: placement.y,
        message: issue.message,
      });
    }
  }
  return out;
}

/**
 * Несоответствия материала, толщины и текстуры (§126–§128).
 *
 * Проверяется деталь проекта против материала задания: раскрой обязан резать
 * то же, что описано в модели.
 */
export function consistencyErrors(project: Project, result: CuttingResult): CuttingErrorItem[] {
  const material: Material | undefined = project.materials
    .find((m) => String(m.id) === String(result.materialId));

  const parts = new Map<string, Part>(allParts(project).map((p) => [String(p.id), p]));
  const out: CuttingErrorItem[] = [];

  for (const sheet of result.sheets) {
    for (const placement of sheet.placements) {
      const part = parts.get(String(placement.partId));
      if (!part) continue;

      if (String(part.material ?? '') !== String(result.materialId)) {
        out.push({
          code: 'MATERIAL', severity: 'error',
          partId: String(part.id), partName: part.name, sheetId: sheet.id,
          x: placement.x, y: placement.y,
          message: `Материал детали «${part.name}» не совпадает с материалом раскроя.`,
        });
      }
      if (material && Math.abs(part.thickness - material.thickness) > 1e-6) {
        out.push({
          code: 'THICKNESS', severity: 'error',
          partId: String(part.id), partName: part.name, sheetId: sheet.id,
          x: placement.x, y: placement.y,
          message: `Толщина детали «${part.name}» (${part.thickness} мм) не совпадает `
            + `с толщиной материала (${material.thickness} мм).`,
        });
      }
      // Поворот на 90° при заданной текстуре запрещён (§126).
      if (placement.rotation === 90 && part.grain !== 'none' && part.grain !== undefined) {
        out.push({
          code: 'GRAIN', severity: 'error',
          partId: String(part.id), partName: part.name, sheetId: sheet.id,
          x: placement.x, y: placement.y,
          message: `Деталь «${part.name}» повёрнута на 90°, но её текстура этого не допускает.`,
        });
      }
    }
  }
  return out;
}

/** Полный список ошибок результата (§124). */
export function cuttingErrors(project: Project, result: CuttingResult): CuttingErrorItem[] {
  /* Пропил берётся из снимка результата: именно с ним раскрой считался.
   * Если снимка нет — из настроек проекта, иначе из материала. */
  const material = project.materials.find((m) => String(m.id) === String(result.materialId));
  const kerf = result.settingsSnapshot?.kerf
    ?? project.cutting.settings.kerfOverride
    ?? material?.kerf
    ?? 3.2;
  return [
    ...unplacedErrors(result),
    ...result.sheets.flatMap((sheet) => placementErrors(sheet, kerf)),
    ...consistencyErrors(project, result),
  ];
}

/** Ошибки всего проекта — то, что показывает панель (§124). */
export function projectCuttingErrors(project: Project): CuttingErrorItem[] {
  return (project.cutting.report?.jobs ?? []).flatMap((result) => cuttingErrors(project, result));
}

export interface CuttingErrorSummary {
  errors: number;
  warnings: number;
  byCode: Record<string, number>;
}

export function summarizeErrors(items: CuttingErrorItem[]): CuttingErrorSummary {
  const byCode: Record<string, number> = {};
  for (const item of items) byCode[item.code] = (byCode[item.code] ?? 0) + 1;
  return {
    errors: items.filter((i) => i.severity === 'error').length,
    warnings: items.filter((i) => i.severity === 'warning').length,
    byCode,
  };
}
