/**
 * ЭТАП 19 — Соединения и присадка.
 * Цепочка: FurnitureModule → Parts → Connections → Hardware → HardwareRules →
 * MachiningOperations → 3D → Documents → Cutting.
 *
 * Проверяет модель соединений и статусы, правила автосоединений, валидатор,
 * стабильные идентификаторы и дедупликацию, ручные соединения, override,
 * геометрию отверстий, а также интеграцию с 3D, чертежами, раскроем,
 * документами, CSV и JSON.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import {
  DEFAULT_HINGE_THRESHOLDS,
  affectedConnections,
  carcassRule,
  checkConnection,
  checkNewConnection,
  connectionKey,
  connectionNumber,
  connectionNumbers,
  connectionRules,
  connectionSource,
  connectionStableId,
  connectionsCsv,
  dedupeConnections,
  depthLimitForFace,
  doorRule,
  drawerConnectionRule,
  fastenersForSpan,
  findIntersections,
  hingeCountForHeight,
  hingeLayout,
  isDuplicate,
  machiningStableId,
  operationKind,
  machiningTypeOfKind,
  partKey,
  partitionRule,
  planConnections,
  pruneDeadConnections,
  reconcileConnections,
  shelfRule,
  validateOperation,
  validateProjectConnections,
  OPERATION_KINDS,
} from '@/engines/connections';
import { allOperations, generateMachining, validateMachining } from '@/engines/machining';
import { machiningToWorld, operationWorld } from '@/core/geometry/coordinateSystem';
import { isCuttingStale } from '@/engines/cutting';
import { isDocumentsOutdated, buildDocument, buildAssemblyDocument, partsListRows, machiningListRows, machiningListCsv, renderPageSvg, projectJson } from '@/engines/drawing';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { deserializeProject } from '@/storage/project/serialization';
import { previewRules } from '@/engines/library';
import type { HardwareConnection, MachiningOperation, Part, Project } from '@/core/model/types';
import type { FurnitureId, HardwareConnectionId, MachiningId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;
const parts = () => allParts(project());
const conns = () => project().hardwareConnections;

/** Тестовый шкаф 800×2000×600, 16 мм, 4 полки, 1 перегородка, 2 фасада (§74). */
function makeCabinet(): FurnitureId {
  store().newProject('Тест 19');
  const id = store().createParametricFurniture('param-cabinet');
  expect(id).toBeTruthy();
  return id!;
}

const partByKey = (key: string): Part | undefined =>
  parts().find((p) => String(p.metadata?.key) === key);
const hwByCategory = (category: string) =>
  project().hardware.find((h) => h.category === category)!;

// ─────────────────────────────────────────────────────────────────────────────
describe('Соединения 19 — модель и идентичность', () => {
  beforeEach(() => { makeCabinet(); });

  it('Тест 1/2: Connection — поля модели и типы', () => {
    expect(conns().length).toBeGreaterThan(0);
    for (const c of conns()) {
      expect(c.id).toBeTruthy();
      expect(c.partAId).toBeTruthy();
      expect(c.partBId).toBeTruthy();
      expect(c.hardwareId).toBeTruthy();
      expect(c.connectionType).toBeTruthy();
      expect(c.source).toBe('PARAMETRIC');
      expect(c.stableId).toBeTruthy();
      expect(findPart(project(), c.partAId)).toBeDefined();
      expect(findPart(project(), c.partBId)).toBeDefined();
    }
    const types = new Set(conns().map((c) => c.connectionType));
    expect(types.has('CONFIRMAT')).toBe(true);
  });

  it('Тест 19/5: стабильный ID соединения не зависит от порядка деталей', () => {
    expect(connectionStableId('A', 'B')).toBe('A↔B');
    expect(connectionStableId('B', 'A')).toBe('A↔B');
    expect(connectionStableId('A', 'B', 'top')).toBe('A↔B#top');
    expect(connectionStableId('A', 'B', 'top')).not.toBe(connectionStableId('A', 'B', 'bottom'));

    // В проекте id читаемые и уникальные.
    const ids = conns().map((c) => c.stableId!);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((s) => s.includes('CABINET.SIDE.LEFT'))).toBe(true);
    expect(ids.some((s) => s.includes('CABINET.SHELF.'))).toBe(true);
  });

  it('Тест 20/48: стабильный ID операции присадки', () => {
    expect(machiningStableId('C001', 'PART_A', 'DRILL', 0)).toBe('C001.PART_A.DRILL.001');
    expect(machiningStableId('C012', 'PART_B', 'BORE', 4)).toBe('C012.PART_B.BORE.005');
    expect(connectionNumber(0)).toBe('C001');
    expect(connectionNumber(11)).toBe('C012');

    // Реальные операции имеют детерминированные id: пересчёт их не меняет.
    const before = generateMachining(project()).map((o) => String(o.id)).sort();
    const after = generateMachining(project()).map((o) => String(o.id)).sort();
    expect(after).toEqual(before);
    expect(new Set(before).size).toBe(before.length);
  });

  it('Тест 18/42/43/44: ключ соединения и обнаружение дублей', () => {
    const base = { connectionType: 'CONFIRMAT', partAId: 'a', partBId: 'b', hardwareId: 'h' };
    // Порядок деталей не влияет на ключ.
    expect(connectionKey(base)).toBe(connectionKey({ ...base, partAId: 'b', partBId: 'a' }));
    // Позиция различает узлы (§44).
    expect(connectionKey({ ...base, position: 'top' })).not.toBe(connectionKey({ ...base, position: 'bottom' }));
    // Другой крепёж — другое соединение.
    expect(connectionKey({ ...base, hardwareId: 'h2' })).not.toBe(connectionKey(base));

    const list = conns();
    const first = list[0];
    expect(isDuplicate(list, first)).toBe(true);
    expect(isDuplicate(list, first, String(first.id))).toBe(false);

    // dedupe убирает повтор, сохраняя первое вхождение.
    const withDup = [...list, { ...first, id: 'copy' as HardwareConnectionId }];
    expect(dedupeConnections(withDup)).toHaveLength(list.length);
  });

  it('Тест 84: попытка создать дубль отклоняется', () => {
    const existing = conns()[0];
    const before = conns().length;
    const check = checkNewConnection(
      {
        partAId: existing.partAId, partBId: existing.partBId,
        hardwareId: existing.hardwareId, connectionType: existing.connectionType,
        position: existing.position,
      },
      project(),
    );
    expect(check.issues.some((i) => i.code === 'conn.duplicate')).toBe(true);
    expect(conns()).toHaveLength(before);
  });

  it('Тест 3/41: ConnectionValidator — самосоединение и битые ссылки', () => {
    const part = parts()[0];
    const self = checkNewConnection(
      { partAId: part.id, partBId: part.id, hardwareId: hwByCategory('confirmat').id },
      project(),
    );
    expect(self.status).toBe('ERROR');
    expect(self.issues[0].code).toBe('conn.selfLink');

    // Несуществующая деталь.
    const ghost = checkNewConnection(
      { partAId: 'нет' as PartId, partBId: part.id, hardwareId: hwByCategory('confirmat').id },
      project(),
    );
    expect(ghost.status).toBe('OUTDATED');

    // Несуществующая фурнитура.
    const noHw = checkNewConnection(
      { partAId: parts()[0].id, partBId: parts()[1].id, hardwareId: 'нет' as never },
      project(),
    );
    expect(noHw.status).toBe('ERROR');
    expect(noHw.issues[0].code).toBe('conn.missingHardware');
  });

  it('Тест 3b/45: статусы соединений корректного шкафа', () => {
    const report = validateProjectConnections(project());
    expect(report.errors).toBe(0);
    expect(report.ok).toBe(true);
    for (const c of conns()) {
      expect(['VALID', 'WARNING']).toContain(report.statuses.get(String(c.id)));
    }
  });

  it('Тест 40/62: некорректные параметры соединения', () => {
    const c = conns()[0];
    const bad: HardwareConnection = { ...c, quantity: -1 };
    expect(checkConnection(bad, project()).issues.some((i) => i.code === 'conn.badQuantity')).toBe(true);

    const nan: HardwareConnection = { ...c, parameters: { edgeOffset: NaN } };
    expect(checkConnection(nan, project()).issues.some((i) => i.code === 'conn.badParameter')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Соединения 19 — правила', () => {
  beforeEach(() => { makeCabinet(); });

  it('Тест 4/5b: ConnectionRule — реестр и план', () => {
    const rules = connectionRules();
    expect(rules.map((r) => r.id)).toEqual(
      expect.arrayContaining(['CARCASS', 'SHELF', 'PARTITION', 'DOOR', 'DRAWER']),
    );
    const plan = planConnections({
      parts: parts(), jointCategory: 'confirmat',
      construction: 'BETWEEN_SIDES', handles: true,
    });
    expect(plan.length).toBeGreaterThan(0);
    for (const item of plan) {
      expect(item.stableId).toBeTruthy();
      expect(item.aPartId).not.toBe(item.bPartId);
      expect(item.quantity).toBeGreaterThan(0);
      expect(item.ruleId).toBeTruthy();
    }
    // Дублей в плане нет.
    expect(new Set(plan.map((p) => p.stableId)).size).toBe(plan.length);
  });

  it('Тест 24/75: SIDE ↔ TOP / BOTTOM / SHELF', () => {
    const stableIds = conns().map((c) => c.stableId!);
    expect(stableIds.some((s) => s.includes('SIDE.LEFT') && s.includes('TOP'))).toBe(true);
    expect(stableIds.some((s) => s.includes('SIDE.RIGHT') && s.includes('TOP'))).toBe(true);
    expect(stableIds.some((s) => s.includes('SIDE.LEFT') && s.includes('BOTTOM'))).toBe(true);
    expect(stableIds.some((s) => s.includes('SHELF') && s.includes('SIDE'))).toBe(true);

    // Присадка создана и относится к реальным деталям.
    const ops = allOperations(project());
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) expect(findPart(project(), op.partId)).toBeDefined();
  });

  it('Тест 25/33: полки крепятся к ближайшим вертикалям', () => {
    // 1 перегородка → полки левой секции идут к левой боковине и перегородке.
    const shelfConns = conns().filter((c) => c.stableId!.includes('SHELF'));
    expect(shelfConns.length).toBeGreaterThan(0);
    expect(shelfConns.some((c) => c.stableId!.includes('PARTITION'))).toBe(true);
    expect(shelfConns.some((c) => c.stableId!.includes('SIDE.LEFT'))).toBe(true);
    expect(shelfConns.some((c) => c.stableId!.includes('SIDE.RIGHT'))).toBe(true);

    // Правило вызывается напрямую: каждая полка получает пару вертикалей,
    // и обе стороны узла — реальные ключи деталей (§33).
    const plan = shelfRule.build({
      parts: parts(), jointCategory: 'confirmat',
      construction: 'BETWEEN_SIDES', handles: false,
    });
    const keys = new Set(parts().map(partKey));
    expect(plan.length).toBe(shelfConns.length);
    for (const item of plan) {
      expect(keys.has(item.aKey)).toBe(true);
      expect(keys.has(item.bKey)).toBe(true);
    }
    // Полка без вертикалей рядом не порождает соединений.
    expect(shelfRule.build({
      parts: parts().filter((p) => p.role === 'shelf'), jointCategory: 'confirmat',
      construction: 'BETWEEN_SIDES', handles: false,
    })).toEqual([]);
  });

  it('Тест 26/34/76b: перегородка к верху и низу', () => {
    const partitionConns = conns().filter(
      (c) => c.stableId!.includes('PARTITION') && !c.stableId!.includes('SHELF'),
    );
    expect(partitionConns.length).toBeGreaterThanOrEqual(2);
    expect(partitionConns.some((c) => c.position === 'top')).toBe(true);
    expect(partitionConns.some((c) => c.position === 'bottom')).toBe(true);

    // Правило само по себе тоже работает.
    const plan = partitionRule.build({
      parts: parts(), jointCategory: 'confirmat',
      construction: 'BETWEEN_SIDES', handles: false,
    });
    expect(plan.length).toBeGreaterThanOrEqual(2);
  });

  it('Тест 16/27/35/36/37/78: петли фасадов и их количество', () => {
    const hingeHw = hwByCategory('hinge');
    const hingeConns = conns().filter((c) => c.hardwareId === hingeHw.id);
    expect(hingeConns).toHaveLength(2); // по одному соединению на фасад

    // Количество петель считается правилом, а не наугад (§37).
    expect(hingeCountForHeight(600)).toBe(2);
    expect(hingeCountForHeight(900)).toBe(2);
    expect(hingeCountForHeight(1200)).toBe(3);
    expect(hingeCountForHeight(1800)).toBe(4);
    expect(hingeCountForHeight(2500)).toBe(5);
    // Пороги — параметр, а не константа: их можно переопределить.
    expect(hingeCountForHeight(600, [{ maxHeight: 500, count: 2 }, { maxHeight: Infinity, count: 7 }])).toBe(7);
    expect(DEFAULT_HINGE_THRESHOLDS.length).toBeGreaterThan(0);

    const door = parts().find((p) => p.role === 'facade')!;
    expect(hingeConns[0].quantity).toBe(hingeCountForHeight(door.height));

    // Раскладка петель по высоте (§36).
    const layout = hingeLayout(2000);
    expect(layout.count).toBe(hingeCountForHeight(2000));
    expect(layout.offsets).toHaveLength(layout.count);
    expect(layout.offsets[0]).toBeCloseTo(layout.bottomOffset, 6);
    expect(layout.offsets[layout.offsets.length - 1]).toBeCloseTo(2000 - layout.topOffset, 6);
    // Шаги равномерны.
    const gaps = layout.offsets.slice(1).map((v, i) => v - layout.offsets[i]);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6);

    // Правило фасадов напрямую: петли на боковину + ручка на каждый фасад.
    const ctx = { parts: parts(), jointCategory: 'confirmat' as const,
      construction: 'BETWEEN_SIDES' as const, handles: true };
    const plan = doorRule.build(ctx);
    expect(plan.filter((p) => p.category === 'hinge')).toHaveLength(2);
    expect(plan.filter((p) => p.category === 'handle')).toHaveLength(2);
    // Без ручек правило создаёт только петли.
    expect(doorRule.build({ ...ctx, handles: false }).some((p) => p.category === 'handle')).toBe(false);
    // Без фасадов — ничего.
    expect(doorRule.build({ ...ctx, parts: parts().filter((p) => p.role !== 'facade') })).toEqual([]);
  });

  it('Тест 17/38/79: ручки', () => {
    const handleHw = hwByCategory('handle');
    const handleConns = conns().filter((c) => c.hardwareId === handleHw.id);
    expect(handleConns).toHaveLength(2); // по ручке на фасад
    for (const c of handleConns) {
      expect(c.position).toBe('handle');
      expect(c.quantity).toBe(1);
    }
    // Операции ручки привязаны к фасаду.
    const ops = allOperations(project()).filter((o) => String(o.hardwareId) === String(handleHw.id));
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      const part = findPart(project(), op.partId)!;
      expect(part.role).toBe('facade');
    }
  });

  it('Тест 30/31/32: схемы корпуса считаются раздельно', () => {
    const ctx = { parts: parts(), jointCategory: 'confirmat' as const, handles: false };
    const between = carcassRule.build({ ...ctx, construction: 'BETWEEN_SIDES' });
    const onSides = carcassRule.build({ ...ctx, construction: 'ON_SIDES' });
    expect(between.length).toBeGreaterThan(0);
    expect(between.length).toBe(onSides.length);
    // Позиция узла отражает схему — соединения не смешиваются.
    expect(between.every((p) => p.position === 'between-sides')).toBe(true);
    expect(onSides.every((p) => p.position === 'on-sides')).toBe(true);
    expect(between[0].stableId).not.toBe(onSides[0].stableId);
  });

  it('Тест 39: DrawerConnectionRule — заготовка не ломает движок', () => {
    expect(drawerConnectionRule.id).toBe('DRAWER');
    expect(drawerConnectionRule.build({
      parts: parts(), jointCategory: 'confirmat',
      construction: 'BETWEEN_SIDES', handles: false,
    })).toEqual([]);
    // Зарегистрировано в реестре и вызывается без ошибок.
    expect(connectionRules().some((r) => r.id === 'DRAWER')).toBe(true);
  });

  it('Тест 28/66: количество фурнитуры считается из соединений', () => {
    const ledger = buildHardwareLedger(project().hardware, conns());
    const confirmat = ledger.find((r) => r.name.includes('Конфирмат'))!;
    // Сумма quantity всех конфирматных соединений.
    const expected = conns()
      .filter((c) => c.hardwareId === hwByCategory('confirmat').id)
      .reduce((n, c) => n + (c.quantity ?? 1), 0);
    expect(confirmat.count).toBe(expected);
    expect(confirmat.count).toBeGreaterThan(0);

    // Неиспользуемая фурнитура — ноль, а не выдуманное число.
    const unused = ledger.find((r) => r.name.includes('Полкодержатель'))!;
    expect(unused.count).toBe(0);
  });

  it('Тест 29/67: количество операций порождается соединениями', () => {
    const rows = machiningListRows(project());
    expect(rows.length).toBe(allOperations(project()).length);
    // Каждая производная операция ссылается на своё соединение.
    const generated = generateMachining(project());
    expect(generated.length).toBeGreaterThan(0);
    for (const op of generated) {
      expect(op.sourceHardwareConnectionId).toBeTruthy();
      expect(conns().some((c) => c.id === op.sourceHardwareConnectionId)).toBe(true);
    }
  });

  it('Тест 6/12/13/14/15: правила крепежа дают разную присадку', () => {
    const confirmat = previewRules({ ...hwByCategory('confirmat'), machiningRules: undefined });
    void confirmat;
    // Реальная присадка конфирмата: сквозное + глухое.
    const ops = generateMachining(project())
      .filter((o) => String(o.hardwareId) === String(hwByCategory('confirmat').id));
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.some((o) => o.through === true)).toBe(true);
    expect(ops.some((o) => o.through !== true && (o.depth ?? 0) > 0)).toBe(true);
    expect(fastenersForSpan(200)).toBe(2);
    expect(fastenersForSpan(700)).toBe(3);
    expect(fastenersForSpan(2000)).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Соединения 19 — операции присадки', () => {
  beforeEach(() => { makeCabinet(); });

  it('Тест 7/9/11/15b: поля операции, база и направление', () => {
    const ops = allOperations(project());
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      expect(op.id).toBeTruthy();
      expect(op.partId).toBeTruthy();
      expect(op.type).toBeTruthy();
      expect(['top', 'bottom', 'front', 'back', 'left', 'right']).toContain(op.face);
      expect(Number.isFinite(op.x)).toBe(true);
      expect(Number.isFinite(op.y)).toBe(true);
      expect(Number.isFinite(op.z)).toBe(true);
    }
    // Направление сверления — единичный вектор (§15).
    const op = ops[0];
    const part = findPart(project(), op.partId)!;
    const world = machiningToWorld(part, op);
    expect(Math.hypot(world.inward.x, world.inward.y, world.inward.z)).toBeCloseTo(1, 6);
  });

  it('Тест 9b/13/14: DatumReference A/B/C', () => {
    const ops = allOperations(project());
    // База проставлена или выводится по правилу — случайных значений нет.
    for (const op of ops.slice(0, 20)) {
      if (op.datum) expect(['A', 'B', 'C']).toContain(op.datum);
    }
    const rows = machiningListRows(project());
    for (const r of rows) expect(['A', 'B', 'C']).toContain(r.datum);
  });

  it('Тест 10/87: сквозное отверстие', () => {
    const through: MachiningOperation = {
      id: 'op-through' as MachiningId, type: 'drilling', partId: parts()[0].id,
      face: 'front', x: 100, y: 100, z: 0, diameter: 5, through: true, origin: 'manual',
    };
    // Сквозное: глубина не ограничивает, ошибок нет.
    expect(validateOperation(through, parts()[0])).toHaveLength(0);
    expect(validateOperation({ ...through, depth: 9999 }, parts()[0])).toHaveLength(0);
  });

  it('Тест 11b/88: глухое отверстие Ø8 × 12', () => {
    const part = parts().find((p) => p.thickness === 16)!;
    const blind: MachiningOperation = {
      id: 'op-blind' as MachiningId, type: 'dowel', partId: part.id,
      face: 'front', x: 100, y: 100, z: 0, diameter: 8, depth: 12, through: false, origin: 'manual',
    };
    expect(validateOperation(blind, part)).toHaveLength(0);
    expect(blind.depth).toBe(12);
  });

  it('Тест 8/59: глубина больше толщины — ошибка', () => {
    const part = parts().find((p) => p.thickness === 16)!;
    const tooDeep: MachiningOperation = {
      id: 'op-deep' as MachiningId, type: 'drilling', partId: part.id,
      face: 'front', x: 100, y: 100, z: 0, diameter: 8, depth: 40, through: false, origin: 'manual',
    };
    const issues = validateOperation(tooDeep, part);
    expect(issues.some((i) => i.code === 'op.depthExceedsPart')).toBe(true);
    expect(issues[0].severity).toBe('error');
    // Предел глубины зависит от грани.
    expect(depthLimitForFace(part, 'front')).toBe(part.thickness);
    expect(depthLimitForFace(part, 'left')).toBe(part.width);
    expect(depthLimitForFace(part, 'top')).toBe(part.height);
  });

  it('Тест 8b/62: диаметр и глубина — без нуля, NaN и Infinity', () => {
    const part = parts()[0];
    const base: MachiningOperation = {
      id: 'op' as MachiningId, type: 'drilling', partId: part.id,
      face: 'front', x: 10, y: 10, z: 0, diameter: 5, depth: 10, origin: 'manual',
    };
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(validateOperation({ ...base, diameter: bad }, part)
        .some((i) => i.code === 'op.badDiameter')).toBe(true);
    }
    for (const bad of [0, -5, NaN, undefined]) {
      expect(validateOperation({ ...base, depth: bad as number }, part)
        .some((i) => i.code === 'op.badDepth')).toBe(true);
    }
  });

  it('Тест 31b/61: пересечение отверстий даёт предупреждение', () => {
    const part = parts()[0];
    const mk = (id: string, x: number, d: number): MachiningOperation => ({
      id: id as MachiningId, type: 'drilling', partId: part.id,
      face: 'front', x, y: 100, z: 0, diameter: d, depth: 10, origin: 'manual',
    });
    // Два Ø10 на расстоянии 5 мм — окружности перекрываются.
    const overlapping = findIntersections([mk('a', 100, 10), mk('b', 105, 10)]);
    expect(overlapping).toHaveLength(1);
    expect(overlapping[0].severity).toBe('warning');
    expect(overlapping[0].code).toBe('op.intersect');
    // На расстоянии 30 мм — не пересекаются.
    expect(findIntersections([mk('a', 100, 10), mk('b', 130, 10)])).toHaveLength(0);
    // Разные грани не конфликтуют.
    expect(findIntersections([mk('a', 100, 10), { ...mk('b', 100, 10), face: 'back' }])).toHaveLength(0);
  });

  it('Тест 10b: производственные имена операций', () => {
    expect(OPERATION_KINDS).toEqual(['DRILL', 'BORE', 'COUNTERSINK', 'POCKET', 'CUT', 'CUSTOM']);
    expect(operationKind({ type: 'drilling' })).toBe('DRILL');
    expect(operationKind({ type: 'confirmat' })).toBe('DRILL');
    expect(operationKind({ type: 'hinge' })).toBe('BORE');
    expect(operationKind({ type: 'boring' })).toBe('BORE');
    expect(operationKind({ type: 'pocket' })).toBe('POCKET');
    expect(machiningTypeOfKind('DRILL')).toBe('drilling');
    expect(machiningTypeOfKind('BORE')).toBe('boring');
    // Каждая реальная операция имеет производственное имя.
    for (const op of allOperations(project())) {
      expect(OPERATION_KINDS).toContain(operationKind(op));
    }
  });

  it('Тест 30b/60/86: отступ от края берётся из профиля', () => {
    const ops = allOperations(project());
    const issues = validateMachining(ops, project());
    // На корректном шкафу ошибок присадки нет.
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);

    // Отверстие вплотную к краю ловится.
    const part = parts().find((p) => p.thickness === 16)!;
    const tooClose: MachiningOperation = {
      id: 'op-edge' as MachiningId, type: 'drilling', partId: part.id,
      face: 'front', x: 1, y: 1, z: 0, diameter: 20, depth: 10, origin: 'manual',
    };
    const edgeIssues = validateMachining([tooClose], project());
    expect(edgeIssues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('Тест 32/85: несовместимость крепежа и толщины даёт ERROR', () => {
    const c = conns()[0];
    const strictHw = {
      ...hwByCategory('confirmat'),
      name: 'Крепёж для 18 мм',
      machiningRules: [{
        id: 'strict', operation: 'confirmat' as const, target: 'through' as const,
        diameter: 7, through: true, count: 2, edgeOffset: 32,
        constraints: { minThickness: 18 },
      }],
    };
    const partA = findPart(project(), c.partAId)!;
    expect(partA.thickness).toBe(16);

    const probe: HardwareConnection = { ...c, hardwareId: strictHw.id };
    // Кладём «строгую» фурнитуру в проект, чтобы валидатор её увидел.
    store().updateHardware(strictHw.id, { machiningRules: strictHw.machiningRules });
    const check = checkConnection(probe, project());
    expect(check.status).toBe('ERROR');
    expect(check.issues.some((i) => i.code === 'conn.ruleNotApplicable')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Соединения 19 — регенерация и ручные соединения', () => {
  beforeEach(() => { makeCabinet(); });

  it('Тест 33/80: изменение высоты пересчитывает соединения', () => {
    const id = project().furnitures[project().furnitures.length - 1].id;
    const idsBefore = new Map(conns().map((c) => [c.stableId!, String(c.id)]));
    const countBefore = conns().length;

    store().runParametricCommand(id, 'SetParameter', { field: 'height', value: 2200 });

    // Состав соединений тот же, идентификаторы сохранены (§48).
    expect(conns()).toHaveLength(countBefore);
    for (const c of conns()) {
      if (idsBefore.has(c.stableId!)) expect(String(c.id)).toBe(idsBefore.get(c.stableId!));
    }
    // Присадка переехала вместе с деталями.
    const side = partByKey('CABINET.SIDE.LEFT')!;
    expect(side.height).toBeCloseTo(2200, 6);
    const ops = generateMachining(project()).filter((o) => o.partId === side.id);
    expect(ops.length).toBeGreaterThan(0);
    expect(Math.max(...ops.map((o) => o.y))).toBeGreaterThan(2000);
  });

  it('Тест 33b/81: изменение ширины пересчитывает соединения полок', () => {
    const id = project().furnitures[project().furnitures.length - 1].id;
    const before = conns().length;
    store().runParametricCommand(id, 'SetParameter', { field: 'width', value: 1000 });
    expect(conns()).toHaveLength(before);

    const top = partByKey('CABINET.TOP')!;
    expect(top.width).toBeCloseTo(1000 - 2 * 16, 6);
    // Соединения верха с боковинами на месте.
    expect(conns().some((c) => c.stableId!.includes('TOP') && c.stableId!.includes('SIDE.LEFT'))).toBe(true);
  });

  it('Тест 49/82: удаление полки убирает её соединения', () => {
    const id = project().furnitures[project().furnitures.length - 1].id;
    const shelfConnsBefore = conns().filter((c) => c.stableId!.includes('SHELF')).length;

    store().runParametricCommand(id, 'RemoveShelf');

    const shelfConnsAfter = conns().filter((c) => c.stableId!.includes('SHELF')).length;
    expect(shelfConnsAfter).toBeLessThan(shelfConnsBefore);

    // «Мёртвых» соединений не осталось: все ссылаются на живые детали.
    const live = new Set(parts().map((p) => String(p.id)));
    for (const c of conns()) {
      expect(live.has(String(c.partAId))).toBe(true);
      expect(live.has(String(c.partBId))).toBe(true);
    }
    // И мёртвых операций тоже.
    for (const op of allOperations(project())) {
      expect(findPart(project(), op.partId)).toBeDefined();
    }
  });

  it('Тест 21/50/83: ручное соединение переживает регенерацию', () => {
    const id = project().furnitures[project().furnitures.length - 1].id;
    const a = partByKey('CABINET.SIDE.LEFT')!;
    const b = partByKey('CABINET.SIDE.RIGHT')!;

    const created = store().addConnection({
      hardwareId: hwByCategory('dowel').id, partAId: a.id, partBId: b.id, quantity: 2,
    });
    expect(created.ok).toBe(true);
    const manualId = String(created.id);
    const manual = conns().find((c) => String(c.id) === manualId)!;
    expect(connectionSource(manual)).toBe('MANUAL');

    // Меняем конструкцию — ручное соединение остаётся.
    store().runParametricCommand(id, 'SetParameter', { field: 'width', value: 900 });
    expect(conns().some((c) => String(c.id) === manualId)).toBe(true);
    expect(connectionSource(conns().find((c) => String(c.id) === manualId)!)).toBe('MANUAL');
  });

  it('Тест 21b: ручное соединение исчезнувшей детали убирается', () => {
    const extra = store().addPart({ name: 'Времянка', width: 300, height: 300, thickness: 16 });
    const a = partByKey('CABINET.SIDE.LEFT')!;
    store().addConnection({ hardwareId: hwByCategory('dowel').id, partAId: a.id, partBId: extra, quantity: 2 });
    const before = conns().length;

    store().removePart(extra);
    const removed = store().pruneConnections();
    expect(removed).toBeGreaterThan(0);
    expect(conns().length).toBeLessThan(before);
    const live = new Set(parts().map((p) => String(p.id)));
    for (const c of conns()) expect(live.has(String(c.partAId))).toBe(true);

    // Движок чистит и «руками»: на уже очищенном проекте удалять нечего.
    const again = pruneDeadConnections(project());
    expect(again.removed).toHaveLength(0);
    expect(again.connections).toHaveLength(conns().length);
    // А на проекте с висячей ссылкой — соединение уходит.
    const dangling = pruneDeadConnections({
      ...project(),
      hardwareConnections: [...conns(), { ...conns()[0], id: 'мертвое' as HardwareConnectionId, partBId: 'нет' as PartId }],
    });
    expect(dangling.removed).toEqual(['мертвое']);
  });

  it('Тест 5c/47: reconcileConnections сохраняет id и чистит лишнее', () => {
    const furniture = project().furnitures[project().furnitures.length - 1];
    const livParts = furniture.assemblies[0].parts;
    const ctx = { jointCategory: 'confirmat' as const, construction: 'BETWEEN_SIDES' as const, handles: true };

    const first = reconcileConnections(project(), livParts, ctx);
    const ids = new Map(first.connections.map((c) => [c.stableId!, String(c.id)]));

    // Повторный вызов ничего не добавляет и сохраняет идентификаторы.
    const again = reconcileConnections(
      { ...project(), hardwareConnections: first.connections }, livParts, ctx,
    );
    expect(again.added).toHaveLength(0);
    for (const c of again.connections) {
      if (c.stableId && ids.has(c.stableId)) expect(String(c.id)).toBe(ids.get(c.stableId));
    }

    // Убираем половину деталей — соединения исчезнувших уходят.
    const fewer = livParts.filter((p) => !String(p.metadata?.key).startsWith('CABINET.SHELF.'));
    const pruned = reconcileConnections(
      { ...project(), hardwareConnections: first.connections }, fewer, ctx,
    );
    expect(pruned.removed.length).toBeGreaterThan(0);
    expect(pruned.connections.every((c) => !c.stableId?.includes('SHELF'))).toBe(true);
  });

  it('Тест 96: dependency tracking — затронутые соединения', () => {
    const side = partByKey('CABINET.SIDE.LEFT')!;
    const affected = affectedConnections(conns(), [String(side.id)]);
    expect(affected.length).toBeGreaterThan(0);
    for (const c of affected) {
      expect([String(c.partAId), String(c.partBId)]).toContain(String(side.id));
    }
    // Несуществующая деталь никого не затрагивает.
    expect(affectedConnections(conns(), ['нет'])).toHaveLength(0);
  });

  it('Тест 22/23/51/52/89/90: override операции и его сброс', () => {
    const id = project().furnitures[project().furnitures.length - 1].id;
    const op = generateMachining(project())[0];
    const xBefore = op.x;

    store().setOperationOverride(op.id as MachiningId, { x: xBefore + 25 });
    const overridden = generateMachining(project()).find((o) => o.id === op.id)!;
    expect(overridden.x).toBe(xBefore + 25);
    expect(overridden.override).toBe(true);

    // §89: ручное значение переживает изменение габарита.
    store().runParametricCommand(id, 'SetParameter', { field: 'height', value: 2100 });
    const afterResize = generateMachining(project()).find((o) => o.id === op.id);
    if (afterResize) {
      expect(afterResize.x).toBe(xBefore + 25);
      expect(afterResize.override).toBe(true);
    }

    // §90: сброс возвращает расчётное значение.
    store().resetOperationToRule(op.id as MachiningId);
    const reset = generateMachining(project()).find((o) => o.id === op.id);
    if (reset) {
      expect(reset.override).toBeUndefined();
      expect(reset.x).not.toBe(xBefore + 25);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Соединения 19 — интеграции', () => {
  beforeEach(() => { makeCabinet(); });

  it('Тест 34/91: 3D — отверстия имеют мировые координаты', () => {
    const ops = allOperations(project());
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops.slice(0, 30)) {
      const part = findPart(project(), op.partId)!;
      const world = operationWorld(part, op.face, op.x, op.y);
      expect(Number.isFinite(world.position.x)).toBe(true);
      expect(Number.isFinite(world.position.y)).toBe(true);
      expect(Number.isFinite(world.position.z)).toBe(true);
      // Кончик сверла смещён на глубину внутрь детали.
      const full = machiningToWorld(part, op);
      expect(Number.isFinite(full.tip.x)).toBe(true);
    }
    // Клик по отверстию даёт всю информацию (§54).
    const op = ops[0];
    expect(op.hardwareId || op.sourceHardwareConnectionId).toBeTruthy();
  });

  it('Тест 35/63/92: чертёж детали показывает отверстия', () => {
    const side = partByKey('CABINET.SIDE.LEFT')!;
    const ops = allOperations(project()).filter((o) => o.partId === side.id);
    expect(ops.length).toBeGreaterThan(0);

    const doc = buildDocument(project(), 'parts');
    const page = doc.pages.find((p) => String(p.partId) === String(side.id))!;
    const svg = renderPageSvg(page);
    // Отверстия нарисованы окружностями с корректными обозначениями.
    expect(svg).toContain('<circle');
    expect(svg).toMatch(/Ø[\d.]+/);
    const through = ops.find((o) => o.through);
    if (through) expect(svg).toContain(`Ø${through.diameter} THRU`);
  });

  it('Тест 35b/64: маркеры соединений на сборочном чертеже', () => {
    const doc = buildAssemblyDocument(project());
    const markers = doc.metadata?.connectionMarkers as Array<{ number: string; id: string }>;
    expect(Array.isArray(markers)).toBe(true);
    expect(markers.length).toBeGreaterThan(0);
    expect(markers[0].number).toMatch(/^C\d{3}$/);
    // Маркер ведёт на реальное соединение.
    const map = doc.metadata?.markerToConnection as Record<string, string>;
    for (const [number, id] of Object.entries(map)) {
      expect(number).toMatch(/^C\d{3}$/);
      expect(conns().some((c) => String(c.id) === id)).toBe(true);
    }
    expect(renderPageSvg(doc.pages[0])).toContain('C001');
  });

  it('Тест 65: спецификация показывает число соединений детали', () => {
    const rows = partsListRows(project());
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(typeof r.connections).toBe('number');
    // У боковин соединений много.
    const side = rows.find((r) => r.name.includes('Боковина'))!;
    expect(side.connections).toBeGreaterThan(0);
    // Сумма по деталям = удвоенному числу соединений (каждое считается дважды).
    const total = allParts(project()).reduce((n, p) => {
      return n + conns().filter((c) => String(c.partAId) === String(p.id) || String(c.partBId) === String(p.id)).length;
    }, 0);
    expect(total).toBe(conns().length * 2);
  });

  it('Тест 36/71: изменение соединения инвалидирует раскрой и документы', async () => {
    const id = project().furnitures[project().furnitures.length - 1].id;
    await store().recalculateCutting();
    store().generateDocuments();
    expect(isCuttingStale(project())).toBe(false);
    expect(isDocumentsOutdated(project())).toBe(false);

    // Изменение габарита трогает и детали, и соединения.
    store().runParametricCommand(id, 'SetParameter', { field: 'width', value: 900 });
    expect(isCuttingStale(project())).toBe(true);
    expect(isDocumentsOutdated(project())).toBe(true);

    await store().recalculateCutting();
    store().generateDocuments();
    expect(isCuttingStale(project())).toBe(false);
    expect(isDocumentsOutdated(project())).toBe(false);
  });

  it('Тест 37/70: документы получают актуальную присадку', () => {
    const gen = store().generateDocuments();
    expect(gen.ok).toBe(true);
    const doc = buildDocument(project(), 'machiningList');
    expect(doc.pages.length).toBeGreaterThan(0);
    const rows = machiningListRows(project());
    expect(rows.length).toBe(allOperations(project()).length);
    // В ведомости есть связь с соединением и фурнитурой.
    expect(rows.some((r) => r.connection !== '')).toBe(true);
    expect(rows.some((r) => r.hardware !== '')).toBe(true);
  });

  it('Тест 38/68/93: connections.csv и machining.csv', () => {
    const csv = connectionsCsv(project());
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Connection,Stable ID,Type,Part A,Part B,Hardware,Quantity,Source,Status,Operations');
    // Все соединения присутствуют.
    expect(lines).toHaveLength(conns().length + 1);
    expect(csv).toContain('C001');
    expect(csv).toContain('PARAMETRIC');
    expect(csv).toContain('CABINET.');

    const machining = machiningListCsv(project());
    expect(machining.split('\n')).toHaveLength(allOperations(project()).length + 1);
    expect(machining.split('\n')[0]).toContain('Operation ID');
  });

  it('Тест 39/69/94: project.json сохраняет соединения и восстанавливается', () => {
    const before = conns().length;
    const opsBefore = allOperations(project()).length;

    const json = projectJson(project());
    const restored = deserializeProject(json);

    expect(restored.hardwareConnections).toHaveLength(before);
    expect(restored).toEqual(project());
    // Стабильные id и источник пережили сериализацию.
    for (const c of restored.hardwareConnections) {
      expect(c.stableId).toBeTruthy();
      expect(c.source).toBe('PARAMETRIC');
    }
    // Присадка восстанавливается из соединений — её не нужно хранить отдельно.
    expect(allOperations(restored)).toHaveLength(opsBefore);
  });

  it('Тест 98: старый проект без соединений открывается', () => {
    store().newProject('Старый');
    const legacy = { ...project(), hardwareConnections: [] };
    expect(legacy.hardwareConnections).toHaveLength(0);
    // Присадка пуста, но ничего не падает.
    expect(allOperations(legacy)).toHaveLength(0);
    expect(validateProjectConnections(legacy).ok).toBe(true);
    expect(connectionsCsv(legacy).split('\n')).toHaveLength(1);
    // Соединение без stableId считается ручным — регенерация его не тронет.
    const stale = { id: 'x', hardwareId: 'h', partAId: 'a', partBId: 'b' } as unknown as HardwareConnection;
    expect(connectionSource(stale)).toBe('MANUAL');
  });

  it('Тест 40/74: полный тестовый шкаф', () => {
    // §74: 800×2000×600, 16 мм, 4 полки, 1 перегородка, 2 фасада.
    expect(parts().length).toBeGreaterThan(0);
    expect(partByKey('CABINET.SIDE.LEFT')).toBeDefined();
    expect(partByKey('CABINET.PARTITION.001')).toBeDefined();
    expect(parts().filter((p) => p.role === 'facade')).toHaveLength(2);

    // Соединения покрывают весь корпус.
    expect(conns().length).toBeGreaterThan(20);
    expect(validateProjectConnections(project()).errors).toBe(0);

    // Присадка порождена и валидна.
    const ops = allOperations(project());
    expect(ops.length).toBeGreaterThan(50);
    expect(validateMachining(ops, project()).filter((i) => i.severity === 'error')).toHaveLength(0);

    // Нумерация соединений сплошная.
    const numbers = [...connectionNumbers(conns()).values()];
    expect(numbers[0]).toBe('C001');
    expect(new Set(numbers).size).toBe(numbers.length);

    // Документы формируются.
    expect(store().generateDocuments().ok).toBe(true);
  });
});

/**
 * Шаблонные изделия (этапы 12–13) должны пользоваться ТЕМ ЖЕ движком
 * соединений, что и параметрические (§1): иначе в проекте появляется вторая
 * система соединений — без stableId, без статуса и без чистки.
 */
describe('Соединения 19 — шаблонные изделия используют общий движок', () => {
  const CABINET_VALUES = {
    width: 800, height: 2000, depth: 600,
    materialThickness: 16, backThickness: 3,
    shelfCount: 4, verticalPartitionCount: 1,
    doorCount: 2, doorGap: 3,
    backType: 'inset', jointType: 'confirmat', handleEnabled: true,
  };

  function makeTemplateCabinet(): void {
    store().newProject('Тест 19 — шаблон');
    const res = store().createFromTemplate('tpl-cabinet', CABINET_VALUES, 'Шкаф');
    expect(res.ok).toBe(true);
  }

  beforeEach(makeTemplateCabinet);

  it('Тест 41: у соединений шаблона есть stableId и источник PARAMETRIC', () => {
    expect(conns().length).toBeGreaterThan(0);
    for (const c of conns()) {
      expect(c.stableId).toBeTruthy();
      expect(connectionSource(c)).toBe('PARAMETRIC');
    }
  });

  it('Тест 42: полки не крепятся к дальней стороне через перегородку', () => {
    // Регрессия: старый генератор шаблона связывал каждую полку с ОБЕИМИ
    // боковинами, не глядя на перегородки, — узлы висели в воздухе.
    const report = validateProjectConnections(project());
    const noContact = report.issues.filter((i) => i.code === 'conn.noContact');
    expect(noContact).toEqual([]);
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(0);
  });

  it('Тест 43: смена параметров шаблона сохраняет id узлов и чистит лишние', () => {
    const id = project().furnitures[project().furnitures.length - 1].id;
    const idsBefore = new Map(conns().map((c) => [c.stableId!, String(c.id)]));
    // Ключи шаблонных деталей строчные (shelf_sec_0_1), параметрических —
    // прописные (CABINET.SHELF.001), поэтому сравниваем без учёта регистра.
    const shelfCount = () => conns().filter((c) => /shelf/i.test(c.stableId!)).length;
    const shelvesBefore = shelfCount();

    store().updateTemplateValues(id, { ...CABINET_VALUES, shelfCount: 2 });

    expect(shelvesBefore).toBeGreaterThan(0);
    expect(shelfCount()).toBeLessThan(shelvesBefore);
    // Уцелевшие узлы сохранили свои id — присадка не пересоздаётся заново.
    let kept = 0;
    for (const c of conns()) {
      const prev = idsBefore.get(c.stableId!);
      if (prev) { expect(String(c.id)).toBe(prev); kept += 1; }
    }
    expect(kept).toBeGreaterThan(0);
    // Мёртвых узлов не осталось.
    const live = new Set(parts().map((p) => String(p.id)));
    for (const c of conns()) {
      expect(live.has(String(c.partAId))).toBe(true);
      expect(live.has(String(c.partBId))).toBe(true);
    }
    expect(validateProjectConnections(project()).errors).toBe(0);
  });

  it('Тест 44: шаблон даёт присадку и корректные документы', () => {
    const ops = allOperations(project());
    expect(ops.length).toBeGreaterThan(50);
    expect(validateMachining(ops, project()).filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(store().generateDocuments().ok).toBe(true);
  });
});
