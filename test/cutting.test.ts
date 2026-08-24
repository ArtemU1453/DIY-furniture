import { describe, it, expect, beforeEach } from 'vitest';
import { MaxRectsEngine } from '@/engines/cutting/MaxRectsEngine';
import {
  buildCuttingInputs,
  buildPieceInstances,
  isCuttingStale,
  runCutting,
  validateResult,
} from '@/engines/cutting';
import type { CuttingInput, CuttingPieceInstance } from '@/engines/cutting';
import type { MaterialId, PartId } from '@/core/model/ids';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';

const MAT = 'm1' as MaterialId;
const engine = new MaxRectsEngine();

function piece(id: string, length: number, width: number, over: Partial<CuttingPieceInstance> = {}): CuttingPieceInstance {
  return {
    pieceId: id, partId: id as PartId, name: id, number: id,
    length, width, grain: 'none', allowRotate: true, materialId: MAT, ...over,
  };
}
function input(pieces: CuttingPieceInstance[], over: Partial<CuttingInput> = {}): CuttingInput {
  return {
    materialId: MAT,
    pieces,
    sheet: { length: 2750, width: 1830 },
    kerf: 3.2,
    trim: { left: 10, right: 10, top: 10, bottom: 10 },
    options: { respectGrain: true, attempts: 1, sortStrategy: 'area', minRemnant: 150, optimizationMode: 'FAST', usableRemnant: { minWidth: 100, minLength: 300, minArea: 60000 } },
    ...over,
  };
}
const allPlacements = (r: ReturnType<typeof engine.calculate>) => r.sheets.flatMap((s) => s.placements);

describe('CuttingEngine (MaxRects)', () => {
  it('Test 1: одна деталь помещается на лист', () => {
    const r = engine.calculate(input([piece('a', 600, 2000)]));
    expect(r.sheets).toHaveLength(1);
    expect(allPlacements(r)).toHaveLength(1);
    expect(r.unplaced).toHaveLength(0);
  });

  it('Test 2: несколько деталей размещаются', () => {
    const r = engine.calculate(input([piece('a', 600, 400), piece('b', 800, 300), piece('c', 500, 500)]));
    expect(allPlacements(r)).toHaveLength(3);
    expect(r.unplaced).toHaveLength(0);
  });

  it('Test 3: деталь не помещается на лист → unplaced', () => {
    const r = engine.calculate(input([piece('big', 3000, 2000)]));
    expect(r.unplaced.map((p) => p.pieceId)).toContain('big');
  });

  it('Test 4: поворот разрешён — деталь поворачивается для размещения', () => {
    const r = engine.calculate(input([piece('a', 1500, 500)], { sheet: { length: 1000, width: 2000 } }));
    expect(r.unplaced).toHaveLength(0);
    expect(allPlacements(r)[0].rotation).toBe(90);
  });

  it('Test 5: поворот запрещён — деталь не помещается', () => {
    const r = engine.calculate(input([piece('a', 1500, 500, { allowRotate: false })], { sheet: { length: 1000, width: 2000 } }));
    expect(r.unplaced).toHaveLength(1);
  });

  it('Test 6: направление текстуры запрещает поворот', () => {
    const grained = piece('a', 1500, 500, { grain: 'length' });
    const respected = engine.calculate(input([grained], { sheet: { length: 1000, width: 2000 }, options: { respectGrain: true, attempts: 1, sortStrategy: 'area', minRemnant: 150, optimizationMode: 'FAST', usableRemnant: { minWidth: 100, minLength: 300, minArea: 60000 } } }));
    expect(respected.unplaced).toHaveLength(1); // текстуру нельзя развернуть
    const ignored = engine.calculate(input([grained], { sheet: { length: 1000, width: 2000 }, options: { respectGrain: false, attempts: 1, sortStrategy: 'area', minRemnant: 150, optimizationMode: 'FAST', usableRemnant: { minWidth: 100, minLength: 300, minArea: 60000 } } }));
    expect(ignored.unplaced).toHaveLength(0);
  });

  it('Test 7: пропил реально учитывается (влияет на число листов)', () => {
    const pieces = [piece('a', 900, 1800), piece('b', 900, 1800), piece('c', 900, 1800)];
    const noKerf = engine.calculate(input(pieces, { kerf: 0 }));
    const bigKerf = engine.calculate(input(pieces, { kerf: 20 }));
    expect(noKerf.sheets).toHaveLength(1);
    expect(bigKerf.sheets.length).toBeGreaterThan(1);
  });

  it('Test 8: технологическая обрезка уменьшает рабочую область', () => {
    const p = piece('a', 2740, 1820);
    const trimmed = engine.calculate(input([p]));
    expect(trimmed.unplaced).toHaveLength(1);
    const noTrim = engine.calculate(input([p], { trim: { left: 0, right: 0, top: 0, bottom: 0 } }));
    expect(noTrim.unplaced).toHaveLength(0);
  });

  it('Test 11: несколько листов при большом числе деталей', () => {
    const pieces = Array.from({ length: 30 }, (_, i) => piece(`p${i}`, 1000, 800));
    const r = engine.calculate(input(pieces));
    expect(r.sheets.length).toBeGreaterThan(1);
    expect(r.unplaced).toHaveLength(0);
  });

  it('Test 12: формируются прямоугольные остатки', () => {
    const r = engine.calculate(input([piece('a', 400, 400)]));
    expect(r.sheets[0].remnants.length).toBeGreaterThan(0);
    expect(r.sheets[0].remnants[0].width).toBeGreaterThan(0);
  });

  it('Test 13/14: зафиксированная деталь размещена в заданной позиции и не двигается', () => {
    const r = engine.calculate(
      input([piece('a', 600, 400), piece('b', 600, 400)], {
        locked: [{ pieceId: 'a', sheetIndex: 0, x: 500, y: 300, rotation: 0 }],
      }),
    );
    const a = allPlacements(r).find((p) => p.pieceId === 'a')!;
    expect(a.x).toBe(500);
    expect(a.y).toBe(300);
    expect(a.locked).toBe(true);
    expect(a.origin).toBe('manual');
  });

  it('размещённые детали не пересекаются (валидатор)', () => {
    const pieces = Array.from({ length: 12 }, (_, i) => piece(`p${i}`, 700, 500));
    const inp = input(pieces);
    const r = engine.calculate(inp);
    const issues = validateResult(r.sheets, inp);
    expect(issues.filter((i) => i.code === 'cutting.overlap')).toHaveLength(0);
    expect(issues.filter((i) => i.code === 'cutting.outOfSheet')).toHaveLength(0);
  });

  it('Test 17: детерминированность — одинаковый вход даёт одинаковый результат', () => {
    const pieces = Array.from({ length: 15 }, (_, i) => piece(`p${i}`, 600 + i * 10, 400));
    const r1 = engine.calculate(input(pieces, { options: { respectGrain: true, attempts: 4, sortStrategy: 'area', minRemnant: 150, optimizationMode: 'FAST', usableRemnant: { minWidth: 100, minLength: 300, minArea: 60000 } } }));
    const r2 = engine.calculate(input(pieces, { options: { respectGrain: true, attempts: 4, sortStrategy: 'area', minRemnant: 150, optimizationMode: 'FAST', usableRemnant: { minWidth: 100, minLength: 300, minArea: 60000 } } }));
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

describe('Раскрой — связь с производственной моделью', () => {
  beforeEach(() => {
    useEditorStore.getState().newProject('Тест');
    useEditorStore.getState().createCabinet();
  });
  const store = () => useEditorStore.getState();

  it('Test 9: детали группируются по материалу (ЛДСП / ХДФ раздельно)', () => {
    const inputs = buildCuttingInputs(store().project);
    expect(inputs.length).toBeGreaterThanOrEqual(2); // корпус ЛДСП + задняя стенка ХДФ
    for (const inp of inputs) {
      expect(inp.pieces.every((p) => p.materialId === inp.materialId)).toBe(true);
    }
  });

  it('Test 10: количество детали > 1 → отдельные экземпляры', () => {
    const partId = store().addPart({ quantity: 3, material: store().project.materials[0].id });
    const map = buildPieceInstances(store().project);
    const instances = [...map.values()].flat().filter((p) => p.partId === partId);
    expect(instances).toHaveLength(3);
    expect(new Set(instances.map((p) => p.pieceId)).size).toBe(3);
  });

  it('Test 15: изменение проекта делает раскрой устаревшим', async () => {
    await store().recalculateCutting();
    expect(isCuttingStale(store().project)).toBe(false);
    store().updateCabinetParams(store().activeFurnitureId!, { width: 1000 });
    expect(isCuttingStale(store().project)).toBe(true);
  });

  it('Test 16: раскрой и настройки восстанавливаются из JSON', async () => {
    await store().recalculateCutting();
    const restored = deserializeProject(serializeProject(store().project));
    expect(restored.cutting.report).toBeDefined();
    expect(restored.cutting.report!.jobs.length).toBeGreaterThan(0);
    expect(isCuttingStale(restored)).toBe(false); // не устарел после round-trip
  });

  it('полный тестовый расчёт шкафа даёт корректные листы и статистику', async () => {
    const cabId = store().activeFurnitureId!;
    store().updateCabinetParams(cabId, { shelves: 4, dividers: 1 });
    const report = runCutting(store().project);
    expect(report.jobs.length).toBeGreaterThan(0);
    const ldsp = report.jobs.find((j) => j.statistics.pieceCount > 0)!;
    expect(ldsp.sheets.length).toBeGreaterThan(0);
    expect(ldsp.statistics.utilization).toBeGreaterThan(0);
    expect(ldsp.statistics.utilization).toBeLessThanOrEqual(1);
    // нет неразмещённых при стандартном листе
    expect(ldsp.unplaced).toHaveLength(0);
    // площади согласованы
    const parts = allParts(store().project).filter((p) => p.material);
    expect(parts.length).toBeGreaterThan(0);
  });
});
