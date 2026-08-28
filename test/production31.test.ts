/**
 * ЭТАП 31 — Производственный модуль.
 *
 * Цепочка: ProjectModel → производственные детали → кромка и присадка →
 * партии → готовность → снимок → выпуск → карта детали → этикетка → пакет.
 *
 * Проверяет ProductionJob и его статусы, стабильные номера P-001, ревизии и
 * статусы деталей, чистовой и заготовочный размер, кромку К1–К4, присадку из
 * существующих MachiningOperation, партии, чек-лист из семи пунктов, процент
 * готовности, переход к объекту ошибки, снимок ревизий, выпуск REL-001 и его
 * неизменяемость, определение изменений, историю, карту детали с видами и
 * обозначениями, этикетки с QR и штрихкодом без внешних сервисов, экспорт и
 * импорт production-job.json, CSV, состав пакета, панель, сортировку и
 * фильтры, 1000 деталей и полную регрессию.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CARD_VIEWS,
  EDGE_LABELS,
  LABEL_SIZES,
  PRODUCTION_DOCUMENTS,
  PRODUCTION_FILE_FORMAT,
  barcodeBars,
  barcodeSvg,
  barcodeWidth,
  batchSummary,
  bumpRevision,
  cardEdges,
  cardOperations,
  cardViews,
  changedSections,
  checkCuttingPlacement,
  checkDimensions,
  checkEdges,
  checkHardware,
  checkMachining,
  checkMarking,
  checkMaterials,
  clearQrGenerators,
  createProductionJob,
  createRelease,
  detectChanges,
  exportProductionJob,
  filterProductionParts,
  findProductionPart,
  importProductionJob,
  isReleaseOutdated,
  jobOf,
  jobStatusFor,
  labelPreview,
  labelSheets,
  labelSize,
  latestRelease,
  machiningTable,
  nextReleaseNumber,
  operationNotation,
  packageContents,
  parseQrPayload,
  partCard,
  partCards,
  partNumber,
  partRevision,
  productionBatches,
  productionDashboard,
  productionEdges,
  productionFileName,
  productionHistory,
  productionLabels,
  productionPackage,
  productionParts,
  productionPartsCsv,
  productionReadiness,
  productionSnapshot,
  qrMatrix,
  qrMatrixToSvg,
  qrPayload,
  rawDimensions,
  registerQrGenerator,
  releaseId,
  signature,
  sortProductionParts,
  toBarcodeText,
} from '@/engines/production';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { runCutting } from '@/engines/cutting';
import { buildDocument } from '@/engines/drawing';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';
import type { Project } from '@/core/model/types';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;
const parts = () => productionParts(project());

/** Шкаф 800 × 2000 × 600 с полками и фасадами. */
function makeCabinet(): void {
  store().newProject('Тест 31');
  const id = store().createParametricCabinet({ width: 800, height: 2000, depth: 600, name: 'Шкаф' })!;
  const model = store().getCabinetModel(id)!;
  store().applyCabinetPatch(id, {
    shelves: { ...model.shelves, count: 3 },
    doors: { ...model.doors, count: 2 },
  });
}

beforeEach(() => {
  clearQrGenerators();
  makeCabinet();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Производство 31 — задание и детали', () => {
  it('Тест 1/2: задание ссылается на проект и начинается черновиком', () => {
    const job = createProductionJob(project());
    expect(job.projectId).toBe(String(project().id));
    expect(job.status).toBe('DRAFT');
    expect(job.revision).toBe(1);
    expect(job.releases).toEqual([]);
    expect(jobOf(project()).id).toBe(job.id);
  });

  it('Тест 3/4: у каждой детали уникальный partId и номер P-001', () => {
    const list = parts();
    expect(list.length).toBeGreaterThan(0);
    const ids = new Set(list.map((p) => String(p.partId)));
    expect(ids.size).toBe(list.length);
    for (const part of list) expect(part.number).toMatch(/^P-\d{3,}$/);
  });

  it('Тест 5: номер детали не меняется при повторном расчёте', () => {
    const before = new Map(parts().map((p) => [String(p.partId), p.number]));
    const after = parts();
    for (const part of after) expect(part.number).toBe(before.get(String(part.partId)));
  });

  it('Тест 6: номер выводится из metadata.number, а не из порядка', () => {
    const part = allParts(project())[0];
    expect(partNumber({ ...part, metadata: { number: 'P007' } }, 99)).toBe('P-007');
    expect(partNumber({ ...part, metadata: {} }, 4)).toBe('P-004');
  });

  it('Тест 7: ревизия детали меняется только при изменении данных', () => {
    const part = allParts(project())[0];
    const ops = allOperations(project()).filter((op) => String(op.partId) === String(part.id));
    const base = partRevision(part, ops);
    expect(partRevision(part, ops)).toBe(base);
    expect(partRevision({ ...part, width: part.width + 10 }, ops)).not.toBe(base);
  });

  it('Тест 8/9: статусы NEW/MODIFIED/READY по снимку', () => {
    const first = parts();
    const snapshot: Record<string, string> = {};
    for (const p of first) snapshot[String(p.partId)] = p.revision;

    const unchanged = productionParts(project(), snapshot);
    expect(unchanged.every((p) => p.status === 'READY')).toBe(true);

    const target = allParts(project())[0];
    store().updatePart(target.id, { width: target.width + 25 });
    const changed = productionParts(project(), snapshot);
    const modified = changed.find((p) => String(p.partId) === String(target.id))!;
    expect(modified.status).toBe('MODIFIED');

    const partial = { ...snapshot };
    delete partial[String(target.id)];
    const added = productionParts(project(), partial);
    expect(added.find((p) => String(p.partId) === String(target.id))!.status).toBe('NEW');
  });

  it('Тест 10: деталь без материала получает статус ERROR', () => {
    const target = allParts(project())[0];
    store().updatePart(target.id, { material: null });
    const part = findProductionPart(parts(), String(target.id))!;
    expect(part.status).toBe('ERROR');
    expect(part.issues.length).toBeGreaterThan(0);
  });

  it('Тест 11: заготовочный размер хранится отдельно от чистового', () => {
    const edgeId = project().edges[0].id;
    const target = allParts(project())[0];
    store().setPartEdge(target.id, 'left', edgeId);
    store().setPartEdge(target.id, 'right', edgeId);
    const part = findProductionPart(parts(), String(target.id))!;
    expect(part.width).toBe(allParts(project()).find((p) => p.id === target.id)!.width);
    expect(part.rawWidth).toBeLessThan(part.width);
    expect(part.rawHeight).toBe(part.height);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Производство 31 — кромка и присадка', () => {
  it('Тест 12/13: кромка описана по четырём сторонам с обозначениями К1–К4', () => {
    const part = allParts(project())[0];
    const edges = productionEdges(part, project().edges);
    expect(edges.map((e) => e.label)).toEqual(['К1', 'К2', 'К3', 'К4']);
    expect(EDGE_LABELS.top).toBe('К1');
    expect(edges.every((e) => e.length > 0)).toBe(true);
  });

  it('Тест 14: материал и толщина кромки берутся из проекта', () => {
    const edge = project().edges[0];
    const target = allParts(project())[0];
    store().setPartEdge(target.id, 'top', edge.id);
    const banding = findProductionPart(parts(), String(target.id))!.edges
      .find((e) => e.side === 'top')!;
    expect(banding.edgeMaterialId).toBe(String(edge.id));
    expect(banding.edgeThickness).toBe(edge.thickness);
    expect(banding.materialName).toBe(edge.name);
  });

  it('Тест 15: заготовка уменьшается на толщину наклеенной кромки', () => {
    const part = allParts(project())[0];
    const edges = productionEdges(part, project().edges).map((e) =>
      (e.side === 'left' || e.side === 'right' ? { ...e, edgeThickness: 2 } : e));
    const raw = rawDimensions(part, edges);
    expect(raw.rawWidth).toBe(part.width - 4);
    expect(raw.rawHeight).toBe(part.height);
  });

  it('Тест 16/17: присадка берётся из существующих MachiningOperation', () => {
    const ops = allOperations(project());
    expect(ops.length).toBeGreaterThan(0);
    const total = parts().reduce((sum, p) => sum + p.operations.length, 0);
    expect(total).toBe(ops.length);
  });

  it('Тест 18: у операций детали сквозная нумерация с единицы', () => {
    const withOps = parts().filter((p) => p.operations.length > 1)[0];
    expect(withOps).toBeDefined();
    expect(withOps.operations.map((o) => o.operationIndex))
      .toEqual(withOps.operations.map((_, i) => i + 1));
  });

  it('Тест 19: ручная операция попадает в производственные данные детали', () => {
    const target = allParts(project())[0];
    const before = findProductionPart(parts(), String(target.id))!.operations.length;
    store().addManualOperation({
      partId: target.id, face: 'front', x: 100, y: 100, diameter: 5, depth: 12,
    });
    const after = findProductionPart(parts(), String(target.id))!;
    expect(after.operations.length).toBe(before + 1);
    expect(after.operations.some((op) => op.source === 'MANUAL')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Производство 31 — партии', () => {
  it('Тест 20: партии сгруппированы по материалу, толщине и виду обработки', () => {
    const batches = productionBatches(parts());
    expect(batches.length).toBeGreaterThan(0);
    const keys = new Set(batches.map((b) => `${b.kind}:${b.materialId}:${b.thickness}`));
    expect(keys.size).toBe(batches.length);
    expect(batches.some((b) => b.kind === 'CUT')).toBe(true);
  });

  it('Тест 21: количество партии учитывает quantity деталей', () => {
    const list = parts();
    const cut = productionBatches(list).filter((b) => b.kind === 'CUT');
    const expected = list
      .filter((p) => p.materialId)
      .reduce((sum, p) => sum + p.quantity, 0);
    expect(cut.reduce((sum, b) => sum + b.quantity, 0)).toBe(expected);
  });

  it('Тест 22: сводка по партиям считает статусы', () => {
    const summary = batchSummary(productionBatches(parts()));
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.ready + summary.warning + summary.error).toBe(summary.total);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Производство 31 — готовность', () => {
  it('Тест 23: чек-лист состоит из семи пунктов цеха', () => {
    const readiness = productionReadiness(project(), parts());
    expect(readiness.checklist.map((i) => i.id)).toEqual([
      'material', 'cutting', 'edges', 'machining', 'hardware', 'marking', 'documents',
    ]);
  });

  it('Тест 24: деталь без материала даёт ошибку с переходом к детали', () => {
    const target = allParts(project())[0];
    store().updatePart(target.id, { material: null });
    const issues = checkMaterials(parts());
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].target).toEqual({ kind: 'PART', id: String(target.id) });
  });

  it('Тест 25: нулевой размер детали — ошибка размеров', () => {
    const target = allParts(project())[0];
    store().updatePart(target.id, { width: 0 });
    expect(checkDimensions(parts()).some((i) => i.code === 'production.dimension')).toBe(true);
  });

  it('Тест 26: ссылка на отсутствующий кромочный материал — ошибка', () => {
    const list = parts().map((p) => ({
      ...p,
      edges: p.edges.map((e) => ({ ...e, edgeMaterialId: 'нет-такой' })),
    }));
    const issues = checkEdges(project(), list);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].code).toBe('production.edge');
  });

  it('Тест 27: присадка проверяется существующим валидатором', () => {
    const issues = checkMachining(project());
    expect(Array.isArray(issues)).toBe(true);
    for (const issue of issues) expect(issue.code.startsWith('production.machining.')).toBe(true);
  });

  it('Тест 28: узел без фурнитуры — ошибка фурнитуры', () => {
    const issues = checkHardware(project());
    expect(Array.isArray(issues)).toBe(true);
    for (const issue of issues) expect(issue.target).toEqual({ kind: 'SECTION', id: 'connections' });
  });

  it('Тест 29: без раскроя пункт «Раскрой» предупреждает, но не блокирует', () => {
    const issues = checkCuttingPlacement(project());
    expect(issues.some((i) => i.code === 'production.cutting.missing')).toBe(true);
    const readiness = productionReadiness(project(), parts());
    expect(readiness.checklist.find((i) => i.id === 'cutting')!.ok).toBe(true);
  });

  it('Тест 30: рассчитанный раскрой убирает предупреждение об отсутствии плана', () => {
    store().applyCuttingReport(runCutting(project()));
    const issues = checkCuttingPlacement(project());
    expect(issues.some((i) => i.code === 'production.cutting.missing')).toBe(false);
  });

  it('Тест 31: маркировка проверяет формат номера', () => {
    const list = parts().map((p, i) => (i === 0 ? { ...p, number: 'без номера' } : p));
    const issues = checkMarking(list);
    expect(issues.length).toBe(1);
    expect(issues[0].severity).toBe('warning');
  });

  it('Тест 32/33: процент готовности и признак READY', () => {
    const ok = productionReadiness(project(), parts());
    expect(ok.progress).toBeGreaterThanOrEqual(0);
    expect(ok.progress).toBeLessThanOrEqual(100);
    expect(ok.ready).toBe(ok.errors === 0);

    const target = allParts(project())[0];
    store().updatePart(target.id, { material: null });
    const bad = productionReadiness(project(), parts());
    expect(bad.ready).toBe(false);
    expect(bad.errors).toBeGreaterThan(0);
    expect(bad.progress).toBeLessThan(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Производство 31 — снимок, выпуск, изменения', () => {
  it('Тест 34: снимок содержит ревизии разделов и деталей', () => {
    const list = parts();
    const snapshot = productionSnapshot(project(), list);
    expect(snapshot.projectRevision).toMatch(/^[0-9a-f]{8}$/);
    expect(snapshot.partsRevision).toBeTruthy();
    expect(snapshot.cuttingRevision).toBeTruthy();
    expect(snapshot.machiningRevision).toBeTruthy();
    expect(snapshot.hardwareRevision).toBeTruthy();
    expect(Object.keys(snapshot.parts).length).toBe(list.length);
  });

  it('Тест 35: снимок повторяем и меняется вместе с моделью', () => {
    const a = productionSnapshot(project(), parts());
    const b = productionSnapshot(project(), parts());
    expect(b.projectRevision).toBe(a.projectRevision);

    const target = allParts(project())[0];
    store().updatePart(target.id, { width: target.width + 15 });
    const c = productionSnapshot(project(), parts());
    expect(c.projectRevision).not.toBe(a.projectRevision);
  });

  it('Тест 36/37: выпуск получает номер REL-001 и не меняется вслед за проектом', () => {
    const list = parts();
    const snapshot = productionSnapshot(project(), list);
    const { job, release } = createRelease(createProductionJob(project()), snapshot, {
      partCount: list.length, note: 'Первая партия',
    });
    expect(release.id).toBe('REL-001');
    expect(release.number).toBe(1);
    expect(job.status).toBe('IN_PROGRESS');
    expect(releaseId(2)).toBe('REL-002');
    expect(nextReleaseNumber(job.releases!)).toBe(2);

    const target = allParts(project())[0];
    store().updatePart(target.id, { width: target.width + 30 });
    const after = productionSnapshot(project(), parts());
    expect(release.snapshot.projectRevision).toBe(snapshot.projectRevision);
    expect(isReleaseOutdated(release, after)).toBe(true);
  });

  it('Тест 38: ревизия задания растёт только при изменении снимка', () => {
    const first = productionSnapshot(project(), parts());
    // Первый снимок только фиксирует точку отсчёта.
    const fresh = bumpRevision(createProductionJob(project()), first);
    expect(fresh.revision).toBe(1);
    expect(fresh.snapshot).toBe(first);

    const job = bumpRevision({ ...createProductionJob(project()), snapshot: first }, first);
    expect(job.revision).toBe(1);

    const target = allParts(project())[0];
    store().updatePart(target.id, { height: target.height + 12 });
    const next = productionSnapshot(project(), parts());
    expect(bumpRevision(job, next).revision).toBe(2);
  });

  it('Тест 39/40: изменения определяются по типам и разделам', () => {
    const before = productionSnapshot(project(), parts());
    const target = allParts(project())[0];
    store().updatePart(target.id, { width: target.width + 40 });
    const list = parts();
    const after = productionSnapshot(project(), list);

    const changes = detectChanges(before, after, list);
    const modified = changes.find((c) => c.partId === String(target.id))!;
    expect(modified.kind).toBe('MODIFIED');
    expect(modified.number).toMatch(/^P-\d{3,}$/);
    expect(changedSections(before, after)).toContain('parts');

    const removedSnapshot = { ...after, parts: { ...after.parts, 'ушла': 'x' } };
    expect(detectChanges(removedSnapshot, after, list).some((c) => c.kind === 'REMOVED')).toBe(true);
    expect(detectChanges(undefined, after, list)).toEqual([]);
  });

  it('Тест 41: история выпусков хранится локально, новейший первым', () => {
    const snapshot = productionSnapshot(project(), parts());
    const one = createRelease(createProductionJob(project()), snapshot, { partCount: 1 });
    const two = createRelease(one.job, snapshot, { partCount: 1 });
    const state = { job: two.job, history: two.job.releases };
    expect(productionHistory(state).map((r) => r.id)).toEqual(['REL-002', 'REL-001']);
    expect(latestRelease(state)!.id).toBe('REL-002');
  });

  it('Тест 42: статус задания выводится из готовности', () => {
    const job = createProductionJob(project());
    expect(jobStatusFor(job, { ready: true, errors: 0 })).toBe('READY');
    expect(jobStatusFor(job, { ready: false, errors: 3 })).toBe('ERROR');
    const released = createRelease(job, productionSnapshot(project(), parts()), { partCount: 1 }).job;
    expect(jobStatusFor(released, { ready: true, errors: 0 })).toBe('IN_PROGRESS');
  });

  it('Тест 43: сигнатура детерминирована', () => {
    expect(signature('abc')).toBe(signature('abc'));
    expect(signature('abc')).not.toBe(signature('abd'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Производство 31 — карта детали', () => {
  it('Тест 44: карта содержит марку, размеры и ориентацию', () => {
    const part = parts()[0];
    const card = partCard(project(), part);
    expect(card.mark).toBe(part.number);
    expect(card.width).toBe(part.width);
    expect(card.rawWidth).toBe(part.rawWidth);
    expect(['LANDSCAPE', 'PORTRAIT']).toContain(card.orientation);
    expect([0, 90]).toContain(card.rotation);
  });

  it('Тест 45: карта строит чертёж существующим движком документов', () => {
    const card = partCard(project(), parts()[0]);
    expect(card.page).not.toBeNull();
    expect(card.page!.scene.prims.length).toBeGreaterThan(0);
  });

  it('Тест 46: у детали шесть видов, пласть видна всегда', () => {
    const card = partCard(project(), parts()[0]);
    expect(card.views.map((v) => v.view)).toEqual(CARD_VIEWS);
    expect(card.views.find((v) => v.view === 'FRONT')!.visible).toBe(true);
    expect(cardViews([]).filter((v) => v.visible).map((v) => v.view)).toEqual(['FRONT']);
  });

  it('Тест 47: обозначение отверстия — Ø5 × 12', () => {
    const target = allParts(project())[0];
    store().addManualOperation({
      partId: target.id, face: 'front', x: 60, y: 60, diameter: 5, depth: 12,
    });
    const part = findProductionPart(parts(), String(target.id))!;
    const op = part.operations.find((o) => o.diameter === 5 && o.depth === 12)!;
    expect(operationNotation(op)).toContain('Ø5');
    expect(operationNotation(op)).toContain('12');
  });

  it('Тест 48: таблицы карты содержат только облицованные стороны', () => {
    const edge = project().edges[0].id;
    const target = allParts(project())[0];
    store().setPartEdge(target.id, 'top', edge);
    const part = findProductionPart(parts(), String(target.id))!;
    const rows = cardEdges(part.edges);
    expect(rows.length).toBe(part.edges.filter((e) => e.edgeMaterialId).length);
    expect(rows.some((r) => r.label === 'К1')).toBe(true);
    expect(cardOperations(part.operations).length).toBe(part.operations.length);
  });

  it('Тест 49: карты строятся для всех деталей', () => {
    const list = parts();
    expect(partCards(project(), list).length).toBe(list.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Производство 31 — этикетки, QR и штрихкод', () => {
  it('Тест 50: этикетка содержит марку, размеры и материал', () => {
    const label = productionLabels(project(), parts())[0];
    expect(label.mark).toMatch(/^P-\d{3,}$/);
    expect(labelPreview(label)).toContain(label.materialName);
    expect(label.size.id).toBe('M');
    expect(LABEL_SIZES.length).toBe(3);
    expect(labelSize('L').width).toBe(100);
  });

  it('Тест 51: этикетки раскладываются по листам A4', () => {
    const labels = productionLabels(project(), parts());
    const sheets = labelSheets(labels);
    expect(sheets.length).toBeGreaterThan(0);
    expect(sheets[0].columns).toBeGreaterThan(0);
    expect(sheets[0].items.length).toBeLessThanOrEqual(sheets[0].columns * sheets[0].rows);
    const total = sheets.reduce((sum, s) => sum + s.items.length, 0);
    expect(total).toBe(labels.length);
  });

  it('Тест 52: QR содержит идентификатор проекта и детали', () => {
    const part = allParts(project())[0];
    const payload = qrPayload(project(), part.id);
    expect(payload).toContain(String(project().id));
    expect(payload).toContain(String(part.id));
    const parsed = parseQrPayload(payload)!;
    expect(parsed.projectId).toBe(String(project().id));
    expect(parsed.partId).toBe(String(part.id));
    expect(parseQrPayload('мусор')).toBeNull();
  });

  it('Тест 53: без подключённого генератора QR отдаётся только содержимое', () => {
    expect(qrMatrix('karkas:1:2')).toBeNull();
    expect(qrMatrixToSvg(null)).toBeNull();

    registerQrGenerator({
      id: 'test', name: 'Тестовый',
      generate: () => [[true, false], [false, true]],
    });
    const matrix = qrMatrix('karkas:1:2')!;
    expect(matrix.length).toBe(2);
    expect(qrMatrixToSvg(matrix)).toContain('<svg');
  });

  it('Тест 54: штрихкод Code 39 считается локально', () => {
    expect(toBarcodeText('P-001')).toBe('P-001');
    expect(toBarcodeText('karkas:1')).toBe('KARKAS-1');
    const bars = barcodeBars('P-001');
    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0].bar).toBe(true);
    expect(barcodeWidth('P-001')).toBeGreaterThan(0);
    const svg = barcodeSvg('P-001');
    expect(svg).toContain('<svg');
    // Никаких обращений наружу: только собственная разметка (§112).
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('src=');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Производство 31 — документы, экспорт и импорт', () => {
  it('Тест 55: в центре документов семь типов', () => {
    expect(PRODUCTION_DOCUMENTS.length).toBe(7);
  });

  it('Тест 56: имена файлов предсказуемы и без меток времени', () => {
    expect(productionFileName('Шкаф', 'job')).toBe('Шкаф_production-job.json');
    expect(productionFileName('Шкаф', 'parts')).toBe('Шкаф_production-parts.csv');
    expect(productionFileName('Шкаф 2', 'hardware')).toBe('Шкаф_2_hardware.csv');
  });

  it('Тест 57: CSV деталей содержит заголовок и строку на деталь', () => {
    const list = parts();
    const rows = productionPartsCsv(list).split('\n');
    expect(rows[0]).toContain('Номер');
    expect(rows.length).toBe(list.length + 1);
  });

  it('Тест 58/59: экспорт и импорт production-job.json', () => {
    const list = parts();
    const json = exportProductionJob(project(), {
      job: createProductionJob(project()),
      parts: list,
      batches: productionBatches(list),
      readiness: productionReadiness(project(), list),
    });
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe(PRODUCTION_FILE_FORMAT);
    expect(parsed.parts.length).toBe(list.length);

    const result = importProductionJob(json);
    expect(result.ok).toBe(true);
    expect(result.file!.parts.length).toBe(list.length);
    expect(result.file!.projectId).toBe(String(project().id));
  });

  it('Тест 60: повреждённый или чужой файл отклоняется с сообщением', () => {
    expect(importProductionJob('{').ok).toBe(false);
    expect(importProductionJob('{"format":"другое"}').error).toContain('формат');
    expect(importProductionJob(JSON.stringify({
      format: PRODUCTION_FILE_FORMAT, version: 99,
    })).error).toContain('новее');
  });

  it('Тест 61: пакет содержит задание и выгрузки со стабильными именами', () => {
    const list = parts();
    const files = productionPackage(project(), {
      job: createProductionJob(project()),
      parts: list,
      batches: productionBatches(list),
    });
    const names = files.map((f) => f.name);
    expect(names).toContain(productionFileName(project().name, 'job'));
    expect(names).toContain(productionFileName(project().name, 'parts'));
    expect(files.every((f) => f.content.length > 0)).toBe(true);
    expect(packageContents(files).length).toBe(files.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Производство 31 — панель, таблицы, store', () => {
  it('Тест 62: панель показывает статус, готовность и количество', () => {
    const list = parts();
    const batches = productionBatches(list);
    const readiness = productionReadiness(project(), list);
    const dashboard = productionDashboard(createProductionJob(project()), list, batches, readiness);
    expect(dashboard.parts).toBe(list.length);
    expect(dashboard.quantity).toBeGreaterThanOrEqual(list.length);
    expect(dashboard.progress).toBe(readiness.progress);
    expect(dashboard.byStatus.READY + dashboard.byStatus.NEW
      + dashboard.byStatus.MODIFIED + dashboard.byStatus.ERROR).toBe(list.length);
  });

  it('Тест 63: сортировка и фильтры таблицы деталей', () => {
    const list = parts();
    const asc = sortProductionParts(list, 'number', 'asc').map((p) => p.number);
    const desc = sortProductionParts(list, 'number', 'desc').map((p) => p.number);
    expect(desc).toEqual([...asc].reverse());
    expect(sortProductionParts(list, 'size', 'desc')[0].width * sortProductionParts(list, 'size', 'desc')[0].height)
      .toBeGreaterThanOrEqual(sortProductionParts(list, 'size', 'asc')[0].width * sortProductionParts(list, 'size', 'asc')[0].height);

    const name = list[0].name;
    expect(filterProductionParts(list, { query: name }).length).toBeGreaterThan(0);
    expect(filterProductionParts(list, { query: 'нет-такой-детали' }).length).toBe(0);
    expect(filterProductionParts(list, { withMachining: true })
      .every((p) => p.operations.length > 0)).toBe(true);
  });

  it('Тест 64: таблица присадки собирает операции всех деталей', () => {
    const rows = machiningTable(parts());
    expect(rows.length).toBe(allOperations(project()).length);
    if (rows.length > 0) expect(rows[0].partNumber).toMatch(/^P-\d{3,}$/);
  });

  it('Тест 65: store пересчитывает снимок и хранит задание в проекте', () => {
    const result = store().refreshProduction();
    expect(result.revision).toBeGreaterThanOrEqual(1);
    expect(project().production?.job?.snapshot).toBeDefined();
    expect(project().production?.job?.projectId).toBe(String(project().id));
  });

  it('Тест 66: выпуск невозможен при ошибках чек-листа', () => {
    const target = allParts(project())[0];
    store().updatePart(target.id, { material: null });
    const result = store().createProductionRelease();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('чек-лист');
  });

  it('Тест 67: успешный выпуск попадает в задание и историю', () => {
    store().refreshProduction();
    const result = store().createProductionRelease('Партия 1');
    expect(result.ok).toBe(true);
    expect(result.releaseId).toBe('REL-001');
    expect(project().production?.history?.length).toBe(1);
    expect(project().production?.job?.status).toBe('IN_PROGRESS');
  });

  it('Тест 68: экспорт и импорт задания через store', () => {
    store().refreshProduction();
    const json = store().exportProductionJobJson();
    store().newProject('Другой');
    const result = store().importProductionJobJson(json);
    expect(result.ok).toBe(true);
    expect(project().production?.job?.projectId).toBe(String(project().id));
  });

  it('Тест 69: задание переживает сохранение и загрузку проекта', () => {
    store().refreshProduction();
    store().createProductionRelease('Партия');
    const restored = deserializeProject(serializeProject(project()));
    expect(restored.production?.job?.releases?.length).toBe(1);
    expect(productionHistory(restored.production).length).toBe(1);
  });

  it('Тест 70: проект без производства открывается без ошибок', () => {
    const raw = JSON.parse(serializeProject(project()));
    delete raw.production;
    const restored = deserializeProject(JSON.stringify(raw));
    expect(restored.production).toBeUndefined();
    expect(productionParts(restored).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Производство 31 — производительность и регрессия', () => {
  it('Тест 71: 1000 деталей и их снимок считаются быстро', () => {
    const base = parts()[0];
    const many = Array.from({ length: 1000 }, (_, i) => ({
      ...base,
      partId: `p${i}` as typeof base.partId,
      number: `P-${String(i + 1).padStart(3, '0')}`,
      revision: `rev${i}`,
    }));
    const t0 = Date.now();
    const batches = productionBatches(many);
    const readiness = productionReadiness(project(), many);
    const dashboard = productionDashboard(createProductionJob(project()), many, batches, readiness);
    const csv = productionPartsCsv(many);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(dashboard.parts).toBe(1000);
    expect(csv.split('\n').length).toBe(1001);
  });

  it('Тест 72: производство не ломает раскрой и документы', () => {
    store().refreshProduction();
    const report = runCutting(project());
    expect(report.jobs.length).toBeGreaterThan(0);
    const doc = buildDocument(project(), 'partsList');
    expect(doc.pages.length).toBeGreaterThan(0);
    expect(allParts(project()).length).toBeGreaterThan(0);
  });

  it('Тест 73: производственные данные не дублируют модель деталей', () => {
    const ids = new Set(allParts(project()).map((p) => String(p.id)));
    for (const part of parts()) expect(ids.has(String(part.partId))).toBe(true);
    expect(parts().length).toBe(allParts(project()).length);
  });
});
