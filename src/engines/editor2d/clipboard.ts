/**
 * Буфер обмена редактора (§78–§81).
 *
 * Буфер хранит СЕРИАЛИЗОВАННУЮ МОДЕЛЬ (§80), а не экранные координаты: вставка
 * должна воссоздать полноценную деталь или модуль со всеми производственными
 * свойствами. Каждая вставка получает НОВЫЕ идентификаторы (§77) — иначе две
 * «одинаковые» детали делили бы одну запись присадки и кромки.
 */
import { newAssemblyId, newFurnitureId, newPartId } from '@/core/model/ids';
import type { Assembly, Furniture, Part, Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import type { EntityType } from './types';

export const CLIPBOARD_FORMAT = 'karkas-editor-clipboard';
export const CLIPBOARD_VERSION = 1;

export interface ClipboardItem {
  entityType: Extract<EntityType, 'MODULE' | 'PART'>;
  /** Полная сериализованная сущность модели. */
  payload: Furniture | Part;
}

export interface EditorClipboard {
  format: typeof CLIPBOARD_FORMAT;
  version: number;
  items: ClipboardItem[];
}

/** Смещение вставки, чтобы копия не легла ровно на оригинал (§81). */
export const PASTE_OFFSET = 50;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Скопировать выбранные сущности (§79). */
export function copyEntities(project: Project, entityIds: string[]): EditorClipboard {
  const ids = new Set(entityIds);
  const items: ClipboardItem[] = [];

  for (const furniture of project.furnitures) {
    if (ids.has(String(furniture.id))) {
      items.push({ entityType: 'MODULE', payload: clone(furniture) });
    }
  }
  // Деталь, чей модуль уже скопирован целиком, отдельно не дублируется.
  const copiedModules = new Set(items.map((i) => String((i.payload as Furniture).id)));
  for (const furniture of project.furnitures) {
    if (copiedModules.has(String(furniture.id))) continue;
    for (const assembly of furniture.assemblies) {
      for (const part of assembly.parts) {
        if (ids.has(String(part.id))) items.push({ entityType: 'PART', payload: clone(part) });
      }
    }
  }

  return { format: CLIPBOARD_FORMAT, version: CLIPBOARD_VERSION, items };
}

export function isClipboardEmpty(clipboard: EditorClipboard | null): boolean {
  return !clipboard || clipboard.items.length === 0;
}

/** Прочитать буфер из строки (обмен между вкладками — локально, без сети). */
export function readClipboard(json: string): EditorClipboard | null {
  try {
    const data = JSON.parse(json) as EditorClipboard;
    if (data.format !== CLIPBOARD_FORMAT || !Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeClipboard(clipboard: EditorClipboard): string {
  return JSON.stringify(clipboard);
}

/** Новая деталь с новым id и смещением (§77/§81). */
export function pastePart(part: Part, offset = PASTE_OFFSET): Part {
  const copy = clone(part);
  const id = newPartId();
  return {
    ...copy,
    id,
    name: `${copy.name} (копия)`,
    position: { x: copy.position.x + offset, y: copy.position.y, z: copy.position.z + offset },
    /* Присадка привязана к детали: у копии свои операции с новыми id, иначе
     * две детали делили бы одну запись обработки. */
    machining: copy.machining.map((op, i) => ({ ...op, id: `${id}:paste:${i + 1}` as typeof op.id })),
    metadata: { ...(copy.metadata ?? {}), number: undefined },
  };
}

/** Новое изделие с новыми id деталей и сборок (§77/§81). */
export function pasteFurniture(furniture: Furniture, offset = PASTE_OFFSET): Furniture {
  const copy = clone(furniture);
  const id = newFurnitureId();
  return {
    ...copy,
    id,
    name: `${copy.name} (копия)`,
    position: { x: copy.position.x + offset, y: copy.position.y, z: copy.position.z + offset },
    assemblies: copy.assemblies.map<Assembly>((assembly) => ({
      ...assembly,
      id: newAssemblyId(),
      parts: assembly.parts.map((part) => {
        const partId = newPartId();
        return {
          ...part,
          id: partId,
          machining: part.machining.map((op, i) => ({ ...op, id: `${partId}:paste:${i + 1}` as typeof op.id })),
        };
      }),
    })),
  };
}

export interface PasteResult {
  furnitures: Furniture[];
  parts: Part[];
}

/**
 * Подготовить содержимое буфера к вставке (§79/§81). Модель не мутируется:
 * вызывающий код добавляет полученные объекты одной транзакцией.
 */
export function preparePaste(clipboard: EditorClipboard | null, offset = PASTE_OFFSET): PasteResult {
  if (isClipboardEmpty(clipboard)) return { furnitures: [], parts: [] };
  const furnitures: Furniture[] = [];
  const parts: Part[] = [];
  for (const item of clipboard!.items) {
    if (item.entityType === 'MODULE') furnitures.push(pasteFurniture(item.payload as Furniture, offset));
    else parts.push(pastePart(item.payload as Part, offset));
  }
  return { furnitures, parts };
}

/** Дублирование — копирование и немедленная вставка одним действием (§78). */
export function prepareDuplicate(project: Project, entityIds: string[], offset = PASTE_OFFSET): PasteResult {
  return preparePaste(copyEntities(project, entityIds), offset);
}

/** Зависимости, которые исчезнут вместе с деталью (§83). */
export interface DeleteImpact {
  entityId: string;
  /** Соединения, ссылающиеся на деталь. */
  connections: string[];
  /** Операции присадки детали. */
  operations: number;
  /** Облицованные стороны. */
  edges: number;
  /** Можно ли удалять без предупреждения. */
  safe: boolean;
}

/**
 * Что будет затронуто удалением (§82/§83). Правила существующей модели не
 * подменяются: функция только СООБЩАЕТ о связях, решение принимает стор.
 */
export function deleteImpact(project: Project, entityIds: string[]): DeleteImpact[] {
  const parts = new Map(allParts(project).map((p) => [String(p.id), p]));
  return entityIds.map((entityId) => {
    const part = parts.get(entityId);
    const furniture = project.furnitures.find((f) => String(f.id) === entityId);

    if (furniture) {
      const partIds = new Set(
        furniture.assemblies.flatMap((a) => a.parts.map((p) => String(p.id))),
      );
      const connections = project.hardwareConnections
        .filter((c) => partIds.has(String(c.partAId)) || partIds.has(String(c.partBId)))
        .map((c) => String(c.id));
      const operations = furniture.assemblies
        .flatMap((a) => a.parts)
        .reduce((n, p) => n + p.machining.length, 0);
      const edges = furniture.assemblies
        .flatMap((a) => a.parts)
        .reduce((n, p) => n + Object.values(p.edges).filter(Boolean).length, 0);
      return { entityId, connections, operations, edges, safe: connections.length === 0 };
    }

    if (part) {
      const connections = project.hardwareConnections
        .filter((c) => String(c.partAId) === entityId || String(c.partBId) === entityId)
        .map((c) => String(c.id));
      return {
        entityId,
        connections,
        operations: part.machining.length,
        edges: Object.values(part.edges).filter(Boolean).length,
        safe: connections.length === 0,
      };
    }

    return { entityId, connections: [], operations: 0, edges: 0, safe: true };
  });
}
