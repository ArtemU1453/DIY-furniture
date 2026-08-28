/**
 * Пресеты соединений и мастер создания узла (§125–§131).
 *
 * Пресет — это готовый набор «тип узла + категория крепежа + параметры».
 * Он не хранит саму позицию каталога: подбирается та, что есть в проекте, —
 * поэтому один пресет работает с любой библиотекой фурнитуры (§128).
 */
import type {
  ConnectionType,
  Hardware,
  HardwareCategory,
  HardwareConnection,
  JointType,
  Part,
  Project,
} from '@/core/model/types';
import type { HardwareConnectionId, HardwareId, PartId } from '@/core/model/ids';
import { connectionStableId } from './identity';
import { checkHardwareOnPart } from '@/engines/hardware/validate';

/** Пресет соединения (§128). */
export interface ConnectionPreset {
  id: string;
  name: string;
  description?: string;
  type: ConnectionType;
  category: HardwareCategory;
  jointType?: JointType;
  /** Параметры узла: шаг, отступ от края, количество точек. */
  parameters?: Record<string, number | string | boolean>;
  quantity?: number;
  builtIn?: boolean;
}

/** Встроенные пресеты (§128). */
export const BUILT_IN_CONNECTION_PRESETS: ConnectionPreset[] = [
  {
    id: 'cp-confirmat-7x50',
    name: 'Конфирмат 7×50',
    description: 'Стандартный корпусной узел: два конфирмата на стык.',
    type: 'CONFIRMAT',
    category: 'confirmat',
    jointType: 'EDGE_TO_FACE',
    parameters: { edgeOffset: 50, spacing: 300 },
    quantity: 2,
    builtIn: true,
  },
  {
    id: 'cp-dowel-8x30',
    name: 'Шкант 8×30',
    description: 'Скрытый узел на шкантах, шаг 128 мм.',
    type: 'DOWEL',
    category: 'dowel',
    jointType: 'EDGE_TO_FACE',
    parameters: { edgeOffset: 50, spacing: 128 },
    quantity: 2,
    builtIn: true,
  },
  {
    id: 'cp-cam-15',
    name: 'Эксцентрик 15 мм',
    description: 'Разборный узел: эксцентрик со штоком.',
    type: 'CAM_LOCK',
    category: 'minifix',
    jointType: 'EDGE_TO_FACE',
    parameters: { screwOffset: 34 },
    quantity: 2,
    builtIn: true,
  },
  {
    id: 'cp-screw',
    name: 'Саморез 4×30',
    description: 'Простое крепление насквозь.',
    type: 'SCREW',
    category: 'screw',
    jointType: 'BUTT',
    parameters: { edgeOffset: 40 },
    quantity: 2,
    builtIn: true,
  },
  {
    id: 'cp-bracket',
    name: 'Уголок мебельный',
    description: 'Крепление уголком: без присадки в торце.',
    type: 'OTHER',
    category: 'corner',
    jointType: 'CORNER',
    quantity: 2,
    builtIn: true,
  },
];

/** Все пресеты: встроенные плюс пользовательские (§129). */
export function allConnectionPresets(project: Project): ConnectionPreset[] {
  const custom = (project.metadata?.connectionPresets as ConnectionPreset[] | undefined) ?? [];
  return [...BUILT_IN_CONNECTION_PRESETS, ...custom];
}

export function findConnectionPreset(project: Project, id: string): ConnectionPreset | undefined {
  return allConnectionPresets(project).find((p) => p.id === id);
}

/** Подобрать позицию каталога под категорию пресета (§128). */
export function hardwareForPreset(project: Project, preset: ConnectionPreset): Hardware | undefined {
  return project.hardware.find((h) => h.category === preset.category && !h.archived);
}

export interface CreateConnectionInput {
  partA: Part;
  partB: Part;
  preset?: ConnectionPreset;
  type?: ConnectionType;
  hardwareId?: HardwareId;
  quantity?: number;
  parameters?: Record<string, number | string | boolean>;
}

export interface CreateConnectionResult {
  connection?: HardwareConnection;
  /** Понятное объяснение отказа (§115). */
  error?: string;
  /** Некритичные замечания. */
  warnings: string[];
}

/**
 * Создать узел по шагам §126: детали → тип → крепёж → параметры → узел.
 *
 * Совместимость проверяется ДО создания (§20/§21): несовместимый крепёж не
 * создаёт «сломанный» узел, а получает отказ с объяснением.
 */
export function createConnection(
  project: Project,
  input: CreateConnectionInput,
  id: HardwareConnectionId,
): CreateConnectionResult {
  const warnings: string[] = [];
  const { partA, partB, preset } = input;

  if (String(partA.id) === String(partB.id)) {
    return { error: 'Нельзя соединить деталь саму с собой.', warnings };
  }

  const type = input.type ?? preset?.type;
  if (!type) return { error: 'Не выбран тип соединения.', warnings };

  const hardware = input.hardwareId
    ? project.hardware.find((h) => String(h.id) === String(input.hardwareId))
    : preset
      ? hardwareForPreset(project, preset)
      : undefined;

  if (!hardware) {
    return {
      error: preset
        ? `В проекте нет подходящего крепежа категории «${preset.category}». Добавьте позицию в библиотеку.`
        : 'Не выбран крепёж.',
      warnings,
    };
  }

  // §20/§112: толщина и материал проверяются на обеих деталях узла.
  for (const part of [partA, partB]) {
    const issue = checkHardwareOnPart(hardware, part);
    if (issue?.severity === 'error') return { error: issue.message, warnings };
    if (issue) warnings.push(issue.message);
  }

  const connection: HardwareConnection = {
    id,
    hardwareId: hardware.id,
    partAId: partA.id as PartId,
    partBId: partB.id as PartId,
    connectionType: type,
    jointType: preset?.jointType,
    quantity: input.quantity ?? preset?.quantity ?? 1,
    stableId: connectionStableId(
      (partA.metadata?.key as string) ?? String(partA.id),
      (partB.metadata?.key as string) ?? String(partB.id),
    ),
    source: 'MANUAL',
    status: warnings.length > 0 ? 'WARNING' : 'VALID',
    parameters: { ...(preset?.parameters ?? {}), ...(input.parameters ?? {}) },
  };

  return { connection, warnings };
}

/**
 * Что исчезнет вместе с узлом (§131). Присадка, порождённая узлом, выводится
 * из него же, поэтому отдельного удаления не требует — но пользователю
 * полезно знать, сколько операций пропадёт.
 */
export interface ConnectionRemovalImpact {
  connectionId: string;
  /** Операции присадки, порождённые узлом. */
  operations: number;
  /** Единицы фурнитуры узла. */
  units: number;
}

export function connectionRemovalImpact(
  project: Project,
  connectionId: string,
): ConnectionRemovalImpact {
  const connection = project.hardwareConnections.find((c) => String(c.id) === connectionId);
  if (!connection) return { connectionId, operations: 0, units: 0 };
  let operations = 0;
  for (const furniture of project.furnitures) {
    for (const assembly of furniture.assemblies) {
      for (const part of assembly.parts) {
        operations += part.machining.filter((op) => String(op.id).includes(connectionId)).length;
      }
    }
  }
  return { connectionId, operations, units: connection.quantity ?? 1 };
}
