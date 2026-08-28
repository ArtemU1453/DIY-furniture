/**
 * Контракты параметрической фурнитуры (§71–§84).
 *
 * Модуль ЧИСТЫЙ: он знает только модель и геометрию детали, поэтому им может
 * пользоваться и движок присадки, и каталог, и схемы установки — без второй
 * системы расчёта координат.
 */
import type {
  Hardware,
  HardwareItem,
  HardwareKind,
  MachiningType,
  Part,
  PartFace,
  PlacementRule,
} from '@/core/model/types';
import { faceInfo, partFrame } from '@/core/geometry/coordinateSystem';

/** Значение параметра как число, с запасным значением. */
export function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Размеры грани детали: вдоль (u), поперёк (v) и толщина по нормали. */
export function faceSize(part: Part, face: PartFace): { u: number; v: number; depth: number } {
  const info = faceInfo(partFrame(part), face);
  return { u: info.uSize, v: info.vSize, depth: info.depthExtent };
}

/** Операция присадки, порождённая шаблоном фурнитуры (§82/§83). */
export interface TemplateOperation {
  /** Стабильный ключ внутри единицы: из него строится id операции (§84). */
  key: string;
  type: MachiningType;
  face: PartFace;
  x: number;
  y: number;
  z?: number;
  diameter?: number;
  depth?: number;
  length?: number;
  width?: number;
  through?: boolean;
  /** Назначение отверстия: чашка, крепёж, шкант — для схем и отчётов. */
  role: string;
}

/** Опорная точка установленной фурнитуры (§60/§89). */
export interface HardwareAnchor {
  key: string;
  face: PartFace;
  /** Локальные координаты на грани детали, мм (§61). */
  x: number;
  y: number;
  /** Поворот элемента на грани, градусы (§75). */
  rotation: number;
  /** Что это за элемент комплекта: hinge, plate, slide, pin… (§68). */
  role: string;
}

export interface ParametricIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

/** Результат раскладки одной единицы фурнитуры (§84). */
export interface ParametricResult {
  anchors: HardwareAnchor[];
  operations: TemplateOperation[];
  issues: ParametricIssue[];
}

/** Контекст расчёта: единица, её позиция каталога и родительская деталь. */
export interface ParametricContext {
  item: HardwareItem;
  hardware: Hardware;
  part: Part;
  /** Параметры каталога, поверх них — параметры единицы (§3/§4). */
  params: Record<string, number | string | boolean>;
}

/** Описание вида фурнитуры (§2/§71). */
export interface HardwareKindSpec {
  kind: HardwareKind;
  label: string;
  /** Грань детали по умолчанию. */
  defaultFace: PartFace;
  /** Значения параметров по умолчанию (§15/§27/§33/§39/§46/§49/§55). */
  defaults: Record<string, number | string>;
  /** Правило размещения по умолчанию (§71/§72). */
  placement: PlacementRule;
  /** Раскладка: опорные точки, операции присадки и замечания. */
  resolve(ctx: ParametricContext): ParametricResult;
}

/** Слить параметры каталога и единицы (§4): единица важнее. */
export function mergeParams(
  hardware: Hardware,
  item: HardwareItem,
): Record<string, number | string | boolean> {
  return { ...(hardware.parameters ?? {}), ...(item.parameters ?? {}) };
}

/**
 * Положение единицы на грани с учётом ручной правки (§80).
 *
 * Override не заменяет правило, а сдвигает результат: Reset (§81) просто
 * удаляет правку и возвращает расчётное положение.
 */
export function anchorPoint(item: HardwareItem, base: { x: number; y: number }): { x: number; y: number } {
  return {
    x: item.override?.x ?? base.x,
    y: item.override?.y ?? base.y,
  };
}

/** Равномерное распределение n точек по длине с отступами от краёв (§19). */
export function distributePoints(
  length: number,
  count: number,
  topOffset: number,
  bottomOffset: number,
  spacing?: number,
): number[] {
  const n = Math.max(1, Math.round(count));
  if (n === 1) return [length / 2];

  const first = bottomOffset;
  const last = Math.max(first, length - topOffset);
  /* Явный шаг (§22) важнее равномерного распределения: цех ставит петли по
   * шаблону, а не по «красивым» промежуткам. */
  if (spacing !== undefined && spacing > 0) {
    return Array.from({ length: n }, (_, i) => clamp(first + i * spacing, 0, length));
  }
  const step = (last - first) / (n - 1);
  return Array.from({ length: n }, (_, i) => clamp(first + i * step, 0, length));
}

/**
 * Деталь, на которой стоит единица фурнитуры (§76–§79).
 *
 * Сначала по id, затем по стабильному ключу: перегенерация шкафа пересоздаёт
 * детали с новыми идентификаторами, и без ключа фурнитура «теряла» бы родителя.
 */
export function resolveItemPart(parts: Part[], item: HardwareItem): Part | undefined {
  const byId = parts.find((p) => String(p.id) === String(item.partId));
  if (byId) return byId;
  if (!item.partKey) return undefined;
  return parts.find((p) => String(p.metadata?.key ?? '') === item.partKey);
}
