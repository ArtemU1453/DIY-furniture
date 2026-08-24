/**
 * DocumentEngine — сборка всех документов из производственной модели и
 * отслеживание статуса (CURRENT / OUTDATED / GENERATING / ERROR).
 *
 *   Production Model → DrawingEngine → DrawingDocument[] → SVG / PDF / Print
 *
 * Документы — производные; не хранятся. Для статуса OUTDATED хранится сигнатура
 * модели на момент «генерации» (project.documents.version).
 */
import type { Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { buildAssemblyDocument } from './assembly';
import { buildPartsDocument, buildPartPage } from './part';
import { buildCuttingDocument } from './cutting';
import { buildSpecificationDocument } from './specification';
import { buildPartsListDocument } from './partsList';
import { buildHardwareListDocument } from './hardwareList';
import { buildProjectSummaryDocument } from './summary';
import { buildProductionReport } from './report';
import type { DocumentType, DrawingDocument } from './sheet';

export type DocumentStatus = 'CURRENT' | 'OUTDATED' | 'GENERATING' | 'ERROR';

export interface DocumentDescriptor {
  key: string;
  type: DocumentType;
  title: string;
}

/**
 * Порядок документов в комплекте (§25): титульная/итоговая → сборочный →
 * спецификации → чертежи деталей → присадка → карта раскроя. specification и
 * report сохранены для обратной совместимости.
 */
export const DOCUMENT_LIST: DocumentDescriptor[] = [
  { key: 'summary', type: 'PROJECT_SUMMARY', title: 'Итоговая информация' },
  { key: 'assembly', type: 'ASSEMBLY_DRAWING', title: 'Сборочный чертёж' },
  { key: 'partsList', type: 'PARTS_LIST', title: 'Спецификация деталей' },
  { key: 'hardwareList', type: 'HARDWARE_LIST', title: 'Спецификация фурнитуры' },
  { key: 'parts', type: 'PART_DRAWING', title: 'Чертежи деталей' },
  { key: 'machining', type: 'MACHINING_DRAWING', title: 'Присадка' },
  { key: 'cutting', type: 'CUTTING_DRAWING', title: 'Карта раскроя' },
  { key: 'specification', type: 'SPECIFICATION', title: 'Спецификация (сводная)' },
  { key: 'report', type: 'PRODUCTION_REPORT', title: 'Производственный отчёт' },
];

/** Присадка как отдельный документ: страницы только деталей с операциями. */
function buildMachiningDocument(project: Project): DrawingDocument {
  const ops = allOperations(project);
  const parts = allParts(project).filter((p) => p.metadata?.hidden !== true && ops.some((o) => o.partId === p.id));
  const pages = parts.map((part, i) => buildPartPage(project, part, ops.filter((o) => o.partId === part.id), i + 1, parts.length));
  if (pages.length === 0) {
    return { id: `doc-machining-${project.id}`, type: 'MACHINING_DRAWING', projectId: project.id, title: 'Присадка', pages: buildPartsDocument(project).pages.slice(0, 1) };
  }
  return { id: `doc-machining-${project.id}`, type: 'MACHINING_DRAWING', projectId: project.id, title: 'Присадка', pages };
}

/** Построить документ по ключу. */
export function buildDocument(project: Project, key: string): DrawingDocument {
  switch (key) {
    case 'summary': return buildProjectSummaryDocument(project);
    case 'assembly': return buildAssemblyDocument(project);
    case 'partsList': return buildPartsListDocument(project);
    case 'hardwareList': return buildHardwareListDocument(project);
    case 'parts': return buildPartsDocument(project);
    case 'machining': return buildMachiningDocument(project);
    case 'cutting': return buildCuttingDocument(project);
    case 'specification': return buildSpecificationDocument(project);
    case 'report': return buildProductionReport(project);
    default: throw new Error(`Неизвестный документ: ${key}`);
  }
}

export function buildAllDocuments(project: Project): DrawingDocument[] {
  return DOCUMENT_LIST.map((d) => buildDocument(project, d.key));
}

/** Сигнатура модели, влияющей на документы (для OUTDATED). */
export function documentsSignature(project: Project): string {
  const parts = allParts(project)
    .map((p) => `${p.id}:${p.width}x${p.height}x${p.thickness}:${p.material}:${p.quantity}:${p.edges.left}${p.edges.right}${p.edges.top}${p.edges.bottom}:${p.machining.length}`)
    .sort();
  const ops = allOperations(project).map((o) => `${o.partId}:${o.type}:${Math.round(o.x)}:${Math.round(o.y)}:${o.diameter}:${o.depth}`).sort();
  const mats = project.materials.map((m) => `${m.id}:${m.name}:${m.thickness}`).sort();
  const conns = project.hardwareConnections.map((c) => `${c.hardwareId}:${c.partAId}:${c.partBId}`).sort();
  const cut = project.cutting.report ? project.cutting.report.sourceVersion : 'none';
  const raw = [...parts, '#', ...ops, '#', ...mats, '#', ...conns, '#', `cut:${cut}`, `name:${project.name}`].join('|');
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** Устарели ли документы относительно текущей модели. */
export function isDocumentsOutdated(project: Project): boolean {
  return project.documents.version !== documentsSignature(project);
}

export function documentStatus(project: Project): DocumentStatus {
  return isDocumentsOutdated(project) ? 'OUTDATED' : 'CURRENT';
}

// ─────────────────────────────────────────────────────────────────────────────
// DocumentModel — формальная модель документа с метаданными и статусом.
// ─────────────────────────────────────────────────────────────────────────────

/** Метаданные одного документа (id, тип, версия, статус, источник). */
export interface DocumentMeta {
  id: string;
  key: string;
  type: DocumentType;
  title: string;
  projectId: string;
  generatedAt: string;
  sourceModelVersion: string;
  version: string; // версия комплекта документов (1.0 → 1.1)
  status: DocumentStatus;
}

export interface DocumentModelEntry {
  meta: DocumentMeta;
  doc: DrawingDocument;
}

/** DocumentModel — весь комплект документов проекта с метаданными. */
export interface DocumentModel {
  projectId: string;
  version: string;
  generatedAt: string;
  sourceModelVersion: string;
  status: DocumentStatus;
  documents: DocumentModelEntry[];
}

/** Построить формальную модель документов из производственной модели. */
export function buildDocumentModel(project: Project): DocumentModel {
  const sourceModelVersion = documentsSignature(project);
  const status = documentStatus(project);
  const version = project.documents.docVersion ?? '1.0';
  const generatedAt = new Date().toISOString();

  const documents: DocumentModelEntry[] = DOCUMENT_LIST.map((d) => {
    const doc = buildDocument(project, d.key);
    return {
      meta: {
        id: doc.id,
        key: d.key,
        type: d.type,
        title: d.title,
        projectId: String(project.id),
        generatedAt,
        sourceModelVersion,
        version,
        status,
      },
      doc,
    };
  });

  return { projectId: String(project.id), version, generatedAt, sourceModelVersion, status, documents };
}

/** Следующая версия комплекта документов: 1.0 → 1.1 → … (major при .9 → +1.0). */
export function nextDocVersion(prev: string | undefined): string {
  if (!prev) return '1.0';
  const m = /^(\d+)\.(\d+)$/.exec(prev);
  if (!m) return '1.0';
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return minor >= 9 ? `${major + 1}.0` : `${major}.${minor + 1}`;
}
