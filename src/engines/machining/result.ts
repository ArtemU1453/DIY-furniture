/**
 * Результат генерации присадки и отчёт валидации (§79–§85/§95/§96).
 *
 * Ключевое свойство — АТОМАРНОСТЬ (§79/§80): новый набор операций становится
 * активным только после успешной генерации. Если расчёт упал, прежний
 * корректный набор остаётся на месте — иначе одна ошибка обнуляла бы
 * технологию всего изделия.
 *
 * Сообщения адресованы человеку у станка (§96): «Отверстие Ø35 выходит за
 * границы детали», а не текст исключения.
 */
import type {
  MachiningOperation,
  MachiningResult,
  MachiningStatusKind,
  Part,
  Project,
} from '@/core/model/types';
import { allParts, findPart } from '@/core/model/selectors';
import { allOperations } from './generate';
import { validateMachining, type MachiningIssue } from './validate';
import { checkProjectTooling } from './tools';
import { sortOperations } from './operations';

/** Версия набора правил присадки (§84). Меняется, когда меняется результат. */
export const MACHINING_RULE_VERSION = '1.0';

export interface MachiningValidationReport {
  issues: MachiningIssue[];
  errors: number;
  warnings: number;
  /** Операции без замечаний. */
  validOperations: number;
  totalOperations: number;
  /** Состояние каждой операции (§9). */
  statuses: Map<string, MachiningStatusKind>;
}

/**
 * Полная проверка: геометрия плюс оснастка. Инструмент проверяется отдельным
 * движком, но попадает в общий отчёт — у пользователя один список проблем,
 * а не два.
 */
export function validateProjectMachining(project: Project, operations?: MachiningOperation[]): MachiningValidationReport {
  const ops = operations ?? allOperations(project);
  const geometry = validateMachining(ops, project);
  const tooling = checkProjectTooling(project, ops).map((i): MachiningIssue => ({
    severity: i.severity,
    code: i.code,
    message: i.message,
    operationId: i.operationId as MachiningOperation['id'],
  }));
  const issues = [...geometry, ...tooling];

  const statuses = new Map<string, MachiningStatusKind>();
  for (const op of ops) {
    const own = issues.filter((i) => String(i.operationId) === String(op.id));
    statuses.set(
      String(op.id),
      own.some((i) => i.severity === 'error') ? 'ERROR' : own.length > 0 ? 'WARNING' : 'VALID',
    );
  }

  return {
    issues,
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    validOperations: [...statuses.values()].filter((s) => s === 'VALID').length,
    totalOperations: ops.length,
    statuses,
  };
}

/** Результат по одной детали со снимком условий расчёта (§82/§83). */
export function machiningResultFor(project: Project, part: Part): MachiningResult {
  const operations = sortOperations(allOperations(project).filter((op) => String(op.partId) === String(part.id)));
  const report = validateProjectMachining(project, operations);
  return {
    partId: part.id,
    operations,
    warnings: report.issues.filter((i) => i.severity === 'warning').map((i) => i.message),
    errors: report.issues.filter((i) => i.severity === 'error').map((i) => i.message),
    version: MACHINING_RULE_VERSION,
    generatedAt: new Date().toISOString(),
    profileSnapshot: project.machining.profile ? { ...project.machining.profile } : undefined,
  };
}

/** Результаты по всем деталям проекта. */
export function machiningResults(project: Project): MachiningResult[] {
  return allParts(project).map((part) => machiningResultFor(project, part));
}

/** Состояние детали для производства (§76). */
export type PartMachiningStatus = 'READY' | 'WARNING' | 'ERROR' | 'OUTDATED';

/**
 * Готова ли деталь к производству. Деталь без операций считается готовой:
 * «нет присадки» — это нормальная деталь, а не ошибка.
 */
export function partStatus(project: Project, partId: string, outdated = false): PartMachiningStatus {
  if (outdated) return 'OUTDATED';
  const ops = allOperations(project).filter((op) => String(op.partId) === partId);
  if (ops.length === 0) return 'READY';
  const report = validateProjectMachining(project, ops);
  if (report.errors > 0) return 'ERROR';
  if (report.warnings > 0) return 'WARNING';
  return 'READY';
}

/**
 * Атомарная генерация (§79/§80): новый набор возвращается ТОЛЬКО если он
 * посчитался без ошибок. Иначе возвращается прежний, а причина — в errors.
 */
export interface RegenerationOutcome {
  ok: boolean;
  operations: MachiningOperation[];
  errors: string[];
  warnings: string[];
}

export function regenerate(project: Project, previous: MachiningOperation[] = []): RegenerationOutcome {
  let next: MachiningOperation[];
  try {
    next = allOperations(project);
  } catch (err) {
    // Сбой расчёта не должен стирать уже проверенную технологию.
    return {
      ok: false,
      operations: previous,
      errors: [err instanceof Error ? err.message : 'Не удалось рассчитать присадку.'],
      warnings: [],
    };
  }

  const report = validateProjectMachining(project, next);
  if (report.errors > 0) {
    return {
      ok: false,
      operations: previous.length > 0 ? previous : next,
      errors: report.issues.filter((i) => i.severity === 'error').map((i) => i.message),
      warnings: report.issues.filter((i) => i.severity === 'warning').map((i) => i.message),
    };
  }
  return {
    ok: true,
    operations: sortOperations(next),
    errors: [],
    warnings: report.issues.map((i) => i.message),
  };
}

/** Операции детали (§71). */
export function operationsOfPart(project: Project, partId: string): MachiningOperation[] {
  return sortOperations(allOperations(project).filter((op) => String(op.partId) === partId));
}

/** Деталь операции (§72). */
export function partOfOperation(project: Project, operation: MachiningOperation): Part | undefined {
  return findPart(project, operation.partId);
}
