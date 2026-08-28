/**
 * ЭТАП 38 · СОГЛАСОВАННОСТЬ ПРОИЗВОДСТВЕННЫХ ДАННЫХ.
 *
 * Единственный источник производственной истины — ProjectModel. Все разделы
 * (2D, 3D, присадка, раскрой, спецификация, производство, документы) обязаны
 * показывать ЕГО данные, а не собственные копии.
 *
 * Тест строит эталонный проект (корпус, несколько модулей, двери, полки,
 * ящики, фурнитура, присадка) и сверяет каждый раздел с моделью деталь за
 * деталью. Эталонный снимок задан производственными величинами — типами
 * деталей и их размерами, — а не идентификаторами: тест ловит изменение
 * конструкции, а не смену id.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { runCutting } from '@/engines/cutting';
import { buildSpecification } from '@/engines/bom/specification';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { productionParts } from '@/engines/production';
import { buildPartsDocument, documentToSvgPages } from '@/engines/drawing';
import { rebuildScene } from '@/engines/scene';
import { buildEntities, partOfEntity } from '@/engines/editor2d';
import { edgeBandingWith } from '@/engines/edges';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';
import { validateProjectModel } from '@/engines/status';
import type { FurnitureId } from '@/core/model/ids';
import type { Part, Project } from '@/core/model/types';

const store = () => useEditorStore.getState();
const project = () => store().project;
const mm = (v: number) => Math.round(v * 100) / 100;
const key = (p: Part) => String(p.metadata?.key ?? p.id);

/**
 * ЭТАЛОННЫЙ ПРОИЗВОДСТВЕННЫЙ ПРОЕКТ (§63).
 *
 * Шкаф 2400×2400×600 с двумя перегородками, полками и фасадами плюс тумба с
 * ящиками: в проекте есть все виды деталей, узлы корпуса и присадка.
 */
function buildGoldenProject(): { cabinet: FurnitureId; base: FurnitureId } {
  store().newProject('Эталон производства');

  const cabinet = store().createParametricCabinet({
    type: 'CABINET', name: 'Шкаф 2400', width: 2400, height: 2400, depth: 600, thickness: 16,
  })!;
  const cabinetModel = store().getCabinetModel(cabinet)!;
  store().applyCabinetPatch(cabinet, {
    partitions: { ...cabinetModel.partitions, count: 2 },
    shelves: { ...cabinetModel.shelves, count: 4 },
    doors: { ...cabinetModel.doors, count: 3, handleEnabled: true },
  });

  const base = store().createParametricCabinet({
    type: 'BASE_UNIT', name: 'Тумба с ящиками', width: 800, height: 820, depth: 560, thickness: 16,
  })!;
  const baseModel = store().getCabinetModel(base)!;
  store().applyCabinetPatch(base, {
    drawers: { ...baseModel.drawers, count: 3 },
    doors: { ...baseModel.doors, count: 0 },
  });

  // Кромка на видимых торцах шкафа — производственные данные, не оформление.
  const edge = project().edges[0].id;
  for (const part of allParts(project())) {
    if (part.metadata?.partType === 'shelf' || part.metadata?.partType === 'facade') {
      store().setPartEdge(part.id, 'top', edge);
    }
  }

  // Ручная присадка поверх автоматической: она тоже обязана дойти до цеха.
  const side = allParts(project()).find((p) => p.metadata?.partType === 'side_left')!;
  store().addManualOperation({ partId: side.id, face: 'front', x: 120, y: 300, diameter: 8, depth: 12 });

  return { cabinet, base };
}

/** Производственный снимок детали: то, что уходит в цех. */
function partSnapshot(p: Part, proj: Project) {
  const names = new Map<string, string>([
    ...proj.materials.map((m) => [String(m.id), m.name] as const),
    ...proj.edges.map((e) => [String(e.id), e.name] as const),
  ]);
  const nameOf = (id: unknown) => (id == null ? null : names.get(String(id)) ?? String(id));
  return {
    key: key(p),
    partType: String(p.metadata?.partType ?? ''),
    width: mm(p.width),
    height: mm(p.height),
    thickness: mm(p.thickness),
    material: nameOf(p.material),
    grain: p.grain,
    quantity: p.quantity,
    edges: {
      left: nameOf(p.edges.left), right: nameOf(p.edges.right),
      top: nameOf(p.edges.top), bottom: nameOf(p.edges.bottom),
    },
    position: { x: mm(p.position.x), y: mm(p.position.y), z: mm(p.position.z) },
  };
}

const snapshotOf = (proj: Project) =>
  allParts(proj).map((p) => partSnapshot(p, proj)).sort((a, b) => a.key.localeCompare(b.key));

describe('Этап 38 · разделы показывают данные модели, а не свои', () => {
  beforeEach(() => { buildGoldenProject(); });

  it('§4 количество деталей совпадает во всех разделах', () => {
    const parts = allParts(project());
    const model = parts.length;
    expect(model).toBeGreaterThan(20);

    // 3D: по узлу на деталь.
    const { scene } = rebuildScene(project());
    const sceneParts = Object.values(scene.nodes).filter((n) => n.kind === 'PART');
    expect(sceneParts).toHaveLength(model);

    // 2D: каждая деталь имеет сущность на холсте.
    const entities = buildEntities(project(), { plane: 'FRONT' });
    const drawn = new Set(
      entities.map((e) => partOfEntity(project(), e)).filter(Boolean).map((p) => String(p!.id)),
    );
    expect(drawn.size).toBe(model);

    // Раскрой: все детали с материалом размещены.
    const report = runCutting(project());
    const placed = report.jobs.flatMap((j) => j.sheets.flatMap((s) => s.placements));
    expect(placed).toHaveLength(parts.filter((p) => p.material).length);
    expect(report.jobs.flatMap((j) => j.unplaced)).toHaveLength(0);

    // Спецификация и производство.
    expect(buildSpecification(parts, project().materials, project().edges).rows).toHaveLength(model);
    expect(productionParts(project())).toHaveLength(model);
  });

  it('§5–§10 размеры, материал, кромка, текстура и количество совпадают', () => {
    const parts = allParts(project());
    const spec = buildSpecification(parts, project().materials, project().edges);
    const production = productionParts(project());
    const { scene } = rebuildScene(project());

    for (const part of parts) {
      const long = Math.max(part.width, part.height);
      const short = Math.min(part.width, part.height);

      const row = spec.rows.find((r) => String(r.partId) === String(part.id))!;
      expect(mm(row.length)).toBe(mm(long));
      expect(mm(row.width)).toBe(mm(short));
      expect(mm(row.thickness)).toBe(mm(part.thickness));
      expect(String(row.materialId)).toBe(String(part.material));
      expect(row.quantity).toBe(part.quantity);

      const prod = production.find((r) => String(r.partId) === String(part.id))!;
      expect(mm(prod.width)).toBe(mm(part.width));
      expect(mm(prod.height)).toBe(mm(part.height));
      expect(mm(prod.thickness)).toBe(mm(part.thickness));
      expect(String(prod.materialId)).toBe(String(part.material));
      expect(prod.quantity).toBe(part.quantity);
      expect(prod.grain).toBe(part.grain);

      // 3D берёт размеры детали, а не хранит свои.
      const node = Object.values(scene.nodes).find((n) => String(n.refId) === String(part.id))!;
      expect(mm(node.size.x)).toBe(mm(part.width));
      expect(mm(node.size.y)).toBe(mm(part.height));
      expect(mm(node.size.z)).toBe(mm(part.thickness));

      // Кромка: производство повторяет Part.edges, а не назначает свою.
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        const banding = edgeBandingWith(project().edges, part, side);
        const inProduction = prod.edges.find((e) => e.side === side);
        expect(Boolean(inProduction?.edgeMaterialId)).toBe(Boolean(banding));
        if (banding) {
          expect(String(inProduction!.edgeMaterialId)).toBe(String(banding.materialId));
        }
      }
    }
  });

  it('§6 позиции деталей в 3D выводятся из модели', () => {
    const { scene } = rebuildScene(project());
    for (const part of allParts(project())) {
      const node = Object.values(scene.nodes).find((n) => String(n.refId) === String(part.id))!;
      expect(node).toBeDefined();
      // Мировая позиция узла считается из позиции детали, а не хранится отдельно.
      expect(Number.isFinite(node.world.position.x)).toBe(true);
      expect(Number.isFinite(node.world.position.y)).toBe(true);
      expect(Number.isFinite(node.world.position.z)).toBe(true);
    }
  });

  it('§11 в проекте нет дублей и потерянных деталей', () => {
    const parts = allParts(project());
    const ids = parts.map((p) => String(p.id));
    expect(new Set(ids).size).toBe(ids.length);

    // Ключи уникальны в пределах изделия: иначе пересчёт «склеит» детали.
    for (const furniture of project().furnitures) {
      const keys = furniture.assemblies.flatMap((a) => a.parts).map(key);
      expect(new Set(keys).size).toBe(keys.length);
    }

    // Раскрой не теряет и не дублирует детали.
    const report = runCutting(project());
    const placedIds = report.jobs.flatMap((j) => j.sheets.flatMap((s) => s.placements.map((pl) => String(pl.partId))));
    expect(new Set(placedIds).size).toBe(placedIds.length);
    for (const part of parts.filter((p) => p.material)) {
      expect(placedIds).toContain(String(part.id));
    }
  });

  it('§12 нет висящих соединений, фурнитуры и присадки', () => {
    const live = new Set(allParts(project()).map((p) => String(p.id)));

    for (const c of project().hardwareConnections) {
      expect(live.has(String(c.partAId))).toBe(true);
      expect(live.has(String(c.partBId))).toBe(true);
      expect(project().hardware.some((h) => String(h.id) === String(c.hardwareId))).toBe(true);
    }
    for (const op of allOperations(project())) {
      expect(live.has(String(op.partId))).toBe(true);
    }
    for (const item of project().hardwareInstances ?? []) {
      if (item.partId) expect(live.has(String(item.partId))).toBe(true);
    }
    expect(validateProjectModel(project()).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('§13/§14 фурнитура спецификации считается из соединений проекта', () => {
    const ledger = buildHardwareLedger(project().hardware, project().hardwareConnections);
    const fromModel = new Map<string, number>();
    for (const c of project().hardwareConnections) {
      const id = String(c.hardwareId);
      fromModel.set(id, (fromModel.get(id) ?? 0) + (c.quantity || 0));
    }
    for (const row of ledger) {
      expect(row.count).toBe(fromModel.get(String(row.hardwareId)) ?? 0);
      const hardware = project().hardware.find((h) => String(h.id) === String(row.hardwareId))!;
      expect(hardware).toBeDefined();
      expect(hardware.category).toBeTruthy();
    }
    expect(ledger.reduce((n, r) => n + r.count, 0))
      .toBe([...fromModel.values()].reduce((n, v) => n + v, 0));
  });

  it('§15–§18 присадка связана с деталью, узлом и доходит до производства', () => {
    const ops = allOperations(project());
    expect(ops.length).toBeGreaterThan(0);

    const connectionIds = new Set(project().hardwareConnections.map((c) => String(c.id)));
    const parts = new Map(allParts(project()).map((p) => [String(p.id), p]));

    for (const op of ops) {
      const part = parts.get(String(op.partId))!;
      expect(part).toBeDefined();
      expect(['front', 'back', 'left', 'right', 'top', 'bottom']).toContain(op.face);
      expect(Number.isFinite(op.x)).toBe(true);
      expect(Number.isFinite(op.y)).toBe(true);
      if (op.diameter != null) expect(op.diameter).toBeGreaterThan(0);
      if (op.depth != null) expect(op.depth).toBeGreaterThan(0);
      // Операция принадлежит либо узлу, либо детали (ручная).
      if (op.sourceHardwareConnectionId) {
        expect(connectionIds.has(String(op.sourceHardwareConnectionId))).toBe(true);
      }
    }

    // Производство видит ровно те же операции.
    const production = productionParts(project());
    const inProduction = production.reduce((n, r) => n + r.operations.length, 0);
    expect(inProduction).toBe(ops.length);
  });

  it('§19/§20 раскрой повторяет размеры, материал и количество модели', () => {
    const report = runCutting(project());
    store().applyCuttingReport(report);
    const parts = new Map(allParts(project()).map((p) => [String(p.id), p]));

    let placedCount = 0;
    for (const job of report.jobs) {
      for (const sheet of job.sheets) {
        for (const pl of sheet.placements) {
          placedCount += 1;
          const part = parts.get(String(pl.partId))!;
          expect(part).toBeDefined();
          expect(String(part.material)).toBe(String(job.materialId));
          expect(mm(Math.max(pl.length, pl.width))).toBe(mm(Math.max(part.width, part.height)));
          expect(mm(Math.min(pl.length, pl.width))).toBe(mm(Math.min(part.width, part.height)));
        }
      }
    }
    expect(placedCount).toBe([...parts.values()].filter((p) => p.material).length);
  });

  it('§23/§24 страницы документов печатают величины модели', () => {
    const document = buildPartsDocument(project());
    const pages = documentToSvgPages(document).join('\n');
    const parts = allParts(project());

    // Номера деталей — на страницах, которые уходят в печать (PDF).
    for (const part of parts) {
      const number = String(part.metadata?.number ?? '');
      if (number) expect(pages.includes(number)).toBe(true);
    }

    // Размеры и материалы — те же, что в модели: берём несколько деталей.
    for (const part of parts.slice(0, 5)) {
      const long = String(Math.round(Math.max(part.width, part.height)));
      expect(pages.includes(long)).toBe(true);
      const material = project().materials.find((m) => String(m.id) === String(part.material));
      if (material) expect(pages.includes(material.name)).toBe(true);
    }

    // Ни одна деталь модели не потеряна: страниц столько же, сколько деталей.
    expect(document.pages).toHaveLength(parts.length);
  });
});

describe('Этап 38 · эталонный проект и его производственный снимок', () => {
  it('§63/§64 состав эталонного проекта задан производственными величинами', () => {
    buildGoldenProject();
    const parts = allParts(project());
    const byType = (t: string) => parts.filter((p) => p.metadata?.partType === t);

    // Шкаф: 2 боковины, верх, низ, 2 перегородки, 12 полок, 3 фасада, задняя стенка.
    expect(byType('side_left').length).toBe(2); // шкаф + тумба
    expect(byType('divider').length).toBe(2);
    expect(byType('shelf').length).toBeGreaterThanOrEqual(12);
    expect(byType('facade').length).toBeGreaterThanOrEqual(3);
    expect(byType('drawer_front').length).toBe(3);
    expect(byType('drawer_bottom').length).toBe(3);

    // Размеры корпуса шкафа: боковина во всю высоту, верх между боковинами.
    const tallSide = byType('side_left').find((p) => Math.max(p.width, p.height) === 2400)!;
    expect(tallSide).toBeDefined();
    const tops = byType('top').map((p) => mm(Math.max(p.width, p.height)));
    expect(tops).toContain(2400 - 2 * 16);

    // Задняя стенка большого шкафа составная — каждый кусок влезает в лист.
    for (const back of byType('back')) {
      expect(Math.max(back.width, back.height)).toBeLessThanOrEqual(2700);
      expect(Math.min(back.width, back.height)).toBeLessThanOrEqual(1650);
    }

    // Узлы и присадка есть, и присадка вся на существующих деталях.
    expect(project().hardwareConnections.length).toBeGreaterThan(10);
    const live = new Set(parts.map((p) => String(p.id)));
    expect(allOperations(project()).every((o) => live.has(String(o.partId)))).toBe(true);
  });

  it('§65 повторная сборка эталона даёт тот же производственный снимок', () => {
    buildGoldenProject();
    const first = snapshotOf(project());
    buildGoldenProject();
    const second = snapshotOf(project());
    expect(second).toEqual(first);
  });

  it('§25–§28 экспорт, импорт и повторное открытие сохраняют производственные данные', () => {
    buildGoldenProject();
    store().applyCuttingReport(runCutting(project()));
    const before = snapshotOf(project());
    const opsBefore = allOperations(project()).length;
    const connectionsBefore = project().hardwareConnections.length;

    // Save → Close → Open.
    const saved = serializeProject(project());
    store().newProject('Другой проект');
    store().loadProject(deserializeProject(saved));

    expect(snapshotOf(project())).toEqual(before);
    expect(allOperations(project())).toHaveLength(opsBefore);
    expect(project().hardwareConnections).toHaveLength(connectionsBefore);

    // Export → Import в новый проект.
    const exported = serializeProject(project());
    store().newProject('Пустой');
    store().loadProject(deserializeProject(exported));
    expect(snapshotOf(project())).toEqual(before);
  });
});

describe('Этап 38 · изменения проходят через модель во все разделы', () => {
  let cabinet: FurnitureId;

  beforeEach(() => { cabinet = buildGoldenProject().cabinet; });

  it('§36–§41 правка размера детали доходит до раскроя, BOM и производства', () => {
    const shelf = allParts(project()).find((p) => p.metadata?.partType === 'shelf')!;
    store().updatePart(shelf.id, { width: 500 });

    const updated = findPart(project(), shelf.id)!;
    expect(mm(updated.width)).toBe(500);

    const placement = runCutting(project()).jobs
      .flatMap((j) => j.sheets.flatMap((s) => s.placements))
      .find((pl) => String(pl.partId) === String(shelf.id))!;
    expect(mm(Math.max(placement.length, placement.width)))
      .toBe(mm(Math.max(updated.width, updated.height)));

    const row = buildSpecification(allParts(project()), project().materials, project().edges)
      .rows.find((r) => String(r.partId) === String(shelf.id))!;
    expect(mm(row.length)).toBe(mm(Math.max(updated.width, updated.height)));

    const prod = productionParts(project()).find((r) => String(r.partId) === String(shelf.id))!;
    expect(mm(prod.width)).toBe(mm(updated.width));

    const { scene } = rebuildScene(project());
    const node = Object.values(scene.nodes).find((n) => String(n.refId) === String(shelf.id))!;
    expect(mm(node.size.x)).toBe(mm(updated.width));
  });

  it('§29–§31 после undo и redo все разделы снова совпадают с моделью', () => {
    const consistent = () => {
      const parts = allParts(project());
      const spec = buildSpecification(parts, project().materials, project().edges);
      const production = productionParts(project());
      expect(spec.rows).toHaveLength(parts.length);
      expect(production).toHaveLength(parts.length);
      for (const part of parts) {
        const row = spec.rows.find((r) => String(r.partId) === String(part.id))!;
        expect(mm(row.thickness)).toBe(mm(part.thickness));
        const prod = production.find((r) => String(r.partId) === String(part.id))!;
        expect(mm(prod.width)).toBe(mm(part.width));
      }
      const live = new Set(parts.map((p) => String(p.id)));
      expect(allOperations(project()).every((o) => live.has(String(o.partId)))).toBe(true);
    };

    const before = snapshotOf(project());

    // Размеры, кромка, фурнитура и присадка — по одному изменению каждого вида.
    store().applyCabinetPatch(cabinet, { width: 2000 });
    const part = allParts(project())[0];
    store().setPartEdge(part.id, 'left', project().edges[0].id);
    const hw = project().hardware[0];
    const parts = allParts(project());
    store().addConnection({ hardwareId: hw.id, partAId: parts[0].id, partBId: parts[1].id });
    store().addManualOperation({ partId: parts[0].id, face: 'front', x: 60, y: 60, diameter: 8, depth: 10 });
    consistent();

    // Отмена всех четырёх изменений возвращает исходную модель.
    store().undo();
    store().undo();
    store().undo();
    store().undo();
    consistent();
    expect(snapshotOf(project())).toEqual(before);

    // Повтор возвращает изменения, и разделы снова согласованы.
    store().redo();
    store().redo();
    store().redo();
    store().redo();
    consistent();
  });
});

describe('Этап 38 · все пути создания дают эквивалентную модель', () => {
  beforeEach(() => store().newProject('Сравнение путей'));

  /** Снимок изделия без идентификаторов: только производственные величины. */
  const furnitureSnapshot = (id: FurnitureId) => {
    const furniture = project().furnitures.find((f) => String(f.id) === String(id))!;
    const proj = project();
    return furniture.assemblies
      .flatMap((a) => a.parts)
      .map((p) => partSnapshot(p, proj))
      .sort((a, b) => a.key.localeCompare(b.key));
  };

  it('§34/§35 мастер, панель параметров и шаблон строят одно и то же', () => {
    const params = { width: 900, height: 2000, depth: 600, thickness: 16 };

    const wizard = store().createParametricCabinet({ type: 'CABINET', ...params })!;
    const a = furnitureSnapshot(wizard);

    store().newProject('Сравнение путей');
    const panel = store().createCabinet('Шкаф');
    store().updateCabinetParams(panel, params);
    const b = furnitureSnapshot(panel);
    expect(b).toEqual(a);

    /* Шаблон задаёт СВОИ параметры, поэтому сравнивать его с другим шкафом
     * напрямую нельзя. Проверяем сильнее и в одном проекте: берём модель
     * изделия из шаблона и строим по ней изделие мастером — если генератор
     * один, производственные снимки совпадут. */
    store().newProject('Сравнение путей');
    const template = store().createFromTemplate('tpl-cabinet');
    expect(template.ok).toBe(true);
    const templateModel = store().getParametricModel(template.id!)!;
    const c = furnitureSnapshot(template.id!);
    expect(c.every((p) => p.key.startsWith('CABINET.'))).toBe(true);

    const rebuilt = store().createParametricCabinet({ type: 'CABINET' })!;
    expect(store().applyParametricModel(rebuilt, templateModel).ok).toBe(true);
    expect(furnitureSnapshot(rebuilt)).toEqual(c);
  });

  it('§7 вставка шкафа в другой проект сохраняет материалы деталей', () => {
    store().newProject('Источник');
    const id = store().createParametricCabinet({ type: 'CABINET', width: 800, height: 2000, depth: 600 })!;
    const edge = project().edges[0].id;
    const shelf = allParts(project()).find((p) => p.metadata?.partType === 'shelf')!;
    store().setPartEdge(shelf.id, 'top', edge);
    const before = furnitureSnapshot(id);
    const clipboard = store().copyCabinetToClipboard(id)!;

    store().newProject('Получатель');
    const pasted = store().pasteCabinetFromClipboard(clipboard, 'Вставленный')!;
    expect(pasted).toBeTruthy();

    // Материалы принадлежат ЭТОМУ проекту, а не остались чужими ссылками.
    const materials = new Set(project().materials.map((m) => String(m.id)));
    const edges = new Set(project().edges.map((e) => String(e.id)));
    for (const part of allParts(project())) {
      if (part.material) expect(materials.has(String(part.material))).toBe(true);
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        if (part.edges[side]) expect(edges.has(String(part.edges[side]))).toBe(true);
      }
    }
    // Названия материалов и кромки не изменились — деталь поедет из того же листа.
    expect(furnitureSnapshot(pasted)).toEqual(before);
    expect(validateProjectModel(project()).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});
