/**
 * Ручное размещение деталей на листе (§74–§83).
 *
 * Ручная правка не отменяет расчёт: она записывается как LockedPlacement —
 * фиксированное положение, которое алгоритм обязан сохранить при следующем
 * пересчёте (§83). Поэтому «подвинул руками» и «пересчитал» не конфликтуют.
 *
 * Ни одно недопустимое положение не сохраняется (§78): проверка границ,
 * пересечений, пропила и обрезки идёт ДО записи.
 */
import type {
  CuttingSheetResult,
  LockedPlacement,
  Placement,
  PieceRotation,
  TrimSettings,
} from '@/core/model/types';

export interface ManualPlacementIssue {
  code: 'bounds' | 'overlap' | 'kerf' | 'trim' | 'rotation' | 'locked';
  message: string;
  /** Деталь, с которой конфликт (для overlap). */
  otherPieceId?: string;
}

export interface ManualPlacementCheck {
  ok: boolean;
  issues: ManualPlacementIssue[];
}

export interface ManualPlacementRequest {
  pieceId: string;
  x: number;
  y: number;
  rotation: PieceRotation;
  /** Ширина пропила, мм: между деталями должен остаться хотя бы он (§34). */
  kerf: number;
  /** Разрешён ли поворот этой детали (§18/§75). */
  rotationAllowed?: boolean;
}

/** Габарит детали в заданном повороте (§17). */
export function orientedSize(
  placement: Placement,
  rotation: PieceRotation,
): { length: number; width: number } {
  const swapped = rotation !== placement.rotation && (rotation === 90 || placement.rotation === 90);
  return swapped
    ? { length: placement.width, width: placement.length }
    : { length: placement.length, width: placement.width };
}

/** Рабочая область листа: физический лист минус обрезка (§22/§36). */
export function usableRect(sheet: { length: number; width: number; trim: TrimSettings }): {
  x0: number; y0: number; x1: number; y1: number;
} {
  return {
    x0: sheet.trim.left,
    y0: sheet.trim.bottom,
    x1: sheet.length - sheet.trim.right,
    y1: sheet.width - sheet.trim.top,
  };
}

const EPS = 1e-6;

/**
 * Проверить ручное положение (§77).
 *
 * Пропил учитывается как обязательный зазор: детали, стоящие вплотную, при
 * распиле «съедят» друг друга на ширину диска.
 */
export function checkManualPlacement(
  sheet: CuttingSheetResult,
  request: ManualPlacementRequest,
): ManualPlacementCheck {
  const issues: ManualPlacementIssue[] = [];
  const target = sheet.placements.find((p) => p.pieceId === request.pieceId);
  if (!target) {
    return { ok: false, issues: [{ code: 'bounds', message: 'Деталь не найдена на этом листе.' }] };
  }
  if (request.rotation !== target.rotation && request.rotationAllowed === false) {
    issues.push({
      code: 'rotation',
      message: `Поворот детали «${target.name}» запрещён направлением текстуры.`,
    });
  }

  const size = orientedSize(target, request.rotation);
  const area = usableRect(sheet);

  // Границы рабочей области (§32/§35).
  if (request.x < area.x0 - EPS || request.y < area.y0 - EPS
    || request.x + size.length > area.x1 + EPS || request.y + size.width > area.y1 + EPS) {
    issues.push({
      code: 'bounds',
      message: `Деталь «${target.name}» выходит за рабочую область листа `
        + `(${Math.round(area.x1 - area.x0)} × ${Math.round(area.y1 - area.y0)} мм).`,
    });
  }
  if (request.x < sheet.trim.left - EPS || request.y < sheet.trim.bottom - EPS) {
    issues.push({ code: 'trim', message: 'Деталь попадает в зону обрезки листа.' });
  }

  // Пересечения с учётом пропила (§33/§34).
  const gap = Math.max(0, request.kerf);
  for (const other of sheet.placements) {
    if (other.pieceId === request.pieceId) continue;
    const overlapX = request.x < other.x + other.length + gap - EPS
      && request.x + size.length + gap > other.x + EPS;
    const overlapY = request.y < other.y + other.width + gap - EPS
      && request.y + size.width + gap > other.y + EPS;
    if (overlapX && overlapY) {
      const touching = request.x < other.x + other.length - EPS
        && request.x + size.length > other.x + EPS
        && request.y < other.y + other.width - EPS
        && request.y + size.width > other.y + EPS;
      issues.push({
        code: touching ? 'overlap' : 'kerf',
        message: touching
          ? `Деталь «${target.name}» пересекается с «${other.name}».`
          : `Между «${target.name}» и «${other.name}» не хватает пропила ${gap} мм.`,
        otherPieceId: other.pieceId,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

export interface ManualPlacementOutcome {
  ok: boolean;
  /** Новая фиксация положения; при отказе — undefined (§78). */
  locked?: LockedPlacement;
  /** Обновлённый лист для предпросмотра. */
  sheet?: CuttingSheetResult;
  issues: ManualPlacementIssue[];
}

/**
 * Применить ручное перемещение или поворот (§74–§76).
 *
 * Возвращает фиксацию и обновлённый лист; записывает их вызывающий код одной
 * командой, поэтому правка целиком попадает в undo.
 */
export function applyManualPlacement(
  sheet: CuttingSheetResult,
  request: ManualPlacementRequest,
): ManualPlacementOutcome {
  const check = checkManualPlacement(sheet, request);
  if (!check.ok) return { ok: false, issues: check.issues };

  const target = sheet.placements.find((p) => p.pieceId === request.pieceId)!;
  const size = orientedSize(target, request.rotation);
  const placements = sheet.placements.map((p) => (p.pieceId === request.pieceId
    ? {
        ...p,
        x: request.x,
        y: request.y,
        rotation: request.rotation,
        length: size.length,
        width: size.width,
        origin: 'manual' as const,
        locked: true,
      }
    : p));

  return {
    ok: true,
    locked: {
      pieceId: request.pieceId,
      sheetIndex: sheet.index,
      x: request.x,
      y: request.y,
      rotation: request.rotation,
    },
    sheet: { ...sheet, placements },
    issues: [],
  };
}

// ── Фиксация (§79/§80/§83) ───────────────────────────────────────────────────

/** Зафиксировать деталь на её текущем месте (§79). */
export function lockPlacement(sheet: CuttingSheetResult, pieceId: string): LockedPlacement | null {
  const placement = sheet.placements.find((p) => p.pieceId === pieceId);
  if (!placement) return null;
  return {
    pieceId,
    sheetIndex: sheet.index,
    x: placement.x,
    y: placement.y,
    rotation: placement.rotation,
  };
}

/** Зафиксировать весь лист целиком (§80). */
export function lockSheet(sheet: CuttingSheetResult): LockedPlacement[] {
  return sheet.placements.map((p) => ({
    pieceId: p.pieceId,
    sheetIndex: sheet.index,
    x: p.x,
    y: p.y,
    rotation: p.rotation,
  }));
}

/** Снять фиксацию с перечисленных деталей. */
export function unlockPlacements(locked: LockedPlacement[], pieceIds: string[]): LockedPlacement[] {
  const drop = new Set(pieceIds);
  return locked.filter((l) => !drop.has(l.pieceId));
}

/** Заменить или добавить фиксацию, не плодя дублей. */
export function upsertPlacement(locked: LockedPlacement[], next: LockedPlacement): LockedPlacement[] {
  return [...locked.filter((l) => l.pieceId !== next.pieceId), next];
}

/** Зафиксирована ли деталь (§83). */
export function isFrozen(locked: LockedPlacement[], pieceId: string): boolean {
  return locked.some((l) => l.pieceId === pieceId);
}

/**
 * Что оставить зафиксированным при перерасчёте выбранной группы (§82).
 *
 * Пересчитываются только выбранные детали: всё остальное фиксируется на своих
 * местах, поэтому «пересчитать эти три детали» не перекладывает весь лист.
 */
export function freezeExcept(
  sheets: CuttingSheetResult[],
  reoptimizePieceIds: string[],
): LockedPlacement[] {
  const free = new Set(reoptimizePieceIds);
  return sheets.flatMap((sheet) => sheet.placements
    .filter((p) => !free.has(p.pieceId))
    .map((p) => ({
      pieceId: p.pieceId,
      sheetIndex: sheet.index,
      x: p.x,
      y: p.y,
      rotation: p.rotation,
    })));
}
