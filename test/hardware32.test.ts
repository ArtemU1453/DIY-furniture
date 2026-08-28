/**
 * ЭТАП 32 — Каталог фурнитуры и автоматическая присадка.
 *
 * Цепочка: каталог → HardwareItem на детали → PlacementRule → координаты →
 * MachiningTemplate → операции присадки → BOM → отчёты и схемы → производство.
 *
 * Проверяет каталог с поиском, фильтрами, избранным и своими позициями,
 * импорт/экспорт hardware-catalog.json с версией и миграцией, параметрические
 * петли, ручки, направляющие, полкодержатели, конфирматы, шканты, минификсы и
 * стяжки, правила размещения, локальные и мировые координаты, зависимости от
 * размеров мебели, Override и Reset, генерацию присадки, коллизии и зазоры,
 * BOM, отчёты, монтажные схемы, Undo/Redo, autosave, восстановление, сложный
 * шкаф и полную регрессию.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  HARDWARE_CATALOG_FORMAT,
  HARDWARE_CATALOG_VERSION,
  HARDWARE_KINDS,
  builtinCatalog,
  canPlaceItem,
  catalogKinds,
  catalogManufacturers,
  checkItem,
  checkItemConflicts,
  createCustomEntry,
  createItem,
  createSet,
  diagramToSvg,
  duplicateEntry,
  duplicateItem,
  exportCatalog,
  faceToWorld,
  favorites,
  filterCatalog,
  findEntry,
  handleAxis,
  handleCenter,
  hardwareBom,
  hardwareItemReport,
  hardwareItemReportCsv,
  hardwareMachiningReport,
  hardwareSpecification,
  hingeCount,
  hingePositions,
  importCatalog,
  installationDiagram,
  isItemOverridden,
  itemLayout,
  kindOfHardware,
  kindSpec,
  localPosition,
  mergeCatalog,
  migrateEntry,
  mirrorItem,
  moveItem,
  nudgeItem,
  pinRowCount,
  pinRowPositions,
  placementOf,
  projectItems,
  removalImpact,
  resetItem,
  resolveHardwareItem,
  searchCatalog,
  setItems,
  setQuantity,
  slideMountingPoints,
  toggleFavorite,
  validateHardwareItems,
  worldPosition,
} from '@/engines/hardware';
import { allOperations } from '@/engines/machining';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';
import { saveProject, loadProject as repoLoad } from '@/storage/project/projectRepository';
import { productionParts, productionReadiness } from '@/engines/production';
import { runCutting } from '@/engines/cutting';
import type { HardwareCatalog, Part, Project } from '@/core/model/types';
import type { HardwareId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;

/** Шкаф 800 × 2000 × 600 с фасадами, полками и ящиками. */
function makeCabinet(): void {
  store().newProject('Тест 32');
  const id = store().createParametricCabinet({ width: 800, height: 2000, depth: 600, name: 'Шкаф' })!;
  const model = store().getCabinetModel(id)!;
  store().applyCabinetPatch(id, {
    shelves: { ...model.shelves, count: 3 },
    doors: { ...model.doors, count: 2 },
  });
}

const door = (): Part =>
  allParts(project()).find((p) => String(p.metadata?.key ?? '').includes('DOOR'))
  ?? allParts(project()).reduce((a, b) => (a.height > b.height ? a : b));

const side = (): Part =>
  allParts(project()).find((p) => String(p.metadata?.key ?? '').includes('SIDE'))
  ?? allParts(project())[0];

/** Поставить фурнитуру каталога на деталь и вернуть id единицы. */
function place(entryId: string, part: Part, extra: Record<string, unknown> = {}): string {
  store().addCatalogHardwareToProject(entryId);
  const result = store().placeHardwareItem({
    hardwareId: entryId as HardwareId,
    partId: part.id as PartId,
    ...extra,
  });
  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
  return result.itemId!;
}

const itemById = (id: string) => projectItems(project()).find((i) => i.id === id)!;

/**
 * Изменить размеры шкафа параметрическим путём (этап 28).
 *
 * Детали пересоздаются с новыми id, но со стабильными ключами — именно так
 * фурнитура и должна за ними следовать (§76–§79).
 */
function resizeCabinet(patch: { width?: number; height?: number; depth?: number }): void {
  const id = store().activeFurnitureId!;
  const model = store().getCabinetModel(id)!;
  store().applyCabinetPatch(id, { ...patch, shelves: { ...model.shelves }, doors: { ...model.doors } });
}

beforeEach(() => {
  makeCabinet();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 32 — каталог', () => {
  it('Тест 1: встроенный каталог содержит все виды фурнитуры', () => {
    const catalog = builtinCatalog();
    expect(catalog.version).toBe(HARDWARE_CATALOG_VERSION);
    expect(catalog.entries.length).toBeGreaterThanOrEqual(HARDWARE_KINDS.length);
    for (const kind of ['HINGE', 'HANDLE', 'DRAWER_SLIDE', 'SHELF_PIN', 'CONFIRMAT',
      'MINIFIX', 'DOWEL', 'SCREW', 'BRACKET', 'LEG', 'CASTER', 'CONNECTOR', 'LOCK', 'OTHER']) {
      expect(catalogKinds(catalog)).toContain(kind);
    }
  });

  it('Тест 2: у позиции есть имя, вид, производитель, модель, артикул и параметры', () => {
    const entry = findEntry(builtinCatalog(), 'cat-hinge')!;
    expect(entry.hardware.name).toBeTruthy();
    expect(entry.kind).toBe('HINGE');
    expect(entry.hardware.manufacturer).toBeTruthy();
    expect(entry.hardware.model).toBeTruthy();
    expect(entry.hardware.article).toBeTruthy();
    expect(entry.hardware.parameters?.cupDiameter).toBe(35);
    expect(entry.installation).toBeTruthy();
  });

  it('Тест 3: поиск по названию, артикулу, производителю и виду', () => {
    const catalog = builtinCatalog();
    expect(searchCatalog(catalog, 'петля').length).toBeGreaterThan(0);
    expect(searchCatalog(catalog, 'KRK-HANDLE').length).toBe(1);
    expect(searchCatalog(catalog, 'karkas').length).toBeGreaterThan(0);
    expect(searchCatalog(catalog, 'DRAWER_SLIDE').length).toBeGreaterThan(0);
    expect(searchCatalog(catalog, 'нет-такого').length).toBe(0);
    expect(searchCatalog(catalog, '').length).toBe(catalog.entries.length);
  });

  it('Тест 4: фильтры по виду, производителю и происхождению', () => {
    let catalog = builtinCatalog();
    expect(filterCatalog(catalog, { kind: 'HINGE' }).every((e) => e.kind === 'HINGE')).toBe(true);
    expect(catalogManufacturers(catalog)).toContain('Karkas');

    const created = createCustomEntry(catalog, { name: 'Своя петля', kind: 'HINGE', manufacturer: 'Цех' });
    catalog = created.catalog;
    expect(filterCatalog(catalog, { origin: 'custom' }).length).toBe(1);
    expect(filterCatalog(catalog, { origin: 'catalog' }).every((e) => e.custom !== true)).toBe(true);
    expect(filterCatalog(catalog, { manufacturer: 'Цех' }).length).toBe(1);
  });

  it('Тест 5: своя позиция и копия существующей', () => {
    const catalog = builtinCatalog();
    const custom = createCustomEntry(catalog, {
      name: 'Петля 110°', kind: 'HINGE', article: 'H-110', parameters: { cupDepth: 11 },
    });
    expect(custom.entry.custom).toBe(true);
    expect(custom.entry.hardware.parameters?.cupDepth).toBe(11);
    // Значения по умолчанию вида сохраняются.
    expect(custom.entry.hardware.parameters?.cupDiameter).toBe(35);

    const copy = duplicateEntry(custom.catalog, String(custom.entry.hardware.id))!;
    expect(copy.entry.hardware.id).not.toBe(custom.entry.hardware.id);
    expect(copy.entry.custom).toBe(true);
    expect(copy.entry.hardware.name).toContain('копия');
  });

  it('Тест 6: избранное переключается и фильтруется', () => {
    let catalog = builtinCatalog();
    catalog = toggleFavorite(catalog, 'cat-handle');
    expect(favorites(catalog).map((e) => String(e.hardware.id))).toEqual(['cat-handle']);
    expect(filterCatalog(catalog, { favoritesOnly: true }).length).toBe(1);
    catalog = toggleFavorite(catalog, 'cat-handle');
    expect(favorites(catalog).length).toBe(0);
  });

  it('Тест 7: экспорт и импорт hardware-catalog.json', () => {
    const catalog = builtinCatalog();
    const json = exportCatalog(catalog);
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe(HARDWARE_CATALOG_FORMAT);
    expect(parsed.version).toBe(HARDWARE_CATALOG_VERSION);

    const result = importCatalog(json);
    expect(result.ok).toBe(true);
    expect(result.imported).toBe(catalog.entries.length);
    expect(result.catalog!.entries[0].kind).toBeTruthy();
  });

  it('Тест 8: повреждённый и чужой каталог не принимается', () => {
    expect(importCatalog('{').ok).toBe(false);
    expect(importCatalog('{"format":"другое"}').errors[0]).toContain('формат');
    expect(importCatalog(JSON.stringify({
      format: HARDWARE_CATALOG_FORMAT, version: 99, entries: [],
    })).errors[0]).toContain('Версия');
    const noEntries = importCatalog(JSON.stringify({
      format: HARDWARE_CATALOG_FORMAT, version: HARDWARE_CATALOG_VERSION, entries: [{ hardware: {} }],
    }));
    expect(noEntries.ok).toBe(false);
    expect(noEntries.skipped).toBe(1);
  });

  it('Тест 9: миграция старой версии каталога', () => {
    const entry = { hardware: findEntry(builtinCatalog(), 'cat-hinge')!.hardware, kind: undefined };
    const migrated = migrateEntry(entry as never, 1);
    expect(migrated.kind).toBe('HINGE');

    const old = JSON.stringify({
      format: HARDWARE_CATALOG_FORMAT,
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      entries: [{ hardware: { id: 'old-1', name: 'Старая петля', category: 'hinge' } }],
    });
    const result = importCatalog(old);
    expect(result.ok).toBe(true);
    expect(result.migrated).toBe(true);
    expect(result.catalog!.entries[0].kind).toBe('HINGE');
    expect(result.catalog!.version).toBe(HARDWARE_CATALOG_VERSION);
  });

  it('Тест 10: слияние каталогов обновляет позиции по id', () => {
    const base = builtinCatalog();
    const custom = createCustomEntry(base, { name: 'Своя', kind: 'SCREW' });
    const merged = mergeCatalog(base, custom.catalog);
    expect(merged.entries.length).toBe(custom.catalog.entries.length);
    expect(findEntry(merged, String(custom.entry.hardware.id))).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 32 — петли', () => {
  it('Тест 11: петля ставится на фасад и создаёт чашку с крепежом', () => {
    const id = place('cat-hinge', door());
    const layout = itemLayout(project(), itemById(id))!;
    expect(layout.anchors.length).toBeGreaterThanOrEqual(2);
    expect(layout.operations.some((o) => o.role === 'cup' && o.type === 'boring')).toBe(true);
    expect(layout.operations.some((o) => o.role === 'mounting')).toBe(true);
    const cup = layout.operations.find((o) => o.role === 'cup')!;
    expect(cup.diameter).toBe(35);
    expect(cup.through).toBe(false);
  });

  it('Тест 12: количество петель считается по высоте двери', () => {
    expect(hingeCount(700)).toBe(2);
    expect(hingeCount(1200)).toBe(3);
    expect(hingeCount(1900)).toBe(4);
    expect(hingeCount(2200, 400)).toBe(5);
    expect(hingeCount(2200, 700)).toBe(6);
  });

  it('Тест 13: петли распределяются по высоте с отступами и шагом', () => {
    const ys = hingePositions(2000, 4, { topOffset: 100, bottomOffset: 100 });
    expect(ys.length).toBe(4);
    expect(ys[0]).toBe(100);
    expect(ys[3]).toBe(1900);
    const spaced = hingePositions(2000, 3, { bottomOffset: 100, hingeSpacing: 400 });
    expect(spaced).toEqual([100, 500, 900]);
  });

  it('Тест 14: изменение высоты двери двигает петли', () => {
    const id = place('cat-hinge', door());
    const before = itemLayout(project(), itemById(id))!.operations
      .filter((o) => o.role === 'cup').map((o) => Math.round(o.y));

    resizeCabinet({ height: 1400 });
    const after = itemLayout(project(), itemById(id))!.operations
      .filter((o) => o.role === 'cup').map((o) => Math.round(o.y));
    expect(after).not.toEqual(before);
  });

  it('Тест 15: количество петель меняется параметром единицы', () => {
    const id = place('cat-hinge', door(), { quantity: 5 });
    const layout = itemLayout(project(), itemById(id))!;
    expect(layout.operations.filter((o) => o.role === 'cup').length).toBe(5);
  });

  it('Тест 16: узкий фасад и глубокая чашка дают ошибку', () => {
    const part = allParts(project()).reduce((a, b) => (a.width < b.width ? a : b));
    const draft = { ...project() };
    const item = createItem({ ...draft, hardware: [...draft.hardware, findEntry(builtinCatalog(), 'cat-hinge')!.hardware] }, {
      hardwareId: 'cat-hinge' as HardwareId,
      partId: part.id as PartId,
      parameters: { minDoorWidth: 100000 },
    })!;
    const withHw = {
      ...draft,
      hardware: [...draft.hardware, findEntry(builtinCatalog(), 'cat-hinge')!.hardware],
      hardwareInstances: [item],
    };
    const issues = checkItem(withHw, item);
    expect(issues.some((i) => i.code === 'hinge.narrowDoor' && i.severity === 'error')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 32 — ручки, направляющие, полкодержатели', () => {
  it('Тест 17: ручка создаёт два сквозных отверстия по межцентровому', () => {
    const id = place('cat-handle', door());
    const layout = itemLayout(project(), itemById(id))!;
    expect(layout.operations.length).toBe(2);
    expect(layout.operations.every((o) => o.through === true)).toBe(true);
    const dx = Math.abs(layout.operations[0].x - layout.operations[1].x);
    expect(Math.round(dx)).toBe(96);
  });

  it('Тест 18: положение ручки и поворот 0°/90°', () => {
    const size = { u: 400, v: 800 };
    expect(handleCenter(size, 'top', 40)).toEqual({ x: 200, y: 760 });
    expect(handleCenter(size, 'bottom', 40)).toEqual({ x: 200, y: 40 });
    expect(handleCenter(size, 'left', 40)).toEqual({ x: 40, y: 400 });
    expect(handleCenter(size, 'right', 40)).toEqual({ x: 360, y: 400 });
    expect(handleCenter(size, 'center', 40)).toEqual({ x: 200, y: 400 });

    expect(handleAxis('top', 0)).toBe('x');
    expect(handleAxis('top', 90)).toBe('y');
    expect(handleAxis('left', 0)).toBe('y');
    expect(handleAxis('left', 90)).toBe('x');
  });

  it('Тест 19: изменение размеров двери двигает ручку', () => {
    const id = place('cat-handle', door());
    const before = localPosition(project(), itemById(id))!;
    resizeCabinet({ width: 1200 });
    const after = localPosition(project(), itemById(id))!;
    expect(Math.round(after.x)).not.toBe(Math.round(before.x));
  });

  it('Тест 20: направляющая даёт монтажные точки и проверяет длину и зазор', () => {
    const id = place('cat-drawer_slide', side());
    const layout = itemLayout(project(), itemById(id))!;
    expect(layout.operations.length).toBeGreaterThan(0);
    expect(layout.operations.every((o) => o.role === 'mounting')).toBe(true);
    expect(slideMountingPoints(450, 32, 3)[0]).toBe(32);

    const long = createItem(project(), {
      hardwareId: 'cat-drawer_slide' as HardwareId,
      partId: side().id as PartId,
      parameters: { length: 5000 },
    })!;
    const draft = { ...project(), hardwareInstances: [...projectItems(project()), long] };
    expect(checkItem(draft, long).some((i) => i.code === 'slide.length')).toBe(true);

    const tight = createItem(project(), {
      hardwareId: 'cat-drawer_slide' as HardwareId,
      partId: side().id as PartId,
      parameters: { clearance: 0 },
    })!;
    const draft2 = { ...project(), hardwareInstances: [...projectItems(project()), tight] };
    expect(checkItem(draft2, tight).some((i) => i.code === 'slide.clearance')).toBe(true);
  });

  it('Тест 21: ряд полкодержателей считается автоматически', () => {
    expect(pinRowCount(2000, 100, 100, 32)).toBe(Math.floor(1800 / 32) + 1);
    const ys = pinRowPositions(2000, 100, 100, 32);
    expect(ys[0]).toBe(100);
    expect(ys[1] - ys[0]).toBe(32);

    const id = place('cat-shelf_pin', side());
    const layout = itemLayout(project(), itemById(id))!;
    expect(layout.operations.length).toBeGreaterThan(10);
    expect(layout.operations.every((o) => o.role === 'shelf-pin')).toBe(true);
    // Два ряда: спереди и сзади.
    expect(new Set(layout.operations.map((o) => Math.round(o.x))).size).toBe(2);
  });

  it('Тест 22: сторона ряда полкодержателей переключается параметром', () => {
    const left = resolveHardwareItem(
      { id: 'x', hardwareId: 'cat-shelf_pin' as HardwareId, partId: side().id, parameters: { side: 'left' } },
      findEntry(builtinCatalog(), 'cat-shelf_pin')!.hardware,
      side(),
    );
    const right = resolveHardwareItem(
      { id: 'x', hardwareId: 'cat-shelf_pin' as HardwareId, partId: side().id, parameters: { side: 'right' } },
      findEntry(builtinCatalog(), 'cat-shelf_pin')!.hardware,
      side(),
    );
    expect(left.operations[0].face).not.toBe(right.operations[0].face);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 32 — крепёж', () => {
  it('Тест 23: конфирмат создаёт сквозное и потай, направляющее — по материалу', () => {
    const id = place('cat-confirmat', side());
    const layout = itemLayout(project(), itemById(id))!;
    /* На пласти 16 мм направляющее отверстие 45 мм не помещается — оно
     * относится к торцу присоединяемой детали и делается по связи (§47). */
    expect(layout.operations.map((o) => o.role).sort()).toEqual(['body', 'head']);
    const body = layout.operations.find((o) => o.role === 'body')!;
    expect(body.type).toBe('confirmat');
    expect(body.through).toBe(true);
    expect(body.diameter).toBe(7);
  });

  it('Тест 24: шкант создаёт глухое отверстие нужного диаметра', () => {
    const id = place('cat-dowel', side());
    const layout = itemLayout(project(), itemById(id))!;
    expect(layout.operations.length).toBe(1);
    expect(layout.operations[0].type).toBe('dowel');
    expect(layout.operations[0].diameter).toBe(8);
    expect(layout.operations[0].through).toBe(false);
  });

  it('Тест 25: минификс создаёт эксцентрик, а болт и шкант — по материалу грани', () => {
    const id = place('cat-minifix', side());
    const layout = itemLayout(project(), itemById(id))!;
    const cam = layout.operations.find((o) => o.role === 'cam')!;
    expect(cam.diameter).toBe(15);
    expect(cam.depth).toBeLessThan(side().thickness);

    // На толстой детали в комплект входят все три связанные операции (§52/§53).
    const thick = { ...side(), thickness: 40, id: side().id };
    const full = resolveHardwareItem(
      { id: 'x', hardwareId: 'cat-minifix' as HardwareId, partId: thick.id },
      findEntry(builtinCatalog(), 'cat-minifix')!.hardware,
      thick,
    );
    expect(full.operations.map((o) => o.role).sort()).toEqual(['bolt', 'cam', 'dowel']);
    const bolt = full.operations.find((o) => o.role === 'bolt')!;
    const camFull = full.operations.find((o) => o.role === 'cam')!;
    expect(Math.round(bolt.x - camFull.x)).toBe(34);
  });

  it('Тест 26: стяжка создаёт две точки соединения', () => {
    const id = place('cat-connector', side());
    const layout = itemLayout(project(), itemById(id))!;
    expect(layout.operations.length).toBe(2);
    expect(layout.operations.every((o) => o.role === 'connector')).toBe(true);
  });

  it('Тест 27: уголок, опора, колесо и замок ставятся по своим правилам', () => {
    for (const [entryId, holes] of [['cat-bracket', 2], ['cat-leg', 1], ['cat-caster', 4], ['cat-lock', 1]] as const) {
      const id = place(entryId, side());
      const layout = itemLayout(project(), itemById(id))!;
      expect(layout.operations.length).toBe(holes);
    }
    const lockItemId = projectItems(project()).find((i) => i.hardwareId === 'cat-lock')!.id;
    expect(itemLayout(project(), itemById(lockItemId))!.operations[0].through).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 32 — размещение, координаты, Override', () => {
  it('Тест 28: правило размещения берётся из единицы, позиции или вида', () => {
    const hardware = findEntry(builtinCatalog(), 'cat-hinge')!.hardware;
    const item = { id: 'x', hardwareId: hardware.id, partId: door().id };
    expect(placementOf(item, hardware).reference).toBe(hardware.placement!.reference);
    expect(placementOf({ ...item, placement: { reference: 'CENTER' } }, hardware).reference).toBe('CENTER');
    expect(kindSpec('HINGE').placement.reference).toBe('EDGE');
  });

  it('Тест 29: локальные координаты хранятся относительно детали, мировые вычисляются', () => {
    const id = place('cat-handle', door());
    const local = localPosition(project(), itemById(id))!;
    expect(local.x).toBeGreaterThan(0);
    expect(local.y).toBeGreaterThan(0);

    const world = worldPosition(project(), itemById(id))!;
    expect(Number.isFinite(world.x)).toBe(true);
    const direct = faceToWorld(door(), local.face, local.x, local.y);
    expect(Math.round(world.x)).toBe(Math.round(direct.x));
    expect(Math.round(world.z)).toBe(Math.round(direct.z));

    // Мировое положение едет за деталью, локальное — нет.
    const before = worldPosition(project(), itemById(id))!;
    resizeCabinet({ height: 1600 });
    const after = worldPosition(project(), itemById(id))!;
    expect(Math.round(after.y)).not.toBe(Math.round(before.y));
  });

  it('Тест 30: ручное перемещение создаёт Override, Reset его снимает', () => {
    const id = place('cat-handle', door());
    const base = localPosition(project(), itemById(id))!;
    expect(isItemOverridden(itemById(id))).toBe(false);

    store().moveHardwareItem(id, { x: base.x + 50, y: base.y - 30 });
    const moved = itemById(id);
    expect(isItemOverridden(moved)).toBe(true);
    const after = localPosition(project(), moved)!;
    expect(Math.round(after.x)).toBe(Math.round(base.x + 50));
    expect(Math.round(after.y)).toBe(Math.round(base.y - 30));

    store().resetHardwareItem(id);
    expect(isItemOverridden(itemById(id))).toBe(false);
    expect(Math.round(localPosition(project(), itemById(id))!.x)).toBe(Math.round(base.x));
  });

  it('Тест 31: сдвиг, фиксация и скрытие единицы', () => {
    const id = place('cat-handle', door());
    const base = localPosition(project(), itemById(id))!;
    store().nudgeHardwareItems([id], 10, 5);
    expect(Math.round(localPosition(project(), itemById(id))!.x)).toBe(Math.round(base.x + 10));

    store().lockHardwareItem(id, true);
    const locked = itemById(id);
    expect(moveItem(project(), locked, { x: 0, y: 0 })).toBe(locked);
    expect(nudgeItem(locked, 10, 0)).toBe(locked);

    store().hideHardwareItem(id, true);
    expect(itemById(id).hidden).toBe(true);
  });

  it('Тест 32: копия независима, зеркало меняет сторону', () => {
    const id = place('cat-hinge', door());
    store().moveHardwareItem(id, { x: 30, y: 400 });
    const copyId = store().duplicateHardwareItem(id)!;
    store().resetHardwareItem(copyId);
    expect(isItemOverridden(itemById(id))).toBe(true);
    expect(isItemOverridden(itemById(copyId))).toBe(false);

    const slideId = place('cat-drawer_slide', side());
    store().moveHardwareItem(slideId, {
      x: localPosition(project(), itemById(slideId))!.x + 40,
    });
    const mirrorId = store().mirrorHardwareItem(slideId)!;
    // Зеркало отражает положение по грани, а не переносит на другую пласть.
    expect(itemById(mirrorId).override!.x).toBe(-itemById(slideId).override!.x!);
    expect(Math.round(localPosition(project(), itemById(mirrorId))!.x))
      .not.toBe(Math.round(localPosition(project(), itemById(slideId))!.x));
    expect(duplicateItem(project(), itemById(slideId)).id).not.toBe(slideId);
    expect(mirrorItem(project(), itemById(slideId))).not.toBeNull();
  });

  it('Тест 33: комплект хранит единицы и считает количество', () => {
    const a = place('cat-hinge', door());
    const b = place('cat-handle', door());
    const setId = store().groupHardwareItems('Комплект двери', [a, b])!;
    expect(setItems(project(), setId).map((i) => i.id).sort()).toEqual([a, b].sort());
    expect(setQuantity(project(), setId)).toBeGreaterThanOrEqual(2);
    expect(itemById(a).setId).toBe(setId);
    expect(createSet(project(), 'Ещё', [a]).id).not.toBe(setId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 32 — присадка и проверки', () => {
  it('Тест 34: операции фурнитуры попадают в общий список присадки', () => {
    const before = allOperations(project()).length;
    const id = place('cat-hinge', door());
    const ops = allOperations(project());
    expect(ops.length).toBeGreaterThan(before);
    const mine = ops.filter((op) => op.id.startsWith(`hw:${id}:`));
    expect(mine.length).toBe(itemLayout(project(), itemById(id))!.operations.length);
    expect(mine.every((op) => op.hardwareId === 'cat-hinge')).toBe(true);
    expect(mine.every((op) => op.source === 'HARDWARE_RULE')).toBe(true);
  });

  it('Тест 35: перемещение фурнитуры обновляет присадку', () => {
    const id = place('cat-handle', door());
    const before = allOperations(project()).filter((op) => op.id.startsWith(`hw:${id}:`)).map((op) => Math.round(op.x));
    const base = localPosition(project(), itemById(id))!;
    store().moveHardwareItem(id, { x: base.x + 60 });
    const after = allOperations(project()).filter((op) => op.id.startsWith(`hw:${id}:`)).map((op) => Math.round(op.x));
    expect(after).not.toEqual(before);
    expect(after[0] - before[0]).toBe(60);
  });

  it('Тест 36: выход за границы детали — ошибка', () => {
    const id = place('cat-handle', door());
    store().moveHardwareItem(id, { x: 100000, y: 100000 });
    const issues = checkItem(project(), itemById(id));
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('Тест 37: пересечение операций двух единиц — ошибка, близость — предупреждение', () => {
    const a = place('cat-dowel', side());
    const b = place('cat-dowel', side());
    // Обе единицы в центре детали: отверстия совпадают.
    expect(checkItemConflicts(project()).some((i) => i.code === 'item.conflict')).toBe(true);

    store().moveHardwareItem(b, {
      x: localPosition(project(), itemById(a))!.x + 12,
      y: localPosition(project(), itemById(a))!.y,
    });
    const near = checkItemConflicts(project());
    expect(near.some((i) => i.code === 'item.clearance' && i.severity === 'warning')).toBe(true);
  });

  it('Тест 38: невозможную фурнитуру не добавляем — ничего не меняется', () => {
    const before = projectItems(project()).length;
    const opsBefore = allOperations(project()).length;
    const result = store().placeHardwareItem({
      hardwareId: 'нет-такой' as HardwareId,
      partId: door().id as PartId,
    });
    expect(result.ok).toBe(false);
    expect(projectItems(project()).length).toBe(before);
    expect(allOperations(project()).length).toBe(opsBefore);

    const bad = createItem(project(), {
      hardwareId: 'cat-shelf_pin' as HardwareId,
      partId: door().id as PartId,
      parameters: { depth: 500 },
    });
    if (bad) {
      const draft = { ...project(), hardwareInstances: [...projectItems(project()), bad] };
      expect(canPlaceItem(draft, bad).ok).toBe(false);
    }
  });

  it('Тест 39: удаление уносит присадку и не трогает чужую', () => {
    const a = place('cat-hinge', door());
    const b = place('cat-handle', door());
    const impact = removalImpact(project(), a);
    expect(impact.itemIds).toEqual([a]);
    expect(impact.operationIds.length).toBeGreaterThan(0);

    store().removeHardwareItem(a);
    expect(projectItems(project()).some((i) => i.id === a)).toBe(false);
    expect(allOperations(project()).some((op) => op.id.startsWith(`hw:${a}:`))).toBe(false);
    expect(allOperations(project()).some((op) => op.id.startsWith(`hw:${b}:`))).toBe(true);
  });

  it('Тест 40: валидатор проекта собирает замечания по фурнитуре', () => {
    place('cat-hinge', door());
    const issues = validateHardwareItems(project());
    expect(Array.isArray(issues)).toBe(true);
    for (const issue of issues) expect(issue.itemId).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 32 — BOM, отчёты, схемы', () => {
  it('Тест 41: фурнитура попадает в BOM с расчётным количеством', () => {
    place('cat-hinge', door());
    const row = hardwareBom(project()).find((r) => r.hardwareId === 'cat-hinge')!;
    expect(row).toBeDefined();
    expect(row.quantity).toBeGreaterThanOrEqual(2);
    expect(row.partIds.length).toBeGreaterThan(0);
  });

  it('Тест 42: спецификация видит установленную фурнитуру', () => {
    place('cat-handle', door());
    const row = hardwareSpecification(project()).find((r) => String(r.hardwareId) === 'cat-handle');
    expect(row).toBeDefined();
    expect(row!.quantity).toBeGreaterThanOrEqual(1);
  });

  it('Тест 43: отчёт по фурнитуре группирует позиции и показывает использование', () => {
    place('cat-hinge', door());
    place('cat-hinge', door());
    const report = hardwareItemReport(project());
    const row = report.find((r) => r.name.includes('Петля'))!;
    expect(row.quantity).toBeGreaterThanOrEqual(4);
    expect(row.usage.length).toBeGreaterThan(0);
    expect(row.article).toBeTruthy();

    const csv = hardwareItemReportCsv(project()).split('\n');
    expect(csv[0]).toContain('Артикул');
    expect(csv.length).toBe(report.length + 1);
  });

  it('Тест 44: отчёт присадки показывает деталь, фурнитуру и координаты', () => {
    place('cat-confirmat', side());
    const rows = hardwareMachiningReport(project());
    expect(rows.length).toBe(2);
    expect(rows[0].partName).toBeTruthy();
    expect(rows[0].hardwareName).toBeTruthy();
    expect(rows[0].face).toBeTruthy();
    expect(rows.some((r) => r.diameter > 0)).toBe(true);
  });

  it('Тест 45: монтажные схемы строятся для всех видов', () => {
    for (const [entryId, expected] of [
      ['cat-hinge', 'Чашка'], ['cat-handle', 'Межцентровое'],
      ['cat-drawer_slide', 'Ось направляющей'], ['cat-shelf_pin', 'Ряд из'],
      ['cat-connector', 'Точек соединения'],
    ] as const) {
      const part = entryId === 'cat-hinge' || entryId === 'cat-handle' ? door() : side();
      const id = place(entryId, part);
      const diagram = installationDiagram(project(), itemById(id))!;
      expect(diagram.holes.length).toBeGreaterThan(0);
      expect(diagram.dimensions.length).toBeGreaterThan(0);
      expect(diagram.notes.join(' ')).toContain(expected);
      const svg = diagramToSvg(diagram);
      expect(svg).toContain('<svg');
      expect(svg).toContain('circle');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 32 — история, сохранение, интеграции', () => {
  it('Тест 46: добавление фурнитуры — одна запись истории, Undo и Redo работают', () => {
    const before = projectItems(project()).length;
    place('cat-hinge', door());
    expect(projectItems(project()).length).toBe(before + 1);

    store().undo();
    expect(projectItems(project()).length).toBe(before);
    store().redo();
    expect(projectItems(project()).length).toBe(before + 1);

    const id = projectItems(project())[before].id;
    store().moveHardwareItem(id, { x: 100 });
    expect(isItemOverridden(itemById(id))).toBe(true);
    store().undo();
    expect(isItemOverridden(itemById(id))).toBe(false);
  });

  it('Тест 47: фурнитура переживает сохранение и загрузку проекта', async () => {
    const id = place('cat-hinge', door());
    store().moveHardwareItem(id, { x: 40 });

    const restored = deserializeProject(serializeProject(project()));
    expect((restored.hardwareInstances ?? []).some((i) => i.id === id)).toBe(true);
    expect(restored.hardwareInstances!.find((i) => i.id === id)!.override).toBeDefined();

    await saveProject(project());
    const loaded = await repoLoad(project().id);
    expect((loaded?.hardwareInstances ?? []).length).toBeGreaterThan(0);
    store().loadProject(loaded!);
    expect(projectItems(project()).some((i) => i.id === id)).toBe(true);
    expect(allOperations(project()).some((op) => op.id.startsWith(`hw:${id}:`))).toBe(true);
  });

  it('Тест 48: проект без фурнитуры на деталях открывается без ошибок', () => {
    const raw = JSON.parse(serializeProject(project()));
    delete raw.hardwareInstances;
    delete raw.hardwareItemSets;
    const restored = deserializeProject(JSON.stringify(raw));
    expect(restored.hardwareInstances).toBeUndefined();
    expect(allOperations(restored).length).toBeGreaterThanOrEqual(0);
  });

  it('Тест 49: фурнитура доходит до производства, не меняя раскрой', () => {
    const beforeCut = runCutting(project()).jobs[0].sheets.length;
    place('cat-hinge', door());
    place('cat-shelf_pin', side());

    const parts = productionParts(project());
    const withOps = parts.filter((p) => p.operations.length > 0);
    expect(withOps.length).toBeGreaterThan(0);

    const readiness = productionReadiness(project(), parts);
    expect(readiness.checklist.find((i) => i.id === 'hardware')).toBeDefined();

    // §133: фурнитура не меняет геометрию деталей и раскрой.
    expect(runCutting(project()).jobs[0].sheets.length).toBe(beforeCut);
  });

  it('Тест 50: каталог store — избранное, своя позиция, импорт и экспорт', () => {
    const entryId = 'cat-handle';
    store().toggleHardwareFavorite(entryId);
    expect(findEntry(store().hardwareCatalog, entryId)!.favorite).toBe(true);

    const customId = store().createCustomHardware({ name: 'Ручка цеха', kind: 'HANDLE' })!;
    expect(findEntry(store().hardwareCatalog, customId)!.custom).toBe(true);

    const json = store().exportHardwareCatalogJson();
    const result = store().importHardwareCatalogJson(json);
    expect(result.ok).toBe(true);
    expect(result.imported).toBeGreaterThan(0);
    expect(store().importHardwareCatalogJson('{').ok).toBe(false);

    expect(store().addCatalogHardwareToProject(entryId)).toBe(entryId);
    expect(project().hardware.some((h) => String(h.id) === entryId)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 32 — сложный шкаф и регрессия', () => {
  it('Тест 51: сложный шкаф с полным набором фурнитуры перестраивается', () => {
    const doors = allParts(project()).filter((p) => String(p.metadata?.key ?? '').includes('DOOR'));
    const sides = allParts(project()).filter((p) => String(p.metadata?.key ?? '').includes('SIDE'));
    const target = doors.length > 0 ? doors : [door()];
    const targetSides = sides.length > 0 ? sides : [side()];

    for (const part of target) {
      place('cat-hinge', part);
      place('cat-handle', part);
    }
    for (const part of targetSides) {
      place('cat-shelf_pin', part);
      place('cat-drawer_slide', part);
      place('cat-confirmat', part);
    }

    const items = projectItems(project());
    expect(items.length).toBeGreaterThanOrEqual(5);
    const opsBefore = allOperations(project()).filter((op) => op.id.startsWith('hw:')).length;
    expect(opsBefore).toBeGreaterThan(20);

    const positions = items.map((i) => localPosition(project(), i));
    for (const change of [{ width: 1000 }, { height: 2200 }, { depth: 500 }]) {
      resizeCabinet(change);
    }
    const after = projectItems(project()).map((i) => localPosition(project(), i));
    expect(after.length).toBe(positions.length);
    // Фурнитура перестроилась вместе с корпусом (§178).
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(positions));
    expect(allOperations(project()).filter((op) => op.id.startsWith('hw:')).length).toBeGreaterThan(0);
  });

  it('Тест 52: цепочка ProjectModel → фурнитура → присадка → BOM → производство', () => {
    place('cat-hinge', door());
    place('cat-confirmat', side());

    const items = projectItems(project());
    expect(items.every((i) => findPart(project(), i.partId))).toBe(true);

    const ops = allOperations(project()).filter((op) => op.id.startsWith('hw:'));
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((op) => allParts(project()).some((p) => String(p.id) === String(op.partId)))).toBe(true);

    const bom = hardwareBom(project());
    expect(bom.some((r) => r.hardwareId === 'cat-hinge')).toBe(true);

    const parts = productionParts(project());
    const hinged = parts.find((p) => String(p.partId) === String(door().id))!;
    expect(hinged.operations.length).toBeGreaterThan(0);
  });

  it('Тест 53: производительность — 200 единиц фурнитуры считаются быстро', () => {
    const part = side();
    const hardware = findEntry(builtinCatalog(), 'cat-dowel')!.hardware;
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `mass-${i}`,
      hardwareId: hardware.id,
      partId: part.id,
      kind: 'DOWEL' as const,
      parameters: { x: 50 + (i % 20) * 30, y: 50 + Math.floor(i / 20) * 40 },
      source: 'manual' as const,
    }));
    const draft: Project = {
      ...project(),
      hardware: [...project().hardware, hardware],
      hardwareInstances: many,
    };

    const t0 = Date.now();
    const ops = allOperations(draft).filter((op) => op.id.startsWith('hw:'));
    const bom = hardwareBom(draft);
    const report = hardwareItemReport(draft);
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(ops.length).toBe(200);
    expect(bom.some((r) => r.hardwareId === hardware.id)).toBe(true);
    expect(report.length).toBeGreaterThan(0);
  });

  it('Тест 54: вид фурнитуры выводится из позиции каталога и не ломает прежние данные', () => {
    const catalog: HardwareCatalog = builtinCatalog();
    for (const entry of catalog.entries) {
      expect(kindOfHardware(entry.hardware)).toBeTruthy();
      expect(kindSpec(entry.kind).kind).toBe(entry.kind);
    }
    // Старая позиция без metadata.kind получает вид по категории.
    expect(kindOfHardware({ id: 'x' as HardwareId, name: 'Петля', category: 'hinge' })).toBe('HINGE');
    expect(kindOfHardware({ id: 'x' as HardwareId, name: 'Нечто', category: 'other' })).toBe('OTHER');
  });

  it('Тест 55: прежние возможности проекта не сломаны', () => {
    place('cat-hinge', door());
    expect(allParts(project()).length).toBeGreaterThan(0);
    expect(runCutting(project()).jobs.length).toBeGreaterThan(0);
    expect(hardwareBom(project()).length).toBeGreaterThan(0);
    expect(productionParts(project()).length).toBe(allParts(project()).length);
    const item = projectItems(project())[0];
    expect(resetItem({ ...item, override: { x: 5 } }).override).toBeUndefined();
  });
});
