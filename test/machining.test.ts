import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import {
  allOperations,
  generateMachining,
  validateMachining,
} from '@/engines/machining';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';
import type { Part } from '@/core/model/types';

const store = () => useEditorStore.getState();
const project = () => store().project;

function partByType(type: string): Part {
  return allParts(project()).find((p) => p.metadata?.partType === type)!;
}
function connect(type: 'dowel' | 'confirmat', a: Part, b: Part) {
  const hw = project().hardware.find((h) => h.category === type)!;
  const res = store().addConnection({ hardwareId: hw.id, partAId: a.id, partBId: b.id });
  expect(res.ok).toBe(true);
  return res;
}

describe('MachiningEngine — генерация присадки', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 1: шкант между боковиной и дном создаёт операции для обеих деталей', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    connect('dowel', side, bottom);

    const ops = generateMachining(project());
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((o) => o.origin === 'generated')).toBe(true);
    // операции есть у обеих деталей
    expect(ops.some((o) => o.partId === side.id)).toBe(true);
    expect(ops.some((o) => o.partId === bottom.id)).toBe(true);
    // все ссылаются на источник-соединение
    expect(ops.every((o) => o.sourceHardwareConnectionId)).toBe(true);
  });

  it('Тест 2: конфирмат создаёт сквозное в проходной детали и глухое в принимающей', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    connect('confirmat', side, bottom);

    const ops = generateMachining(project());
    const through = ops.filter((o) => o.through === true);
    const blind = ops.filter((o) => o.through === false);
    expect(through.length).toBe(2); // 2 конфирмата по умолчанию
    expect(blind.length).toBe(2);
    expect(through[0].type).toBe('confirmat');
    expect(through[0].diameter).toBe(7);
    expect(blind[0].diameter).toBe(5); // направляющее (pilot)
  });

  it('Тест 3: изменение глубины корпуса пересчитывает координаты отверстий', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    connect('dowel', side, bottom);

    const maxX = () =>
      Math.max(...generateMachining(project()).filter((o) => o.partId === side.id).map((o) => o.x));
    const before = maxX();

    const cabId = store().activeFurnitureId!;
    store().updateCabinetParams(cabId, { depth: 800 });
    // деталь боковины после пересчёта — тот же id (стабильный)
    const after = maxX();
    expect(after).toBeGreaterThan(before);
  });

  it('Тест 4: изменение толщины меняет глубину сквозного отверстия', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    connect('confirmat', side, bottom);

    const throughDepth = () =>
      generateMachining(project()).find((o) => o.partId === side.id && o.through)!.depth;
    expect(throughDepth()).toBe(16);

    const bodyMat = project().materials.find((m) => m.kind === 'ldsp')!.id;
    store().updateMaterial(bodyMat, { thickness: 18 });
    expect(throughDepth()).toBe(18);
  });
});

describe('MachiningEngine — валидация', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 5: глубина глухого отверстия больше толщины → ошибка', () => {
    const side = partByType('side_left');
    store().addManualOperation({ partId: side.id, face: 'front', x: 100, y: 100, diameter: 8, depth: 20 });
    const issues = validateMachining(allOperations(project()), project());
    expect(issues.some((i) => i.code === 'machining.depthExceeds' && i.severity === 'error')).toBe(true);
  });

  it('Тест 6: отверстие за пределами детали → ошибка', () => {
    const side = partByType('side_left');
    store().addManualOperation({ partId: side.id, face: 'front', x: 99999, y: 100, diameter: 8, depth: 5 });
    const issues = validateMachining(allOperations(project()), project());
    expect(issues.some((i) => i.code === 'machining.outOfBounds' && i.severity === 'error')).toBe(true);
  });

  it('глухое отверстие с глубиной в пределах толщины — без ошибок глубины', () => {
    const side = partByType('side_left');
    store().addManualOperation({ partId: side.id, face: 'front', x: 100, y: 100, diameter: 8, depth: 10 });
    const issues = validateMachining(allOperations(project()), project());
    expect(issues.some((i) => i.code === 'machining.depthExceeds')).toBe(false);
  });
});

describe('MachiningEngine — GENERATED/MANUAL, сохранение', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 7: соединения и операции восстанавливаются из JSON', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    connect('confirmat', side, bottom);
    store().addManualOperation({ partId: side.id, face: 'front', x: 50, y: 50, diameter: 8, depth: 10 });

    const restored = deserializeProject(serializeProject(project()));
    // ручная операция сохранена в модели
    expect(allParts(restored).some((p) => p.machining.length > 0)).toBe(true);
    expect(restored.hardwareConnections).toHaveLength(1);
    // производные операции пересчитываются из связей после загрузки
    const genOps = generateMachining(restored);
    expect(genOps.length).toBeGreaterThan(0);
  });

  it('Тест 8: ручная операция переживает пересчёт параметрической модели', () => {
    const side = partByType('side_left');
    const opId = store().addManualOperation({ partId: side.id, face: 'front', x: 50, y: 50, diameter: 8, depth: 10 });

    const cabId = store().activeFurnitureId!;
    store().updateCabinetParams(cabId, { width: 1000 });

    const manual = allParts(project()).flatMap((p) => p.machining);
    expect(manual.find((o) => o.id === opId)).toBeDefined();
    expect(manual.find((o) => o.id === opId)!.origin).toBe('manual');
  });

  it('удаление соединения убирает производные операции', () => {
    const side = partByType('side_left');
    const bottom = partByType('bottom');
    const res = connect('dowel', side, bottom);
    expect(generateMachining(project()).length).toBeGreaterThan(0);
    store().removeConnection(res.id!);
    expect(generateMachining(project()).length).toBe(0);
  });
});
