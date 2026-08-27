/**
 * ЭТАП 21 — Обработка торцов деталей (кромка).
 * Цепочка: PART → EDGE BANDING → EDGE OPERATIONS → CUTTING → MACHINING →
 * DOCUMENTS → PRODUCTION.
 *
 * Проверяет модель кромки и её производность от Part, правила и пресеты,
 * длинные/короткие стороны, длину и количество, поворот в раскрое, override и
 * его сброс, валидацию, группировку расхода, интеграции с раскроем, 3D,
 * чертежами и документами, экспорт, dirty-состояние, атомарность и undo/redo.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import {
  EDGE_SIDES,
  EDGE_SYMBOL,
  SIDE_LABELS,
  allEdgeBanding,
  bandingTotalLength,
  builtinPresets,
  carcassFrontRule,
  checkEdgeBanding,
  defaultEdgeFor,
  edgeAllowance,
  edgeBandingCsv,
  edgeBandingForPart,
  edgeBandingForSide,
  edgeBandingId,
  edgeCount,
  edgeCuttingJobs,
  edgeOperations,
  edgeRules,
  edgeSourceOf,
  edgeSummary,
  edgeSummaryCsv,
  facadeRule,
  longSides,
  longSidesPreset,
  meters,
  operationLength,
  partsOfRole,
  presetFromPart,
  presetWithMaterial,
  quickActionConfig,
  rollUsage,
  rotateSide,
  rotateSideFlags,
  roundUpTo,
  shortSides,
  shortSidesPreset,
  sideDirection,
  sideLength,
  totalEdgeLength,
  validateEdges,
} from '@/engines/edges';
import { buildDocument, partsListRows, partsListCsv } from '@/engines/drawing';
import { isCuttingStale, runCutting } from '@/engines/cutting';
import { buildSpecification } from '@/engines/bom/specification';
import { deserializeProject } from '@/storage/project/serialization';
import type { EdgeSide, Part, Project } from '@/core/model/types';
import type { EdgeMaterialId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;
const edgeId = (): EdgeMaterialId => project().edges[0].id;

/** Деталь 800×300 из §79 — базовый пример этапа. */
function makePart(width = 800, height = 300, quantity = 1): PartId {
  store().newProject('Тест 21');
  return store().addPart({
    name: 'Полка',
    width,
    height,
    quantity,
    material: project().materials[0].id,
  });
}

/** Тестовый шкаф 800×2000×600 с фасадами. */
function makeCabinet(): void {
  store().newProject('Тест 21 — шкаф');
  const res = store().createFromTemplate('tpl-cabinet', {
    width: 800, height: 2000, depth: 600, materialThickness: 16, backThickness: 3,
    shelfCount: 4, verticalPartitionCount: 1, doorCount: 2, doorGap: 3,
    backType: 'inset', jointType: 'confirmat', handleEnabled: true,
  });
  expect(res.ok).toBe(true);
}

const part = (id: PartId): Part => findPart(project(), id)!;
const setEdges = (id: PartId, sides: EdgeSide[]) => {
  for (const side of sides) store().setPartEdge(id, side, edgeId());
};

// ─────────────────────────────────────────────────────────────────────────────
describe('Кромка 21 — модель и длина', () => {
  it('Тест 1/10/79: деталь 800×300, кромка LEFT+RIGHT → 600 мм', () => {
    const id = makePart(800, 300);
    setEdges(id, ['left', 'right']);

    const banding = edgeBandingForPart(project(), part(id));
    expect(banding).toHaveLength(2);
    expect(banding.map((b) => b.side).sort()).toEqual(['left', 'right']);
    // Левая и правая стороны идут вдоль height = 300.
    expect(banding.every((b) => b.length === 300)).toBe(true);
    expect(banding.reduce((n, b) => n + bandingTotalLength(b), 0)).toBe(600);
  });

  it('Тест 10/80: изменение 300 → 400 пересчитывает длину на 800 мм', () => {
    const id = makePart(800, 300);
    setEdges(id, ['left', 'right']);
    expect(totalEdgeLength(project())).toBe(600);

    // §18: кромка производна от детали, отдельного пересчёта не требуется.
    store().updatePart(id, { height: 400 });
    expect(totalEdgeLength(project())).toBe(800);

    // §19: изменение ДРУГОГО размера длину боковых кромок не трогает.
    store().updatePart(id, { width: 1000 });
    expect(totalEdgeLength(project())).toBe(800);
  });

  it('Тест 10/81: добавление TOP даёт +800 мм', () => {
    const id = makePart(800, 300);
    setEdges(id, ['left', 'right']);
    store().setPartEdge(id, 'top', edgeId());
    // Верх идёт вдоль width = 800.
    expect(totalEdgeLength(project())).toBe(600 + 800);
    expect(edgeCount(project(), part(id))).toBe(3);
  });

  it('Тест 11/42/83: количество деталей умножает потребность', () => {
    const id = makePart(800, 300, 10);
    store().setPartEdge(id, 'top', edgeId());
    const banding = edgeBandingForPart(project(), part(id))[0];
    expect(banding.length).toBe(800);       // длина одной стороны
    expect(banding.quantity).toBe(10);
    expect(bandingTotalLength(banding)).toBe(8000); // §42
  });

  it('Тест 8/9: толщина и ширина берутся из библиотеки и не путаются', () => {
    const id = makePart(800, 300);
    store().setPartEdge(id, 'top', edgeId());
    const material = project().edges[0];
    const banding = edgeBandingForPart(project(), part(id))[0];
    expect(banding.thickness).toBe(material.thickness);
    expect(banding.width).toBe(material.width ?? 23);
    // Толщина ленты и её ширина — разные величины (§8).
    expect(banding.thickness).not.toBe(banding.length);
  });

  it('Тест 1: стабильный id и стороны без кромки', () => {
    const id = makePart(800, 300);
    expect(edgeBandingId(String(id), 'left')).toBe(`${id}:left`);
    // Сторона без кромки записи не порождает.
    expect(edgeBandingForSide(project(), part(id), 'left')).toBeNull();
    expect(edgeBandingForPart(project(), part(id))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Кромка 21 — стороны, направление, поворот', () => {
  it('Тест 12/13/16: длинные и короткие стороны определяются геометрией', () => {
    const wide = { width: 800, height: 300 };
    expect(longSides(wide)).toEqual(['top', 'bottom']);
    expect(shortSides(wide)).toEqual(['left', 'right']);

    const tall = { width: 300, height: 800 };
    expect(longSides(tall)).toEqual(['left', 'right']);
    expect(shortSides(tall)).toEqual(['top', 'bottom']);

    // У квадратной детали длинных сторон нет — «кромить длинные» не должно
    // молча облицевать её целиком.
    expect(longSides({ width: 600, height: 600 })).toEqual([]);
    expect(shortSides({ width: 600, height: 600 })).toEqual([]);
  });

  it('Тест 9/12: длина стороны и направление', () => {
    const p = { width: 800, height: 300 };
    expect(sideLength(p, 'top')).toBe(800);
    expect(sideLength(p, 'left')).toBe(300);
    expect(sideDirection(p, 'top')).toBe('ALONG_LENGTH');
    expect(sideDirection(p, 'left')).toBe('ALONG_WIDTH');
    // У «вертикальной» детали всё наоборот — название стороны роли не играет.
    expect(sideDirection({ width: 300, height: 800 }, 'top')).toBe('ALONG_WIDTH');
    expect(sideDirection({ width: 300, height: 800 }, 'left')).toBe('ALONG_LENGTH');
  });

  it('Тест 14/21/82: поворот сохраняет кромку на физической стороне', () => {
    expect(rotateSide('left', 0)).toBe('left');
    expect(rotateSide('left', 90)).toBe('bottom');
    expect(rotateSide('bottom', 90)).toBe('right');
    expect(rotateSide('right', 90)).toBe('top');
    expect(rotateSide('top', 90)).toBe('left');

    const flags = { left: true, right: false, top: false, bottom: false };
    const rotated = rotateSideFlags(flags, 90);
    // Кромка не исчезла и не размножилась — она просто видна с другой стороны.
    expect(Object.values(rotated).filter(Boolean)).toHaveLength(1);
    expect(rotated.bottom).toBe(true);
    expect(rotated.left).toBe(false);
    // Поворот на 0° ничего не меняет.
    expect(rotateSideFlags(flags, 0)).toEqual(flags);
  });

  it('Тест 15/22: кромка и текстура независимы', () => {
    const id = makePart(800, 300);
    setEdges(id, ['left']);
    store().updatePart(id, { grain: 'length' });
    // Смена текстуры не трогает кромку …
    expect(edgeCount(project(), part(id))).toBe(1);
    // … а смена кромки не трогает текстуру (§22).
    store().setPartEdge(id, 'right', edgeId());
    expect(part(id).grain).toBe('length');
  });

  it('Тест 14/21: поворот в раскрое не теряет кромку', () => {
    const id = makePart(300, 2000);
    setEdges(id, ['left', 'right']);
    const before = totalEdgeLength(project());
    const report = runCutting(project());
    const placements = report.jobs.flatMap((j) => j.sheets.flatMap((s) => s.placements));
    expect(placements.length).toBeGreaterThan(0);
    // Раскрой не меняет модель кромки — он лишь размещает деталь.
    expect(totalEdgeLength(project())).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Кромка 21 — правила, пресеты, быстрые действия', () => {
  beforeEach(makeCabinet);

  it('Тест 4/47: правила зарегистрированы и различают детали', () => {
    const ids = edgeRules().map((r) => r.id);
    expect(ids).toContain('FACADE_ALL');
    expect(ids).toContain('CARCASS_FRONT');
    const facade = allParts(project()).find((p) => p.role === 'facade')!;
    const shelf = allParts(project()).find((p) => p.role === 'shelf')!;
    expect(facadeRule.matches(facade)).toBe(true);
    expect(facadeRule.matches(shelf)).toBe(false);
    expect(carcassFrontRule.matches(shelf)).toBe(true);
  });

  it('Тест 7/47/48/49: правило берёт кромку по умолчанию у материала плиты', () => {
    const facade = allParts(project()).find((p) => p.role === 'facade')!;
    // Пока у плиты нет кромки по умолчанию — правило ничего не назначает.
    expect(defaultEdgeFor(project(), facade)).toBeNull();
    expect(facadeRule.build(facade, project())).toEqual({});

    // §48/§49: задаём ЛДСП кромку по умолчанию.
    store().updateMaterial(facade.material!, { defaultEdgeMaterial: edgeId() });
    const updated = findPart(project(), facade.id)!;
    expect(defaultEdgeFor(project(), updated)).toBe(edgeId());
    const plan = facadeRule.build(updated, project());
    expect(Object.keys(plan).sort()).toEqual(['bottom', 'left', 'right', 'top']);
  });

  it('Тест 4/47: правило корпуса кромит длинный лицевой торец', () => {
    const shelf = allParts(project()).find((p) => p.role === 'shelf')!;
    store().updateMaterial(shelf.material!, { defaultEdgeMaterial: edgeId() });
    const plan = carcassFrontRule.build(findPart(project(), shelf.id)!, project());
    const sides = Object.keys(plan) as EdgeSide[];
    expect(sides).toHaveLength(1);
    expect(longSides(shelf)).toContain(sides[0]);
  });

  it('Тест 3/25: встроенные пресеты покрывают базовые случаи', () => {
    const presets = builtinPresets(edgeId());
    const names = presets.map((p) => p.id);
    expect(names).toEqual(expect.arrayContaining(['edge-none', 'edge-front', 'edge-two', 'edge-all', 'edge-facade']));
    const all = presets.find((p) => p.id === 'edge-all')!;
    expect(Object.values(all.sides).every((v) => v === edgeId())).toBe(true);
    const none = presets.find((p) => p.id === 'edge-none')!;
    expect(Object.values(none.sides).every((v) => v === null)).toBe(true);
  });

  it('Тест 26/55/88: пресет меняет только выбранные детали', () => {
    const facades = partsOfRole(allParts(project()), 'facade');
    expect(facades.length).toBeGreaterThanOrEqual(2);
    const chosen = facades.slice(0, 1);
    const untouched = facades.slice(1);

    const preset = presetWithMaterial(builtinPresets(edgeId()).find((p) => p.id === 'edge-facade')!, edgeId());
    const changed = store().applyEdgePreset(chosen.map((p) => p.id), preset);
    expect(changed).toBe(chosen.length);

    for (const p of chosen) expect(edgeCount(project(), part(p.id))).toBe(4);
    // §55: невыбранные детали остались нетронутыми.
    for (const p of untouched) expect(edgeCount(project(), part(p.id))).toBe(0);
  });

  it('Тест 27/54: пресет по категории применяется ко всем фасадам', () => {
    const preset = presetWithMaterial(builtinPresets(edgeId()).find((p) => p.id === 'edge-all')!, edgeId());
    const n = store().applyEdgePresetToRole('facade', preset);
    const facades = partsOfRole(allParts(project()), 'facade');
    expect(n).toBe(facades.length);
    for (const f of facades) expect(edgeCount(project(), f)).toBe(4);
    // Другие детали не затронуты.
    const shelf = allParts(project()).find((p) => p.role === 'shelf')!;
    expect(edgeCount(project(), shelf)).toBe(0);
  });

  it('Тест 25: пресет из детали и пресеты длинных/коротких сторон', () => {
    const id = makePart(800, 300);
    setEdges(id, ['left', 'top']);
    const saved = presetFromPart(part(id), 'my', 'Мой');
    expect(saved.sides.left).toBe(edgeId());
    expect(saved.sides.right).toBeNull();

    const long = longSidesPreset({ width: 800, height: 300 } as Part, edgeId());
    expect(long.sides.top).toBe(edgeId());
    expect(long.sides.left).toBeNull();
    const short = shortSidesPreset({ width: 800, height: 300 } as Part, edgeId());
    expect(short.sides.left).toBe(edgeId());
    expect(short.sides.top).toBeNull();
  });
});

describe('Кромка 21 — быстрые действия', () => {
  it('Тест 12/13: все / длинные / короткие / снять', () => {
    const id = makePart(800, 300);
    const p = part(id);

    expect(Object.keys(quickActionConfig(p, 'all', edgeId()).sides).sort())
      .toEqual([...EDGE_SIDES].sort());
    expect(Object.keys(quickActionConfig(p, 'long', edgeId()).sides)).toEqual(['top', 'bottom']);
    expect(Object.keys(quickActionConfig(p, 'short', edgeId()).sides)).toEqual(['left', 'right']);

    store().applyEdgeQuickAction([id], 'all', edgeId());
    expect(edgeCount(project(), part(id))).toBe(4);

    store().applyEdgeQuickAction([id], 'none', null);
    expect(edgeCount(project(), part(id))).toBe(0);

    store().applyEdgeQuickAction([id], 'long', edgeId());
    const sides = edgeBandingForPart(project(), part(id)).map((b) => b.side).sort();
    expect(sides).toEqual(['bottom', 'top']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Кромка 21 — override и источник', () => {
  it('Тест 23/86: ручное назначение переживает смену материала плиты', () => {
    const id = makePart(800, 300);
    store().setPartEdge(id, 'left', edgeId());
    expect(edgeSourceOf(part(id), 'left')).toBe('MANUAL');
    // Нетронутая сторона считается расчётной.
    expect(edgeSourceOf(part(id), 'right')).toBe('PARAMETRIC');

    const other = project().materials[1].id;
    store().updatePart(id, { material: other });
    // Ручная сторона на месте — смена плиты её не стёрла (§86).
    expect(part(id).edges.left).toBe(edgeId());
    expect(edgeSourceOf(part(id), 'left')).toBe('MANUAL');
  });

  it('Тест 23/45: правка параметров одной кромки', () => {
    const id = makePart(800, 300);
    store().setPartEdge(id, 'left', edgeId());
    const before = edgeBandingForPart(project(), part(id))[0];

    store().setEdgeOverride(id, 'left', { thickness: 1, width: 33 });
    const after = edgeBandingForSide(project(), part(id), 'left')!;
    expect(after.thickness).toBe(1);
    expect(after.width).toBe(33);
    expect(after.override).toBe(true);
    expect(after.length).toBe(before.length); // геометрия не тронута
  });

  it('Тест 24/46/87: сброс правки возвращает расчётное значение', () => {
    const id = makePart(800, 300);
    store().setPartEdge(id, 'left', edgeId());
    const original = edgeBandingForSide(project(), part(id), 'left')!;

    store().setEdgeOverride(id, 'left', { thickness: 1, width: 33 });
    expect(edgeBandingForSide(project(), part(id), 'left')!.thickness).toBe(1);

    store().resetEdgeOverride(id, 'left');
    const restored = edgeBandingForSide(project(), part(id), 'left')!;
    expect(restored.thickness).toBe(original.thickness);
    expect(restored.width).toBe(original.width);
    expect(restored.override).toBe(false);
    expect(part(id).edgeOverrides).toBeUndefined();
  });

  it('Тест 45: правкой можно задать другой материал стороны', () => {
    const id = makePart(800, 300);
    store().setPartEdge(id, 'left', edgeId());
    const другая = project().edges[1].id;
    store().setEdgeOverride(id, 'left', { materialId: другая });
    expect(edgeBandingForSide(project(), part(id), 'left')!.materialId).toBe(другая);
    // Само назначение стороны при этом не переписано.
    expect(part(id).edges.left).toBe(edgeId());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Кромка 21 — валидация', () => {
  it('Тест 6/43: корректная кромка не даёт замечаний', () => {
    const id = makePart(800, 300);
    setEdges(id, ['left', 'right']);
    const report = validateEdges(project());
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(0);
    for (const status of report.statuses.values()) expect(status).toBe('VALID');
  });

  it('Тест 6/44/84: пропавший из библиотеки материал → WARNING', () => {
    const id = makePart(800, 300);
    const used = edgeId();
    store().setPartEdge(id, 'left', used);

    // Библиотека защищает от удаления используемой кромки — это правильно.
    expect(store().removeEdge(used).ok).toBe(false);

    // §44 описывает другую ситуацию: проект открыт, а материала в нём уже нет
    // (например библиотеку правили извне). Воспроизводим именно её.
    const broken: Project = {
      ...project(),
      edges: project().edges.filter((e) => e.id !== used),
    };
    const banding = edgeBandingForSide(broken, part(id), 'left')!;
    expect(banding.status).toBe('WARNING');
    expect(banding.issue).toBeTruthy();

    const report = validateEdges(broken);
    expect(report.warnings).toBeGreaterThan(0);
    expect(report.errors).toBe(0); // деталь ещё можно сделать, выбрав замену
    expect(report.issues.some((i) => i.code === 'edge.missingMaterial')).toBe(true);
  });

  it('Тест 6/43: нулевые размеры → ERROR', () => {
    const id = makePart(800, 300);
    store().setPartEdge(id, 'left', edgeId());
    store().setEdgeOverride(id, 'left', { thickness: 0 });
    const banding = edgeBandingForSide(project(), part(id), 'left')!;
    expect(banding.status).toBe('ERROR');
    expect(checkEdgeBanding(project(), banding).some((i) => i.code === 'edge.badThickness')).toBe(true);
  });

  it('Тест 6: архивная кромка предупреждает, но не блокирует', () => {
    const id = makePart(800, 300);
    store().setPartEdge(id, 'left', edgeId());
    store().updateEdge(edgeId(), { archived: true });
    const issues = checkEdgeBanding(project(), edgeBandingForSide(project(), part(id), 'left')!);
    expect(issues.some((i) => i.code === 'edge.archivedMaterial')).toBe(true);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Кромка 21 — расход и группировка', () => {
  it('Тест 21/32/33: группировка по материалу И толщине', () => {
    const id = makePart(800, 300);
    setEdges(id, ['left', 'right', 'top']);
    const rows = edgeSummary(project());
    expect(rows).toHaveLength(1);
    expect(rows[0].lengthMm).toBe(300 + 300 + 800);
    expect(rows[0].bandingCount).toBe(3);

    // Вторая лента другой толщины — отдельная строка: складывать метраж
    // разных лент нельзя.
    const second = project().edges.find((e) => e.thickness !== project().edges[0].thickness)!;
    store().setPartEdge(id, 'bottom', second.id);
    const grouped = edgeSummary(project());
    expect(grouped).toHaveLength(2);
    expect(new Set(grouped.map((r) => r.thickness)).size).toBe(2);
  });

  it('Тест 22/89: мультиматериал — кромка каждой плиты считается отдельно', () => {
    makeCabinet();
    const preset = presetWithMaterial(builtinPresets(edgeId()).find((p) => p.id === 'edge-all')!, edgeId());
    store().applyEdgePresetToRole('facade', preset);
    const other = project().edges[1].id;
    const shelf = allParts(project()).find((p) => p.role === 'shelf')!;
    store().setPartEdge(shelf.id, 'top', other);

    const rows = edgeSummary(project());
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.lengthMm > 0)).toBe(true);
    // Сумма строк равна общей длине кромки проекта.
    expect(rows.reduce((n, r) => n + r.lengthMm, 0)).toBeCloseTo(totalEdgeLength(project()), 6);
  });

  it('Тест 34/39/72: расчётная и закупочная длина не смешиваются', () => {
    const id = makePart(800, 300, 2);
    store().setPartEdge(id, 'top', edgeId());
    // Точная геометрия: 800 × 2 детали.
    expect(totalEdgeLength(project())).toBe(1600);

    store().updateManufacturingProfile({ edgeCutAllowance: 50, edgePurchaseRounding: 1000 });
    expect(edgeAllowance(project())).toBe(50);
    const row = edgeSummary(project())[0];
    expect(row.lengthMm).toBe(1600);                    // §72: геометрия не округляется
    expect(row.withAllowanceMm).toBe(1600 + 50 * 2);    // §39: припуск на каждую заготовку
    expect(row.purchaseMm).toBe(2000);                  // §34: округление до шага поставки
  });

  it('Тест 34: округление вверх до шага', () => {
    expect(roundUpTo(1700, 1000)).toBe(2000);
    expect(roundUpTo(2000, 1000)).toBe(2000);
    expect(roundUpTo(1700, 0)).toBe(1700); // шаг 0 — не округлять
    expect(meters(2500)).toBe(2.5);
  });

  it('Тест 37/38/41: задание на кромкование объединяет расчёт, не детали', () => {
    store().newProject('Задание');
    const material = project().materials[0].id;
    const a = store().addPart({ name: 'A', width: 1000, height: 500, material });
    const b = store().addPart({ name: 'B', width: 500, height: 400, material });
    const c = store().addPart({ name: 'C', width: 800, height: 300, material });
    for (const id of [a, b, c]) store().setPartEdge(id, 'top', edgeId());

    const jobs = edgeCuttingJobs(project());
    expect(jobs).toHaveLength(1); // одна лента — одно задание
    // §38: потребность суммируется 1000 + 500 + 800.
    expect(jobs[0].requiredMm).toBe(2300);
    // §41: сами детали остались отдельными строками.
    expect(jobs[0].banding).toHaveLength(3);
  });

  it('Тест 40: расход рулона — рулоны, остаток, отход', () => {
    store().newProject('Рулон');
    const id = store().addPart({ name: 'A', width: 1000, height: 500, material: project().materials[0].id });
    store().setPartEdge(id, 'top', edgeId());
    const job = edgeCuttingJobs(project())[0];
    const usage = rollUsage(job, 300, 20);
    expect(usage.rollsNeeded).toBe(Math.ceil(job.requiredMm / 300));
    expect(usage.remainderMm).toBeCloseTo(usage.rollsNeeded * 300 - job.requiredMm, 6);
    expect(usage.wasteMm).toBe(20);
    // Нулевой рулон не приводит к делению на ноль.
    expect(rollUsage(job, 0).rollsNeeded).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Кромка 21 — операции и состояние', () => {
  it('Тест 5/66/67: операция кромкования описывает деталь и сторону', () => {
    const id = makePart(800, 300, 2);
    setEdges(id, ['left', 'top']);
    const ops = edgeOperations(project());
    expect(ops).toHaveLength(2);
    for (const op of ops) {
      expect(op.operationType).toBe('EDGE_BANDING');
      expect(String(op.partId)).toBe(String(id));
      expect(op.status).toBe('CURRENT');
      expect(op.length).toBeGreaterThan(0);
      expect(findPart(project(), op.partId)).toBeDefined();
    }
    // §39: длина операции включает припуск, длина спецификации — нет.
    store().updateManufacturingProfile({ edgeCutAllowance: 10 });
    const withAllowance = edgeOperations(project()).find((o) => o.side === 'top')!;
    expect(withAllowance.length).toBe(800 * 2 + 10 * 2);
  });

  it('Тест 28/68/75/92: изменение детали пересчитывает операции', () => {
    const id = makePart(800, 300);
    store().setPartEdge(id, 'top', edgeId());
    expect(edgeOperations(project())[0].length).toBe(800);

    store().updatePart(id, { width: 1200 });
    // §75/§92: операция пересчиталась вместе с деталью, без ручного обновления.
    expect(edgeOperations(project())[0].length).toBe(1200);
  });

  it('Тест 28/76: изменение кромки делает раскрой устаревшим', () => {
    makeCabinet();
    store().applyCuttingReport(runCutting(project()));
    expect(isCuttingStale(project())).toBe(false);

    store().setPartEdge(allParts(project())[0].id, 'top', edgeId());
    // Кромка меняет производственные данные детали → раскрой пересчитать.
    expect(isCuttingStale(project())).toBe(true);
  });

  it('Тест 68: статус ERROR передаётся в операцию', () => {
    const id = makePart(800, 300);
    store().setPartEdge(id, 'left', edgeId());
    store().setEdgeOverride(id, 'left', { width: 0 });
    expect(edgeOperations(project())[0].status).toBe('ERROR');
  });

  it('Тест 29/77: обновление кромки атомарно', () => {
    makeCabinet();
    const facades = partsOfRole(allParts(project()), 'facade');
    const preset = presetWithMaterial(builtinPresets(edgeId()).find((p) => p.id === 'edge-all')!, edgeId());
    store().applyEdgePreset(facades.map((f) => f.id), preset);

    // Одна команда — согласованное состояние: у всех фасадов по 4 кромки,
    // и столько же операций, промежуточных состояний не остаётся.
    for (const f of facades) expect(edgeCount(project(), part(f.id))).toBe(4);
    expect(edgeOperations(project()).length).toBe(facades.length * 4);
    expect(validateEdges(project()).errors).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Кромка 21 — undo/redo и сохранение', () => {
  it('Тест 30/31/93: отмена и повтор изменения кромки', () => {
    const id = makePart(800, 300);
    expect(edgeCount(project(), part(id))).toBe(0);

    store().setPartEdge(id, 'left', edgeId());
    expect(edgeCount(project(), part(id))).toBe(1);

    store().undo();
    expect(edgeCount(project(), part(id))).toBe(0);

    store().redo();
    expect(edgeCount(project(), part(id))).toBe(1);
  });

  it('Тест 30: отмена пресета возвращает все детали разом', () => {
    makeCabinet();
    const facades = partsOfRole(allParts(project()), 'facade');
    const preset = presetWithMaterial(builtinPresets(edgeId()).find((p) => p.id === 'edge-all')!, edgeId());
    store().applyEdgePreset(facades.map((f) => f.id), preset);
    expect(totalEdgeLength(project())).toBeGreaterThan(0);

    // §77/§78: пресет применён одной командой, поэтому и откатывается целиком.
    store().undo();
    for (const f of facades) expect(edgeCount(project(), part(f.id))).toBe(0);
  });

  it('Тест 96/97: настройки кромки переживают сохранение и открытие', () => {
    const id = makePart(800, 300);
    store().setPartEdge(id, 'left', edgeId());
    store().setEdgeOverride(id, 'left', { width: 33 });

    const restored = deserializeProject(JSON.stringify(project()));
    const part2 = allParts(restored).find((p) => String(p.id) === String(id))!;
    expect(part2.edges.left).toBe(edgeId());
    expect(part2.edgeSources?.left).toBe('MANUAL');
    expect(part2.edgeOverrides?.left?.width).toBe(33);
  });

  it('Тест 97: старый проект без настроек кромки открывается', () => {
    const id = makePart(800, 300);
    const raw = JSON.parse(JSON.stringify(project())) as Project;
    // Имитируем проект прошлых этапов: полей кромки нет вовсе.
    for (const f of raw.furnitures) {
      for (const a of f.assemblies) {
        for (const p of a.parts) {
          delete (p as Partial<Part>).edgeSources;
          delete (p as Partial<Part>).edgeOverrides;
        }
      }
    }
    const restored = deserializeProject(JSON.stringify(raw));
    const part2 = allParts(restored).find((p) => String(p.id) === String(id))!;
    expect(edgeBandingForPart(restored, part2)).toEqual([]);
    expect(edgeSourceOf(part2, 'left')).toBe('PARAMETRIC');
    expect(validateEdges(restored).errors).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Кромка 21 — интеграции и экспорт', () => {
  beforeEach(() => {
    makeCabinet();
    const preset = presetWithMaterial(builtinPresets(edgeId()).find((p) => p.id === 'edge-all')!, edgeId());
    store().applyEdgePresetToRole('facade', preset);
  });

  it('Тест 20/60/61: edgebanding.csv содержит все строки', () => {
    const csv = edgeBandingCsv(project());
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Part ID,Part Name,Side,Material,Thickness,Width,Length,Quantity,Total');
    expect(lines.length - 1).toBe(allEdgeBanding(project()).length);
    // §73: длины в миллиметрах.
    expect(lines[1].split(',')[6]).toMatch(/^\d+$/);
  });

  it('Тест 20/63: расход выгружается отдельным CSV', () => {
    const csv = edgeSummaryCsv(project());
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Material,Thickness,Width,Length m,With allowance m,Purchase m,Pieces');
    expect(lines.length - 1).toBe(edgeSummary(project()).length);
  });

  it('Тест 18/19/59/91: ведомость кромки строится как документ', () => {
    const doc = buildDocument(project(), 'edgeList');
    expect(doc).toBeTruthy();
    expect(doc!.type).toBe('EDGE_LIST');
    expect(doc!.pages.length).toBeGreaterThan(0);
    for (const page of doc!.pages) expect(page.scene.prims.length).toBeGreaterThan(0);
    // Документ не пересчитывает кромку — берёт готовый расчёт.
    const before = totalEdgeLength(project());
    buildDocument(project(), 'edgeList');
    expect(totalEdgeLength(project())).toBe(before);
  });

  it('Тест 18/64: спецификация деталей показывает количество кромок', () => {
    const rows = partsListRows(project());
    const edged = rows.filter((r) => r.edgeCount > 0);
    expect(edged.length).toBeGreaterThan(0);
    for (const row of edged) expect(row.edgeCount).toBeLessThanOrEqual(4);
    const csv = partsListCsv(project());
    expect(csv.split('\n')[0]).toContain('Кромок');
  });

  it('Тест 16: спецификация считает ту же длину, что и движок', () => {
    const spec = buildSpecification(allParts(project()), project().materials, project().edges);
    expect(spec.totals.edgeLengthM * 1000).toBeCloseTo(totalEdgeLength(project()), 6);
  });

  it('Тест 17/26/28: единый символ кромки и подписи сторон', () => {
    expect(EDGE_SYMBOL).toBe('EB');
    expect(SIDE_LABELS.top).toBe('Верх');
    expect(Object.keys(SIDE_LABELS).sort()).toEqual([...EDGE_SIDES].sort());
  });

  it('Тест 16/32: полный шкаф — расход считается и согласован', () => {
    const rows = edgeSummary(project());
    expect(rows.length).toBeGreaterThan(0);
    const total = rows.reduce((n, r) => n + r.lengthMm, 0);
    expect(total).toBeCloseTo(totalEdgeLength(project()), 6);
    expect(meters(total)).toBeGreaterThan(0);
    // Операции согласованы с записями кромки.
    expect(edgeOperations(project())).toHaveLength(allEdgeBanding(project()).length);
  });

  it('Тест 32: полная регрессия — соседние модули работают', () => {
    expect(store().generateDocuments().ok).toBe(true);
    expect(project().hardwareConnections.length).toBeGreaterThan(0);
    expect(runCutting(project()).jobs.length).toBeGreaterThan(0);
    expect(validateEdges(project()).errors).toBe(0);
  });

  it('Тест 5/70/71: производственный список отсортирован по материалу', () => {
    const jobs = edgeCuttingJobs(project());
    expect(jobs.length).toBeGreaterThan(0);
    const names = jobs.map((j) => j.materialName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    for (const job of jobs) {
      expect(job.requiredMm).toBeGreaterThan(0);
      expect(job.banding.length).toBeGreaterThan(0);
    }
  });

  it('Тест 7/85: смена материала кромки обновляет записи и операции', () => {
    const facade = partsOfRole(allParts(project()), 'facade')[0];
    const before = edgeBandingForSide(project(), part(facade.id), 'top')!;
    const other = project().edges.find((e) => e.thickness !== before.thickness)!;

    store().setPartEdge(facade.id, 'top', other.id);
    const after = edgeBandingForSide(project(), part(facade.id), 'top')!;
    expect(after.materialId).toBe(other.id);
    expect(after.thickness).toBe(other.thickness);
    // Операция пересчиталась вместе с записью.
    const op = edgeOperations(project()).find((o) => o.id === `edge:${after.id}`)!;
    expect(op.thickness).toBe(other.thickness);
    expect(operationLength(after, edgeAllowance(project()))).toBe(op.length);
  });
});
