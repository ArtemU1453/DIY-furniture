/**
 * Сериализация проекта в переносимый JSON и обратно.
 *
 * Формат независим от React/three/store. Экспортированный проект полностью
 * восстанавливается при импорте. При импорте выполняется базовая проверка
 * структуры; несовместимые версии отклоняются с понятной ошибкой.
 */
import { PROJECT_FORMAT_VERSION, type Project } from '@/core/model/types';
import {
  DEFAULT_CUTTING_SETTINGS,
  DEFAULT_MACHINING_CONSTRAINTS,
  createDefaultSheets,
  makeCuttingSettings,
} from '@/core/model/factory';

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
  // Обратная совместимость: поля, появившиеся позже базовой версии 1.0.
  if (!Array.isArray(project.hardwareConnections)) project.hardwareConnections = [];
  if (!project.machining || typeof project.machining !== 'object') {
    project.machining = { constraints: { ...DEFAULT_MACHINING_CONSTRAINTS } };
  }
  if (!project.cutting || typeof project.cutting !== 'object') {
    project.cutting = { settings: makeCuttingSettings() };
  } else {
    // Обратная совместимость: поля раскроя, добавленные на этапе 10.
    project.cutting.settings = { ...makeCuttingSettings(), ...project.cutting.settings };
    const s = project.cutting.settings;
    if (!s.usableRemnant) s.usableRemnant = { ...DEFAULT_CUTTING_SETTINGS.usableRemnant };
    if (!s.sheetSelection) s.sheetSelection = {};
  }
  // Библиотеки листов и остатков (этап 10).
  if (!Array.isArray(project.sheets)) project.sheets = createDefaultSheets(project.materials);
  if (!Array.isArray(project.remnants)) project.remnants = [];
  if (!project.documents || typeof project.documents !== 'object') {
    project.documents = {};
  }
  const major = project.version.split('.')[0];
  const currentMajor = PROJECT_FORMAT_VERSION.split('.')[0];
  if (major !== currentMajor) {
    throw new ProjectParseError(
      `Несовместимая версия формата: ${project.version}. Ожидается ${PROJECT_FORMAT_VERSION}.`,
    );
  }
  return project;
}
