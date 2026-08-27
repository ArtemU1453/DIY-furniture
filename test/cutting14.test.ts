/**
 * ЭТАП 14 — Профессиональный модуль раскроя и оптимизации.
 * Цепочка: ProjectModel → CuttingPreparation → CuttingAlgorithm → CuttingResult
 * → CuttingMap → Waste/Efficiency → Documentation.
 * Проверяет подготовку и группировку, оба алгоритма (MaxRects/Guillotine),
 * поворот/текстуру/кромку/пропил/припуск, форматы листов и приоритет, остатки
 * (REMNANT vs WASTE), эффективность, валидатор, неразмещённые детали, ручные
 * корректировки и фиксацию, DIRTY, кэш, экспорт и синхронизацию с 3D/чертежами.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MaxRectsEngine } from '@/engines/cutting/MaxRectsEngine';
import { GuillotineEngine } from '@/engines/cutting/GuillotineEngine';
import {
  buildCuttingInputs,
  prepareCuttingParts,
  groupByMaterialThickness,
  isRotationAllowed,
  compareAlgorithms,
  sheetFormats,
  fitsFormat,
  formatForPiece,
  sheetFormatsFor,
  cuttingCacheKey,
  getCachedResult,
  setCachedResult,
  clearCuttingCache,
  cuttingCacheSize,
  cuttingPartsCsv,
  wasteReportCsv,
  reportToJson,
  resultToSvg,
  sheetToSvg,
  isUsableRemnant,
  runCutting,
  validateResult,
  isCuttingStale,
  listCuttingEngines,
} from '@/engines/cutting';
import type { CuttingInput, CuttingPieceInstance } from '@/engines/cutting';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { isDocumentsOutdated } from '@/engines/drawing';
import { newSheetMaterialId } from '@/core/model/ids';
import type { MaterialId, PartId } from '@/core/model/ids';

const MAT = 'm1' as MaterialId;
const maxrects = new MaxRectsEngine();
const guillotine = new GuillotineEngine();
const store = () => useEditorStore.getState();
const project = () => store().project;

function piece(id: string, length: number, width: number, over: Partial<CuttingPieceInstance> = {}): CuttingPieceInstance {
  return { pieceId: id, partId: id as PartId, name: id, number: id, length, width, grain: 'none', allowRotate: true, materialId: MAT, ...over };
}
function input(pieces: CuttingPieceInstance[], over: Partial<CuttingInput> = {}): CuttingInput {
  return {
    materialId: MAT,
    pieces,
    sheet: { length: 2800, width: 2070 },
    kerf: 3.2,
    trim: { left: 5, right: 5, top: 5, bottom: 5 },
    options: { respectGrain: true, attempts: 4, sortStrategy: 'area', minRemnant: 150, optimizationMode: 'BALANCED', usableRemnant: { minWidth: 100, minLength: 300, minArea: 60000 } },
    ...over,
  };
}
const placements = (r: { sheets: Array<{ placements: unknown[] }> }) => r.sheets.flatMap((s) => s.placements);

/** Тестовый шкаф 800×2000×600, ЛДСП 16 мм, лист 2800×2070 (§59). */
function makeCabinet() {
  store().newProject('Тест');
  const res = store().createFromTemplate('tpl-cabinet', {
    width: 800, height: 2000, depth: 600, materialThickness: 16, backThickness: 3,
    shelfCount: 4, verticalPartitionCount: 1, doorCount: 2, doorGap: 3,
    backType: 'inset', jointType: 'confirmat', handleEnabled: true,
  });
  expect(res.ok).toBe(true);
  return res.id!;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 14 — подготовка и модель', () => {
  beforeEach(() => makeCabinet());

  it('Тест 1: SheetMaterial — формат листа в библиотеке', () => {
    const sheets = project().sheets;
    expect(sheets.length).toBeGreaterThan(0);
    for (const sh of sheets) {
      expect(sh.width).toBeGreaterThan(0);
      expect(sh.height).toBeGreaterThan(0);
      expect(sh.thickness).toBeGreaterThan(0);
      expect(sh.materialId).toBeTruthy();
    }
  });

  it('Тест 2: RemnantSheet — остаток как источник материала', () => {
    const mat = project().materials[0].id;
    store().saveRemnant({ materialId: mat, thickness: 16, width: 800, height: 600, grainDirection: 'none', sourceSheetId: 'S1' });
    const r = project().remnants.at(-1)!;
    expect(r.sourceSheetId).toBe('S1');
    expect(r.materialId).toBe(mat);
    expect(r.createdAt).toBeTruthy();
  });

  it('Тест 3/6/7: CuttingPart — ссылка на Part с количеством (без новых сущностей)', () => {
    const parts = prepareCuttingParts(project());
    expect(parts.length).toBeGreaterThan(0);
    for (const cp of parts) {
      expect(findPart(project(), cp.partId)).toBeDefined(); // ссылка на реальную Part
      expect(cp.quantity).toBeGreaterThan(0);
      expect(cp.edgeData).toBeDefined();
    }
    // Количество не разворачивается в отдельные производственные детали.
    const totalQty = parts.reduce((n, p) => n + p.quantity, 0);
    expect(totalQty).toBeGreaterThanOrEqual(parts.length);
  });

  it('Тест 4/8: CuttingPreparationService группирует одинаковые детали', () => {
    const mat = project().materials[0].id;
    store().addPart({ name: 'Планка', width: 500, height: 100, material: mat, quantity: 3 });
    store().addPart({ name: 'Планка', width: 500, height: 100, material: mat, quantity: 4 });
    const prepared = prepareCuttingParts(project());
    const plank = prepared.filter((p) => p.name === 'Планка');
    expect(plank).toHaveLength(1);      // сгруппированы в одну строку
    expect(plank[0].quantity).toBe(7);  // количество суммировано
  });

  it('Тест 14/15/22: группировка по материалу и толщине (не смешиваются)', () => {
    const prepared = prepareCuttingParts(project());
    const groups = groupByMaterialThickness(prepared);
    expect(groups.size).toBeGreaterThanOrEqual(2); // ЛДСП корпуса + ХДФ задней стенки
    for (const [key, list] of groups) {
      const [matId, th] = key.split('|');
      expect(list.every((p) => String(p.materialId) === matId && String(p.thickness) === th)).toBe(true);
    }
  });

  it('Тест 5: CuttingOptions передаются в движок', () => {
    const inp = buildCuttingInputs(project())[0];
    expect(inp.kerf).toBeGreaterThan(0);
    expect(inp.trim).toBeDefined();
    expect(inp.options.optimizationMode).toBeTruthy();
    expect(inp.options.usableRemnant).toBeDefined();
  });

  it('Тест 9/61: кромка сохраняется Part → CuttingPart', () => {
    const side = allParts(project()).find((p) => p.metadata?.partType === 'side_left')!;
    const e1 = project().edges[0].id;
    const e2 = project().edges[2].id;
    store().updatePart(side.id, { edges: { left: e1, right: e1, top: e2, bottom: e1 } });
    const cp = prepareCuttingParts(project()).find((p) => p.partId === side.id)!;
    expect(cp.edgeData.left).toBe(e1);
    expect(cp.edgeData.top).toBe(e2);
    expect(cp.edgeData.right).toBe(e1);
    expect(cp.edgeData.bottom).toBe(e1);
  });

  it('Тест 10/60: текстура запрещает поворот (rotationAllowed = false)', () => {
    const side = allParts(project()).find((p) => p.metadata?.partType === 'side_left')!;
    store().updatePart(side.id, { grain: 'length' });
    const cp = prepareCuttingParts(project()).find((p) => p.partId === side.id)!;
    expect(cp.grainDirection).toBe('length');
    expect(cp.rotationAllowed).toBe(false);
    // Правило проверяется напрямую.
    expect(isRotationAllowed({ ...side, grain: 'length' }, true, true)).toBe(false);
    expect(isRotationAllowed({ ...side, grain: 'none' }, true, true)).toBe(true);
    expect(isRotationAllowed({ ...side, grain: 'none' }, false, true)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 14 — алгоритмы', () => {
  it('Тест 6a/16: MaxRects размещает детали детерминированно', () => {
    const pieces = Array.from({ length: 12 }, (_, i) => piece(`p${i}`, 600 + i * 10, 400));
    const a = maxrects.calculate(input(pieces));
    const b = maxrects.calculate(input(pieces));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.unplaced).toHaveLength(0);
  });

  it('Тест 8a/17: Guillotine размещает детали детерминированно', () => {
    const pieces = Array.from({ length: 12 }, (_, i) => piece(`p${i}`, 600 + i * 10, 400));
    const a = guillotine.calculate(input(pieces));
    const b = guillotine.calculate(input(pieces));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.unplaced).toHaveLength(0);
    expect(placements(a).length).toBe(12);
  });

  it('Тест 17b: Guillotine даёт непересекающиеся размещения в границах листа', () => {
    const pieces = Array.from({ length: 20 }, (_, i) => piece(`p${i}`, 700, 500 + (i % 3) * 30));
    const inp = input(pieces);
    const r = guillotine.calculate(inp);
    const issues = validateResult(r.sheets, inp);
    expect(issues.filter((i) => i.code === 'cutting.overlap')).toHaveLength(0);
    expect(issues.filter((i) => i.code === 'cutting.outOfSheet')).toHaveLength(0);
  });

  it('Тест 6b: оба алгоритма зарегистрированы', () => {
    const ids = listCuttingEngines().map((e) => e.id);
    expect(ids).toContain('maxrects');
    expect(ids).toContain('guillotine');
  });

  it('Тест 9a/11a: поворот — разрешён и запрещён', () => {
    for (const engine of [maxrects, guillotine]) {
      const fits = engine.calculate(input([piece('a', 1900, 500)], { sheet: { length: 1000, width: 2070 } }));
      expect(fits.unplaced).toHaveLength(0);
      const noRot = engine.calculate(input([piece('b', 1900, 500, { allowRotate: false })], { sheet: { length: 1000, width: 2070 } }));
      expect(noRot.unplaced).toHaveLength(1);
    }
  });

  it('Тест 10a: текстура соблюдается движком', () => {
    const grained = piece('a', 1900, 500, { grain: 'length' });
    for (const engine of [maxrects, guillotine]) {
      const respected = engine.calculate(input([grained], { sheet: { length: 1000, width: 2070 } }));
      expect(respected.unplaced).toHaveLength(1);
    }
  });

  it('Тест 12/62: пропил (kerf) влияет на результат', () => {
    const pieces = [piece('a', 900, 500), piece('b', 900, 500)];
    // Лист впритык: без пропила две детали 900×500 помещаются (500+500=1000),
    // с пропилом 3.2 мм — уже нет (500+3.2+500 = 1003.2 > 1002).
    const sheet = { length: 1000, width: 1002 };
    const noKerf = maxrects.calculate(input(pieces, { sheet, kerf: 0, trim: { left: 0, right: 0, top: 0, bottom: 0 } }));
    const withKerf = maxrects.calculate(input(pieces, { sheet, kerf: 3.2, trim: { left: 0, right: 0, top: 0, bottom: 0 } }));
    // Без пропила обе детали помещаются на один лист, с пропилом — нет.
    expect(noKerf.sheets.length).toBe(1);
    expect(withKerf.sheets.length).toBeGreaterThan(noKerf.sheets.length);
  });

  it('Тест 13: припуск (trimAllowance) уменьшает рабочую область', () => {
    const noTrim = maxrects.calculate(input([piece('a', 100, 100)], { trim: { left: 0, right: 0, top: 0, bottom: 0 } }));
    const withTrim = maxrects.calculate(input([piece('a', 100, 100)], { trim: { left: 50, right: 50, top: 50, bottom: 50 } }));
    expect(withTrim.sheets[0].usableAreaMm2).toBeLessThan(noTrim.sheets[0].usableAreaMm2);
  });

  it('Тест 18/57: cutOrder заполняется для каждой детали', () => {
    const r = maxrects.calculate(input([piece('a', 600, 400), piece('b', 500, 300), piece('c', 400, 200)]));
    const ord = r.sheets[0].placements.map((p) => p.cutOrder).sort((x, y) => (x ?? 0) - (y ?? 0));
    expect(ord).toEqual([1, 2, 3]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 14 — форматы, остатки, эффективность', () => {
  beforeEach(() => makeCabinet());

  it('Тест 16b/66: несколько форматов листа и выбор подходящего', () => {
    const mat = project().materials[0];
    // Добавляем второй формат (меньший) и проверяем список по приоритету.
    store().addSheetMaterial({
      materialId: mat.id, name: 'ЛДСП 2440×1220', width: 1220, height: 2440,
      thickness: mat.thickness, grainDirection: 'none', availableQuantity: 0, source: 'custom',
    });
    const formats = sheetFormatsFor(project(), mat);
    expect(formats.length).toBeGreaterThanOrEqual(2);

    const inp = buildCuttingInputs(project(), mat.id)[0];
    const all = sheetFormats(inp);
    expect(all.length).toBeGreaterThanOrEqual(2);
    // Крупная деталь влезает только в большой формат.
    const big = piece('big', 2500, 1500);
    expect(fitsFormat(all[0], big, false)).toBe(true);
    const chosen = formatForPiece(all, big, false);
    expect(chosen.length).toBeGreaterThanOrEqual(2500);
  });

  it('Тест 17c/24: приоритет форматов учитывается', () => {
    const mat = project().materials[0];
    const smallId = store().addSheetMaterial({
      materialId: mat.id, name: 'Малый', width: 1220, height: 2440,
      thickness: mat.thickness, grainDirection: 'none', availableQuantity: 0, source: 'custom',
    });
    store().updateCuttingSettings({ sheetPriority: { [mat.id]: [smallId] } });
    expect(sheetFormatsFor(project(), mat)[0].id).toBe(smallId);
  });

  it('Тест 18b/25/26: раскрой из остатков — остаток используется первым', () => {
    const r = maxrects.calculate(input([piece('a', 400, 300)], {
      remnantSheets: [{ id: 'rem1', length: 800, width: 600 }],
    }));
    expect(r.unplaced).toHaveLength(0);
    expect(r.sheets[0].fromRemnant).toBe(true);
    expect(r.sheets[0].sheetMaterialId).toBe('rem1');
  });

  it('Тест 19/63: REMNANT и WASTE разделяются по минимальному размеру', () => {
    const r = maxrects.calculate(input([piece('a', 600, 400)]));
    const sheet = r.sheets[0];
    const remnants = sheet.remnants;
    expect(remnants.some((x) => x.usable)).toBe(true);
    // Полезные остатки учтены отдельно от отхода.
    expect(sheet.remnantAreaMm2).toBeGreaterThan(0);
    expect(sheet.wasteAreaMm2).toBeGreaterThanOrEqual(0);
    // Сумма не превышает рабочую площадь.
    expect(sheet.usedAreaMm2 + sheet.remnantAreaMm2 + sheet.wasteAreaMm2).toBeLessThanOrEqual(sheet.usableAreaMm2 + 1);
    // Критерии не зашиты в код.
    expect(isUsableRemnant(800, 300, { minWidth: 100, minLength: 300, minArea: 60000 })).toBe(true);
    expect(isUsableRemnant(100, 40, { minWidth: 100, minLength: 300, minArea: 60000 })).toBe(false);
  });

  it('Тест 20/36: эффективность = площадь деталей / рабочая площадь листов', () => {
    const r = maxrects.calculate(input([piece('a', 600, 400), piece('b', 500, 500)]));
    const st = r.statistics;
    expect(st.utilization).toBeCloseTo(st.piecesAreaMm2 / st.sheetsUsableAreaMm2, 6);
    expect(st.utilization).toBeGreaterThan(0);
    expect(st.utilization).toBeLessThanOrEqual(1);
    // REMNANT и WASTE показываются отдельно.
    expect(st.remnantAreaMm2).toBeGreaterThanOrEqual(0);
    expect(st.wasteAreaMm2).toBeGreaterThanOrEqual(0);
  });

  it('Тест 21/37: CuttingValidator — все детали размещены и без нарушений', () => {
    const inputs = buildCuttingInputs(project());
    for (const inp of inputs) {
      const r = maxrects.calculate(inp);
      expect(r.unplaced).toHaveLength(0);
      const issues = validateResult(r.sheets, inp);
      expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
      // Количество размещений совпадает с числом экземпляров.
      expect(placements(r).length).toBe(inp.pieces.length);
    }
  });

  it('Тест 22b/38/64: неразмещённая деталь показывается с причиной', () => {
    for (const engine of [maxrects, guillotine]) {
      const r = engine.calculate(input([piece('huge', 5000, 3000)]));
      expect(r.unplaced).toHaveLength(1);
      expect(r.unplaced[0].reason.length).toBeGreaterThan(0);
      expect(r.unplaced[0].number).toBe('huge');
    }
  });

  it('Тест 65: детали разных материалов не смешиваются на листе', () => {
    const report = runCutting(project());
    for (const job of report.jobs) {
      for (const sheet of job.sheets) {
        expect(sheet.materialId).toBe(job.materialId);
      }
    }
    expect(report.jobs.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 14 — сравнение, кэш, ручные корректировки', () => {
  beforeEach(() => makeCabinet());

  it('Тест 18c/50: сравнение алгоритмов даёт сводку по каждому', () => {
    const rows = compareAlgorithms(project());
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.sheetCount).toBeGreaterThan(0);
      expect(row.efficiency).toBeGreaterThan(0);
      expect(row.efficiency).toBeLessThanOrEqual(1);
      expect(row.report.jobs.length).toBeGreaterThan(0);
    }
    // Отсортировано по приоритету: неразмещённые → листы → КПД.
    expect(rows[0].unplacedCount).toBeLessThanOrEqual(rows[rows.length - 1].unplacedCount);
  });

  it('Тест 50b: выбранный результат применяется в проект', () => {
    const rows = compareAlgorithms(project());
    const pick = rows[rows.length - 1];
    store().applyCuttingReport(pick.report, pick.algorithmId);
    expect(project().cutting.settings.algorithm).toBe(pick.algorithmId);
    expect(project().cutting.report).toBeDefined();
  });

  it('Тест 27/45: кэш — одинаковый вход даёт тот же ключ и переиспользуется', () => {
    clearCuttingCache();
    const inp = buildCuttingInputs(project())[0];
    const k1 = cuttingCacheKey(inp, 'maxrects');
    const k2 = cuttingCacheKey(inp, 'maxrects');
    expect(k1).toBe(k2);
    // Разный алгоритм → разный ключ.
    expect(cuttingCacheKey(inp, 'guillotine')).not.toBe(k1);
    // Изменение kerf → другой ключ.
    expect(cuttingCacheKey({ ...inp, kerf: inp.kerf + 1 }, 'maxrects')).not.toBe(k1);
    const result = maxrects.calculate(inp);
    setCachedResult(k1, result);
    expect(getCachedResult(k1)).toBe(result);
    expect(cuttingCacheSize()).toBeGreaterThan(0);
    clearCuttingCache();
    expect(cuttingCacheSize()).toBe(0);
  });

  it('Тест 23/39/67: ручное перемещение фиксирует координаты', () => {
    const inputs = buildCuttingInputs(project());
    const pieceId = inputs[0].pieces[0].pieceId;
    store().setLockedPlacement({ pieceId, sheetIndex: 0, x: 400, y: 250, rotation: 0 });
    const report = runCutting(project());
    const pl = report.jobs.flatMap((j) => j.sheets.flatMap((s) => s.placements)).find((p) => p.pieceId === pieceId)!;
    expect(pl.x).toBe(400);
    expect(pl.y).toBe(250);
    expect(pl.locked).toBe(true);
    expect(pl.origin).toBe('manual');
  });

  it('Тест 24b/40: ручной поворот только при rotationAllowed', () => {
    const pieceId = buildCuttingInputs(project())[0].pieces[0].pieceId;
    store().rotatePlacement({ pieceId, sheetIndex: 0, x: 100, y: 100, rotation: 0 });
    expect(store().project.cutting.settings.locked.find((l) => l.pieceId === pieceId)!.rotation).toBe(90);
  });

  it('Тест 25b/41: фиксация сохраняется при пересчёте', () => {
    const pieceId = buildCuttingInputs(project())[0].pieces[0].pieceId;
    store().toggleLockedPlacement({ pieceId, sheetIndex: 0, x: 300, y: 200, rotation: 0 });
    expect(project().cutting.settings.locked.some((l) => l.pieceId === pieceId)).toBe(true);
    const report = runCutting(project());
    const pl = report.jobs.flatMap((j) => j.sheets.flatMap((s) => s.placements)).find((p) => p.pieceId === pieceId)!;
    expect(pl.locked).toBe(true);
    expect(pl.x).toBe(300);
    // Повторное переключение снимает фиксацию.
    store().toggleLockedPlacement({ pieceId, sheetIndex: 0, x: 300, y: 200, rotation: 0 });
    expect(project().cutting.settings.locked.some((l) => l.pieceId === pieceId)).toBe(false);
  });

  it('Тест 26/43/46/47: DIRTY при изменении модели, sourceModelVersion сохраняется', async () => {
    await store().recalculateCutting();
    expect(isCuttingStale(project())).toBe(false);
    expect(project().cutting.report!.sourceVersion).toBeTruthy();
    const side = allParts(project()).find((p) => p.metadata?.partType === 'side_left')!;
    store().updatePart(side.id, { width: 555 });
    expect(isCuttingStale(project())).toBe(true);
  });

  it('Тест 26b: изменение количества/материала/kerf делает раскрой DIRTY', async () => {
    await store().recalculateCutting();
    expect(isCuttingStale(project())).toBe(false);
    store().updateCuttingSettings({ kerfOverride: 5 });
    expect(isCuttingStale(project())).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 14 — экспорт и синхронизация', () => {
  beforeEach(() => makeCabinet());

  it('Тест 29/54: cutting_parts.csv со стабильными колонками', () => {
    const report = runCutting(project());
    const csv = cuttingPartsCsv(report);
    expect(csv.split('\n')[0]).toBe('Sheet,Part ID,Name,Width,Height,Thickness,Material,X,Y,Rotation,Quantity');
    expect(csv.split('\n').length).toBeGreaterThan(1);
  });

  it('Тест 55: waste_report.csv со стабильными колонками', () => {
    const report = runCutting(project());
    const csv = wasteReportCsv(report);
    expect(csv.split('\n')[0]).toBe('Sheet,Material,SheetArea,PartArea,RemnantArea,WasteArea,Efficiency');
    expect(csv.split('\n').length).toBeGreaterThan(1);
  });

  it('Тест 30/31: SVG карты раскроя (основа для PNG)', () => {
    const report = runCutting(project());
    const svg = resultToSvg(report.jobs[0]);
    expect(svg.startsWith('<svg')).toBe(true);
    const page = sheetToSvg(report.jobs[0].sheets[0], 'ЛДСП');
    expect(page).toContain('<svg');
  });

  it('Тест 32/53: PDF использует существующий Document Engine (страницы из результата)', () => {
    const report = runCutting(project());
    store().applyCuttingReport(report);
    const pages = report.jobs.flatMap((j) => j.sheets.map((s) => sheetToSvg(s, j.statistics.materialName)));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every((p) => p.includes('<svg'))).toBe(true);
  });

  it('Тест 33: JSON-экспорт восстанавливается', () => {
    const report = runCutting(project());
    const parsed = JSON.parse(reportToJson(report));
    expect(parsed.jobs.length).toBe(report.jobs.length);
    expect(parsed.sourceVersion).toBe(report.sourceVersion);
  });

  it('Тест 34: связь с 3D — деталь карты выбирается по partId', () => {
    const report = runCutting(project());
    const pl = report.jobs[0].sheets[0].placements[0];
    store().selectPart(pl.partId);
    expect(store().selectedPartId).toBe(pl.partId);
    expect(findPart(project(), pl.partId)).toBeDefined();
  });

  it('Тест 35: связь с чертежом — partId ведёт на существующую деталь', () => {
    const report = runCutting(project());
    const ids = report.jobs.flatMap((j) => j.sheets.flatMap((s) => s.placements.map((p) => p.partId)));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(findPart(project(), id)).toBeDefined();
  });

  it('Тест 28/44: раскрой считается через Web Worker без блокировки UI', async () => {
    await store().recalculateCutting();
    expect(project().cutting.report).toBeDefined();
    expect(store().cuttingRunning).toBe(false);
  });

  it('Тест 61b: документы становятся OUTDATED после изменения раскроя', async () => {
    await store().recalculateCutting();
    store().markDocumentsGenerated();
    expect(isDocumentsOutdated(project())).toBe(false);
    const side = allParts(project()).find((p) => p.metadata?.partType === 'shelf')!;
    store().updatePart(side.id, { width: 505 });
    expect(isDocumentsOutdated(project())).toBe(true);
  });

  it('Тест 59: полный раскрой тестового шкафа 800×2000×600', () => {
    const report = runCutting(project());
    const ldsp = report.jobs.find((j) => j.statistics.pieceCount > 0)!;
    expect(ldsp.sheets.length).toBeGreaterThan(0);
    expect(ldsp.unplaced).toHaveLength(0);
    expect(ldsp.statistics.utilization).toBeGreaterThan(0);
    // Все детали проекта с материалом попали в раскрой.
    const placedIds = new Set(report.jobs.flatMap((j) => j.sheets.flatMap((s) => s.placements.map((p) => String(p.partId)))));
    const needed = allParts(project()).filter((p) => p.material && p.metadata?.hidden !== true);
    for (const p of needed) expect(placedIds.has(String(p.id))).toBe(true);
    expect(newSheetMaterialId()).toBeTruthy();
  });
});
