/**
 * Производственные имена операций присадки (§10) и их проверка (§59, §62).
 *
 * Технический MachiningType остаётся полем модели; OperationKind — то, что
 * видит пользователь и что уходит в CSV и на чертёж. Соответствие однозначно,
 * второй модели операций не заводится.
 */
import type {
  MachiningOperation,
  MachiningType,
  OperationKind,
  Part,
} from '@/core/model/types';

const TYPE_TO_KIND: Record<MachiningType, OperationKind> = {
  drilling: 'DRILL',
  dowel: 'DRILL',
  confirmat: 'DRILL',
  boring: 'BORE',
  hinge: 'BORE',
  countersink: 'COUNTERSINK',
  pocket: 'POCKET',
  slot: 'POCKET',
  cut: 'CUT',
  groove: 'POCKET',
  cutout: 'CUT',
  mill: 'POCKET',
  custom: 'CUSTOM',
};

const KIND_TO_TYPE: Record<OperationKind, MachiningType> = {
  DRILL: 'drilling',
  BORE: 'boring',
  COUNTERSINK: 'countersink',
  POCKET: 'pocket',
  CUT: 'cut',
  CUSTOM: 'custom',
};

export const OPERATION_KINDS: OperationKind[] =
  ['DRILL', 'BORE', 'COUNTERSINK', 'POCKET', 'CUT', 'CUSTOM'];

export const OPERATION_KIND_LABELS: Record<OperationKind, string> = {
  DRILL: 'Сверление',
  BORE: 'Присадка',
  COUNTERSINK: 'Зенковка',
  POCKET: 'Выборка',
  CUT: 'Рез',
  CUSTOM: 'Другое',
};

export function operationKind(op: Pick<MachiningOperation, 'type'>): OperationKind {
  return TYPE_TO_KIND[op.type] ?? 'CUSTOM';
}

export function machiningTypeOfKind(kind: OperationKind): MachiningType {
  return KIND_TO_TYPE[kind] ?? 'custom';
}

// ── Проверка одной операции (§59, §62, §87, §88) ─────────────────────────────

export interface OperationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  operationId?: string;
}

/**
 * Толщина детали вдоль оси сверления: для пласти это толщина плиты, для
 * торца — соответствующий габарит.
 */
export function depthLimitForFace(part: Part, face: MachiningOperation['face']): number {
  switch (face) {
    case 'front': case 'back': return part.thickness;
    case 'left': case 'right': return part.width;
    case 'top': case 'bottom': return part.height;
  }
}

/**
 * Проверить параметры операции: диаметр и глубина положительны и конечны,
 * глухое отверстие не глубже материала (§59), сквозное трактуется как
 * проходное (§87) и глубину не ограничивает.
 */
export function validateOperation(op: MachiningOperation, part: Part): OperationIssue[] {
  const issues: OperationIssue[] = [];
  const id = String(op.id);
  const label = (op.metadata?.number as string) ?? id;

  // §62: диаметр > 0, без NaN и Infinity.
  if (op.diameter != null && (!Number.isFinite(op.diameter) || op.diameter <= 0)) {
    issues.push({
      severity: 'error', code: 'op.badDiameter', operationId: id,
      message: `Операция ${label}: диаметр должен быть больше 0 (получено ${String(op.diameter)}).`,
    });
  }

  if (op.through) {
    // §87: сквозное отверстие проходит деталь насквозь, отдельная глубина
    // его не ограничивает.
    return issues;
  }

  // §62/§88: глубина глухого отверстия > 0.
  if (op.depth == null || !Number.isFinite(op.depth) || op.depth <= 0) {
    issues.push({
      severity: 'error', code: 'op.badDepth', operationId: id,
      message: `Операция ${label}: глубина глухого отверстия должна быть больше 0 (получено ${String(op.depth)}).`,
    });
    return issues;
  }

  // §59: глухое отверстие не может быть глубже материала.
  const limit = depthLimitForFace(part, op.face);
  if (op.depth > limit + 1e-6) {
    issues.push({
      severity: 'error', code: 'op.depthExceedsPart', operationId: id,
      message: `Операция ${label}: глубина ${op.depth} мм больше толщины детали по оси сверления (${Math.round(limit)} мм). Сделайте отверстие сквозным.`,
    });
  }
  return issues;
}

/**
 * Пересечение отверстий на одной грани (§61): предупреждение, если окружности
 * физически перекрываются.
 */
export function findIntersections(operations: MachiningOperation[]): OperationIssue[] {
  const issues: OperationIssue[] = [];
  for (let i = 0; i < operations.length; i++) {
    for (let j = i + 1; j < operations.length; j++) {
      const a = operations[i];
      const b = operations[j];
      if (a.partId !== b.partId || a.face !== b.face) continue;
      const ra = (a.diameter ?? 0) / 2;
      const rb = (b.diameter ?? 0) / 2;
      if (ra <= 0 || rb <= 0) continue;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance < ra + rb) {
        const la = (a.metadata?.number as string) ?? String(a.id);
        const lb = (b.metadata?.number as string) ?? String(b.id);
        issues.push({
          severity: 'warning', code: 'op.intersect', operationId: String(a.id),
          message: `Отверстия ${la} и ${lb} пересекаются (расстояние ${distance.toFixed(1)} мм при радиусах ${ra} и ${rb}).`,
        });
      }
    }
  }
  return issues;
}
