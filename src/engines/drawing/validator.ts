/**
 * DrawingValidator — проверка чертежей и комплекта документов.
 *
 * Проверяет (§44): наличие деталей, корректность размеров, координаты
 * отверстий, отсутствие переполнения листа, заполненность основной надписи,
 * корректность масштаба, отсутствие пустых страниц. Работает с уже построенными
 * документами (DocumentModel) — без повторного расчёта геометрии.
 */
import type { Project } from '@/core/model/types';
import { allParts, findPart } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { isCuttingStale } from '@/engines/cutting';
import { isDocumentsOutdated } from './documents';
import { contentArea } from './sheet';
import type { DrawingDocument, DrawingPage } from './sheet';
import type { DocumentModel } from './documents';

export interface DrawingIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  docId?: string;
}

function validatePage(page: DrawingPage, docTitle: string, docId: string, issues: DrawingIssue[]): void {
  // Основная надпись заполнена.
  const tb = page.title;
  if (!tb || !tb.project || !tb.title) {
    issues.push({ severity: 'error', code: 'drw.titleBlock', message: `«${docTitle}»: основная надпись не заполнена.`, docId });
  }
  if (!tb || tb.sheetsTotal < 1 || tb.sheet < 1) {
    issues.push({ severity: 'error', code: 'drw.sheetNumber', message: `«${docTitle}»: некорректная нумерация листа.`, docId });
  }
  // Масштаб корректен.
  if (typeof page.scale === 'number' && page.scale <= 0) {
    issues.push({ severity: 'error', code: 'drw.scale', message: `«${docTitle}»: некорректный масштаб.`, docId });
  }
  // Пустая страница.
  if (page.scene.prims.length === 0) {
    issues.push({ severity: 'warning', code: 'drw.emptyPage', message: `«${docTitle}»: пустая страница.`, docId });
  }
  // Переполнение листа: содержимое (уже в мм листа) не должно превышать рабочую область.
  const area = contentArea(page.format, page.orientation);
  const s = typeof page.scale === 'number' ? page.scale : 1;
  if (page.scene.width * s > area.w + 1 || page.scene.height * s > area.h + 1) {
    issues.push({ severity: 'warning', code: 'drw.overflow', message: `«${docTitle}»: содержимое не помещается на лист — требуется другой масштаб/формат.`, docId });
  }
}

/** Проверить один документ. */
export function validateDrawing(doc: DrawingDocument): DrawingIssue[] {
  const issues: DrawingIssue[] = [];
  if (doc.pages.length === 0) {
    issues.push({ severity: 'error', code: 'drw.noPages', message: `«${doc.title}»: нет страниц.`, docId: doc.id });
    return issues;
  }
  for (const page of doc.pages) validatePage(page, doc.title, doc.id, issues);
  return issues;
}

/**
 * DocumentValidator (§57): все детали существуют, размеры валидны, нет
 * потерянных Part ID и операций присадки, раскрой актуален, данные доступны.
 */
export function validateModelLinks(project: Project): DrawingIssue[] {
  const issues: DrawingIssue[] = [];
  const parts = allParts(project);
  if (parts.length === 0) {
    issues.push({ severity: 'warning', code: 'drw.noParts', message: 'В проекте нет деталей — чертежи будут пустыми.' });
  }

  // Размеры деталей валидны и материал доступен.
  const materialIds = new Set(project.materials.map((m) => String(m.id)));
  const edgeIds = new Set(project.edges.map((e) => String(e.id)));
  for (const p of parts) {
    const label = (p.metadata?.number as string) ?? p.name;
    if (!(p.width > 0) || !(p.height > 0) || !(p.thickness > 0)) {
      issues.push({ severity: 'error', code: 'drw.badSize', message: `Деталь ${label}: некорректные размеры (${p.width}×${p.height}×${p.thickness}).` });
    }
    if (!(p.quantity > 0)) {
      issues.push({ severity: 'error', code: 'drw.badQuantity', message: `Деталь ${label}: количество должно быть больше 0.` });
    }
    if (p.material && !materialIds.has(String(p.material))) {
      issues.push({ severity: 'error', code: 'drw.noMaterial', message: `Деталь ${label}: материал не найден в проекте.` });
    }
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const id = p.edges[side];
      if (id && !edgeIds.has(String(id))) {
        issues.push({ severity: 'error', code: 'drw.noEdge', message: `Деталь ${label}: кромка стороны «${side}» не найдена в проекте.` });
      }
    }
  }

  // Операции присадки: деталь существует, координаты заданы.
  for (const op of allOperations(project)) {
    if (!findPart(project, op.partId)) {
      issues.push({ severity: 'error', code: 'drw.opNoPart', message: `Операция присадки ссылается на несуществующую деталь.` });
    }
    if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) {
      issues.push({ severity: 'error', code: 'drw.opNoCoords', message: `У операции присадки нет координат.` });
    }
  }

  // Раскрой: устаревшую карту в производственный комплект пускать нельзя (§58).
  if (project.cutting.report && isCuttingStale(project)) {
    issues.push({
      severity: 'error', code: 'drw.cuttingStale',
      message: 'Раскрой требует перерасчёта — карта раскроя не соответствует модели.',
    });
  }
  return issues;
}

/**
 * Предупреждения перед экспортом (§58): устаревшая документация и раскрой.
 * Молча отдавать устаревший производственный документ нельзя.
 */
export interface ExportWarnings {
  documentsOutdated: boolean;
  cuttingStale: boolean;
  cuttingMissing: boolean;
  messages: string[];
}

export function exportWarnings(project: Project): ExportWarnings {
  const documentsOutdated = isDocumentsOutdated(project);
  const cuttingStale = project.cutting.report != null && isCuttingStale(project);
  const cuttingMissing = project.cutting.report == null;
  const messages: string[] = [];
  if (documentsOutdated) messages.push('Документация требует обновления.');
  if (cuttingStale) messages.push('Раскрой требует перерасчёта.');
  if (cuttingMissing) messages.push('Раскрой не рассчитан — карта раскроя будет пустой.');
  return { documentsOutdated, cuttingStale, cuttingMissing, messages };
}

/** Проверить весь комплект документов. */
export function validateDocumentModel(model: DocumentModel, project: Project): DrawingIssue[] {
  const issues: DrawingIssue[] = [...validateModelLinks(project)];
  for (const entry of model.documents) issues.push(...validateDrawing(entry.doc));
  return issues;
}

/** Обязательные документы в финальном комплекте (§29/§57). */
const REQUIRED_TYPES = ['ASSEMBLY_DRAWING', 'PARTS_LIST', 'PART_DRAWING'] as const;

export interface PdfPreflight {
  ok: boolean;
  pageCount: number;
  issues: DrawingIssue[];
}

/**
 * Предпроверка перед экспортом PDF (§45): число страниц, наличие основной
 * надписи, отсутствие пустых страниц, корректность формата, наличие
 * обязательных документов.
 */
export function pdfPreflight(model: DocumentModel): PdfPreflight {
  const issues: DrawingIssue[] = [];
  let pageCount = 0;
  const presentTypes = new Set(model.documents.map((e) => e.doc.type));

  for (const entry of model.documents) {
    pageCount += entry.doc.pages.length;
    for (const page of entry.doc.pages) {
      if (page.scene.prims.length === 0) {
        issues.push({ severity: 'warning', code: 'pdf.emptyPage', message: `«${entry.doc.title}»: пустая страница в PDF.`, docId: entry.doc.id });
      }
      if (!page.title?.project || !page.title?.title) {
        issues.push({ severity: 'error', code: 'pdf.titleBlock', message: `«${entry.doc.title}»: страница без основной надписи.`, docId: entry.doc.id });
      }
      if (!page.format) {
        issues.push({ severity: 'error', code: 'pdf.format', message: `«${entry.doc.title}»: не задан формат листа.`, docId: entry.doc.id });
      }
    }
  }
  for (const t of REQUIRED_TYPES) {
    if (!presentTypes.has(t)) {
      issues.push({ severity: 'error', code: 'pdf.required', message: `В комплекте отсутствует обязательный документ: ${t}.` });
    }
  }
  if (pageCount === 0) {
    issues.push({ severity: 'error', code: 'pdf.noPages', message: 'Комплект не содержит страниц.' });
  }

  const ok = issues.every((i) => i.severity !== 'error');
  return { ok, pageCount, issues };
}
