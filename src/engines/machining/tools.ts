/**
 * Библиотека инструментов и возможности станка (§50–§56).
 *
 * Библиотека локальная и лежит в производственном профиле проекта — второй
 * сущности рядом с ManufacturingProfile не заводится (§56): ограничения
 * станка и нормы производства описывают одно и то же производство.
 *
 * Отсутствие инструмента — ПРЕДУПРЕЖДЕНИЕ, а не запрет (§50): деталь можно
 * отдать на сторону или досверлить вручную, и решать это должен человек.
 */
import type {
  MachiningOperation,
  MachiningType,
  ManufacturingProfile,
  Project,
  ToolItem,
  ToolType,
} from '@/core/model/types';

/** Стандартный набор свёрл мебельного производства (§53). */
export const DEFAULT_TOOLS: ToolItem[] = [
  { id: 'drill-5', name: 'Сверло Ø5', type: 'DRILL', diameter: 5, maxDepth: 40 },
  { id: 'drill-8', name: 'Сверло Ø8', type: 'DRILL', diameter: 8, maxDepth: 50 },
  { id: 'drill-10', name: 'Сверло Ø10', type: 'DRILL', diameter: 10, maxDepth: 60 },
  { id: 'drill-15', name: 'Сверло Ø15', type: 'DRILL', diameter: 15, maxDepth: 60 },
  { id: 'drill-20', name: 'Сверло Ø20', type: 'DRILL', diameter: 20, maxDepth: 60 },
  { id: 'drill-35', name: 'Чашечное сверло Ø35', type: 'DRILL', diameter: 35, maxDepth: 20 },
];

/** Инструменты проекта. Профиль без своей библиотеки использует стандартную. */
export function toolLibrary(project: Project): ToolItem[] {
  const tools = project.machining.profile?.tools;
  return (tools && tools.length > 0 ? tools : DEFAULT_TOOLS).filter((t) => !t.archived);
}

export function findTool(project: Project, id: string): ToolItem | undefined {
  return toolLibrary(project).find((t) => t.id === id);
}

/** Какой тип инструмента нужен операции (§4). */
export function toolTypeFor(type: MachiningType): ToolType {
  switch (type) {
    case 'drilling':
    case 'dowel':
    case 'confirmat':
    case 'boring':
    case 'hinge':
    case 'countersink':
      return 'DRILL';
    case 'pocket':
    case 'slot':
    case 'groove':
    case 'mill':
      return 'END_MILL';
    case 'cut':
    case 'cutout':
      return 'SAW';
    default:
      return 'CUSTOM';
  }
}

/**
 * Подобрать инструмент под операцию: точное совпадение диаметра, иначе
 * ближайший БОЛЬШИЙ — сверлом меньшего диаметра нужное отверстие не сделать.
 */
export function pickTool(tools: ToolItem[], operation: MachiningOperation): ToolItem | undefined {
  const needed = operation.diameter;
  const type = operation.toolType ?? toolTypeFor(operation.type);
  const suitable = tools.filter((t) => t.type === type);
  if (needed == null) return suitable[0];

  const exact = suitable.find((t) => Math.abs(t.diameter - needed) < 1e-6);
  if (exact) return exact;
  const larger = suitable.filter((t) => t.diameter > needed).sort((a, b) => a.diameter - b.diameter);
  return larger[0];
}

export interface ToolIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  operationId: string;
}

/** Проверка инструмента и возможностей станка (§54/§55). */
export function checkTooling(
  operation: MachiningOperation,
  tools: ToolItem[],
  profile?: ManufacturingProfile,
): ToolIssue[] {
  const issues: ToolIssue[] = [];
  const at = { operationId: String(operation.id) };
  const tool = pickTool(tools, operation);

  if (!tool) {
    issues.push({
      severity: 'warning',
      code: 'tool.missing',
      message: operation.diameter != null
        ? `Нет инструмента Ø${operation.diameter} мм для операции ${operation.id}.`
        : `Нет подходящего инструмента для операции ${operation.id}.`,
      ...at,
    });
  } else if (operation.depth != null && operation.depth > tool.maxDepth) {
    issues.push({
      severity: 'warning',
      code: 'tool.depthExceeded',
      message: `Глубина ${operation.depth} мм превышает вылет инструмента «${tool.name}» (${tool.maxDepth} мм).`,
      ...at,
    });
  }

  if (profile) {
    if (profile.supportedOperations && !profile.supportedOperations.includes(operation.type)) {
      issues.push({
        severity: 'warning',
        code: 'machine.unsupportedOperation',
        message: `Станок не выполняет операции типа «${operation.type}».`,
        ...at,
      });
    }
    if (profile.maxToolDiameter != null && operation.diameter != null && operation.diameter > profile.maxToolDiameter) {
      issues.push({
        severity: 'warning',
        code: 'machine.diameterExceeded',
        message: `Диаметр ${operation.diameter} мм превышает предел станка ${profile.maxToolDiameter} мм.`,
        ...at,
      });
    }
    if (profile.maxMachiningDepth != null && operation.depth != null && operation.depth > profile.maxMachiningDepth) {
      issues.push({
        severity: 'warning',
        code: 'machine.depthExceeded',
        message: `Глубина ${operation.depth} мм превышает предел станка ${profile.maxMachiningDepth} мм.`,
        ...at,
      });
    }
  }
  return issues;
}

/** Проверить оснастку по всем операциям проекта. */
export function checkProjectTooling(project: Project, operations: MachiningOperation[]): ToolIssue[] {
  const tools = toolLibrary(project);
  const profile = project.machining.profile;
  return operations.flatMap((op) => checkTooling(op, tools, profile));
}
