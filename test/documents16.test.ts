/**
 * ЭТАП 16 — Чертежи и производственная документация.
 * Цепочка: ProjectModel → DocumentModel → Drawing/Specification → PDF/SVG/PNG.
 *
 * Проверяет модель документа и чертежа, лист и основную надпись, размеры,
 * аннотации и выноски, все типы документов, валидатор, статусы и версии,
 * кэш, экспорт (SVG/PNG/PDF/CSV/JSON), предпросмотр, поиск и связи с 3D,
 * раскроем и присадкой.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import {
  ALL_VIEWS,
  DOCUMENT_LIST,
  DEFAULT_VIEWS,
  EDGE_CODES,
  EDGE_SIDE_ORDER,
  PART_FILTERS,
  STANDARD_SCALES,
  USER_FORMATS,
  VIEW_LABELS,
  buildAllDocuments,
  buildAssemblyDocument,
  buildDocument,
  buildDocumentCached,
  buildDocumentModel,
  buildGeneralViewDocument,
  buildHardwareListDocument,
  buildMachiningListDocument,
  buildMaterialListDocument,
  buildPartsDocument,
  buildPartsListDocument,
  buildCuttingDocument,
  buildTitlePageDocument,
  clearDocumentCache,
  contentArea,
  cuttingListCsv,
  datumForFace,
  dimensionBox,
  dimensionsOverlap,
  documentCacheKey,
  documentCacheKeyParts,
  documentCacheSize,
  documentFileName,
  documentStatus,
  documentToSvgPages,
  documentsSignature,
  edgeCode,
  edgeValue,
  exportFileName,
  exportWarnings,
  filterParts,
  fmtMm,
  grainAlongHeight,
  grainNotation,
  hDim,
  hardwareListCsv,
  holeNotation,
  isDocumentsOutdated,
  layoutDimensions,
  machiningListCsv,
  machiningListRows,
  materialListCsv,
  materialListRows,
  matchesPartFilter,
  nextDocVersion,
  operationDatum,
  partMaterialNotation,
  partsListCsv,
  partsListRows,
  pdfPreflight,
  positionNumbers,
  projectJson,
  renderPageSvg,
  scaleLabel,
  searchDocuments,
  sheetSize,
  titleBlockPrims,
  titlePageMaterials,
  validateDocumentModel,
  validateDrawing,
  validateModelLinks,
  vDim,
} from '@/engines/drawing';
import { pdfPageCountLabel } from '@/features/documents/print';
import { svgSizeMm } from '@/features/documents/png';
import { deserializeProject } from '@/storage/project/serialization';
import { isCuttingStale } from '@/engines/cutting';
import { allOperations } from '@/engines/machining';
import type { Part, Project } from '@/core/model/types';
import type { PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;
const parts = () => allParts(project());
const svgOf = (key: string) => documentToSvgPages(buildDocument(project(), key)).join('');

/** Тестовый шкаф 800×2000×600, 16 мм, 4 полки, 1 перегородка, 2 фасада (§66). */
function makeCabinet(): string {
  store().newProject('Тест 16');
  const res = store().createFromTemplate('tpl-cabinet', {
    width: 800, height: 2000, depth: 600, materialThickness: 16, backThickness: 3,
    shelfCount: 4, verticalPartitionCount: 1, doorCount: 2, doorGap: 3,
    backType: 'inset', jointType: 'confirmat', handleEnabled: true,
  });
  expect(res.ok).toBe(true);
  return res.id!;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('Документы 16 — модель документа и чертежа', () => {
  beforeEach(() => { clearDocumentCache(); makeCabinet(); });

  it('Тест 1: Document — id, projectId, тип, версия, статус, даты', () => {
    const model = buildDocumentModel(project());
    expect(model.documents.length).toBeGreaterThan(0);
    for (const entry of model.documents) {
      expect(entry.meta.id).toBeTruthy();
      expect(entry.meta.projectId).toBe(String(project().id));
      expect(entry.meta.type).toBeTruthy();
      expect(entry.meta.version).toBeTruthy();
      expect(['CURRENT', 'OUTDATED', 'GENERATING', 'ERROR']).toContain(entry.meta.status);
      expect(Number.isFinite(Date.parse(entry.meta.generatedAt))).toBe(true);
    }
  });

  it('Тест 2: DocumentModel — sourceModelVersion совпадает с сигнатурой модели', () => {
    const model = buildDocumentModel(project());
    expect(model.sourceModelVersion).toBe(documentsSignature(project()));
    for (const e of model.documents) {
      expect(e.meta.sourceModelVersion).toBe(model.sourceModelVersion);
    }
  });

  it('Тест 3: Drawing — страницы, сцена, масштаб, привязка к листу', () => {
    const doc = buildDocument(project(), 'parts');
    expect(doc.pages.length).toBeGreaterThan(0);
    for (const page of doc.pages) {
      expect(page.scene.prims.length).toBeGreaterThan(0);
      expect(page.format).toBeTruthy();
      expect(page.orientation).toBeTruthy();
      expect(page.title).toBeTruthy();
    }
  });

  it('Тест 4: DrawingSheet — A4/A3/A2 и ориентация', () => {
    expect(USER_FORMATS).toEqual(['A4', 'A3', 'A2']);
    const a4 = sheetSize('A4', 'LANDSCAPE');
    const a3 = sheetSize('A3', 'LANDSCAPE');
    const a2 = sheetSize('A2', 'LANDSCAPE');
    expect(a4).toEqual({ w: 297, h: 210 });
    expect(a3.w).toBeGreaterThan(a4.w);
    expect(a2.w).toBeGreaterThan(a3.w);
    // Портретная ориентация меняет стороны местами.
    expect(sheetSize('A4', 'PORTRAIT')).toEqual({ w: 210, h: 297 });
    // Рабочая область меньше листа (поля + штамп).
    const area = contentArea('A3', 'LANDSCAPE');
    expect(area.w).toBeLessThan(a3.w);
    expect(area.h).toBeLessThan(a3.h);
  });

  it('Тест 5: TitleBlock — проект, деталь, материал, масштаб, лист, дата, версия', () => {
    const doc = buildDocument(project(), 'parts');
    const tb = doc.pages[0].title;
    expect(tb.project).toBe(project().name);
    expect(tb.title).toBeTruthy();
    expect(tb.material).toBeTruthy();
    expect(tb.scale).toMatch(/^\d+:\d+$/);
    expect(tb.sheet).toBe(1);
    expect(tb.sheetsTotal).toBe(doc.pages.length);
    expect(tb.date).toBeTruthy();
    // Все поля штампа попадают в примитивы.
    const prims = titleBlockPrims(420, 297, { ...tb, revision: 'Rev. 1.0' });
    const texts = prims.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text);
    expect(texts).toContain('Проект');
    expect(texts).toContain('Материал');
    expect(texts).toContain('Масштаб');
    expect(texts).toContain('Лист');
    expect(texts).toContain('Дата');
    expect(texts).toContain('Rev. 1.0');
  });

  it('Тест 6: DimensionRenderer — горизонтальный, вертикальный и наклонный размер', () => {
    const h = hDim(0, 800, 0, 12);
    const v = vDim(0, 2000, 0, 12);
    const aligned = { type: 'ALIGNED' as const, x1: 0, y1: 0, x2: 100, y2: 100, value: 141.4, offset: 10 };
    for (const d of [h, v, aligned]) {
      const box = dimensionBox(d);
      expect(box.x2).toBeGreaterThan(box.x1);
      expect(box.y2).toBeGreaterThan(box.y1);
    }
    expect(h.value).toBe(800);
    expect(v.value).toBe(2000);
  });

  it('Тест 7/35: аннотации и раскладка — размеры не накладываются', () => {
    // Три одинаковых размера с одним выносом заведомо пересекаются…
    const raw = [hDim(0, 800, 0, 12), hDim(0, 800, 0, 12), hDim(0, 800, 0, 12)];
    expect(dimensionsOverlap(raw)).toBe(true);
    // …после раскладки — нет.
    const laid = layoutDimensions(raw);
    expect(dimensionsOverlap(laid)).toBe(false);
    expect(laid[1].offset).toBeGreaterThan(laid[0].offset);
  });

  it('Тест 8: Balloon — позиция ссылается на partId, а не заменяет его', () => {
    const doc = buildAssemblyDocument(project());
    const map = doc.metadata?.positionToPart as Record<string, string>;
    expect(map).toBeTruthy();
    expect(Object.keys(map).length).toBeGreaterThan(0);
    const positions = positionNumbers(project());
    for (const [pos, partId] of Object.entries(map)) {
      const part = parts().find((p) => String(p.id) === partId);
      expect(part).toBeDefined();
      expect(positions.get(part!.id)).toBe(Number(pos));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Документы 16 — типы документов', () => {
  beforeEach(() => { clearDocumentCache(); makeCabinet(); });

  it('Тест 9: Assembly Drawing — изделие, размеры, номера, фурнитура', () => {
    const doc = buildAssemblyDocument(project());
    expect(doc.type).toBe('ASSEMBLY_DRAWING');
    expect(doc.pages).toHaveLength(1);
    const svg = renderPageSvg(doc.pages[0]);
    expect(svg).toContain('<rect');
    // Габариты изделия подписаны реальными значениями модели.
    expect(svg).toContain('>800<');
    expect(svg).toContain('>2000<');
    expect(doc.metadata?.connectionCount).toBe(project().hardwareConnections.length);
  });

  it('Тест 10: Part Drawing — по странице на деталь, привязка partId', () => {
    const doc = buildPartsDocument(project());
    expect(doc.type).toBe('PART_DRAWING');
    const visible = parts().filter((p) => p.metadata?.hidden !== true);
    expect(doc.pages).toHaveLength(visible.length);
    for (const page of doc.pages) expect(page.partId).toBeTruthy();
  });

  it('Тест 11: Parts List — все колонки спецификации (§23)', () => {
    const rows = partsListRows(project());
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.position).toBeGreaterThan(0);
      expect(r.ids).toBeTruthy();
      expect(r.name).toBeTruthy();
      expect(r.quantity).toBeGreaterThan(0);
      expect(r.length).toBeGreaterThan(0);
      expect(r.width).toBeGreaterThan(0);
      expect(r.thickness).toBeGreaterThan(0);
      expect(typeof r.material).toBe('string');
      expect(typeof r.edge).toBe('string');
      expect(typeof r.note).toBe('string');
    }
    expect(buildPartsListDocument(project()).type).toBe('PARTS_LIST');
  });

  it('Тест 12: Hardware List — производитель/модель не выдумываются (§24)', () => {
    const doc = buildHardwareListDocument(project());
    expect(doc.type).toBe('HARDWARE_LIST');
    const csv = hardwareListCsv(project());
    const header = csv.split('\n')[0];
    expect(header).toContain('Наименование');
    expect(header).toContain('Количество');
    // Артикул может быть пустым — но не придуманным.
    for (const line of csv.split('\n').slice(1)) {
      expect(line).not.toMatch(/(?:ООО|LLC|GmbH|Blum|Hettich)/);
    }
  });

  it('Тест 13: Material List — материал, толщина, детали, площадь (§25)', () => {
    const rows = materialListRows(project());
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.material).toBeTruthy();
      expect(r.thickness).toBeGreaterThan(0);
      expect(r.partCount).toBeGreaterThan(0);
      expect(r.areaM2).toBeGreaterThan(0);
    }
    // Общая площадь совпадает с суммой площадей деталей.
    const total = parts().reduce((n, p) => n + (p.width * p.height * p.quantity) / 1_000_000, 0);
    const sum = rows.reduce((n, r) => n + r.areaM2, 0);
    expect(sum).toBeCloseTo(total, 6);
    expect(buildMaterialListDocument(project()).type).toBe('MATERIAL_LIST');
  });

  it('Тест 14: Machining List — колонки и связь с фурнитурой (§26)', () => {
    const rows = machiningListRows(project());
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.operationId).toBeTruthy();
      expect(r.partId).toBeTruthy();
      expect(r.type).toBeTruthy();
      expect(r.face).toBeTruthy();
      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.y)).toBe(true);
      expect(r.notation).toBeTruthy();
    }
    // Хотя бы часть операций связана с соединением и фурнитурой.
    expect(rows.some((r) => r.connection !== '')).toBe(true);
    expect(rows.some((r) => r.hardware !== '')).toBe(true);
    expect(buildMachiningListDocument(project()).type).toBe('MACHINING_LIST');
    // Число строк = число операций модели: присадка не пересчитывается (§13).
    expect(rows.length).toBe(allOperations(project()).length);
  });

  it('Тест 15: Cutting Layout — использует существующий CuttingResult (§27)', async () => {
    // Без расчёта раскроя документ есть, но карты в нём нет.
    expect(project().cutting.report).toBeUndefined();
    await store().recalculateCutting();
    expect(project().cutting.report).toBeDefined();
    const doc = buildCuttingDocument(project());
    expect(doc.type).toBe('CUTTING_LAYOUT');
    expect(doc.pages.length).toBeGreaterThan(0);
    // Число листов документа не превышает числа листов отчёта раскроя.
    const sheets = project().cutting.report!.jobs.reduce((n: number, j) => n + j.sheets.length, 0);
    expect(doc.pages.length).toBeLessThanOrEqual(sheets + 1);
  });

  it('Тест 16: титульная страница — проект, дата, версия, детали, материалы (§30)', () => {
    const doc = buildTitlePageDocument(project());
    expect(doc.type).toBe('TITLE_PAGE');
    const svg = renderPageSvg(doc.pages[0]);
    expect(svg).toContain(project().name);
    expect(svg).toContain('Дата');
    expect(svg).toContain('Версия документации');
    expect(svg).toContain('Материалы');
    // Рекламы в документации нет.
    expect(svg).not.toMatch(/реклам|подписк|premium|Premium/i);
    const mats = titlePageMaterials(project());
    expect(mats.length).toBeGreaterThan(0);
  });

  it('Тест 17: общий вид — выбираемые виды и подписи (§9)', () => {
    const all = buildGeneralViewDocument(project(), { views: [...ALL_VIEWS] });
    const svgAll = renderPageSvg(all.pages[0]);
    for (const v of ALL_VIEWS) expect(svgAll).toContain(VIEW_LABELS[v]);
    // Только два вида — на чертеже только они.
    const two = buildGeneralViewDocument(project(), { views: ['FRONT', 'TOP'] });
    const svgTwo = renderPageSvg(two.pages[0]);
    expect(svgTwo).toContain(VIEW_LABELS.FRONT);
    expect(svgTwo).toContain(VIEW_LABELS.TOP);
    expect(svgTwo).not.toContain(VIEW_LABELS.ISOMETRIC);
    expect(two.metadata?.views).toEqual(['FRONT', 'TOP']);
    // По умолчанию — базовый набор видов.
    expect(buildGeneralViewDocument(project()).metadata?.views).toEqual(DEFAULT_VIEWS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Документы 16 — размеры, присадка, кромка, текстура', () => {
  beforeEach(() => { clearDocumentCache(); makeCabinet(); });

  it('Тест 18/33: габаритные размеры берутся из PartModel', () => {
    const side = parts().find((p) => p.metadata?.partType === 'side_left')!;
    const doc = buildPartsDocument(project(), { onlyPartId: String(side.id) });
    const svg = renderPageSvg(doc.pages[0]);
    // Ширина, высота и толщина детали подписаны реальными значениями.
    expect(svg).toContain(`>${fmtMm(side.width)}<`);
    expect(svg).toContain(`>${fmtMm(side.height)}<`);
    expect(svg).toContain(`>${fmtMm(side.thickness)}<`);
  });

  it('Тест 19: точность — 153.5 не округляется до целого (§33)', () => {
    expect(fmtMm(16)).toBe('16');
    expect(fmtMm(800)).toBe('800');
    expect(fmtMm(153.5)).toBe('153.5');
    expect(fmtMm(0.4)).toBe('0.4');
    const id = store().addPart({ name: 'Дробная', width: 153.5, height: 400, thickness: 16 });
    const part = findPart(project(), id)!;
    const doc = buildPartsDocument(project(), { onlyPartId: String(id) });
    expect(renderPageSvg(doc.pages[0])).toContain('>153.5<');
    expect(part.width).toBe(153.5);
  });

  it('Тест 20/30/67: присадка на чертеже — Ø, глубина, координаты, база', () => {
    const side = parts().find((p) => p.metadata?.partType === 'side_left')!;
    const ops = allOperations(project()).filter((o) => o.partId === side.id);
    expect(ops.length).toBeGreaterThan(0);
    const doc = buildPartsDocument(project(), { onlyPartId: String(side.id) });
    const svg = renderPageSvg(doc.pages[0]);
    // Единый формат обозначения (§15).
    expect(holeNotation({ diameter: 5, through: true, type: 'drilling' })).toBe('Ø5 THRU');
    expect(holeNotation({ diameter: 8, depth: 12, through: false, type: 'dowel' })).toBe('Ø8 × 12');
    const through = ops.find((o) => o.through);
    if (through) expect(svg).toContain(`Ø${fmtMm(through.diameter!)} THRU`);
    // Базы назначены по правилу, а не случайно (§14).
    expect(datumForFace('front')).toBe('B');
    expect(datumForFace('back')).toBe('B');
    expect(datumForFace('left')).toBe('C');
    expect(datumForFace('top')).toBe('C');
    for (const op of ops) expect(['A', 'B', 'C']).toContain(operationDatum(op));
    expect(svg).toContain('База');
  });

  it('Тест 21/32/68: кромка — единый формат L1–L4 на чертеже, в спецификации и CSV', () => {
    expect(EDGE_SIDE_ORDER).toEqual(['bottom', 'right', 'top', 'left']);
    expect(EDGE_CODES).toEqual({ bottom: 'L1', right: 'L2', top: 'L3', left: 'L4' });

    // Деталь 800×400 с кромкой: верх 2, низ 1, лево 1, право 1.
    const e2 = project().edges.find((e) => e.thickness === 2)!;
    const e1 = project().edges.find((e) => e.thickness === 1)!;
    const id = store().addPart({ name: 'Кромленая', width: 800, height: 400, thickness: 16 });
    store().updatePart(id, { edges: { top: e2.id, bottom: e1.id, left: e1.id, right: e1.id } });
    const part = findPart(project(), id)!;

    // Один и тот же формат везде: L1/L2/L3/L4 = низ/право/верх/лево.
    expect(edgeCode(project(), part)).toBe('1/1/2/1');
    expect(edgeValue(project(), part, 'top')).toBe('2');
    expect(edgeValue(project(), part, 'bottom')).toBe('1');

    const svg = renderPageSvg(buildPartsDocument(project(), { onlyPartId: String(id) }).pages[0]);
    for (const code of Object.values(EDGE_CODES)) expect(svg).toContain(code);

    const row = partsListRows(project()).find((r) => r.name === 'Кромленая')!;
    expect(row.edge).toBe('1/1/2/1');
    expect(partsListCsv(project())).toContain('1/1/2/1');
  });

  it('Тест 22/31/69: направление текстуры — стрелка GRAIN', () => {
    const id = store().addPart({ name: 'Вертикальная', width: 400, height: 800, thickness: 16 });
    store().updatePart(id, { grain: 'length' });
    const vertical = findPart(project(), id)!;
    // Длинная сторона — высота, текстура вдоль неё → вертикально.
    expect(grainAlongHeight(vertical)).toBe(true);
    expect(grainNotation(vertical)).toBe('GRAIN ↑');
    expect(renderPageSvg(buildPartsDocument(project(), { onlyPartId: String(id) }).pages[0]))
      .toContain('GRAIN ↑');

    store().updatePart(id, { grain: 'width' });
    expect(grainNotation(findPart(project(), id)!)).toBe('GRAIN →');
    store().updatePart(id, { grain: 'none' });
    expect(grainNotation(findPart(project(), id)!)).toBeNull();
  });

  it('Тест 23: материал в основной надписи — «ЛДСП 16 мм» (§17)', () => {
    const side = parts().find((p) => p.metadata?.partType === 'side_left')!;
    const notation = partMaterialNotation(project(), side);
    expect(notation).toMatch(/16 мм$/);
    const doc = buildPartsDocument(project(), { onlyPartId: String(side.id) });
    expect(doc.pages[0].title.material).toBe(notation);
  });

  it('Тест 24: дополнительные виды детали 800×400×16 (§11)', () => {
    const id = store().addPart({ name: 'Щит', width: 800, height: 400, thickness: 16 });
    const svg = renderPageSvg(buildPartsDocument(project(), { onlyPartId: String(id) }).pages[0]);
    // Основной вид 800×400 плюс дополнительные по толщине.
    expect(svg).toContain('вид сверху 800 × 16');
    expect(svg).toContain('вид сбоку 400 × 16');
  });

  it('Тест 25: масштаб — стандартный ряд и подписи (§10)', () => {
    const values = STANDARD_SCALES.map((s) => s.value);
    expect(values).toContain('AUTO');
    expect(values).toContain(2);
    expect(values).toContain(1);
    expect(values).toContain(0.5);
    expect(values).toContain(0.1);
    expect(scaleLabel(1)).toBe('1:1');
    expect(scaleLabel(0.5)).toBe('1:2');
    expect(scaleLabel(0.1)).toBe('1:10');
    expect(scaleLabel(2)).toBe('2:1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Документы 16 — статусы, версии, валидация, кэш', () => {
  beforeEach(() => { clearDocumentCache(); makeCabinet(); });

  it('Тест 26: DocumentValidator — корректный проект без ошибок (§57)', () => {
    const model = buildDocumentModel(project());
    const issues = validateDocumentModel(model, project());
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    // Каждый документ по отдельности тоже валиден.
    for (const e of model.documents) {
      expect(validateDrawing(e.doc).filter((i) => i.severity === 'error')).toHaveLength(0);
    }
  });

  it('Тест 27: DocumentValidator ловит битые размеры и потерянный материал', () => {
    const id = parts()[0].id;
    store().updatePart(id, { width: 0 });
    const issues = validateModelLinks(project());
    expect(issues.some((i) => i.code === 'drw.badSize')).toBe(true);
  });

  it('Тест 28/70: изменение модели → OUTDATED, генерация → CURRENT', () => {
    store().generateDocuments();
    expect(isDocumentsOutdated(project())).toBe(false);
    expect(documentStatus(project())).toBe('CURRENT');

    // 800 → 1000 (§70).
    const side = parts().find((p) => p.metadata?.partType === 'side_left')!;
    store().updatePart(side.id, { width: 1000 });
    expect(isDocumentsOutdated(project())).toBe(true);
    expect(documentStatus(project())).toBe('OUTDATED');

    store().generateDocuments();
    expect(documentStatus(project())).toBe('CURRENT');
  });

  it('Тест 29/71: камера и 3D-вид НЕ делают документацию OUTDATED (§54)', () => {
    store().generateDocuments();
    const before = documentsSignature(project());
    store().setViewer({ displayMode: 'wireframe', showGrid: false, showAxes: true, showDimensions: true });
    store().selectPart(parts()[0].id);
    expect(documentsSignature(project())).toBe(before);
    expect(isDocumentsOutdated(project())).toBe(false);
  });

  it('Тест 30/37: оформление не меняет модель и не делает документы OUTDATED', () => {
    store().generateDocuments();
    const modelBefore = documentsSignature(project());
    const partsBefore = JSON.stringify(parts());

    store().setDocumentScale('parts', 0.5);
    store().setDocumentFormat('parts', 'A4');
    store().setDocumentViews(['FRONT', 'TOP']);
    store().moveDocumentElement('dim-1', 5, -3);
    store().addDocumentNote('parts', { x: 10, y: 10, text: 'Проверить кромку' });

    // Модель деталей не изменилась, документы остались CURRENT.
    expect(JSON.stringify(parts())).toBe(partsBefore);
    expect(documentsSignature(project())).toBe(modelBefore);
    expect(isDocumentsOutdated(project())).toBe(false);
  });

  it('Тест 31/38/39: LOCK и «Сбросить оформление» (§38/§39)', () => {
    store().moveDocumentElement('dim-1', 5, -3);
    const layout = project().documents.settings!.layout!;
    // Ручная правка фиксирует элемент.
    expect(layout.moved['dim-1']).toEqual({ dx: 5, dy: -3 });
    expect(layout.locked['dim-1']).toBe(true);

    store().lockDocumentElement('dim-1', false);
    expect(project().documents.settings!.layout!.locked['dim-1']).toBeUndefined();

    store().setDocumentScale('parts', 0.5);
    store().resetDocumentLayout();
    const s = project().documents.settings!;
    expect(s.scaleOverrides).toEqual({});
    expect(s.layout!.moved).toEqual({});
    expect(s.views).toBeUndefined();
  });

  it('Тест 32/18: версия документа растёт только при генерации (§56)', () => {
    expect(nextDocVersion(undefined)).toBe('1.0');
    expect(nextDocVersion('1.0')).toBe('1.1');
    expect(nextDocVersion('1.9')).toBe('2.0');

    store().generateDocuments();
    const v1 = project().documents.docVersion;
    // Вращение камеры версию не двигает.
    store().setViewer({ showGrid: false });
    expect(project().documents.docVersion).toBe(v1);
    store().generateDocuments();
    expect(project().documents.docVersion).not.toBe(v1);
  });

  it('Тест 33/19: кэш — ключ учитывает модель, тип, настройки и layoutVersion (§55)', () => {
    clearDocumentCache();
    const a = buildDocumentCached(project(), 'parts', buildDocument);
    expect(documentCacheSize()).toBe(1);
    // Повторный запрос при тех же входных данных отдаёт тот же объект.
    expect(buildDocumentCached(project(), 'parts', buildDocument)).toBe(a);

    const keyBefore = documentCacheKey(project(), 'parts');
    // Смена настроек оформления меняет ключ.
    store().setDocumentScale('parts', 0.5);
    expect(documentCacheKey(project(), 'parts')).not.toBe(keyBefore);
    // Смена модели тоже.
    const withScale = documentCacheKey(project(), 'parts');
    store().updatePart(parts()[0].id, { width: 999 });
    expect(documentCacheKey(project(), 'parts')).not.toBe(withScale);

    const partsKey = documentCacheKeyParts(project(), 'parts');
    expect(partsKey.documentType).toBe('parts');
    expect(partsKey.projectModelVersion).toBe(documentsSignature(project()));
    expect(partsKey.layoutVersion).toBeGreaterThanOrEqual(0);
    // Разные документы — разные ключи.
    expect(documentCacheKey(project(), 'parts')).not.toBe(documentCacheKey(project(), 'assembly'));
  });

  it('Тест 34/72: изменение детали → раскрой DIRTY и документы OUTDATED', async () => {
    await store().recalculateCutting();
    store().generateDocuments();
    expect(isCuttingStale(project())).toBe(false);
    expect(isDocumentsOutdated(project())).toBe(false);

    store().updatePart(parts()[0].id, { width: 1234 });
    expect(isCuttingStale(project())).toBe(true);
    expect(isDocumentsOutdated(project())).toBe(true);

    // Устаревший раскрой блокирует экспорт производственного комплекта (§58).
    expect(validateModelLinks(project()).some((i) => i.code === 'drw.cuttingStale')).toBe(true);
    const w = exportWarnings(project());
    expect(w.documentsOutdated).toBe(true);
    expect(w.cuttingStale).toBe(true);
    expect(w.messages).toContain('Раскрой требует перерасчёта.');
    expect(w.messages).toContain('Документация требует обновления.');

    await store().recalculateCutting();
    store().generateDocuments();
    expect(isCuttingStale(project())).toBe(false);
    expect(isDocumentsOutdated(project())).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Документы 16 — экспорт, предпросмотр, поиск, интеграции', () => {
  beforeEach(() => { clearDocumentCache(); makeCabinet(); });

  it('Тест 35/20/73: SVG — настоящий вектор с линиями, текстом и таблицами', () => {
    const svg = svgOf('parts');
    expect(svg).toContain('<svg');
    expect(svg).toContain('<line');
    expect(svg).toContain('<rect');
    expect(svg).toContain('<text');
    // Не растр и не скриншот.
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('base64');
    // Размеры листа в миллиметрах.
    expect(svg).toMatch(/width="[\d.]+mm"/);
    const size = svgSizeMm(documentToSvgPages(buildDocument(project(), 'parts'))[0]);
    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBeGreaterThan(0);
  });

  it('Тест 36/21: PNG — размеры листа берутся из отрендеренного SVG', () => {
    const page = documentToSvgPages(buildDocument(project(), 'assembly'))[0];
    const { w, h } = svgSizeMm(page);
    // A3 landscape — 420×297 мм.
    expect(w).toBeCloseTo(420, 1);
    expect(h).toBeCloseTo(297, 1);
  });

  it('Тест 37/22/29: PDF — страницы собираются из DrawingModel, есть предпросмотр', () => {
    const model = buildDocumentModel(project());
    const pre = pdfPreflight(model);
    expect(pre.ok).toBe(true);
    expect(pre.pageCount).toBeGreaterThan(0);
    // Число страниц = сумма страниц документов, зависит от проекта (§29).
    const sum = model.documents.reduce((n: number, e) => n + e.doc.pages.length, 0);
    expect(pre.pageCount).toBe(sum);
    // Предпросмотр показывает количество страниц (§45).
    expect(pdfPageCountLabel(18)).toBe('PDF — 18 страниц');
    expect(pdfPageCountLabel(1)).toBe('PDF — 1 страница');
    expect(pdfPageCountLabel(3)).toBe('PDF — 3 страницы');
    // Комплект содержит титульную и обязательные документы.
    const types = model.documents.map((e) => e.doc.type);
    expect(types).toContain('TITLE_PAGE');
    expect(types).toContain('ASSEMBLY_DRAWING');
    expect(types).toContain('PARTS_LIST');
    expect(types).toContain('PART_DRAWING');
    expect(types).toContain('CUTTING_LAYOUT');
    expect(types).toContain('MACHINING_LIST');
    expect(types).toContain('HARDWARE_LIST');
    expect(types).toContain('MATERIAL_LIST');
  });

  it('Тест 38/23/47: CSV — пять ведомостей и предсказуемые имена файлов', () => {
    const csvs: Array<[string, string]> = [
      [partsListCsv(project()), 'Позиция,ID,Наименование'],
      [hardwareListCsv(project()), '№,ID,Наименование'],
      [machiningListCsv(project()), 'Operation ID,Part ID,Type,Face'],
      [materialListCsv(project()), 'Материал,Толщина,Количество деталей'],
      [cuttingListCsv(project()), 'Лист,P-ID,Наименование'],
    ];
    for (const [csv, header] of csvs) expect(csv.split('\n')[0]).toContain(header);

    // Имена файлов — от названия проекта, без случайных суффиксов (§47).
    expect(exportFileName('Шкаф', 'pdf')).toBe('Шкаф.pdf');
    expect(exportFileName('Шкаф', 'parts')).toBe('Шкаф_parts.csv');
    expect(exportFileName('Шкаф', 'hardware')).toBe('Шкаф_hardware.csv');
    expect(exportFileName('Шкаф', 'machining')).toBe('Шкаф_machining.csv');
    expect(exportFileName('Шкаф', 'materials')).toBe('Шкаф_materials.csv');
    expect(exportFileName('Шкаф', 'cutting')).toBe('Шкаф_cutting.csv');
    expect(exportFileName('Шкаф', 'json')).toBe('Шкаф.json');
    expect(exportFileName('Кухня / 2', 'parts')).toBe('Кухня_2_parts.csv');
    expect(documentFileName('Шкаф', 'Сборочный чертёж', 'svg')).toBe('Шкаф_Сборочный_чертёж.svg');
  });

  it('Тест 39/24: JSON — полная модель проекта, восстанавливается импортом (§49)', () => {
    const json = projectJson(project());
    const restored = deserializeProject(json);
    expect(restored).toEqual(project());
    // Данных рендера в модели нет.
    const raw = JSON.parse(json) as Record<string, unknown>;
    for (const key of ['camera', 'viewer', 'lights', 'grid', 'scene']) {
      expect(raw[key]).toBeUndefined();
    }
    // Урезанный экспорт тоже импортируется, но без производного отчёта раскроя.
    const lean = deserializeProject(projectJson(project(), { lean: true }));
    expect(lean.cutting.report).toBeUndefined();
    expect(allParts(lean)).toHaveLength(parts().length);
  });

  it('Тест 40/25/26/63/64: печать и предпросмотр — весь документ и одна деталь', () => {
    // Предпросмотр листает страницы (§59/§60).
    const doc = buildDocument(project(), 'parts');
    expect(doc.pages.length).toBeGreaterThan(1);
    const svgPages = documentToSvgPages(doc);
    expect(svgPages).toHaveLength(doc.pages.length);
    for (const p of svgPages) expect(p).toContain('<svg');

    // Печать всех деталей — один документ со всеми страницами (§64).
    const all = buildPartsDocument(project());
    expect(all.pages.length).toBe(parts().filter((p) => p.metadata?.hidden !== true).length);

    // Печать одной детали — ровно одна страница (§63).
    const one = buildPartsDocument(project(), { onlyPartId: String(parts()[0].id) });
    expect(one.pages).toHaveLength(1);
    expect(one.pages[0].partId).toBe(parts()[0].id);
  });

  it('Тест 41/27: поиск по Part ID, названию и позиции (§61)', () => {
    const side = parts().find((p) => p.metadata?.partType === 'side_left')!;
    const number = side.metadata?.number as string;

    const byId = searchDocuments(project(), number);
    expect(byId.length).toBeGreaterThan(0);
    expect(byId.every((h) => h.partId === String(side.id))).toBe(true);
    expect(byId[0].matchedBy).toBe('id');

    const byName = searchDocuments(project(), 'Полка');
    expect(byName.length).toBeGreaterThan(0);
    expect(byName[0].partName).toContain('Полка');

    const position = positionNumbers(project()).get(side.id)!;
    const byPos = searchDocuments(project(), String(position));
    expect(byPos.length).toBeGreaterThan(0);

    // Пустой запрос ничего не возвращает; несуществующий — тоже.
    expect(searchDocuments(project(), '   ')).toHaveLength(0);
    expect(searchDocuments(project(), 'нет-такой-детали')).toHaveLength(0);

    // Найденная страница действительно относится к этой детали.
    const hit = byId[0];
    const found = buildDocument(project(), hit.docKey);
    expect(String(found.pages[hit.pageIndex].partId)).toBe(hit.partId);
  });

  it('Тест 42/28: интеграция с 3D, раскроем и присадкой через partId (§50–§52)', async () => {
    await store().recalculateCutting();
    const side = parts().find((p) => p.metadata?.partType === 'side_left')!;

    // Чертёж → деталь: страница знает partId.
    const doc = buildPartsDocument(project(), { onlyPartId: String(side.id) });
    expect(doc.pages[0].partId).toBe(side.id);

    // Деталь → 3D: тот же partId выбирается в редакторе.
    store().selectPart(side.id as PartId);
    expect(store().selectedPartId).toBe(side.id);

    // Деталь → раскрой: деталь размещена на листе под своим номером.
    const number = side.metadata?.number as string;
    const placed = project().cutting.report!.jobs
      .flatMap((j) => j.sheets.flatMap((sh) => sh.placements))
      .some((pl) => pl.number === number);
    expect(placed).toBe(true);

    // Деталь → присадка: операции этой детали есть в ведомости.
    const rows = machiningListRows(project()).filter((r) => r.partId === number);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('Тест 43/65: фильтр деталей — корпус, фасады, полки, задняя стенка', () => {
    expect(PART_FILTERS.map((f) => f.key)).toEqual(
      ['all', 'carcass', 'facades', 'shelves', 'dividers', 'back', 'other'],
    );
    const list = parts();
    expect(filterParts(list, 'all')).toHaveLength(list.length);

    const facades = filterParts(list, 'facades');
    expect(facades.length).toBeGreaterThan(0);
    expect(facades.every((p) => p.role === 'facade')).toBe(true);

    const shelves = filterParts(list, 'shelves');
    expect(shelves.every((p) => p.role === 'shelf')).toBe(true);

    const carcass = filterParts(list, 'carcass');
    expect(carcass.every((p: Part) => ['side', 'top', 'bottom'].includes(p.role))).toBe(true);

    expect(matchesPartFilter(facades[0], 'facades')).toBe(true);
    expect(matchesPartFilter(facades[0], 'shelves')).toBe(false);

    // Фильтр влияет на число страниц деталировки, но не на модель.
    const before = parts().length;
    const filtered = buildPartsDocument(project(), { filter: 'facades' });
    expect(filtered.pages).toHaveLength(facades.length);
    expect(parts()).toHaveLength(before);
  });

  it('Тест 44/62: структура Document Center и полный комплект (§62/§66)', () => {
    const keys = DOCUMENT_LIST.map((d) => d.key);
    // Порядок основной структуры документации.
    expect(keys.slice(0, 10)).toEqual([
      'title', 'generalView', 'assembly', 'partsList', 'parts',
      'cutting', 'machiningList', 'hardwareList', 'materialList', 'summary',
    ]);
    // Все документы строятся без исключений и дают непустые страницы.
    const docs = buildAllDocuments(project());
    expect(docs).toHaveLength(DOCUMENT_LIST.length);
    for (const d of docs) {
      expect(d.pages.length).toBeGreaterThan(0);
      for (const page of d.pages) expect(page.scene.prims.length).toBeGreaterThan(0);
    }
  });

  it('Тест 45: пустой проект — документация строится без падений', () => {
    store().newProject('Пустой');
    for (const d of DOCUMENT_LIST) {
      const doc = buildDocument(project(), d.key);
      expect(doc.pages.length).toBeGreaterThanOrEqual(0);
      for (const page of doc.pages) expect(() => renderPageSvg(page)).not.toThrow();
    }
    const w = exportWarnings(project());
    expect(w.cuttingMissing).toBe(true);
  });
});
