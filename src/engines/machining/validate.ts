/**
 * Валидация присадки на уровне бизнес-логики: глубина сверления, выход за
 * границы детали, пересечения/дубли отверстий. Ограничения берутся из
 * MachiningConstraints (не зашиты в UI).
 */
import type {
  MachiningConstraints,
  MachiningOperation,
  Part,
  Project,
} from '@/core/model/types';
import { faceInfo, partFrame } from '@/core/geometry/coordinateSystem';
import { findPart } from '@/core/model/selectors';

export type MachiningSeverity = 'error' | 'warning' | 'info';

export interface MachiningIssue {
  severity: MachiningSeverity;
  code: string;
  message: string;
  operationId?: string;
}

/** Доступная глубина материала вдоль оси сверления для грани. */
export function allowedDepth(part: Part, op: Pick<MachiningOperation, 'face'>): number {
  return faceInfo(partFrame(part), op.face).depthExtent;
}

/** Проверка глубины сверления одной операции. */
export function validateDrillingDepth(
  op: MachiningOperation,
  part: Part,
  constraints: MachiningConstraints,
): MachiningIssue[] {
  const issues: MachiningIssue[] = [];
  const label = op.metadata?.number ?? op.id;

  if (op.diameter !== undefined && op.diameter < constraints.minDiameter) {
    issues.push({
      severity: 'error',
      code: 'machining.minDiameter',
      message: `Операция ${label}: диаметр ${op.diameter} мм меньше минимального (${constraints.minDiameter} мм).`,
      operationId: op.id,
    });
  }

  const depthLimit = allowedDepth(part, op);
  if (op.through) {
    return issues; // сквозное — глубина = толщина по оси, отдельно не ограничиваем
  }
  const depth = op.depth ?? 0;
  if (!(depth > 0)) {
    issues.push({
      severity: 'error',
      code: 'machining.depthNonPositive',
      message: `Операция ${label}: глубина глухого отверстия должна быть больше 0.`,
      operationId: op.id,
    });
  } else if (depth > depthLimit * constraints.maxDepthRatio + 1e-6) {
    issues.push({
      severity: 'error',
      code: 'machining.depthExceeds',
      message: `Операция ${label}: глубина ${depth} мм превышает доступную (${Math.round(depthLimit)} мм).`,
      operationId: op.id,
    });
  }
  return issues;
}

/** Проверка выхода отверстия за границы грани детали. */
export function validateBounds(
  op: MachiningOperation,
  part: Part,
  constraints: MachiningConstraints,
): MachiningIssue[] {
  const issues: MachiningIssue[] = [];
  const fi = faceInfo(partFrame(part), op.face);
  const label = op.metadata?.number ?? op.id;
  const out = op.x < 0 || op.y < 0 || op.x > fi.uSize || op.y > fi.vSize;
  if (out) {
    issues.push({
      severity: 'error',
      code: 'machining.outOfBounds',
      message: `Операция ${label}: отверстие вне детали ${part.name}.`,
      operationId: op.id,
    });
    return issues;
  }
  const near = Math.min(op.x, op.y, fi.uSize - op.x, fi.vSize - op.y);
  if (near < constraints.minEdgeOffset) {
    issues.push({
      severity: 'warning',
      code: 'machining.nearEdge',
      message: `Операция ${label}: отверстие слишком близко к краю детали ${part.name}.`,
      operationId: op.id,
    });
  }
  return issues;
}

/** Проверка пересечений/дублей отверстий на одной грани детали. */
export function validateCollisions(
  ops: MachiningOperation[],
  constraints: MachiningConstraints,
): MachiningIssue[] {
  const issues: MachiningIssue[] = [];
  for (let i = 0; i < ops.length; i++) {
    for (let j = i + 1; j < ops.length; j++) {
      const a = ops[i];
      const b = ops[j];
      if (a.partId !== b.partId || a.face !== b.face) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const la = a.metadata?.number ?? a.id;
      const lb = b.metadata?.number ?? b.id;
      if (dist < 0.5) {
        issues.push({
          severity: 'warning',
          code: 'machining.duplicate',
          message: `Операции ${la} и ${lb} совпадают.`,
          operationId: a.id,
        });
      } else if (dist < constraints.minHoleSpacing) {
        issues.push({
          severity: 'warning',
          code: 'machining.tooClose',
          message: `Операции ${la} и ${lb} расположены слишком близко (${Math.round(dist)} мм).`,
          operationId: a.id,
        });
      }
    }
  }
  return issues;
}

/**
 * Минимально допустимый остаток материала от края отверстия до края детали.
 * Ниже этого значения кромка подрезается и деталь становится браком.
 */
export const MIN_MATERIAL_MARGIN = 2;

/** Полная валидация набора операций проекта. */
/**
 * Минимальное расстояние от края детали до КРАЯ отверстия (§34/§53).
 * Отверстие Ø20 с центром в 5 мм от края физически невозможно.
 */
export function validateEdgeDistance(
  op: MachiningOperation,
  part: Part,
  constraints: MachiningConstraints,
  profileMin?: number,
): MachiningIssue[] {
  if (op.diameter == null || op.diameter <= 0) return [];
  const minEdge = profileMin ?? constraints.minEdgeOffset;
  const fi = faceInfo(partFrame(part), op.face);
  const r = op.diameter / 2;
  const label = op.metadata?.number ?? op.id;

  // По каждой оси грани: отверстие обязано остаться внутри детали.
  const axes: Array<{ size: number; lo: number; hi: number }> = [
    { size: fi.uSize, lo: op.x - r, hi: fi.uSize - (op.x + r) },
    { size: fi.vSize, lo: op.y - r, hi: fi.vSize - (op.y + r) },
  ];
  for (const a of axes) {
    if (a.lo < 0 || a.hi < 0) {
      return [{
        severity: 'error',
        code: 'machining.holeOutOfPart',
        message: `Операция ${label}: отверстие Ø${op.diameter} выходит за пределы детали.`,
        operationId: op.id,
      }];
    }
  }

  /*
   * Отступ от края проверяем только там, где он В ПРИНЦИПЕ достижим и где
   * положение отверстия свободно.
   *
   * 1. Присадка в торец панели (размер грани = толщина детали) физически не
   *    может дать minEdge с обеих сторон — центрирование там уже оптимально.
   * 2. Положение сгенерированных операций диктует стандарт крепежа, а не
   *    пожелание пользователя: чашка петли Ø35 ставится на 22.5 мм от края
   *    (5 мм до края — это норма), сквозное под конфирмат встаёт на середину
   *    толщины ответной панели (16/2 = 8 мм). Занижать такие значения нельзя
   *    физически, поэтому для них проверяем только реальный подрез материала
   *    (MIN_MATERIAL_MARGIN), а недобор до профильного minEdge показываем
   *    предупреждением.
   */
  const free = op.origin === 'manual';
  const hardMin = free ? minEdge : MIN_MATERIAL_MARGIN;
  for (const a of axes) {
    if (a.size < op.diameter + 2 * hardMin) continue; // отступ недостижим — не ошибка
    const worst = Math.min(a.lo, a.hi);
    if (worst < hardMin) {
      return [{
        severity: 'error',
        code: 'machining.edgeDistance',
        message: `Операция ${label}: край отверстия ближе ${hardMin} мм к краю детали (${worst.toFixed(1)} мм).`,
        operationId: op.id,
      }];
    }
    if (!free && worst < minEdge && a.size >= op.diameter + 2 * minEdge) {
      return [{
        severity: 'warning',
        code: 'machining.edgeDistanceRule',
        message: `Операция ${label}: отступ от края ${worst.toFixed(1)} мм меньше профильного (${minEdge} мм) — задано правилом крепежа.`,
        operationId: op.id,
      }];
    }
  }
  return [];
}

/** Ссылочная целостность операции: связь и фурнитура должны существовать (§32). */
export function validateReferences(op: MachiningOperation, project: Project): MachiningIssue[] {
  const issues: MachiningIssue[] = [];
  const label = op.metadata?.number ?? op.id;
  if (op.sourceHardwareConnectionId
    && !project.hardwareConnections.some((c) => c.id === op.sourceHardwareConnectionId)) {
    issues.push({
      severity: 'error',
      code: 'machining.noConnection',
      message: `Операция ${label}: соединение не найдено.`,
      operationId: op.id,
    });
  }
  if (op.hardwareId && !project.hardware.some((h) => h.id === op.hardwareId)) {
    issues.push({
      severity: 'error',
      code: 'machining.noHardware',
      message: `Операция ${label}: фурнитура не найдена.`,
      operationId: op.id,
    });
  }
  return issues;
}

export function validateMachining(
  ops: MachiningOperation[],
  project: Project,
): MachiningIssue[] {
  const constraints = project.machining.constraints;
  const profileMin = project.machining.profile?.minHoleEdgeDistance;
  const issues: MachiningIssue[] = [];
  for (const op of ops) {
    const part = findPart(project, op.partId);
    if (!part) {
      issues.push({
        severity: 'error',
        code: 'machining.noPart',
        message: `Операция ${op.metadata?.number ?? op.id}: деталь не найдена.`,
        operationId: op.id,
      });
      continue;
    }
    if (op.diameter != null && op.diameter <= 0) {
      issues.push({
        severity: 'error',
        code: 'machining.badDiameter',
        message: `Операция ${op.metadata?.number ?? op.id}: диаметр должен быть больше 0.`,
        operationId: op.id,
      });
    }
    issues.push(...validateDrillingDepth(op, part, constraints));
    issues.push(...validateBounds(op, part, constraints));
    issues.push(...validateEdgeDistance(op, part, constraints, profileMin));
    issues.push(...validateReferences(op, project));
  }
  issues.push(...validateCollisions(ops, constraints));
  return issues;
}
