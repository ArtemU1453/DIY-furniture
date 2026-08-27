/** Публичный API движка чертежей и документации. */
export type { Scene2D, Prim } from './scene';
export type { Dimension, DimensionType } from './dimensions';
export { renderDimension, hDim, vDim, layoutDimensions, dimensionBox, dimensionsOverlap } from './dimensions';
export {
  type SheetFormat,
  type Orientation,
  type ScaleValue,
  type DocumentType,
  type DrawingDocument,
  type DrawingPage,
  type TitleBlock,
  type ViewName,
  sheetSize,
  contentArea,
  resolveScale,
  scaleLabel,
  titleBlockPrims,
  ALL_VIEWS,
  VIEW_LABELS,
  STANDARD_SCALES,
  USER_FORMATS,
} from './sheet';
export type {
  Drawing,
  DrawingSheet,
  DrawingView,
  Annotation,
  Balloon,
  DrawingTable,
} from './drawingModel';
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
  type DocumentSettings,
  documentSettings,
} from './documents';
export { buildTitlePageDocument, titlePageMaterials } from './titlePage';
export { buildGeneralViewDocument, DEFAULT_VIEWS, type GeneralViewOptions } from './generalView';
export { buildMaterialListDocument, materialListRows, type MaterialListRow } from './materialList';
export { buildMachiningListDocument, machiningListRows, type MachiningListRow } from './machiningList';
export {
  PART_FILTERS,
  filterParts,
  matchesPartFilter,
  type PartFilterKey,
} from './partFilter';
export {
  fmtMm,
  fmtMmUnit,
  holeNotation,
  datumForFace,
  operationDatum,
  DATUM_LABELS,
  EDGE_CODES,
  EDGE_SIDE_ORDER,
  EDGE_SIDE_LABELS,
  edgeCode,
  edgeValue,
  edgeThickness,
  hasAnyEdge,
  materialNotation,
  partMaterialNotation,
  grainNotation,
  grainAlongHeight,
} from './notation';
export {
  documentCacheKey,
  documentCacheKeyParts,
  getCachedDocument,
  setCachedDocument,
  clearDocumentCache,
  documentCacheSize,
  buildDocumentCached,
  type DocumentCacheKeyParts,
} from './cache';
export { searchDocuments, findPartPage, type DocumentSearchHit } from './search';
export {
  exportFileName,
  documentFileName,
  sanitizeFileName,
  type ExportKind,
} from './fileNames';
export { projectJson, projectJsonSize, type ProjectJsonOptions } from './json';
export { buildAssemblyDocument } from './assembly';
export {
  buildPartsDocument,
  buildPartPage,
  type PartsDocumentOptions,
  type PartPageOptions,
} from './part';
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
  exportWarnings,
  type DrawingIssue,
  type PdfPreflight,
  type ExportWarnings,
} from './validator';
export {
  planLayout,
  regionsOverlap,
  contentFits,
  MIN_READABLE_SCALE,
  type LayoutPlan,
  type LayoutRegion,
} from './layoutEngine';
export {
  partsListCsv,
  hardwareListCsv,
  cuttingListCsv,
  machiningListCsv,
  materialListCsv,
} from './csv';
