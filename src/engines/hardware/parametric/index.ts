/**
 * Реестр видов параметрической фурнитуры (§2/§71–§84).
 *
 * Один вход для всех: каталог берёт отсюда значения по умолчанию, присадка —
 * операции, схемы — опорные точки. Второго набора правил размещения нет.
 */
import type {
  Hardware,
  HardwareCategory,
  HardwareItem,
  HardwareKind,
  Part,
  PartFace,
  PlacementRule,
  Vec3,
} from '@/core/model/types';
import { faceInfo, partFrame } from '@/core/geometry/coordinateSystem';
import type { HardwareKindSpec, ParametricContext, ParametricResult } from './types';
import { mergeParams } from './types';
import { hingeSpec } from './hinge';
import { handleSpec } from './handle';
import { slideSpec } from './slide';
import { shelfPinSpec } from './shelfPin';
import {
  bracketSpec, casterSpec, confirmatSpec, connectorSpec, dowelSpec, legSpec,
  lockSpec, minifixSpec, otherSpec, screwSpec,
} from './fasteners';

export * from './types';
export { hingeCount, hingePositions, HINGE_DEFAULTS } from './hinge';
export { handleCenter, handleAxis, HANDLE_POSITIONS, HANDLE_DEFAULTS, type HandlePosition } from './handle';
export { slideMountingPoints, SLIDE_TYPES, SLIDE_DEFAULTS, type SlideType } from './slide';
export { pinRowCount, pinRowPositions, SHELF_PIN_DEFAULTS } from './shelfPin';
export {
  CONFIRMAT_DEFAULTS, CONNECTOR_DEFAULTS, DOWEL_DEFAULTS, MINIFIX_DEFAULTS,
} from './fasteners';

/** Виды фурнитуры каталога (§2). */
export const HARDWARE_KIND_SPECS: HardwareKindSpec[] = [
  hingeSpec, handleSpec, slideSpec, shelfPinSpec, confirmatSpec, minifixSpec,
  dowelSpec, screwSpec, bracketSpec, legSpec, casterSpec, connectorSpec, lockSpec, otherSpec,
];

export const HARDWARE_KINDS: HardwareKind[] = HARDWARE_KIND_SPECS.map((s) => s.kind);

const BY_KIND = new Map<HardwareKind, HardwareKindSpec>(HARDWARE_KIND_SPECS.map((s) => [s.kind, s]));

export function kindSpec(kind: HardwareKind): HardwareKindSpec {
  return BY_KIND.get(kind) ?? otherSpec;
}

/** Соответствие вида каталога и внутренней категории правил (§2). */
export const KIND_CATEGORY: Record<HardwareKind, HardwareCategory> = {
  HINGE: 'hinge',
  HANDLE: 'handle',
  DRAWER_SLIDE: 'slide',
  SHELF_PIN: 'shelf-support',
  CONFIRMAT: 'confirmat',
  MINIFIX: 'minifix',
  DOWEL: 'dowel',
  SCREW: 'screw',
  BRACKET: 'corner',
  LEG: 'leg',
  CASTER: 'leg',
  CONNECTOR: 'connector',
  LOCK: 'other',
  OTHER: 'other',
};

const CATEGORY_KIND: Partial<Record<HardwareCategory, HardwareKind>> = {
  hinge: 'HINGE',
  handle: 'HANDLE',
  slide: 'DRAWER_SLIDE',
  'shelf-support': 'SHELF_PIN',
  confirmat: 'CONFIRMAT',
  minifix: 'MINIFIX',
  dowel: 'DOWEL',
  screw: 'SCREW',
  corner: 'BRACKET',
  leg: 'LEG',
  connector: 'CONNECTOR',
  'back-panel': 'SCREW',
  other: 'OTHER',
};

/** Вид фурнитуры для позиции каталога (§2). */
export function kindOfHardware(hardware: Hardware): HardwareKind {
  const stored = hardware.metadata?.kind;
  if (typeof stored === 'string' && BY_KIND.has(stored as HardwareKind)) return stored as HardwareKind;
  return CATEGORY_KIND[hardware.category] ?? 'OTHER';
}

/** Вид единицы: сохранённый в ней либо выведенный из позиции каталога. */
export function kindOfItem(item: HardwareItem, hardware: Hardware): HardwareKind {
  return item.kind ?? kindOfHardware(hardware);
}

/**
 * Раскладка единицы фурнитуры (§84).
 *
 * Координаты операций получаются ТОЛЬКО отсюда: положение единицы плюс
 * правило вида. Поэтому при изменении детали (§76–§79) достаточно пересчитать
 * — ничего не «застревает» в модели.
 */
export function resolveHardwareItem(
  item: HardwareItem,
  hardware: Hardware,
  part: Part,
): ParametricResult {
  const spec = kindSpec(kindOfItem(item, hardware));
  /* Грань НЕ подставляем заранее: каждый вид сам выбирает её по своим
   * параметрам (сторона корпуса, положение ручки), а пустое значение — это
   * «реши по правилу», а не «поставь грань по умолчанию». */
  const ctx: ParametricContext = {
    item,
    hardware,
    part,
    params: { ...spec.defaults, ...mergeParams(hardware, item) },
  };
  return spec.resolve(ctx);
}

/** Правило размещения единицы: своё, каталожное либо по виду (§71/§72). */
export function placementOf(item: HardwareItem, hardware: Hardware): PlacementRule {
  return item.placement ?? hardware.placement ?? kindSpec(kindOfItem(item, hardware)).placement;
}

/**
 * Мировые координаты точки на грани детали (§62).
 *
 * Локальные координаты хранятся относительно детали (§61), а мировые всегда
 * вычисляются — так фурнитура едет вместе с деталью без пересчёта модели.
 */
export function faceToWorld(part: Part, face: PartFace, x: number, y: number, lift = 0): Vec3 {
  const info = faceInfo(partFrame(part), face);
  return {
    x: info.corner.x + info.u.x * x + info.v.x * y + info.normal.x * lift,
    y: info.corner.y + info.u.y * x + info.v.y * y + info.normal.y * lift,
    z: info.corner.z + info.u.z * x + info.v.z * y + info.normal.z * lift,
  };
}
