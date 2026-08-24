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

/** Полная валидация набора операций проекта. */
export function validateMachining(
  ops: MachiningOperation[],
  project: Project,
): MachiningIssue[] {
  const constraints = project.machining.constraints;
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
    issues.push(...validateDrillingDepth(op, part, constraints));
    issues.push(...validateBounds(op, part, constraints));
  }
  issues.push(...validateCollisions(ops, constraints));
  return issues;
}
