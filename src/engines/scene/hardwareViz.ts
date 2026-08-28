/**
 * Визуализация фурнитуры (§8, §108–§115).
 *
 * Реальная 3D-модель необязательна: без неё показывается заглушка нужного
 * размера. Работа конструктора не зависит от скачивания моделей (§110) —
 * путь к модели локальный, и если его нет, ничего не ломается (§114).
 */
import type { Hardware, HardwareItem, HardwareKind } from '@/core/model/types';
import { composeTransform, type NodeHardware, type NodeTransform, type SceneNode } from './types';

/** Форма заглушки по виду фурнитуры (§109). */
export function placeholderOf(kind: HardwareKind): NodeHardware['placeholder'] {
  switch (kind) {
    case 'HINGE':
    case 'MINIFIX':
    case 'DOWEL':
    case 'CONFIRMAT':
    case 'SHELF_PIN':
    case 'CASTER':
    case 'LEG':
      return 'CYLINDER';
    case 'DRAWER_SLIDE':
    case 'BRACKET':
    case 'LOCK':
      return 'PLATE';
    case 'HANDLE':
    default:
      return 'BOX';
  }
}

const num = (value: unknown, fallback: number): number =>
  (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/**
 * Габарит фурнитуры по её параметрам (§115).
 *
 * Размер заглушки — из тех же параметров, что и присадка, поэтому модель в
 * сцене соответствует тому, что реально ставится на деталь.
 */
export function hardwareSize(
  kind: HardwareKind,
  params: Record<string, number | string | boolean>,
): { x: number; y: number; z: number } {
  switch (kind) {
    case 'HINGE': {
      const d = num(params.cupDiameter, 35);
      return { x: d, y: d, z: num(params.cupDepth, 12.5) };
    }
    case 'HANDLE':
      return { x: num(params.length, 128), y: 20, z: 30 };
    case 'DRAWER_SLIDE':
      return { x: num(params.length, 450), y: 45, z: 12 };
    case 'SHELF_PIN':
      return { x: num(params.diameter, 5), y: num(params.diameter, 5), z: num(params.depth, 12) };
    case 'CONFIRMAT':
      return { x: num(params.headDiameter, 10), y: num(params.headDiameter, 10), z: num(params.length, 50) };
    case 'MINIFIX':
      return { x: num(params.camDiameter, 15), y: num(params.camDiameter, 15), z: num(params.camDepth, 12.5) };
    case 'DOWEL':
      return { x: num(params.diameter, 8), y: num(params.diameter, 8), z: num(params.length, 30) };
    case 'LEG':
      return { x: 40, y: num(params.height, 100), z: 40 };
    case 'CASTER':
      return { x: 50, y: 50, z: 50 };
    case 'LOCK':
      return { x: num(params.diameter, 19), y: num(params.diameter, 19), z: 30 };
    case 'BRACKET':
      return { x: 40, y: 40, z: 20 };
    default:
      return { x: num(params.diameter, 20), y: num(params.diameter, 20), z: 20 };
  }
}

/** Локальный путь к 3D-модели единицы (§113/§114). */
export function modelPathOf(item: HardwareItem, hardware: Hardware): string | undefined {
  const fromItem = item.parameters?.modelPath;
  if (typeof fromItem === 'string' && fromItem.length > 0) return fromItem;
  const fromHardware = hardware.parameters?.modelPath ?? hardware.metadata?.modelPath;
  return typeof fromHardware === 'string' && fromHardware.length > 0 ? fromHardware : undefined;
}

/** Поддерживаемые форматы локальных моделей (§112). */
export const SUPPORTED_MODEL_FORMATS = ['gltf', 'glb'];

/** Пригоден ли путь к модели: только локальные файлы поддерживаемых форматов (§110/§112). */
export function isSupportedModel(path: string | undefined): boolean {
  if (!path) return false;
  if (/^https?:/i.test(path)) return false; // никаких загрузок из интернета
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_MODEL_FORMATS.includes(ext);
}

export interface HardwareNodeInput {
  id: string;
  parentId: string;
  parentWorld: NodeTransform;
  local: NodeTransform;
  item: HardwareItem;
  hardware: Hardware;
  kind: HardwareKind;
  label: string;
}

/** Узел фурнитуры (§8/§108/§109). */
export function hardwareNode(input: HardwareNodeInput): SceneNode {
  const params = { ...(input.hardware.parameters ?? {}), ...(input.item.parameters ?? {}) };
  const path = modelPathOf(input.item, input.hardware);
  const visual: NodeHardware = {
    itemId: input.item.id,
    hardwareId: String(input.hardware.id),
    kind: input.kind,
    modelPath: isSupportedModel(path) ? path : undefined,
    placeholder: placeholderOf(input.kind),
  };
  return {
    id: input.id,
    kind: 'HARDWARE',
    label: input.label,
    parentId: input.parentId,
    childIds: [],
    refId: input.item.id,
    local: input.local,
    world: composeTransform(input.parentWorld, input.local),
    size: hardwareSize(input.kind, params),
    hardware: visual,
    hidden: input.item.hidden === true,
  };
}
