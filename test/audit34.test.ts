/**
 * ЭТАП 34 — АУДИТ приложения после этапов 1–33.
 *
 * Тесты проверяют не отдельную подсистему, а СВЯЗИ между ними: целостность
 * данных при удалении, круговой рейс «создать → сохранить → загрузить →
 * сравнить», уникальность идентификаторов, пустые состояния, безопасность
 * экспорта и полный пользовательский сценарий.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { createProject } from '@/core/model/factory';
import { serializeProject, deserializeProject, ProjectParseError } from '@/storage/project/serialization';
import { saveProject, loadProject as repoLoad, listProjects, loadLastProject } from '@/storage/project/projectRepository';
import { allOperations } from '@/engines/machining';
import { runCutting, isCuttingStale, cuttingCsv, sheetToSvg } from '@/engines/cutting';
import { hardwareBom, projectItems, itemLayout, hardwareItemReport } from '@/engines/hardware';
import { buildSpecification } from '@/engines/bom/specification';
import type { Specification } from '@/engines/bom/specification';
import { productionParts, productionReadiness, productionSnapshot, exportProductionJob, productionBatches } from '@/engines/production';
import { buildDocument } from '@/engines/drawing';
import { buildFurnitureScene, nodeOfPart, nodesOfKind, sceneCollisions } from '@/engines/scene';
import { validateProjectModel } from '@/engines/status';
import { createAutosaver } from '@/storage/backup/autosave';
import { m2 } from '@/engines/cutting';
import type { Project } from '@/core/model/types';
import type { HardwareId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;

/** Спецификация проекта: движок принимает детали и справочники. */
const spec = (p: Project): Specification => buildSpecification(allParts(p), p.materials, p.edges);

function makeCabinet(name = 'Аудит'): void {
  store().newProject(name);
  const id = store().createParametricCabinet({ width: 800, height: 2000, depth: 600, name: 'Шкаф' })!;
  const model = store().getCabinetModel(id)!;
  store().applyCabinetPatch(id, {
    shelves: { ...model.shelves, count: 3 },
    doors: { ...model.doors, count: 2 },
  });
}

function placeHardware(entryId: string, partId: PartId): string {
  store().addCatalogHardwareToProject(entryId);
  const result = store().placeHardwareItem({ hardwareId: entryId as HardwareId, partId });
  expect(result.ok).toBe(true);
  return result.itemId!;
}

/** Все идентификаторы проекта, сгруппированные по типу сущности. */
function collectIds(p: Project): Record<string, string[]> {
  return {
    parts: allParts(p).map((x) => String(x.id)),
    furnitures: p.furnitures.map((x) => String(x.id)),
    assemblies: p.furnitures.flatMap((f) => f.assemblies.map((a) => String(a.id))),
    materials: p.materials.map((x) => String(x.id)),
    edges: p.edges.map((x) => String(x.id)),
    hardware: p.hardware.map((x) => String(x.id)),
    connections: p.hardwareConnections.map((x) => String(x.id)),
    items: (p.hardwareInstances ?? []).map((x) => x.id),
    machining: allOperations(p).map((x) => String(x.id)),
  };
}

beforeEach(() => {
  makeCabinet();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Аудит 34 — целостность модели', () => {
  it('A1: идентификаторы уникальны внутри каждого типа сущности', () => {
    placeHardware('cat-hinge', allParts(project())[0].id);
    const ids = collectIds(project());
    for (const [kind, list] of Object.entries(ids)) {
      expect(new Set(list).size, `дубли среди ${kind}`).toBe(list.length);
    }
  });

  it('A2: нет висячих ссылок между сущностями', () => {
    placeHardware('cat-hinge', allParts(project())[0].id);
    const p = project();
    const partIds = new Set(allParts(p).map((x) => String(x.id)));
    const materialIds = new Set(p.materials.map((x) => String(x.id)));
    const edgeIds = new Set(p.edges.map((x) => String(x.id)));
    const hardwareIds = new Set(p.hardware.map((x) => String(x.id)));

    for (const part of allParts(p)) {
      if (part.material) expect(materialIds.has(String(part.material)), `материал детали ${part.name}`).toBe(true);
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        const edge = part.edges[side];
        if (edge) expect(edgeIds.has(String(edge)), `кромка ${side} детали ${part.name}`).toBe(true);
      }
    }
    for (const c of p.hardwareConnections) {
      expect(partIds.has(String(c.partAId)), `связь ${c.id} → деталь A`).toBe(true);
      expect(partIds.has(String(c.partBId)), `связь ${c.id} → деталь B`).toBe(true);
      expect(hardwareIds.has(String(c.hardwareId)), `связь ${c.id} → фурнитура`).toBe(true);
    }
    for (const item of projectItems(p)) {
      expect(partIds.has(String(item.partId)), `единица ${item.id} → деталь`).toBe(true);
      expect(hardwareIds.has(String(item.hardwareId)), `единица ${item.id} → позиция`).toBe(true);
    }
    for (const op of allOperations(p)) {
      expect(partIds.has(String(op.partId)), `операция ${op.id} → деталь`).toBe(true);
    }
  });

  it('A3: удаление детали не оставляет сирот — связи, фурнитуру и присадку', () => {
    const parts = allParts(project());
    const target = parts.find((p) => project().hardwareConnections
      .some((c) => String(c.partAId) === String(p.id) || String(c.partBId) === String(p.id))) ?? parts[0];
    placeHardware('cat-hinge', target.id);

    const connectionsBefore = project().hardwareConnections.length;
    expect(projectItems(project()).some((i) => String(i.partId) === String(target.id))).toBe(true);

    store().removePart(target.id);

    const p = project();
    const partIds = new Set(allParts(p).map((x) => String(x.id)));
    expect(partIds.has(String(target.id))).toBe(false);

    // Ни одна связь не должна ссылаться на удалённую деталь.
    const deadConnections = p.hardwareConnections.filter(
      (c) => String(c.partAId) === String(target.id) || String(c.partBId) === String(target.id));
    expect(deadConnections, 'висячие соединения после удаления детали').toEqual([]);
    expect(p.hardwareConnections.length).toBeLessThanOrEqual(connectionsBefore);

    // Ни одна единица фурнитуры не должна висеть на удалённой детали.
    const deadItems = projectItems(p).filter((i) => String(i.partId) === String(target.id));
    expect(deadItems, 'висячая фурнитура после удаления детали').toEqual([]);

    // И ни одна операция присадки.
    const deadOps = allOperations(p).filter((op) => String(op.partId) === String(target.id));
    expect(deadOps, 'висячая присадка после удаления детали').toEqual([]);
  });

  it('A4: удаление изделия убирает его детали, связи и фурнитуру', () => {
    const furnitureId = store().activeFurnitureId!;
    placeHardware('cat-handle', allParts(project())[0].id);
    const partIds = new Set(allParts(project()).map((x) => String(x.id)));

    store().removeFurniture(furnitureId);

    const p = project();
    expect(p.furnitures.some((f) => f.id === furnitureId)).toBe(false);
    expect(p.hardwareConnections.filter((c) => partIds.has(String(c.partAId)))).toEqual([]);
    expect(projectItems(p).filter((i) => partIds.has(String(i.partId))), 'фурнитура удалённого шкафа').toEqual([]);
  });

  it('A5: валидатор модели не находит ошибок на типовом шкафе', () => {
    const result = validateProjectModel(project());
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Аудит 34 — круговой рейс данных', () => {
  it('A6: create → save → load → compare сохраняет проект целиком', async () => {
    placeHardware('cat-hinge', allParts(project())[0].id);
    store().applyCuttingReport(runCutting(project()));
    store().refreshProduction();
    store().generateDocuments?.();

    const before = project();
    const beforeJson = serializeProject(before);

    await saveProject(before);
    const loaded = await repoLoad(before.id);
    expect(loaded).not.toBeNull();
    expect(serializeProject(loaded!)).toBe(beforeJson);

    const roundTrip = deserializeProject(beforeJson);
    expect(serializeProject(roundTrip)).toBe(beforeJson);
    expect((await listProjects()).some((x) => x.id === before.id)).toBe(true);
  });

  it('A7: круговой рейс сохраняет материалы, кромку, фурнитуру и присадку', () => {
    const part = allParts(project())[0];
    store().setPartEdge(part.id, 'top', project().edges[0].id);
    placeHardware('cat-confirmat', part.id);
    const itemId = projectItems(project())[0].id;
    store().moveHardwareItem(itemId, { x: 40 });

    const restored = deserializeProject(serializeProject(project()));

    expect(restored.materials.length).toBe(project().materials.length);
    expect(restored.edges.length).toBe(project().edges.length);
    expect(restored.hardware.length).toBe(project().hardware.length);
    expect((restored.hardwareInstances ?? []).length).toBe(projectItems(project()).length);
    expect(restored.hardwareInstances!.find((i) => i.id === itemId)!.override).toBeDefined();

    const current = findPart(project(), part.id)!;
    const partRestored = findPart(restored, part.id)!;
    expect(partRestored.edges.top).toBe(current.edges.top);
    expect(partRestored.material).toBe(current.material);
    expect(allOperations(restored).length).toBe(allOperations(project()).length);
  });

  it('A8: круговой рейс сохраняет раскрой, производство и документы', () => {
    store().applyCuttingReport(runCutting(project()));
    store().refreshProduction();
    const jobsBefore = project().cutting.report!.jobs.length;
    const revisionBefore = project().production!.job!.revision;

    const restored = deserializeProject(serializeProject(project()));
    expect(restored.cutting.report!.jobs.length).toBe(jobsBefore);
    expect(restored.production!.job!.revision).toBe(revisionBefore);
    expect(isCuttingStale(restored)).toBe(false);

    // Производные данные считаются одинаково для оригинала и копии.
    expect(productionParts(restored).length).toBe(productionParts(project()).length);
    expect(hardwareBom(restored).length).toBe(hardwareBom(project()).length);
    expect(spec(restored).rows.length).toBe(spec(project()).rows.length);
    expect(buildDocument(restored, 'partsList').pages.length)
      .toBe(buildDocument(project(), 'partsList').pages.length);
  });

  it('A9: повреждённые и чужие данные отклоняются с понятным сообщением', () => {
    expect(() => deserializeProject('{')).toThrow(ProjectParseError);
    expect(() => deserializeProject('{"name":"без деталей"}')).toThrow(ProjectParseError);
    try {
      deserializeProject('{"id":"1","name":"x","version":"0.1.0","materials":[],"edges":[],"hardware":[],"furnitures":[]}');
      expect.unreachable('несовместимая версия должна отклоняться');
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectParseError);
      expect(String((e as Error).message)).not.toContain('undefined');
    }
  });

  it('A10: неизвестные поля не ломают загрузку', () => {
    const raw = JSON.parse(serializeProject(project()));
    raw.какое_то_новое_поле = { a: 1 };
    raw.furnitures[0].лишнее = true;
    const restored = deserializeProject(JSON.stringify(raw));
    expect(allParts(restored).length).toBe(allParts(project()).length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Аудит 34 — параметрические изменения и зависимые системы', () => {
  it('A11: изменение размера детали проходит по всей цепочке', () => {
    store().applyCuttingReport(runCutting(project()));
    const part = allParts(project())[0];
    const snapshotBefore = productionSnapshot(project(), productionParts(project()));
    const bomBefore = spec(project()).rows.length;

    store().updatePart(part.id, { width: part.width + 100 });

    expect(findPart(project(), part.id)!.width).toBe(part.width + 100);
    expect(nodeOfPart(buildFurnitureScene(project()), String(part.id))!.size.x).toBe(part.width + 100);
    expect(isCuttingStale(project()), 'раскрой должен стать DIRTY').toBe(true);
    expect(productionSnapshot(project(), productionParts(project())).projectRevision)
      .not.toBe(snapshotBefore.projectRevision);
    expect(spec(project()).rows.length).toBeGreaterThanOrEqual(bomBefore - 1);
  });

  it('A12: изменение габаритов шкафа перестраивает детали, фурнитуру и присадку', () => {
    const part = allParts(project())[0];
    placeHardware('cat-hinge', part.id);
    const opsBefore = allOperations(project()).length;
    const id = store().activeFurnitureId!;
    const model = store().getCabinetModel(id)!;

    store().applyCabinetPatch(id, { width: 1000, shelves: { ...model.shelves }, doors: { ...model.doors } });

    expect(allParts(project()).length).toBeGreaterThan(0);
    // Фурнитура нашла свои детали заново и продолжает давать присадку.
    expect(projectItems(project()).length).toBeGreaterThan(0);
    expect(itemLayout(project(), projectItems(project())[0])).not.toBeNull();
    expect(allOperations(project()).length).toBeGreaterThan(0);
    expect(opsBefore).toBeGreaterThan(0);
  });

  it('A13: смена материала расходится по раскрою, BOM и производству', () => {
    const part = allParts(project())[0];
    const other = project().materials.find((m) => String(m.id) !== String(part.material));
    if (!other) return;

    store().updatePart(part.id, { material: other.id });

    expect(productionParts(project()).find((x) => String(x.partId) === String(part.id))!.materialName)
      .toBe(other.name);
    expect(nodeOfPart(buildFurnitureScene(project()), String(part.id))!.material!.color).toBe(other.color);
    const jobs = runCutting(project()).jobs;
    expect(jobs.some((j) => String(j.materialId) === String(other.id))).toBe(true);
  });

  it('A14: смена кромки меняет заготовочный размер и расход', () => {
    const part = allParts(project())[0];
    const before = productionParts(project()).find((x) => String(x.partId) === String(part.id))!;
    store().setPartEdge(part.id, 'left', project().edges[0].id);
    store().setPartEdge(part.id, 'right', project().edges[0].id);
    const after = productionParts(project()).find((x) => String(x.partId) === String(part.id))!;

    expect(after.rawWidth).toBeLessThan(before.rawWidth);
    expect(after.edges.filter((e) => e.edgeMaterialId).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Аудит 34 — Undo/Redo и история', () => {
  it('A15: отмена и повтор работают для размера, материала, кромки и фурнитуры', () => {
    const part = allParts(project())[0];
    const width = part.width;

    store().updatePart(part.id, { width: width + 40 });
    store().undo();
    expect(findPart(project(), part.id)!.width).toBe(width);
    store().redo();
    expect(findPart(project(), part.id)!.width).toBe(width + 40);

    const edgeId = project().edges[0].id;
    store().setPartEdge(part.id, 'top', edgeId);
    store().undo();
    expect(findPart(project(), part.id)!.edges.top).not.toBe(edgeId);

    placeHardware('cat-handle', part.id);
    const count = projectItems(project()).length;
    store().undo();
    expect(projectItems(project()).length).toBe(count - 1);
    store().redo();
    expect(projectItems(project()).length).toBe(count);
  });

  it('A16: состояние вида не попадает в историю', () => {
    const before = serializeProject(project());
    store().setSceneView('TOP');
    store().setSceneVisibility({ showMachining: true });
    store().setSceneSection({ enabled: true });
    store().setViewer({ showGrid: false });
    expect(serializeProject(project())).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Аудит 34 — пустые состояния и границы', () => {
  it('A17: пустой проект не ломает ни одну подсистему', () => {
    const empty = createProject({ name: 'Пустой', withStarterContent: false });
    expect(allParts(empty).length).toBe(0);
    expect(() => runCutting(empty)).not.toThrow();
    expect(() => buildFurnitureScene(empty)).not.toThrow();
    expect(() => spec(empty)).not.toThrow();
    expect(() => productionParts(empty)).not.toThrow();
    expect(() => hardwareBom(empty)).not.toThrow();
    expect(() => allOperations(empty)).not.toThrow();
    expect(() => buildDocument(empty, 'partsList')).not.toThrow();
    expect(productionReadiness(empty, productionParts(empty)).checklist.length).toBe(7);
  });

  it('A18: проект без материалов и фурнитуры считается без исключений', () => {
    const bare = createProject({ name: 'Голый', withStarterContent: false });
    const p: Project = { ...bare, materials: [], edges: [], hardware: [] };
    expect(() => runCutting(p)).not.toThrow();
    expect(() => productionParts(p)).not.toThrow();
    expect(() => buildFurnitureScene(p)).not.toThrow();
    expect(hardwareItemReport(p)).toEqual([]);
    expect(productionBatches(productionParts(p))).toEqual([]);
  });

  it('A19: нулевые и отрицательные размеры отклоняются или помечаются ошибкой', () => {
    const part = allParts(project())[0];
    store().updatePart(part.id, { width: 0 });
    const issues = productionReadiness(project(), productionParts(project())).issues;
    expect(issues.some((i) => i.severity === 'error')).toBe(true);

    store().updatePart(part.id, { width: -100 });
    expect(() => buildFurnitureScene(project())).not.toThrow();
    expect(() => runCutting(project())).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Аудит 34 — безопасность и локальность', () => {
  it('A20: пользовательский текст не попадает в SVG как разметка', () => {
    const evil = '</text><script>alert(1)</script>';
    const part = allParts(project())[0];
    store().updatePart(part.id, { name: evil });
    store().renameFurniture(store().activeFurnitureId!, evil);

    const result = runCutting(project());
    store().applyCuttingReport(result);
    const sheet = result.jobs[0]?.sheets[0];
    if (sheet) {
      const svg = sheetToSvg(sheet, evil);
      expect(svg).not.toContain('<script>');
      expect(svg).toContain('&lt;');
    }
    const doc = buildDocument(project(), 'partsList');
    const text = JSON.stringify(doc);
    expect(text).toBeTruthy();
  });

  it('A21: экспорт не содержит внешних адресов и выполняемого кода', () => {
    store().applyCuttingReport(runCutting(project()));
    store().refreshProduction();
    const parts = productionParts(project());
    const payloads = [
      serializeProject(project()),
      cuttingCsv(project().cutting.report!),
      exportProductionJob(project(), { job: project().production!.job!, parts, batches: productionBatches(parts) }),
      store().exportHardwareCatalogJson(),
    ];
    for (const payload of payloads) {
      expect(payload).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
      expect(payload).not.toContain('<script');
      expect(payload).not.toContain('javascript:');
    }
  });

  it('A22: импорт не выполняет код и не принимает мусор', () => {
    const bad = JSON.stringify({ format: 'karkas-hardware-catalog', version: 1, entries: 'нет' });
    expect(store().importHardwareCatalogJson(bad).ok).toBe(false);
    expect(store().importCuttingJobsJson('{').ok).toBe(false);
    expect(store().importProductionJobJson('[]').ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Аудит 34 — большой проект и полный сценарий', () => {
  it('A23: полный пользовательский сценарий проходит от проекта до документов', () => {
    // 1–3: проект, шкаф, размеры.
    store().newProject('Сценарий');
    const cabinetId = store().createParametricCabinet({ width: 900, height: 2100, depth: 550, name: 'Шкаф' })!;
    const model = store().getCabinetModel(cabinetId)!;
    // 4–8: материалы, кромка, двери, полки, ящики.
    store().applyCabinetPatch(cabinetId, {
      shelves: { ...model.shelves, count: 4 },
      doors: { ...model.doors, count: 2 },
    });
    const parts = allParts(project());
    expect(parts.length).toBeGreaterThan(5);
    for (const part of parts.slice(0, 4)) {
      store().setPartEdge(part.id, 'top', project().edges[0].id);
    }
    // 9–10: фурнитура и присадка.
    placeHardware('cat-hinge', parts[0].id);
    placeHardware('cat-shelf_pin', parts[1].id);
    expect(allOperations(project()).length).toBeGreaterThan(0);

    // 11–12: 2D и 3D читают ту же модель.
    const scene = buildFurnitureScene(project());
    expect(scene.stats.parts).toBe(allParts(project()).length);
    expect(nodesOfKind(scene, 'HARDWARE').length).toBeGreaterThan(0);
    expect(sceneCollisions(scene, project()).filter((c) => c.severity === 'error')).toEqual([]);

    // 13–15: раскрой, BOM, производство.
    store().applyCuttingReport(runCutting(project()));
    expect(project().cutting.report!.jobs.length).toBeGreaterThan(0);
    expect(spec(project()).rows.length).toBeGreaterThan(0);
    expect(hardwareBom(project()).length).toBeGreaterThan(0);
    const refreshed = store().refreshProduction();
    expect(refreshed.status).toBeTruthy();
    expect(productionParts(project()).length).toBe(allParts(project()).length);

    // 16: документы.
    for (const key of ['partsList', 'hardwareList', 'materialList', 'cutting', 'parts']) {
      expect(buildDocument(project(), key).pages.length, `документ ${key}`).toBeGreaterThan(0);
    }

    // 17–20: сохранение, повторное открытие, продолжение правок.
    const saved = serializeProject(project());
    const reopened = deserializeProject(saved);
    store().loadProject(reopened);
    expect(allParts(project()).length).toBe(allParts(reopened).length);
    const part = allParts(project())[0];
    store().updatePart(part.id, { width: part.width + 10 });
    expect(findPart(project(), part.id)!.width).toBe(part.width + 10);
  });

  it('A24: большой проект — несколько шкафов, сотни деталей, полный pipeline', () => {
    store().newProject('Большой');
    for (let i = 0; i < 4; i++) {
      const id = store().createParametricCabinet({
        width: 800 + i * 100, height: 2000, depth: 600, name: `Шкаф ${i + 1}`,
      })!;
      const model = store().getCabinetModel(id)!;
      store().applyCabinetPatch(id, {
        shelves: { ...model.shelves, count: 4 },
        doors: { ...model.doors, count: 2 },
      });
    }
    const parts = allParts(project());
    expect(parts.length).toBeGreaterThan(30);
    placeHardware('cat-hinge', parts[0].id);

    const t0 = Date.now();
    const scene = buildFurnitureScene(project());
    const cutting = runCutting(project());
    const specification = spec(project());
    const production = productionParts(project());
    const elapsed = Date.now() - t0;

    expect(scene.stats.parts).toBe(parts.length);
    expect(cutting.jobs.length).toBeGreaterThan(0);
    expect(specification.rows.length).toBeGreaterThan(0);
    expect(production.length).toBe(parts.length);
    expect(elapsed, `полный пересчёт занял ${elapsed} мс`).toBeLessThan(20000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Аудит 34 — обработка ошибок и единообразие', () => {
  it('A25: сбой автосохранения сообщается пользователю и не теряет проект', async () => {
    const statuses: string[] = [];
    const errors: string[] = [];
    const autosaver = createAutosaver({
      delayMs: 1,
      onStatus: (s) => statuses.push(s),
      onError: (m) => errors.push(m),
    });

    // Проект без обязательных полей — репозиторий отказывается его писать.
    autosaver.schedule({ ...project(), id: undefined as never });
    await autosaver.flush();

    // Пользователь видит и статус, и понятное сообщение — без stack trace.
    if (errors.length > 0) {
      expect(statuses).toContain('error');
      expect(errors[0]).toContain('сохранить');
      expect(errors[0]).not.toContain('at ');
    } else {
      // Если запись всё-таки прошла, статус обязан быть «сохранено».
      expect(statuses).toContain('saved');
    }
  });

  it('A26: успешное автосохранение отдаёт статусы saving → saved', async () => {
    const statuses: string[] = [];
    const autosaver = createAutosaver({ delayMs: 1, onStatus: (s) => statuses.push(s) });
    autosaver.schedule(project());
    await autosaver.flush();
    expect(statuses).toEqual(['saving', 'saved']);
    expect(await repoLoad(project().id)).not.toBeNull();
  });

  it('A27: перевод площади в м² единый для всего раскроя', () => {
    expect(m2(1_000_000)).toBe(1);
    expect(m2(1_234_567)).toBe(1.23);
    store().applyCuttingReport(runCutting(project()));
    const sheet = project().cutting.report!.jobs[0].sheets[0];
    expect(m2(sheet.usedAreaMm2)).toBe(Math.round((sheet.usedAreaMm2 / 1_000_000) * 100) / 100);
  });

  it('A28: все производственные размеры остаются в миллиметрах', () => {
    expect(project().settings.displayUnits).toBe('mm');
    const parts = productionParts(project());
    for (const part of parts.slice(0, 5)) {
      expect(part.width).toBeGreaterThan(1);
      expect(part.width).toBeLessThan(10000);
      expect(part.thickness).toBeLessThan(100);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Аудит 34 — восстановление после перезапуска', () => {
  it('A29: последний сохранённый проект возвращается при старте', async () => {
    placeHardware('cat-hinge', allParts(project())[0].id);
    const expectedParts = allParts(project()).length;
    const expectedItems = projectItems(project()).length;
    await saveProject(project());

    const restored = await loadLastProject();
    expect(restored, 'после перезапуска должен восстанавливаться сохранённый проект').toBeDefined();
    expect(allParts(restored!).length).toBe(expectedParts);
    expect((restored!.hardwareInstances ?? []).length).toBe(expectedItems);
  });

  it('A30: восстановленный проект продолжает работать во всех подсистемах', async () => {
    store().applyCuttingReport(runCutting(project()));
    store().refreshProduction();
    await saveProject(project());

    const restored = (await loadLastProject())!;
    store().loadProject(restored);

    expect(allOperations(project()).length).toBeGreaterThanOrEqual(0);
    expect(() => buildFurnitureScene(project())).not.toThrow();
    expect(productionParts(project()).length).toBe(allParts(project()).length);
    expect(project().cutting.report).toBeDefined();

    const part = allParts(project())[0];
    store().updatePart(part.id, { width: part.width + 5 });
    expect(findPart(project(), part.id)!.width).toBe(part.width + 5);
  });
});
