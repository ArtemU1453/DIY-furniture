import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import {
  buildAssemblyDocument,
  buildPartsDocument,
  buildCuttingDocument,
  buildSpecificationDocument,
  buildAllDocuments,
  groupParts,
  documentToSvgPages,
  renderPageSvg,
  isDocumentsOutdated,
} from '@/engines/drawing';
import { printPages } from '@/features/documents/print';

const store = () => useEditorStore.getState();
const project = () => store().project;
const svgOf = (doc: ReturnType<typeof buildAssemblyDocument>) => documentToSvgPages(doc).join('\n');
const partByType = (t: string) => allParts(project()).find((p) => p.metadata?.partType === t)!;

describe('DrawingEngine — чертежи и документация', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
    // соединение конфирматом → присадка
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const hw = project().hardware.find((h) => h.category === 'confirmat')!;
    store().addConnection({ hardwareId: hw.id, partAId: side.id, partBId: bottom.id });
  });

  it('1: сборочный чертёж строится (страница + SVG)', () => {
    const doc = buildAssemblyDocument(project());
    expect(doc.type).toBe('ASSEMBLY_DRAWING');
    expect(doc.pages.length).toBe(1);
    const svg = svgOf(doc);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<rect');
  });

  it('2: деталировка — по странице на деталь', () => {
    const doc = buildPartsDocument(project());
    expect(doc.type).toBe('PART_DRAWING');
    expect(doc.pages.length).toBe(allParts(project()).length);
    expect(doc.pages.length).toBeGreaterThan(1);
  });

  it('3/15: размеры берутся из модели (габариты 800×2000×600 → 1000)', () => {
    const svg = svgOf(buildAssemblyDocument(project()));
    expect(svg).toContain('>800<');
    expect(svg).toContain('>2000<');
    expect(svg).toContain('>600<');
    store().updateCabinetParams(store().activeFurnitureId!, { width: 1000 });
    expect(svgOf(buildAssemblyDocument(project()))).toContain('>1000<');
  });

  it('4: масштаб отображается в штампе', () => {
    const svg = svgOf(buildAssemblyDocument(project()));
    expect(svg).toMatch(/1:\d+|1:1/);
  });

  it('5: кромка детали отображается на чертеже и в таблице', () => {
    const side = partByType('side_left');
    const edgeId = project().edges[0].id;
    store().updatePart(side.id, { edges: { left: edgeId, right: null, top: null, bottom: null } });
    const doc = buildPartsDocument(project());
    const page = doc.pages.find((p) => p.partId === side.id)!;
    const svg = renderPageSvg(page);
    expect(svg).toContain('Кромка');
    const edgeColor = project().edges[0].color.replace('#', '');
    expect(svg.toLowerCase()).toContain(edgeColor.toLowerCase());
  });

  it('6/7: присадка (отверстия) на чертеже детали, единый номер M0xx', () => {
    const bottom = partByType('bottom');
    const ops = allOperations(project()).filter((o) => o.partId === bottom.id);
    expect(ops.length).toBeGreaterThan(0);
    const doc = buildPartsDocument(project());
    const page = doc.pages.find((p) => p.partId === bottom.id)!;
    const svg = renderPageSvg(page);
    expect(svg).toContain('<circle');
    const num = `M${String(ops[0].sequence).padStart(3, '0')}`;
    expect(svg).toContain(num); // тот же ID, что в 3D/таблице
    expect(svg).toContain('Присадка');
  });

  it('8: спецификация деталей строится', () => {
    const doc = buildSpecificationDocument(project());
    expect(doc.type).toBe('SPECIFICATION');
    expect(doc.pages.length).toBeGreaterThan(0);
    expect(groupParts(project()).length).toBeGreaterThan(0);
  });

  it('9: одинаковые детали группируются с суммарным количеством', () => {
    store().newProject('Группа');
    store().addElement('panel');
    store().addElement('panel'); // идентичная панель
    const rows = groupParts(store().project);
    const panelRow = rows.find((r) => r.name === 'Панель')!;
    expect(panelRow).toBeDefined();
    expect(panelRow.quantity).toBe(2);
  });

  it('10: спецификация фурнитуры (количество из соединений)', () => {
    const svg = svgOf(buildSpecificationDocument(project()));
    expect(svg).toContain('Спецификация фурнитуры');
    expect(svg).toContain('Конфирмат 7×50');
  });

  it('11: спецификация кромки считается из деталей', () => {
    const side = partByType('side_left');
    const edgeId = project().edges[0].id;
    store().updatePart(side.id, { edges: { left: edgeId, right: edgeId, top: edgeId, bottom: edgeId } });
    const svg = svgOf(buildSpecificationDocument(project()));
    expect(svg).toContain('Спецификация кромки');
  });

  it('12: карта раскроя из существующего CuttingResult', async () => {
    await store().recalculateCutting();
    const doc = buildCuttingDocument(project());
    // Тип переименован на этапе 16 согласно требуемому перечню (§3).
    expect(doc.type).toBe('CUTTING_LAYOUT');
    expect(doc.pages.length).toBeGreaterThan(0);
    expect(svgOf(doc)).toContain('<rect');
  });

  it('13: SVG — валидная разметка', () => {
    const svg = svgOf(buildAssemblyDocument(project()));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('viewBox');
  });

  it('14/18: страницы (для PDF/печати) многостраничны и векторны', () => {
    const pages = documentToSvgPages(buildPartsDocument(project()));
    expect(pages.length).toBeGreaterThan(1); // многостраничный PDF
    expect(pages.every((p) => p.includes('<svg') && p.includes('mm"'))).toBe(true);
    // печать не должна бросать исключение при отсутствии окна
    expect(() => printPages('Тест', pages)).not.toThrow();
  });

  it('16: статус OUTDATED и обновление документов', () => {
    expect(isDocumentsOutdated(project())).toBe(true);
    store().markDocumentsGenerated();
    expect(isDocumentsOutdated(project())).toBe(false);
    store().updateCabinetParams(store().activeFurnitureId!, { width: 900 });
    expect(isDocumentsOutdated(project())).toBe(true);
  });

  it('17: перегенерация — все типы документов', () => {
    const docs = buildAllDocuments(project());
    const types = docs.map((d) => d.type);
    expect(types).toContain('ASSEMBLY_DRAWING');
    expect(types).toContain('PART_DRAWING');
    expect(types).toContain('CUTTING_LAYOUT');
    expect(types).toContain('SPECIFICATION');
    expect(types).toContain('PRODUCTION_REPORT');
  });

  it('19/34: единая нумерация и точность размеров (Part = Drawing)', () => {
    const side = partByType('side_left');
    const num = side.metadata?.number as string;
    expect(num).toMatch(/^P\d{3}$/);
    // спецификация содержит тот же номер
    expect(svgOf(buildSpecificationDocument(project()))).toContain(num);
    // чертёж детали содержит реальные размеры детали
    const page = buildPartsDocument(project()).pages.find((p) => p.partId === side.id)!;
    const svg = renderPageSvg(page);
    expect(svg).toContain('>2000<'); // высота боковины из модели
    expect(svg).toContain('>16<'); // толщина из модели
  });
});
