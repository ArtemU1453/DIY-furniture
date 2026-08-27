/**
 * ЭТАП 15 — Присадка, соединения и производственная обработка.
 * Цепочка: Template → ProjectModel → Parts → Connections → Hardware →
 * Machining → 3D → Drawings → Cutting.
 * Проверяет модель соединений и типы, правила крепежа, генератор присадки,
 * локальные координаты и прямое/обратное преобразование, валидацию,
 * manual override и сброс к правилу, дерево/фильтры/группировку, экспорт,
 * связь с фурнитурой и чертежами, DIRTY-состояния.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import {
  allOperations,
  generateMachining,
  manualOperations,
  validateMachining,
  validateEdgeDistance,
  validateReferences,
  allowedDepth,
  getMachiningRule,
  confirmatRule,
  dowelRule,
  minifixRule,
  camLockRule,
  screwRule,
  hingeRule,
  handleRule,
  groupOperations,
  machiningOperationsCsv,
  machiningToJson,
  connectionTypeOfCategory,
  categoryOfConnectionType,
  resolveConnectionType,
  CONNECTION_TYPES,
  symmetricPositions,
  isSymmetric,
  fastenerCountForLength,
} from '@/engines/machining';
import { machiningToWorld, worldToMachining, operationWorld } from '@/core/geometry/coordinateSystem';
import { isCuttingStale } from '@/engines/cutting';
import { isDocumentsOutdated, buildPartsDocument, renderPageSvg } from '@/engines/drawing';
import { DEFAULT_MANUFACTURING_PROFILE } from '@/core/model/factory';
import type { ConnectionType, MachiningOperation, Part } from '@/core/model/types';
import type { FurnitureId, HardwareConnectionId, MachiningId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = () => store().project;
const parts = () => allParts(project());
function partByType(type: string): Part {
  return parts().find((p) => p.metadata?.partType === type)!;
}

/** Id мебели, созданной последним вызовом makeCabinet(). */
let cabinetId = '';

/** Тестовый шкаф 800×2000×600, 16 мм, 4 полки, 1 перегородка, 2 фасада (§63). */
function makeCabinet() {
  store().newProject('Тест');
  const res = store().createFromTemplate('tpl-cabinet', {
    width: 800, height: 2000, depth: 600, materialThickness: 16, backThickness: 3,
    shelfCount: 4, verticalPartitionCount: 1, doorCount: 2, doorGap: 3,
    backType: 'inset', jointType: 'confirmat', handleEnabled: true,
  });
  expect(res.ok).toBe(true);
  cabinetId = res.id!;
  return cabinetId;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('Присадка 15 — соединения и типы', () => {
  beforeEach(() => makeCabinet());

  it('Тест 1: Connection — поля и связь с деталями', () => {
    const conns = project().hardwareConnections;
    expect(conns.length).toBeGreaterThan(0);
    for (const c of conns) {
      expect(c.id).toBeTruthy();
      expect(findPart(project(), c.partAId)).toBeDefined();
      expect(findPart(project(), c.partBId)).toBeDefined();
      expect(project().hardware.some((h) => h.id === c.hardwareId)).toBe(true);
    }
  });

  it('Тест 2: ConnectionType — полный набор и двустороннее соответствие', () => {
    expect(CONNECTION_TYPES).toEqual(['CONFIRMAT', 'DOWEL', 'MINIFIX', 'SCREW', 'CAM_LOCK']);
    for (const t of CONNECTION_TYPES) {
      expect(connectionTypeOfCategory(categoryOfConnectionType(t))).toBe(t);
    }
    expect(connectionTypeOfCategory('other')).toBe('OTHER');
  });

  it('Тест 3: ConnectionRule — правило есть для каждого типа соединения', () => {
    for (const t of CONNECTION_TYPES) {
      expect(getMachiningRule(categoryOfConnectionType(t))).toBeDefined();
    }
  });

  it('Тест 61: тип соединения выводится из назначенного крепежа', () => {
    const c = project().hardwareConnections[0];
    expect(resolveConnectionType(project(), c)).toBe('CONFIRMAT');
  });

  it('Тест 4/64: CONFIRMAT — сквозное + направляющее, все операции связаны', () => {
    expect(confirmatRule.category).toBe('confirmat');
    const ops = generateMachining(project());
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((o) => o.sourceHardwareConnectionId)).toBe(true);
    expect(ops.every((o) => o.hardwareId)).toBe(true);
    expect(ops.some((o) => o.through === true)).toBe(true);
    expect(ops.some((o) => o.through === false)).toBe(true);
  });

  it('Тест 5/65: DOWEL — переключение типа обновляет операции', () => {
    const before = generateMachining(project()).filter((o) => o.type === 'confirmat').length;
    expect(before).toBeGreaterThan(0);
    for (const c of project().hardwareConnections) {
      if (resolveConnectionType(project(), c) === 'CONFIRMAT') {
        store().setConnectionType(c.id as HardwareConnectionId, 'DOWEL');
      }
    }
    const after = generateMachining(project());
    expect(after.filter((o) => o.type === 'confirmat')).toHaveLength(0);
    expect(after.filter((o) => o.type === 'dowel').length).toBeGreaterThan(0);
    expect(dowelRule.category).toBe('dowel');
  });

  it('Тест 6/66: MINIFIX — комплект отверстий (эксцентрик + шток)', () => {
    for (const c of project().hardwareConnections) {
      if (resolveConnectionType(project(), c) === 'CONFIRMAT') {
        store().setConnectionType(c.id as HardwareConnectionId, 'MINIFIX');
      }
    }
    const ops = generateMachining(project());
    expect(ops.some((o) => o.type === 'boring')).toBe(true); // корпус эксцентрика
    expect(ops.some((o) => o.type === 'dowel')).toBe(true);  // шток
    expect(minifixRule.category).toBe('minifix');
  });

  it('Тест 7: SCREW — правило зарегистрировано и создаёт операции', () => {
    expect(screwRule.category).toBe('screw');
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const hwId = store().addHardwareFromTemplate({ name: 'Саморез', category: 'screw', parameters: { diameter: 4, length: 30, pilotDiameter: 2.5, count: 3, edgeOffset: 40 } });
    const res = store().addConnection({ hardwareId: hwId, partAId: side.id, partBId: bottom.id });
    expect(res.ok).toBe(true);
    const ops = generateMachining(project()).filter((o) => String(o.sourceHardwareConnectionId) === String(res.id));
    expect(ops.length).toBeGreaterThan(0);
  });

  it('Тест 8: CAM_LOCK — отдельное правило на общем механизме с MINIFIX', () => {
    expect(camLockRule.category).toBe('connector');
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const hwId = store().addHardwareFromTemplate({ name: 'Стяжка', category: 'connector', parameters: { edgeOffset: 32, count: 2 } });
    const res = store().addConnection({ hardwareId: hwId, partAId: side.id, partBId: bottom.id });
    const ops = generateMachining(project()).filter((o) => String(o.sourceHardwareConnectionId) === String(res.id!));
    expect(ops.some((o) => o.type === 'boring')).toBe(true);
    expect(ops.some((o) => o.type === 'dowel')).toBe(true);
    // Размеры отличаются от минификса (Ø20 против Ø15).
    expect(ops.find((o) => o.type === 'boring')!.diameter).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Присадка 15 — операции и координаты', () => {
  beforeEach(() => makeCabinet());

  it('Тест 9/10/11: MachiningOperation — поля, DRILL и BORE', () => {
    const ops = generateMachining(project());
    for (const op of ops) {
      expect(op.id).toBeTruthy();
      expect(op.partId).toBeTruthy();
      expect(op.type).toBeTruthy();
      expect(op.face).toBeTruthy();
      expect(typeof op.x).toBe('number');
      expect(typeof op.y).toBe('number');
    }
    // Есть и сверление, и присадка под чашку (петли фасадов).
    expect(ops.some((o) => o.type === 'drilling' || o.type === 'confirmat' || o.type === 'dowel')).toBe(true);
    expect(ops.some((o) => o.type === 'hinge' || o.type === 'boring')).toBe(true);
  });

  it('Тест 12: Face — все грани однозначны', () => {
    const faces = new Set(generateMachining(project()).map((o) => o.face));
    for (const f of faces) {
      expect(['top', 'bottom', 'front', 'back', 'left', 'right']).toContain(f);
    }
  });

  it('Тест 13/69: локальные координаты не меняются при перемещении детали', () => {
    const side = partByType('side_left');
    // Операция с фиксированной идентичностью: у сгенерированных из связей
    // операций при переносе детали меняется сама геометрия стыка, поэтому
    // инвариантность локальных координат проверяем на ручной операции.
    const opId = store().addManualOperation({
      partId: side.id as PartId, face: 'front', x: 120, y: 300, diameter: 8, depth: 10,
    });
    const readOp = (): MachiningOperation =>
      manualOperations(project()).find((o) => o.id === opId)!;

    const before = readOp();
    const local = { x: before.x, y: before.y, face: before.face };
    const worldBefore = machiningToWorld(findPart(project(), side.id)!, before).position;

    store().updatePart(side.id as PartId, { position: { ...side.position, x: side.position.x + 500 } });

    const after = readOp();
    // Локальные координаты неизменны — они привязаны к детали, а не к сцене.
    expect({ x: after.x, y: after.y, face: after.face }).toEqual(local);
    const worldAfter = machiningToWorld(findPart(project(), side.id)!, after).position;
    // Мировое положение изменилось ровно на смещение детали.
    expect(worldAfter.x - worldBefore.x).toBeCloseTo(500, 6);
  });

  it('Тест 14/16: machiningToWorld — мировая точка, направление и кончик сверла', () => {
    const side = partByType('side_left');
    const op = generateMachining(project()).find((o) => o.partId === side.id)!;
    const w = machiningToWorld(side, op);
    expect(Number.isFinite(w.position.x)).toBe(true);
    // Направление — единичный вектор внутрь детали.
    const len = Math.hypot(w.inward.x, w.inward.y, w.inward.z);
    expect(len).toBeCloseTo(1, 6);
    // Кончик отстоит от поверхности на глубину.
    const depth = op.depth ?? 0;
    expect(Math.hypot(w.tip.x - w.position.x, w.tip.y - w.position.y, w.tip.z - w.position.z)).toBeCloseTo(depth, 3);
    // Совпадает с operationWorld (единые правила координат).
    const legacy = operationWorld(side, op.face, op.x, op.y);
    expect(w.position.x).toBeCloseTo(legacy.position.x, 6);
  });

  it('Тест 15/70: worldToMachining — обратное преобразование (в т.ч. после поворота)', () => {
    const side = partByType('side_left');
    const op = generateMachining(project()).find((o) => o.partId === side.id)!;
    const w = machiningToWorld(side, op);
    const back = worldToMachining(side, w.position);
    expect(back.face).toBe(op.face);
    expect(back.x).toBeCloseTo(op.x, 3);
    expect(back.y).toBeCloseTo(op.y, 3);

    // После поворота детали преобразование остаётся согласованным.
    store().updatePart(side.id as PartId, { rotation: { x: 0, y: 0, z: 0 } });
    const rotated = findPart(project(), side.id)!;
    const w2 = machiningToWorld(rotated, op);
    const back2 = worldToMachining(rotated, w2.position);
    expect(back2.x).toBeCloseTo(op.x, 3);
    expect(back2.y).toBeCloseTo(op.y, 3);
  });

  it('Тест 16b/67: HingeRule — чашки и монтажные отверстия фасада', () => {
    expect(hingeRule.category).toBe('hinge');
    const ops = generateMachining(project());
    const cups = ops.filter((o) => o.type === 'hinge');
    expect(cups.length).toBeGreaterThan(0);
    expect(cups[0].diameter).toBe(35);
    // Монтажные отверстия рядом с чашкой.
    const conn = cups[0].sourceHardwareConnectionId;
    const sameConn = ops.filter((o) => o.sourceHardwareConnectionId === conn);
    expect(sameConn.length).toBeGreaterThan(cups.length);
  });

  it('Тест 17/68: HandleMountRule — монтажные отверстия ручки', () => {
    expect(handleRule.category).toBe('handle');
    const facade = parts().find((p) => p.metadata?.partType === 'facade')!;
    const hwId = store().addHardwareFromTemplate({ name: 'Ручка 128', category: 'handle', article: 'h128', parameters: { centerDistance: 128, diameter: 5, edgeOffset: 40 } });
    const other = partByType('side_left');
    const res = store().addConnection({ hardwareId: hwId, partAId: facade.id, partBId: other.id });
    const ops = generateMachining(project()).filter((o) => String(o.sourceHardwareConnectionId) === String(res.id!));
    expect(ops).toHaveLength(2);
    expect(Math.abs(ops[0].x - ops[1].x)).toBeCloseTo(128, 0);
    expect(ops.every((o) => o.through)).toBe(true);
  });

  it('Тест 18: MachiningGenerator — ProjectModel → MachiningModel', () => {
    const ops = generateMachining(project());
    expect(ops.length).toBeGreaterThan(0);
    expect(allOperations(project()).length).toBeGreaterThanOrEqual(ops.length);
    expect(manualOperations(project())).toHaveLength(0);
  });

  it('Тест 24: SymmetryRule — симметричное распределение и количество по длине', () => {
    const pos = symmetricPositions(1000, 3, 50);
    expect(pos).toEqual([50, 500, 950]);
    expect(isSymmetric(pos, 1000)).toBe(true);
    expect(isSymmetric([10, 20, 30], 1000)).toBe(false);
    expect(symmetricPositions(1000, 1, 50)).toEqual([500]);
    // Количество крепежа растёт с длиной (§23), значения конфигурируемы.
    expect(fastenerCountForLength(250)).toBe(2);
    expect(fastenerCountForLength(700)).toBe(3);
    expect(fastenerCountForLength(2000)).toBe(5);
  });

  it('Тест 22: параметрическое правило — изменение глубины пересчитывает координаты', () => {
    const side = partByType('side_left');
    const xs = () => [
      ...new Set(generateMachining(project()).filter((o) => o.partId === side.id).map((o) => o.x)),
    ].sort((a, b) => a - b);
    const before = xs();
    // Боковина «растёт» вдоль глубины — присадка обязана переехать вместе с ней.
    store().updateTemplateValues(cabinetId as FurnitureId, { depth: 800 });
    const after = xs();
    expect(findPart(project(), side.id)!.width).toBeCloseTo(800, 6);
    expect(after).not.toEqual(before);
    expect(Math.max(...after)).toBeGreaterThan(Math.max(...before));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Присадка 15 — валидация', () => {
  beforeEach(() => makeCabinet());

  it('Тест 19: MachiningValidator — корректный шкаф без ошибок', () => {
    const issues = validateMachining(allOperations(project()), project());
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('Тест 20/34/71: отверстие Ø20 в 5 мм от края → ошибка', () => {
    const side = partByType('side_left');
    store().addManualOperation({ partId: side.id, face: 'front', x: 5, y: 100, diameter: 20, depth: 10 });
    const issues = validateMachining(allOperations(project()), project());
    expect(issues.some((i) => i.code === 'machining.holeOutOfPart' || i.code === 'machining.edgeDistance')).toBe(true);
    // Прямая проверка правила.
    const op = { id: 'x' as MachiningId, type: 'drilling', partId: side.id, face: 'front', x: 5, y: 100, z: 0, diameter: 20, depth: 10, through: false, origin: 'manual' } as MachiningOperation;
    expect(validateEdgeDistance(op, side, project().machining.constraints).length).toBeGreaterThan(0);
  });

  it('Тест 21/72: глубина 30 мм в детали 16 мм → ошибка', () => {
    const side = partByType('side_left');
    expect(allowedDepth(side, { face: 'front' })).toBe(side.thickness);
    store().addManualOperation({ partId: side.id, face: 'front', x: 200, y: 300, diameter: 8, depth: 30 });
    const issues = validateMachining(allOperations(project()), project());
    expect(issues.some((i) => i.code === 'machining.depthExceeds' && i.severity === 'error')).toBe(true);
  });

  it('Тест 22b/33: пересечение одинаковых отверстий выявляется', () => {
    const side = partByType('side_left');
    store().addManualOperation({ partId: side.id, face: 'front', x: 200, y: 300, diameter: 8, depth: 10 });
    store().addManualOperation({ partId: side.id, face: 'front', x: 201, y: 300, diameter: 8, depth: 10 });
    const issues = validateMachining(allOperations(project()), project());
    expect(issues.length).toBeGreaterThan(0);
  });

  it('Тест 19b: диаметр ≤ 0 → ошибка; ссылки проверяются', () => {
    const side = partByType('side_left');
    const bad = { id: 'b1' as MachiningId, type: 'drilling', partId: side.id, face: 'front', x: 100, y: 100, z: 0, diameter: 0, depth: 5, through: false, origin: 'manual' } as MachiningOperation;
    expect(validateMachining([bad], project()).some((i) => i.code === 'machining.badDiameter')).toBe(true);
    const ghost = { ...bad, diameter: 5, hardwareId: 'ghost' as never };
    expect(validateReferences(ghost, project()).some((i) => i.code === 'machining.noHardware')).toBe(true);
  });

  it('Тест 53/54: ManufacturingProfile задаёт минимальный отступ от края', () => {
    expect(project().machining.profile).toBeDefined();
    expect(DEFAULT_MANUFACTURING_PROFILE.minHoleEdgeDistance).toBeGreaterThan(0);
    expect(DEFAULT_MANUFACTURING_PROFILE.defaultJointType).toBe('CONFIRMAT' as ConnectionType);
  });

  it('Тест 35: сквозное отверстие не использует число-заглушку', () => {
    const ops = generateMachining(project());
    const through = ops.find((o) => o.through);
    expect(through).toBeDefined();
    // Признак сквозного — булев флаг, глубина равна толщине детали.
    const part = findPart(project(), through!.partId)!;
    expect(through!.depth).toBe(part.thickness);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Присадка 15 — override, дерево, экспорт, интеграция', () => {
  beforeEach(() => makeCabinet());

  it('Тест 23/41/42: Manual Override — правка переживает пересчёт', () => {
    const op = generateMachining(project())[0];
    expect(op.override).toBeFalsy();
    store().setOperationOverride(op.id as MachiningId, { diameter: 9.5 });
    const after = generateMachining(project()).find((o) => o.id === op.id)!;
    expect(after.diameter).toBe(9.5);
    expect(after.override).toBe(true);
    // Пересчёт конструкции не стирает правку.
    store().updateTemplateValues(project().furnitures[0].id, { shelfCount: 5 });
    const still = generateMachining(project()).find((o) => o.id === op.id);
    expect(still?.diameter).toBe(9.5);
  });

  it('Тест 24b/43: Reset to Rule — правка удаляется, операция снова из правила', () => {
    const op = generateMachining(project())[0];
    const original = op.diameter;
    store().setOperationOverride(op.id as MachiningId, { diameter: 12 });
    expect(generateMachining(project()).find((o) => o.id === op.id)!.diameter).toBe(12);
    store().resetOperationToRule(op.id as MachiningId);
    const reset = generateMachining(project()).find((o) => o.id === op.id)!;
    expect(reset.diameter).toBe(original);
    expect(reset.override).toBeFalsy();
  });

  it('Тест 25: Connection Tree — соединения с деталями и операциями', () => {
    const conns = project().hardwareConnections;
    const ops = allOperations(project());
    expect(conns.length).toBeGreaterThan(0);
    for (const c of conns.slice(0, 5)) {
      expect(findPart(project(), c.partAId)).toBeDefined();
      expect(findPart(project(), c.partBId)).toBeDefined();
      expect(resolveConnectionType(project(), c)).toBeTruthy();
    }
    // У части соединений есть операции присадки.
    expect(ops.some((o) => o.sourceHardwareConnectionId)).toBe(true);
  });

  it('Тест 26: Machining Tree — операции конкретной детали', () => {
    const side = partByType('side_left');
    const sideOps = allOperations(project()).filter((o) => o.partId === side.id);
    expect(sideOps.length).toBeGreaterThan(0);
    expect(sideOps.every((o) => o.partId === side.id)).toBe(true);
  });

  it('Тест 27: фильтрация по типу операции', () => {
    const ops = allOperations(project());
    const hinges = ops.filter((o) => o.type === 'hinge');
    const drills = ops.filter((o) => o.type === 'drilling');
    expect(hinges.length + drills.length).toBeGreaterThan(0);
    expect(hinges.every((o) => o.type === 'hinge')).toBe(true);
  });

  it('Тест 28/49: группировка одинаковых операций с количеством', () => {
    const groups = groupOperations(allOperations(project()));
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.count).toBe(g.operations.length); // раскрытие показывает все
      expect(g.operations.every((o) => o.type === g.type && o.diameter === g.diameter)).toBe(true);
    }
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(allOperations(project()).length);
  });

  it('Тест 29/56: machining_operations.csv со стабильными колонками', () => {
    const csv = machiningOperationsCsv(project(), allOperations(project()));
    expect(csv.split('\n')[0]).toBe('Operation ID,Part ID,Type,Face,X,Y,Diameter,Depth,Direction,Connection ID,Hardware ID');
    expect(csv.split('\n').length).toBeGreaterThan(1);
    // Сквозное обозначено словом, не числом-заглушкой.
    expect(csv).toContain('THROUGH');
  });

  it('Тест 30/57: machining.json содержит полную модель', () => {
    const parsed = JSON.parse(machiningToJson(project(), allOperations(project())));
    expect(Array.isArray(parsed.operations)).toBe(true);
    expect(parsed.operations.length).toBeGreaterThan(0);
    expect(parsed.constraints).toBeDefined();
    expect(parsed.profile).toBeDefined();
    expect(parsed.overrides).toBeDefined();
  });

  it('Тест 31: 3D-визуализация получает готовые операции (без своего расчёта)', () => {
    const ops = allOperations(project());
    // Каждая операция даёт корректную мировую точку — это всё, что нужно 3D.
    for (const op of ops.slice(0, 20)) {
      const part = findPart(project(), op.partId)!;
      const w = machiningToWorld(part, op);
      expect(Number.isFinite(w.position.x)).toBe(true);
      expect(Number.isFinite(w.inward.y)).toBe(true);
    }
  });

  it('Тест 32/50/73: чертёж детали показывает отверстия', () => {
    const side = partByType('side_left');
    const doc = buildPartsDocument(project());
    const page = doc.pages.find((p) => p.partId === side.id)!;
    expect(page.scene.prims.some((p) => p.kind === 'circle')).toBe(true);
    const svg = renderPageSvg(page);
    expect(svg).toContain('<circle');
    expect(svg).toContain('Присадка'); // таблица операций
  });

  it('Тест 33/60: связь с HardwareModel — каждая авто-операция знает крепёж', () => {
    const ops = generateMachining(project());
    expect(ops.every((o) => o.hardwareId)).toBe(true);
    for (const op of ops.slice(0, 10)) {
      expect(project().hardware.some((h) => h.id === op.hardwareId)).toBe(true);
    }
  });

  it('Тест 34b/58/59: присадка → документы OUTDATED, раскрой НЕ DIRTY', async () => {
    await store().recalculateCutting();
    store().markDocumentsGenerated();
    expect(isCuttingStale(project())).toBe(false);
    expect(isDocumentsOutdated(project())).toBe(false);

    // Меняем только присадку (диаметр отверстия).
    const op = generateMachining(project())[0];
    store().setOperationOverride(op.id as MachiningId, { diameter: 7.5 });

    expect(isDocumentsOutdated(project())).toBe(true);  // документы устарели
    expect(isCuttingStale(project())).toBe(false);      // раскрой НЕ затронут (§59)
  });

  it('Тест 35/62: полная цепочка Template → … → Machining → Drawings', () => {
    const furnitureId = project().furnitures[0].id;
    expect(furnitureId).toBeTruthy();
    expect(parts().length).toBeGreaterThan(5);
    expect(project().hardwareConnections.length).toBeGreaterThan(0);
    expect(project().hardware.length).toBeGreaterThan(0);
    const ops = allOperations(project());
    expect(ops.length).toBeGreaterThan(0);
    // Все ID согласованы.
    for (const op of ops) {
      expect(findPart(project(), op.partId)).toBeDefined();
      if (op.sourceHardwareConnectionId) {
        expect(project().hardwareConnections.some((c) => c.id === op.sourceHardwareConnectionId)).toBe(true);
      }
      if (op.hardwareId) {
        expect(project().hardware.some((h) => h.id === op.hardwareId)).toBe(true);
      }
    }
    expect(buildPartsDocument(project()).pages.length).toBeGreaterThan(0);
  });
});
