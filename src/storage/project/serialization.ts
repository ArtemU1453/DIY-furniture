/**
 * Сериализация проекта в переносимый JSON и обратно.
 *
 * Формат независим от React/three/store. Экспортированный проект полностью
 * восстанавливается при импорте. При импорте выполняется базовая проверка
 * структуры; несовместимые версии отклоняются с понятной ошибкой.
 */
import { PROJECT_FORMAT_VERSION, type Project } from '@/core/model/types';

export const PROJECT_FILE_EXTENSION = '.furniture.json';

export class ProjectParseError extends Error {}

/** Проект → JSON-строка. */
export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

/** Проверка минимальной структуры объекта проекта. */
function assertProjectShape(value: unknown): asserts value is Project {
  if (typeof value !== 'object' || value === null) {
    throw new ProjectParseError('Файл не является объектом проекта.');
  }
  const p = value as Record<string, unknown>;
  const requiredArrays = ['materials', 'edges', 'hardware', 'furnitures'];
  for (const key of requiredArrays) {
    if (!Array.isArray(p[key])) {
      throw new ProjectParseError(`Отсутствует или повреждено поле «${key}».`);
    }
  }
  if (typeof p.id !== 'string' || typeof p.name !== 'string') {
    throw new ProjectParseError('Отсутствуют обязательные поля id/name.');
  }
  if (typeof p.version !== 'string') {
    throw new ProjectParseError('Отсутствует версия формата.');
  }
}

/** JSON-строка → Проект (с валидацией). */
export function deserializeProject(json: string): Project {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ProjectParseError('Не удалось разобрать JSON.');
  }
  assertProjectShape(parsed);

  const project = parsed as Project;
  // Обратная совместимость: связи фурнитуры появились позже.
  if (!Array.isArray(project.hardwareConnections)) project.hardwareConnections = [];
  const major = project.version.split('.')[0];
  const currentMajor = PROJECT_FORMAT_VERSION.split('.')[0];
  if (major !== currentMajor) {
    throw new ProjectParseError(
      `Несовместимая версия формата: ${project.version}. Ожидается ${PROJECT_FORMAT_VERSION}.`,
    );
  }
  return project;
}
