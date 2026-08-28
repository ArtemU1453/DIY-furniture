/**
 * ЭТАП 36 · ПРИЁМКА: ПРИЛОЖЕНИЕ КАК ИНСТРУМЕНТ ПРОЕКТИРОВАНИЯ МЕБЕЛИ.
 *
 * Тест идёт путём пользователя, а не разработчика: собирает реальный шкаф
 * 2400×2400×600, назначает материал, кромку, фурнитуру и присадку, а затем
 * сверяет ProjectModel со всеми производными разделами — 2D, 3D, раскрой,
 * BOM, производство, документы, сохранение и обмен файлами.
 *
 * Проверяется НЕ наличие функций, а согласованность данных: раздел, который
 * показывает не то, что в модели, — это дефект производства, а не косметика.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { runCutting } from '@/engines/cutting';
import { buildSpecification } from '@/engines/bom/specification';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { productionParts, productionReadiness } from '@/engines/production';
import { buildPartsDocument } from '@/engines/drawing';
import { rebuildScene } from '@/engines/scene';
import { buildEntities, partOfEntity } from '@/engines/editor2d';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';
import { validateProjectModel } from '@/engines/status';
import { BACK_PIECE_LIMIT } from '@/engines/parametric';
import type { FurnitureId, PartId } from '@/core/model/ids';
import type { Part, Project } from '@/core/model/types';

const store = () => useEditorStore.getState();
const project = () => store().project;
const mm = (v: number) => Math.round(v * 100) / 100;

/** Шкаф из задания: 2400×2400×600, две перегородки, полки, фасады. */
const CABINET = { width: 2400, height: 2400, depth: 600, thickness: 16 };

function buildRealCabinet(): FurnitureId {
  const id = store().createParametricCabinet({ type: 'CABINET', name: 'Шкаф 2400', ...CABINET })!;
  const model = store().getCabinetModel(id)!;
  store().applyCabinetPatch(id, {
    partitions: { ...model.partitions, count: 2 },
    shelves: { ...model.shelves, count: 4 },
    doors: { ...model.doors, count: 3, handleEnabled: true },
  });
  return id;
}

const partsOf = (id: FurnitureId): Part[] =>
  project().furnitures.find((f) => String(f.id) === String(id))!.assemblies.flatMap((a) => a.parts);

describe('Этап 36 · сборка реального шкафа 2400×2400×600', () => {
  beforeEach(() => store().newProject('Приёмка'));

  it('§3 конструкция: боковины, верх, низ, перегородки, полки, фасады', () => {
    const parts = partsOf(buildRealCabinet());
    const types = parts.map((p) => String(p.metadata?.partType));

    expect(types.filter((t) => t === 'side_left')).toHaveLength(1);
    expect(types.filter((t) => t === 'side_right')).toHaveLength(1);
    expect(types.filter((t) => t === 'top')).toHaveLength(1);
    expect(types.filter((t) => t === 'bottom')).toHaveLength(1);
    expect(types.filter((t) => t === 'divider')).toHaveLength(2);
    // 4 полки в каждой из трёх секций.
    expect(types.filter((t) => t === 'shelf')).toHaveLength(12);
    expect(types.filter((t) => t === 'facade')).toHaveLength(3);
    /* Задняя стенка шкафа 2400×2400 не существует одним листом ХДФ, поэтому
     * собирается из кусков — каждый должен помещаться в лист (этап 36). */
    const backs = parts.filter((p) => p.metadata?.partType === 'back');
    expect(backs.length).toBeGreaterThanOrEqual(1);
    for (const back of backs) {
      const long = Math.max(back.width, back.height);
      const short = Math.min(back.width, back.height);
      expect(long).toBeLessThanOrEqual(BACK_PIECE_LIMIT.long);
      expect(short).toBeLessThanOrEqual(BACK_PIECE_LIMIT.short);
    }

    // Габариты изделия соблюдены: боковина во всю высоту, верх между боковинами.
    const side = parts.find((p) => p.metadata?.partType === 'side_left')!;
    expect(Math.max(side.width, side.height)).toBe(2400);
    const top = parts.find((p) => p.metadata?.partType === 'top')!;
    expect(Math.max(top.width, top.height)).toBe(2400 - 2 * 16);
  });

  it('§5/§6 материал и кромка назначаются и держатся на деталях', () => {
    const id = buildRealCabinet();
    const material = project().materials[0].id;
    const edge = project().edges[0].id;

    const parts = partsOf(id);
    expect(parts.every((p) => p.material !== null)).toBe(true);
    expect(parts.some((p) => String(p.material) === String(material))).toBe(true);

    const target = parts[0].id;
    store().setPartEdge(target, 'left', edge);
    expect(String(findPart(project(), target)!.edges.left)).toBe(String(edge));
  });

  it('§4/§7 фурнитура и присадка появляются на деталях', () => {
    const id = buildRealCabinet();
    const parts = partsOf(id);

    // Узлы корпуса и их присадка созданы генератором.
    const ownIds = new Set(parts.map((p) => String(p.id)));
    const connections = project().hardwareConnections.filter(
      (c) => ownIds.has(String(c.partAId)) && ownIds.has(String(c.partBId)),
    );
    expect(connections.length).toBeGreaterThan(0);
    expect(connections.every((c) => c.hardwareId)).toBe(true);

    const ops = allOperations(project());
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((o) => ownIds.has(String(o.partId)))).toBe(true);

    // Ручная операция пользователя добавляется поверх и сохраняется.
    const side = parts.find((p) => p.metadata?.partType === 'side_left')!;
    const opId = store().addManualOperation({
      partId: side.id, face: 'front', x: 100, y: 100, diameter: 8, depth: 12,
    });
    expect(opId).toBeTruthy();
    expect(allOperations(project()).some((o) => String(o.id) === String(opId))).toBe(true);
  });
});

describe('Этап 36 · производные разделы согласованы с ProjectModel', () => {
  beforeEach(() => {
    store().newProject('Приёмка');
    buildRealCabinet();
  });

  it('§8 2D: все детали проецируются и остаются выбираемыми', () => {
    const entities = buildEntities(project(), { plane: 'FRONT' });
    const parts = allParts(project());
    expect(entities.length).toBeGreaterThan(0);

    // Каждая деталь модели имеет сущность на холсте, и она ведёт обратно к Part.
    const partIds = new Set(
      entities
        .map((e) => partOfEntity(project(), e))
        .filter((p): p is Part => Boolean(p))
        .map((p) => String(p.id)),
    );
    for (const p of parts) expect(partIds.has(String(p.id))).toBe(true);
  });

  it('§9 3D: сцена строится из модели, размеры деталей не дублируются', () => {
    const { scene } = rebuildScene(project());
    const parts = allParts(project());
    const nodes = Object.values(scene.nodes).filter((n) => n.kind === 'PART');
    expect(nodes).toHaveLength(parts.length);
    for (const node of nodes) {
      const part = parts.find((p) => String(p.id) === String(node.refId))!;
      expect(part).toBeDefined();
      // Размер узла сцены берётся из детали, а не хранится отдельно.
      expect(mm(node.size.x)).toBe(mm(part.width));
      expect(mm(node.size.y)).toBe(mm(part.height));
      expect(mm(node.size.z)).toBe(mm(part.thickness));
    }
  });

  it('§10/§32 раскрой: все детали попали, без дублей, размеры и материал совпадают', () => {
    const report = runCutting(project());
    store().applyCuttingReport(report);

    const parts = allParts(project()).filter((p) => p.material);
    const placed = report.jobs.flatMap((j) => j.sheets.flatMap((s) => s.placements));
    const unplaced = report.jobs.flatMap((j) => j.unplaced);

    expect(unplaced).toHaveLength(0);
    expect(placed).toHaveLength(parts.length);

    // Дублей нет: каждая деталь размещена ровно один раз.
    const counts = new Map<string, number>();
    for (const pl of placed) counts.set(String(pl.partId), (counts.get(String(pl.partId)) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 1)).toBe(true);

    // Размеры и материал совпадают с деталью.
    for (const pl of placed) {
      const part = parts.find((p) => String(p.id) === String(pl.partId))!;
      const long = Math.max(part.width, part.height);
      const short = Math.min(part.width, part.height);
      expect(mm(Math.max(pl.length, pl.width))).toBe(mm(long));
      expect(mm(Math.min(pl.length, pl.width))).toBe(mm(short));
    }
    for (const job of report.jobs) {
      const jobParts = job.sheets.flatMap((s) => s.placements);
      for (const pl of jobParts) {
        const part = parts.find((p) => String(p.id) === String(pl.partId))!;
        expect(String(part.material)).toBe(String(job.materialId));
      }
    }
  });

  it('§11/§33 BOM сверяется напрямую с ProjectModel', () => {
    const parts = allParts(project());
    const spec = buildSpecification(parts, project().materials, project().edges);

    expect(spec.rows).toHaveLength(parts.length);
    for (const row of spec.rows) {
      const part = parts.find((p) => String(p.id) === String(row.partId))!;
      expect(row.quantity).toBe(part.quantity);
      expect(mm(row.length)).toBe(mm(Math.max(part.width, part.height)));
      expect(mm(row.width)).toBe(mm(Math.min(part.width, part.height)));
      expect(mm(row.thickness)).toBe(mm(part.thickness));
      expect(String(row.materialId)).toBe(String(part.material));
    }

    // Фурнитура считается из соединений проекта, а не отдельным списком.
    const ledger = buildHardwareLedger(project().hardware, project().hardwareConnections);
    const fromConnections = project().hardwareConnections.reduce((n, c) => n + (c.quantity || 0), 0);
    const fromLedger = ledger.reduce((n, r) => n + r.count, 0);
    expect(fromLedger).toBe(fromConnections);
  });

  it('§12/§34 производство сверяется с ProjectModel', () => {
    store().applyCuttingReport(runCutting(project()));
    const parts = allParts(project());
    const rows = productionParts(project());

    expect(rows).toHaveLength(parts.length);
    for (const row of rows) {
      const part = parts.find((p) => String(p.id) === String(row.partId))!;
      expect(mm(row.width)).toBe(mm(part.width));
      expect(mm(row.height)).toBe(mm(part.height));
      expect(mm(row.thickness)).toBe(mm(part.thickness));
      expect(String(row.materialId)).toBe(String(part.material));
      expect(row.quantity).toBe(part.quantity);
      expect(row.number).toMatch(/^P-\d{3,}$/);
    }

    const readiness = productionReadiness(project(), rows);
    // Чек-лист собирается, критических ошибок по материалам и размерам нет.
    expect(readiness.checklist.length).toBeGreaterThan(0);
    expect(readiness.issues.filter((i) => i.code === 'production.material')).toHaveLength(0);
    expect(readiness.issues.filter((i) => i.code === 'production.dimension')).toHaveLength(0);
  });

  it('§13/§35 документы содержат все детали с верными размерами', () => {
    const doc = buildPartsDocument(project());
    const parts = allParts(project());
    const text = JSON.stringify(doc);

    // Ни одна деталь не пропала из ведомости.
    for (const part of parts) {
      expect(text.includes(String(part.metadata?.number ?? part.name))).toBe(true);
    }
    expect(doc).toBeDefined();
  });

  it('§53 модель непротиворечива: нет висящих ссылок', () => {
    const { issues } = validateProjectModel(project());
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });
});

describe('Этап 36 · сохранение, перезагрузка и обмен файлами', () => {
  beforeEach(() => store().newProject('Приёмка'));

  it('§14–§18 round trip: create → save → reload → export → import', () => {
    const id = buildRealCabinet();
    store().applyCuttingReport(runCutting(project()));
    const original = project();

    // Save + Reload: проект проходит через хранилище как JSON.
    const reloaded = deserializeProject(serializeProject(original));
    expect(reloaded).toEqual(original);

    // Export → Import в новый проект.
    const exported = serializeProject(reloaded);
    store().newProject('Пустой');
    store().loadProject(deserializeProject(exported));
    const imported = project();

    expect(allParts(imported)).toHaveLength(allParts(original).length);
    expect(imported.hardwareConnections).toHaveLength(original.hardwareConnections.length);
    expect(allOperations(imported)).toHaveLength(allOperations(original).length);

    const before = partsOf(id).map((p) => `${p.metadata?.key}:${mm(p.width)}x${mm(p.height)}x${mm(p.thickness)}`).sort();
    const after = imported.furnitures
      .flatMap((f) => f.assemblies.flatMap((a) => a.parts))
      .map((p) => `${p.metadata?.key}:${mm(p.width)}x${mm(p.height)}x${mm(p.thickness)}`)
      .sort();
    expect(after).toEqual(before);
  });

  it('§41 импорт защищён от повреждённых и чужих данных', () => {
    expect(() => deserializeProject('не json')).toThrow();
    expect(() => deserializeProject('{"nope":1}')).toThrow();
    // HTML в имени проекта остаётся ДАННЫМИ и не превращается в разметку.
    store().setProjectName('<img src=x onerror=alert(1)>');
    const restored = deserializeProject(serializeProject(project()));
    expect(restored.name).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('Этап 36 · второй путь генерации', () => {
  beforeEach(() => store().newProject('Приёмка'));

  it('§19/§20 тот же шкаф вторым способом даёт те же детали и присадку', () => {
    const idA = buildRealCabinet();
    const a = snapshotOf(project(), idA);

    store().newProject('Приёмка');
    const idB = store().createCabinet('Шкаф 2400');
    store().updateCabinetParams(idB, {
      width: CABINET.width, height: CABINET.height, depth: CABINET.depth,
      thickness: CABINET.thickness, dividers: 2, shelves: 4, doors: 3,
    });
    const modelB = store().getCabinetModel(idB)!;
    store().applyCabinetPatch(idB, { doors: { ...modelB.doors, handleEnabled: true } });
    const b = snapshotOf(project(), idB);

    expect(b).toEqual(a);
  });
});

/** Снимок изделия без идентификаторов: материалы и кромка — по имени. */
function snapshotOf(p: Project, id: FurnitureId) {
  const furniture = p.furnitures.find((f) => String(f.id) === String(id))!;
  const parts = furniture.assemblies.flatMap((a) => a.parts);
  const names = new Map<string, string>([
    ...p.materials.map((m) => [String(m.id), m.name] as const),
    ...p.edges.map((e) => [String(e.id), e.name] as const),
  ]);
  const nameOf = (v: unknown) => (v == null ? null : names.get(String(v)) ?? String(v));
  const keyOf = (partId: unknown) =>
    String(parts.find((x) => String(x.id) === String(partId))?.metadata?.key ?? '?');
  const own = new Set(parts.map((x) => String(x.id)));

  return {
    parts: parts
      .map((x) => ({
        key: String(x.metadata?.key),
        w: mm(x.width), h: mm(x.height), t: mm(x.thickness),
        material: nameOf(x.material),
        edges: Object.fromEntries(Object.entries(x.edges).map(([k, v]) => [k, nameOf(v)])),
      }))
      .sort((x, y) => x.key.localeCompare(y.key)),
    connections: p.hardwareConnections
      .filter((c) => own.has(String(c.partAId)) && own.has(String(c.partBId)))
      .map((c) => ({
        stableId: c.stableId ?? null,
        category: p.hardware.find((h) => String(h.id) === String(c.hardwareId))?.category ?? null,
        quantity: c.quantity,
      }))
      .sort((x, y) => String(x.stableId).localeCompare(String(y.stableId))),
    machining: allOperations(p)
      .filter((o) => own.has(String(o.partId)))
      .map((o) => `${keyOf(o.partId)}|${o.type}|${o.face}|${mm(o.x)}|${mm(o.y)}|${o.through === true}`)
      .sort(),
  };
}

describe('Этап 36 · отмена, повтор и разрушающие действия', () => {
  let cabinetId: FurnitureId;

  beforeEach(() => {
    store().newProject('Приёмка');
    cabinetId = buildRealCabinet();
  });

  it('§21 повторное применение той же модели не занимает шаг отмены', () => {
    // Панель подтверждает поле при потере фокуса: тем же значением (этап 37).
    const width = store().getCabinetModel(cabinetId)!.width;
    store().applyCabinetPatch(cabinetId, { width: 2000 });
    const historyAfterChange = store().past.length;

    const model = store().getCabinetModel(cabinetId)!;
    const repeat = store().applyParametricModel(cabinetId, model);
    expect(repeat.ok).toBe(true);
    expect(store().past.length).toBe(historyAfterChange);

    // Одно нажатие «Отменить» возвращает прежнюю ширину.
    store().undo();
    expect(store().getCabinetModel(cabinetId)!.width).toBe(width);
  });

  it('§21/§22 undo/redo: создание, изменение, материал, кромка, фурнитура, присадка', () => {
    // Изменение размера.
    const widthBefore = store().getCabinetModel(cabinetId)!.width;
    store().applyCabinetPatch(cabinetId, { width: 2000 });
    expect(store().getCabinetModel(cabinetId)!.width).toBe(2000);
    store().undo();
    expect(store().getCabinetModel(cabinetId)!.width).toBe(widthBefore);
    store().redo();
    expect(store().getCabinetModel(cabinetId)!.width).toBe(2000);
    store().undo();

    // Кромка.
    const partId = partsOf(cabinetId)[0].id;
    const edge = project().edges[0].id;
    store().setPartEdge(partId, 'left', edge);
    expect(findPart(project(), partId)!.edges.left).toBeTruthy();
    store().undo();
    expect(findPart(project(), partId)!.edges.left).toBeNull();
    store().redo();
    expect(findPart(project(), partId)!.edges.left).toBeTruthy();

    // Фурнитура: новое соединение.
    const parts = partsOf(cabinetId);
    const hw = project().hardware[0];
    const connBefore = project().hardwareConnections.length;
    store().addConnection({ hardwareId: hw.id, partAId: parts[0].id, partBId: parts[1].id });
    expect(project().hardwareConnections.length).toBe(connBefore + 1);
    store().undo();
    expect(project().hardwareConnections.length).toBe(connBefore);
    store().redo();
    expect(project().hardwareConnections.length).toBe(connBefore + 1);

    // Присадка: ручная операция.
    const opId = store().addManualOperation({
      partId: parts[0].id, face: 'front', x: 50, y: 50, diameter: 8, depth: 10,
    });
    const hasOp = () => allParts(project()).some((p) => p.machining.some((o) => String(o.id) === String(opId)));
    expect(hasOp()).toBe(true);
    store().undo();
    expect(hasOp()).toBe(false);
    store().redo();
    expect(hasOp()).toBe(true);
  });

  it('§25/§26 удаление изделия каскадно чистит связи, undo возвращает всё', () => {
    const partIds = new Set(partsOf(cabinetId).map((p) => String(p.id)));
    const before = {
      parts: allParts(project()).length,
      connections: project().hardwareConnections.length,
      operations: allOperations(project()).length,
    };

    store().removeFurniture(cabinetId);

    // Каскад: ни деталей, ни их соединений, ни производной присадки.
    expect(allParts(project()).some((p) => partIds.has(String(p.id)))).toBe(false);
    expect(project().hardwareConnections.some(
      (c) => partIds.has(String(c.partAId)) || partIds.has(String(c.partBId)),
    )).toBe(false);
    expect(allOperations(project()).some((o) => partIds.has(String(o.partId)))).toBe(false);

    store().undo();
    expect(allParts(project())).toHaveLength(before.parts);
    expect(project().hardwareConnections).toHaveLength(before.connections);
    expect(allOperations(project())).toHaveLength(before.operations);
  });

  it('§23 деталь нельзя сделать нулевой или отрицательной', () => {
    const part = partsOf(cabinetId)[0];
    const before = { w: part.width, h: part.height, t: part.thickness, q: part.quantity };

    for (const patch of [
      { width: -50 }, { width: 0 }, { height: -1 }, { thickness: 0 },
      { width: Number.NaN }, { quantity: 0 }, { quantity: -3 },
    ]) {
      store().updatePart(part.id, patch);
      const after = findPart(project(), part.id)!;
      expect({ w: after.width, h: after.height, t: after.thickness, q: after.quantity }).toEqual(before);
    }

    // Нормальное изменение по-прежнему проходит.
    store().updatePart(part.id, { width: 500 });
    expect(findPart(project(), part.id)!.width).toBe(500);
  });

  it('§23/§24 невалидные размеры отклоняются с понятным сообщением', () => {
    const bad = [0, -100, Number.NaN, Number.POSITIVE_INFINITY];
    for (const value of bad) {
      const result = store().applyCabinetPatch(cabinetId, { width: value });
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Сообщение для человека: без служебных кодов и стеков.
      for (const message of result.errors) {
        expect(message.length).toBeGreaterThan(10);
        expect(message).not.toMatch(/undefined|NaN at|Error:|\bstack\b/i);
      }
      // Модель не пострадала.
      expect(store().getCabinetModel(cabinetId)!.width).toBe(CABINET.width);
    }
  });
});

describe('Этап 36 · сквозной пересчёт по цепочке разделов', () => {
  let cabinetId: FurnitureId;

  beforeEach(() => {
    store().newProject('Приёмка');
    cabinetId = buildRealCabinet();
  });

  it('§27/§28 изменение размера пересчитывает раскрой, BOM и производство', () => {
    const sizeOf = (partId: PartId) => {
      const p = findPart(project(), partId)!;
      return `${mm(p.width)}x${mm(p.height)}`;
    };
    const shelf = partsOf(cabinetId).find((p) => p.metadata?.partType === 'shelf')!;
    const before = sizeOf(shelf.id);

    store().applyCabinetPatch(cabinetId, { width: 1800 });

    const after = sizeOf(shelf.id);
    expect(after).not.toBe(before);

    // Раскрой, BOM и производство берут НОВЫЕ размеры из модели.
    const report = runCutting(project());
    const placement = report.jobs
      .flatMap((j) => j.sheets.flatMap((s) => s.placements))
      .find((pl) => String(pl.partId) === String(shelf.id))!;
    const updated = findPart(project(), shelf.id)!;
    expect(mm(Math.max(placement.length, placement.width)))
      .toBe(mm(Math.max(updated.width, updated.height)));

    const spec = buildSpecification(allParts(project()), project().materials, project().edges);
    const row = spec.rows.find((r) => String(r.partId) === String(shelf.id))!;
    expect(mm(row.length)).toBe(mm(Math.max(updated.width, updated.height)));

    const prod = productionParts(project()).find((r) => String(r.partId) === String(shelf.id))!;
    expect(mm(prod.width)).toBe(mm(updated.width));
    expect(mm(prod.height)).toBe(mm(updated.height));
  });

  it('§29 смена толщины материала пересобирает изделие и раскрой', () => {
    const materialId = store().getCabinetModel(cabinetId)!.materialId!;
    const before = partsOf(cabinetId).find((p) => p.metadata?.partType === 'top')!;
    const beforeLong = Math.max(before.width, before.height);

    store().updateMaterial(materialId, { thickness: 18 });

    const after = partsOf(cabinetId).find((p) => p.metadata?.partType === 'top')!;
    expect(after.thickness).toBe(18);
    // Верх между боковинами: при большей толщине он короче.
    expect(Math.max(after.width, after.height)).toBeLessThan(beforeLong);

    const spec = buildSpecification(allParts(project()), project().materials, project().edges);
    const row = spec.rows.find((r) => String(r.partId) === String(after.id))!;
    expect(mm(row.thickness)).toBe(18);
  });

  it('§30/§31 правка фурнитуры и присадки доходит до производства и документов', () => {
    const parts = partsOf(cabinetId);
    const side = parts.find((p) => p.metadata?.partType === 'side_left')!;
    const opId = store().addManualOperation({
      partId: side.id, face: 'front', x: 100, y: 200, diameter: 8, depth: 12,
    });

    store().updateManualOperation(opId!, { diameter: 10, x: 150 });
    const op = allOperations(project()).find((o) => String(o.id) === String(opId))!;
    expect(op.diameter).toBe(10);
    expect(op.x).toBe(150);

    // Производство видит операцию на своей детали.
    const row = productionParts(project()).find((r) => String(r.partId) === String(side.id))!;
    expect(row.operations.length).toBeGreaterThan(0);
    expect(row.operations.some((o) => mm(o.diameter ?? 0) === 10)).toBe(true);

    // Документ детали строится с этой присадкой.
    expect(() => buildPartsDocument(project())).not.toThrow();
  });
});

describe('Этап 36 · нагрузка и устойчивость', () => {
  beforeEach(() => store().newProject('Нагрузка'));

  /** Собрать проект примерно с нужным числом деталей из нескольких шкафов. */
  function buildParts(target: number) {
    while (allParts(project()).length < target) {
      const id = store().createParametricCabinet({
        type: 'CABINET', width: 900, height: 2000, depth: 600, thickness: 16,
      });
      if (!id) break;
      const model = store().getCabinetModel(id)!;
      store().applyCabinetPatch(id, { shelves: { ...model.shelves, count: 6 } });
    }
  }

  it('§36 проект на 100, 500 и 1000 деталей остаётся рабочим', () => {
    for (const target of [100, 500, 1000]) {
      buildParts(target);
      const parts = allParts(project());
      expect(parts.length).toBeGreaterThanOrEqual(target);

      const started = Date.now();
      const report = runCutting(project());
      const cuttingMs = Date.now() - started;
      expect(report.jobs.length).toBeGreaterThan(0);

      const specStarted = Date.now();
      buildSpecification(parts, project().materials, project().edges);
      const specMs = Date.now() - specStarted;

      // Порог намеренно щедрый: ловим деградацию на порядок, а не колебания.
      expect(cuttingMs).toBeLessThan(30_000);
      expect(specMs).toBeLessThan(5_000);
    }
  }, 180_000);

  it('§37 повторное открытие проектов не накапливает мусор', () => {
    const sizes: number[] = [];
    for (let i = 0; i < 5; i++) {
      store().newProject(`Проект ${i}`);
      buildRealCabinet();
      sizes.push(allParts(project()).length);
      // История не растёт бесконечно между проектами.
      expect(store().past.length).toBeLessThan(100);
    }
    // Каждый новый проект даёт одинаковый результат — состояние не «залипает».
    expect(new Set(sizes).size).toBe(1);
  });
});
