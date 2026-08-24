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
  documentsSignature,
  isDocumentsOutdated,
  documentStatus,
  DOCUMENT_LIST,
  type DocumentStatus,
  type DocumentDescriptor,
} from './documents';
export { buildAssemblyDocument } from './assembly';
export { buildPartsDocument, buildPartPage } from './part';
export { buildCuttingDocument } from './cutting';
export { buildSpecificationDocument, groupParts } from './specification';
export { buildProductionReport } from './report';
