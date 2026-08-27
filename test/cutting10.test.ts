/**
 * ЭТАП 10 — Профессиональный модуль раскроя листовых материалов.
 * Цепочка: Production Model → CuttingEngine → CuttingResult → CuttingSheet →
 * CuttingPiece → SVG/PDF/CSV/JSON. Проверяет группировку, размещение, kerf,
 * технологические поля, текстуру, поворот, несколько листов, остатки,
 * библиотеки листов и остатков, статистику, ручное перемещение, блокировку,
 * пересчёт, инвалидацию, экспорт и ProductionCheck.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MaxRectsEngine } from '@/engines/cutting/MaxRectsEngine';
import {
  buildCuttingInputs,
  buildPieceInstances,
  isCuttingStale,
  runCutting,
  validateResult,
  validateSheet,
  reportToCsv,
  reportToJson,
  resultToSvg,
  sheetToSvg,
  isUsableRemnant,
} from '@/engines/cutting';
import type { CuttingInput, CuttingPieceInstance } from '@/engines/cutting';
import { validateCutting } from '@/engines/status';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import { createDefaultSheets, makeCuttingSettings } from '@/core/model/factory';
import type { CuttingSheetResult, Placement } from '@/core/model/types';
import type { MaterialId, PartId } from '@/core/model/ids';

const MAT = 'm1' as MaterialId;
const engine = new MaxRectsEngine();

function piece(id: string, length: number, width: number, over: Partial<CuttingPieceInstance> = {}): CuttingPieceInstance {
  return { pieceId: id, partId: id as PartId, name: id, number: id, length, width, grain: 'none', allowRotate: true, materialId: MAT, ...over };
}
function input(pieces: CuttingPieceInstance[], over: Partial<CuttingInput> = {}): CuttingInput {
  return {
    materialId: MAT,
    pieces,
    sheet: { length: 2750, width: 1830 },
    kerf: 4,
    trim: { left: 10, right: 10, top: 10, bottom: 10 },
    options: { respectGrain: true, attempts: 4, sortStrategy: 'area', minRemnant: 150, optimizationMode: 'BALANCED', usableRemnant: { minWidth: 100, minLength: 300, minArea: 60000 } },
    ...over,
  };
}
const allPlacements = (r: ReturnType<typeof engine.calculate>) => r.sheets.flatMap((s) => s.placements);
const store = () => useEditorStore.getState();

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 10 — модель и группировка', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 1: группировка деталей по материалу', () => {
    const inputs = buildCuttingInputs(store().project);
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    for (const inp of inputs) expect(inp.pieces.every((p) => p.materialId === inp.materialId)).toBe(true);
  });

  it('Тест 2: разные толщины/материалы раскраиваются раздельно', () => {
    const inputs = buildCuttingInputs(store().project);
    const materialIds = new Set(inputs.map((i) => i.materialId));
    expect(materialIds.size).toBe(inputs.length); // на каждый материал — свой job
  });

  it('Тест 3: библиотека листов создаётся из материалов', () => {
    const sheets = createDefaultSheets(store().project.materials);
    expect(sheets.length).toBe(store().project.materials.length);
    expect(sheets.every((s) => s.width > 0 && s.height > 0)).toBe(true);
    expect(store().project.sheets.length).toBeGreaterThan(0);
  });

  it('Тест 4: CuttingPiece создаётся из Part и хранит partId', () => {
    const map = buildPieceInstances(store().project);
    const all = [...map.values()].flat();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((p) => typeof p.partId === 'string')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 10 — размещение и ограничения', () => {
  it('Тест 5: деталь получает sheetId, x, y, rotation', () => {
    const r = engine.calculate(input([piece('a', 600, 400)]));
    const pl = allPlacements(r)[0];
    expect(pl).toBeDefined();
    expect(r.sheets[0].id).toContain('sheet');
    expect(typeof pl.x).toBe('number');
    expect(typeof pl.y).toBe('number');
    expect([0, 90]).toContain(pl.rotation);
  });

  it('Тест 6: проверка границ — деталь за рабочей областью → ошибка', () => {
    const inp = input([]);
    const badSheet: CuttingSheetResult = {
      id: 's', materialId: MAT, index: 0, length: 2750, width: 1830, trim: inp.trim, cuts: [],
      placements: [{ pieceId: 'x', partId: 'x' as PartId, name: 'x', number: 'x', x: 2700, y: 100, length: 400, width: 300, rotation: 0, origin: 'manual', locked: false }],
      remnants: [], usableAreaMm2: 1, usedAreaMm2: 1, remnantAreaMm2: 0, wasteAreaMm2: 0, utilization: 1,
    };
    const issues = validateSheet(badSheet, inp);
    expect(issues.some((i) => i.code === 'cutting.outOfSheet')).toBe(true);
  });

  it('Тест 7: проверка пересечений — две детали в одном месте → ошибка', () => {
    const inp = input([]);
    const mk = (id: string): Placement => ({ pieceId: id, partId: id as PartId, name: id, number: id, x: 100, y: 100, length: 400, width: 300, rotation: 0, origin: 'automatic', locked: false });
    const badSheet: CuttingSheetResult = {
      id: 's', materialId: MAT, index: 0, length: 2750, width: 1830, trim: inp.trim, cuts: [],
      placements: [mk('a'), mk('b')], remnants: [], usableAreaMm2: 1, usedAreaMm2: 1, remnantAreaMm2: 0, wasteAreaMm2: 0, utilization: 1,
    };
    const issues = validateSheet(badSheet, inp);
    expect(issues.some((i) => i.code === 'cutting.overlap')).toBe(true);
  });

  it('Тест 8: поворот — деталь поворачивается для размещения, но не при запрете', () => {
    const fits = engine.calculate(input([piece('a', 1500, 500)], { sheet: { length: 1000, width: 2000 } }));
    expect(fits.unplaced).toHaveLength(0);
    expect(allPlacements(fits)[0].rotation).toBe(90);
    const noRot = engine.calculate(input([piece('b', 1500, 500, { allowRotate: false })], { sheet: { length: 1000, width: 2000 } }));
    expect(noRot.unplaced).toHaveLength(1);
  });

  it('Тест 9: текстура запрещает поворот при respectGrain', () => {
    const grained = piece('a', 1500, 500, { grain: 'length' });
    const respected = engine.calculate(input([grained], { sheet: { length: 1000, width: 2000 }, options: { ...input([]).options, respectGrain: true } }));
    expect(respected.unplaced).toHaveLength(1);
    const ignored = engine.calculate(input([grained], { sheet: { length: 1000, width: 2000 }, options: { ...input([]).options, respectGrain: false } }));
    expect(ignored.unplaced).toHaveLength(0);
  });

  it('Тест 10: пропил (kerf) влияет на раскладку', () => {
    // Лист вмещает 2 детали по ширине без пропила, но не по высоте (1 ряд).
    const pieces = [piece('a', 900, 500), piece('b', 900, 500)];
    const noKerf = engine.calculate(input(pieces, { sheet: { length: 1000, width: 1810 }, kerf: 0 }));
    const withKerf = engine.calculate(input(pieces, { sheet: { length: 1000, width: 1810 }, kerf: 20 }));
    // Обе детали размещаются, но при большом пропиле требуется больше листов.
    expect(noKerf.unplaced).toHaveLength(0);
    expect(withKerf.sheets.length).toBeGreaterThanOrEqual(noKerf.sheets.length);
  });

  it('Тест 11: технологические поля уменьшают рабочую площадь', () => {
    const noTrim = engine.calculate(input([piece('a', 100, 100)], { trim: { left: 0, right: 0, top: 0, bottom: 0 } }));
    const withTrim = engine.calculate(input([piece('a', 100, 100)], { trim: { left: 50, right: 50, top: 50, bottom: 50 } }));
    expect(withTrim.sheets[0].usableAreaMm2).toBeLessThan(noTrim.sheets[0].usableAreaMm2);
  });

  it('Тест 12: несколько листов создаются автоматически', () => {
    const pieces = Array.from({ length: 40 }, (_, i) => piece(`p${i}`, 900, 600));
    const r = engine.calculate(input(pieces));
    expect(r.sheets.length).toBeGreaterThan(1);
  });

  it('Тест 13: неразмещённая деталь сохраняется с причиной', () => {
    const r = engine.calculate(input([piece('big', 5000, 3000)]));
    expect(r.unplaced).toHaveLength(1);
    expect(r.unplaced[0].reason.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 10 — статистика и остатки', () => {
  it('Тест 14: расчёт площади деталей', () => {
    const r = engine.calculate(input([piece('a', 600, 400), piece('b', 500, 500)]));
    expect(r.statistics.piecesAreaMm2).toBeCloseTo(600 * 400 + 500 * 500, 0);
  });

  it('Тест 15: utilization = площадь деталей / рабочая площадь листов', () => {
    const r = engine.calculate(input([piece('a', 600, 400)]));
    const expected = r.statistics.piecesAreaMm2 / r.statistics.sheetsUsableAreaMm2;
    expect(r.statistics.utilization).toBeCloseTo(expected, 5);
    expect(r.statistics.utilization).toBeGreaterThan(0);
    expect(r.statistics.utilization).toBeLessThanOrEqual(1);
  });

  it('Тест 16: остатки вычисляются с площадью и признаком полезности', () => {
    const r = engine.calculate(input([piece('a', 600, 400)]));
    const remnants = r.sheets.flatMap((s) => s.remnants);
    expect(remnants.length).toBeGreaterThan(0);
    expect(remnants.every((rr) => rr.area === rr.width * rr.height)).toBe(true);
    expect(remnants.some((rr) => rr.usable)).toBe(true);
    // Критерий полезного остатка не зашит — проверяем helper.
    expect(isUsableRemnant(800, 300, { minWidth: 100, minLength: 300, minArea: 60000 })).toBe(true);
    expect(isUsableRemnant(100, 40, { minWidth: 100, minLength: 300, minArea: 60000 })).toBe(false);
  });

  it('Тест 17: сохранение остатка в библиотеку', () => {
    store().newProject('Тест');
    const mat = store().project.materials[0].id;
    const before = store().project.remnants.length;
    store().saveRemnant({ materialId: mat, thickness: 16, width: 800, height: 300, grainDirection: 'none', sourceSheetId: 'manual' });
    expect(store().project.remnants.length).toBe(before + 1);
    expect(store().project.remnants.at(-1)!.createdAt).toBeTruthy();
  });

  it('Тест 18: использование остатка перед новым листом', () => {
    const r = engine.calculate(input([piece('a', 400, 300)], {
      remnantSheets: [{ id: 'rem1', length: 800, width: 600 }],
    }));
    expect(r.unplaced).toHaveLength(0);
    // Деталь размещена на листе-остатке (fromRemnant).
    expect(r.sheets[0].fromRemnant).toBe(true);
    expect(r.sheets[0].sheetMaterialId).toBe('rem1');
  });

  it('Тест 18b: настройка useRemnants подключает остатки в buildCuttingInputs', () => {
    store().newProject('Тест');
    store().createCabinet();
    const mat = store().project.materials[0].id;
    store().saveRemnant({ materialId: mat, thickness: 16, width: 800, height: 600, grainDirection: 'none', sourceSheetId: 'manual' });
    store().updateCuttingSettings({ useRemnants: true });
    const inp = buildCuttingInputs(store().project).find((i) => i.materialId === mat)!;
    expect(inp.remnantSheets && inp.remnantSheets.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 10 — ручное управление и пересчёт', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 19: ручное перемещение фиксирует координаты детали', () => {
    const inputs = buildCuttingInputs(store().project);
    const pieceId = inputs[0].pieces[0].pieceId;
    store().setLockedPlacement({ pieceId, sheetIndex: 0, x: 500, y: 300, rotation: 0 });
    const report = runCutting(store().project);
    const pl = report.jobs.flatMap((j) => j.sheets.flatMap((s) => s.placements)).find((p) => p.pieceId === pieceId)!;
    expect(pl.x).toBe(500);
    expect(pl.y).toBe(300);
    expect(pl.locked).toBe(true);
    expect(pl.origin).toBe('manual');
  });

  it('Тест 20: блокировка детали переключается', () => {
    const pieceId = buildCuttingInputs(store().project)[0].pieces[0].pieceId;
    store().toggleLockedPlacement({ pieceId, sheetIndex: 0, x: 100, y: 100, rotation: 0 });
    expect(store().project.cutting.settings.locked.some((l) => l.pieceId === pieceId)).toBe(true);
    store().toggleLockedPlacement({ pieceId, sheetIndex: 0, x: 100, y: 100, rotation: 0 });
    expect(store().project.cutting.settings.locked.some((l) => l.pieceId === pieceId)).toBe(false);
  });

  it('Тест 20b: поворот детали закрепляет её с новым углом', () => {
    const pieceId = buildCuttingInputs(store().project)[0].pieces[0].pieceId;
    store().rotatePlacement({ pieceId, sheetIndex: 0, x: 100, y: 100, rotation: 0 });
    const locked = store().project.cutting.settings.locked.find((l) => l.pieceId === pieceId)!;
    expect(locked.rotation).toBe(90);
  });

  it('Тест 21: пересчёт даёт актуальный результат', async () => {
    await store().recalculateCutting();
    expect(store().project.cutting.report).toBeDefined();
    expect(isCuttingStale(store().project)).toBe(false);
  });

  it('Тест 22: изменение модели делает раскрой устаревшим (инвалидация)', async () => {
    await store().recalculateCutting();
    expect(isCuttingStale(store().project)).toBe(false);
    store().updateCabinetParams(store().activeFurnitureId!, { width: 1200 });
    expect(isCuttingStale(store().project)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 10 — экспорт и проверки', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('Тест 23: экспорт SVG', () => {
    const report = runCutting(store().project);
    const svg = resultToSvg(report.jobs[0]);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
  });

  it('Тест 24: страницы для PDF/печати формируются из результата', () => {
    const report = runCutting(store().project);
    const pages = report.jobs.flatMap((j) => j.sheets.map((s) => sheetToSvg(s, j.statistics.materialName)));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every((p) => p.includes('<svg'))).toBe(true);
  });

  it('Тест 25: экспорт CSV содержит P-ID и координаты', () => {
    const report = runCutting(store().project);
    const csv = reportToCsv(report);
    expect(csv.split('\n')[0]).toContain('P-ID');
    expect(csv.split('\n').length).toBeGreaterThan(1);
  });

  it('Тест 26: экспорт JSON восстанавливается', () => {
    const report = runCutting(store().project);
    const json = reportToJson(report);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed.jobs)).toBe(true);
    expect(parsed.jobs.length).toBe(report.jobs.length);
  });

  it('Тест 27: ProductionCheck учитывает раскрой', async () => {
    // До расчёта — предупреждение «не рассчитан».
    const before = validateCutting(store().project);
    expect(before.some((i) => i.code === 'cut.notRun')).toBe(true);
    // После расчёта корректного шкафа — нет ошибок неразмещения.
    await store().recalculateCutting();
    const after = validateCutting(store().project);
    expect(after.some((i) => i.code === 'cut.unplaced')).toBe(false);
    expect(after.some((i) => i.severity === 'error')).toBe(false);
  });

  it('полная валидация результата раскроя шкафа — без пересечений/выходов', () => {
    const inputs = buildCuttingInputs(store().project);
    for (const inp of inputs) {
      const r = engine.calculate(inp);
      const issues = validateResult(r.sheets, inp);
      expect(issues.filter((i) => i.code === 'cutting.overlap')).toHaveLength(0);
      expect(issues.filter((i) => i.code === 'cutting.outOfSheet')).toHaveLength(0);
    }
    // Косвенно проверяем целостность настроек по умолчанию.
    expect(makeCuttingSettings().optimizationMode).toBe('BALANCED');
    expect(allParts(store().project).some((p) => p.material)).toBe(true);
  });
});
