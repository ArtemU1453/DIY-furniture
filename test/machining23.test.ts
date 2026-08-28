/**
 * ЭТАП 23 — Присадка и технологические операции.
 * Цепочка: PROJECT → PART → CONNECTION → HARDWARE → MACHINING RULE →
 * MACHINING OPERATION → PART DRAWING → PRODUCTION DOCUMENT → CNC DATA.
 *
 * Проверяет модель операции и её типы, координаты и ссылки позиций, безопасные
 * выражения, шаблоны и версии правил, инструменты и профиль станка, валидацию
 * границ и глубины, ручные и автоматические операции, override и его сброс,
 * атомарный пересчёт и восстановление после ошибки, экспорт JSON/CSV, импорт,
 * интеграции с 3D, чертежом, раскроем и фурнитурой, undo/redo и регрессию.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import {
  DEFAULT_TOOLS,
  MACHINING_RULE_VERSION,
  allOperations,
  applyTemplates,
  atPoint,
  boreOperation,
  boreTemplate,
  checkTooling,
  contourOf,
  csvExporter,
  cutoutOperation,
  drillOperation,
  drillTemplate,
  exportMachining,
  faceExtent,
  fromCenter,
  fromEdge,
  fromOperation,
  generateMachining,
  getMachineExporter,
  grooveOperation,
  grooveTemplate,
  importMachining,
  jsonExporter,
  machineExporters,
  machiningResultFor,
  millingOperation,
  operationId,
  operationsOfPart,
  partOfOperation,
  partStatus,
  partsWithMachining,
  pickTool,
  pocketOperation,
  regenerate,
  resolvePosition,
  resolveValue,
  scopeFor,
  sortOperations,
  toolLibrary,
  toolTypeFor,
  validateProjectMachining,
} from '@/engines/machining';
import { operationWorld } from '@/core/geometry/coordinateSystem';
import { buildDocument, buildPartsDocument, renderPageSvg } from '@/engines/drawing';
import { runCutting } from '@/engines/cutting';
import { operationsOfHardware } from '@/engines/hardware';
import { deserializeProject } from '@/storage/project/serialization';
import type { MachiningOperation, Part, PartFace, Project } from '@/core/model/types';
import type { MachiningId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;
const part = (id: PartId): Part => findPart(project(), id)!;

/** Деталь 600×400×16 из §99. */
function makePart(width = 600, height = 400, thickness = 16): PartId {
  store().newProject('Тест 23');
  return store().addPart({
    name: 'Панель', width, height, thickness,
    material: project().materials[0].id,
  });
}

/** Тестовый шкаф 800×2000×600 с фасадами. */
function makeCabinet(): void {
  store().newProject('Тест 23 — шкаф');
  const res = store().createFromTemplate('tpl-cabinet', {
    width: 800, height: 2000, depth: 600, materialThickness: 16, backThickness: 3,
    shelfCount: 4, verticalPartitionCount: 1, doorCount: 2, doorGap: 3,
    backType: 'inset', jointType: 'confirmat', handleEnabled: true,
  });
  expect(res.ok).toBe(true);
}

const opsOf = (id: PartId) => part(id).machining;

// ─────────────────────────────────────────────────────────────────────────────
describe('Присадка 23 — операции и типы', () => {
  it('Тест 1/2/22/99: сверление Ø5 × 12', () => {
    const id = makePart();
    const opId = store().addManualOperation({
      partId: id, face: 'front', x: 100, y: 50, diameter: 5, depth: 12,
    });
    const op = opsOf(id).find((o) => o.id === opId)!;
    expect(op.type).toBe('drilling');
    expect(op.diameter).toBe(5);
    expect(op.depth).toBe(12);
    expect(op.face).toBe('front');
    expect(op.origin).toBe('manual');
    // Координаты локальные, а не экранные (§7).
    expect(op.x).toBe(100);
    expect(op.y).toBe(50);
  });

  it('Тест 3/25/100: присадка под чашку Ø35 × 12', () => {
    const id = makePart();
    const op = boreOperation({ part: part(id), face: 'front', x: 22.5, y: 100, diameter: 35, depth: 12 });
    expect(op.type).toBe('boring');
    expect(op.diameter).toBe(35);
    expect(op.depth).toBe(12);
    expect(op.through).toBe(false);
    expect(op.toolType).toBe('DRILL');
  });

  it('Тест 2/23/101: сквозное отверстие берёт глубину из толщины', () => {
    const id = makePart(600, 400, 16);
    const op = drillOperation({ part: part(id), face: 'front', x: 50, y: 50, diameter: 8, through: true });
    expect(op.through).toBe(true);
    expect(op.depth).toBe(16); // §23: не число-заглушка, а толщина детали

    // Толще деталь — глубже сквозное отверстие.
    store().updatePart(id, { thickness: 18 });
    const again = drillOperation({ part: part(id), face: 'front', x: 50, y: 50, diameter: 8, through: true });
    expect(again.depth).toBe(18);
  });

  it('Тест 2/24: глухое отверстие хранит заданную глубину', () => {
    const id = makePart();
    const op = drillOperation({ part: part(id), face: 'front', x: 50, y: 50, diameter: 8, depth: 10, through: false });
    expect(op.through).toBe(false);
    expect(op.depth).toBe(10);
  });

  it('Тест 4/26: паз', () => {
    const id = makePart();
    const op = grooveOperation({ part: part(id), face: 'back', x: 10, y: 20, length: 300, width: 8, depth: 6, direction: 'vertical' });
    expect(op.type).toBe('groove');
    expect(op.length).toBe(300);
    expect(op.width).toBe(8);
    expect(op.depth).toBe(6);
    expect(op.parameters?.direction).toBe('vertical');
    expect(op.toolType).toBe('END_MILL');
  });

  it('Тест 5/27: карман', () => {
    const id = makePart();
    const op = pocketOperation({ part: part(id), face: 'front', x: 100, y: 100, width: 80, height: 40, depth: 5 });
    expect(op.type).toBe('pocket');
    expect(op.width).toBe(80);
    expect(op.length).toBe(40);
    expect(op.depth).toBe(5);
  });

  it('Тест 6/28: вырез — сквозной по определению', () => {
    const id = makePart(600, 400, 16);
    const op = cutoutOperation({ part: part(id), face: 'front', x: 100, y: 100, width: 60, height: 60 });
    expect(op.type).toBe('cutout');
    expect(op.through).toBe(true);
    expect(op.depth).toBe(16);
  });

  it('Тест 7/29: фрезеровка по контуру', () => {
    const id = makePart();
    const contour = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }];
    const op = millingOperation({ part: part(id), face: 'front', x: 0, y: 0, contour, depth: 4, diameter: 6 });
    expect(op.type).toBe('mill');
    expect(op.depth).toBe(4);
    expect(contourOf(op)).toEqual(contour);
    // Операция без контура не ломает чтение.
    expect(contourOf(drillOperation({ part: part(id), face: 'front', x: 0, y: 0, diameter: 5, depth: 5 }))).toEqual([]);
  });

  it('Тест 1/59: порядок операций — грань, тип, номер', () => {
    const id = makePart();
    const p = part(id);
    const list: MachiningOperation[] = [
      { ...drillOperation({ part: p, face: 'top', x: 1, y: 1, diameter: 5, depth: 5 }), sequence: 2 },
      { ...drillOperation({ part: p, face: 'front', x: 2, y: 2, diameter: 5, depth: 5 }), sequence: 5 },
      { ...boreOperation({ part: p, face: 'front', x: 3, y: 3, diameter: 35, depth: 12 }), sequence: 1 },
    ];
    const sorted = sortOperations(list);
    expect(sorted.map((o) => o.face)).toEqual(['front', 'front', 'top']);
    // Внутри грани: boring раньше drilling по алфавиту типа.
    expect(sorted[0].type).toBe('boring');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Присадка 23 — координаты, ссылки, выражения', () => {
  it('Тест 13/16/17/43: отступ от края', () => {
    const id = makePart(600, 400, 16);
    const p = part(id);
    const ctxX = { part: p, face: 'front' as PartFace, axis: 'x' as const };
    expect(resolvePosition(fromEdge(37, 'left'), ctxX)).toBe(37);
    // От дальнего края отступ считается с обратной стороны (§43).
    expect(resolvePosition(fromEdge(37, 'right'), ctxX)).toBe(600 - 37);
  });

  it('Тест 13/18/45: от центра', () => {
    const id = makePart(600, 400, 16);
    const ctxX = { part: part(id), face: 'front' as PartFace, axis: 'x' as const };
    expect(resolvePosition(fromCenter(0), ctxX)).toBe(300);
    expect(resolvePosition(fromCenter(50), ctxX)).toBe(350);
    expect(resolvePosition(atPoint(123), ctxX)).toBe(123);
  });

  it('Тест 13/19: от другой операции', () => {
    const id = makePart();
    const ctx = {
      part: part(id), face: 'front' as PartFace, axis: 'x' as const,
      resolved: new Map([['A', { x: 100, y: 50 }]]),
    };
    expect(resolvePosition(fromOperation('A', 32), ctx)).toBe(132);
    // Ссылка на неизвестную операцию не даёт молчаливый ноль.
    expect(resolvePosition(fromOperation('нет', 32), ctx)).toBe(32);
  });

  it('Тест 14/20/21: безопасные выражения без eval', () => {
    const id = makePart(600, 400, 16);
    const scope = scopeFor(part(id), 'front');
    expect(resolveValue('width / 2', scope)).toBe(300);
    expect(resolveValue('height - 37', scope)).toBe(363);
    expect(resolveValue('width - 45', scope)).toBe(555);
    expect(resolveValue(42, scope)).toBe(42);
    // Произвольный код не выполняется — выражение просто не разбирается.
    expect(() => resolveValue('process.exit(1)', scope)).toThrow();
    expect(() => resolveValue('alert(1)', scope)).toThrow();
  });

  it('Тест 6/13: размеры грани зависят от самой грани', () => {
    const id = makePart(600, 400, 16);
    const p = part(id);
    expect(faceExtent(p, 'front')).toEqual({ width: 600, height: 400 });
    expect(faceExtent(p, 'left')).toEqual({ width: 16, height: 400 });
    expect(faceExtent(p, 'top')).toEqual({ width: 600, height: 16 });
  });

  it('Тест 8/42/102: X = width / 2 пересчитывается при изменении ширины', () => {
    const id = makePart(600, 400, 16);
    const templates = [drillTemplate('center', 'front', atPoint('width / 2'), atPoint('height / 2'), 8, 10)];

    const first = applyTemplates(templates, { part: part(id), ruleId: 'test', ruleVersion: '1.0' });
    expect(first[0].x).toBe(300);
    expect(first[0].y).toBe(200);

    store().updatePart(id, { width: 800 });
    const second = applyTemplates(templates, { part: part(id), ruleId: 'test', ruleVersion: '1.0' });
    // §42: координата производна от размера, а не скопирована один раз.
    expect(second[0].x).toBe(400);
    expect(second[0].y).toBe(200);
    // Идентификатор при этом не изменился — правки к операции не теряются.
    expect(second[0].id).toBe(first[0].id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Присадка 23 — шаблоны и правила', () => {
  it('Тест 8/14/39: стабильный id операции', () => {
    expect(operationId('p1', 'c1', 'hinge', 0)).toBe('op:p1:c1:hinge:001');
    expect(operationId('p1', undefined, 'edge', 2)).toBe('op:p1:edge:003');
    // §38: одинаковый вход — одинаковый id, дублей не возникает.
    expect(operationId('p1', 'c1', 'hinge', 0)).toBe(operationId('p1', 'c1', 'hinge', 0));
  });

  it('Тест 8/9/84: шаблоны дают операции с версией правила', () => {
    const id = makePart(600, 400, 16);
    const templates = [
      drillTemplate('a', 'front', fromEdge(37), fromEdge(50), 5, 12),
      boreTemplate('b', 'front', fromEdge(22.5), fromCenter(0), 35, 12),
      grooveTemplate('c', 'back', fromEdge(10), fromEdge(10), 200, 8, 6),
    ];
    const ops = applyTemplates(templates, {
      part: part(id), ruleId: 'demo', ruleVersion: '2.0',
      connectionId: 'conn-1', source: 'HARDWARE_RULE',
    });
    expect(ops).toHaveLength(3);
    expect(ops.map((o) => o.type)).toEqual(['drilling', 'boring', 'groove']);
    for (const op of ops) {
      expect(op.source).toBe('HARDWARE_RULE');
      expect(op.origin).toBe('generated');
      expect(op.metadata?.ruleVersion).toBe('2.0');
      expect(op.sequence).toBeGreaterThan(0);
    }
    expect(ops[1].diameter).toBe(35);
    expect(ops[2].length).toBe(200);
  });

  it('Тест 8/19: шаблон может ссылаться на предыдущую операцию', () => {
    const id = makePart(600, 400, 16);
    const ops = applyTemplates([
      drillTemplate('first', 'front', fromEdge(37), fromEdge(50), 5, 12),
      { ...drillTemplate('second', 'front', fromEdge(0), fromEdge(50), 5, 12), x: fromOperation('op:' + id + ':first:001', 32) },
    ], { part: part(id), ruleId: 'chain', ruleVersion: '1.0' });
    expect(ops).toHaveLength(2);
    expect(ops[0].x).toBe(37);
  });

  it('Тест 9/18/105: правило петли создаёт Ø35', () => {
    makeCabinet();
    const hinge = project().hardware.find((h) => h.category === 'hinge')!;
    const ops = operationsOfHardware(project(), hinge.id);
    expect(ops.length).toBeGreaterThan(0);
    const cup = ops.find((o) => o.diameter === 35);
    expect(cup).toBeDefined();
    expect(cup!.depth).toBeGreaterThan(0);
    // §12: геометрия отверстия живёт в операции, а не в самой позиции фурнитуры.
    expect((hinge as unknown as Record<string, unknown>).x).toBeUndefined();
  });

  it('Тест 19/11: соединение, фурнитура и правило разделены', () => {
    makeCabinet();
    const ops = generateMachining(project());
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      // Каждая производная операция прослеживается до узла и до фурнитуры.
      expect(op.sourceHardwareConnectionId).toBeTruthy();
      expect(op.hardwareId).toBeTruthy();
      expect(findPart(project(), op.partId)).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Присадка 23 — инструменты и станок', () => {
  beforeEach(() => makeCabinet());

  it('Тест 10/11/53: библиотека инструментов', () => {
    const tools = toolLibrary(project());
    expect(tools.length).toBeGreaterThan(0);
    const diameters = tools.map((t) => t.diameter).sort((a, b) => a - b);
    expect(diameters).toEqual([5, 8, 10, 15, 20, 35]);
    expect(DEFAULT_TOOLS.every((t) => t.maxDepth > 0)).toBe(true);
  });

  it('Тест 10/54: подбор инструмента — точный или ближайший больший', () => {
    const tools = toolLibrary(project());
    const p = allParts(project())[0];
    const exact = pickTool(tools, drillOperation({ part: p, face: 'front', x: 0, y: 0, diameter: 8, depth: 10 }));
    expect(exact?.diameter).toBe(8);
    // Сверлом меньшего диаметра нужное отверстие не сделать — берём больший.
    const larger = pickTool(tools, drillOperation({ part: p, face: 'front', x: 0, y: 0, diameter: 6, depth: 10 }));
    expect(larger?.diameter).toBe(8);
    // Совсем крупного инструмента нет.
    expect(pickTool(tools, drillOperation({ part: p, face: 'front', x: 0, y: 0, diameter: 90, depth: 10 }))).toBeUndefined();
  });

  it('Тест 10/50: отсутствие инструмента — предупреждение, а не запрет', () => {
    const p = allParts(project())[0];
    const op = drillOperation({ part: p, face: 'front', x: 10, y: 10, diameter: 90, depth: 10 });
    const issues = checkTooling(op, toolLibrary(project()));
    expect(issues.some((i) => i.code === 'tool.missing')).toBe(true);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('Тест 12/55/56: возможности станка живут в производственном профиле', () => {
    const p = allParts(project())[0];
    store().updateManufacturingProfile({ maxToolDiameter: 20, maxMachiningDepth: 15, supportedOperations: ['drilling'] });
    const profile = project().machining.profile!;
    expect(profile.maxToolDiameter).toBe(20);

    const big = boreOperation({ part: p, face: 'front', x: 30, y: 30, diameter: 35, depth: 12 });
    const issues = checkTooling(big, toolLibrary(project()), profile);
    expect(issues.some((i) => i.code === 'machine.diameterExceeded')).toBe(true);
    expect(issues.some((i) => i.code === 'machine.unsupportedOperation')).toBe(true);
    // Всё это предупреждения: деталь можно отдать на сторону.
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('Тест 10: тип инструмента выводится из типа операции', () => {
    expect(toolTypeFor('drilling')).toBe('DRILL');
    expect(toolTypeFor('boring')).toBe('DRILL');
    expect(toolTypeFor('groove')).toBe('END_MILL');
    expect(toolTypeFor('pocket')).toBe('END_MILL');
    expect(toolTypeFor('cutout')).toBe('SAW');
    expect(toolTypeFor('custom')).toBe('CUSTOM');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Копия проекта с заведомо негодной операцией на детали: модель такие данные
 * не принимает, но они могут прийти из файла — валидатор обязан их находить.
 */
function brokenProjectWithOperation(
  partId: string,
  op: { diameter: number; depth: number; through: boolean },
) {
  const broken = structuredClone(project());
  const part = broken.furnitures
    .flatMap((f) => f.assemblies)
    .flatMap((a) => a.parts)
    .find((p) => String(p.id) === String(partId))!;
  part.machining.push({
    id: `broken-${part.machining.length}` as never,
    type: 'drilling', partId: part.id, face: 'front',
    x: 100, y: 100, z: 0,
    diameter: op.diameter, depth: op.depth, through: op.through, origin: 'manual',
  });
  return broken;
}

describe('Присадка 23 — валидация', () => {
  it('Тест 15/47: корректная операция замечаний не даёт', () => {
    const id = makePart(600, 400, 16);
    store().addManualOperation({ partId: id, face: 'front', x: 100, y: 100, diameter: 8, depth: 10 });
    const report = validateProjectMachining(project());
    expect(report.errors).toBe(0);
    expect(report.validOperations).toBe(report.totalOperations);
  });

  it('Тест 16/49/103: отверстие за границей детали → ERROR', () => {
    const id = makePart(600, 400, 16);
    store().addManualOperation({ partId: id, face: 'front', x: 700, y: 100, diameter: 8, depth: 10 });
    const report = validateProjectMachining(project());
    expect(report.errors).toBeGreaterThan(0);
    // Сообщение адресовано человеку, а не отладчику (§96).
    const message = report.issues.find((i) => i.severity === 'error')!.message;
    expect(message).toMatch(/границ|предел|выходит/i);
    expect(message).not.toMatch(/at |Error:|stack/i);
  });

  it('Тест 17/48/104: глубина больше толщины у глухого → ERROR', () => {
    const id = makePart(600, 400, 16);
    // Модель такую операцию не принимает (этап 38) — портим копию проекта,
    // как если бы она пришла из файла.
    const broken = brokenProjectWithOperation(id, { diameter: 8, depth: 20, through: false });
    expect(validateProjectMachining(broken).errors).toBeGreaterThan(0);

    // Сквозное отверстие той же глубины ошибкой не является.
    const clean = makePart(600, 400, 16);
    store().addManualOperation({ partId: clean, face: 'front', x: 100, y: 100, diameter: 8, depth: 16, through: true });
    expect(validateProjectMachining(project()).errors).toBe(0);
  });

  it('Тест 15/47: нулевой диаметр и глубина — ошибка', () => {
    const id = makePart();
    // Через модель нулевой диаметр не проходит (этап 38); проверяем данные из файла.
    const broken = brokenProjectWithOperation(id, { diameter: 0, depth: 10, through: false });
    expect(validateProjectMachining(broken).errors).toBeGreaterThan(0);
  });

  it('Тест 15/95: отчёт различает годные операции и проблемные', () => {
    const id = makePart(600, 400, 16);
    store().addManualOperation({ partId: id, face: 'front', x: 100, y: 100, diameter: 8, depth: 10 });
    store().addManualOperation({ partId: id, face: 'front', x: 900, y: 100, diameter: 8, depth: 10 });
    const report = validateProjectMachining(project());
    expect(report.totalOperations).toBe(2);
    expect(report.validOperations).toBe(1);
    expect([...report.statuses.values()].filter((s) => s === 'ERROR')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Присадка 23 — ручные операции, override, пересчёт', () => {
  it('Тест 28/31/32/33: ручная операция создаётся и правится', () => {
    const id = makePart();
    const opId = store().addManualOperation({ partId: id, face: 'front', x: 50, y: 50, diameter: 8, depth: 10 });
    expect(store().updateManualOperation(opId, { diameter: 10, depth: 12 })).toBe(true);
    const op = opsOf(id).find((o) => o.id === opId)!;
    expect(op.diameter).toBe(10);
    expect(op.depth).toBe(12);
    // Несуществующая операция честно сообщает о неудаче.
    expect(store().updateManualOperation('нет' as MachiningId, { depth: 5 })).toBe(false);
  });

  it('Тест 28: сквозная правка пересчитывает глубину по толщине', () => {
    const id = makePart(600, 400, 16);
    const opId = store().addManualOperation({ partId: id, face: 'front', x: 50, y: 50, diameter: 8, depth: 5 });
    store().updateManualOperation(opId, { through: true });
    expect(opsOf(id).find((o) => o.id === opId)!.depth).toBe(16);
  });

  it('Тест 4/5/6/7: паз, карман, вырез и фрезеровка через store', () => {
    const id = makePart();
    for (const kind of ['groove', 'pocket', 'cutout', 'mill'] as const) {
      const opId = store().addShapeOperation({ partId: id, face: 'front', kind, x: 20, y: 20 });
      expect(opId).toBeTruthy();
    }
    const types = opsOf(id).map((o) => o.type).sort();
    expect(types).toEqual(['cutout', 'groove', 'mill', 'pocket']);
    // Несуществующая деталь операции не порождает.
    expect(store().addShapeOperation({ partId: 'нет' as PartId, face: 'front', kind: 'groove', x: 0, y: 0 })).toBeNull();
  });

  it('Тест 29/41/107: ручная операция переживает изменение детали', () => {
    const id = makePart(600, 400, 16);
    const opId = store().addManualOperation({ partId: id, face: 'front', x: 50, y: 50, diameter: 8, depth: 10 });
    store().updatePart(id, { width: 900 });
    const op = opsOf(id).find((o) => o.id === opId);
    expect(op).toBeDefined();
    expect(op!.x).toBe(50); // ручные координаты никто не переписывает
  });

  it('Тест 29/40/108: автоматическая операция пересчитывается', () => {
    makeCabinet();
    const before = generateMachining(project());
    expect(before.length).toBeGreaterThan(0);
    const side = allParts(project()).find((p) => p.role === 'side')!;
    const beforeIds = before.map((o) => String(o.id)).sort();

    store().updatePart(side.id, { height: 2200 });
    const after = generateMachining(project());
    // Идентификаторы стабильны, а координаты пересчитались (§38/§40).
    expect(after.map((o) => String(o.id)).sort()).toEqual(beforeIds);
    expect(after.map((o) => o.y).join()).not.toBe(before.map((o) => o.y).join());
  });

  it('Тест 30/36/109: override сохраняет источник и помечает правку', () => {
    makeCabinet();
    const op = generateMachining(project())[0];
    store().setOperationOverride(op.id, { x: op.x + 25 });
    const patched = generateMachining(project()).find((o) => o.id === op.id)!;
    expect(patched.x).toBe(op.x + 25);
    expect(patched.override).toBe(true);
    // §36: источник остаётся правилом, добавляется лишь признак правки.
    expect(patched.origin).toBe('generated');
  });

  it('Тест 31/37/110: сброс правки возвращает расчётное значение', () => {
    makeCabinet();
    const op = generateMachining(project())[0];
    const original = op.x;
    store().setOperationOverride(op.id, { x: original + 25 });
    store().resetOperationToRule(op.id);
    expect(generateMachining(project()).find((o) => o.id === op.id)!.x).toBe(original);
  });

  it('Тест 33/79/115: атомарный пересчёт сохраняет прежний набор при ошибке', () => {
    const id = makePart(600, 400, 16);
    store().addManualOperation({ partId: id, face: 'front', x: 100, y: 100, diameter: 8, depth: 10 });
    const good = allOperations(project());
    expect(regenerate(project(), good).ok).toBe(true);

    // Ломаем данные: операция за пределами детали.
    store().addManualOperation({ partId: id, face: 'front', x: 5000, y: 100, diameter: 8, depth: 10 });
    const outcome = regenerate(project(), good);
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.length).toBeGreaterThan(0);
    // §80: прежний корректный набор не потерян.
    expect(outcome.operations).toEqual(good);
  });

  it('Тест 34/80: действие пересчёта не стирает технологию при ошибке', () => {
    const id = makePart(600, 400, 16);
    store().addManualOperation({ partId: id, face: 'front', x: 100, y: 100, diameter: 8, depth: 10 });
    store().addManualOperation({ partId: id, face: 'front', x: 5000, y: 100, diameter: 8, depth: 10 });
    const before = opsOf(id).length;

    const res = store().regenerateMachining();
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(opsOf(id).length).toBe(before);
  });

  it('Тест 35/36/114: undo и redo ручной операции', () => {
    const id = makePart();
    expect(opsOf(id)).toHaveLength(0);
    store().addManualOperation({ partId: id, face: 'front', x: 50, y: 50, diameter: 8, depth: 10 });
    expect(opsOf(id)).toHaveLength(1);
    store().undo();
    expect(opsOf(id)).toHaveLength(0);
    store().redo();
    expect(opsOf(id)).toHaveLength(1);
  });

  it('Тест 37/116: расчёт детерминирован', () => {
    makeCabinet();
    const norm = (ops: MachiningOperation[]) =>
      sortOperations(ops).map((o) => `${o.id}@${o.x},${o.y},${o.diameter ?? ''},${o.depth ?? ''}`);
    expect(norm(generateMachining(project()))).toEqual(norm(generateMachining(project())));
  });

  it('Тест 38/39/82: результат хранит версию и снимок профиля', () => {
    makeCabinet();
    const side = allParts(project()).find((p) => p.role === 'side')!;
    const result = machiningResultFor(project(), side);
    expect(result.partId).toBe(side.id);
    expect(result.version).toBe(MACHINING_RULE_VERSION);
    expect(result.generatedAt).toBeTruthy();
    expect(result.profileSnapshot).toBeTruthy();
    expect(result.operations.length).toBeGreaterThan(0);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Присадка 23 — интеграции и экспорт', () => {
  beforeEach(() => makeCabinet());

  it('Тест 22/111: операции переводятся в мировые координаты для 3D', () => {
    const ops = allOperations(project()).slice(0, 20);
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      const p = findPart(project(), op.partId)!;
      const world = operationWorld(p, op.face, op.x, op.y);
      expect(Number.isFinite(world.position.x)).toBe(true);
      expect(Number.isFinite(world.position.y)).toBe(true);
      expect(Number.isFinite(world.position.z)).toBe(true);
      // Направление сверления — единичный вектор.
      const n = world.inward;
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 6);
    }
  });

  it('Тест 23/67/112: чертёж детали показывает отверстия и размеры', () => {
    const doc = buildPartsDocument(project());
    const withOps = partsWithMachining(project());
    expect(withOps.length).toBeGreaterThan(0);
    const page = doc.pages.find((p) => String(p.partId) === String(withOps[0].id))!;
    expect(page.scene.prims.some((pr) => pr.kind === 'circle')).toBe(true);
    const svg = renderPageSvg(page);
    expect(svg).toContain('<circle');
    // §69: чертёж берёт операции из модели, а не рисует свою геометрию.
    expect(svg).toContain('<line');
  });

  it('Тест 24/70: раскрой знает, у каких деталей есть присадка', () => {
    const report = runCutting(project());
    const placed = new Set(report.jobs.flatMap((j) => j.sheets.flatMap((s) => s.placements.map((p) => String(p.partId)))));
    const withOps = partsWithMachining(project()).map((p) => String(p.id));
    // Хотя бы часть деталей с присадкой действительно раскраивается.
    expect(withOps.some((id) => placed.has(id))).toBe(true);
  });

  it('Тест 18/71/72/73/74: связи операция ↔ деталь ↔ фурнитура', () => {
    const side = allParts(project()).find((p) => p.role === 'side')!;
    const ops = operationsOfPart(project(), String(side.id));
    expect(ops.length).toBeGreaterThan(0);

    const op = ops[0];
    expect(partOfOperation(project(), op)?.id).toBe(side.id);
    // §74: у операции от правила есть фурнитура.
    if (op.hardwareId) {
      expect(operationsOfHardware(project(), op.hardwareId).some((o) => String(o.id) === String(op.id))).toBe(true);
    }
  });

  it('Тест 26/87/88: machining.csv с колонками задания', () => {
    const csv = csvExporter.export(project(), allOperations(project()));
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Part ID,Operation ID,Type,Tool,Diameter,Depth,X,Y,Face,Source,Status');
    expect(lines.length - 1).toBe(allOperations(project()).length);
  });

  it('Тест 27/86: machining.json пригоден для обратного чтения', () => {
    const json = jsonExporter.export(project(), allOperations(project()));
    const parsed = JSON.parse(json) as { format: string; ruleVersion: string; parts: unknown[] };
    expect(parsed.format).toBe('karkas-machining');
    expect(parsed.ruleVersion).toBe(MACHINING_RULE_VERSION);
    expect(parsed.parts.length).toBe(allParts(project()).length);

    const back = importMachining(json);
    expect(back.ok).toBe(true);
    expect(back.operations.length).toBe(allOperations(project()).length);
    expect(back.skipped).toBe(0);
  });

  it('Тест 27/91/92/93: экспортёры зарегистрированы, G-code не выдумывается', () => {
    const ids = machineExporters().map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['json', 'csv']));
    // §93: постпроцессора нет — и «G-code» не притворяется существующим.
    expect(ids).not.toContain('gcode');
    expect(getMachineExporter('json')?.extension).toBe('json');
    expect(getMachineExporter('нет')).toBeUndefined();
    expect(() => exportMachining(project(), 'нет')).toThrow();
    expect(exportMachining(project(), 'csv').split('\n')[0]).toContain('Operation ID');
  });

  it('Тест 27/94: импорт мусора не роняет программу', () => {
    expect(importMachining('не json').ok).toBe(false);
    expect(importMachining('{}').ok).toBe(false);
    const partial = importMachining(JSON.stringify({
      parts: [
        { id: 'p1', operations: [{ face: 'front', x: 10, y: 20, diameter: 8, depth: 5 }, { face: 'front' }] },
        'мусор',
      ],
    }));
    expect(partial.ok).toBe(true);
    expect(partial.operations).toHaveLength(1);
    expect(partial.skipped).toBe(2);
  });

  it('Тест 25/89/90: присадка попадает в производственные документы', () => {
    expect(buildDocument(project(), 'machiningList')).toBeTruthy();
    const doc = buildDocument(project(), 'machiningList')!;
    expect(doc.pages.length).toBeGreaterThan(0);
    for (const page of doc.pages) expect(page.scene.prims.length).toBeGreaterThan(0);
    expect(store().generateDocuments().ok).toBe(true);
  });

  it('Тест 32/76/77: состояние детали для производства', () => {
    /* Боковина шкафа получает WARNING: сквозной конфирмат по центру 16 мм
     * панели даёт отступ 4.5 мм при профильном минимуме 8 мм. Это намеренное
     * решение этапа 15 — общепринятая практика, поэтому предупреждение, а не
     * ошибка. Деталь при этом изготовима. */
    const side = allParts(project()).find((p) => p.role === 'side')!;
    expect(partStatus(project(), String(side.id))).toBe('WARNING');
    expect(validateProjectMachining(project(), operationsOfPart(project(), String(side.id))).errors).toBe(0);

    // Деталь без присадки — тоже готова: «нет операций» не ошибка.
    const plain = store().addPart({ name: 'Без присадки', width: 300, height: 200, material: project().materials[0].id });
    expect(partStatus(project(), String(plain))).toBe('READY');

    // Явно устаревшая — OUTDATED.
    expect(partStatus(project(), String(side.id), true)).toBe('OUTDATED');

    // Ошибочная операция переводит деталь в ERROR.
    store().addManualOperation({ partId: plain, face: 'front', x: 5000, y: 10, diameter: 8, depth: 5 });
    expect(partStatus(project(), String(plain))).toBe('ERROR');
  });

  it('Тест 19/117: присадка разделена по деталям', () => {
    const byPart = new Map<string, number>();
    for (const op of allOperations(project())) {
      byPart.set(String(op.partId), (byPart.get(String(op.partId)) ?? 0) + 1);
    }
    expect(byPart.size).toBeGreaterThan(1);
    for (const [partId, count] of byPart) {
      expect(findPart(project(), partId as PartId)).toBeDefined();
      expect(operationsOfPart(project(), partId)).toHaveLength(count);
    }
  });

  it('Тест 98: проект без новых полей открывается', () => {
    const raw = JSON.parse(JSON.stringify(project())) as Project;
    for (const f of raw.furnitures) {
      for (const a of f.assemblies) {
        for (const p of a.parts) {
          for (const op of p.machining) {
            delete (op as Partial<MachiningOperation>).source;
            delete (op as Partial<MachiningOperation>).toolType;
            delete (op as Partial<MachiningOperation>).status;
          }
        }
      }
    }
    const restored = deserializeProject(JSON.stringify(raw));
    expect(allOperations(restored).length).toBeGreaterThan(0);
    expect(validateProjectMachining(restored).errors).toBe(0);
  });

  it('Тест 40/118: полная регрессия по цепочке', () => {
    expect(allParts(project()).length).toBeGreaterThan(0);
    expect(project().hardware.length).toBeGreaterThan(0);
    expect(project().hardwareConnections.length).toBeGreaterThan(0);
    expect(allOperations(project()).length).toBeGreaterThan(0);
    expect(runCutting(project()).jobs.length).toBeGreaterThan(0);
    expect(store().generateDocuments().ok).toBe(true);
    expect(validateProjectMachining(project()).errors).toBe(0);
  });
});
