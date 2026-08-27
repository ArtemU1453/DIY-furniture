/**
 * ConnectionValidator (§40, §41, §45, §85).
 *
 * Проверяет, что соединение вообще имеет смысл: обе детали существуют и
 * различны, крепёж найден, детали действительно образуют стык, параметры
 * положительны, а ограничения правил присадки выполнимы. Результат сводится
 * к статусу VALID / WARNING / ERROR (§45).
 */
import type {
  ConnectionStatus,
  HardwareConnection,
  Part,
  Project,
} from '@/core/model/types';
import { findPart } from '@/core/model/selectors';
import { analyzeJoint } from '@/engines/machining/joint';
import { isApplicable } from '@/engines/machining/declarative';
import { isDuplicate } from './identity';

export type ConnectionSeverity = 'error' | 'warning';

export interface ConnectionIssue {
  severity: ConnectionSeverity;
  code: string;
  message: string;
  connectionId?: string;
}

export interface ConnectionCheck {
  status: ConnectionStatus;
  issues: ConnectionIssue[];
}

const label = (p: Part | undefined): string =>
  p ? ((p.metadata?.number as string) ?? p.name) : '—';

/** Проверить одно соединение в контексте проекта. */
export function checkConnection(
  connection: HardwareConnection,
  project: Project,
  /** Остальные соединения — для поиска дубликатов (§42). */
  others: HardwareConnection[] = project.hardwareConnections,
): ConnectionCheck {
  const issues: ConnectionIssue[] = [];
  const id = String(connection.id);

  // §41: самосоединение запрещено.
  if (String(connection.partAId) === String(connection.partBId)) {
    issues.push({
      severity: 'error', code: 'conn.selfLink', connectionId: id,
      message: 'Нельзя соединить деталь саму с собой.',
    });
    return { status: 'ERROR', issues };
  }

  const partA = findPart(project, connection.partAId);
  const partB = findPart(project, connection.partBId);
  const hardware = project.hardware.find((h) => h.id === connection.hardwareId);

  if (!partA || !partB) {
    issues.push({
      severity: 'error', code: 'conn.missingPart', connectionId: id,
      message: `Соединение ${id.slice(0, 8)}: деталь не найдена — соединение устарело.`,
    });
    return { status: 'OUTDATED', issues };
  }
  if (!hardware) {
    issues.push({
      severity: 'error', code: 'conn.missingHardware', connectionId: id,
      message: `Соединение ${label(partA)} ↔ ${label(partB)}: фурнитура не найдена.`,
    });
    return { status: 'ERROR', issues };
  }

  // §42: дубликат.
  if (isDuplicate(others, connection, id)) {
    issues.push({
      severity: 'warning', code: 'conn.duplicate', connectionId: id,
      message: `Дублирующее соединение «${hardware.name}»: ${label(partA)} ↔ ${label(partB)}.`,
    });
  }

  // Параметры соединения должны быть положительными числами.
  if (connection.quantity != null && (!Number.isFinite(connection.quantity) || connection.quantity <= 0)) {
    issues.push({
      severity: 'error', code: 'conn.badQuantity', connectionId: id,
      message: `Соединение ${label(partA)} ↔ ${label(partB)}: количество крепежа должно быть больше 0.`,
    });
  }
  for (const [key, value] of Object.entries(connection.parameters ?? {})) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
      issues.push({
        severity: 'error', code: 'conn.badParameter', connectionId: id,
        message: `Соединение ${label(partA)} ↔ ${label(partB)}: параметр «${key}» некорректен.`,
      });
    }
  }

  // §40: геометрическая возможность — детали должны образовывать стык.
  const count = connection.quantity
    ?? (typeof hardware.parameters?.count === 'number' ? hardware.parameters.count : 2);
  const edgeOffset = typeof connection.parameters?.edgeOffset === 'number'
    ? connection.parameters.edgeOffset
    : (typeof hardware.parameters?.edgeOffset === 'number' ? hardware.parameters.edgeOffset : 32);

  // Петли и ручки крепятся к фасаду, который висит перед корпусом и стыка с
  // ним не образует — для них проверка контакта неприменима.
  const contactRequired = hardware.category !== 'hinge' && hardware.category !== 'handle';
  if (contactRequired) {
    const joint = analyzeJoint(partA, partB, { count, edgeOffset });
    if (!joint) {
      issues.push({
        severity: 'warning', code: 'conn.noContact', connectionId: id,
        message: `Детали ${label(partA)} и ${label(partB)} не соприкасаются — соединение не даст присадки.`,
      });
    }
  }

  // §85: ограничения правил крепежа (например, минимальная толщина).
  const material = project.materials.find((m) => m.id === partA.material);
  for (const rule of hardware.machiningRules ?? []) {
    const check = isApplicable(rule, { connection, hardware, partA, partB, material });
    if (!check.applicable) {
      issues.push({
        severity: 'error', code: 'conn.ruleNotApplicable', connectionId: id,
        message: `«${hardware.name}» не подходит для ${label(partA)} ↔ ${label(partB)}: ${check.reasons.join('; ')}.`,
      });
    }
  }

  const hasError = issues.some((i) => i.severity === 'error');
  const status: ConnectionStatus = hasError ? 'ERROR' : issues.length > 0 ? 'WARNING' : 'VALID';
  return { status, issues };
}

export interface ConnectionValidationReport {
  ok: boolean;
  issues: ConnectionIssue[];
  /** Статус каждого соединения по его id. */
  statuses: Map<string, ConnectionStatus>;
  errors: number;
  warnings: number;
}

/** Проверить все соединения проекта. */
export function validateConnections(project: Project): ConnectionValidationReport {
  const issues: ConnectionIssue[] = [];
  const statuses = new Map<string, ConnectionStatus>();

  for (const connection of project.hardwareConnections) {
    const check = checkConnection(connection, project);
    statuses.set(String(connection.id), check.status);
    issues.push(...check.issues);
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  return { ok: errors === 0, issues, statuses, errors, warnings: issues.length - errors };
}

/**
 * Проверка кандидата ДО создания: та же логика, но без требования, чтобы
 * соединение уже существовало в проекте.
 */
export function checkNewConnection(
  candidate: Pick<HardwareConnection, 'partAId' | 'partBId' | 'hardwareId' | 'connectionType' | 'quantity' | 'parameters' | 'position'>,
  project: Project,
): ConnectionCheck {
  const probe: HardwareConnection = {
    id: 'candidate' as HardwareConnection['id'],
    ...candidate,
  };
  return checkConnection(probe, project, project.hardwareConnections);
}
