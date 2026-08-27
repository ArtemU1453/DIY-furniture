/**
 * Конструкторы операций (§22–§29).
 *
 * Все они строят ОДИН тип MachiningOperation — второй системы операций не
 * заводится (§30): паз, карман и вырез отличаются полями и типом, а не
 * отдельной моделью данных. Поэтому валидация, чертёж, 3D и экспорт работают
 * с ними единообразно.
 */
import type {
  MachiningOperation,
  MachiningSource,
  Part,
  PartFace,
} from '@/core/model/types';
import type { MachiningId } from '@/core/model/ids';
import { toolTypeFor } from './tools';

let manualCounter = 0;

/** Идентификатор ручной операции: источник виден прямо в id. */
export function manualOperationId(partId: string): MachiningId {
  manualCounter += 1;
  return `man:${partId}:${Date.now().toString(36)}${manualCounter.toString(36)}` as MachiningId;
}

interface BaseInput {
  part: Part;
  face: PartFace;
  x: number;
  y: number;
  source?: MachiningSource;
  id?: MachiningId;
}

function base(input: BaseInput, type: MachiningOperation['type']): MachiningOperation {
  return {
    id: input.id ?? manualOperationId(String(input.part.id)),
    type,
    partId: input.part.id,
    face: input.face,
    x: input.x,
    y: input.y,
    z: 0,
    origin: (input.source ?? 'MANUAL') === 'MANUAL' ? 'manual' : 'generated',
    source: input.source ?? 'MANUAL',
    toolType: toolTypeFor(type),
  };
}

/**
 * Сверление (§22–§24). У сквозного отверстия глубина равна толщине детали и
 * не задаётся числом-заглушкой: при изменении толщины она меняется сама (§23).
 */
export function drillOperation(
  input: BaseInput & { diameter: number; depth?: number; through?: boolean },
): MachiningOperation {
  const through = input.through === true;
  return {
    ...base(input, 'drilling'),
    diameter: input.diameter,
    depth: through ? input.part.thickness : (input.depth ?? 0),
    through,
  };
}

/** Присадка под чашку (§25): Ø35 × 12 у стандартной петли. */
export function boreOperation(
  input: BaseInput & { diameter: number; depth: number },
): MachiningOperation {
  return { ...base(input, 'boring'), diameter: input.diameter, depth: input.depth, through: false };
}

/** Паз (§26): длина, ширина, глубина и направление. */
export function grooveOperation(
  input: BaseInput & { length: number; width: number; depth: number; direction?: 'horizontal' | 'vertical' },
): MachiningOperation {
  return {
    ...base(input, 'groove'),
    length: input.length,
    width: input.width,
    depth: input.depth,
    parameters: { direction: input.direction ?? 'horizontal' },
  };
}

/** Карман (§27): прямоугольная выборка заданной глубины. */
export function pocketOperation(
  input: BaseInput & { width: number; height: number; depth: number },
): MachiningOperation {
  return {
    ...base(input, 'pocket'),
    // width/length описывают прямоугольник кармана в системе грани.
    width: input.width,
    length: input.height,
    depth: input.depth,
  };
}

/** Вырез (§28): сквозная прямоугольная выборка. */
export function cutoutOperation(
  input: BaseInput & { width: number; height: number },
): MachiningOperation {
  return {
    ...base(input, 'cutout'),
    width: input.width,
    length: input.height,
    depth: input.part.thickness,
    through: true,
  };
}

/** Фрезеровка по контуру (§29): контур, глубина, инструмент. */
export function millingOperation(
  input: BaseInput & { contour: Array<{ x: number; y: number }>; depth: number; diameter?: number },
): MachiningOperation {
  return {
    ...base(input, 'mill'),
    depth: input.depth,
    diameter: input.diameter,
    // Контур хранится в metadata: это данные операции, а не отдельная модель.
    metadata: { contour: input.contour },
  };
}

/** Точки контура фрезеровки, если они заданы. */
export function contourOf(operation: MachiningOperation): Array<{ x: number; y: number }> {
  const contour = operation.metadata?.contour;
  return Array.isArray(contour) ? (contour as Array<{ x: number; y: number }>) : [];
}

/**
 * Порядок операций (§59): сначала по грани, затем по типу, затем по номеру.
 * Так оператор не перекладывает деталь лишний раз.
 */
export function sortOperations(operations: MachiningOperation[]): MachiningOperation[] {
  return [...operations].sort((a, b) =>
    a.face.localeCompare(b.face)
    || a.type.localeCompare(b.type)
    || (a.sequence ?? 0) - (b.sequence ?? 0)
    || String(a.id).localeCompare(String(b.id)),
  );
}
