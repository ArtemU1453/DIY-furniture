/** Публичный API движка чертежей и документации. */
export type { Scene2D, Prim } from './scene';
export type { Dimension, DimensionType } from './dimensions';
export {
  type SheetFormat,
  type Orientation,
  type ScaleValue,
  type DocumentType,
  type DrawingDocument,
  type DrawingPage,
  type TitleBlock,
  sheetSize,
} from './sheet';
export { renderPageSvg, documentToSvgPages } from './svg';
export {
  buildDocument,
  buildAllDocuments,
  buildDocumentModel,
  nextDocVersion,
  documentsSignature,
  isDocumentsOutdated,
  documentStatus,
  DOCUMENT_LIST,
  type DocumentStatus,
  type DocumentDescriptor,
  type DocumentMeta,
  type DocumentModel,
  type DocumentModelEntry,
} from './documents';
export { buildAssemblyDocument } from './assembly';
export { buildPartsDocument, buildPartPage } from './part';
export { buildCuttingDocument } from './cutting';
export { buildSpecificationDocument, groupParts, tablePages } from './specification';
export { buildPartsListDocument, partsListRows, type PartsListRow } from './partsList';
export { buildHardwareListDocument, hardwareListRows, type HardwareListRow } from './hardwareList';
export { buildProjectSummaryDocument, projectSummaryData, type ProjectSummaryData } from './summary';
export { buildProductionReport } from './report';
export { positionNumbers } from './positions';
export {
  validateDrawing,
  validateModelLinks,
  validateDocumentModel,
  pdfPreflight,
  type DrawingIssue,
  type PdfPreflight,
} from './validator';
export {
  planLayout,
  regionsOverlap,
  contentFits,
  MIN_READABLE_SCALE,
  type LayoutPlan,
  type LayoutRegion,
} from './layoutEngine';
export { partsListCsv, hardwareListCsv, cuttingListCsv } from './csv';
