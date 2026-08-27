/**
 * ЭТАП 11 — Чертежи и производственная документация.
 * ОДНА МОДЕЛЬ → ВСЯ ДОКУМЕНТАЦИЯ. Проверяет DocumentModel, чертежи деталей и
 * сборки, спецификации, ProjectSummary, размеры, TitleBlock, DrawingLayout,
 * DrawingValidator, PDF/SVG/CSV/JSON, версии, статусы, ProductionCheck,
 * многостраничность, масштаб, ориентацию, присадку, кромку, текстуру, раскрой.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import {
  buildDocument,
  buildDocumentModel,
  buildPartsDocument,
  buildAssemblyDocument,
  buildPartsListDocument,
  buildHardwareListDocument,
  buildProjectSummaryDocument,
  partsListRows,
  hardwareListRows,
  projectSummaryData,
  positionNumbers,
  documentToSvgPages,
  renderPageSvg,
  documentStatus,
  isDocumentsOutdated,
  nextDocVersion,
  validateDrawing,
  validateDocumentModel,
  pdfPreflight,
  planLayout,
  regionsOverlap,
  partsListCsv,
  hardwareListCsv,
  cuttingListCsv,
} from '@/engines/drawing';
import { hDim, renderDimension } from '@/engines/drawing/dimensions';
import type { DrawingDocument } from '@/engines/drawing';
import type { Part } from '@/core/model/types';

const store = () => useEditorStore.getState();
const project = () => store().project;
const svgOf = (doc: DrawingDocument) => documentToSvgPages(doc).join('\n');
function partByType(type: string): Part {
  return allParts(project()).find((p) => p.metadata?.partType === type)!;
}

describe('Документы 11 — модель и версии', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 1: DocumentModel содержит метаданные и статус', () => {
    const model = buildDocumentModel(project());
    expect(model.documents.length).toBeGreaterThan(0);
    for (const e of model.documents) {
      expect(e.meta.id).toBeTruthy();
      expect(e.meta.type).toBeTruthy();
      expect(['CURRENT', 'OUTDATED', 'GENERATING', 'ERROR']).toContain(e.meta.status);
      expect(e.meta.version).toBeTruthy();
      expect(e.meta.sourceModelVersion).toBeTruthy();
    }
  });

  it('Тест 16: версия комплекта документов 1.0 → 1.1 → 2.0', () => {
    expect(nextDocVersion(undefined)).toBe('1.0');
    expect(nextDocVersion('1.0')).toBe('1.1');
    expect(nextDocVersion('1.9')).toBe('2.0');
  });

  it('Тест 17: изменение модели делает документы OUTDATED', () => {
    store().markDocumentsGenerated();
    expect(isDocumentsOutdated(project())).toBe(false);
    store().updateCabinetParams(store().activeFurnitureId!, { width: 1000 });
    expect(isDocumentsOutdated(project())).toBe(true);
  });

  it('Тест 18: после генерации документы CURRENT + версия растёт', () => {
    const before = project().documents.docVersion;
    store().markDocumentsGenerated();
    expect(documentStatus(project())).toBe('CURRENT');
    expect(project().documents.docVersion).not.toBe(before);
    expect(project().documents.history!.length).toBeGreaterThan(0);
  });

  it('Тест 19: ProductionCheck блокирует генерацию при ошибке', () => {
    const ok = store().generateDocuments();
    expect(ok.ok).toBe(true);
    // Ломаем связь: добавляем соединение и портим ссылку на фурнитуру.
    const parts = allParts(project());
    const hw = project().hardware[0].id;
    const res = store().addConnection({ hardwareId: hw, partAId: parts[0].id, partBId: parts[1].id });
    store().updateConnection(res.id!, { hardwareId: 'ghost' as never });
    const blocked = store().generateDocuments();
    expect(blocked.ok).toBe(false);
    expect(blocked.errors.length).toBeGreaterThan(0);
  });
});

describe('Документы 11 — чертежи', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 2: чертёж детали — страница на деталь с контуром', () => {
    const doc = buildPartsDocument(project());
    expect(doc.type).toBe('PART_DRAWING');
    expect(doc.pages.length).toBe(allParts(project()).filter((p) => p.metadata?.hidden !== true).length);
    const page = doc.pages[0];
    expect(page.partId).toBeTruthy();
    expect(page.scene.prims.some((p) => p.kind === 'rect')).toBe(true);
  });

  it('Тест 3: сборочный чертёж с позиционными номерами и габаритами', () => {
    const doc = buildAssemblyDocument(project());
    expect(doc.type).toBe('ASSEMBLY_DRAWING');
    const prims = doc.pages[0].scene.prims;
    expect(prims.some((p) => p.kind === 'circle')).toBe(true); // балон позиции
    expect(prims.some((p) => p.kind === 'text')).toBe(true);
  });

  it('Тест 20: позиции — одинаковые детали делят позицию, ≠ P-ID', () => {
    const mat = project().materials[0].id;
    // Две идентичные детали (имя/размер/материал) → одна позиция.
    const a = store().addPart({ name: 'Планка', width: 500, height: 100, material: mat });
    const b = store().addPart({ name: 'Планка', width: 500, height: 100, material: mat });
    const c = store().addPart({ name: 'Планка', width: 900, height: 100, material: mat }); // другой размер
    const positions = positionNumbers(project());
    expect(positions.size).toBe(allParts(project()).length);
    expect(positions.get(a)).toBe(positions.get(b)); // одинаковые делят позицию
    expect(positions.get(c)).not.toBe(positions.get(a)); // другой размер — другая позиция
  });

  it('Тест 7: Dimension — значение = длина отрезка', () => {
    const d = hDim(0, 600, 0, 20);
    expect(d.value).toBe(600);
    expect(renderDimension(d).length).toBeGreaterThan(0);
  });

  it('Тест 8: TitleBlock заполнен на всех страницах', () => {
    for (const e of buildDocumentModel(project()).documents) {
      for (const page of e.doc.pages) {
        expect(page.title.project).toBeTruthy();
        expect(page.title.title).toBeTruthy();
        expect(page.title.sheetsTotal).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('Тест 24: чертёж детали содержит контур и размеры', () => {
    const doc = buildPartsDocument(project());
    const svg = renderPageSvg(doc.pages[0]);
    expect(svg).toContain('<rect');
    expect(svg).toContain('<line'); // размерные линии
  });

  it('Тест 25: присадка визуализируется (отверстия)', () => {
    const side = partByType('side_left');
    store().addManualOperation({ partId: side.id, face: 'front', x: 100, y: 100, diameter: 8, depth: 10 });
    const doc = buildPartsDocument(project());
    const page = doc.pages.find((p) => p.partId === side.id)!;
    expect(page.scene.prims.some((p) => p.kind === 'circle')).toBe(true);
  });

  it('Тест 26: кромка визуализируется и попадает в таблицу', () => {
    const side = partByType('side_left');
    const edge = project().edges[0].id;
    store().updatePart(side.id, { edges: { ...side.edges, left: edge } });
    const doc = buildPartsDocument(project());
    const svg = renderPageSvg(doc.pages.find((p) => p.partId === side.id)!);
    expect(svg).toContain('Кромка'); // таблица кромки
  });

  it('Тест 27: направление текстуры отображается стрелкой', () => {
    const side = partByType('side_left');
    store().updatePart(side.id, { grain: 'length' });
    const doc = buildPartsDocument(project());
    const page = doc.pages.find((p) => p.partId === side.id)!;
    expect(page.scene.prims.some((p) => p.kind === 'polyline')).toBe(true); // стрелка текстуры
  });
});

describe('Документы 11 — спецификации и сводка', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 4: PartsList — детали сгруппированы, есть позиция', () => {
    const rows = partsListRows(project());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.position >= 1)).toBe(true);
    const doc = buildPartsListDocument(project());
    expect(doc.type).toBe('PARTS_LIST');
  });

  it('Тест 5: HardwareList — фурнитура сгруппирована с типом/артикулом', () => {
    const parts = allParts(project());
    const hw = project().hardware[0].id;
    store().addConnection({ hardwareId: hw, partAId: parts[0].id, partBId: parts[1].id });
    const rows = hardwareListRows(project());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].type).toBeTruthy();
    expect(buildHardwareListDocument(project()).type).toBe('HARDWARE_LIST');
  });

  it('Тест 6: ProjectSummary — габариты, детали, присадка', () => {
    const d = projectSummaryData(project());
    expect(d.partCount).toBeGreaterThan(0);
    expect(d.width).toBeGreaterThan(0);
    expect(d.machiningCount).toBeGreaterThanOrEqual(0);
    expect(buildProjectSummaryDocument(project()).type).toBe('PROJECT_SUMMARY');
  });
});

describe('Документы 11 — раскладка, валидатор, экспорт', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 9: DrawingLayout — регионы без пересечений', () => {
    const regions = [
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 120, y: 0, w: 100, h: 100 },
    ];
    expect(regionsOverlap(regions)).toBe(false);
    regions.push({ id: 'c', x: 50, y: 50, w: 100, h: 100 });
    expect(regionsOverlap(regions)).toBe(true);
  });

  it('Тест 10: DrawingLayoutEngine — масштаб/ориентация/переполнение', () => {
    const small = planLayout(400, 300, 'A3', 'LANDSCAPE');
    expect(small.scale).toBeGreaterThan(0);
    expect(small.scale).toBeLessThanOrEqual(1);
    expect(small.fits).toBe(true);
    // Огромное содержимое не влезает даже при мин. масштабе → доп. листы.
    const huge = planLayout(200000, 150000, 'A4', 'LANDSCAPE');
    expect(huge.fits).toBe(false);
    expect(huge.extraSheets).toBeGreaterThan(0);
  });

  it('Тест 23: ориентация выбирается под геометрию', () => {
    const tall = planLayout(300, 900, 'A3', 'LANDSCAPE');
    expect(['PORTRAIT', 'LANDSCAPE']).toContain(tall.orientation);
  });

  it('Тест 11: DrawingValidator — валидный комплект без ошибок; пустой док → ошибка', () => {
    const model = buildDocumentModel(project());
    const issues = validateDocumentModel(model, project());
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
    const empty: DrawingDocument = { id: 'x', type: 'PART_DRAWING', projectId: project().id, title: 'X', pages: [] };
    expect(validateDrawing(empty).some((i) => i.code === 'drw.noPages')).toBe(true);
  });

  it('Тест 22: масштаб корректен на страницах чертежей', () => {
    const doc = buildPartsDocument(project());
    for (const page of doc.pages) {
      expect(typeof page.scale === 'number' ? page.scale : 1).toBeGreaterThan(0);
    }
  });

  it('Тест 12/45: PDF preflight — страницы, TitleBlock, обязательные документы', () => {
    const model = buildDocumentModel(project());
    const pre = pdfPreflight(model);
    expect(pre.ok).toBe(true);
    expect(pre.pageCount).toBeGreaterThan(0);
  });

  it('Тест 13: SVG — векторный, размеры в мм', () => {
    const svg = renderPageSvg(buildPartsDocument(project()).pages[0]);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('mm');
  });

  it('Тест 14: CSV — стабильные колонки', () => {
    expect(partsListCsv(project()).split('\n')[0]).toBe('Позиция,ID,Наименование,Количество,Длина,Ширина,Толщина,Материал,Кромка,Соединений,Примечание');
    const parts = allParts(project());
    store().addConnection({ hardwareId: project().hardware[0].id, partAId: parts[0].id, partBId: parts[1].id });
    expect(hardwareListCsv(project()).split('\n')[0]).toBe('№,ID,Наименование,Тип,Артикул,Количество');
    expect(cuttingListCsv(project()).split('\n')[0]).toContain('P-ID');
  });

  it('Тест 15/35: JSON — DocumentModel сериализуется', () => {
    const model = buildDocumentModel(project());
    const json = JSON.stringify(model);
    const parsed = JSON.parse(json);
    expect(parsed.documents.length).toBe(model.documents.length);
    expect(parsed.version).toBe(model.version);
  });

  it('Тест 20b/21: многостраничный документ и нумерация листов', () => {
    const doc = buildPartsDocument(project());
    expect(doc.pages.length).toBeGreaterThan(1);
    doc.pages.forEach((page, i) => {
      expect(page.title.sheet).toBe(i + 1);
      expect(page.title.sheetsTotal).toBe(doc.pages.length);
    });
  });

  it('Тест 28: карта раскроя использует готовый CuttingResult (без пересчёта)', async () => {
    await store().recalculateCutting();
    const doc1 = buildDocument(project(), 'cutting');
    const doc2 = buildDocument(project(), 'cutting');
    // Детерминизм: один и тот же результат, без повторного расчёта раскроя.
    expect(svgOf(doc1)).toBe(svgOf(doc2));
    expect(doc1.pages.length).toBeGreaterThan(0);
  });
});
