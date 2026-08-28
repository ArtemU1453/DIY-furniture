/**
 * Установленная фурнитура на деталях (§60–§70, §80/§81, §100–§110).
 *
 * HardwareItem — это тот же HardwareInstance модели: спецификация, присадка и
 * производство продолжают работать с одними данными. Здесь только операции над
 * ними: постановка, перемещение, Override, комплекты, зеркало и удаление.
 */
import type {
  Hardware,
  HardwareItem,
  HardwareKind,
  HardwareSet,
  Part,
  PartFace,
  PlacementRule,
  Project,
  Vec3,
} from '@/core/model/types';
import type { HardwareId, PartId } from '@/core/model/ids';
import { allParts, findPart } from '@/core/model/selectors';
import { resolvePlacement } from './placement';
import {
  faceToWorld, kindOfHardware, kindOfItem, kindSpec, placementOf, resolveHardwareItem,
  resolveItemPart, type HardwareAnchor, type ParametricResult,
} from './parametric';

/** Деталь единицы: по id, а после перегенерации — по стабильному ключу (§76). */
export function itemPart(project: Project, item: HardwareItem): Part | undefined {
  return resolveItemPart(allParts(project), item);
}

/** Все установленные единицы проекта (§60). */
export function projectItems(project: Project): HardwareItem[] {
  return project.hardwareInstances ?? [];
}

/** Единица по идентификатору. */
export function findItem(project: Project, id: string): HardwareItem | undefined {
  return projectItems(project).find((i) => i.id === id);
}

/** Единицы, стоящие на детали (§70). */
export function itemsOfPart(project: Project, partId: PartId): HardwareItem[] {
  return projectItems(project).filter((i) => String(i.partId) === String(partId));
}

/** Свободный идентификатор единицы: `hi-<n>`. */
export function nextItemId(project: Project): string {
  const used = new Set(projectItems(project).map((i) => i.id));
  let n = projectItems(project).length + 1;
  while (used.has(`hi-${n}`)) n += 1;
  return `hi-${n}`;
}

export interface CreateItemInput {
  hardwareId: HardwareId;
  partId: PartId;
  face?: PartFace;
  kind?: HardwareKind;
  placement?: PlacementRule;
  parameters?: Record<string, number | string | boolean>;
  quantity?: number;
  rotation?: number;
  setId?: string;
}

/**
 * Создать единицу фурнитуры на детали (§99–§103).
 *
 * Положение считается правилом размещения — руками координаты задавать не
 * нужно; ручная правка появится позже как Override (§80).
 */
export function createItem(
  project: Project,
  input: CreateItemInput,
  id?: string,
): HardwareItem | null {
  const hardware = project.hardware.find((h) => h.id === input.hardwareId);
  const part = findPart(project, input.partId);
  if (!hardware || !part) return null;

  const kind = input.kind ?? kindOfHardware(hardware);
  const spec = kindSpec(kind);
  return {
    id: id ?? nextItemId(project),
    hardwareId: hardware.id,
    partId: part.id,
    // Ключ детали переживает перегенерацию шкафа (§76–§79).
    partKey: typeof part.metadata?.key === 'string' ? part.metadata.key : undefined,
    kind,
    face: input.face ?? spec.defaultFace,
    placement: input.placement ?? hardware.placement,
    parameters: input.parameters,
    quantity: input.quantity,
    rotation: input.rotation === undefined ? undefined : { x: 0, y: 0, z: input.rotation },
    setId: input.setId,
    source: 'manual',
  };
}

/** Раскладка единицы: опорные точки, операции и замечания (§84). */
export function itemLayout(project: Project, item: HardwareItem): ParametricResult | null {
  const hardware = project.hardware.find((h) => h.id === item.hardwareId);
  const part = itemPart(project, item);
  if (!hardware || !part) return null;
  return resolveHardwareItem(item, hardware, part);
}

/**
 * Локальное положение единицы на детали (§61).
 *
 * Считается правилом размещения плюс ручная правка. Ничего не хранится:
 * при изменении детали (§76–§79) положение пересчитывается само.
 */
export function localPosition(
  project: Project,
  item: HardwareItem,
): { x: number; y: number; face: PartFace } | null {
  const hardware = project.hardware.find((h) => h.id === item.hardwareId);
  const part = itemPart(project, item);
  if (!hardware || !part) return null;

  const layout = resolveHardwareItem(item, hardware, part);
  const anchor: HardwareAnchor | undefined = layout.anchors[0];
  if (anchor) return { x: anchor.x, y: anchor.y, face: anchor.face };

  const rule = placementOf(item, hardware);
  const resolved = resolvePlacement(part, rule);
  return {
    x: resolved.x + (item.override?.x ?? 0),
    y: resolved.y + (item.override?.y ?? 0),
    face: item.face ?? kindSpec(kindOfItem(item, hardware)).defaultFace,
  };
}

/** Мировые координаты единицы (§62). Вычисляются, а не хранятся. */
export function worldPosition(project: Project, item: HardwareItem): Vec3 | null {
  const part = itemPart(project, item);
  const local = localPosition(project, item);
  if (!part || !local) return null;
  return faceToWorld(part, local.face, local.x, local.y);
}

/**
 * Переместить единицу (§80).
 *
 * Перемещение записывается как Override — правило остаётся на месте, поэтому
 * Reset (§81) возвращает автоматическое положение.
 */
export function moveItem(
  project: Project,
  item: HardwareItem,
  target: { x?: number; y?: number; z?: number },
): HardwareItem {
  if (item.locked) return item;
  const base = localPosition(project, item);
  const current = { x: item.override?.x ?? 0, y: item.override?.y ?? 0 };
  if (!base) return { ...item, override: { ...item.override, ...target } };

  /* Пользователь задаёт КУДА поставить, а хранится СМЕЩЕНИЕ от расчётной
   * точки: так фурнитура продолжает ездить за деталью даже после правки. */
  const anchorX = base.x - current.x;
  const anchorY = base.y - current.y;
  return {
    ...item,
    override: {
      ...item.override,
      x: target.x === undefined ? item.override?.x : target.x - anchorX,
      y: target.y === undefined ? item.override?.y : target.y - anchorY,
      z: target.z === undefined ? item.override?.z : target.z,
    },
  };
}

/** Сдвинуть единицу на дельту (§109). */
export function nudgeItem(item: HardwareItem, dx: number, dy: number): HardwareItem {
  if (item.locked) return item;
  return {
    ...item,
    override: {
      ...item.override,
      x: (item.override?.x ?? 0) + dx,
      y: (item.override?.y ?? 0) + dy,
    },
  };
}

/** Сбросить ручную правку (§81). */
export function resetItem(item: HardwareItem): HardwareItem {
  const next = { ...item };
  delete next.override;
  return next;
}

/** Есть ли ручная правка положения (§80). */
export function isItemOverridden(item: HardwareItem): boolean {
  const o = item.override;
  return o !== undefined && (o.x !== undefined || o.y !== undefined || o.z !== undefined || o.rotation !== undefined);
}

/** Зафиксировать/освободить положение (§65). */
export function lockItem(item: HardwareItem, locked = true): HardwareItem {
  return { ...item, locked };
}

/** Показать/скрыть (§66/§88). */
export function hideItem(item: HardwareItem, hidden = true): HardwareItem {
  return { ...item, hidden };
}

/** Видимые единицы (§66). */
export function visibleItems(project: Project): HardwareItem[] {
  return projectItems(project).filter((i) => i.hidden !== true);
}

/** Независимая копия единицы (§106). */
export function duplicateItem(project: Project, item: HardwareItem, id?: string): HardwareItem {
  return {
    ...item,
    id: id ?? nextItemId(project),
    override: item.override ? { ...item.override } : undefined,
    parameters: item.parameters ? { ...item.parameters } : undefined,
  };
}

/**
 * Зеркальная копия единицы (§107).
 *
 * Положение отражается по ширине грани. Грань меняется только для торцов
 * (левый ↔ правый): пласти front/back — это две стороны ОДНОЙ детали, и
 * переносить на них зеркальную копию было бы неверно.
 */
export function mirrorItem(project: Project, item: HardwareItem, id?: string): HardwareItem | null {
  const part = itemPart(project, item);
  const local = localPosition(project, item);
  if (!part || !local) return null;

  const MIRROR_FACE: Record<PartFace, PartFace> = {
    left: 'right', right: 'left', top: 'bottom', bottom: 'top', front: 'back', back: 'front',
  };
  const mirrored = duplicateItem(project, item, id);
  const face = local.face === 'left' || local.face === 'right' ? MIRROR_FACE[local.face] : local.face;
  return {
    ...mirrored,
    face,
    override: {
      ...mirrored.override,
      x: (mirrored.override?.x ?? 0) * -1,
    },
  };
}

/** Комплекты фурнитуры проекта (§67). */
export function projectSets(project: Project): HardwareSet[] {
  return project.hardwareItemSets ?? [];
}

/** Собрать комплект из единиц (§67/§68). */
export function createSet(
  project: Project,
  name: string,
  itemIds: string[],
  parent?: { id: string; kind: HardwareSet['parentKind'] },
): HardwareSet {
  const used = new Set(projectSets(project).map((s) => s.id));
  let n = projectSets(project).length + 1;
  while (used.has(`hs-${n}`)) n += 1;
  return {
    id: `hs-${n}`,
    name,
    itemIds: [...itemIds],
    parentId: parent?.id,
    parentKind: parent?.kind,
  };
}

/** Единицы комплекта (§68). */
export function setItems(project: Project, setId: string): HardwareItem[] {
  const set = projectSets(project).find((s) => s.id === setId);
  if (!set) return [];
  const byId = new Map(projectItems(project).map((i) => [i.id, i]));
  return set.itemIds.map((id) => byId.get(id)).filter((i): i is HardwareItem => i !== undefined);
}

/** Количество компонентов комплекта (§69): считается, а не хранится. */
export function setQuantity(project: Project, setId: string): number {
  return setItems(project, setId).reduce((sum, item) => sum + (item.quantity ?? 1), 0);
}

/** Что будет удалено вместе с единицей (§105). */
export interface RemovalImpact {
  itemIds: string[];
  connectionIds: string[];
  operationIds: string[];
}

/**
 * Последствия удаления (§105).
 *
 * Удаляются только объекты, принадлежащие этой единице: чужие связи и ручные
 * операции остаются на месте.
 */
export function removalImpact(project: Project, itemId: string): RemovalImpact {
  const item = findItem(project, itemId);
  if (!item) return { itemIds: [], connectionIds: [], operationIds: [] };

  const connectionIds = item.connectionId ? [String(item.connectionId)] : [];
  const layout = itemLayout(project, item);
  const operationIds = (layout?.operations ?? []).map((op) => `hw:${item.id}:${op.key}`);
  return { itemIds: [item.id], connectionIds, operationIds };
}

/** Позиция каталога единицы. */
export function hardwareOfItem(project: Project, item: HardwareItem): Hardware | undefined {
  return project.hardware.find((h) => h.id === item.hardwareId);
}

/** Деталь, на которой стоит единица. */
export function partOfItem(project: Project, item: HardwareItem): Part | undefined {
  return itemPart(project, item);
}
