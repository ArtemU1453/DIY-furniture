/**
 * ЭТАП 28 — Параметрический генератор корпусной мебели.
 *
 * Цепочка: параметры шкафа → правила → детали → фурнитура → соединения →
 * присадка → кромка → раскрой → 2D/3D → спецификация → документы.
 *
 * Проверяет CabinetModel и типы корпуса, регенерацию по ширине/высоте/глубине,
 * боковины, верх и низ, полки с ручным положением и сбросом, заднюю стенку и
 * её паз, цоколь, ножки, фасады с зазорами и наложением, петли, ручки, ящики с
 * направляющими и присадкой, перегородки, вложенные модули и трансформации,
 * граф зависимостей, атомарность, валидацию, коллизии и зазоры, пресеты с
 * импортом и экспортом, дубликат, copy/paste, удаление, Break/Reset Link,
 * интеграции и полную регрессию.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { findFurniture, findPart } from '@/core/model/selectors';
import {
  BUILT_IN_CABINET_PRESETS,
  CABINET_CLIPBOARD_FORMAT,
  CABINET_DEPENDENCY_NODES,
  CABINET_PRESET_FORMAT,
  CABINET_TYPES,
  DEFAULT_GROOVE_DEPTH,
  KIND_OF_CABINET_TYPE,
  MIN_SHELF_CLEARANCE,
  affectedByFields,
  backGrooveMachining,
  bomGroupKey,
  buildCabinet,
  cabinetBom,
  cabinetBomCsv,
  cabinetBounds,
  cabinetModelOf,
  cabinetRemovalImpact,
  cabinetTypeInfo,
  cabinetTypeOfKind,
  changedFields,
  checkCabinet,
  checkDoorClearance,
  checkDrawerClearance,
  checkPartCollisions,
  checkShelfClearance,
  copyCabinet,
  createCabinetModel,
  dependentsOf,
  directDependents,
  doorZone,
  drawerSlots,
  duplicateCabinet,
  exportCabinetPresets,
  frontZone,
  hasCycle,
  importCabinetPresets,
  interiorZone,
  isPermittedOverlap,
  legSpots,
  modelFromPreset,
  pasteCabinet,
  presetFromModel,
  previewCabinet,
  regenerateCabinet,
  regenerationOrder,
  removeCabinet,
  toCabinetModel,
  withCabinetType,
} from '@/engines/cabinet';
import {
  createParametricModel,
  generateParts,
  breakLink,
  resetLink,
  readParametricModel,
  shelfOffsets,
  partSource,
  hasOverride,
  validateParametricModel,
} from '@/engines/parametric';
import { allOperations } from '@/engines/machining';
import { allEdgeBanding } from '@/engines/edges';
import { runCutting } from '@/engines/cutting';
import { buildDocument } from '@/engines/drawing';
import { partEntities } from '@/engines/editor2d';
import { deserializeProject } from '@/storage/project/serialization';
import type { Part, Project } from '@/core/model/types';
import type { ParametricModel } from '@/core/parametric/types';
import type { FurnitureId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;
const modelOf = (id: FurnitureId) => store().getCabinetModel(id)!;
const partsOf = (id: FurnitureId): Part[] =>
  findFurniture(project(), id)!.assemblies.flatMap((a) => a.parts);
const keyed = (id: FurnitureId, key: string): Part | undefined =>
  partsOf(id).find((p) => p.metadata?.key === key);
const roleCount = (id: FurnitureId, role: Part['role']): number =>
  partsOf(id).filter((p) => p.role === role).length;
const typed = (id: FurnitureId, type: string): Part[] =>
  partsOf(id).filter((p) => p.metadata?.partType === type);
/** Узлы, собранные крепежом заданной категории. */
const connectionsOfCategory = (category: string) => {
  const ids = new Set(project().hardware.filter((h) => h.category === category).map((h) => String(h.id)));
  return project().hardwareConnections.filter((c) => ids.has(String(c.hardwareId)));
};

/** Шкаф 800×2000×600 из ЦЕЛИ этапа. */
function makeCabinet(patch: Partial<ParametricModel> = {}): FurnitureId {
  store().newProject('Тест 28');
  const id = store().createParametricCabinet({
    type: 'CABINET', width: 800, height: 2000, depth: 600, name: 'Шкаф',
  });
  expect(id).toBeTruthy();
  // Пустая заготовка нового проекта здесь не нужна: в тестах живёт один шкаф.
  for (const f of [...store().project.furnitures]) {
    if (String(f.id) !== String(id)) store().removeFurniture(f.id);
  }
  if (Object.keys(patch).length > 0) {
    const applied = store().applyCabinetPatch(id!, patch);
    expect(applied.ok).toBe(true);
  }
  return id!;
}

let cabinet: FurnitureId;
beforeEach(() => {
  cabinet = makeCabinet();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Шкаф 28 — модель и параметры', () => {
  it('Тест 1: CabinetModel дочитывает все блоки', () => {
    const raw = createParametricModel({ width: 800, height: 2000, depth: 600 });
    const model = toCabinetModel(raw);
    expect(model.cabinetType).toBe('CABINET');
    expect(model.edge.thickness).toBeGreaterThan(0);
    expect(model.backPanel.grooveDepth).toBe(DEFAULT_GROOVE_DEPTH);
    expect(model.doors.overlay).toBe('FULL');
    expect(model.drawers.distribution).toBe('AUTO_EQUAL');
    expect(model.legs.placement).toBe('CORNERS');
    expect(model.plinth.thickness).toBe(model.thickness);
    expect(model.shelves.mode).toBe('ADJUSTABLE');
  });

  it('Тест 1: нормализация идемпотентна', () => {
    const once = toCabinetModel(createParametricModel());
    expect(toCabinetModel(once)).toEqual(once);
  });

  it('Тест 2: ширина, высота и глубина — обязательный минимум', () => {
    const model = modelOf(cabinet);
    expect(model.width).toBe(800);
    expect(model.height).toBe(2000);
    expect(model.depth).toBe(600);
  });

  it('Тест 2/3: материал, толщина и материал задней стенки', () => {
    const material = project().materials[0];
    const applied = store().applyCabinetPatch(cabinet, {
      materialId: material.id, thickness: 18,
      backPanel: { ...modelOf(cabinet).backPanel, material: material.id, thickness: 4 },
    });
    expect(applied.ok).toBe(true);
    const model = modelOf(cabinet);
    expect(model.thickness).toBe(18);
    expect(model.backPanel.thickness).toBe(4);
    expect(keyed(cabinet, 'CABINET.BACK')!.thickness).toBe(4);
  });

  it('Тест 4: параметры кромки хранятся в модели', () => {
    const applied = store().applyCabinetPatch(cabinet, { edge: { thickness: 2, materialId: 'edge-2' } });
    expect(applied.ok).toBe(true);
    expect(modelOf(cabinet).edge).toEqual({ thickness: 2, materialId: 'edge-2' });
  });

  it('Тест 1/5: шесть типов корпуса и их изделия', () => {
    expect(CABINET_TYPES.map((t) => t.type)).toEqual([
      'CABINET', 'WARDROBE', 'BASE_UNIT', 'WALL_UNIT', 'TALL_UNIT', 'SHELF_UNIT',
    ]);
    expect(KIND_OF_CABINET_TYPE.WALL_UNIT).toBe('WALL_CABINET');
    expect(cabinetTypeInfo('TALL_UNIT').height).toBe(2100);
    expect(cabinetTypeOfKind('SHELVING')).toBe('SHELF_UNIT');
    expect(withCabinetType(modelOf(cabinet), 'WARDROBE').kind).toBe('CABINET');
    expect(createCabinetModel('WALL_UNIT').depth).toBe(300);
  });
});

describe('Шкаф 28 — регенерация габаритов', () => {
  it('Тест 3/23 (§123): ширина 800 → 1000 перестраивает зависимые детали', () => {
    const before = keyed(cabinet, 'CABINET.TOP')!.width;
    const doorBefore = keyed(cabinet, 'CABINET.DOOR.001');
    const applied = store().applyCabinetPatch(cabinet, { width: 1000 });
    expect(applied.ok).toBe(true);
    expect(keyed(cabinet, 'CABINET.TOP')!.width).toBe(before + 200);
    // Боковины по ширине не меняются: их размер задаёт глубина и высота.
    expect(keyed(cabinet, 'CABINET.SIDE.LEFT')!.width).toBe(600);
    if (doorBefore) {
      expect(keyed(cabinet, 'CABINET.DOOR.001')!.width).toBeGreaterThan(doorBefore.width);
    }
    // Присадка и раскрой пересчитываются от новых деталей.
    expect(allOperations(project()).length).toBeGreaterThan(0);
  });

  it('Тест 4/24 (§124): высота 2000 → 2200 перестраивает боковины и полки', () => {
    store().applyCabinetPatch(cabinet, { shelves: { ...modelOf(cabinet).shelves, count: 3 } });
    const shelvesBefore = shelfOffsets(modelOf(cabinet));
    store().applyCabinetPatch(cabinet, { height: 2200 });
    expect(keyed(cabinet, 'CABINET.SIDE.LEFT')!.height).toBe(2200);
    const after = shelfOffsets(modelOf(cabinet));
    expect(after[0]).toBeGreaterThan(shelvesBefore[0]);
  });

  it('Тест 5/25 (§125): глубина 600 → 500 перестраивает корпус и заднюю стенку', () => {
    store().applyCabinetPatch(cabinet, { depth: 500 });
    expect(keyed(cabinet, 'CABINET.SIDE.LEFT')!.width).toBe(500);
    expect(keyed(cabinet, 'CABINET.TOP')!.height).toBe(500);
    const back = keyed(cabinet, 'CABINET.BACK');
    if (back) expect(back.width).toBeLessThanOrEqual(800);
  });

  it('Тест 6/7/8: боковины, верх и низ создаются автоматически', () => {
    expect(keyed(cabinet, 'CABINET.SIDE.LEFT')).toBeDefined();
    expect(keyed(cabinet, 'CABINET.SIDE.RIGHT')).toBeDefined();
    expect(keyed(cabinet, 'CABINET.TOP')).toBeDefined();
    expect(keyed(cabinet, 'CABINET.BOTTOM')).toBeDefined();
    expect(roleCount(cabinet, 'side')).toBe(2);
  });

  it('Тест 6/13: схема ON_SIDES меняет размеры верха и боковин', () => {
    const between = keyed(cabinet, 'CABINET.TOP')!.width;
    store().applyCabinetPatch(cabinet, { construction: 'ON_SIDES' });
    expect(keyed(cabinet, 'CABINET.TOP')!.width).toBeGreaterThan(between);
    expect(keyed(cabinet, 'CABINET.SIDE.LEFT')!.height).toBe(2000 - 2 * modelOf(cabinet).thickness);
  });

  it('Тест 10: размеры деталей выводятся из параметров, а не хранятся', () => {
    const model = modelOf(cabinet);
    // Боковина = глубина × высота; крыша = (ширина − 2t) при BETWEEN_SIDES.
    expect(keyed(cabinet, 'CABINET.SIDE.LEFT')!.height).toBe(model.height);
    expect(keyed(cabinet, 'CABINET.TOP')!.width).toBe(model.width - 2 * model.thickness);
  });
});

describe('Шкаф 28 — полки', () => {
  beforeEach(() => {
    store().applyCabinetPatch(cabinet, { shelves: { ...modelOf(cabinet).shelves, count: 3 } });
  });

  it('Тест 9/15/26 (§126): добавление полки создаёт деталь', () => {
    const before = roleCount(cabinet, 'shelf');
    store().applyCabinetPatch(cabinet, { shelves: { ...modelOf(cabinet).shelves, count: 4 } });
    expect(roleCount(cabinet, 'shelf')).toBe(before + 1);
  });

  it('Тест 27 (§127): удаление полки убирает деталь', () => {
    const before = roleCount(cabinet, 'shelf');
    store().applyCabinetPatch(cabinet, { shelves: { ...modelOf(cabinet).shelves, count: 2 } });
    expect(roleCount(cabinet, 'shelf')).toBe(before - 1);
  });

  it('Тест 10/16/17: равномерное распределение и шаг', () => {
    const offsets = shelfOffsets(modelOf(cabinet));
    expect(offsets).toHaveLength(3);
    const steps = offsets.slice(1).map((v, i) => v - offsets[i]);
    for (const step of steps) expect(Math.abs(step - steps[0])).toBeLessThan(0.01);

    store().applyCabinetPatch(cabinet, {
      shelves: { ...modelOf(cabinet).shelves, distribution: 'MANUAL', spacing: 300 },
    });
    const manual = shelfOffsets(modelOf(cabinet));
    expect(Math.round(manual[1] - manual[0])).toBe(300);
  });

  it('Тест 11/28 (§128): ручное положение полки даёт override', () => {
    store().setShelfPosition(cabinet, 2, 900);
    const model = modelOf(cabinet);
    expect(model.shelves.fixedShelves).toContainEqual({ index: 2, offset: 900, fixed: true });
    expect(shelfOffsets(model)[1]).toBe(900);
    // Остальные параметры продолжают работать (§20).
    expect(store().applyCabinetPatch(cabinet, { width: 900 }).ok).toBe(true);
    expect(shelfOffsets(modelOf(cabinet))[1]).toBe(900);
  });

  it('Тест 12/29 (§129): сброс ручного положения возвращает расчёт', () => {
    store().setShelfPosition(cabinet, 2, 900);
    store().resetShelfPosition(cabinet, 2);
    expect(modelOf(cabinet).shelves.fixedShelves).toHaveLength(0);
    expect(shelfOffsets(modelOf(cabinet))[1]).not.toBe(900);
  });

  it('Тест 18: команда «распределить равномерно» снимает ручные положения', () => {
    store().setShelfPosition(cabinet, 1, 300);
    const result = store().distributeShelvesEqually(cabinet);
    expect(result.ok).toBe(true);
    expect(modelOf(cabinet).shelves.fixedShelves).toHaveLength(0);
    expect(modelOf(cabinet).shelves.distribution).toBe('AUTO_EQUAL');
  });

  it('Тест 9/14: фиксированные и регулируемые полки различаются в модели', () => {
    store().applyCabinetPatch(cabinet, { shelves: { ...modelOf(cabinet).shelves, mode: 'FIXED' } });
    expect(modelOf(cabinet).shelves.mode).toBe('FIXED');
    expect(typed(cabinet, 'shelf')[0].metadata?.shelfMode).toBe('FIXED');
  });
});

describe('Шкаф 28 — задняя стенка, цоколь и ножки', () => {
  it('Тест 13/22/24: типы задней стенки и отдельный материал', () => {
    const material = project().materials[0];
    for (const type of ['INSET', 'OVERLAY', 'GROOVE'] as const) {
      store().applyCabinetPatch(cabinet, {
        backPanel: { ...modelOf(cabinet).backPanel, type, material: material.id },
      });
      const back = keyed(cabinet, 'CABINET.BACK')!;
      expect(back).toBeDefined();
      expect(back.material).toBe(material.id);
    }
    store().applyCabinetPatch(cabinet, { backPanel: { ...modelOf(cabinet).backPanel, type: 'NONE' } });
    expect(keyed(cabinet, 'CABINET.BACK')).toBeUndefined();
  });

  it('Тест 13: накладная стенка шире вкладной', () => {
    store().applyCabinetPatch(cabinet, { backPanel: { ...modelOf(cabinet).backPanel, type: 'INSET' } });
    const inset = keyed(cabinet, 'CABINET.BACK')!.width;
    store().applyCabinetPatch(cabinet, { backPanel: { ...modelOf(cabinet).backPanel, type: 'OVERLAY' } });
    expect(keyed(cabinet, 'CABINET.BACK')!.width).toBeGreaterThan(inset);
  });

  it('Тест 14/18/40 (§140/§141): паз задней стенки создаёт операции присадки', () => {
    store().applyCabinetPatch(cabinet, {
      backPanel: { ...modelOf(cabinet).backPanel, type: 'GROOVE', thickness: 4, grooveDepth: 8, grooveOffset: 12 },
    });
    const side = keyed(cabinet, 'CABINET.SIDE.LEFT')!;
    const groove = side.machining.find((op) => op.type === 'slot');
    expect(groove).toBeDefined();
    expect(groove!.source).toBe('PARAMETRIC_RULE');
    expect(groove!.width).toBe(4);
    expect(groove!.depth).toBe(8);
    expect(groove!.x).toBe(12);
    expect(groove!.partId).toBe(side.id);
    // Крыша и дно тоже получают паз.
    expect(keyed(cabinet, 'CABINET.TOP')!.machining.some((op) => op.type === 'slot')).toBe(true);
    // Операция попадает в общий список присадки проекта.
    expect(allOperations(project()).some((op) => op.id === groove!.id)).toBe(true);
  });

  it('Тест 14: паз переезжает вместе с деталью и не копится', () => {
    store().applyCabinetPatch(cabinet, {
      backPanel: { ...modelOf(cabinet).backPanel, type: 'GROOVE' },
    });
    const before = keyed(cabinet, 'CABINET.SIDE.LEFT')!.machining.length;
    store().applyCabinetPatch(cabinet, { height: 2200 });
    const side = keyed(cabinet, 'CABINET.SIDE.LEFT')!;
    expect(side.machining).toHaveLength(before);
    expect(side.machining[0].length).toBe(2200);
  });

  it('Тест 14: без паза конструктивных операций нет', () => {
    const defs = backGrooveMachining(
      toCabinetModel(createParametricModel({ backPanel: { type: 'INSET', thickness: 3, offset: 0, material: null } })),
      [],
    );
    expect(defs).toEqual([]);
  });

  it('Тест 15/26/27: цоколь с высотой, отступом и толщиной', () => {
    store().applyCabinetPatch(cabinet, {
      plinth: { enabled: true, height: 120, inset: 30, frontOffset: 50, material: null, thickness: 18 },
    });
    const plinth = keyed(cabinet, 'CABINET.PLINTH')!;
    expect(plinth).toBeDefined();
    expect(plinth.height).toBe(120);
    expect(plinth.thickness).toBe(18);
    expect(plinth.width).toBe(800 - 2 * 30);
  });

  it('Тест 16/28/29/30: ножки, их количество и схемы размещения', () => {
    store().applyCabinetPatch(cabinet, {
      legs: { enabled: true, height: 100, insetX: 50, insetY: 50, count: 4, placement: 'CORNERS' },
    });
    expect(partsOf(cabinet).filter((p) => p.metadata?.leg).length).toBe(4);

    store().applyCabinetPatch(cabinet, {
      legs: { ...modelOf(cabinet).legs, count: 6, placement: 'SYMMETRIC' },
    });
    const spots = legSpots(modelOf(cabinet));
    expect(spots).toHaveLength(6);
    // Симметрия: крайние опоры на равном удалении от краёв.
    const xs = spots.map((s) => s.x).sort((a, b) => a - b);
    expect(Math.round(xs[0])).toBe(Math.round(800 - 40 - xs[xs.length - 1]));

    store().applyCabinetPatch(cabinet, { legs: { ...modelOf(cabinet).legs, placement: 'INSET' } });
    expect(legSpots(modelOf(cabinet))).toHaveLength(6);
  });
});

describe('Шкаф 28 — фасады, петли и ручки', () => {
  const withDoors = (count = 2) =>
    store().applyCabinetPatch(cabinet, {
      doors: { ...modelOf(cabinet).doors, count, handleEnabled: true },
    });

  it('Тест 17/30 (§130): добавление двери создаёт фасад', () => {
    withDoors(2);
    expect(typed(cabinet, 'facade')).toHaveLength(2);
  });

  it('Тест 31 (§131): удаление двери убирает фасад', () => {
    withDoors(2);
    store().applyCabinetPatch(cabinet, { doors: { ...modelOf(cabinet).doors, count: 1 } });
    expect(typed(cabinet, 'facade')).toHaveLength(1);
  });

  it('Тест 18: зазоры влияют на ширину фасада', () => {
    withDoors(2);
    const wide = typed(cabinet, 'facade')[0].width;
    store().applyCabinetPatch(cabinet, {
      doors: { ...modelOf(cabinet).doors, gaps: { ...modelOf(cabinet).doors.gaps, betweenGap: 10 } },
    });
    expect(typed(cabinet, 'facade')[0].width).toBeLessThan(wide);
  });

  it('Тест 19/35: наложение full / half / inset даёт разную геометрию', () => {
    withDoors(2);
    const full = doorZone(modelOf(cabinet));
    store().applyCabinetPatch(cabinet, { doors: { ...modelOf(cabinet).doors, overlay: 'HALF' } });
    const half = doorZone(modelOf(cabinet));
    store().applyCabinetPatch(cabinet, { doors: { ...modelOf(cabinet).doors, overlay: 'INSET' } });
    const inset = doorZone(modelOf(cabinet));

    expect(full.x.min).toBeLessThan(half.x.min);
    expect(half.x.min).toBeLessThan(inset.x.min);
    // Вкладной фасад стоит В проёме, а не перед ним.
    expect(inset.z.max).toBeLessThanOrEqual(modelOf(cabinet).depth);
    expect(full.z.min).toBe(modelOf(cabinet).depth);
  });

  it('Тест 36: позиция фасада считается автоматически', () => {
    withDoors(2);
    const [a, b] = typed(cabinet, 'facade');
    expect(a.position.x).toBeLessThan(b.position.x);
    expect(Math.abs(a.position.x + b.position.x)).toBeLessThan(0.01);
  });

  it('Тест 20/37/38: петли создаются автоматически по высоте фасада', () => {
    withDoors(2);
    const hinges = connectionsOfCategory('hinge');
    expect(hinges.length).toBeGreaterThan(0);
    // Число петель берётся из существующего правила: высокий фасад — больше петель.
    const perDoor = hinges[0].quantity ?? 0;
    expect(perDoor).toBeGreaterThanOrEqual(4);
  });

  it('Тест 21/39/40: ручки и их параметры', () => {
    withDoors(2);
    const model = modelOf(cabinet);
    expect(model.doors.handle.edgeOffset).toBeGreaterThan(0);
    store().applyCabinetPatch(cabinet, {
      doors: { ...model.doors, handle: { edgeOffset: 80, position: 'CENTER' } },
    });
    expect(modelOf(cabinet).doors.handle).toEqual({ edgeOffset: 80, position: 'CENTER' });
    expect(typed(cabinet, 'facade')[0].metadata?.handle).toEqual({ edgeOffset: 80, position: 'CENTER' });
  });
});

describe('Шкаф 28 — ящики', () => {
  const withDrawers = (count = 3, patch: Record<string, unknown> = {}) =>
    store().applyCabinetPatch(cabinet, {
      drawers: { ...modelOf(cabinet).drawers, count, ...patch },
    });

  it('Тест 22/32/46 (§132): ящик создаёт фронт, боковины, заднюю стенку и дно', () => {
    withDrawers(1);
    expect(typed(cabinet, 'drawer_front')).toHaveLength(1);
    expect(typed(cabinet, 'drawer_side')).toHaveLength(2);
    expect(typed(cabinet, 'drawer_back')).toHaveLength(1);
    expect(typed(cabinet, 'drawer_bottom')).toHaveLength(1);
  });

  it('Тест 23/33 (§133): высота ящика меняет фронт', () => {
    withDrawers(2);
    const before = typed(cabinet, 'drawer_front')[0].height;
    withDrawers(2, { frontHeight: 250 });
    expect(typed(cabinet, 'drawer_front')[0].height).toBe(250);
    expect(typed(cabinet, 'drawer_front')[0].height).not.toBe(before);
  });

  it('Тест 24/34 (§134): количество ящиков пересчитывает раскладку', () => {
    withDrawers(2);
    const two = drawerSlots(modelOf(cabinet));
    withDrawers(4);
    const four = drawerSlots(modelOf(cabinet));
    expect(four).toHaveLength(4);
    expect(four[0].height).toBeLessThan(two[0].height);
    expect(typed(cabinet, 'drawer_front')).toHaveLength(4);
  });

  it('Тест 24/43/45: ручное и параметрическое расположение, зазор', () => {
    withDrawers(2, { distribution: 'MANUAL', positions: [100, 500], frontHeight: 200 });
    const slots = drawerSlots(modelOf(cabinet));
    expect(slots.map((s) => s.y)).toEqual([100, 500]);

    withDrawers(2, { distribution: 'PARAMETRIC', positions: [], frontHeight: 200, gap: 10 });
    const parametric = drawerSlots(modelOf(cabinet));
    expect(Math.round(parametric[1].y - parametric[0].y)).toBe(210);
  });

  it('Тест 25/47: направляющие создаются автоматически', () => {
    withDrawers(2);
    const slides = connectionsOfCategory('slide');
    expect(slides.length).toBe(4); // по две на ящик
  });

  it('Тест 46/48: дно ящика получает паз, фронты не получают петель', () => {
    withDrawers(1);
    const side = typed(cabinet, 'drawer_side')[0];
    expect(side.machining.some((op) => op.type === 'slot')).toBe(true);

    const front = typed(cabinet, 'drawer_front')[0];
    const hinges = connectionsOfCategory('hinge').filter(
      (c) => String(c.partAId) === String(front.id) || String(c.partBId) === String(front.id),
    );
    expect(hinges).toHaveLength(0);
  });

  it('Тест 22: ящики и двери делят фасадную плоскость без пересечений', () => {
    store().applyCabinetPatch(cabinet, {
      doors: { ...modelOf(cabinet).doors, count: 2 },
      drawers: { ...modelOf(cabinet).drawers, count: 3 },
    });
    const zone = frontZone(modelOf(cabinet));
    const doors = doorZone(modelOf(cabinet));
    const slots = drawerSlots(modelOf(cabinet));
    expect(doors.y.min).toBeGreaterThan(zone.y.min);
    expect(doors.y.min).toBeGreaterThanOrEqual(Math.max(...slots.map((s) => s.y + s.height)));
    expect(checkPartCollisions(partsOf(cabinet))).toEqual([]);
  });
});

describe('Шкаф 28 — перегородки и секции', () => {
  it('Тест 26/35 (§135): добавление перегородки создаёт деталь', () => {
    store().applyCabinetPatch(cabinet, { partitions: { ...modelOf(cabinet).partitions, count: 1 } });
    expect(roleCount(cabinet, 'divider')).toBe(1);
  });

  it('Тест 26/36 (§136): количество перегородок делит проём на секции', () => {
    store().applyCabinetPatch(cabinet, {
      partitions: { ...modelOf(cabinet).partitions, count: 2 },
      shelves: { ...modelOf(cabinet).shelves, count: 2 },
    });
    expect(roleCount(cabinet, 'divider')).toBe(2);
    // Полки считаются по секциям: 3 секции × 2 полки.
    expect(roleCount(cabinet, 'shelf')).toBe(6);
  });

  it('Тест 26/52: изменение ширины пересчитывает секции', () => {
    store().applyCabinetPatch(cabinet, { partitions: { ...modelOf(cabinet).partitions, count: 1 } });
    const before = partsOf(cabinet).find((p) => p.role === 'divider')!.position.x;
    store().applyCabinetPatch(cabinet, { width: 1200 });
    const after = partsOf(cabinet).find((p) => p.role === 'divider')!.position.x;
    expect(Math.abs(after - before)).toBeLessThan(0.01); // перегородка по центру
    expect(keyed(cabinet, 'CABINET.TOP')!.width).toBe(1200 - 2 * modelOf(cabinet).thickness);
  });

  it('Тест 26/51: ручные положения перегородок соблюдаются', () => {
    store().applyCabinetPatch(cabinet, {
      partitions: { count: 1, positions: [300], orientation: 'VERTICAL' },
    });
    const divider = partsOf(cabinet).find((p) => p.role === 'divider')!;
    expect(Math.round(divider.position.x)).toBe(300 - 400);
  });
});

describe('Шкаф 28 — модули, координаты и граф зависимостей', () => {
  it('Тест 27/53/54/56: изделие содержит модули, деталь знает своё изделие', () => {
    const furniture = findFurniture(project(), cabinet)!;
    expect(furniture.assemblies.length).toBeGreaterThan(0);
    expect(furniture.assemblies[0].parts.length).toBeGreaterThan(0);
    expect(cabinetModelOf(furniture)).not.toBeNull();
  });

  it('Тест 28/29/57/58: локальные координаты деталей и мировой габарит', () => {
    const bounds = cabinetBounds(partsOf(cabinet));
    expect(Math.round(bounds.width)).toBe(800);
    expect(Math.round(bounds.height)).toBe(2000);
    expect(Math.round(bounds.depth)).toBeGreaterThanOrEqual(600);
    // Изделие центрировано по X: левая и правая боковины симметричны.
    const left = keyed(cabinet, 'CABINET.SIDE.LEFT')!;
    const right = keyed(cabinet, 'CABINET.SIDE.RIGHT')!;
    expect(Math.abs(left.position.x + right.position.x)).toBeLessThan(0.01);
  });

  it('Тест 30/59: граф зависимостей описан и не имеет циклов', () => {
    expect(CABINET_DEPENDENCY_NODES.length).toBeGreaterThan(20);
    expect(hasCycle()).toBe(false);
    const order = regenerationOrder();
    expect(order.indexOf('sides')).toBeLessThan(order.indexOf('shelves'));
    expect(order.indexOf('shelves')).toBeLessThan(order.indexOf('hardware'));
    expect(order.indexOf('hardware')).toBeLessThan(order.indexOf('machining'));
    expect(order.indexOf('machining')).toBeLessThan(order.indexOf('cutting'));
  });

  it('Тест 30/59: ширина доходит до раскроя и документов', () => {
    const chain = dependentsOf('width');
    for (const node of ['sides', 'shelves', 'doors', 'hardware', 'machining', 'cutting', 'documents']) {
      expect(chain).toContain(node);
    }
    expect(directDependents('width')).toContain('topBottom');
    expect(affectedByFields(['width'])).toContain('cutting');
    expect(affectedByFields(['legs'])).not.toContain('shelves');
  });
});

describe('Шкаф 28 — регенерация и атомарность', () => {
  it('Тест 31/60: пересчёт проходит все шаги маршрута', () => {
    const model = modelOf(cabinet);
    const result = regenerateCabinet(project(), cabinet, { ...model, width: 1000 }, { previous: model });
    expect(result.applied).toBe(true);
    const ids = result.steps.map((s) => s.id);
    expect(ids).toEqual(['validate', 'parts', 'connections', 'machining', 'collision', 'cutting', 'view3d', 'view2d']);
    expect(result.affected).toContain('cutting');
    expect(changedFields(model, { ...model, width: 1000 })).toEqual(['width']);
  });

  it('Тест 32/61/34 (§156): ошибка расчёта не оставляет полуфабрикат', () => {
    const before = partsOf(cabinet).map((p) => ({ id: p.id, width: p.width }));
    const applied = store().applyCabinetPatch(cabinet, { width: 10 });
    expect(applied.ok).toBe(false);
    expect(applied.errors.length).toBeGreaterThan(0);
    // Модель не повреждена: детали прежние.
    expect(partsOf(cabinet).map((p) => ({ id: p.id, width: p.width }))).toEqual(before);
    expect(modelOf(cabinet).width).toBe(800);
  });

  it('Тест 32/61: strict-режим отменяет пересчёт при пересечении', () => {
    const model = modelOf(cabinet);
    const broken: ParametricModel = {
      ...model,
      doors: { ...model.doors, count: 2, gaps: { ...model.doors.gaps, betweenGap: -50 } },
    };
    const result = regenerateCabinet(project(), cabinet, broken, { strict: true });
    expect(result.applied).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('Тест 33/76/77/78: валидация габаритов и лимитов', () => {
    expect(validateParametricModel(toCabinetModel(createParametricModel({ width: 0 }))).ok).toBe(false);
    expect(validateParametricModel(toCabinetModel(createParametricModel({ height: -1 }))).ok).toBe(false);
    expect(validateParametricModel(toCabinetModel(createParametricModel({ thickness: 0 }))).ok).toBe(false);
    expect(validateParametricModel(toCabinetModel(createParametricModel({ width: 40, thickness: 16 }))).ok).toBe(false);
    // Максимум задан лимитами шаблона.
    expect(validateParametricModel(toCabinetModel(createParametricModel({ width: 5000 }))).ok).toBe(false);
  });
});

describe('Шкаф 28 — пересечения и зазоры', () => {
  it('Тест 34/79/80: пересечение деталей — ошибка', () => {
    const parts = partsOf(cabinet);
    const clash: Part = {
      ...parts[0],
      id: 'clash' as PartId,
      name: 'Дубликат боковины',
      metadata: { ...parts[0].metadata, key: 'MANUAL.CLASH', partType: 'board' },
    };
    const issues = checkPartCollisions([...parts, clash]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('пересекаются');
  });

  it('Тест 34: вход детали в паз пересечением не считается', () => {
    store().applyCabinetPatch(cabinet, { backPanel: { ...modelOf(cabinet).backPanel, type: 'GROOVE' } });
    const back = keyed(cabinet, 'CABINET.BACK')!;
    const side = keyed(cabinet, 'CABINET.SIDE.LEFT')!;
    expect(isPermittedOverlap(back, side)).toBe(true);
    expect(checkPartCollisions(partsOf(cabinet))).toEqual([]);
  });

  it('Тест 35/81/82 (§157): зазоры фасада проверяются', () => {
    const model = modelOf(cabinet);
    const zero = toCabinetModel({
      ...model,
      doors: { ...model.doors, count: 2, gaps: { ...model.doors.gaps, topGap: 0 } },
    });
    const issues = checkDoorClearance(zero);
    expect(issues.some((i) => i.severity === 'warning')).toBe(true);

    const negative = toCabinetModel({
      ...model,
      doors: { ...model.doors, count: 2, gaps: { ...model.doors.gaps, betweenGap: 0 } },
    });
    expect(checkDoorClearance(negative).some((i) => i.severity === 'error')).toBe(true);
  });

  it('Тест 35/83: зазор ящиков и ширина короба', () => {
    const model = modelOf(cabinet);
    const noGap = toCabinetModel({ ...model, drawers: { ...model.drawers, count: 2, gap: 0 } });
    expect(checkDrawerClearance(noGap).some((i) => i.code === 'clearance.drawerGap')).toBe(true);

    const narrow = toCabinetModel({
      ...model, width: 150, thickness: 16,
      drawers: { ...model.drawers, count: 1, sideClearance: 45 },
    });
    expect(checkDrawerClearance(narrow).some((i) => i.code === 'clearance.drawerWidth')).toBe(true);
  });

  it('Тест 35/84: минимальный просвет между полками', () => {
    const model = modelOf(cabinet);
    const dense = toCabinetModel({ ...model, shelves: { ...model.shelves, count: 40 } });
    const issues = checkShelfClearance(dense);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain(String(MIN_SHELF_CLEARANCE));
  });

  it('Тест 34/85: присадка вне детали — ошибка зазора фурнитуры', () => {
    const check = store().checkCabinetConstruction(cabinet)!;
    expect(check.ok).toBe(true);

    const part = partsOf(cabinet)[0];
    store().addManualOperation({
      partId: part.id as PartId, face: 'front', x: part.width + 500, y: 10, diameter: 5, depth: 10,
    });
    const after = store().checkCabinetConstruction(cabinet)!;
    expect(after.ok).toBe(false);
    expect(after.issues.some((i) => i.code === 'clearance.hardware')).toBe(true);
  });
});

describe('Шкаф 28 — пресеты', () => {
  it('Тест 36/86: четыре встроенных пресета', () => {
    expect(BUILT_IN_CABINET_PRESETS.map((p) => p.name)).toEqual([
      'Стандартный корпус', 'Шкаф с дверями', 'Шкаф с ящиками', 'Стеллаж',
    ]);
    const model = modelFromPreset(BUILT_IN_CABINET_PRESETS[1]);
    expect(model.doors.count).toBe(2);
    expect(model.backPanel.type).toBe('GROOVE');
  });

  it('Тест 36/91: создание шкафа по пресету', () => {
    const id = store().createParametricCabinet({ presetId: 'cab-drawers', name: 'Тумба' });
    expect(id).toBeTruthy();
    const drawers = partsOf(id!).filter((p) => p.metadata?.partType === 'drawer_front');
    expect(drawers).toHaveLength(3);
  });

  it('Тест 36/37/38/87/88 (§160/§161): пользовательский пресет сохраняется в проекте', () => {
    store().applyCabinetPatch(cabinet, { width: 1234 });
    const preset = store().saveCabinetPreset(cabinet, 'Мой шкаф');
    expect(preset).not.toBeNull();
    expect(preset!.patch.width).toBe(1234);
    expect(store().project.metadata?.cabinetPresets).toHaveLength(1);

    // Пресет живёт в проекте: переживает сериализацию (§88).
    const restored = deserializeProject(JSON.stringify(store().project));
    expect((restored.metadata?.cabinetPresets as unknown[]).length).toBe(1);

    expect(store().removeCabinetPreset(preset!.id)).toBe(true);
    expect(store().project.metadata?.cabinetPresets).toHaveLength(0);
  });

  it('Тест 38/40/89 (§162): экспорт пресетов в JSON', () => {
    const json = exportCabinetPresets([presetFromModel(modelOf(cabinet), 'Экспорт')]);
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe(CABINET_PRESET_FORMAT);
    expect(parsed.presets).toHaveLength(1);
    expect(parsed.presets[0].patch.width).toBe(800);
  });

  it('Тест 37/41/89 (§163): импорт пресетов и отказ чужому файлу', () => {
    const json = exportCabinetPresets([presetFromModel(modelOf(cabinet), 'Импорт')]);
    const result = store().importCabinetPresetsFile(json);
    expect(result.ok).toBe(true);
    expect(result.added).toBe(1);

    expect(importCabinetPresets('{"format":"other"}').ok).toBe(false);
    expect(importCabinetPresets('не json').errors[0]).toContain('повреждён');
  });
});

describe('Шкаф 28 — создание, дубликат, копирование и удаление', () => {
  it('Тест 44/90/92/94: мастер создаёт шкаф по типу и габаритам', () => {
    const id = store().createParametricCabinet({
      type: 'WALL_UNIT', width: 600, height: 720, depth: 300, name: 'Навесной',
    });
    expect(id).toBeTruthy();
    const model = modelOf(id!);
    expect(model.cabinetType).toBe('WALL_UNIT');
    expect(model.width).toBe(600);
    expect(partsOf(id!).length).toBeGreaterThan(3);
  });

  it('Тест 93: предпросмотр показывает состав до создания', () => {
    const before = project().furnitures.length;
    const preview = store().previewParametricCabinet({ type: 'CABINET', width: 800 })!;
    expect(preview.parts).toBeGreaterThan(0);
    expect(preview.byRole.length).toBeGreaterThan(0);
    expect(preview.connections).toBeGreaterThanOrEqual(0);
    expect(project().furnitures).toHaveLength(before); // предпросмотр ничего не создаёт
    expect(previewCabinet(project(), modelOf(cabinet)).ok).toBe(true);
  });

  it('Тест 39/53 (§153): дубликат полностью независим', () => {
    const copyId = store().duplicateFurniture(cabinet)!;
    expect(copyId).toBeTruthy();
    const originalIds = new Set(partsOf(cabinet).map((p) => String(p.id)));
    for (const part of partsOf(copyId)) {
      expect(originalIds.has(String(part.id))).toBe(false);
      for (const op of part.machining) expect(String(op.partId)).toBe(String(part.id));
    }
    // Правка копии не трогает оригинал.
    store().applyCabinetPatch(copyId, { width: 1000 });
    expect(modelOf(cabinet).width).toBe(800);
    expect(modelOf(copyId).width).toBe(1000);
  });

  it('Тест 40/54 (§154): copy/paste переносит шкаф', () => {
    const json = store().copyCabinetToClipboard(cabinet)!;
    expect(JSON.parse(json).format).toBe(CABINET_CLIPBOARD_FORMAT);
    const pastedId = store().pasteCabinetFromClipboard()!;
    expect(pastedId).toBeTruthy();
    expect(project().furnitures).toHaveLength(2);
    expect(partsOf(pastedId).length).toBe(partsOf(cabinet).length);
    expect(pasteCabinet('{"format":"foreign"}')).toBeNull();
  });

  it('Тест 41/55 (§155): удаление шкафа убирает зависимости', () => {
    const impact = cabinetRemovalImpact(project(), cabinet)!;
    expect(impact.parts).toBeGreaterThan(0);
    expect(impact.connections).toBeGreaterThan(0);

    expect(store().deleteCabinet(cabinet)).toBe(true);
    expect(project().furnitures.find((f) => f.id === cabinet)).toBeUndefined();
    expect(project().hardwareConnections).toHaveLength(0);
    expect(removeCabinet(project(), cabinet).furnitures).toHaveLength(0);
  });

  it('Тест 41: удаление изделия чистит соединения и через removeFurniture', () => {
    store().removeFurniture(cabinet);
    expect(project().hardwareConnections).toHaveLength(0);
  });

  it('Тест 39/40: чистые функции копирования работают вне store', () => {
    const copy = duplicateCabinet(project(), cabinet, 'Копия')!;
    expect(copy.furniture.name).toBe('Копия');
    expect(copy.connections.length).toBeGreaterThan(0);
    expect(copyCabinet(project(), 'нет' as FurnitureId)).toBeNull();
  });
});

describe('Шкаф 28 — связь параметров и ручная правка', () => {
  it('Тест 42/58 (§158): Break Link отвязывает вычисляемый параметр', () => {
    const linked = { id: 'shelfWidth', name: 'Ширина полки', type: 'NUMBER' as const, value: 768, expression: 'width - 2 * thickness' };
    const broken = breakLink(linked, 900);
    expect(broken.overridden).toBe(true);
    expect(broken.value).toBe(900);
    // Параметр без выражения разрывать нечего.
    expect(breakLink({ id: 'w', name: 'w', type: 'NUMBER' as const, value: 800 }).overridden).toBeUndefined();
  });

  it('Тест 43/59 (§159): Reset Link возвращает расчёт', () => {
    const linked = { id: 'shelfWidth', name: 'Ширина полки', type: 'NUMBER' as const, value: 768, expression: 'width - 2 * thickness' };
    expect(resetLink(breakLink(linked, 900)).overridden).toBeUndefined();
  });

  it('Тест 102: ручная правка детали переживает пересчёт и сбрасывается', () => {
    const part = keyed(cabinet, 'CABINET.SHELF.001') ?? partsOf(cabinet)[0];
    store().setPartOverride(part.id as PartId, { width: 555 });
    store().applyCabinetPatch(cabinet, { height: 2100 });
    const after = findPart(project(), part.id)!;
    expect(after.width).toBe(555);
    expect(hasOverride(after)).toBe(true);

    store().resetPartOverride(part.id as PartId);
    store().applyCabinetPatch(cabinet, { height: 2000 });
    expect(hasOverride(findPart(project(), part.id)!)).toBe(false);
  });

  it('Тест 44: ручная деталь переживает регенерацию', () => {
    store().addPart({ name: 'Ручная деталь' });
    const manual = partsOf(cabinet).filter((p) => partSource(p) === 'MANUAL');
    expect(manual).toHaveLength(1);
    store().applyCabinetPatch(cabinet, { width: 900 });
    expect(partsOf(cabinet).filter((p) => partSource(p) === 'MANUAL')).toHaveLength(1);
  });
});

describe('Шкаф 28 — интеграции', () => {
  beforeEach(() => {
    store().applyCabinetPatch(cabinet, {
      doors: { ...modelOf(cabinet).doors, count: 2, handleEnabled: true },
      shelves: { ...modelOf(cabinet).shelves, count: 3 },
      drawers: { ...modelOf(cabinet).drawers, count: 2 },
    });
  });

  it('Тест 44/108/109/110/114 (§144): спецификация группирует одинаковые детали', () => {
    const bom = cabinetBom(project(), findFurniture(project(), cabinet)!);
    expect(bom.parts.length).toBeGreaterThan(0);
    expect(bom.totals.partCount).toBe(partsOf(cabinet).length);
    // Боковины одинаковы — попадают одной строкой с количеством 2.
    const sides = bom.parts.find((r) => r.name.includes('Боковина'));
    expect(sides?.quantity).toBe(2);
    expect(bom.parts.length).toBeLessThan(bom.totals.partCount);
    expect(cabinetBomCsv(bom).split('\n')[0]).toContain('Number;Name');
    expect(bomGroupKey({
      partId: 'p' as PartId, number: 'P001', name: 'x', quantity: 1,
      length: 100, width: 50, thickness: 16, materialId: null, materialName: 'ЛДСП',
      edgeLeft: '—', edgeRight: '—', edgeTop: '—', edgeBottom: '—',
    })).toContain('ЛДСП');
  });

  it('Тест 45/113/143 (§143): фурнитура попадает в спецификацию', () => {
    const bom = store().getCabinetBom(cabinet);
    expect(bom.hardware.length).toBeGreaterThan(0);
    expect(bom.totals.hardwareCount).toBeGreaterThan(0);
  });

  it('Тест 46/112/141 (§141): присадка формируется из соединений', () => {
    const ops = allOperations(project());
    expect(ops.length).toBeGreaterThan(0);
    const partIds = new Set(partsOf(cabinet).map((p) => String(p.id)));
    for (const op of ops) expect(partIds.has(String(op.partId))).toBe(true);
  });

  it('Тест 47/107/142 (§142): все детали попадают в раскрой', () => {
    const report = runCutting(project());
    expect(report.jobs.length).toBeGreaterThan(0);
    const placed = report.jobs.flatMap((j) => j.sheets).flatMap((s) => s.placements).length;
    expect(placed).toBeGreaterThan(0);
  });

  it('Тест 48/111: кромка считается существующим движком', () => {
    const banding = allEdgeBanding(project());
    expect(Array.isArray(banding)).toBe(true);
  });

  it('Тест 49/106/146/147/148: 2D-проекции показывают детали', () => {
    for (const view of ['TOP', 'FRONT', 'SIDE'] as const) {
      const entities = partEntities(project(), view);
      expect(entities.length).toBeGreaterThan(0);
    }
  });

  it('Тест 50/105/145 (§145): 3D-геометрия корректна сразу после создания', () => {
    const fresh = store().createParametricCabinet({ type: 'CABINET' })!;
    const bounds = cabinetBounds(partsOf(fresh));
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(checkPartCollisions(partsOf(fresh))).toEqual([]);
  });

  it('Тест 115: документы строятся по существующей системе', () => {
    const document = buildDocument(project(), 'partsList');
    expect(document).toBeTruthy();
  });
});

describe('Шкаф 28 — история, сохранение и производительность', () => {
  it('Тест 51/52/116/149/150: undo и redo возвращают параметры', () => {
    store().applyCabinetPatch(cabinet, { width: 1000 });
    expect(modelOf(cabinet).width).toBe(1000);
    store().undo();
    expect(modelOf(cabinet).width).toBe(800);
    store().redo();
    expect(modelOf(cabinet).width).toBe(1000);
  });

  it('Тест 117: несколько параметров — одна транзакция undo', () => {
    store().applyCabinetPatch(cabinet, { width: 1000, height: 2200, depth: 500 }, 'Габариты изменены');
    expect(modelOf(cabinet).height).toBe(2200);
    store().undo();
    const model = modelOf(cabinet);
    expect([model.width, model.height, model.depth]).toEqual([800, 2000, 600]);
  });

  it('Тест 53/54/118/119/151/152: проект переживает сериализацию и восстановление', () => {
    store().applyCabinetPatch(cabinet, { width: 1100 });
    const json = JSON.stringify(project());
    const restored = deserializeProject(json);
    const furniture = findFurniture(restored, cabinet)!;
    expect(readParametricModel(furniture).width).toBe(1100);
    expect(furniture.assemblies[0].parts.length).toBe(partsOf(cabinet).length);
  });

  it('Тест 55/120/164/165 (§120/§164): 100 шкафов строятся за разумное время', () => {
    store().newProject('Производительность');
    const started = Date.now();
    for (let i = 0; i < 100; i++) {
      const built = buildCabinet(project(), createCabinetModel('CABINET'), `Шкаф ${i + 1}`);
      expect(built.furniture.assemblies[0]!.parts.length).toBeGreaterThan(3);
    }
    expect(Date.now() - started).toBeLessThan(20000);
  });

  it('Тест 55/121 (§121): большой шкаф 2400×2400×600', () => {
    const id = store().createParametricCabinet({ width: 2400, height: 2400, depth: 600 });
    expect(id).toBeTruthy();
    const bounds = cabinetBounds(partsOf(id!));
    expect(Math.round(bounds.width)).toBe(2400);
    expect(Math.round(bounds.height)).toBe(2400);
  });

  it('Тест 56/122/166 (§122/§166): сложный шкаф проходит всю цепочку', () => {
    const id = store().createParametricCabinet({ width: 1200, height: 2200, depth: 600 })!;
    const applied = store().applyCabinetPatch(id, {
      doors: { ...modelOf(id).doors, count: 2, handleEnabled: true },
      shelves: { ...modelOf(id).shelves, count: 4 },
      drawers: { ...modelOf(id).drawers, count: 3 },
      partitions: { ...modelOf(id).partitions, count: 2 },
      backPanel: { ...modelOf(id).backPanel, type: 'GROOVE' },
    });
    expect(applied.ok).toBe(true);

    const parts = partsOf(id);
    expect(parts.filter((p) => p.metadata?.partType === 'facade')).toHaveLength(2);
    expect(parts.filter((p) => p.metadata?.partType === 'drawer_front')).toHaveLength(3);
    expect(parts.filter((p) => p.role === 'divider')).toHaveLength(2);
    expect(parts.filter((p) => p.role === 'shelf').length).toBe(12);

    // Пересечений нет, узлы и присадка построены, раскрой и спецификация считаются.
    const check = checkCabinet(project(), modelOf(id), parts);
    expect(check.errors).toBe(0);
    expect(project().hardwareConnections.length).toBeGreaterThan(0);
    expect(allOperations(project()).length).toBeGreaterThan(0);
    expect(runCutting(project()).jobs.length).toBeGreaterThan(0);
    expect(cabinetBom(project(), findFurniture(project(), id)!).parts.length).toBeGreaterThan(0);
    expect(partEntities(project(), 'FRONT').length).toBeGreaterThan(0);
  });

  it('Тест 56: внутренний проём поднимается над ящиками', () => {
    const id = store().createParametricCabinet({ width: 900, height: 2000, depth: 600 })!;
    store().applyCabinetPatch(id, { drawers: { ...modelOf(id).drawers, count: 2, frontHeight: 300 } });
    const zone = interiorZone(modelOf(id));
    const slots = drawerSlots(modelOf(id));
    expect(zone.y.min).toBeGreaterThanOrEqual(Math.max(...slots.map((s) => s.y + s.height)));
  });

  it('Тест 56: генерация без изделия не ломает модель', () => {
    const result = generateParts(toCabinetModel(createParametricModel({ width: 0 })), []);
    expect(result.ok).toBe(false);
    expect(result.parts).toEqual([]);
  });
});
