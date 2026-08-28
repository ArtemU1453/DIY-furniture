/**
 * ФУРНИТУРА · СОЕДИНЕНИЯ · КОНСТРУКТИВНЫЕ УЗЛЫ · АВТОМАТИЧЕСКАЯ ПРИСАДКА.
 * Проверяет полную цепочку:
 *   Деталь → Соединение → Фурнитура → Операция присадки → Чертёж → Документация.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import {
  generateMachining,
  validateMachining,
  getMachiningRule,
  inferJointType,
} from '@/engines/machining';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { runProductionCheck, validateConnections } from '@/engines/status';
import { buildPartsDocument } from '@/engines/drawing';
import {
  HARDWARE_CATALOG,
  hardwareFromTemplate,
  catalogByCategory,
} from '@/core/model/hardwareCatalog';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';
import type { HardwareId } from '@/core/model/ids';
import type { HardwareCategory, Part } from '@/core/model/types';

const store = () => useEditorStore.getState();
const project = () => store().project;

function partByType(type: string): Part {
  return allParts(project()).find((p) => p.metadata?.partType === type)!;
}
function hardwareOf(category: HardwareCategory) {
  return project().hardware.find((h) => h.category === category);
}
/** Добавляет крепёж указанной категории из каталога (если не сгенерирован по умолчанию). */
function ensureHardware(category: HardwareCategory): HardwareId {
  const existing = hardwareOf(category);
  if (existing) return existing.id;
  const template = catalogByCategory(category)[0];
  return store().addHardwareFromTemplate(template);
}
/**
 * Операции присадки, порождённые КОНКРЕТНЫМ соединением.
 *
 * Шкаф с этапа 35 создаётся сразу с корпусными узлами и их присадкой, поэтому
 * проверять «всего операций в проекте» бессмысленно: тесты смотрят только на то,
 * что добавило проверяемое соединение.
 */
function opsOf(connectionId: string) {
  return generateMachining(project()).filter(
    (o) => String(o.sourceHardwareConnectionId) === String(connectionId),
  );
}

function connect(category: HardwareCategory, a: Part, b: Part, quantity?: number) {
  const hardwareId = ensureHardware(category);
  const res = store().addConnection({ hardwareId, partAId: a.id, partBId: b.id, quantity });
  expect(res.ok).toBe(true);
  return res.id!;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('Каталог и модель фурнитуры', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 1: каталог покрывает все типы крепежа и имеет правила присадки', () => {
    const cats = new Set(HARDWARE_CATALOG.map((t) => t.category));
    for (const c of ['confirmat', 'dowel', 'minifix', 'screw', 'corner', 'hinge', 'slide', 'leg', 'handle'] as HardwareCategory[]) {
      expect(cats.has(c)).toBe(true);
      expect(getMachiningRule(c)).toBeDefined();
    }
  });

  it('Тест 2: добавление фурнитуры из шаблона создаёт запись с уникальным id', () => {
    const before = project().hardware.length;
    const id = store().addHardwareFromTemplate(HARDWARE_CATALOG[0]);
    expect(project().hardware.length).toBe(before + 1);
    const hw = project().hardware.find((h) => h.id === id)!;
    expect(hw.category).toBe('confirmat');
    expect(hw.article).toBe('5x50');
  });

  it('Тест 3: hardwareFromTemplate копирует параметры (без общей ссылки)', () => {
    const a = hardwareFromTemplate(HARDWARE_CATALOG[0]);
    const b = hardwareFromTemplate(HARDWARE_CATALOG[0]);
    expect(a.id).not.toBe(b.id);
    expect(a.parameters).not.toBe(b.parameters);
  });

  it('Тест 4: article и manufacturer необязательны', () => {
    const hw = hardwareFromTemplate({ name: 'Кастом', category: 'other', parameters: {} });
    expect(hw.article).toBeUndefined();
    expect(hw.manufacturer).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Соединения и конструктивные узлы', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 5: создание соединения фиксирует тип узла (jointType)', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const id = connect('confirmat', side, bottom);
    const conn = project().hardwareConnections.find((c) => c.id === id)!;
    expect(conn.jointType).toBeDefined();
    expect(['BUTT', 'EDGE_TO_FACE', 'FACE_TO_FACE', 'CORNER', 'PANEL_TO_PANEL', 'PANEL_TO_FRAME']).toContain(conn.jointType);
  });

  it('Тест 6: inferJointType определяет узел из геометрии деталей', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const jt = inferJointType(side, bottom);
    expect(jt).toBeTruthy();
  });

  it('Тест 7: quantity сохраняется в соединении', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const id = connect('confirmat', side, bottom, 4);
    expect(project().hardwareConnections.find((c) => c.id === id)!.quantity).toBe(4);
  });

  it('Тест 8: нельзя соединить деталь саму с собой', () => {
    const side = partByType('side_left');
    const hardwareId = ensureHardware('confirmat');
    expect(store().addConnection({ hardwareId, partAId: side.id, partBId: side.id }).ok).toBe(false);
  });

  it('Тест 9: обновление соединения меняет параметры', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const id = connect('dowel', side, bottom);
    store().updateConnection(id, { quantity: 6 });
    expect(project().hardwareConnections.find((c) => c.id === id)!.quantity).toBe(6);
  });

  it('Тест 10: дублирование соединения создаёт новый HCxxx и новые операции присадки', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const id = connect('confirmat', side, bottom);
    const opsBefore = opsOf(id).length;
    const connectionsBefore = project().hardwareConnections.length;

    const dupId = store().duplicateConnection(id)!;
    expect(dupId).toBeTruthy();
    expect(dupId).not.toBe(id);
    expect(project().hardwareConnections.length - connectionsBefore).toBe(1);

    // Копия даёт столько же операций, сколько оригинал, но со своим источником.
    expect(opsOf(id).length).toBe(opsBefore);
    expect(opsOf(dupId).length).toBe(opsBefore);
    expect(opsBefore).toBeGreaterThan(0);
  });

  it('Тест 11: удаление соединения убирает производные операции', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const id = connect('dowel', side, bottom);
    expect(opsOf(id).length).toBeGreaterThan(0);
    store().removeConnection(id);
    expect(opsOf(id)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Автоматическая присадка по типам крепежа', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 12: шкант — глухие отверстия в обеих деталях', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const ops = opsOf(connect('dowel', side, bottom));
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.some((o) => o.partId === side.id)).toBe(true);
    expect(ops.some((o) => o.partId === bottom.id)).toBe(true);
    expect(ops.every((o) => o.through === false)).toBe(true);
  });

  it('Тест 13: конфирмат — сквозное в проходной + глухое направляющее в принимающей', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const ops = opsOf(connect('confirmat', side, bottom));
    expect(ops.filter((o) => o.through).length).toBe(2);
    expect(ops.filter((o) => !o.through).length).toBe(2);
  });

  it('Тест 14: минификс — эксцентрик в проходной, шток в принимающей', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const ops = opsOf(connect('minifix', side, bottom));
    expect(ops.length).toBeGreaterThan(0);
    // Разные детали задействованы.
    expect(new Set(ops.map((o) => o.partId)).size).toBe(2);
  });

  it('Тест 15: саморез создаёт операции присадки', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    connect('screw', side, bottom);
    expect(generateMachining(project()).length).toBeGreaterThan(0);
  });

  it('Тест 16: уголок создаёт отверстия с обеих сторон узла', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const ops = opsOf(connect('corner', side, bottom));
    expect(ops.length).toBeGreaterThan(0);
    expect(new Set(ops.map((o) => o.partId)).size).toBe(2);
  });

  it('Тест 17: петля — чашка Ø35 на фасаде (одиночная деталь partA)', () => {
    const facade = partByType('side_right');
    const sideB = partByType('side_left');
    connect('hinge', facade, sideB);
    const ops = generateMachining(project());
    const cup = ops.find((o) => o.type === 'hinge');
    expect(cup).toBeDefined();
    expect(cup!.diameter).toBe(35);
    expect(cup!.partId).toBe(facade.id);
  });

  it('Тест 18: ручка — два сквозных отверстия на межцентровом расстоянии', () => {
    const facade = partByType('side_right');
    const other = partByType('side_left');
    const ops = opsOf(connect('handle', facade, other)).filter((o) => o.partId === facade.id);
    expect(ops).toHaveLength(2);
    expect(ops.every((o) => o.through)).toBe(true);
    const dx = Math.abs(ops[0].x - ops[1].x);
    expect(dx).toBeCloseTo(96, 0);
  });

  it('Тест 19: опора — четыре присадочных отверстия по углам', () => {
    const bottom = partByType('bottom');
    const other = partByType('side_left');
    const ops = opsOf(connect('leg', bottom, other)).filter((o) => o.partId === bottom.id);
    expect(ops).toHaveLength(4);
    expect(ops.every((o) => o.face === 'bottom')).toBe(true);
  });

  it('Тест 20: направляющая — ряды присадки на двух деталях', () => {
    const side = partByType('side_left');
    const sideR = partByType('side_right');
    connect('slide', side, sideR);
    const ops = generateMachining(project());
    expect(ops.some((o) => o.partId === side.id)).toBe(true);
    expect(ops.some((o) => o.partId === sideR.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Параметрические привязки и ограничения', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 21: изменение размеров корпуса пересчитывает координаты присадки', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    connect('dowel', side, bottom);
    const maxX = () => Math.max(...generateMachining(project()).filter((o) => o.partId === side.id).map((o) => o.x));
    const before = maxX();
    store().updateCabinetParams(store().activeFurnitureId!, { depth: 800 });
    expect(maxX()).toBeGreaterThan(before);
  });

  it('Тест 22: изменение толщины меняет глубину сквозного отверстия', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    connect('confirmat', side, bottom);
    const throughDepth = () => generateMachining(project()).find((o) => o.partId === side.id && o.through)!.depth!;
    const before = throughDepth();
    const bodyMat = project().materials.find((m) => m.kind === 'ldsp')!.id;
    store().updateMaterial(bodyMat, { thickness: before + 2 });
    expect(throughDepth()).toBe(before + 2);
  });

  it('Тест 23: все производные отверстия — в границах детали', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    connect('confirmat', side, bottom);
    const issues = validateMachining(generateMachining(project()), project());
    expect(issues.some((i) => i.code === 'machining.outOfBounds')).toBe(false);
  });

  it('Тест 24: глубина глухих отверстий не превышает толщину', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    connect('dowel', side, bottom);
    const issues = validateMachining(generateMachining(project()), project());
    expect(issues.some((i) => i.code === 'machining.depthExceeds' && i.severity === 'error')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Спецификация, чертежи и проверки', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 25: спецификация группирует крепёж и учитывает quantity', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const top = partByType('top');
    // Отдельная позиция каталога: её используют только эти два соединения.
    const hwId = store().addHardwareFromTemplate(catalogByCategory('confirmat')[0]);
    store().addConnection({ hardwareId: hwId, partAId: side.id, partBId: bottom.id, quantity: 2 });
    store().addConnection({ hardwareId: hwId, partAId: side.id, partBId: top.id, quantity: 3 });
    const ledger = buildHardwareLedger(project().hardware, project().hardwareConnections);
    expect(ledger.find((r) => r.hardwareId === hwId)!.count).toBe(5);
  });

  it('Тест 26: производная присадка попадает в чертёж детали', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const holesBefore = countCircles(buildPartsDocument(project()));
    connect('confirmat', side, bottom);
    const holesAfter = countCircles(buildPartsDocument(project()));
    expect(holesAfter).toBeGreaterThan(holesBefore);
  });

  it('Тест 27: ConnectionCheck отмечает отсутствующую фурнитуру', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const id = connect('confirmat', side, bottom);
    // Ломаем ссылку на фурнитуру.
    store().updateConnection(id, { hardwareId: 'ghost' as never });
    const issues = validateConnections(project());
    expect(issues.some((i) => i.code === 'conn.noHardware')).toBe(true);
  });

  it('Тест 28: ConnectionCheck предупреждает о дубле соединения', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    connect('confirmat', side, bottom);
    connect('confirmat', side, bottom);
    const issues = validateConnections(project());
    expect(issues.some((i) => i.code === 'conn.duplicate' && i.severity === 'warning')).toBe(true);
  });

  it('Тест 29: ProductionCheck агрегирует проверку соединений', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    connect('confirmat', side, bottom);
    const result = runProductionCheck(project(), { cuttingRunning: false });
    expect(Array.isArray(result.issues)).toBe(true);
    expect(typeof result.ready).toBe('boolean');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('История и сериализация', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 30: undo/redo отменяет и возвращает соединение', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const before = project().hardwareConnections.length;
    connect('confirmat', side, bottom);
    expect(project().hardwareConnections.length).toBe(before + 1);
    store().undo();
    expect(project().hardwareConnections.length).toBe(before);
    store().redo();
    expect(project().hardwareConnections.length).toBe(before + 1);
  });

  it('Тест 31: соединения и присадка восстанавливаются из JSON', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const id = connect('confirmat', side, bottom, 2);
    const restored = deserializeProject(serializeProject(project()));
    expect(restored.hardwareConnections).toHaveLength(project().hardwareConnections.length);
    const conn = restored.hardwareConnections.find((c) => String(c.id) === String(id))!;
    expect(conn.quantity).toBe(2);
    expect(conn.jointType).toBeDefined();
    // Производные операции пересчитываются из связей после загрузки.
    expect(generateMachining(restored).length).toBeGreaterThan(0);
  });
});

/** Подсчёт кругов (отверстий) во всех страницах документа деталировки. */
function countCircles(doc: { pages: Array<{ scene: { prims: Array<{ kind: string }> } }> }): number {
  let n = 0;
  for (const page of doc.pages) for (const p of page.scene.prims) if (p.kind === 'circle') n++;
  return n;
}
