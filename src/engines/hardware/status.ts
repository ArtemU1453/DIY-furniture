/**
 * Состояние позиций фурнитуры (§77–§81).
 *
 * MISSING отличается от ERROR намеренно: соединение ссылается на позицию,
 * которой в проекте нет. Соединение при этом НЕ удаляется (§79) — иначе
 * пользователь потерял бы конструкцию из-за правки библиотеки; вместо этого
 * ему предлагается назначить замену (§80).
 */
import type {
  Hardware,
  HardwareConnection,
  HardwareStatus,
  Project,
} from '@/core/model/types';
import type { HardwareId } from '@/core/model/ids';

export interface HardwareIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  hardwareId: string;
  connectionId?: string;
}

/** Позиция фурнитуры по id; undefined — позиции нет в проекте. */
export function findHardware(project: Project, id: HardwareId | string): Hardware | undefined {
  return project.hardware.find((h) => String(h.id) === String(id));
}

/** Состояние позиции, на которую ссылается соединение. */
export function hardwareStatus(project: Project, hardwareId: HardwareId | string): HardwareStatus {
  const item = findHardware(project, hardwareId);
  if (!item) return 'MISSING';
  if (item.archived) return 'ARCHIVED';
  return 'VALID';
}

/** Соединения, ссылающиеся на несуществующую позицию (§79). */
export function missingHardwareConnections(project: Project): HardwareConnection[] {
  return project.hardwareConnections.filter((c) => !findHardware(project, c.hardwareId));
}

/** Идентификаторы отсутствующих позиций — для восстановления (§80). */
export function missingHardwareIds(project: Project): string[] {
  return [...new Set(missingHardwareConnections(project).map((c) => String(c.hardwareId)))];
}

/**
 * Проверка ссылок на фурнитуру (§77/§78).
 *
 * Отсутствующая позиция — ошибка: без неё узел не собрать. Архивная — только
 * предупреждение: проект прошлых этапов обязан продолжать работать (§78).
 */
export function validateHardwareReferences(project: Project): HardwareIssue[] {
  const issues: HardwareIssue[] = [];
  for (const c of project.hardwareConnections) {
    const item = findHardware(project, c.hardwareId);
    if (!item) {
      issues.push({
        severity: 'error',
        code: 'hardware.missing',
        message: `Соединение ссылается на отсутствующую позицию фурнитуры (${String(c.hardwareId)}). Назначьте замену.`,
        hardwareId: String(c.hardwareId),
        connectionId: String(c.id),
      });
      continue;
    }
    if (item.archived) {
      issues.push({
        severity: 'warning',
        code: 'hardware.archived',
        message: `Позиция «${item.name}» архивная — в новых узлах не предлагается, существующие работают.`,
        hardwareId: String(item.id),
        connectionId: String(c.id),
      });
    }
  }
  return issues;
}
