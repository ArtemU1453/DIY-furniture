/**
 * Кэш построенных документов (§55).
 *
 * Ключ кэша обязан учитывать всё, что влияет на результат:
 *   projectModelVersion · documentType · documentSettings · layoutVersion
 *
 * Если хоть одна составляющая изменилась, ключ другой и документ строится
 * заново — устаревшую страницу кэш вернуть не может.
 */
import type { Project } from '@/core/model/types';
import { documentsSignature } from './documents';
import type { DrawingDocument } from './sheet';

const MAX_ENTRIES = 24;

/** Стабильная сериализация настроек: порядок ключей не влияет на ключ кэша. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export interface DocumentCacheKeyParts {
  projectModelVersion: string;
  documentType: string;
  documentSettings: unknown;
  layoutVersion: number;
}

/** Составляющие ключа кэша — по отдельности, чтобы их можно было проверить. */
export function documentCacheKeyParts(project: Project, key: string): DocumentCacheKeyParts {
  const settings = project.documents.settings;
  return {
    projectModelVersion: documentsSignature(project),
    documentType: key,
    documentSettings: {
      scale: settings?.scaleOverrides?.[key] ?? null,
      format: settings?.formatOverrides?.[key] ?? null,
      views: settings?.views ?? null,
      partFilter: settings?.partFilter ?? null,
      hidden: settings?.hidden ?? null,
    },
    layoutVersion: settings?.layoutVersion ?? 0,
  };
}

/** Ключ кэша документа. */
export function documentCacheKey(project: Project, key: string): string {
  const p = documentCacheKeyParts(project, key);
  return [
    p.projectModelVersion,
    p.documentType,
    stableStringify(p.documentSettings),
    `L${p.layoutVersion}`,
  ].join('|');
}

const cache = new Map<string, DrawingDocument>();

export function getCachedDocument(key: string): DrawingDocument | undefined {
  const hit = cache.get(key);
  if (hit) {
    // LRU: обновляем позицию.
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

export function setCachedDocument(key: string, doc: DrawingDocument): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, doc);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearDocumentCache(): void {
  cache.clear();
}

export function documentCacheSize(): number {
  return cache.size;
}

/**
 * Построить документ через кэш. builder вызывается только при промахе —
 * повторный вызов с теми же моделью и настройками отдаёт тот же объект.
 */
export function buildDocumentCached(
  project: Project,
  key: string,
  builder: (project: Project, key: string) => DrawingDocument,
): DrawingDocument {
  const cacheKey = documentCacheKey(project, key);
  const hit = getCachedDocument(cacheKey);
  if (hit) return hit;
  const doc = builder(project, key);
  setCachedDocument(cacheKey, doc);
  return doc;
}
