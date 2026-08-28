/**
 * Жизненный цикл соединения (§24, §96–§100).
 *
 * Соединение — производная величина: оно строится правилом из деталей. Здесь
 * определяется, когда построенный узел перестал соответствовать исходным
 * данным (DIRTY), когда он построен другой версией правила (OUTDATED) и как
 * снять снимок правила, чтобы это стало видно.
 *
 * Атомарность (§98): применение результата — отдельная функция, которая
 * возвращает ПРЕЖНИЙ набор узлов, если новый расчёт пуст или сломан.
 */
import type {
  ConnectionRuleSnapshot,
  ConnectionStatus,
  Hardware,
  HardwareConnection,
  Part,
  Project,
} from '@/core/model/types';
import { allParts } from '@/core/model/selectors';

/** Текущая версия набора правил соединений (§99). */
export const CONNECTION_RULE_VERSION = '2.0';

/** Снимок правила для узла (§100). */
export function snapshotOfConnection(
  connection: HardwareConnection,
  hardware: Hardware | undefined,
  ruleId: string,
  version: string = CONNECTION_RULE_VERSION,
): ConnectionRuleSnapshot {
  return {
    ruleId,
    version,
    hardwareParameters: hardware?.parameters ? { ...hardware.parameters } : undefined,
    connectionParameters: connection.parameters ? { ...connection.parameters } : undefined,
    createdAt: new Date().toISOString(),
  };
}

/** Сигнатура деталей узла — по ней видно, что исходные данные изменились. */
export function partsSignature(a: Part | undefined, b: Part | undefined): string {
  const one = (p: Part | undefined) =>
    p ? `${p.id}:${p.width}x${p.height}x${p.thickness}:${p.material ?? ''}` : 'none';
  return `${one(a)}|${one(b)}`;
}

/**
 * Устарел ли узел относительно правил (§99). Снимка нет — узел построен до
 * появления версий, и «устаревшим» он не считается: это не ошибка.
 */
export function isOutdated(connection: HardwareConnection, version = CONNECTION_RULE_VERSION): boolean {
  const snapshot = connection.ruleSnapshot;
  if (!snapshot) return false;
  return snapshot.version !== version;
}

/**
 * Требует ли узел пересчёта (§96). Детали изменились относительно снимка —
 * значит, положение крепежа и присадка могли поехать.
 */
export function isDirty(project: Project, connection: HardwareConnection): boolean {
  const snapshot = connection.ruleSnapshot;
  if (!snapshot) return false;
  const parts = new Map(allParts(project).map((p) => [String(p.id), p]));
  const current = partsSignature(parts.get(String(connection.partAId)), parts.get(String(connection.partBId)));
  const stored = snapshot.connectionParameters?.partsSignature;
  if (typeof stored !== 'string') return false;
  return stored !== current;
}

/**
 * Состояние узла (§24). Порядок проверок — от «данных нет» к «данные
 * устарели» и лишь потом к результату проверки: узел с отсутствующей деталью
 * не стоит объявлять просто «предупреждением».
 */
export function connectionStatus(
  project: Project,
  connection: HardwareConnection,
  version = CONNECTION_RULE_VERSION,
): ConnectionStatus {
  const parts = new Map(allParts(project).map((p) => [String(p.id), p]));
  const a = parts.get(String(connection.partAId));
  const b = parts.get(String(connection.partBId));
  if (!a || !b) return 'ERROR';
  if (isDirty(project, connection)) return 'DIRTY';
  if (isOutdated(connection, version)) return 'OUTDATED';
  return connection.status === 'ERROR' || connection.status === 'WARNING' ? connection.status : 'VALID';
}

/** Пометить узел требующим пересчёта (§96). */
export function markDirty(connection: HardwareConnection): HardwareConnection {
  return { ...connection, status: 'DIRTY' };
}

/** Записать снимок деталей в узел — так пересчёт становится обнаружимым. */
export function withPartsSignature(
  connection: HardwareConnection,
  a: Part | undefined,
  b: Part | undefined,
  ruleId: string,
  version = CONNECTION_RULE_VERSION,
): HardwareConnection {
  const snapshot = connection.ruleSnapshot ?? {
    ruleId, version, createdAt: new Date().toISOString(),
  };
  return {
    ...connection,
    ruleSnapshot: {
      ...snapshot,
      ruleId,
      version,
      connectionParameters: {
        ...(snapshot.connectionParameters ?? {}),
        partsSignature: partsSignature(a, b),
      },
    },
  };
}

/**
 * Атомарное применение пересчёта (§98).
 *
 * Если новый расчёт пуст, а прежний набор не был пуст — это ошибка правила, а
 * не «результат»: возвращается прежний набор, и модель остаётся корректной.
 */
export function applyConnections(
  previous: HardwareConnection[],
  next: HardwareConnection[] | null | undefined,
): { connections: HardwareConnection[]; applied: boolean } {
  if (!Array.isArray(next)) return { connections: previous, applied: false };
  if (next.length === 0 && previous.length > 0) return { connections: previous, applied: false };
  return { connections: next, applied: true };
}

/** Пересчитать статусы всех узлов проекта (§97). */
export function refreshConnectionStatuses(project: Project): HardwareConnection[] {
  return project.hardwareConnections.map((c) => ({ ...c, status: connectionStatus(project, c) }));
}
