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
  DEFAULT_MANUFACTURING_PROFILE,
  createDefaultSheets,
  makeCuttingSettings,
} from '@/core/model/factory';

export const PROJECT_FILE_EXTENSION = '.furniture.json';

export class ProjectParseError extends Error {}

/** Проект → JSON-строка. */
export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Проверка минимальной структуры объекта проекта.
 *
 * Проверяются не только поля верхнего уровня, но и вложенность, по которой
 * приложение обходит модель: изделия → сборки → детали. Файл, где эта
 * вложенность нарушена, обязан быть отклонён ЗДЕСЬ: дальше по цепочке идёт
 * loadProject, который заменяет открытый проект, и пользователь потерял бы
 * свою работу ради файла, на котором всё равно падает каждый раздел.
 */
function assertProjectShape(value: unknown): asserts value is Project {
  if (!isRecord(value)) {
    throw new ProjectParseError('Файл не является объектом проекта.');
  }
  const p = value;
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
  // Библиотеки: записи должны быть объектами — по ним ищут id, имя, толщину.
  for (const key of ['materials', 'edges', 'hardware']) {
    if (!(p[key] as unknown[]).every(isRecord)) {
      throw new ProjectParseError(`Повреждено содержимое поля «${key}».`);
    }
  }
  // Изделия → сборки → детали: та вложенность, по которой считается модель.
  for (const furniture of p.furnitures as unknown[]) {
    if (!isRecord(furniture)) {
      throw new ProjectParseError('Повреждено изделие в файле проекта.');
    }
    if (!Array.isArray(furniture.assemblies)) {
      throw new ProjectParseError('У изделия в файле отсутствует список сборок.');
    }
    for (const assembly of furniture.assemblies) {
      if (!isRecord(assembly)) {
        throw new ProjectParseError('Повреждена сборка в файле проекта.');
      }
      if (!Array.isArray(assembly.parts)) {
        throw new ProjectParseError('У сборки в файле отсутствует список деталей.');
      }
      if (!assembly.parts.every(isRecord)) {
        throw new ProjectParseError('Повреждена деталь в файле проекта.');
      }
    }
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
    project.machining = {
      constraints: { ...DEFAULT_MACHINING_CONSTRAINTS },
      overrides: {},
      profile: { ...DEFAULT_MANUFACTURING_PROFILE },
    };
  } else {
    // Обратная совместимость: поля присадки, добавленные на этапе 15.
    if (!project.machining.overrides) project.machining.overrides = {};
    if (!project.machining.profile) project.machining.profile = { ...DEFAULT_MANUFACTURING_PROFILE };
  }
  if (!project.cutting || typeof project.cutting !== 'object') {
    project.cutting = { settings: makeCuttingSettings() };
  } else {
    // Обратная совместимость: поля раскроя, добавленные на этапе 10.
    project.cutting.settings = { ...makeCuttingSettings(), ...project.cutting.settings };
    const s = project.cutting.settings;
    if (!s.usableRemnant) s.usableRemnant = { ...DEFAULT_CUTTING_SETTINGS.usableRemnant };
    if (!s.sheetSelection) s.sheetSelection = {};
    if (!s.sheetPriority) s.sheetPriority = {};
    if (typeof s.preferFewerSheets !== 'boolean') s.preferFewerSheets = true;
  }
  // Библиотеки листов и остатков (этап 10).
  if (!Array.isArray(project.sheets)) project.sheets = createDefaultSheets(project.materials);
  if (!Array.isArray(project.remnants)) project.remnants = [];
  if (!project.documents || typeof project.documents !== 'object') {
    project.documents = {};
  }
  // Настройки чертежа и история генерации (этап 11).
  if (!project.documents.settings) project.documents.settings = { scaleOverrides: {}, hidden: {} };
  if (!Array.isArray(project.documents.history)) project.documents.history = [];
  // Фурнитура на деталях и её комплекты (этап 32): полей может не быть.
  if (project.hardwareInstances !== undefined && !Array.isArray(project.hardwareInstances)) {
    project.hardwareInstances = [];
  }
  if (project.hardwareItemSets !== undefined && !Array.isArray(project.hardwareItemSets)) {
    project.hardwareItemSets = [];
  }
  // Производственное задание (этап 31): старые проекты открываются без него.
  if (project.production !== undefined) {
    if (typeof project.production !== 'object' || project.production === null) {
      delete project.production;
    } else {
      if (project.production.job && !Array.isArray(project.production.job.releases)) {
        project.production.job.releases = [];
      }
      if (!Array.isArray(project.production.history)) {
        project.production.history = project.production.job?.releases ?? [];
      }
    }
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
