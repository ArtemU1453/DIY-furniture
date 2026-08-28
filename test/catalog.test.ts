import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import {
  createBlankEdge,
  createBlankHardware,
  createBlankMaterial,
} from '@/core/model/factory';
import { allParts, firstAssembly } from '@/core/model/selectors';
import { calculateEdges } from '@/engines/bom/edgeCalculator';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { readCabinetParameters } from '@/engines/furniture/cabinet';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';
import type { EdgeMaterialId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();

describe('Material — CRUD и безопасное удаление', () => {
  beforeEach(() => store().newProject('Тест'));

  it('создание и изменение материала', () => {
    const m = createBlankMaterial();
    store().addMaterial(m);
    expect(store().project.materials.some((x) => x.id === m.id)).toBe(true);
    store().updateMaterial(m.id, { name: 'ЛДСП 22', thickness: 22 });
    const updated = store().project.materials.find((x) => x.id === m.id)!;
    expect(updated.name).toBe('ЛДСП 22');
    expect(updated.thickness).toBe(22);
  });

  it('удаление неиспользуемого материала — успех', () => {
    const m = createBlankMaterial();
    store().addMaterial(m);
    expect(store().removeMaterial(m.id).ok).toBe(true);
  });

  it('нельзя удалить материал, используемый деталями', () => {
    store().createCabinet();
    const bodyId = store().project.materials.find((x) => x.kind === 'ldsp')!.id;
    const res = store().removeMaterial(bodyId);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/использ/i);
  });

  it('изменение толщины материала пересчитывает шкаф (Тест на req 7)', () => {
    const id = store().createCabinet();
    const bodyId = readCabinetParameters(store().project.furnitures.find((f) => f.id === id)!.params).material!;
    const topLenBefore = topLength();
    store().updateMaterial(bodyId, { thickness: 18 });
    // верх «между боковинами» = W − 2T: 800−32=768 → 800−36=764
    expect(topLength()).not.toBe(topLenBefore);
    expect(topLength()).toBe(764);

    function topLength() {
      const parts = allParts(store().project);
      const top = parts.find((p) => p.metadata?.partType === 'top')!;
      return Math.max(top.width, top.height);
    }
  });
});

describe('Edge — назначение и расчёт длины', () => {
  beforeEach(() => store().newProject('Тест'));

  it('создание кромки', () => {
    const e = createBlankEdge();
    store().addEdge(e);
    expect(store().project.edges.some((x) => x.id === e.id)).toBe(true);
  });

  it('расчёт длины кромки по реальным размерам детали', () => {
    const edgeId = store().project.edges[0].id as EdgeMaterialId;
    const partId = store().addPart({ width: 600, height: 2000 });
    // левая/правая = height(2000), верх/низ = width(600)
    store().updatePart(partId, {
      edges: { left: edgeId, right: edgeId, top: edgeId, bottom: edgeId },
    });
    const report = calculateEdges(allParts(store().project), store().project.edges);
    // 2000+2000+600+600 = 5200 мм
    expect(report.totalMm).toBe(5200);
    expect(report.groups[0].lengthMm).toBe(5200);
  });

  it('нельзя удалить используемую кромку', () => {
    const edgeId = store().project.edges[0].id as EdgeMaterialId;
    const partId = store().addPart();
    store().updatePart(partId, { edges: { left: edgeId, right: null, top: null, bottom: null } });
    expect(store().removeEdge(edgeId).ok).toBe(false);
  });

  it('кромка НЕ меняет размер детали', () => {
    const edgeId = store().project.edges[0].id as EdgeMaterialId;
    const partId = store().addPart({ width: 800 });
    store().updatePart(partId, { edges: { left: edgeId, right: edgeId, top: edgeId, bottom: edgeId } });
    const part = allParts(store().project).find((p) => p.id === partId)!;
    expect(part.width).toBe(800); // размер не изменился
  });
});

describe('Hardware и HardwareConnection', () => {
  beforeEach(() => store().newProject('Тест'));

  it('создание/изменение/удаление фурнитуры', () => {
    const h = createBlankHardware();
    store().addHardware(h);
    store().updateHardware(h.id, { name: 'Конфирмат 5×50' });
    expect(store().project.hardware.find((x) => x.id === h.id)!.name).toBe('Конфирмат 5×50');
    expect(store().removeHardware(h.id).ok).toBe(true);
  });

  it('создание соединения между двумя деталями', () => {
    store().createCabinet();
    const parts = allParts(store().project);
    const hw = store().project.hardware[0];
    // Шкаф уже приходит со своими узлами — считаем прибавку, а не итог.
    const before = store().project.hardwareConnections.length;
    const res = store().addConnection({
      hardwareId: hw.id,
      partAId: parts[0].id,
      partBId: parts[1].id,
    });
    expect(res.ok).toBe(true);
    expect(store().project.hardwareConnections.length - before).toBe(1);
  });

  it('отклоняет соединение детали с самой собой и битые ссылки', () => {
    store().createCabinet();
    const parts = allParts(store().project);
    const hw = store().project.hardware[0];
    expect(store().addConnection({ hardwareId: hw.id, partAId: parts[0].id, partBId: parts[0].id }).ok).toBe(false);
    expect(
      store().addConnection({ hardwareId: hw.id, partAId: parts[0].id, partBId: 'nope' as PartId }).ok,
    ).toBe(false);
  });

  it('количество фурнитуры считается из соединений', () => {
    store().createCabinet();
    const parts = allParts(store().project);
    // Отдельная позиция: её используют только эти два соединения.
    const hw = createBlankHardware();
    store().addHardware(hw);
    store().addConnection({ hardwareId: hw.id, partAId: parts[0].id, partBId: parts[1].id });
    store().addConnection({ hardwareId: hw.id, partAId: parts[0].id, partBId: parts[2].id });
    const ledger = buildHardwareLedger(store().project.hardware, store().project.hardwareConnections);
    expect(ledger.find((r) => r.hardwareId === hw.id)!.count).toBe(2);
  });

  it('нельзя удалить фурнитуру, используемую в соединениях', () => {
    store().createCabinet();
    const parts = allParts(store().project);
    const hw = store().project.hardware[0];
    store().addConnection({ hardwareId: hw.id, partAId: parts[0].id, partBId: parts[1].id });
    expect(store().removeHardware(hw.id).ok).toBe(false);
  });
});

describe('Serialization и Regression', () => {
  beforeEach(() => store().newProject('Тест'));

  it('материалы, кромка, фурнитура и связи переживают JSON round-trip', () => {
    const id = store().createCabinet();
    const parts = allParts(store().project);
    const hw = store().project.hardware[0];
    store().addConnection({ hardwareId: hw.id, partAId: parts[0].id, partBId: parts[1].id });
    const edgeId = store().project.edges[0].id as EdgeMaterialId;
    store().updatePart(parts[0].id, { edges: { left: edgeId, right: null, top: null, bottom: null } });

    const original = store().project;
    const restored = deserializeProject(serializeProject(original));
    expect(restored).toEqual(original);
    expect(restored.hardwareConnections).toHaveLength(original.hardwareConnections.length);
    expect(restored.hardwareConnections.some((c) => String(c.partAId) === String(parts[0].id)
      && String(c.partBId) === String(parts[1].id))).toBe(true);
    expect(restored.furnitures.find((f) => f.id === id)!.assemblies[0].parts.length).toBeGreaterThan(0);
  });

  it('после добавления материалов/фурнитуры шкаф всё ещё рассчитывается', () => {
    store().addMaterial(createBlankMaterial());
    store().addHardware(createBlankHardware());
    const id = store().createCabinet();
    const cab = store().project.furnitures.find((f) => f.id === id)!;
    expect(cab.assemblies[0].parts.length).toBeGreaterThanOrEqual(8);
    const side = firstAssembly(store().project)?.parts; // sanity: selectors still work
    expect(side).toBeDefined();
  });
});
