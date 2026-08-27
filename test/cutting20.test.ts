/**
 * ЭТАП 20 — Автоматический раскрой листовых материалов.
 * Цепочка: ProjectModel → Parts → Material → CuttingJob → CuttingEngine →
 * CuttingResult → карта → остатки → спецификация → PDF/SVG/PNG/CSV.
 *
 * Проверяет задания и экземпляры деталей, коды причин неразмещения, версию и
 * снимок настроек алгоритма, воспроизводимость, пропил и припуск, поворот,
 * текстуру, кромку, остатки и их состояния, отходы и КПД, мультиматериал,
 * атомарность результата и восстановление после ошибки, экспорт и интеграции.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MaxRectsEngine } from '@/engines/cutting/MaxRectsEngine';
import { GuillotineEngine } from '@/engines/cutting/GuillotineEngine';
import {
  buildCuttingInputs,
  buildCuttingJobs,
  classifyUnplaced,
  cuttingCsv,
  cuttingSummary,
  cuttingSummaryCsv,
  instanceCounts,
  instanceId,
  instanceLabel,
  instancesOf,
  isCuttingStale,
  isUsableRemnant,
  jobId,
  listCuttingEngines,
  parseInstance,
  placementLabel,
  remnantsCsv,
  reportToJson,
  resultToSvg,
  runCutting,
  seedFor,
  sheetFormats,
  sheetToSvg,
  snapshotOf,
  statusOf,
  unplacedMessage,
  validateJobConsistency,
  validateResult,
} from '@/engines/cutting';
import type { CuttingInput, CuttingPieceInstance } from '@/engines/cutting';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { buildDocument } from '@/engines/drawing';
import type { CuttingReport, CuttingResult, Project } from '@/core/model/types';
import type { MaterialId, PartId } from '@/core/model/ids';

const MAT = 'm1' as MaterialId;
const maxrects = new MaxRectsEngine();
const guillotine = new GuillotineEngine();
const store = () => useEditorStore.getState();
const project = (): Project => store().project;

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
    options: {
      respectGrain: true, attempts: 4, sortStrategy: 'area', minRemnant: 150,
      optimizationMode: 'BALANCED', usableRemnant: { minWidth: 100, minLength: 300, minArea: 60_000 },
    },
    ...over,
  };
}

/** Тестовый шкаф 800×2000×600, ЛДСП 16 мм (§93). */
function makeCabinet(): void {
  store().newProject('Тест 20');
  const res = store().createFromTemplate('tpl-cabinet', {
    width: 800, height: 2000, depth: 600, materialThickness: 16, backThickness: 3,
    shelfCount: 4, verticalPartitionCount: 1, doorCount: 2, doorGap: 3,
    backType: 'inset', jointType: 'confirmat', handleEnabled: true,
  });
  expect(res.ok).toBe(true);
}

const allPlacements = (r: CuttingResult) => r.sheets.flatMap((s) => s.placements);
const report = (): CuttingReport => runCutting(project());

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 20 — задание и экземпляры', () => {
  beforeEach(makeCabinet);

  it('Тест 1: CuttingJob — задание на каждый материал проекта', () => {
    const jobs = buildCuttingJobs(project());
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.id).toBe(jobId(String(project().id), String(job.materialId), job.thickness));
      expect(job.projectId).toBe(String(project().id));
      expect(job.materialId).toBeTruthy();
      expect(job.thickness).toBeGreaterThan(0);
      expect(job.instances.length).toBeGreaterThan(0);
      expect(job.createdAt).toBeTruthy();
      expect(job.updatedAt).toBeTruthy();
    }
  });

  it('Тест 2/5: CuttingPart ссылается на существующий PartModel', () => {
    // Ключевое требование §5/§81: второй системы деталей не заводится.
    for (const job of buildCuttingJobs(project())) {
      for (const inst of job.instances) {
        expect(findPart(project(), inst.partId)).toBeDefined();
      }
    }
  });

  it('Тест 5/38/80: CuttingInstance — экземпляры одной детали', () => {
    expect(instanceId('P001', 3)).toBe('P001#3');
    const parsed = parseInstance('abc-123#7');
    expect(parsed).toEqual({ id: 'abc-123#7', partId: 'abc-123', instanceIndex: 7 });
    // Некорректные значения не разбираются.
    expect(parseInstance('нет-решётки')).toBeNull();
    expect(parseInstance('x#0')).toBeNull();
    expect(parseInstance('x#abc')).toBeNull();
  });

  it('Тест 79: метка экземпляра P001-3, а одиночная деталь остаётся P001', () => {
    expect(instanceLabel('P001', 1, 1)).toBe('P001');
    expect(instanceLabel('P001', 3, 4)).toBe('P001-3');
    const res = maxrects.calculate(input([
      piece('a#1', 600, 400, { number: 'P001', partId: 'a' as PartId }),
      piece('a#2', 600, 400, { number: 'P001', partId: 'a' as PartId }),
      piece('b#1', 500, 300, { number: 'P002', partId: 'b' as PartId }),
    ]));
    const counts = instanceCounts(allPlacements(res));
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    const labels = allPlacements(res).map((p) => placementLabel(p, counts)).sort();
    expect(labels).toEqual(['P001-1', 'P001-2', 'P002']);
  });

  it('Тест 78/81: количество > 1 не создаёт новые PartModel', () => {
    const partsBefore = allParts(project()).length;
    const jobs = buildCuttingJobs(project());
    const totalInstances = jobs.reduce((n, j) => n + j.instances.length, 0);
    // Экземпляров может быть больше, чем деталей (quantity > 1) …
    expect(totalInstances).toBeGreaterThanOrEqual(partsBefore);
    // … но сама модель деталей не выросла.
    expect(allParts(project()).length).toBe(partsBefore);
  });

  it('Тест 25/26: задание однородно по материалу и толщине', () => {
    for (const job of buildCuttingJobs(project())) {
      expect(validateJobConsistency(job, project())).toEqual([]);
    }
  });

  it('Тест 3: статус задания отражает результат', () => {
    expect(statusOf(undefined)).toBe('PENDING');
    expect(statusOf({ unplaced: [] } as unknown as CuttingResult)).toBe('DONE');
    expect(statusOf({ unplaced: [{}] } as unknown as CuttingResult)).toBe('ERROR');
  });

  it('Тест 39: полный раскрой тестового шкафа', () => {
    const rep = report();
    expect(rep.jobs.length).toBeGreaterThan(0);
    const main = rep.jobs.find((j) => j.statistics.pieceCount > 5)!;
    expect(main.sheets.length).toBeGreaterThan(0);
    expect(main.unplaced).toEqual([]);
    expect(main.statistics.utilization).toBeGreaterThan(0);
    expect(main.statistics.utilization).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 20 — размещение, поворот, текстура, кромка', () => {
  it('Тест 3/4/7/8/9: координаты внутри листа, детали не пересекаются', () => {
    const inp = input([piece('a', 800, 600), piece('b', 1984, 600), piece('c', 768, 600), piece('d', 400, 300)]);
    const res = maxrects.calculate(inp);
    expect(validateResult(res.sheets, inp).filter((i) => i.severity === 'error')).toEqual([]);
    for (const sheet of res.sheets) {
      for (const p of sheet.placements) {
        expect(p.x).toBeGreaterThanOrEqual(inp.trim.left - 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(inp.trim.bottom - 1e-6);
        expect(p.x + p.length).toBeLessThanOrEqual(sheet.length - inp.trim.right + 1e-6);
        expect(p.y + p.width).toBeLessThanOrEqual(sheet.width - inp.trim.top + 1e-6);
      }
    }
  });

  it('Тест 11/94: rotationAllowed управляет поворотом', () => {
    // Узкая полоса поперёк листа: без поворота не влезает, с поворотом — да.
    const tall = piece('tall', 300, 2000, { allowRotate: true });
    const withRotation = maxrects.calculate(input([tall], { sheet: { length: 2800, width: 400 } }));
    expect(withRotation.unplaced).toEqual([]);
    expect(allPlacements(withRotation)[0].rotation).toBe(90);

    const locked = maxrects.calculate(
      input([piece('tall', 300, 2000, { allowRotate: false })], { sheet: { length: 2800, width: 400 } }),
    );
    expect(locked.unplaced).toHaveLength(1);
    expect(locked.unplaced[0].code).toBe('DETAIL_TOO_LARGE');
  });

  it('Тест 12/95: текстура запрещает недопустимый поворот', () => {
    const grained = piece('g', 300, 2000, { grain: 'length', allowRotate: true });
    // respectGrain = true → поворот запрещён, деталь не помещается.
    const strict = maxrects.calculate(input([grained], { sheet: { length: 2800, width: 400 } }));
    expect(strict.unplaced).toHaveLength(1);

    // respectGrain = false → тот же лист, деталь размещается поворотом.
    const relaxed = maxrects.calculate(input([grained], {
      sheet: { length: 2800, width: 400 },
      options: { ...input([]).options, respectGrain: false },
    }));
    expect(relaxed.unplaced).toEqual([]);
    expect(allPlacements(relaxed)[0].rotation).toBe(90);
  });

  it('Тест 13/15/70: кромка сохраняется при повороте детали', () => {
    makeCabinet();
    const rep = report();
    const edged = allParts(project()).find((p) => Object.values(p.edges).some((e) => e !== null));
    // Кромка живёт на Part и не переписывается раскроем: поворот — свойство
    // размещения, а не детали (§15/§48).
    const before = edged ? { ...edged.edges } : null;
    expect(rep.jobs.length).toBeGreaterThan(0);
    const after = edged ? findPart(project(), edged.id)!.edges : null;
    expect(after).toEqual(before);
  });

  it('Тест 48: настройки раскроя не меняют размеры деталей', () => {
    makeCabinet();
    const dims = allParts(project()).map((p) => `${p.id}:${p.width}x${p.height}x${p.thickness}`);
    store().updateCuttingSettings({ kerf: 8 } as never);
    store().updateCuttingSettings({ respectGrain: false });
    expect(allParts(project()).map((p) => `${p.id}:${p.width}x${p.height}x${p.thickness}`)).toEqual(dims);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 20 — пропил, припуск, форматы', () => {
  it('Тест 14/96: изменение пропила меняет результат', () => {
    const pieces = Array.from({ length: 12 }, (_, i) => piece(`p${i}`, 700, 500));
    const thin = maxrects.calculate(input(pieces, { kerf: 0 }));
    const thick = maxrects.calculate(input(pieces, { kerf: 40 }));
    // Толстый пропил съедает материал: либо меняются координаты, либо листов
    // становится больше.
    const coords = (r: CuttingResult) => allPlacements(r).map((p) => `${p.x},${p.y}`).join('|');
    expect(coords(thin) !== coords(thick) || thin.sheets.length !== thick.sheets.length).toBe(true);
  });

  it('Тест 15/97: припуск уменьшает полезную область листа', () => {
    const noTrim = maxrects.calculate(input([piece('a', 600, 400)], { trim: { left: 0, right: 0, top: 0, bottom: 0 } }));
    const bigTrim = maxrects.calculate(input([piece('a', 600, 400)], { trim: { left: 100, right: 100, top: 100, bottom: 100 } }));
    expect(bigTrim.sheets[0].usableAreaMm2).toBeLessThan(noTrim.sheets[0].usableAreaMm2);
    // Деталь смещается внутрь на величину припуска.
    expect(allPlacements(bigTrim)[0].x).toBeGreaterThanOrEqual(100 - 1e-6);
  });

  it('Тест 21/23/24: форматы листа перебираются по приоритету', () => {
    const formats = sheetFormats(input([], {
      sheet: { length: 2800, width: 2070 },
      alternateSheets: [{ id: 'alt', length: 3500, width: 2100, availableQuantity: 0 }],
    }));
    expect(formats).toHaveLength(2);
    expect(formats[0].length).toBe(2800);
    expect(formats[1].id).toBe('alt');
    // Деталь длиннее основного формата уходит на альтернативный (§24).
    const res = maxrects.calculate(input([piece('long', 3200, 500, { allowRotate: false })], {
      sheet: { length: 2800, width: 2070 },
      alternateSheets: [{ id: 'alt', length: 3500, width: 2100, availableQuantity: 0 }],
    }));
    expect(res.unplaced).toEqual([]);
    expect(res.sheets[0].sheetMaterialId).toBe('alt');
  });

  it('Тест 9/16: интерфейс алгоритма заменяем, оба движка зарегистрированы', () => {
    const ids = listCuttingEngines().map((e) => e.id);
    expect(ids).toContain('maxrects');
    expect(ids).toContain('guillotine');
    for (const engine of listCuttingEngines()) {
      expect(engine.version).toBeTruthy();
      expect(typeof engine.calculate).toBe('function');
    }
  });

  it('Тест 10: гильотинный движок даёт валидный результат на тех же данных', () => {
    const inp = input([piece('a', 800, 600), piece('b', 800, 600), piece('c', 600, 400)]);
    const res = guillotine.calculate(inp);
    expect(res.unplaced).toEqual([]);
    expect(validateResult(res.sheets, inp).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 20 — ошибки размещения', () => {
  it('Тест 34/35/36/100: деталь крупнее листа → DETAIL_TOO_LARGE', () => {
    const res = maxrects.calculate(input([piece('huge', 3000, 3000, { allowRotate: false })]));
    expect(res.unplaced).toHaveLength(1);
    expect(res.unplaced[0].code).toBe('DETAIL_TOO_LARGE');
    expect(res.unplaced[0].reason).toMatch(/больше рабочей области/i);
  });

  it('Тест 35: нехватка запаса листов → OUT_OF_STOCK', () => {
    // Один лист в запасе, деталей на два.
    const pieces = Array.from({ length: 40 }, (_, i) => piece(`p${i}`, 900, 900));
    const res = maxrects.calculate(input(pieces, { availableQuantity: 1 }));
    expect(res.unplaced.length).toBeGreaterThan(0);
    expect(res.unplaced.every((u) => u.code === 'OUT_OF_STOCK')).toBe(true);
  });

  it('Тест 35: классификатор различает три причины', () => {
    const formats = sheetFormats(input([]));
    const big = piece('big', 5000, 5000);
    const small = piece('small', 400, 300);
    expect(classifyUnplaced(big, formats, true, false)).toBe('DETAIL_TOO_LARGE');
    // «Слишком большая» сильнее «нет запаса»: лишние листы не помогут.
    expect(classifyUnplaced(big, formats, true, true)).toBe('DETAIL_TOO_LARGE');
    expect(classifyUnplaced(small, formats, true, true)).toBe('OUT_OF_STOCK');
    expect(classifyUnplaced(small, formats, true, false)).toBe('NO_VALID_PLACEMENT');
    // У каждой причины есть понятный текст.
    for (const code of ['DETAIL_TOO_LARGE', 'NO_VALID_PLACEMENT', 'OUT_OF_STOCK'] as const) {
      expect(unplacedMessage(code, small, formats).length).toBeGreaterThan(10);
    }
  });

  it('Тест 8: PlacementValidator ловит выход за лист', () => {
    const inp = input([piece('a', 600, 400)]);
    const res = maxrects.calculate(inp);
    const broken = {
      ...res.sheets[0],
      placements: [{ ...res.sheets[0].placements[0], x: 9999 }],
    };
    const issues = validateResult([broken], inp);
    expect(issues.some((i) => i.code === 'cutting.outOfSheet')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 20 — остатки, отход, КПД', () => {
  beforeEach(makeCabinet);

  it('Тест 6/27/28: остатки — прямоугольники с координатами и площадью', () => {
    const res = maxrects.calculate(input([piece('a', 600, 400)]));
    const sheet = res.sheets[0];
    expect(sheet.remnants.length).toBeGreaterThan(0);
    for (const r of sheet.remnants) {
      expect(r.sheetId).toBe(sheet.id);
      expect(r.materialId).toBe(MAT);
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
      expect(r.area).toBeCloseTo(r.width * r.height, 3);
      expect(typeof r.usable).toBe('boolean');
    }
  });

  it('Тест 16/29: критерий полезного остатка берётся из настроек', () => {
    const crit = { minWidth: 100, minLength: 300, minArea: 60_000 };
    expect(isUsableRemnant(500, 400, crit)).toBe(true);
    expect(isUsableRemnant(50, 400, crit)).toBe(false);  // узкий
    expect(isUsableRemnant(500, 100, crit)).toBe(false); // короткий
    // Порог — параметр, а не константа: со строгим критерием тот же остаток не годен.
    expect(isUsableRemnant(500, 400, { minWidth: 600, minLength: 300, minArea: 1 })).toBe(false);
  });

  it('Тест 17/30/31: USED / REMNANT / WASTE разделены и сходятся', () => {
    const res = maxrects.calculate(input([piece('a', 800, 600), piece('b', 700, 500)]));
    for (const s of res.sheets) {
      expect(s.usedAreaMm2).toBeGreaterThan(0);
      expect(s.remnantAreaMm2).toBeGreaterThanOrEqual(0);
      expect(s.wasteAreaMm2).toBeGreaterThanOrEqual(0);
      // Отход = полезная площадь − детали − полезные остатки (§31).
      expect(s.usedAreaMm2 + s.remnantAreaMm2 + s.wasteAreaMm2).toBeCloseTo(s.usableAreaMm2, 3);
    }
  });

  it('Тест 18/32/33: utilization = площадь деталей / полезная площадь', () => {
    const res = maxrects.calculate(input([piece('a', 800, 600), piece('b', 700, 500)]));
    const st = res.statistics;
    expect(st.utilization).toBeCloseTo(st.piecesAreaMm2 / st.sheetsUsableAreaMm2, 6);
    expect(st.utilization).toBeGreaterThan(0);
    expect(st.utilization).toBeLessThanOrEqual(1);
  });

  it('Тест 29/87/88/98: полезные остатки уходят в библиотеку с размерами', () => {
    void report();
    store().applyCuttingReport(report());
    const added = store().saveUsableRemnantsFromResult();
    expect(added).toBeGreaterThan(0);
    for (const r of project().remnants) {
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
      expect(r.materialId).toBeTruthy();
      expect(r.thickness).toBeGreaterThan(0);
      expect(r.status).toBe('AVAILABLE');
    }
  });

  it('Тест 29/91/92: состояния остатка и исключение из нового раскроя', () => {
    const mat = project().materials[0].id;
    const id = store().saveRemnant({
      materialId: mat, thickness: 16, width: 900, height: 700,
      grainDirection: 'none', sourceSheetId: 'S1',
    });
    store().updateCuttingSettings({ useRemnants: true });
    const available = buildCuttingInputs(project()).find((i) => i.materialId === mat)!;
    expect(available.remnantSheets?.some((r) => r.id === id)).toBe(true);

    // Архивный остаток физически недоступен — в подбор не идёт (§91/§92).
    store().setRemnantStatus(id, 'ARCHIVED');
    expect(project().remnants.find((r) => r.id === id)!.status).toBe('ARCHIVED');
    const archived = buildCuttingInputs(project()).find((i) => i.materialId === mat)!;
    expect(archived.remnantSheets?.some((r) => r.id === id)).toBe(false);

    // Возврат в оборот работает.
    store().setRemnantStatus(id, 'AVAILABLE');
    expect(buildCuttingInputs(project()).find((i) => i.materialId === mat)!.remnantSheets?.some((r) => r.id === id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 20 — воспроизводимость, версия, снимок', () => {
  beforeEach(makeCabinet);

  it('Тест 22/103: одинаковый вход даёт одинаковый результат', () => {
    const a = report();
    const b = report();
    const norm = (rep: CuttingReport) =>
      rep.jobs.map((j) => ({
        material: String(j.materialId),
        sheets: j.sheets.length,
        placements: j.sheets.flatMap((s) => s.placements.map((p) => `${p.pieceId}@${p.x},${p.y},${p.rotation}`)),
      }));
    expect(norm(a)).toEqual(norm(b));
  });

  it('Тест 20/22: зерно детерминировано и зависит от входа', () => {
    const base = input([piece('a', 600, 400)]);
    expect(seedFor(base)).toBe(seedFor(input([piece('a', 600, 400)])));
    expect(seedFor(base)).not.toBe(seedFor(input([piece('a', 601, 400)])));
    expect(seedFor(base)).not.toBe(seedFor(input([piece('a', 600, 400)], { kerf: 9 })));
  });

  it('Тест 23/57: результат помечен алгоритмом и его версией', () => {
    const rep = report();
    for (const job of rep.jobs) {
      expect(job.algorithm).toBeTruthy();
      expect(job.algorithmVersion).toBeTruthy();
      expect(job.jobId).toBeTruthy();
      const engine = listCuttingEngines().find((e) => e.id === job.algorithm)!;
      expect(job.algorithmVersion).toBe(engine.version);
    }
  });

  it('Тест 24/58/59: снимок настроек сохраняется вместе с результатом', () => {
    const rep = report();
    const job = rep.jobs[0];
    const snap = job.settingsSnapshot!;
    expect(snap.algorithm).toBe(job.algorithm);
    expect(snap.kerf).toBeGreaterThan(0);
    expect(snap.trim).toBeDefined();
    expect(snap.sheet.length).toBeGreaterThan(0);
    expect(typeof snap.seed).toBe('number');
    expect(snap.usableRemnant.minWidth).toBeGreaterThan(0);

    // Снимок независим от последующей правки настроек проекта (§59).
    const before = { ...snap };
    store().updateCuttingSettings({ respectGrain: !project().cutting.settings.respectGrain });
    expect(rep.jobs[0].settingsSnapshot).toEqual(before);
  });

  it('Тест 24: snapshotOf собирается из входа', () => {
    const snap = snapshotOf(input([piece('a', 600, 400)]), 'maxrects', '1.0');
    expect(snap.algorithm).toBe('maxrects');
    expect(snap.algorithmVersion).toBe('1.0');
    expect(snap.kerf).toBe(3.2);
    expect(snap.respectGrain).toBe(true);
    expect(snap.sortStrategy).toBe('area');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 20 — мультиматериал и состояние', () => {
  beforeEach(makeCabinet);

  it('Тест 19/20/75/76/99: разные материалы — разные задания', () => {
    const rep = report();
    // В шкафу есть ЛДСП корпуса и ХДФ задней стенки — минимум два задания.
    expect(rep.jobs.length).toBeGreaterThanOrEqual(2);
    const materials = rep.jobs.map((j) => String(j.materialId));
    expect(new Set(materials).size).toBe(materials.length); // без дублей

    // Толщины не смешиваются (§26): у каждого задания своя.
    const jobs = buildCuttingJobs(project());
    const byThickness = new Map(jobs.map((j) => [String(j.materialId), j.thickness]));
    for (const job of jobs) {
      const material = project().materials.find((m) => String(m.id) === String(job.materialId))!;
      expect(byThickness.get(String(job.materialId))).toBe(material.thickness);
    }
  });

  it('Тест 19/74/76: сводка считается по каждому материалу отдельно', () => {
    const rep = report();
    const thickness: Record<string, number> = {};
    for (const m of project().materials) thickness[String(m.id)] = m.thickness;
    const rows = cuttingSummary(rep, thickness);
    expect(rows).toHaveLength(rep.jobs.length);
    for (const row of rows) {
      expect(row.materialName).toBeTruthy();
      expect(row.thickness).toBeGreaterThan(0);
      expect(row.sheetCount).toBeGreaterThan(0);
      expect(row.utilization).toBeGreaterThan(0);
    }
    const csv = cuttingSummaryCsv(rep, thickness);
    expect(csv.split('\n')[0]).toBe('Material,Thickness,Sheet format,Sheets,Parts area,Sheets area,Remnant area,Waste area,Utilization,Unplaced');
    expect(csv.split('\n')).toHaveLength(rows.length + 1);
  });

  it('Тест 25/49: изменение детали помечает раскрой устаревшим', () => {
    store().applyCuttingReport(report());
    expect(isCuttingStale(project())).toBe(false);

    // Изменение размера детали делает раскрой недействительным (§49).
    const part = allParts(project())[0];
    store().updatePart(part.id, { width: part.width + 50 });
    expect(isCuttingStale(project())).toBe(true);

    // Пересчёт снимает признак — результат снова соответствует модели.
    store().applyCuttingReport(report());
    expect(isCuttingStale(project())).toBe(false);
  });

  it('Тест 26/54/55/102: ошибка расчёта не уничтожает прежний результат', () => {
    const good = report();
    store().applyCuttingReport(good);
    const saved = project().cutting.report;
    expect(saved).toBeTruthy();

    // Несуществующий движок — расчёт падает …
    expect(() => runCutting(project(), { engineId: 'нет-такого' })).toThrow();
    // … а сохранённый результат остаётся на месте (§55).
    expect(project().cutting.report).toEqual(saved);
  });

  it('Тест 27: отмена не затирает прежний результат', () => {
    store().applyCuttingReport(report());
    const saved = project().cutting.report;
    store().cancelCutting();
    expect(project().cutting.report).toEqual(saved);
    expect(store().cuttingRunning).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Раскрой 20 — экспорт и интеграции', () => {
  beforeEach(() => {
    makeCabinet();
    store().applyCuttingReport(report());
  });

  it('Тест 33/64: cutting.csv — колонки задания', () => {
    const csv = cuttingCsv(project().cutting.report!);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Sheet,Part ID,Part Name,Width,Height,Rotation,X,Y,Material');
    expect(lines.length).toBeGreaterThan(1);
    // Каждая строка — реальное размещение.
    const placementCount = project().cutting.report!.jobs
      .reduce((n, j) => n + j.sheets.reduce((k, s) => k + s.placements.length, 0), 0);
    expect(lines.length - 1).toBe(placementCount);
  });

  it('Тест 33/65: remnants.csv — колонки задания', () => {
    const csv = remnantsCsv(project().cutting.report!);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Sheet,Remnant ID,Width,Height,Area,Material,Usable');
    const remnantCount = project().cutting.report!.jobs
      .reduce((n, j) => n + j.sheets.reduce((k, s) => k + s.remnants.length, 0), 0);
    expect(lines.length - 1).toBe(remnantCount);
    if (remnantCount > 0) expect(lines[1]).toMatch(/,(yes|no)$/);
  });

  it('Тест 31/62: SVG карты раскроя', () => {
    const rep = project().cutting.report!;
    const svg = sheetToSvg(rep.jobs[0].sheets[0], 'ЛДСП 16');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(resultToSvg(rep.jobs[0])).toContain('<svg');
  });

  it('Тест 34: JSON результата сериализуется и читается обратно', () => {
    const rep = project().cutting.report!;
    const parsed = JSON.parse(reportToJson(rep)) as CuttingReport;
    expect(parsed.jobs).toHaveLength(rep.jobs.length);
    expect(parsed.jobs[0].algorithmVersion).toBe(rep.jobs[0].algorithmVersion);
    expect(parsed.jobs[0].settingsSnapshot).toBeTruthy();
  });

  it('Тест 37/60/61: документ карты раскроя строится из готового результата', () => {
    const doc = buildDocument(project(), 'cutting');
    expect(doc).toBeTruthy();
    expect(doc!.pages.length).toBeGreaterThan(0);
    // Документ не пересчитывает раскрой — он использует сохранённый отчёт.
    const before = project().cutting.report;
    buildDocument(project(), 'cutting');
    expect(project().cutting.report).toEqual(before);
  });

  it('Тест 35/83/84: из раскроя можно попасть в деталь и обратно', () => {
    const rep = project().cutting.report!;
    const placement = rep.jobs.flatMap((j) => j.sheets.flatMap((s) => s.placements))[0];
    // Cutting → Part (§84): размещение ссылается на реальную деталь.
    const part = findPart(project(), placement.partId);
    expect(part).toBeDefined();

    // Part → Cutting (§83): по детали находится лист и позиция.
    let found: { sheet: number; x: number; y: number } | null = null;
    for (const job of rep.jobs) {
      for (const sheet of job.sheets) {
        const pl = sheet.placements.find((p) => p.partId === part!.id);
        if (pl) found = { sheet: sheet.index + 1, x: pl.x, y: pl.y };
      }
    }
    expect(found).not.toBeNull();
    expect(found!.sheet).toBeGreaterThan(0);
  });

  it('Тест 36: экземпляры результата разбираются обратно в детали', () => {
    const rep = project().cutting.report!;
    const placements = rep.jobs.flatMap((j) => j.sheets.flatMap((s) => s.placements));
    const instances = instancesOf(placements);
    expect(instances).toHaveLength(placements.length);
    for (const inst of instances) {
      expect(inst.instanceIndex).toBeGreaterThan(0);
      expect(findPart(project(), inst.partId)).toBeDefined();
    }
  });

  it('Тест 40: регрессия — соседние модули не сломаны', () => {
    // Присадка, документы и соединения продолжают работать после раскроя.
    expect(project().hardwareConnections.length).toBeGreaterThan(0);
    expect(store().generateDocuments().ok).toBe(true);
    expect(allParts(project()).length).toBeGreaterThan(0);
    expect(project().cutting.report!.jobs.length).toBeGreaterThan(0);
  });
});
