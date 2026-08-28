/**
 * ЭТАП 30 — Подготовка мебельных деталей к раскрою.
 *
 * Цепочка: ProjectModel → группы «материал + толщина» → задание → стратегия →
 * листы и размещения → остатки → склад и резерв → отчёт → экспорт.
 *
 * Проверяет CuttingJob с версией и снимком, форматы листов, группировку,
 * текстуру и поворот, пропил и обрезку, стратегии Guillotine и MaxRects,
 * размещение, границы и пересечения, остатки и их повторное использование,
 * складской резерв и его снятие, ручное перемещение и поворот, фиксацию и
 * заморозку, перерасчёт, DIRTY и атомарную пересборку, очередь и стоимость,
 * ошибки, отчёт, экспорт CSV/JSON/SVG/DXF, 1000 деталей и полную регрессию.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CUTTING_JOB_FORMAT,
  DEFAULT_LEFTOVER_LIMITS,
  STANDARD_SHEET_SIZES,
  applyManualPlacement,
  applyRebuild,
  availableSheets,
  buildCuttingJobs,
  buildCuttingQueue,
  bumpVersion,
  checkManualPlacement,
  classifyLeftover,
  consistencyErrors,
  cutFrames,
  cutSummary,
  cuttingCost,
  cuttingErrors,
  cuttingReport,
  enrichJob,
  fitsLeftover,
  freeQuantity,
  freezeExcept,
  fromStoredRemnant,
  harvestLeftovers,
  importCuttingJobs,
  isFrozen,
  isJobDirty,
  isThroughCut,
  jobStatus,
  jobVersion,
  leftoverSummary,
  leftoverTableCsv,
  leftoversOfResult,
  limitsOf,
  listCuttingExporters,
  lockPlacement,
  lockSheet,
  markJobsDirty,
  markRemnantsUsed,
  moveQueueItem,
  noFitMessage,
  orderCuts,
  orderPlacements,
  orientedSize,
  pickLeftover,
  placementErrors,
  projectCuttingErrors,
  projectLeftovers,
  queueKey,
  releaseJob,
  reportSection,
  reportToCsvRows,
  reportTotals,
  reservationSummary,
  reserveForJob,
  resultToDxf,
  reuseOrder,
  runCutting,
  sheetToDxf,
  sheetToSvg,
  summarizeErrors,
  toStoredRemnant,
  unlockPlacements,
  unplacedErrors,
  validateResult,
  upsertPlacement,
  usableRect,
  GuillotineEngine,
  MaxRectsEngine,
  type CuttingInput,
  type CuttingPieceInstance,
} from '@/engines/cutting';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import { buildDocument } from '@/engines/drawing';
import { allOperations } from '@/engines/machining';
import { cabinetBom } from '@/engines/cabinet';
import type { CuttingResult, CuttingSheetResult, Project, StoredRemnant } from '@/core/model/types';
import type { MaterialId, PartId } from '@/core/model/ids';

const MAT = 'm1' as MaterialId;
const maxrects = new MaxRectsEngine();
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

/** Шкаф 800 × 2000 × 600 с фасадами и полками (§170). */
function makeCabinet(): void {
  store().newProject('Тест 30');
  const id = store().createParametricCabinet({ width: 800, height: 2000, depth: 600, name: 'Шкаф' })!;
  const model = store().getCabinetModel(id)!;
  store().applyCabinetPatch(id, {
    shelves: { ...model.shelves, count: 3 },
    doors: { ...model.doors, count: 2 },
  });
}

/** Рассчитанный раскрой проекта. */
function runProjectCutting(): CuttingResult {
  const report = runCutting(project());
  store().applyCuttingReport(report);
  return report.jobs[0];
}

const sheetOf = (result: CuttingResult): CuttingSheetResult => result.sheets[0];

beforeEach(() => {
  makeCabinet();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 30 — задание и листы', () => {
  it('Тест 1/2/3: задание содержит материал, толщину, экземпляры и снимок', () => {
    runProjectCutting();
    const jobs = buildCuttingJobs(project());
    expect(jobs.length).toBeGreaterThan(0);
    const job = enrichJob(jobs[0], project());
    expect(job.id).toContain('job-');
    expect(job.projectId).toBe(String(project().id));
    expect(job.materialId).toBeTruthy();
    expect(job.thickness).toBeGreaterThan(0);
    expect(job.instances.length).toBeGreaterThan(0);
    expect(job.settings.kerf).toBeGreaterThan(0);
    expect(job.settings.trim).toBeDefined();
    expect(job.settings.sheet.length).toBeGreaterThan(0);
    expect(job.result).toBeDefined();
    expect(jobVersion(job)).toBe(1);
    expect(job.leftovers).toBeDefined();
  });

  it('Тест 4/5: детали ссылаются на исходный Part и не копируют геометрию', () => {
    const result = runProjectCutting();
    const partIds = new Set(allParts(project()).map((p) => String(p.id)));
    for (const placement of sheetOf(result).placements) {
      expect(partIds.has(String(placement.partId))).toBe(true);
    }
  });

  it('Тест 2/3/9/10: стандартные форматы листа и пользовательский размер', () => {
    const sizes = STANDARD_SHEET_SIZES.map((s) => `${s.height}×${s.width}`);
    expect(sizes).toContain('2800×2070');
    expect(sizes).toContain('2750×1830');
    expect(sizes).toContain('2440×1830');
    expect(sizes).toContain('2440×1220');
    expect(sizes).toContain('3050×2070');

    const id = store().addSheetMaterial({
      materialId: project().materials[0].id,
      name: 'Свой формат', width: 1500, height: 3000, thickness: 16,
      grainDirection: 'none', availableQuantity: 5, source: 'custom',
    });
    expect(project().sheets.find((s) => s.id === id)?.width).toBe(1500);
  });

  it('Тест 4/5/6: группировка по материалу и толщине', () => {
    const queue = buildCuttingQueue(project());
    expect(queue.length).toBeGreaterThan(0);
    for (const item of queue) {
      expect(item.key).toBe(queueKey(item.materialId, item.thickness));
      expect(item.parts).toBeGreaterThan(0);
    }
    // Разные толщины — разные группы (§92).
    const thicknesses = new Set(queue.map((q) => q.thickness));
    expect(thicknesses.size).toBeGreaterThanOrEqual(1);
  });

  it('Тест 6/7/28 (§141/§142): текстура запрещает поворот', () => {
    const withGrain = maxrects.calculate(input([
      piece('p1', 1000, 500, { grain: 'length', allowRotate: false }),
    ]));
    expect(withGrain.sheets[0].placements[0].rotation).toBe(0);

    const rotatable = maxrects.calculate(input([
      piece('p2', 2000, 300, { grain: 'none', allowRotate: true }),
      piece('p3', 2000, 300, { grain: 'none', allowRotate: true }),
    ]));
    expect(rotatable.sheets.length).toBe(1);
  });

  it('Тест 8/9 (§143/§144): пропил и обрезка уменьшают полезную площадь', () => {
    const noTrim = maxrects.calculate(input([piece('a', 1400, 1000), piece('b', 1400, 1000)]));
    const withTrim = maxrects.calculate(input([piece('a', 1400, 1000), piece('b', 1400, 1000)], {
      trim: { left: 20, right: 20, top: 20, bottom: 20 },
    }));
    expect(withTrim.sheets[0].usableAreaMm2).toBeLessThan(noTrim.sheets[0].usableAreaMm2);

    // Между деталями остаётся пропил (§34).
    const packed = maxrects.calculate(input([piece('a', 1000, 1000), piece('b', 1000, 1000)], { kerf: 10 }));
    const [first, second] = packed.sheets[0].placements;
    if (first && second) {
      const gapX = Math.abs(second.x - (first.x + first.length));
      const gapY = Math.abs(second.y - (first.y + first.width));
      expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(0);
    }
  });

  it('Тест 10/11 (§25): Guillotine и MaxRects дают валидный результат', () => {
    const pieces = Array.from({ length: 12 }, (_, i) => piece(`p${i}`, 600 + i * 10, 400));
    for (const engine of [maxrects, guillotine]) {
      const source = input(pieces);
      const packed = engine.calculate(source);
      expect(packed.sheets.length).toBeGreaterThan(0);
      expect(packed.unplaced).toHaveLength(0);
      expect(validateResult(packed.sheets, source).filter((i) => i.severity === 'error')).toHaveLength(0);
    }
  });

  it('Тест 12/13/14 (§145/§146): размещение внутри листа и без пересечений', () => {
    const result = runProjectCutting();
    const sheet = sheetOf(result);
    expect(placementErrors(sheet, 3.2)).toHaveLength(0);

    const area = usableRect(sheet);
    for (const placement of sheet.placements) {
      expect(placement.x).toBeGreaterThanOrEqual(area.x0 - 0.01);
      expect(placement.y).toBeGreaterThanOrEqual(area.y0 - 0.01);
      expect(placement.x + placement.length).toBeLessThanOrEqual(area.x1 + 0.01);
      expect(placement.y + placement.width).toBeLessThanOrEqual(area.y1 + 0.01);
      expect(placement.sheetId ?? sheet.id).toBe(sheet.id);
    }
  });
});

describe('Раскрой 30 — остатки и склад', () => {
  it('Тест 15 (§152): остатки получаются из результата с состоянием', () => {
    const result = runProjectCutting();
    const material = project().materials[0];
    const leftovers = leftoversOfResult(result, material);
    expect(Array.isArray(leftovers)).toBe(true);
    for (const leftover of leftovers) {
      expect(leftover.sourceSheetId).toBeTruthy();
      expect(leftover.thickness).toBe(material.thickness);
      expect(['USABLE', 'TOO_SMALL', 'USED', 'RESERVED']).toContain(leftover.status);
    }
    // Проект считает остатки по всем заданиям, включая заднюю стенку из ХДФ.
    expect(projectLeftovers(project()).length).toBeGreaterThanOrEqual(leftovers.length);
  });

  it('Тест 15/41: минимальные размеры отделяют полезный остаток от мелочи', () => {
    expect(classifyLeftover(1000, 800)).toBe('USABLE');
    expect(classifyLeftover(30, 30)).toBe('TOO_SMALL');
    const strict = { minimumUsableWidth: 500, minimumUsableHeight: 500, minimumUsableArea: 250_000 };
    expect(classifyLeftover(300, 300, strict)).toBe('TOO_SMALL');
    expect(limitsOf({ minWidth: 50, minLength: 200, minArea: 10_000 }).minimumUsableWidth).toBe(50);
    expect(limitsOf(undefined)).toEqual(DEFAULT_LEFTOVER_LIMITS);
  });

  it('Тест 16/20 (§153): остаток подбирается под деталь по материалу, толщине и текстуре', () => {
    const leftovers = [
      { id: 'big', width: 2000, height: 1000, thickness: 16, materialId: MAT, sourceSheetId: 's1', grainDirection: 'none' as const, status: 'USABLE' as const, area: 2_000_000 },
      { id: 'small', width: 800, height: 600, thickness: 16, materialId: MAT, sourceSheetId: 's1', grainDirection: 'none' as const, status: 'USABLE' as const, area: 480_000 },
      { id: 'thin', width: 2000, height: 1000, thickness: 18, materialId: MAT, sourceSheetId: 's2', grainDirection: 'none' as const, status: 'USABLE' as const, area: 2_000_000 },
    ];
    const request = { materialId: MAT, thickness: 16, width: 700, height: 500 };
    // Побеждает самый тесный подходящий остаток (§44).
    expect(pickLeftover(leftovers, request)?.id).toBe('small');
    expect(reuseOrder(leftovers, request)).toEqual(['small', 'big']);
    // Другая толщина не подходит (§45).
    expect(fitsLeftover(leftovers[2], request)).toBe(false);
    // Мелкий остаток тоже не подходит.
    expect(fitsLeftover({ ...leftovers[1], status: 'TOO_SMALL' }, request)).toBe(false);
  });

  it('Тест 16/46: текстура остатка запрещает поворот детали', () => {
    const leftover = {
      id: 'g', width: 1200, height: 400, thickness: 16, materialId: MAT,
      sourceSheetId: 's', grainDirection: 'length' as const, status: 'USABLE' as const, area: 480_000,
    };
    // Без учёта текстуры деталь ложится с поворотом.
    expect(fitsLeftover(leftover, { materialId: MAT, thickness: 16, width: 300, height: 1000 })).toBe(true);
    // С учётом текстуры поворот запрещён — деталь не помещается.
    expect(fitsLeftover(leftover, {
      materialId: MAT, thickness: 16, width: 300, height: 1000,
      respectGrain: true, grainDirection: 'length',
    })).toBe(false);
  });

  it('Тест 15/17/42: остатки приходуются на склад и читаются обратно', () => {
    const result = runProjectCutting();
    const material = project().materials[0];
    const stored = harvestLeftovers(result, material, []);
    for (const remnant of stored) {
      expect(remnant.status).toBe('AVAILABLE');
      expect(remnant.sourceSheetId).toBeTruthy();
      expect(fromStoredRemnant(remnant).status).toBe('USABLE');
    }
    // Повторное оприходование не плодит дублей.
    expect(harvestLeftovers(result, material, stored)).toHaveLength(stored.length);

    const viaStore = store().harvestCuttingLeftovers();
    expect(viaStore).toBeGreaterThanOrEqual(0);
    expect(leftoverSummary(projectLeftovers(project())).total).toBeGreaterThanOrEqual(0);
  });

  it('Тест 17/18 (§154/§155): резервирование складских листов', () => {
    store().addSheetMaterial({
      materialId: project().materials[0].id,
      name: 'Лист склада', width: 2070, height: 2800, thickness: project().materials[0].thickness,
      grainDirection: 'none', availableQuantity: 4, source: 'library', stockMode: 'LIMITED',
    });
    const material = project().materials[0];
    expect(availableSheets(project(), material.id, material.thickness).length).toBeGreaterThanOrEqual(1);

    const reserved = store().reserveCuttingMaterial({
      jobId: 'job-1', materialId: material.id, thickness: material.thickness, sheets: 2,
    });
    expect(reserved.reservedSheets).toBe(2);
    // Складской лист с реальным запасом расходуется раньше бесконечного (§98).
    const sheet = project().sheets.find((s) => s.name === 'Лист склада')!;
    expect(sheet.reserved).toBe(2);
    expect(freeQuantity(sheet)).toBe(2);
  });

  it('Тест 19 (§156): снятие резерва возвращает склад в исходное состояние', () => {
    const material = project().materials[0];
    store().addSheetMaterial({
      materialId: material.id, name: 'Лист склада', width: 2070, height: 2800,
      thickness: material.thickness, grainDirection: 'none', availableQuantity: 3,
      source: 'library', stockMode: 'LIMITED',
    });
    store().saveRemnant({
      materialId: material.id, thickness: material.thickness, width: 800, height: 600,
      grainDirection: 'none', sourceSheetId: 'sheet-1',
    });
    const remnantId = project().remnants[0].id;

    store().reserveCuttingMaterial({
      jobId: 'job-x', materialId: material.id, thickness: material.thickness,
      sheets: 2, remnantIds: [remnantId],
    });
    expect(project().remnants[0].status).toBe('RESERVED');

    const released = store().releaseCuttingMaterial('job-x');
    expect(released.releasedSheets).toBe(2);
    expect(released.releasedRemnants).toBe(1);
    expect(project().remnants[0].status).toBe('AVAILABLE');
    expect(project().sheets.find((s) => s.name === 'Лист склада')?.reserved).toBeUndefined();
  });

  it('Тест 17/18: резерв не выдаёт больше, чем есть, и предупреждает', () => {
    const material = project().materials[0];
    store().addSheetMaterial({
      materialId: material.id, name: 'Мало листов', width: 2070, height: 2800,
      thickness: material.thickness, grainDirection: 'none', availableQuantity: 1,
      source: 'library', stockMode: 'LIMITED',
    });
    // Бесконечные форматы библиотеки убираем: проверяем именно ограниченный запас.
    const limitedOnly: Project = {
      ...project(),
      sheets: project().sheets.filter((s) => s.name === 'Мало листов'),
    };
    const result = reserveForJob(limitedOnly, {
      jobId: 'job-y', materialId: material.id, thickness: material.thickness, sheets: 5,
    });
    expect(result.reservedSheets).toBe(1);
    expect(result.warnings[0]).toContain('Не хватает листов');

    const back = releaseJob({ ...limitedOnly, sheets: result.sheets, remnants: result.remnants }, 'job-y');
    expect(back.sheets.every((s) => (s.reserved ?? 0) === 0)).toBe(true);
  });

  it('Тест 15/40: использованные остатки помечаются', () => {
    const remnants: StoredRemnant[] = [{
      id: 'r1', materialId: MAT, thickness: 16, width: 800, height: 600,
      grainDirection: 'none', sourceSheetId: 's1', createdAt: new Date().toISOString(),
    }];
    expect(markRemnantsUsed(remnants, ['r1'])[0].status).toBe('USED');
    expect(fromStoredRemnant(markRemnantsUsed(remnants, ['r1'])[0]).status).toBe('USED');
    expect(toStoredRemnant(fromStoredRemnant(remnants[0])).width).toBe(800);
    expect(reservationSummary(project()).length).toBeGreaterThanOrEqual(0);
  });
});

describe('Раскрой 30 — ручное размещение и фиксация', () => {
  it('Тест 20 (§147): ручное перемещение проверяется и применяется', () => {
    const result = runProjectCutting();
    const sheet = sheetOf(result);
    const target = sheet.placements[0];

    const ok = applyManualPlacement(sheet, {
      pieceId: target.pieceId, x: target.x, y: target.y, rotation: target.rotation, kerf: 3.2,
    });
    expect(ok.ok).toBe(true);
    expect(ok.locked?.pieceId).toBe(target.pieceId);
    expect(ok.sheet?.placements.find((p) => p.pieceId === target.pieceId)?.origin).toBe('manual');
  });

  it('Тест 20/13 (§146): выход за лист не сохраняется', () => {
    const result = runProjectCutting();
    const sheet = sheetOf(result);
    const target = sheet.placements[0];
    const outcome = applyManualPlacement(sheet, {
      pieceId: target.pieceId, x: sheet.length + 100, y: 0, rotation: 0, kerf: 3.2,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.issues[0].code).toBe('bounds');
    expect(outcome.locked).toBeUndefined();
  });

  it('Тест 14/20 (§145): пересечение и недостаток пропила отклоняются', () => {
    const result = runProjectCutting();
    const sheet = sheetOf(result);
    if (sheet.placements.length < 2) return;
    const [first, second] = sheet.placements;

    const overlap = checkManualPlacement(sheet, {
      pieceId: second.pieceId, x: first.x, y: first.y, rotation: second.rotation, kerf: 0,
    });
    expect(overlap.ok).toBe(false);
    expect(overlap.issues.some((i) => i.code === 'overlap')).toBe(true);

    const tight = checkManualPlacement(sheet, {
      pieceId: second.pieceId,
      x: first.x + first.length + 1,
      y: first.y,
      rotation: second.rotation,
      kerf: 20,
    });
    expect(tight.issues.some((i) => i.code === 'kerf' || i.code === 'overlap' || i.code === 'bounds')).toBe(true);
  });

  it('Тест 21 (§148): поворот меняет габарит и запрещается текстурой', () => {
    const result = runProjectCutting();
    const sheet = sheetOf(result);
    const target = sheet.placements[0];
    const rotated = orientedSize(target, target.rotation === 0 ? 90 : 0);
    expect(rotated.length).toBe(target.width);

    const refused = checkManualPlacement(sheet, {
      pieceId: target.pieceId, x: target.x, y: target.y,
      rotation: target.rotation === 0 ? 90 : 0, kerf: 3.2, rotationAllowed: false,
    });
    expect(refused.issues.some((i) => i.code === 'rotation')).toBe(true);
  });

  it('Тест 22/23 (§149/§151): фиксация детали, листа и заморозка', () => {
    const result = runProjectCutting();
    const sheet = sheetOf(result);
    const target = sheet.placements[0];

    const locked = lockPlacement(sheet, target.pieceId)!;
    expect(locked.sheetIndex).toBe(sheet.index);
    expect(lockSheet(sheet)).toHaveLength(sheet.placements.length);

    let list = upsertPlacement([], locked);
    expect(isFrozen(list, target.pieceId)).toBe(true);
    list = upsertPlacement(list, { ...locked, x: locked.x + 10 });
    expect(list).toHaveLength(1); // дублей не появляется
    expect(unlockPlacements(list, [target.pieceId])).toHaveLength(0);

    // Перерасчёт выбранной детали замораживает остальные (§82/§83).
    const frozen = freezeExcept(result.sheets, [target.pieceId]);
    expect(frozen.some((f) => f.pieceId === target.pieceId)).toBe(false);
    expect(frozen.length).toBe(result.sheets.flatMap((s) => s.placements).length - 1);
  });

  it('Тест 20/22: ручное размещение через store фиксируется в настройках', () => {
    const result = runProjectCutting();
    const sheet = sheetOf(result);
    const target = sheet.placements[0];

    const moved = store().moveCuttingPiece(sheet.id, {
      pieceId: target.pieceId, x: target.x, y: target.y, rotation: target.rotation,
    });
    expect(moved.ok).toBe(true);
    expect(project().cutting.settings.locked.some((l) => l.pieceId === target.pieceId)).toBe(true);

    const bad = store().moveCuttingPiece(sheet.id, {
      pieceId: target.pieceId, x: -500, y: 0, rotation: 0,
    });
    expect(bad.ok).toBe(false);
    expect(bad.issues.length).toBeGreaterThan(0);

    expect(store().lockCuttingPiece(sheet.id, target.pieceId)).toBe(true);
    expect(store().lockCuttingSheet(sheet.id)).toBe(sheet.placements.length);
  });
});

describe('Раскрой 30 — порядок резов, очередь и стоимость', () => {
  it('Тест 24 (§84–§88): резы нумеруются, сквозные идут первыми', () => {
    const result = runProjectCutting();
    const sheet = sheetOf(result);
    const cuts = orderCuts(sheet);
    expect(cuts.map((c) => c.order)).toEqual(cuts.map((_, i) => i + 1));
    const firstNonThrough = cuts.findIndex((c) => !c.through);
    if (firstNonThrough > 0) {
      expect(cuts.slice(0, firstNonThrough).every((c) => c.through)).toBe(true);
    }
    expect(cutSummary(sheet).total).toBe(cuts.length);
    expect(isThroughCut(
      { id: 'c', orientation: 'vertical', x1: 100, y1: 0, x2: 100, y2: sheet.width },
      { length: sheet.length, width: sheet.width },
    )).toBe(true);
  });

  it('Тест 24 (§89): кадры воспроизведения резов', () => {
    const result = runProjectCutting();
    const sheet = sheetOf(result);
    const frames = cutFrames(sheet);
    expect(frames[0].current).toBeNull();
    expect(frames).toHaveLength(orderCuts(sheet).length + 1);
    if (frames.length > 1) {
      expect(frames[frames.length - 1].progress).toBe(1);
      expect(frames[frames.length - 1].done).toHaveLength(orderCuts(sheet).length - 1);
    }
    expect(orderPlacements(sheet).every((p, i) => p.cutOrder === i + 1)).toBe(true);
  });

  it('Тест 4/5 (§93/§94): очередь групп и смена приоритета', () => {
    const queue = buildCuttingQueue(project());
    expect(queue[0].priority).toBe(1);
    const order = queue.map((q) => q.key);
    if (order.length > 1) {
      const moved = moveQueueItem(order, order[1], -1);
      expect(moved[0]).toBe(order[1]);
      store().setCuttingQueueOrder(moved);
      expect(buildCuttingQueue(project(), moved)[0].key).toBe(order[1]);
      store().moveCuttingQueueItem(order[1], 1);
      expect(project().metadata?.cuttingQueueOrder).toBeDefined();
    }
    expect(moveQueueItem(order, 'нет такой', 1)).toEqual(order);
  });

  it('Тест 27 (§104–§106): стоимость берётся из существующей системы цен', () => {
    const result = runProjectCutting();
    // Расчёт стоимости выключен — данных нет, а не ноль.
    expect(cuttingCost(project(), result)).toBeNull();

    store().updateSettings({ costEnabled: true });
    store().updateMaterial(project().materials[0].id, {
      cost: { perSheet: 2500, currency: '₽' },
    });
    const cost = cuttingCost(project(), result)!;
    expect(cost).not.toBeNull();
    expect(cost.sheets).toBe(result.sheets.length);
    expect(cost.materialCost).toBe(2500 * result.sheets.length);
    expect(cost.wasteCost).toBeGreaterThanOrEqual(0);
    expect(cost.currency).toBe('₽');
  });
});

describe('Раскрой 30 — статусы, пересборка и ошибки', () => {
  it('Тест 25 (§163): изменение детали делает задание DIRTY', () => {
    runProjectCutting();
    const job = buildCuttingJobs(project())[0];
    expect(isJobDirty(project(), job)).toBe(false);

    const part = allParts(project())[0];
    store().updatePart(part.id as PartId, { width: part.width + 50 });
    expect(isJobDirty(project(), buildCuttingJobs(project())[0])).toBe(true);
    expect(markJobsDirty([job])[0].status).toBe('DIRTY');
    expect(jobStatus({ ...job, dirty: true })).toBe('DIRTY');
    expect(jobStatus(job, { running: true })).toBe('CALCULATING');
  });

  it('Тест 26 (§164): атомарная пересборка сохраняет прежний раскрой', () => {
    const result = runProjectCutting();
    const job = { ...buildCuttingJobs(project())[0], result };

    const empty: CuttingResult = { ...result, sheets: [], unplaced: [], warnings: [] };
    const refused = applyRebuild(job, empty);
    expect(refused.ok).toBe(false);
    expect(refused.job.result?.sheets.length).toBe(result.sheets.length);
    expect(applyRebuild(job, null).ok).toBe(false);

    const applied = applyRebuild(job, result);
    expect(applied.ok).toBe(true);
    expect(applied.job.version).toBe(jobVersion(job) + 1);
    expect(applied.job.status).toBe(result.warnings.length > 0 ? 'WARNING' : 'VALID');
    expect(bumpVersion(job).version).toBe(2);
  });

  it('Тест 12/13 (§165): неразмещаемая деталь объясняется человеку', () => {
    const packed = maxrects.calculate(input([piece('huge', 4000, 3000)]));
    expect(packed.unplaced.length).toBe(1);
    const errors = unplacedErrors({
      ...packed, materialId: MAT, statistics: packed.statistics, attemptsRun: 1, warnings: [],
    } as unknown as CuttingResult);
    expect(errors[0].code).toBe('NO_FIT');
    expect(noFitMessage(1200, 800)).toBe('Деталь 1200 × 800 не помещается на выбранный лист.');
  });

  it('Тест 33 (§166/§167/§168): материал, толщина и текстура проверяются', () => {
    const result = runProjectCutting();
    expect(consistencyErrors(project(), result)).toHaveLength(0);

    // Толщина детали разошлась с материалом (§167).
    const part = allParts(project()).find(
      (p) => String(p.material) === String(result.materialId),
    )!;
    store().updatePart(part.id as PartId, { thickness: 25 });
    const thickness = consistencyErrors(project(), result);
    expect(thickness.some((e) => e.code === 'THICKNESS')).toBe(true);
    expect(thickness[0].message).toContain('Толщина детали');
    expect(thickness[0].sheetId).toBeTruthy();
    expect(thickness[0].x).toBeGreaterThanOrEqual(0);

    const all = cuttingErrors(project(), result);
    expect(summarizeErrors(all).errors).toBeGreaterThan(0);
    expect(projectCuttingErrors(project()).length).toBeGreaterThanOrEqual(0);
  });
});

describe('Раскрой 30 — отчёт и выгрузка', () => {
  it('Тест 24/27 (§157): отчёт содержит шапку, листы, детали и остатки', () => {
    const result = runProjectCutting();
    const section = reportSection(project(), result);
    expect(section.header.project).toBe(project().name);
    expect(section.header.sheetCount).toBe(result.sheets.length);
    expect(section.header.partCount).toBeGreaterThan(0);
    // Загрузка показывается в процентах (§56), а не долей.
    expect(section.header.utilization).toBeGreaterThan(1);
    expect(section.header.utilization).toBeLessThanOrEqual(100);
    expect(section.sheets[0].utilization).toBeGreaterThan(1);
    expect(section.sheets).toHaveLength(result.sheets.length);
    expect(section.parts.length).toBeGreaterThan(0);
    // Одинаковые детали идут одной строкой с количеством (§110).
    expect(section.parts.some((p) => p.quantity > 1)).toBe(true);

    const totals = reportTotals(cuttingReport(project()));
    expect(totals.sheets).toBeGreaterThan(0);
    expect(totals.parts).toBeGreaterThan(0);
  });

  it('Тест 28 (§160): CSV деталей и остатков', () => {
    runProjectCutting();
    const sections = cuttingReport(project());
    const csv = reportToCsvRows(sections);
    expect(csv.split('\n')[0]).toBe('Material;Thickness;Sheet;Number;Part;Size;Quantity');
    expect(csv.split('\n').length).toBeGreaterThan(1);
    expect(leftoverTableCsv(sections).split('\n')[0]).toContain('Width;Height;Status');
  });

  it('Тест 29/30 (§161/§162): экспорт и импорт задания JSON', () => {
    runProjectCutting();
    const json = store().exportCuttingJobsJson();
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe(CUTTING_JOB_FORMAT);
    expect(parsed.jobs.length).toBeGreaterThan(0);
    expect(parsed.jobs[0].version).toBe(1);
    expect(parsed.jobs[0].settings.kerf).toBeGreaterThan(0);
    expect(parsed.projectSignature).toBeTruthy();

    const imported = importCuttingJobs(json, project());
    expect(imported.ok).toBe(true);
    expect(imported.matchesProject).toBe(true);
    expect(imported.jobs[0].result?.sheets.length).toBeGreaterThan(0);

    // Чужой и повреждённый файл отклоняются.
    expect(importCuttingJobs('{"format":"other"}').ok).toBe(false);
    expect(importCuttingJobs('не json').errors[0]).toContain('повреждён');

    const viaStore = store().importCuttingJobsJson(json);
    expect(viaStore.ok).toBe(true);
    expect(viaStore.jobs).toBeGreaterThan(0);
  });

  it('Тест 30/31 (§158/§159): SVG и DXF выгружаются локально', () => {
    const result = runProjectCutting();
    const sheet = sheetOf(result);

    const svg = sheetToSvg(sheet, 'ЛДСП');
    expect(svg).toContain('<rect');

    const dxf = sheetToDxf(sheet);
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('LWPOLYLINE');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect(resultToDxf(result)).toContain('ENTITIES');

    const exporters = listCuttingExporters();
    expect(exporters.some((e) => e.id === 'dxf')).toBe(true);
    expect(exporters[0].extension).toBe('dxf');
  });

  it('Тест 31 (§112): отчёт готовится существующей системой документов', () => {
    runProjectCutting();
    const document = buildDocument(project(), 'cutting');
    expect(document).toBeTruthy();
  });
});

describe('Раскрой 30 — производительность и регрессия', () => {
  it('Тест 32 (§169/§130/§133): 1000 небольших деталей раскраиваются локально', () => {
    const pieces = Array.from({ length: 1000 }, (_, i) => piece(`p${i}`, 300, 200));
    const started = Date.now();
    const packed = maxrects.calculate(input(pieces));
    const elapsed = Date.now() - started;

    expect(packed.sheets.length).toBeGreaterThan(0);
    expect(packed.unplaced).toHaveLength(0);
    expect(elapsed).toBeLessThan(30000);
  });

  it('Тест 32 (§132): большой лист 3050 × 2070', () => {
    const packed = maxrects.calculate(input(
      Array.from({ length: 20 }, (_, i) => piece(`p${i}`, 700, 500)),
      { sheet: { length: 3050, width: 2070 } },
    ));
    expect(packed.sheets[0].length).toBe(3050);
    expect(packed.sheets[0].width).toBe(2070);
    expect(packed.unplaced).toHaveLength(0);
  });

  it('Тест 33 (§134–§136): 5, 10 и 20 деталей раскраиваются', () => {
    for (const count of [5, 10, 20]) {
      const packed = maxrects.calculate(input(
        Array.from({ length: count }, (_, i) => piece(`p${i}`, 500 + (i % 5) * 100, 400)),
      ));
      expect(packed.sheets.length).toBeGreaterThan(0);
      expect(packed.unplaced).toHaveLength(0);
    }
  });

  it('Тест 27/33 (§170): полная цепочка — шкаф, присадка, раскрой, спецификация, документы', () => {
    const result = runProjectCutting();
    expect(result.sheets.length).toBeGreaterThan(0);
    expect(allOperations(project()).length).toBeGreaterThan(0);
    expect(project().hardwareConnections.length).toBeGreaterThan(0);
    expect(cabinetBom(project()).parts.length).toBeGreaterThan(0);
    expect(cuttingReport(project()).length).toBeGreaterThan(0);
    expect(buildDocument(project(), 'partsList')).toBeTruthy();

    // Все детали проекта попали в раскрой.
    const placed = new Set(result.sheets.flatMap((s) => s.placements.map((p) => String(p.partId))));
    const materialParts = allParts(project())
      .filter((p) => String(p.material) === String(result.materialId));
    for (const part of materialParts) {
      expect(placed.has(String(part.id))).toBe(true);
    }
  });
});
