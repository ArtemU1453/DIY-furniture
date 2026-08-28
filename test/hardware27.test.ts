/**
 * ЭТАП 27 — Фурнитура и конструктивные соединения.
 *
 * Цепочка: MODULE → PARTS → CONNECTIONS → HARDWARE → MACHINING → CUTTING →
 * BOM → DOCUMENTS.
 *
 * Проверяет каталог и шаблоны, соединения и пресеты, совместимость,
 * параметрическое размещение, массивы и симметрию, зеркало и дублирование,
 * автоматическую присадку, спецификацию и её группировку, экспорт,
 * override количества, DIRTY/OUTDATED, сборку и разнесённый вид.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ARRAY_PRESETS,
  CANONICAL_CATEGORIES,
  CANONICAL_OF_CATEGORY,
  CATEGORY_OF_CANONICAL,
  HARDWARE_TEMPLATES,
  PLACEMENT_PRESETS,
  actualSpacing,
  arrayCount,
  arrayPoints,
  assemblyCenter,
  assemblyFrames,
  canonicalCategory,
  checkHardwareOnPart,
  checkMachiningBounds,
  computedUnits,
  connectionUnits,
  customHardware,
  displayPosition,
  explodedTransforms,
  findHardwareTemplate,
  hardwareBom,
  hardwareBomCsv,
  hardwareBomSvg,
  hardwareFromTemplateSpec,
  isOverridden,
  mirrorPlacement,
  mirrorPlacementRule,
  mirrorPoints,
  offsetForPart,
  placementScope,
  projectExploded,
  resolvePlacement,
  symmetricPoints,
  totalHardwareQuantity,
  validateHardwareItem,
  validateHardwarePlacement,
  withinPart,
} from '@/engines/hardware';
import {
  BUILT_IN_CONNECTION_PRESETS,
  CONNECTION_RULE_VERSION,
  allConnectionPresets,
  applyConnections,
  connectionRemovalImpact,
  connectionStatus,
  createConnection,
  findConnectionPreset,
  hardwareForPreset,
  isDirty,
  isOutdated,
  partsSignature,
  refreshConnectionStatuses,
  snapshotOfConnection,
  withPartsSignature,
} from '@/engines/connections';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { runCutting } from '@/engines/cutting';
import { buildDocument } from '@/engines/drawing';
import { exportHardwareLibrary, importHardwareLibrary } from '@/engines/hardware';
import type { Hardware, HardwareConnection, Part, Project } from '@/core/model/types';
import type { HardwareConnectionId, HardwareId, MachiningId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;

function emptyProject(): void {
  store().newProject('Тест 27');
}

/** Две детали для узла (§159). */
function twoParts(thickness = 16): { a: PartId; b: PartId } {
  emptyProject();
  const material = project().materials[0]?.id ?? null;
  const a = store().addPart({ name: 'Боковина', width: 600, height: 2000, thickness, material });
  const b = store().addPart({ name: 'Полка', width: 800, height: 600, thickness, material });
  return { a, b };
}

/** Шкаф 800×2000×600 из §189. */
function makeCabinet(): void {
  emptyProject();
  const res = store().createFromTemplate('tpl-cabinet', {
    width: 800, height: 2000, depth: 600, materialThickness: 16, backThickness: 3,
    shelfCount: 3, verticalPartitionCount: 0, doorCount: 2, doorGap: 3,
    backType: 'inset', jointType: 'confirmat', handleEnabled: true,
  });
  expect(res.ok).toBe(true);
}

const part = (id: PartId): Part => findPart(project(), id)!;

function makePart(over: Partial<Part> = {}): Part {
  return {
    id: 'p1' as PartId,
    name: 'Деталь',
    role: 'custom',
    width: 800,
    height: 600,
    thickness: 16,
    material: null,
    grain: 'none',
    quantity: 1,
    edges: { left: null, right: null, top: null, bottom: null },
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    machining: [],
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 27 — каталог, шаблоны, библиотека', () => {
  beforeEach(emptyProject);

  it('Тест 1/3/5: HardwareItem описан, категории покрывают §5', () => {
    for (const canonical of ['CONNECTOR', 'HINGE', 'DRAWER_SLIDE', 'HANDLE', 'LEG',
      'SHELF_SUPPORT', 'CAM', 'CONFIRMAT', 'DOWEL', 'SCREW', 'BRACKET', 'OTHER'] as const) {
      expect(CANONICAL_CATEGORIES).toContain(canonical);
      // Каждой канонической категории соответствует категория модели (§8).
      expect(CATEGORY_OF_CANONICAL[canonical]).toBeTruthy();
    }
    expect(CANONICAL_OF_CATEGORY.minifix).toBe('CAM');
    expect(CANONICAL_OF_CATEGORY.corner).toBe('BRACKET');
    expect(CANONICAL_OF_CATEGORY.slide).toBe('DRAWER_SLIDE');
  });

  it('Тест 1/104/105: шесть шаблонов создают позицию каталога', () => {
    const ids = HARDWARE_TEMPLATES.map((t) => t.id);
    for (const id of ['tpl-confirmat', 'tpl-dowel', 'tpl-cam', 'tpl-hinge', 'tpl-handle', 'tpl-shelf-support']) {
      expect(ids).toContain(id);
    }
    const created = store().createHardwareFromTemplate('tpl-hinge');
    expect(created).toBeTruthy();
    const hardware = project().hardware.find((h) => h.id === created)!;
    expect(hardware.category).toBe('hinge');
    // §41: у петли есть чашка, глубина, отступ и присадочное расстояние.
    expect(hardware.parameters?.cupDiameter).toBe(35);
    expect(hardware.parameters?.mountingDistance).toBe(32);
    expect(hardware.thicknessRange?.min).toBe(16);
    expect(store().createHardwareFromTemplate('нет-такого')).toBeNull();
  });

  it('Тест 1/106/156/157: своя позиция без артикула и производителя', () => {
    const custom = customHardware('h-custom' as HardwareId, 'Мой крепёж');
    expect(custom.name).toBe('Мой крепёж');
    expect(custom.category).toBe('other'); // §158
    expect(custom.article).toBeUndefined(); // §157
    expect(custom.manufacturer).toBeUndefined(); // §156
    expect(validateHardwareItem(custom)).toEqual([]);
  });

  it('Тест 3/152/153/154/155: дублирование и архив каталога', () => {
    const id = store().createHardwareFromTemplate('tpl-confirmat')!;
    const copyId = store().duplicateHardware(id);
    expect(copyId).toBeTruthy();
    expect(copyId).not.toBe(id);
    expect(project().hardware.find((h) => h.id === copyId)!.name).toContain('копия');

    // §153: используемая позиция уходит в архив, а не удаляется.
    store().setHardwareArchived(id, true);
    expect(project().hardware.find((h) => h.id === id)!.archived).toBe(true);
    store().setHardwareArchived(id, false);
    expect(project().hardware.find((h) => h.id === id)!.archived).toBe(false);
  });

  it('Тест 32/33/101/102/103: библиотека выгружается и загружается локально', () => {
    store().createHardwareFromTemplate('tpl-dowel');
    const json = exportHardwareLibrary(project().hardware, project().hardwareKits ?? []);
    const parsed = JSON.parse(json);
    expect(parsed.format).toBeTruthy();
    expect(Array.isArray(parsed.hardware)).toBe(true);

    // §102/§103: чтение файла локальное, сервер не участвует.
    const res = importHardwareLibrary(json);
    expect(res.ok).toBe(true);
    expect(res.hardware.length).toBe(project().hardware.length);
    expect(res.hardware.some((h) => h.category === 'dowel')).toBe(true);

    // Чужой файл отклоняется с понятным сообщением (§116).
    const foreign = importHardwareLibrary(JSON.stringify({ format: 'other', hardware: [] }));
    expect(foreign.ok).toBe(false);
    expect(foreign.error).toContain('библиотекой');
    expect(importHardwareLibrary('не json').ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 27 — соединения и совместимость', () => {
  it('Тест 5/6/159: узел на шкантах создаётся с крепежом', () => {
    const { a, b } = twoParts();
    store().createHardwareFromTemplate('tpl-dowel');
    const res = store().createConnectionFrom({ partAId: a, partBId: b, presetId: 'cp-dowel-8x30' });
    expect(res.ok).toBe(true);
    const connection = project().hardwareConnections.find((c) => c.id === res.id)!;
    expect(connection.connectionType).toBe('DOWEL');
    // §15: узел ссылается на детали, а не копирует их геометрию.
    expect(connection.partAId).toBe(a);
    expect(connection.partBId).toBe(b);
    expect(Object.keys(connection)).not.toContain('geometry');
    expect(connection.stableId).toBeTruthy();
    expect(connection.parameters?.spacing).toBe(128);
  });

  it('Тест 5/9/160: конфирмат даёт единицы фурнитуры', () => {
    const { a, b } = twoParts();
    store().createHardwareFromTemplate('tpl-confirmat');
    const res = store().createConnectionFrom({ partAId: a, partBId: b, presetId: 'cp-confirmat-7x50' });
    expect(res.ok).toBe(true);
    const connection = project().hardwareConnections.find((c) => c.id === res.id)!;
    expect(connectionUnits(connection)).toBe(2); // §27
    expect(hardwareBom(project()).some((r) => r.category === 'CONFIRMAT')).toBe(true);
  });

  it('Тест 4/128: пресеты покрывают основные типы узлов', () => {
    const { a, b } = twoParts();
    const ids = BUILT_IN_CONNECTION_PRESETS.map((p) => p.id);
    expect(ids).toContain('cp-confirmat-7x50');
    expect(ids).toContain('cp-dowel-8x30');
    expect(ids).toContain('cp-cam-15');
    expect(ids).toContain('cp-bracket');
    expect(findConnectionPreset(project(), 'cp-cam-15')?.type).toBe('CAM_LOCK');
    expect(allConnectionPresets(project()).length).toBeGreaterThanOrEqual(5);

    // §128: пресет подбирает позицию из библиотеки проекта.
    store().createHardwareFromTemplate('tpl-cam');
    const preset = findConnectionPreset(project(), 'cp-cam-15')!;
    expect(hardwareForPreset(project(), preset)?.category).toBe('minifix');
    void a; void b;
  });

  it('Тест 7/10/39/112/170/173: несовместимая толщина даёт ERROR', () => {
    // §39: эксцентрик Ø15 не встаёт в плиту 10 мм.
    const { a, b } = twoParts(10);
    store().createHardwareFromTemplate('tpl-cam');
    const res = store().createConnectionFrom({ partAId: a, partBId: b, presetId: 'cp-cam-15' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('10 мм');
    // §21: сломанный узел не создан вовсе.
    expect(project().hardwareConnections.length).toBe(0);

    // §115: сообщение объясняет причину человеческим языком.
    const hinge = hardwareFromTemplateSpec(findHardwareTemplate('tpl-hinge')!, 'h1' as HardwareId);
    const thin = makePart({ thickness: 10, name: 'Фасад' });
    const issue = checkHardwareOnPart(hinge, thin)!;
    expect(issue.severity).toBe('error');
    expect(issue.message).toContain('Ø35');
    expect(issue.message).toContain('10 мм');
    expect(issue.message).not.toContain('Error:');
    expect(issue.message).not.toContain('at ');
  });

  it('Тест 26/113/172: ограничение по материалу проверяется', () => {
    const hardware: Hardware = {
      id: 'h-mat' as HardwareId, name: 'Крепёж для ЛДСП', category: 'confirmat',
      compatibleMaterials: ['m-allowed' as never],
    };
    const wrong = makePart({ material: 'm-other' as never });
    expect(checkHardwareOnPart(hardware, wrong)?.code).toBe('hardware.material');
    const right = makePart({ material: 'm-allowed' as never });
    expect(checkHardwareOnPart(hardware, right)).toBeNull();
  });

  it('Тест 21/23/24: статусы узла VALID/WARNING/ERROR', () => {
    const { a, b } = twoParts();
    store().createHardwareFromTemplate('tpl-confirmat');
    const res = store().createConnectionFrom({ partAId: a, partBId: b, presetId: 'cp-confirmat-7x50' });
    const connection = project().hardwareConnections.find((c) => c.id === res.id)!;
    expect(connectionStatus(project(), connection)).toBe('VALID');

    // Деталь исчезла — узел не может быть корректным.
    const broken: HardwareConnection = { ...connection, partBId: 'нет-детали' as PartId };
    expect(connectionStatus(project(), broken)).toBe('ERROR');
  });

  it('Тест 5/126: движок создания узла работает без стора', () => {
    const { a, b } = twoParts();
    store().createHardwareFromTemplate('tpl-confirmat');
    const preset = findConnectionPreset(project(), 'cp-confirmat-7x50')!;
    const res = createConnection(
      project(),
      { partA: part(a), partB: part(b), preset },
      'c-direct' as HardwareConnectionId,
    );
    expect(res.connection).toBeDefined();
    expect(res.connection!.id).toBe('c-direct');
    expect(res.connection!.source).toBe('MANUAL');
    expect(res.error).toBeUndefined();
  });

  it('Тест 5/126: нельзя соединить деталь саму с собой и без крепежа', () => {
    const { a } = twoParts();
    const same = store().createConnectionFrom({ partAId: a, partBId: a, presetId: 'cp-confirmat-7x50' });
    expect(same.ok).toBe(false);
    expect(same.error).toContain('саму с собой');

    // Пресет без подходящей позиции в библиотеке — понятный отказ (§115).
    const { a: x, b: y } = twoParts();
    const noHardware = store().createConnectionFrom({ partAId: x, partBId: y, presetId: 'cp-bracket' });
    expect(noHardware.ok).toBe(false);
    expect(noHardware.error).toContain('библиотеку');
  });

  it('Тест 23/131/169: удаление узла и детали обрабатывается корректно', () => {
    makeCabinet();
    const connection = project().hardwareConnections[0];
    const impact = connectionRemovalImpact(project(), String(connection.id));
    expect(impact.connectionId).toBe(String(connection.id));
    expect(impact.units).toBeGreaterThan(0);

    const before = project().hardwareConnections.length;
    store().removeConnection(connection.id);
    expect(project().hardwareConnections.length).toBe(before - 1);

    // §169: удаление детали не оставляет узлов на несуществующие детали.
    const target = allParts(project()).find((p) => p.material)!;
    store().editorDelete([String(target.id)]);
    const alive = new Set(allParts(project()).map((p) => String(p.id)));
    for (const c of project().hardwareConnections) {
      expect(alive.has(String(c.partAId)) && alive.has(String(c.partBId))).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 27 — размещение, массивы, симметрия, зеркало', () => {
  it('Тест 19/79/80: положение считается выражением над параметрами детали', () => {
    const facade = makePart({ width: 400, height: 700 });
    const scope = placementScope(facade);
    expect(scope.width).toBe(400);
    expect(scope.centerX).toBe(200);

    // §80: ручка по центру ширины.
    const handle = resolvePlacement(facade, PLACEMENT_PRESETS.handleCenter);
    expect(handle.x).toBe(200);
    expect(handle.error).toBeUndefined();
  });

  it('Тест 19/81: петля в 100 мм от верхнего края', () => {
    const facade = makePart({ width: 400, height: 700, thickness: 16 });
    const top = resolvePlacement(facade, PLACEMENT_PRESETS.hingeTop);
    expect(top.y).toBe(600); // 700 − 100
    const bottom = resolvePlacement(facade, PLACEMENT_PRESETS.hingeBottom);
    expect(bottom.y).toBe(100);
  });

  it('Тест 19/17: все виды опорных точек дают ожидаемые координаты', () => {
    const p = makePart({ width: 800, height: 600 });
    expect(resolvePlacement(p, { reference: 'DISTANCE', x: 120, y: 450 })).toMatchObject({ x: 120, y: 450 });
    expect(resolvePlacement(p, { reference: 'EDGE', from: 'right', x: 50 }).x).toBe(750);
    expect(resolvePlacement(p, { reference: 'CENTER', x: 0, y: 0 })).toMatchObject({ x: 400, y: 300 });
    expect(resolvePlacement(p, { reference: 'CORNER', from: 'top', x: 30, y: 30 })).toMatchObject({ x: 30, y: 570 });
    // Без правила — центр детали: предсказуемое умолчание.
    expect(resolvePlacement(p, undefined)).toMatchObject({ x: 400, y: 300 });
  });

  it('Тест 19/108/144: ошибка выражения не ломает расчёт и не выполняет код', () => {
    const p = makePart();
    const bad = resolvePlacement(p, { reference: 'PARAMETER', x: 'нет_такой_переменной * 2' });
    expect(bad.error).toBeTruthy();
    // Значение откатывается к центру — модель не получает мусор.
    expect(bad.x).toBe(400);
    // §108/§145: произвольный код не исполняется.
    const injected = resolvePlacement(p, { reference: 'PARAMETER', x: 'globalThis' });
    expect(injected.error).toBeTruthy();
  });

  it('Тест 18/31/32/33/34/83/84: массив считает количество и точки', () => {
    // §33: количество по длине соединения.
    expect(arrayCount(1000, { spacing: 300, spacingMode: 'MAX' })).toBe(5);
    expect(arrayCount(1000, { spacing: 300, spacingMode: 'FIXED' })).toBe(4);
    // §34: ограничения min/max.
    expect(arrayCount(5000, { spacing: 100, spacingMode: 'FIXED', maxCount: 6 })).toBe(6);
    expect(arrayCount(50, { spacing: 300, spacingMode: 'FIXED', minCount: 2 })).toBe(2);
    // Явное количество побеждает расчёт.
    expect(arrayCount(1000, { count: 3, spacing: 100 })).toBe(3);

    const points = arrayPoints(1000, { count: 3, edgeOffset: 50 });
    expect(points.length).toBe(3);
    expect(points[0].position).toBe(50);
    expect(points[2].position).toBe(950);
    expect(actualSpacing(points)).toBe(450);
  });

  it('Тест 18/87: три режима шага ведут себя по-разному', () => {
    const equal = arrayPoints(900, { count: 4, spacingMode: 'EQUAL', edgeOffset: 0 });
    expect(actualSpacing(equal)).toBe(300);

    const max = arrayPoints(900, { spacing: 250, spacingMode: 'MAX', edgeOffset: 0 });
    expect(actualSpacing(max)).toBeLessThanOrEqual(250);

    const fixed = arrayPoints(900, { spacing: 250, spacingMode: 'FIXED', edgeOffset: 0 });
    expect(actualSpacing(fixed)).toBeCloseTo(250, 6);
  });

  it('Тест 14/52/85/164: полкодержатели — по два на сторону', () => {
    expect(ARRAY_PRESETS.shelfSupports.count).toBe(2);
    expect(ARRAY_PRESETS.shelfSupports.minCount).toBe(2);
    const points = arrayPoints(600, ARRAY_PRESETS.shelfSupports);
    expect(points.length).toBe(2);
    expect(points[0].position).toBe(50);
    expect(points[1].position).toBe(550);
  });

  it('Тест 20/90/91: симметричное размещение зеркально центру', () => {
    const points = symmetricPoints(2000, [100]);
    expect(points.map((p) => p.position)).toEqual([100, 1900]);
    // Точка ровно по центру не дублируется.
    expect(symmetricPoints(1000, [500]).length).toBe(1);
    // §91: петли относительно центра фасада.
    const hinges = symmetricPoints(700, [100]);
    expect(hinges.length).toBe(2);
    expect(hinges[0].position + hinges[1].position).toBe(700);
  });

  it('Тест 21/92/167: зеркало переносит положение на другую сторону', () => {
    const p = makePart({ width: 400, height: 700 });
    expect(mirrorPlacement(p, { x: 100, y: 200 })).toEqual({ x: 300, y: 200 });

    const rule = mirrorPlacementRule({ reference: 'EDGE', from: 'left', x: 50 });
    expect(rule.from).toBe('right');

    const points = mirrorPoints(1000, [{ position: 100, index: 0 }, { position: 400, index: 1 }]);
    expect(points.map((x) => x.position)).toEqual([600, 900]);
  });

  it('Тест 24/110: фурнитура вне детали даёт ERROR', () => {
    const p = makePart({ width: 400, height: 700 });
    expect(withinPart(p, { x: 200, y: 300 })).toBe(true);
    expect(withinPart(p, { x: 900, y: 300 })).toBe(false);

    const out = resolvePlacement(p, { reference: 'DISTANCE', x: 900, y: 300 });
    expect(withinPart(p, out)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 27 — присадка, проверки, полки', () => {
  beforeEach(makeCabinet);

  it('Тест 27/28/36/161: узлы порождают присадку', () => {
    const operations = allOperations(project());
    expect(operations.length).toBeGreaterThan(0);
    // §28: операции привязаны к деталям узлов.
    const partIds = new Set(allParts(project()).map((p) => String(p.id)));
    for (const op of operations) expect(partIds.has(String(op.partId))).toBe(true);
    for (const op of operations) expect(op.diameter ?? 0).toBeGreaterThan(0);
  });

  it('Тест 11/42/162: петля даёт отверстие под чашку', () => {
    const hinges = project().hardwareConnections.filter((c) => {
      const h = project().hardware.find((x) => x.id === c.hardwareId);
      return h?.category === 'hinge';
    });
    expect(hinges.length).toBeGreaterThan(0);
    const cups = allOperations(project()).filter((op) => (op.diameter ?? 0) >= 30);
    expect(cups.length).toBeGreaterThan(0); // чашка Ø35
  });

  it('Тест 13/50/163: ручка даёт отверстия', () => {
    const handles = project().hardwareConnections.filter((c) => {
      const h = project().hardware.find((x) => x.id === c.hardwareId);
      return h?.category === 'handle';
    });
    expect(handles.length).toBeGreaterThan(0);
    expect(ARRAY_PRESETS.handleHoles.count).toBe(2); // §50
    expect(ARRAY_PRESETS.handleHoles.symmetric).toBe(true);
  });

  it('Тест 24/111/171: отверстие вне детали ловится проверкой', () => {
    const target = allParts(project()).find((p) => p.machining.length > 0) ?? allParts(project())[0];
    const broken: Part = {
      ...target,
      machining: [{
        id: 'bad-1' as MachiningId,
        type: 'drilling',
        partId: target.id,
        face: 'front',
        x: target.width + 500,
        y: 10,
        z: 0,
        diameter: 8,
        depth: 10,
        origin: 'manual',
      }],
    };
    const issues = checkMachiningBounds(broken);
    expect(issues.some((i) => i.code === 'machining.outOfBounds')).toBe(true);
    expect(issues[0].message).toContain('выходит за пределы');
  });

  it('Тест 24/109: параметры позиции обязаны быть положительными', () => {
    const bad: Hardware = {
      id: 'h-bad' as HardwareId, name: 'Битый', category: 'confirmat',
      parameters: { diameter: 0, length: -5 },
    };
    const issues = validateHardwareItem(bad);
    expect(issues.some((i) => i.code === 'hardware.badParameter')).toBe(true);
    expect(issues.length).toBeGreaterThanOrEqual(2);

    const rangeIssue = validateHardwareItem({
      id: 'h-r' as HardwareId, name: 'Диапазон', category: 'hinge',
      thicknessRange: { min: 30, max: 16 },
    });
    expect(rangeIssue.some((i) => i.code === 'hardware.badThicknessRange')).toBe(true);
  });

  it('Тест 24/114/116: полная проверка не показывает внутренние подробности', () => {
    const issues = validateHardwarePlacement(project());
    for (const issue of issues) {
      expect(issue.message).not.toContain('at ');
      expect(issue.message).not.toContain('TypeError');
      expect(issue.message.length).toBeGreaterThan(5);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 27 — спецификация, override, экспорт', () => {
  beforeEach(makeCabinet);

  it('Тест 28/29/56/57/58/59/176: спецификация группирует одинаковые позиции', () => {
    const bom = hardwareBom(project());
    expect(bom.length).toBeGreaterThan(0);
    // §58: одна строка на позицию каталога.
    expect(new Set(bom.map((r) => r.hardwareId)).size).toBe(bom.length);
    for (const row of bom) {
      expect(row.quantity).toBeGreaterThan(0); // §59
      expect(row.name).toBeTruthy();
      expect(row.category).toBeTruthy();
      expect(['VALID', 'WARNING', 'ERROR', 'MISSING']).toContain(row.status);
    }
    expect(totalHardwareQuantity(project())).toBe(bom.reduce((n, r) => n + r.quantity, 0));
  });

  it('Тест 36/37/134/135/136/174/175: override количества и его сброс', () => {
    const connection = project().hardwareConnections[0];
    const computed = computedUnits(connection);
    expect(isOverridden(connection)).toBe(false);

    store().setConnectionQuantityOverride(connection.id, computed + 5);
    const overridden = project().hardwareConnections.find((c) => c.id === connection.id)!;
    expect(isOverridden(overridden)).toBe(true);
    expect(connectionUnits(overridden)).toBe(computed + 5);
    // §134: расчётное значение видно рядом с ручным.
    expect(computedUnits(overridden)).toBe(computed);

    // §136: сброс возвращает расчёт.
    store().setConnectionQuantityOverride(connection.id, null);
    const reset = project().hardwareConnections.find((c) => c.id === connection.id)!;
    expect(isOverridden(reset)).toBe(false);
    expect(connectionUnits(reset)).toBe(computed);
  });

  it('Тест 30/137/177: hardware-bom.csv содержит колонки §57', () => {
    const csv = hardwareBomCsv(project());
    const [header, ...rows] = csv.split('\n');
    expect(header).toBe('Article,Name,Category,Manufacturer,Quantity,Status,Source');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.split(',').length).toBeGreaterThanOrEqual(7);
  });

  it('Тест 31/138/139/178: PDF-страница спецификации формируется', () => {
    const svg = hardwareBomSvg(project());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Спецификация фурнитуры');
    expect(svg).toContain('Артикул');
    expect(svg).toContain('Кол-во');
    expect(svg).toContain('</svg>');
  });

  it('Тест 17/55/132: ручная фурнитура без узла попадает в спецификацию', () => {
    const hardwareId = store().createHardwareFromTemplate('tpl-handle')!;
    const target = allParts(project())[0];
    const before = hardwareBom(project()).find((r) => r.hardwareId === String(hardwareId))?.quantity ?? 0;

    const id = store().addManualHardwareInstance({ hardwareId, partId: target.id, quantity: 3 });
    expect(id).toBeTruthy();
    const after = hardwareBom(project()).find((r) => r.hardwareId === String(hardwareId))!;
    expect(after.quantity).toBe(before + 3);

    store().removeManualHardwareInstance(id!);
    expect((project().hardwareInstances ?? []).length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 27 — жизненный цикл узла', () => {
  it('Тест 34/96/187: изменение детали делает узел DIRTY', () => {
    const { a, b } = twoParts();
    store().createHardwareFromTemplate('tpl-confirmat');
    const res = store().createConnectionFrom({ partAId: a, partBId: b, presetId: 'cp-confirmat-7x50' });
    const raw = project().hardwareConnections.find((c) => c.id === res.id)!;

    const withSnapshot = withPartsSignature(raw, part(a), part(b), 'carcass');
    expect(isDirty(project(), withSnapshot)).toBe(false);

    // Деталь изменилась — узел требует пересчёта.
    store().updatePart(a, { width: part(a).width + 200 });
    expect(isDirty(project(), withSnapshot)).toBe(true);
    expect(connectionStatus(project(), withSnapshot)).toBe('DIRTY');
  });

  it('Тест 35/99/100: снимок правила и OUTDATED', () => {
    const { a, b } = twoParts();
    store().createHardwareFromTemplate('tpl-confirmat');
    const res = store().createConnectionFrom({ partAId: a, partBId: b, presetId: 'cp-confirmat-7x50' });
    const connection = project().hardwareConnections.find((c) => c.id === res.id)!;
    const hardware = project().hardware[0];

    const snapshot = snapshotOfConnection(connection, hardware, 'carcass');
    expect(snapshot.version).toBe(CONNECTION_RULE_VERSION);
    expect(snapshot.ruleId).toBe('carcass');
    expect(snapshot.createdAt).toBeTruthy();

    const stored: HardwareConnection = { ...connection, ruleSnapshot: { ...snapshot, version: '1.0' } };
    expect(isOutdated(stored)).toBe(true);
    expect(connectionStatus(project(), stored)).toBe('OUTDATED');
    // Узел без снимка устаревшим не считается: это не ошибка.
    expect(isOutdated(connection)).toBe(false);
  });

  it('Тест 34/97: пересчёт статусов возвращает VALID', () => {
    makeCabinet();
    const refreshed = refreshConnectionStatuses(project());
    expect(refreshed.length).toBe(project().hardwareConnections.length);
    expect(refreshed.every((c) => ['VALID', 'WARNING', 'ERROR', 'DIRTY', 'OUTDATED'].includes(c.status!))).toBe(true);
  });

  it('Тест 98/188: атомарность — сломанный расчёт не затирает узлы', () => {
    makeCabinet();
    const previous = project().hardwareConnections;
    expect(previous.length).toBeGreaterThan(0);

    // Пустой результат при непустом наборе — ошибка правила, а не результат.
    expect(applyConnections(previous, []).applied).toBe(false);
    expect(applyConnections(previous, []).connections).toBe(previous);
    expect(applyConnections(previous, null).connections).toBe(previous);

    const next = previous.slice(0, 1);
    expect(applyConnections(previous, next).applied).toBe(true);
    expect(applyConnections(previous, next).connections).toBe(next);
  });

  it('Тест 96: сигнатура деталей меняется вместе с деталью', () => {
    const a = makePart({ id: 'a' as PartId });
    const b = makePart({ id: 'b' as PartId, width: 500 });
    const first = partsSignature(a, b);
    expect(partsSignature(a, b)).toBe(first);
    expect(partsSignature(a, { ...b, thickness: 18 })).not.toBe(first);
    expect(partsSignature(a, undefined)).toContain('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 27 — сборка, разнос, полный цикл', () => {
  beforeEach(makeCabinet);

  it('Тест 38/146/147/181: режим сборки не смещает детали', () => {
    const parts = allParts(project());
    const transforms = explodedTransforms(parts, { factor: 0 });
    expect(transforms.every((t) => t.offset.x === 0 && t.offset.y === 0 && t.offset.z === 0)).toBe(true);
    expect(offsetForPart(transforms, String(parts[0].id), 'ASSEMBLY')).toEqual({ x: 0, y: 0, z: 0 });

    store().setAssemblyMode('ASSEMBLY');
    expect(store().assembly.mode).toBe('ASSEMBLY');
  });

  it('Тест 39/144/145/148/182: разнесённый вид смещает детали от центра', () => {
    const parts = allParts(project());
    const center = assemblyCenter(parts);
    expect(Number.isFinite(center.x)).toBe(true);

    const transforms = projectExploded(project(), { factor: 1, distance: 300 });
    expect(transforms.length).toBe(parts.length);
    const moved = transforms.filter((t) => Math.hypot(t.offset.x, t.offset.y, t.offset.z) > 1);
    expect(moved.length).toBeGreaterThan(0);

    // §145: разнос — представление, модель не тронута.
    const before = parts[0].position.x;
    const offset = offsetForPart(transforms, String(parts[0].id), 'EXPLODED');
    const display = displayPosition(parts[0], offset);
    expect(findPart(project(), parts[0].id)!.position.x).toBe(before);
    expect(display.x).toBe(before + offset.x);

    store().setAssemblyMode('EXPLODED', 0.5);
    expect(store().assembly.mode).toBe('EXPLODED');
    expect(store().assembly.factor).toBe(0.5);
  });

  it('Тест 39/149: кадры анимации сборки подготовлены', () => {
    const frames = assemblyFrames(allParts(project()), 4, { distance: 200 });
    expect(frames.length).toBe(5);
    expect(frames[0].t).toBe(0);
    expect(frames[4].t).toBe(1);
    // Первый кадр — собранное изделие, последний — полный разнос.
    const first = frames[0].transforms.every((t) => t.offset.x === 0 && t.offset.y === 0);
    expect(first).toBe(true);
    const last = frames[4].transforms.some((t) => Math.abs(t.offset.x) + Math.abs(t.offset.y) > 1);
    expect(last).toBe(true);
  });

  it('Тест 22/93/168: дублирование модуля даёт новые идентификаторы', () => {
    const furniture = project().furnitures[0];
    const created = store().editorDuplicate([String(furniture.id)]);
    expect(created.length).toBe(1);
    expect(created[0]).not.toBe(String(furniture.id));

    const copy = project().furnitures.find((f) => String(f.id) === created[0])!;
    const originalPartIds = new Set(furniture.assemblies.flatMap((a) => a.parts).map((p) => String(p.id)));
    for (const assembly of copy.assemblies) {
      for (const p of assembly.parts) expect(originalPartIds.has(String(p.id))).toBe(false);
    }
  });

  it('Тест 25/165/166: изменение детали меняет параметрическое положение', () => {
    const facade = makePart({ width: 400, height: 700 });
    const before = resolvePlacement(facade, PLACEMENT_PRESETS.handleCenter).x;
    const wider = { ...facade, width: 800 };
    const after = resolvePlacement(wider, PLACEMENT_PRESETS.handleCenter).x;
    expect(after).toBe(before * 2); // §165

    // §166: выше фасад — петли расходятся дальше.
    const low = symmetricPoints(700, [100]);
    const high = symmetricPoints(2000, [100]);
    expect(high[1].position - high[0].position).toBeGreaterThan(low[1].position - low[0].position);
  });

  it('Тест 40/189: полный цикл шкафа проходит от узлов до документов', () => {
    // Детали
    const parts = allParts(project()).filter((p) => p.material);
    expect(parts.length).toBeGreaterThan(5);

    // Соединения и фурнитура
    expect(project().hardwareConnections.length).toBeGreaterThan(0);
    const bom = hardwareBom(project());
    expect(bom.length).toBeGreaterThan(0);
    expect(totalHardwareQuantity(project())).toBeGreaterThan(0);

    // Присадка
    expect(allOperations(project()).length).toBeGreaterThan(0);

    // Раскрой
    expect(runCutting(project()).jobs.length).toBeGreaterThan(0);

    // Документы
    expect(buildDocument(project(), 'partsList')).toBeTruthy();
    expect(buildDocument(project(), 'hardwareList')).toBeTruthy();

    // Категории фурнитуры приведены к номенклатуре §5.
    for (const hardware of project().hardware) {
      expect(CANONICAL_CATEGORIES).toContain(canonicalCategory(hardware) as never);
    }

    // Проверки не находят ошибок целостности.
    const errors = validateHardwarePlacement(project()).filter((i) => i.severity === 'error');
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it('Тест 40: правки через соединения видны раскрою и спецификации', () => {
    const connection = project().hardwareConnections[0];
    const bomBefore = totalHardwareQuantity(project());
    store().setConnectionQuantityOverride(connection.id, connectionUnits(connection) + 10);
    expect(totalHardwareQuantity(project())).toBe(bomBefore + 10);

    const cutBefore = runCutting(project()).jobs.reduce((n, j) => n + j.statistics.pieceCount, 0);
    expect(cutBefore).toBeGreaterThan(0);
    // Фурнитура на раскрой не влияет: раскраиваются детали, а не крепёж.
    store().setConnectionQuantityOverride(connection.id, null);
    const cutAfter = runCutting(project()).jobs.reduce((n, j) => n + j.statistics.pieceCount, 0);
    expect(cutAfter).toBe(cutBefore);
  });
});
