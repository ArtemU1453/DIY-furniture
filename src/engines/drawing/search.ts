/**
 * Поиск по документации (§61): по Part ID, наименованию детали и позиционному
 * номеру. Результат ведёт на конкретную страницу конкретного документа, чтобы
 * предпросмотр мог сразу её открыть.
 */
import type { Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { positionNumbers } from './positions';
import { buildDocument, DOCUMENT_LIST } from './documents';

export interface DocumentSearchHit {
  /** Ключ документа (например 'parts'). */
  docKey: string;
  docTitle: string;
  /** Индекс страницы внутри документа, 0-based. */
  pageIndex: number;
  /** Что нашли: деталь. */
  partId: string;
  partNumber: string;
  partName: string;
  position: number;
  /** Поле, по которому совпало. */
  matchedBy: 'id' | 'name' | 'position';
}

/** Нормализация запроса: регистр и лишние пробелы не должны мешать поиску. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Найти детали по запросу и указать страницы документов, где они изображены.
 * Пустой запрос возвращает пустой список — «показать всё» здесь не нужно.
 */
export function searchDocuments(project: Project, query: string): DocumentSearchHit[] {
  const q = norm(query);
  if (!q) return [];

  const positions = positionNumbers(project);
  const matches: Array<{ partId: string; partNumber: string; partName: string; position: number; matchedBy: DocumentSearchHit['matchedBy'] }> = [];

  for (const part of allParts(project)) {
    const number = (part.metadata?.number as string) ?? String(part.id);
    const position = positions.get(part.id) ?? 0;
    let matchedBy: DocumentSearchHit['matchedBy'] | null = null;
    if (norm(number).includes(q) || norm(String(part.id)).includes(q)) matchedBy = 'id';
    else if (norm(part.name).includes(q)) matchedBy = 'name';
    else if (String(position) === q) matchedBy = 'position';
    if (matchedBy) {
      matches.push({ partId: String(part.id), partNumber: number, partName: part.name, position, matchedBy });
    }
  }
  if (matches.length === 0) return [];

  // Документы, у страниц которых есть привязка к детали (деталировка, присадка).
  const hits: DocumentSearchHit[] = [];
  for (const descriptor of DOCUMENT_LIST) {
    let doc;
    try {
      doc = buildDocument(project, descriptor.key);
    } catch {
      continue;
    }
    doc.pages.forEach((page, pageIndex) => {
      if (!page.partId) return;
      const m = matches.find((x) => x.partId === String(page.partId));
      if (!m) return;
      hits.push({
        docKey: descriptor.key,
        docTitle: descriptor.title,
        pageIndex,
        partId: m.partId,
        partNumber: m.partNumber,
        partName: m.partName,
        position: m.position,
        matchedBy: m.matchedBy,
      });
    });
  }
  return hits;
}

/** Найти страницу детали в конкретном документе (для перехода «открыть чертёж»). */
export function findPartPage(project: Project, docKey: string, partId: string): number {
  const doc = buildDocument(project, docKey);
  return doc.pages.findIndex((p) => String(p.partId) === partId);
}
