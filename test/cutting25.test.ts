/**
 * ЭТАП 25 — Расчёт и оптимизация раскроя листовых материалов.
 *
 * Цепочка: PROJECT → PARTS → MATERIALS → STOCK → OPTIMIZATION → CUTTING PLAN
 * → VISUALIZATION → CUT LIST → PRODUCTION DOCUMENTS.
 *
 * Проверяет склад листов и остатков, технологический профиль (пропил, зазор,
 * диск, обрезка), алгоритмы, поворот и текстуру, границы и пересечения,
 * количество и мультиматериал, статусы карты (DIRTY/LOCKED/OUTDATED),
 * пересчёт, экспорт и полный цикл шкафа.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUILT_IN_PRESETS,
  CUTTING_ALGORITHMS,
  DEFAULT_ALGORITHM_KIND,
  DEFAULT_QUALITY_THRESHOLDS,
  STANDARD_SHEET_SIZES,
  allPresets,
  algorithmByKind,
  applyPlans,
  applyPreset,
  availableAlgorithms,
  canRemoveSheet,
  classifyQuality,
  cutListCsv,
  cuttingLabels,
  cuttingPlanJson,
  cuttingCsv,
  engineForKind,
  filterStock,
  isPlanLocked,
  isSheetInUse,
  isUsableRemnant,
  kindOfEngine,
  labelCode,
  labelsCsv,
  listCuttingEngines,
  matchesPreset,
  parseLabelCode,
  partLabels,
  planId,
  planOf,
  planQuality,
  planStatus,
  presetFromSettings,
  profileSignature,
  refreshPlanStatuses,
  remnantsCsv,
  reportToJson,
  resolveCuttingProfile,
  runCutting,
  sheetToSvg,
  snapshotMatches,
  sourceSnapshot,
  spacingOf,
  stockItems,
  stockQuantityOf,
  stockSummary,
  toPlan,
  usableArea,
  utilizationPercent,
  validThresholds,
  validatePlan,
  validateResult,
  wasteArea,
} from '@/engines/cutting';
import { MaxRectsEngine } from '@/engines/cutting/MaxRectsEngine';
import { ShelfEngine } from '@/engines/cutting/ShelfEngine';
import { SkylineEngine } from '@/engines/cutting/SkylineEngine';
import { GuillotineEngine } from '@/engines/cutting/GuillotineEngine';
import { buildCuttingInputs } from '@/engines/cutting';
import type { CuttingInput, CuttingPieceInstance } from '@/engines/cutting';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import { buildDocument } from '@/engines/drawing';
import { allEdgeBanding } from '@/engines/edges';
import { allOperations } from '@/engines/machining';
import type { CuttingReport, CuttingResult, Project } from '@/core/model/types';
import type { MaterialId, PartId } from '@/core/model/ids';

const MAT = 'm1' as MaterialId;
const maxrects = new MaxRectsEngine();
const shelf = new ShelfEngine();
const skyline = new SkylineEngine();
const guillotine = new GuillotineEngine();
const store = () => useEditorStore.getState();
const project = (): Project => store().project;

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
    sheet: { length: 2800, width: 2070 },
    kerf: 3.2,
    trim: { left: 0, right: 0, top: 0, bottom: 0 },
    options: {
      respectGrain: true, attempts: 4, sortStrategy: 'area', minRemnant: 150,
      optimizationMode: 'BALANCED', usableRemnant: { minWidth: 100, minLength: 300, minArea: 60_000 },
    },
    ...over,
  };
}

/** Шкаф 800×2000×600 из §150: корпус, 2 фасада, полки, ящик. */
function makeCabinet(): void {
  store().newProject('Тест 25');
  const res = store().createFromTemplate('tpl-cabinet', {
    width: 800, height: 2000, depth: 600, materialThickness: 16, backThickness: 3,
    shelfCount: 3, verticalPartitionCount: 0, doorCount: 2, doorGap: 3,
    backType: 'inset', jointType: 'confirmat', handleEnabled: true,
  });
  expect(res.ok).toBe(true);
}

const placements = (r: CuttingResult) => r.sheets.flatMap((s) => s.placements);
const materialId = (): MaterialId => project().materials[0].id;
const runReport = (): CuttingReport => runCutting(project());

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 25 — склад листов и остатков', () => {
  beforeEach(makeCabinet);

  it('Тест 1: StockSheet описан и попадает на склад', () => {
    const id = store().addSheetMaterial({
      materialId: materialId(), name: 'Формат 2750', width: 1830, height: 2750,
      thickness: 16, grainDirection: 'none', availableQuantity: 0, source: 'custom',
      stockMode: 'INFINITE', edgeAllowance: 5,
    });
    const item = stockItems(project()).find((x) => x.id === id);
    expect(item).toBeDefined();
    expect(item!.kind).toBe('SHEET');
    expect(item!.height).toBe(2750);
    expect(item!.infinite).toBe(true);
    expect(item!.status).toBe('AVAILABLE');
    // §5: лист ссылается на существующий материал проекта.
    expect(project().materials.some((m) => m.id === item!.materialId)).toBe(true);
  });

  it('Тест 6/7: стандартные и пользовательские размеры листа', () => {
    expect(STANDARD_SHEET_SIZES.map((s) => s.name)).toContain('2750 × 1830');
    expect(STANDARD_SHEET_SIZES.map((s) => s.name)).toContain('2800 × 2070');
    expect(STANDARD_SHEET_SIZES.map((s) => s.name)).toContain('2440 × 1830');
    // Пользовательский размер задаётся вручную.
    const id = store().addSheetMaterial({
      materialId: materialId(), name: 'Свой', width: 1000, height: 1500,
      thickness: 16, grainDirection: 'none', availableQuantity: 0, source: 'custom',
    });
    expect(project().sheets.find((s) => s.id === id)!.height).toBe(1500);
  });

  it('Тест 9/10: режимы запаса INFINITE и LIMITED', () => {
    const infinite = { id: 'a', materialId: MAT, name: 'A', width: 1830, height: 2750, thickness: 16, grainDirection: 'none' as const, availableQuantity: 0, source: 'custom' as const, stockMode: 'INFINITE' as const };
    const limited = { ...infinite, id: 'b', stockMode: 'LIMITED' as const, availableQuantity: 3 };
    expect(stockQuantityOf(infinite)).toBe(0); // 0 = без ограничения
    expect(stockQuantityOf(limited)).toBe(3);
    // Формат без stockMode читается по прежнему правилу.
    expect(stockQuantityOf({ ...infinite, stockMode: undefined, availableQuantity: 5 })).toBe(5);
  });

  it('Тест 66/67: MaterialRemnant и его состояния', () => {
    const id = store().saveRemnant({
      materialId: materialId(), thickness: 16, width: 600, height: 900,
      grainDirection: 'none', sourceSheetId: 'sheet-1',
    });
    const item = () => stockItems(project()).find((x) => x.id === id)!;
    expect(item().kind).toBe('REMNANT');
    expect(item().status).toBe('AVAILABLE');
    store().setRemnantStatus(id, 'USED');
    expect(item().status).toBe('USED');
    store().setRemnantStatus(id, 'ARCHIVED');
    expect(item().status).toBe('ARCHIVED');
  });

  it('Тест 76/77: фильтры и поиск по складу', () => {
    store().addSheetMaterial({
      materialId: materialId(), name: 'Большой', width: 1830, height: 2750,
      thickness: 16, grainDirection: 'none', availableQuantity: 0, source: 'custom',
    });
    store().addSheetMaterial({
      materialId: materialId(), name: 'Малый', width: 600, height: 800,
      thickness: 16, grainDirection: 'none', availableQuantity: 2, source: 'custom', stockMode: 'LIMITED',
    });
    const items = stockItems(project());
    expect(filterStock(items, { query: 'Большой' }).length).toBe(1);
    expect(filterStock(items, { query: '2750x1830' }).length).toBeGreaterThan(0);
    expect(filterStock(items, { minHeight: 1000 }).every((x) => x.height >= 1000)).toBe(true);
    expect(filterStock(items, { kind: 'SHEET' }).every((x) => x.kind === 'SHEET')).toBe(true);
    expect(filterStock(items, { thickness: 16 }).every((x) => x.thickness === 16)).toBe(true);
    expect(filterStock(items, { status: 'AVAILABLE' }).every((x) => x.status === 'AVAILABLE')).toBe(true);
  });

  it('Тест 79/80: удаление запрещено для используемого листа, архив разрешён', () => {
    const id = store().addSheetMaterial({
      materialId: materialId(), name: 'Рабочий', width: 1830, height: 2750,
      thickness: 16, grainDirection: 'none', availableQuantity: 0, source: 'custom',
    });
    store().updateCuttingSettings({ sheetSelection: { [String(materialId())]: id } });
    store().applyCuttingReport(runReport());

    expect(isSheetInUse(project(), id)).toBe(true);
    expect(canRemoveSheet(project(), id).ok).toBe(false);
    const res = store().removeSheetMaterial(id);
    expect(res.ok).toBe(false);
    expect(project().sheets.some((s) => s.id === id)).toBe(true);

    // §80: вместо удаления — архив; из подбора формат уходит.
    store().setSheetArchived(id, true);
    expect(project().sheets.find((s) => s.id === id)!.archived).toBe(true);
    expect(stockItems(project()).find((x) => x.id === id)!.status).toBe('ARCHIVED');
  });

  it('Тест 75: сводка склада по материалам', () => {
    store().addSheetMaterial({
      materialId: materialId(), name: 'Формат', width: 1830, height: 2750,
      thickness: 16, grainDirection: 'none', availableQuantity: 4, source: 'custom', stockMode: 'LIMITED',
    });
    const rows = stockSummary(project());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].sheetCount).toBeGreaterThan(0);
    expect(rows[0].areaM2).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 25 — технологический профиль', () => {
  beforeEach(makeCabinet);

  it('Тест 6/17/18: CuttingProfile выводится из существующих настроек', () => {
    store().updateCuttingSettings({ kerfOverride: 3.2, minGap: 1, trim: { left: 10, right: 10, top: 10, bottom: 10 } });
    const profile = resolveCuttingProfile(project(), project().materials[0]);
    expect(profile.kerf).toBe(3.2);
    expect(profile.minGap).toBe(1);
    expect(profile.trimming.left).toBe(10);
    // Второго профиля нет: значения читаются из CuttingSettings проекта.
    expect(profileSignature(profile)).toContain('kerf:3.2');
  });

  it('Тест 17: пильный диск шире пропила поднимает пропил до себя', () => {
    store().updateCuttingSettings({ kerfOverride: 3, bladeWidth: 4.4 });
    expect(resolveCuttingProfile(project()).kerf).toBe(4.4);
    store().updateCuttingSettings({ kerfOverride: 5, bladeWidth: 4.4 });
    expect(resolveCuttingProfile(project()).kerf).toBe(5);
  });

  it('Тест 13/39: зазор складывается с пропилом', () => {
    expect(spacingOf({ kerf: 3.2, minGap: 0 })).toBe(3.2);
    expect(spacingOf({ kerf: 3.2, minGap: 2 })).toBeCloseTo(5.2, 6);
    expect(spacingOf({ kerf: 3.2 })).toBe(3.2);
  });

  it('Тест 14/19/20: припуск формата входит в обрезку, рабочая область считается', () => {
    store().updateCuttingSettings({ trim: { left: 10, right: 10, top: 10, bottom: 10 } });
    const sheetId = store().addSheetMaterial({
      materialId: materialId(), name: 'С припуском', width: 1830, height: 2750,
      thickness: 16, grainDirection: 'none', availableQuantity: 0, source: 'custom', edgeAllowance: 5,
    });
    const format = project().sheets.find((s) => s.id === sheetId);
    const profile = resolveCuttingProfile(project(), project().materials[0], format);
    expect(profile.trimming.left).toBe(15);

    const area = usableArea({ length: 2750, width: 1830 }, profile.trimming);
    expect(area.usableWidth).toBe(2750 - 30);
    expect(area.usableHeight).toBe(1830 - 30);
    expect(area.areaMm2).toBe(area.usableWidth * area.usableHeight);
  });

  it('Тест 12/137: пропил учитывается — две детали 500×500 на листе 1000×1000', () => {
    const res = maxrects.calculate(input(
      [piece('a', 500, 500), piece('b', 500, 500), piece('c', 500, 500), piece('d', 500, 500)],
      { sheet: { length: 1000, width: 1000 }, kerf: 10 },
    ));
    // С пропилом 10 мм четыре детали 500×500 в лист 1000×1000 не влезают.
    expect(res.sheets.length + res.unplaced.length).toBeGreaterThan(1);
    const first = res.sheets[0].placements;
    for (let i = 0; i < first.length; i++) {
      for (let j = i + 1; j < first.length; j++) {
        const a = first[i], b = first[j];
        const gapX = Math.max(b.x - (a.x + a.length), a.x - (b.x + b.length));
        const gapY = Math.max(b.y - (a.y + a.width), a.y - (b.y + b.width));
        expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(10 - 1e-6);
      }
    }
  });

  it('Тест 13: minGap увеличивает расстояние между деталями', () => {
    const withGap = maxrects.calculate(input(
      [piece('a', 400, 400), piece('b', 400, 400)],
      { sheet: { length: 1000, width: 1000 }, kerf: 2, minGap: 20 },
    ));
    const ps = withGap.sheets[0].placements;
    expect(ps.length).toBe(2);
    const gapX = Math.max(ps[1].x - (ps[0].x + ps[0].length), ps[0].x - (ps[1].x + ps[1].length));
    const gapY = Math.max(ps[1].y - (ps[0].y + ps[0].width), ps[0].y - (ps[1].y + ps[1].width));
    expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(22 - 1e-6);
  });

  it('Тест 14/40: детали не попадают в зону обрезки', () => {
    const trim = { left: 20, right: 20, top: 20, bottom: 20 };
    const res = maxrects.calculate(input([piece('a', 500, 400), piece('b', 500, 400)], { trim }));
    for (const sheet of res.sheets) {
      for (const p of sheet.placements) {
        expect(p.x).toBeGreaterThanOrEqual(trim.left - 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(trim.bottom - 1e-6);
        expect(p.x + p.length).toBeLessThanOrEqual(sheet.length - trim.right + 1e-6);
        expect(p.y + p.width).toBeLessThanOrEqual(sheet.width - trim.top + 1e-6);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 25 — алгоритмы', () => {
  it('Тест 8/28/29: каталог алгоритмов и реестр движков', () => {
    const kinds = CUTTING_ALGORITHMS.map((a) => a.kind);
    for (const kind of ['SIMPLE_SHELF', 'GUILLOTINE', 'MAXRECTS', 'SKYLINE'] as const) {
      expect(kinds).toContain(kind);
    }
    // CUSTOM — зарезервированный вид для стороннего движка.
    expect(kindOfEngine('неизвестный-движок')).toBe('CUSTOM');
    expect(kindOfEngine('maxrects')).toBe('MAXRECTS');
    expect(algorithmByKind('SIMPLE_SHELF')!.engineId).toBe('shelf');
  });

  it('Тест 30: движок по умолчанию не заменён', () => {
    expect(DEFAULT_ALGORITHM_KIND).toBe('MAXRECTS');
    expect(engineForKind('MAXRECTS')?.id).toBe('maxrects');
    const registered = listCuttingEngines().map((e) => e.id);
    for (const id of ['maxrects', 'guillotine', 'shelf', 'skyline']) expect(registered).toContain(id);
    expect(availableAlgorithms().length).toBeGreaterThanOrEqual(4);
  });

  it('Тест 23/31/126: результат детерминирован для всех движков', () => {
    const pieces = [piece('a', 800, 400), piece('b', 600, 500), piece('c', 900, 300), piece('d', 400, 400)];
    for (const engine of [maxrects, guillotine, shelf, skyline]) {
      const first = engine.calculate(input(pieces));
      const second = engine.calculate(input(pieces));
      expect(JSON.stringify(first.sheets)).toBe(JSON.stringify(second.sheets));
      expect(first.unplaced.length).toBe(second.unplaced.length);
    }
  });

  it('Тест 15/16/32/127: результат каждого движка полон и корректен', () => {
    const pieces = Array.from({ length: 24 }, (_, i) => piece(`p${i}`, 600 + (i % 4) * 50, 400));
    for (const engine of [maxrects, guillotine, shelf, skyline]) {
      const inp = input(pieces);
      const res = engine.calculate(inp);
      expect(res.sheets.length).toBeGreaterThan(0);
      expect(res.statistics.pieceCount).toBe(placements(res).length);
      expect(res.unplaced.length).toBe(0);
      // §37/§36: без пересечений и внутри рабочей области.
      const issues = validateResult(res.sheets, inp).filter((x) => x.severity === 'error');
      expect(issues).toEqual([]);
      // §142: количество размещений = количеству экземпляров.
      expect(placements(res).length).toBe(pieces.length);
    }
  });

  it('Тест 121/122/143: 1000 деталей раскраиваются корректно', () => {
    const pieces = Array.from({ length: 1000 }, (_, i) => piece(`q${i}`, 400, 300));
    const res = skyline.calculate(input(pieces, { options: { respectGrain: true, attempts: 1, sortStrategy: 'area', minRemnant: 150, optimizationMode: 'FAST', usableRemnant: { minWidth: 100, minLength: 300, minArea: 60_000 } } }));
    expect(placements(res).length + res.unplaced.length).toBe(1000);
    expect(res.unplaced.length).toBe(0);
    expect(res.sheets.length).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 25 — поворот, текстура, границы', () => {
  it('Тест 10/134/135: деталь 600×400 размещается на листе 1000×500 с поворотом', () => {
    // Без поворота 600×400 в 1000×500 помещается как есть.
    const straight = maxrects.calculate(input([piece('a', 600, 400)], { sheet: { length: 1000, width: 500 } }));
    expect(straight.unplaced.length).toBe(0);
    expect(straight.sheets[0].placements[0].rotation).toBe(0);

    // Деталь 450×900 влезает в лист 1000×500 ТОЛЬКО повёрнутой.
    const rotated = maxrects.calculate(input(
      [piece('b', 900, 450)],
      { sheet: { length: 500, width: 1000 } },
    ));
    expect(rotated.unplaced.length).toBe(0);
    expect(rotated.sheets[0].placements[0].rotation).toBe(90);
  });

  it('Тест 11/34/36/136: текстура запрещает поворот', () => {
    const grained = piece('g', 900, 450, { grain: 'length' });
    const res = maxrects.calculate(input([grained], { sheet: { length: 500, width: 1000 } }));
    // Повернуть нельзя — деталь не размещается, а не разворачивается молча.
    expect(res.unplaced.length).toBe(1);
    expect(res.unplaced[0].code).toBe('DETAIL_TOO_LARGE');

    const blocked = piece('n', 900, 450, { allowRotate: false });
    const res2 = maxrects.calculate(input([blocked], { sheet: { length: 500, width: 1000 } }));
    expect(res2.unplaced.length).toBe(1);
  });

  it('Тест 11/35: текстура детали сохраняется в размещении', () => {
    const res = shelf.calculate(input([piece('g', 600, 400, { grain: 'length', allowRotate: false })]));
    expect(res.sheets[0].placements[0].grainDirection).toBe('length');
  });

  it('Тест 16/36/139: все детали внутри рабочей области', () => {
    const trim = { left: 15, right: 15, top: 15, bottom: 15 };
    const pieces = Array.from({ length: 12 }, (_, i) => piece(`b${i}`, 700, 350));
    for (const engine of [maxrects, guillotine, shelf, skyline]) {
      const res = engine.calculate(input(pieces, { trim }));
      for (const sheet of res.sheets) {
        for (const p of sheet.placements) {
          expect(p.x).toBeGreaterThanOrEqual(trim.left - 1e-6);
          expect(p.x + p.length).toBeLessThanOrEqual(sheet.length - trim.right + 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(trim.bottom - 1e-6);
          expect(p.y + p.width).toBeLessThanOrEqual(sheet.width - trim.top + 1e-6);
        }
      }
    }
  });

  it('Тест 15/37/138: размещения не пересекаются', () => {
    const pieces = Array.from({ length: 20 }, (_, i) => piece(`c${i}`, 500 + (i % 3) * 60, 380));
    for (const engine of [maxrects, guillotine, shelf, skyline]) {
      const res = engine.calculate(input(pieces));
      for (const sheet of res.sheets) {
        const ps = sheet.placements;
        for (let i = 0; i < ps.length; i++) {
          for (let j = i + 1; j < ps.length; j++) {
            const a = ps[i], b = ps[j];
            const overlap =
              a.x < b.x + b.length - 1e-6 && a.x + a.length > b.x + 1e-6 &&
              a.y < b.y + b.width - 1e-6 && a.y + a.width > b.y + 1e-6;
            expect(overlap).toBe(false);
          }
        }
      }
    }
  });

  it('Тест 20/41/42/144: деталь больше листа получает UNPLACED с причиной', () => {
    const res = maxrects.calculate(input([piece('big', 4000, 3000)]));
    expect(res.unplaced.length).toBe(1);
    expect(res.unplaced[0].code).toBe('DETAIL_TOO_LARGE');
    expect(res.unplaced[0].reason).toBeTruthy();

    // §42: исчерпанный запас — другая причина, другое решение.
    const limited = maxrects.calculate(input(
      [piece('a', 2000, 1000), piece('b', 2000, 1000), piece('c', 2000, 1000)],
      { availableQuantity: 1 },
    ));
    expect(limited.unplaced.some((u) => u.code === 'OUT_OF_STOCK')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 25 — количество, материалы, остатки', () => {
  beforeEach(makeCabinet);

  it('Тест 17/22/142: quantity = 20 даёт 20 размещений при одной Part', () => {
    const part = allParts(project()).find((p) => p.material)!;
    store().updatePart(part.id, { quantity: 20 });
    const before = allParts(project()).length;

    const report = runReport();
    const total = report.jobs.reduce(
      (n, j) => n + j.sheets.reduce((k, s) => k + s.placements.filter((p) => p.partId === part.id).length, 0),
      0,
    );
    expect(total).toBe(20);
    // §22: второй системы деталей не появилось — Part по-прежнему один.
    expect(allParts(project()).length).toBe(before);
  });

  it('Тест 18/43/44/45/141: у каждого материала своя карта раскроя', () => {
    // В шаблонном шкафу уже два материала с деталями (ЛДСП корпуса и ХДФ задней стенки).
    const second = project().materials.find((m) => m.id !== materialId())!.id;
    const parts = allParts(project()).filter((p) => p.material === materialId());
    store().updatePart(parts[0].id, { material: second, thickness: project().materials.find((m) => m.id === second)!.thickness });

    const report = runReport();
    const materials = new Set(report.jobs.map((j) => String(j.materialId)));
    expect(materials.size).toBeGreaterThanOrEqual(2);
    expect(materials.has(String(second))).toBe(true);
    // §44/§46: детали разных материалов не смешиваются на одном листе.
    for (const job of report.jobs) {
      for (const sheet of job.sheets) {
        expect(sheet.materialId).toBe(job.materialId);
      }
    }
  });

  it('Тест 19/65/69/70/71: остатки извлекаются по настраиваемым критериям', () => {
    const criteria = { minWidth: 100, minLength: 300, minArea: 60_000 };
    expect(isUsableRemnant(500, 400, criteria)).toBe(true);
    expect(isUsableRemnant(50, 900, criteria)).toBe(false);  // узкий
    expect(isUsableRemnant(200, 200, criteria)).toBe(false); // короткий
    expect(isUsableRemnant(110, 320, criteria)).toBe(false); // мала площадь

    const res = maxrects.calculate(input([piece('a', 600, 400)]));
    const sheet = res.sheets[0];
    expect(sheet.remnants.length).toBeGreaterThan(0);
    expect(sheet.remnantAreaMm2).toBeGreaterThan(0);
    // §71: непригодное — отход, а не остаток.
    expect(sheet.wasteAreaMm2 + sheet.remnantAreaMm2 + sheet.usedAreaMm2).toBeCloseTo(sheet.usableAreaMm2, 0);
  });

  it('Тест 19/68/73/74/140: сохранённый остаток используется следующим расчётом', () => {
    store().applyCuttingReport(runReport());
    const saved = store().saveUsableRemnantsFromResult();
    expect(saved).toBeGreaterThan(0);
    expect(project().remnants.length).toBe(saved);

    store().updateCuttingSettings({ useRemnants: true });
    const withRemnants = runCutting(project());
    const usedRemnant = withRemnants.jobs.some((j) => j.sheets.some((s) => s.fromRemnant));
    expect(usedRemnant).toBe(true);
  });

  it('Тест 72: остатки листа отделены от отхода в статистике', () => {
    const report = runReport();
    for (const job of report.jobs) {
      expect(job.statistics.remnantAreaMm2).toBeGreaterThanOrEqual(0);
      expect(job.statistics.wasteAreaMm2).toBeGreaterThanOrEqual(0);
      const sum = job.statistics.piecesAreaMm2 + job.statistics.remnantAreaMm2 + job.statistics.wasteAreaMm2;
      expect(sum).toBeCloseTo(job.statistics.sheetsUsableAreaMm2, -1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 25 — статистика и качество', () => {
  beforeEach(makeCabinet);

  it('Тест 21/60/61/62: utilization и waste считаются по формуле', () => {
    const stats = { piecesAreaMm2: 800_000, sheetsUsableAreaMm2: 1_000_000 };
    expect(utilizationPercent(stats)).toBe(80);
    expect(wasteArea(stats)).toBe(200_000);
    expect(utilizationPercent({ piecesAreaMm2: 0, sheetsUsableAreaMm2: 0 })).toBe(0);

    const report = runReport();
    for (const job of report.jobs) {
      expect(job.statistics.utilization).toBeGreaterThan(0);
      expect(job.statistics.utilization).toBeLessThanOrEqual(1);
    }
  });

  it('Тест 63/64: сводная статистика по каждому материалу', () => {
    const report = runReport();
    for (const job of report.jobs) {
      expect(job.statistics.sheetCount).toBe(job.sheets.length);
      expect(job.statistics.pieceCount).toBe(placements(job).length);
      expect(job.statistics.sheetsUsableAreaMm2).toBeGreaterThan(0);
      expect(job.statistics.materialName).toBeTruthy();
    }
  });

  it('Тест 131/132/133: классификация качества считается по порогам', () => {
    const t = DEFAULT_QUALITY_THRESHOLDS;
    expect(classifyQuality(95, t)).toBe('EXCELLENT');
    expect(classifyQuality(80, t)).toBe('GOOD');
    expect(classifyQuality(65, t)).toBe('AVERAGE');
    expect(classifyQuality(20, t)).toBe('POOR');

    // §133: пороги настраиваются — та же цифра даёт другой класс.
    const strict = { excellent: 98, good: 95, average: 90 };
    expect(classifyQuality(95, strict)).toBe('GOOD');
    expect(validThresholds(strict)).toBe(true);
    expect(validThresholds({ excellent: 50, good: 80, average: 60 })).toBe(false);
    expect(store().setQualityThresholds({ excellent: 50, good: 80, average: 60 })).toBe(false);
    expect(store().setQualityThresholds(strict)).toBe(true);
    expect(project().cutting.settings.qualityThresholds).toEqual(strict);
  });

  it('Тест 131: низкое использование даёт WARNING, а не VALID', () => {
    store().applyCuttingReport(runReport());
    // Порог «среднего» поднят выше фактического КПД — карта помечается WARNING.
    store().setQualityThresholds({ excellent: 100, good: 100, average: 100 });
    const plan = planOf(project(), materialId())!;
    expect(planQuality(plan, project().cutting.settings.qualityThresholds)).toBe('POOR');
    expect(planStatus(project(), plan)).toBe('WARNING');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 25 — карта раскроя: версии, DIRTY, LOCK', () => {
  beforeEach(makeCabinet);

  it('Тест 3/25/93/94: план получает id, версию и снимок исходных данных', () => {
    store().applyCuttingReport(runReport());
    const plan = planOf(project(), materialId())!;
    expect(plan.planId).toBe(planId(materialId()));
    expect(plan.planVersion).toBe(1);
    expect(plan.sourceSnapshot).toBeDefined();
    expect(Object.keys(plan.sourceSnapshot!.quantities).length).toBeGreaterThan(0);
    expect(snapshotMatches(project(), plan)).toBe(true);
  });

  it('Тест 4/26/27: экземпляр листа несёт остатки, отход и использование', () => {
    const report = runReport();
    for (const job of report.jobs) {
      job.sheets.forEach((sheet, i) => {
        expect(sheet.id).toBeTruthy();
        expect(sheet.index).toBe(i);
        expect(sheet.utilization).toBeGreaterThan(0);
        expect(sheet.wasteAreaMm2).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(sheet.placements)).toBe(true);
      });
    }
  });

  it('Тест 5/23/24/49/50/51/100: CutPlacement описывает деталь на листе', () => {
    const report = runReport();
    const sheet = report.jobs[0].sheets[0];
    for (const pl of sheet.placements) {
      expect(pl.partId).toBeTruthy();       // §24
      expect(pl.sheetId).toBe(sheet.id);    // §24
      expect(pl.name).toBeTruthy();         // §50
      expect(pl.number).toBeTruthy();       // §50
      expect([0, 90]).toContain(pl.rotation);
      expect(pl.cutOrder).toBeGreaterThan(0); // §99/§100
      expect(pl.grainDirection).toBeDefined();
    }
    // §49: листы нумеруются подряд.
    expect(report.jobs[0].sheets.map((s) => s.index)).toEqual(
      report.jobs[0].sheets.map((_, i) => i),
    );
  });

  it('Тест 24/88/145: изменение детали делает план DIRTY', () => {
    /* Один шкаф занимает лист примерно наполовину, поэтому при заводских
     * порогах по умолчанию карта честно классифицируется как WARNING (§131).
     * Здесь проверяется переход VALID → DIRTY, поэтому порог опускается. */
    store().setQualityThresholds({ excellent: 60, good: 40, average: 20 });
    store().applyCuttingReport(runReport());
    expect(planStatus(project(), planOf(project(), materialId())!)).toBe('VALID');

    const part = allParts(project()).find((p) => p.material)!;
    store().updatePart(part.id, { width: part.width + 120 });

    // Размер детали входит в производственную сигнатуру — план DIRTY (§88).
    expect(planStatus(project(), planOf(project(), materialId())!)).toBe('DIRTY');

    /* §94: снимок плана хранит КОЛИЧЕСТВА деталей, склад и профиль. Смена
     * количества расходится со снимком — план становится OUTDATED (§95). */
    store().updatePart(part.id, { quantity: part.quantity + 5 });
    expect(snapshotMatches(project(), planOf(project(), materialId())!)).toBe(false);
    expect(planStatus(project(), planOf(project(), materialId())!)).toBe('OUTDATED');
  });

  it('Тест 95: изменение склада делает план OUTDATED', () => {
    store().applyCuttingReport(runReport());
    const before = sourceSnapshot(project(), materialId());
    store().addSheetMaterial({
      materialId: materialId(), name: 'Новый формат', width: 1830, height: 2750,
      thickness: 16, grainDirection: 'none', availableQuantity: 0, source: 'custom',
    });
    const after = sourceSnapshot(project(), materialId());
    expect(after.stock).not.toBe(before.stock);
    expect(snapshotMatches(project(), planOf(project(), materialId())!)).toBe(false);
  });

  it('Тест 25/90/91/146: заблокированный план не меняется пересчётом', () => {
    store().applyCuttingReport(runReport());
    const original = JSON.stringify(planOf(project(), materialId())!.sheets);

    store().setPlanLocked(materialId(), true);
    expect(isPlanLocked(project(), materialId())).toBe(true);
    expect(planStatus(project(), planOf(project(), materialId())!)).toBe('LOCKED');

    // Меняем исходные данные и пересчитываем — карта обязана остаться прежней.
    const part = allParts(project()).find((p) => p.material)!;
    store().updatePart(part.id, { quantity: part.quantity + 6 });
    store().applyCuttingReport(runCutting(project()));

    expect(JSON.stringify(planOf(project(), materialId())!.sheets)).toBe(original);
    expect(planOf(project(), materialId())!.locked).toBe(true);
  });

  it('Тест 26/27/92/147: после разблокировки пересчёт даёт новый результат', () => {
    store().setQualityThresholds({ excellent: 60, good: 40, average: 20 });
    store().applyCuttingReport(runReport());
    store().setPlanLocked(materialId(), true);
    const part = allParts(project()).find((p) => p.material)!;
    store().updatePart(part.id, { quantity: part.quantity + 8 });
    store().applyCuttingReport(runCutting(project()));
    const locked = JSON.stringify(planOf(project(), materialId())!.sheets);

    store().unlockAllPlans();
    expect(isPlanLocked(project(), materialId())).toBe(false);
    store().applyCuttingReport(runCutting(project()));

    const after = planOf(project(), materialId())!;
    expect(JSON.stringify(after.sheets)).not.toBe(locked);
    expect(after.planVersion).toBeGreaterThan(1); // §93: версия выросла
    expect(planStatus(project(), after)).toBe('VALID'); // §89: снова VALID
  });

  it('Тест 24/86/87: применение плана атомарно, ошибка не рушит прежний', () => {
    store().applyCuttingReport(runReport());
    const good = planOf(project(), materialId())!;

    // §87: сломанный отчёт не применяется — прежний план остаётся.
    const broken = { jobs: null } as unknown as CuttingReport;
    const kept = applyPlans(project(), broken);
    expect(kept.jobs.length).toBe(project().cutting.report!.jobs.length);
    expect(kept.jobs[0].sheets.length).toBe(good.sheets.length);
  });

  it('Тест 27/89: refreshPlanStatuses пересчитывает состояния карт', () => {
    store().applyCuttingReport(runReport());
    store().setPlanLocked(materialId(), true);
    const refreshed = refreshPlanStatuses(project())!;
    // Зафиксирован один материал — карты остальных остаются свободными.
    expect(refreshed.jobs.find((j) => j.materialId === materialId())!.status).toBe('LOCKED');
    expect(refreshed.jobs.filter((j) => j.materialId !== materialId()).every((j) => j.status !== 'LOCKED')).toBe(true);
    store().unlockAllPlans();
    expect(refreshPlanStatuses(project())!.jobs.every((j) => j.status !== 'LOCKED')).toBe(true);
  });

  it('Тест 9/128/129/130: CuttingValidator ловит ошибки карты', () => {
    const inp = input([piece('a', 600, 400), piece('b', 600, 400)]);
    const res = maxrects.calculate(inp);
    expect(validateResult(res.sheets, inp).filter((i) => i.severity === 'error')).toEqual([]);

    // Искусственно ломаем карту: выход за лист, пересечение, дубликат.
    const broken = structuredClone(res);
    broken.sheets[0].placements.push({ ...broken.sheets[0].placements[0] });
    broken.sheets[0].placements[1] = { ...broken.sheets[0].placements[0], x: 9000 };
    const issues = validateResult(broken.sheets, inp);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('cutting.outOfSheet');
    expect(codes).toContain('cutting.duplicatePlacement');

    // §130: неразмещённая деталь делает карту некорректной.
    const withUnplaced: CuttingResult = { ...res, unplaced: [{ pieceId: 'x', partId: 'x' as PartId, name: 'x', number: 'x', length: 1, width: 1, code: 'DETAIL_TOO_LARGE', reason: 'x' }] };
    makeCabinet();
    expect(validatePlan(project(), withUnplaced).some((i) => i.code === 'cutting.unplaced')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 25 — пресеты и настройки', () => {
  beforeEach(makeCabinet);

  it('Тест 7/82/83: встроенные пресеты существуют, стандартный даёт пропил 3.2', () => {
    const standard = BUILT_IN_PRESETS.find((p) => p.id === 'preset-standard')!;
    expect(standard.kerf).toBe(3.2);
    expect(standard.builtIn).toBe(true);
    expect(allPresets(project().cutting.settings).length).toBeGreaterThanOrEqual(BUILT_IN_PRESETS.length);
  });

  it('Тест 7/82: применение пресета меняет настройки проекта', () => {
    expect(store().applyCuttingPreset('preset-guillotine')).toBe(true);
    const s = project().cutting.settings;
    expect(s.algorithm).toBe('guillotine');
    expect(s.kerfOverride).toBe(4);
    expect(s.minGap).toBe(1);
    expect(s.activePresetId).toBe('preset-guillotine');
    expect(store().applyCuttingPreset('нет-такого')).toBe(false);
  });

  it('Тест 84: пользовательский пресет сохраняется и удаляется', () => {
    store().updateCuttingSettings({ kerfOverride: 2.5, minGap: 3, algorithm: 'skyline' });
    const id = store().saveCuttingPreset('Мой станок');
    const preset = allPresets(project().cutting.settings).find((p) => p.id === id)!;
    expect(preset.name).toBe('Мой станок');
    expect(preset.kerf).toBe(2.5);
    expect(preset.minGap).toBe(3);
    expect(matchesPreset(project().cutting.settings, preset)).toBe(true);

    store().removeCuttingPreset(id);
    expect(allPresets(project().cutting.settings).some((p) => p.id === id)).toBe(false);
    // Встроенный пресет удалить нельзя.
    store().removeCuttingPreset('preset-standard');
    expect(allPresets(project().cutting.settings).some((p) => p.id === 'preset-standard')).toBe(true);
  });

  it('Тест 82: applyPreset и presetFromSettings — чистые функции', () => {
    const settings = project().cutting.settings;
    const preset = BUILT_IN_PRESETS[1];
    const next = applyPreset(settings, preset);
    expect(next).not.toBe(settings);
    expect(next.optimizationMode).toBe(preset.optimizationMode);
    const round = presetFromSettings(next, 'x', 'X');
    expect(round.kerf).toBe(preset.kerf);
    expect(round.algorithm).toBe(preset.algorithm);
  });

  it('Тест 22/85: пересчёт заново строит карту после смены настроек', () => {
    store().applyCuttingReport(runReport());
    const before = JSON.stringify(planOf(project(), materialId())!.sheets);
    store().updateCuttingSettings({ trim: { left: 60, right: 60, top: 60, bottom: 60 } });
    store().applyCuttingReport(runCutting(project()));
    expect(JSON.stringify(planOf(project(), materialId())!.sheets)).not.toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 25 — экспорт, этикетки, документы', () => {
  beforeEach(() => {
    makeCabinet();
    store().applyCuttingReport(runReport());
  });

  it('Тест 28/102: cutting-plan.json самодостаточен', () => {
    const json = JSON.parse(cuttingPlanJson(project()));
    expect(json.format).toBe('karkas-cutting-plan');
    expect(json.projectId).toBe(String(project().id));
    expect(json.materials.length).toBeGreaterThan(0);
    expect(json.plans.length).toBeGreaterThan(0);
    expect(json.profile.kerf).toBeGreaterThan(0);
    // Обычный экспорт отчёта тоже читается.
    expect(JSON.parse(reportToJson(project().cutting.report!)).jobs.length).toBeGreaterThan(0);
  });

  it('Тест 29/103/104: cut-list.csv содержит колонки §104', () => {
    const csv = cutListCsv(project());
    const [header, ...rows] = csv.split('\n');
    expect(header).toBe('Part ID,Name,Material,Thickness,Width,Height,Quantity,Grain,Edge Band');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.split(',').length).toBeGreaterThanOrEqual(9);
  });

  it('Тест 29: cutting.csv и remnants.csv по-прежнему выгружаются', () => {
    const report = project().cutting.report!;
    expect(cuttingCsv(report).split('\n').length).toBeGreaterThan(1);
    expect(remnantsCsv(report).split('\n').length).toBeGreaterThan(0);
  });

  it('Тест 30/96/97/105/106: чертёж листа содержит производственные данные', () => {
    const job = project().cutting.report!.jobs[0];
    const svg = sheetToSvg(job.sheets[0], job.statistics.materialName, { thickness: 16, sheetOf: '1 из 2' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('16 мм');           // толщина
    expect(svg).toContain('лист 1 из 2');     // номер листа
    expect(svg).toContain('использование');   // utilization
    expect(svg).toContain('отход');           // waste
    expect(svg).toContain('деталей');         // количество деталей
    expect(svg).toContain(String(Math.round(job.sheets[0].length))); // размер листа
  });

  it('Тест 31: карта печатается как набор страниц SVG', () => {
    // Печать (§107) строится из тех же SVG, что и предпросмотр.
    const pages = project().cutting.report!.jobs.flatMap((j) =>
      j.sheets.map((s) => sheetToSvg(s, j.statistics.materialName)),
    );
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every((p) => p.includes('</svg>'))).toBe(true);
  });

  it('Тест 108/109/110/111/112: этикетки деталей строятся локально', () => {
    const labels = partLabels(project());
    expect(labels.length).toBeGreaterThan(0);
    const first = labels[0];
    expect(first.name).toBeTruthy();
    expect(first.materialName).toBeTruthy();
    expect(first.quantity).toBeGreaterThan(0);
    // §111: код содержит проект и деталь; §112 — никаких внешних сервисов.
    expect(first.code).toBe(labelCode(String(project().id), first.partId));
    const parsed = parseLabelCode(first.code)!;
    expect(parsed.projectId).toBe(String(project().id));
    expect(parsed.partId).toBe(String(first.partId));
    expect(parseLabelCode('мусор')).toBeNull();

    // §51: этикетки экземпляров нумеруются «n/N» и знают свой лист.
    const inst = cuttingLabels(project());
    expect(inst.length).toBeGreaterThan(0);
    expect(inst[0].instance).toMatch(/^\d+\/\d+$/);
    expect(inst[0].sheetLabel).toMatch(/^Лист \d+$/);
    expect(labelsCsv(inst).split('\n')[0]).toContain('Code');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 25 — полный цикл и регресс', () => {
  it('Тест 35/150: шкаф 800×2000×600 проходит цепочку целиком', () => {
    makeCabinet();

    // Module → Parts
    const parts = allParts(project()).filter((p) => p.material);
    expect(parts.length).toBeGreaterThan(5);

    // Materials
    expect(project().materials.length).toBeGreaterThan(0);

    // Edge
    const edgeId = project().edges[0].id;
    for (const p of parts) store().setPartEdge(p.id, 'top', edgeId);
    expect(allEdgeBanding(project()).length).toBeGreaterThan(0);

    // Hardware + Machining
    expect(project().hardwareConnections.length).toBeGreaterThan(0);
    expect(allOperations(project()).length).toBeGreaterThan(0);

    // Cutting
    store().setQualityThresholds({ excellent: 60, good: 40, average: 20 });
    store().applyCuttingReport(runReport());
    const plan = planOf(project(), materialId())!;
    expect(plan.sheets.length).toBeGreaterThan(0);
    expect(plan.unplaced.length).toBe(0);
    expect(planStatus(project(), plan)).toBe('VALID');

    // Drawing → PDF-страницы
    const doc = buildDocument(project(), 'partsList');
    expect(doc).toBeTruthy();
    const pages = plan.sheets.map((s) => sheetToSvg(s, plan.statistics.materialName));
    expect(pages.every((p) => p.includes('<svg'))).toBe(true);
  });

  it('Тест 33/34/124/125: расчёт сообщает прогресс и поддаётся отмене', () => {
    makeCabinet();
    const events: number[] = [];
    const report = runCutting(project(), {
      controls: { onProgress: (p) => events.push(p.fraction) },
    });
    expect(report.jobs.length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
    expect(Math.max(...events)).toBeLessThanOrEqual(1);

    // §124: отмена прерывает расчёт исключением, а не «половинчатым» планом.
    expect(() => runCutting(project(), { controls: { shouldCancel: () => true } })).toThrow();
  });

  it('Тест 151: раскрой строится из существующей модели, вторых сущностей нет', () => {
    makeCabinet();
    const inputs = buildCuttingInputs(project());
    const partIds = new Set(allParts(project()).map((p) => String(p.id)));
    for (const inp of inputs) {
      for (const p of inp.pieces) {
        // Каждый экземпляр ссылается на существующую Part проекта.
        expect(partIds.has(String(p.partId))).toBe(true);
      }
    }
    // Профиль читается из настроек проекта, а не из своей копии.
    const profile = resolveCuttingProfile(project(), project().materials[0]);
    expect(profile.kerf).toBe(
      project().cutting.settings.kerfOverride ?? project().materials[0].kerf ?? project().settings.kerf,
    );
  });

  it('Тест 25/86: toPlan наращивает версию поверх предыдущей карты', () => {
    makeCabinet();
    const first = runReport().jobs[0];
    const planA = toPlan(project(), first);
    expect(planA.planVersion).toBe(1);
    const planB = toPlan(project(), first, planA);
    expect(planB.planVersion).toBe(2);
    expect(planB.planId).toBe(planA.planId);
  });
});
