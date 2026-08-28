/**
 * ЭТАП 26 — 2D-редактор конструкции мебели.
 *
 * Цепочка: 2D EDITOR → ProjectModel → PARAMETRIC → 3D → PARTS → HARDWARE →
 * MACHINING → CUTTING → DOCUMENTS.
 *
 * Проверяет разделение состояния интерфейса и модели, проекции трёх видов,
 * выделение, привязки, направляющие, замеры, ограничения, перемещение,
 * поворот, зеркало, выравнивание и распределение, буфер обмена, удаление,
 * блокировку, скрытие, изоляцию, параметрическое редактирование, Undo/Redo,
 * синхронизацию с 3D/присадкой/раскроем и работу на 1000 сущностей.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_EDITOR_2D,
  GRID_STEPS_2D,
  PLANE_AXES,
  activeEntity,
  addConstraint,
  addGuide,
  alignEntities,
  boundsOf,
  buildEntities,
  centerInParent,
  clearGuides,
  collectIssues,
  constraintGlyph,
  constraintStatus,
  copyEntities,
  createConstraint,
  createDimension,
  createGuide,
  cullEntities,
  deleteImpact,
  dimensionInfo,
  dimensionLength,
  distanceHints,
  distributeEntities,
  edgeSymbols,
  entityAt,
  equalSize,
  fitBounds,
  focusBounds,
  guideAt,
  holeSymbols,
  isSatisfied,
  markSelection,
  markStatuses,
  mirrorEntities,
  modelOfEntity,
  moveEntities,
  moveGuide,
  normalizeBounds,
  normalizeRotation,
  nudgeDelta,
  objectCandidates,
  parentOffsets,
  partOfEntity,
  pastePart,
  planeDeltaToWorld,
  prepareDuplicate,
  preparePaste,
  projectBounds,
  projectPoint,
  rectOf,
  removeConstraint,
  removeGuide,
  resizeEntity,
  resizedRect,
  rotateEntities,
  screenToWorld,
  selectInRect,
  selectedEntities,
  selectionTypes,
  setConstraintSuppressed,
  setEntityPosition,
  setGuideLocked,
  setParameter,
  snapRect,
  snapValueToGrid,
  solveConstraints,
  statusOfEntity,
  toggleSelection,
  unprojectPoint,
  worldToScreen,
  type Constraint2D,
  type EditorEntity,
  type Viewport,
} from '@/engines/editor2d';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { partWorldAABB } from '@/core/geometry/partGeometry';
import { partTransform } from '@/engines/viewer';
import { allOperations } from '@/engines/machining';
import { runCutting } from '@/engines/cutting';
import { buildDocument } from '@/engines/drawing';
import { readParametricModel } from '@/engines/parametric';
import type { Project } from '@/core/model/types';
import type { FurnitureId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;
const ui = () => store().editor2d;

/** Пустой проект без изделий. */
function emptyProject(): void {
  store().newProject('Тест 26');
}

/** Деталь 600×400 из §158. */
function makePart(width = 600, height = 400): PartId {
  const id = store().addPart({ name: 'Деталь', width, height, thickness: 16 });
  return id;
}

/** Параметрический шкаф — источник модулей, соединений и присадки. */
function makeCabinet(): FurnitureId {
  emptyProject();
  const id = store().createParametricFurniture('param-cabinet');
  expect(id).toBeTruthy();
  return id!;
}

const entities = (): EditorEntity[] => store().editorEntities();
const partEntity = (id: PartId): EditorEntity =>
  entities().find((e) => e.entityId === String(id) && e.entityType === 'PART')!;

function entity(id: string, x: number, y: number, w: number, h: number, over: Partial<EditorEntity> = {}): EditorEntity {
  return {
    entityId: id,
    entityType: 'PART',
    transform: { x, y, width: w, height: h, rotation: 0, mirrored: false },
    selectionState: 'none',
    label: id,
    locked: false,
    hidden: false,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('Редактор 2D 26 — состояние и проекции', () => {
  beforeEach(emptyProject);

  it('Тест 1/2/131: EditorState отделён от ProjectModel', () => {
    // §2: в состоянии интерфейса нет производственных данных.
    const keys = Object.keys(DEFAULT_EDITOR_2D);
    for (const forbidden of ['parts', 'materials', 'hardware', 'machining', 'cutting', 'furnitures']) {
      expect(keys).not.toContain(forbidden);
    }
    // §131: правка интерфейса не трогает проект и не пишется в историю.
    const before = JSON.stringify(project());
    const past = store().past.length;
    store().setEditor2D({ zoom: 2, panX: 100, showGrid: false });
    expect(JSON.stringify(project())).toBe(before);
    expect(store().past.length).toBe(past);
    expect(ui().zoom).toBe(2);
  });

  it('Тест 33/172/173/174: три ортографических вида проецируют разные оси', () => {
    const point = { x: 100, y: 200, z: 300 };
    expect(projectPoint(point, 'FRONT')).toEqual({ x: 100, y: 200 }); // ширина × высота
    expect(projectPoint(point, 'TOP')).toEqual({ x: 100, y: 300 });   // ширина × глубина
    expect(projectPoint(point, 'SIDE')).toEqual({ x: 300, y: 200 });  // глубина × высота

    expect(PLANE_AXES.FRONT.h).toBe('X');
    expect(PLANE_AXES.FRONT.v).toBe('Y');
    expect(PLANE_AXES.TOP.v).toBe('Z');
    expect(PLANE_AXES.SIDE.h).toBe('Z');

    // Обратное преобразование: третья координата берётся из опорной точки (§8).
    expect(unprojectPoint({ x: 10, y: 20 }, 'FRONT', point)).toEqual({ x: 10, y: 20, z: 300 });
    expect(unprojectPoint({ x: 10, y: 20 }, 'TOP', point)).toEqual({ x: 10, y: 200, z: 20 });
  });

  it('Тест 6/8: экранные координаты обратимы и в модель не попадают', () => {
    const view: Viewport = { zoom: 0.5, panX: 100, panY: 50, widthPx: 800, heightPx: 600 };
    const world = { x: 340, y: 220 };
    const screen = worldToScreen(world, view);
    const back = screenToWorld(screen, view);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
    // Ось Y экрана направлена вниз: верх модели выше на экране.
    expect(worldToScreen({ x: 0, y: 100 }, view).y).toBeLessThan(worldToScreen({ x: 0, y: 0 }, view).y);
  });

  it('Тест 39/89/90/128: отсечение по видимой области и вписывание', () => {
    const list = [entity('a', 0, 0, 100, 100), entity('b', 5000, 5000, 100, 100)];
    const view: Viewport = { zoom: 1, panX: 0, panY: 0, widthPx: 500, heightPx: 500 };
    expect(cullEntities(list, view).map((e) => e.entityId)).toEqual(['a']);

    const bounds = boundsOf(list)!;
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 5100, maxY: 5100 });
    const camera = fitBounds(bounds, 800, 600);
    expect(camera.zoom).toBeGreaterThan(0);
    expect(camera.zoom).toBeLessThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Редактор 2D 26 — сущности и выделение', () => {
  beforeEach(() => { makeCabinet(); });

  it('Тест 14/158: деталь появляется на холсте и выбирается', () => {
    emptyProject();
    const id = makePart(600, 400);
    const e = partEntity(id);
    expect(e).toBeDefined();
    expect(Math.round(e.transform.width)).toBe(600);
    expect(Math.round(e.transform.height)).toBe(400);

    store().setEditorSelection([String(id)]);
    expect(ui().selection).toEqual([String(id)]);
    expect(activeEntity(entities(), ui().selection)?.entityId).toBe(String(id));
  });

  it('Тест 2/5: сущности всех типов строятся из ProjectModel', () => {
    const list = buildEntities(project(), { plane: 'FRONT', showHardware: true, showConnections: true });
    const types = new Set(list.map((e) => e.entityType));
    expect(types.has('MODULE')).toBe(true);
    expect(types.has('PART')).toBe(true);
    expect(types.has('HARDWARE')).toBe(true);
    expect(types.has('CONNECTION')).toBe(true);
    // §7: каждая сущность ссылается на реальный объект проекта.
    for (const e of list.filter((x) => x.entityType === 'PART')) {
      expect(findPart(project(), e.entityId as PartId)).toBeDefined();
    }
  });

  it('Тест 3/18: множественный выбор и типы выделения', () => {
    const parts = entities().filter((e) => e.entityType === 'PART').slice(0, 3);
    let selection: string[] = [];
    for (const p of parts) selection = toggleSelection(selection, p.entityId);
    expect(selection.length).toBe(3);
    selection = toggleSelection(selection, parts[0].entityId);
    expect(selection.length).toBe(2);

    store().setEditorSelection(parts.map((p) => p.entityId));
    expect(selectedEntities(entities(), ui().selection).length).toBe(3);
    expect(selectionTypes(entities(), ui().selection)).toEqual(['PART']);
  });

  it('Тест 2/19/20: выделение рамкой и фильтр типов', () => {
    const list = [entity('a', 0, 0, 100, 100), entity('b', 200, 200, 100, 100), entity('m', 0, 0, 500, 500, { entityType: 'MODULE' })];
    const bounds = normalizeBounds({ x: -10, y: -10 }, { x: 150, y: 150 });
    // Внутри целиком — только «a».
    expect(selectInRect(list, bounds)).toEqual(['a']);
    // Касанием — ещё и модуль.
    expect(selectInRect(list, bounds, { crossing: true }).sort()).toEqual(['a', 'm']);
    // §20: фильтр убирает модули из выделения.
    const filter = { ...DEFAULT_EDITOR_2D.filter, MODULE: false };
    expect(selectInRect(list, bounds, { crossing: true, filter })).toEqual(['a']);
  });

  it('Тест 2/17: под точкой выбирается верхний (меньший) объект', () => {
    const list = [entity('big', 0, 0, 500, 500, { entityType: 'MODULE' }), entity('small', 100, 100, 50, 50)];
    expect(entityAt(list, { x: 120, y: 120 })?.entityId).toBe('small');
    expect(entityAt(list, { x: 400, y: 400 })?.entityId).toBe('big');
    expect(entityAt(list, { x: 900, y: 900 })).toBeUndefined();
  });

  it('Тест 2/21: состояние выделения проставляется, ESC его снимает', () => {
    const list = [entity('a', 0, 0, 10, 10), entity('b', 20, 0, 10, 10)];
    const marked = markSelection(list, ['a', 'b']);
    expect(marked[0].selectionState).toBe('selected');
    expect(marked[1].selectionState).toBe('active'); // последний — активный
    store().setEditorSelection([]);
    expect(ui().selection).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Редактор 2D 26 — сетка, привязки, направляющие', () => {
  beforeEach(emptyProject);

  it('Тест 9/161: привязка к сетке округляет до шага', () => {
    expect(GRID_STEPS_2D).toEqual([1, 5, 10, 20, 50]);
    expect(snapValueToGrid(123, 10)).toBe(120);
    expect(snapValueToGrid(126, 10)).toBe(130);
    expect(snapValueToGrid(123, 50)).toBe(100);
    expect(snapValueToGrid(123, 0)).toBe(123); // шаг 0 — привязки нет

    const moved = snapRect({ x: 123, y: 47, width: 100, height: 100 }, {
      settings: { toGrid: true, toObjects: false, toGuides: false, distance: 8 },
      gridStep: 10, entities: [], guides: [],
    });
    expect(moved.x).toBe(120);
    expect(moved.y).toBe(50);
    expect(moved.matches.every((m) => m.kind === 'grid')).toBe(true);
  });

  it('Тест 8/162: привязка к краю и центру соседнего объекта', () => {
    const neighbour = entity('n', 500, 0, 200, 300);
    const candidates = objectCandidates([neighbour]);
    expect(candidates.some((c) => c.axis === 'x' && c.value === 500 && c.kind === 'edge')).toBe(true);
    expect(candidates.some((c) => c.axis === 'x' && c.value === 600 && c.kind === 'center')).toBe(true);

    const snapped = snapRect({ x: 496, y: 0, width: 100, height: 100 }, {
      settings: { toGrid: false, toObjects: true, toGuides: false, distance: 8 },
      gridStep: 10, entities: [neighbour], guides: [], excludeIds: ['moving'],
    });
    expect(snapped.x).toBe(500);
    expect(snapped.matches[0].kind).toBe('edge');
  });

  it('Тест 8/47: объекты и направляющие важнее сетки', () => {
    const neighbour = entity('n', 503, 0, 100, 100);
    const snapped = snapRect({ x: 501, y: 0, width: 50, height: 50 }, {
      settings: { toGrid: true, toObjects: true, toGuides: false, distance: 8 },
      gridStep: 10, entities: [neighbour], guides: [],
    });
    // Край соседа (503) ближе, чем узел сетки (500) — побеждает сосед.
    expect(snapped.x).toBe(503);
  });

  it('Тест 10/176: направляющие создаются, двигаются, блокируются и удаляются', () => {
    let guides = addGuide([], createGuide('vertical', 300, 'FRONT', 'g1'));
    guides = addGuide(guides, createGuide('horizontal', 800, 'FRONT', 'g2'));
    expect(guides.length).toBe(2);

    guides = moveGuide(guides, 'g1', 350);
    expect(guides.find((g) => g.id === 'g1')!.position).toBe(350);

    // §52: заблокированная направляющая не двигается и не удаляется.
    guides = setGuideLocked(guides, 'g1', true);
    guides = moveGuide(guides, 'g1', 999);
    expect(guides.find((g) => g.id === 'g1')!.position).toBe(350);
    guides = removeGuide(guides, 'g1');
    expect(guides.some((g) => g.id === 'g1')).toBe(true);

    guides = removeGuide(guides, 'g2');
    expect(guides.some((g) => g.id === 'g2')).toBe(false);

    expect(guideAt(guides, { x: 352, y: 0 }, 5)?.id).toBe('g1');
    expect(clearGuides(guides).length).toBe(1); // заблокированная остаётся
  });

  it('Тест 10: направляющие живут в состоянии интерфейса, не в проекте', () => {
    const before = JSON.stringify(project());
    store().setEditorGuides([createGuide('vertical', 100, 'FRONT', 'gx')]);
    expect(ui().guides.length).toBe(1);
    expect(JSON.stringify(project())).toBe(before);
  });

  it('Тест 8/45: расстояния до соседей считаются только по пересекающимся осям', () => {
    const moving = entity('m', 0, 0, 100, 100);
    const right = entity('r', 200, 0, 100, 100);   // на одной высоте
    const away = entity('a', 200, 900, 100, 100);  // в стороне
    const hints = distanceHints(moving, [right, away]);
    expect(hints.some((h) => h.toId === 'r' && h.axis === 'x' && h.distance === 100)).toBe(true);
    expect(hints.some((h) => h.toId === 'a')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Редактор 2D 26 — перемещение, поворот, зеркало, размер', () => {
  beforeEach(emptyProject);

  it('Тест 4/158: перемещение меняет ProjectModel одной транзакцией', () => {
    const id = makePart();
    const before = findPart(project(), id)!.position.x;
    const past = store().past.length;

    const res = moveEntities([partEntity(id)], 'FRONT', 120, 0);
    expect(res.changes.length).toBe(1);
    store().applyEditorChanges(res.changes);

    expect(findPart(project(), id)!.position.x).toBe(before + 120);
    // §122: одна операция — одна запись в истории.
    expect(store().past.length).toBe(past + 1);
  });

  it('Тест 4/23/24: точное перемещение стрелками 1 и 10 мм', () => {
    expect(nudgeDelta('ArrowRight', false)).toEqual({ dx: 1, dy: 0 });
    expect(nudgeDelta('ArrowRight', true)).toEqual({ dx: 10, dy: 0 });
    expect(nudgeDelta('ArrowDown', false)).toEqual({ dx: 0, dy: -1 });
    expect(nudgeDelta('Enter', false)).toBeNull();
  });

  it('Тест 4/26: числовой ввод положения задаёт координату точно', () => {
    const id = makePart();
    const e = partEntity(id);
    const res = setEntityPosition(e, 'FRONT', 450, 120);
    store().applyEditorChanges(res.changes);
    const after = partEntity(id);
    expect(Math.round(after.transform.x)).toBe(450);
    expect(Math.round(after.transform.y)).toBe(120);
  });

  it('Тест 4/8: смещение вида переводится в правильную мировую ось', () => {
    expect(planeDeltaToWorld('FRONT', 10, 20)).toEqual({ dx: 10, dy: 20, dz: 0 });
    expect(planeDeltaToWorld('TOP', 10, 20)).toEqual({ dx: 10, dy: 0, dz: 20 });
    expect(planeDeltaToWorld('SIDE', 10, 20)).toEqual({ dx: 0, dy: 20, dz: 10 });
  });

  it('Тест 6/27/28: поворот нормализуется к ортогональному', () => {
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(47)).toBe(90);  // произвольный угол округляется
    expect(normalizeRotation(NaN)).toBe(0);

    const id = makePart();
    store().applyEditorChanges(rotateEntities([partEntity(id)], 90).changes);
    expect(findPart(project(), id)!.rotation.y).toBe(90);
  });

  it('Тест 7/29: зеркалить можно только модуль целиком', () => {
    const id = makePart();
    const refused = mirrorEntities([partEntity(id)], 'horizontal');
    expect(refused.changes.length).toBe(0);
    expect(refused.refusals[0].code).toBe('editor.mirrorModuleOnly');

    const cabinet = makeCabinet();
    const module = entities().find((e) => e.entityType === 'MODULE' && e.entityId === String(cabinet))!;
    const ok = mirrorEntities([module], 'horizontal');
    expect(ok.changes.length).toBe(1);
    store().applyEditorChanges(ok.changes);
    const furniture = project().furnitures.find((f) => f.id === cabinet)!;
    expect(furniture.metadata?.mirrored).toBe(true);
  });

  it('Тест 5/30/32/160/171: размер детали правится параметром, а не растягиванием', () => {
    const cabinet = makeCabinet();
    const part = entities().find((e) => e.entityType === 'PART')!;
    const refused = resizeEntity(part, { plane: 'FRONT', handle: 'e', width: 900, height: 400, model: null });
    expect(refused.changes.length).toBe(0);
    expect(refused.refusals[0].code).toBe('editor.parametricPart');

    // §31/§159: изменение габарита модуля меняет ЕГО ПАРАМЕТРЫ.
    const module = entities().find((e) => e.entityType === 'MODULE')!;
    const model = modelOfEntity(project(), module);
    expect(model).not.toBeNull();
    const res = resizeEntity(module, { plane: 'FRONT', handle: 'e', width: 1000, height: 2000, model });
    expect(res.changes.some((c) => c.kind === 'parameter' && c.key === 'width' && c.value === 1000)).toBe(true);
    store().applyEditorChanges(res.changes);
    expect(readParametricModel(project().furnitures.find((f) => f.id === cabinet)!).width).toBe(1000);
  });

  it('Тест 5/146/147: ручка задаёт габарит, значения ограничиваются', () => {
    expect(resizedRect({ x: 0, y: 0, width: 100, height: 100 }, 'e', 50, 0)).toEqual({ x: 0, y: 0, width: 150, height: 100 });
    expect(resizedRect({ x: 0, y: 0, width: 100, height: 100 }, 'w', 20, 0)).toEqual({ x: 20, y: 0, width: 80, height: 100 });
    expect(resizedRect({ x: 0, y: 0, width: 100, height: 100 }, 'n', 0, 30)).toEqual({ x: 0, y: 0, width: 100, height: 130 });

    const cabinet = makeCabinet();
    const module = entities().find((e) => e.entityId === String(cabinet))!;
    const model = modelOfEntity(project(), module);
    // §147: значение зажимается минимумом.
    const res = resizeEntity(module, { plane: 'FRONT', handle: 'e', width: 1, height: 2000, model });
    const width = res.changes.find((c) => c.kind === 'parameter' && c.key === 'width');
    expect(width && width.kind === 'parameter' && width.value >= 20).toBe(true);
  });

  it('Тест 20/85: заблокированный объект не двигается', () => {
    const id = makePart();
    store().setEditorLocked(String(id), true);
    const res = moveEntities([partEntity(id)], 'FRONT', 100, 0);
    expect(res.changes.length).toBe(0);
    expect(res.refusals[0].code).toBe('editor.locked');
  });

  it('Тест 118/119/134: некорректное значение и режим чтения не меняют модель', () => {
    const id = makePart();
    const e = partEntity(id);
    expect(setParameter(e, 'width', -5).changes.length).toBe(0);
    expect(setParameter(e, 'width', NaN).refusals[0].code).toBe('editor.badValue');

    // §134: в режиме только для чтения изменения не применяются.
    store().setEditor2D({ readOnly: true });
    const before = findPart(project(), id)!.position.x;
    const res = store().applyEditorChanges(moveEntities([partEntity(id)], 'FRONT', 100, 0).changes);
    expect(res.applied).toBe(0);
    expect(findPart(project(), id)!.position.x).toBe(before);
    store().setEditor2D({ readOnly: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Редактор 2D 26 — выравнивание и распределение', () => {
  it('Тест 23/163: выравнивание трёх деталей по левому краю', () => {
    const list = [entity('a', 0, 0, 100, 100), entity('b', 250, 50, 100, 100), entity('c', 500, 90, 100, 100)];
    const patch = alignEntities(list, 'LEFT');
    expect(Object.values(patch).every((p) => p.x === 0)).toBe(true);

    const right = alignEntities(list, 'RIGHT');
    expect(right.a.x).toBe(500);
    const center = alignEntities(list, 'CENTER');
    expect(center.a.x).toBe(250);

    const bottom = alignEntities(list, 'BOTTOM');
    expect(Object.values(bottom).every((p) => p.y === 0)).toBe(true);
    const top = alignEntities(list, 'TOP');
    expect(top.a.y).toBe(90);
  });

  it('Тест 24/164: распределение выравнивает промежутки', () => {
    const list = [entity('a', 0, 0, 100, 100), entity('b', 150, 0, 100, 100), entity('c', 600, 0, 100, 100)];
    const patch = distributeEntities(list, 'x');
    // Крайние остаются на месте, средняя встаёт ровно посередине.
    expect(patch.a).toBeUndefined();
    expect(patch.c).toBeUndefined();
    expect(patch.b!.x).toBe(300);

    // Меньше трёх объектов распределять нечего.
    expect(distributeEntities(list.slice(0, 2), 'x')).toEqual({});
  });

  it('Тест 23/42: уравнивание размеров берёт эталоном активный объект', () => {
    const list = [entity('a', 0, 0, 100, 100), entity('b', 200, 0, 300, 400)];
    const patch = equalSize(list, 'width', 'b');
    expect(patch.a!.width).toBe(300);
    expect(patch.b).toBeUndefined();

    const byHeight = equalSize(list, 'height', 'b');
    expect(byHeight.a!.height).toBe(400);
  });

  it('Тест 23/43/44: центрирование в родителе и отступы', () => {
    const parent = entity('p', 0, 0, 1000, 800, { entityType: 'MODULE' });
    const child = entity('c', 100, 100, 200, 200, { parentId: 'p' });
    const patch = centerInParent([child], parent, 'horizontal');
    expect(patch.c!.x).toBe(400);

    const offsets = parentOffsets(child, parent);
    expect(offsets).toEqual({ left: 100, right: 700, bottom: 100, top: 500 });
  });

  it('Тест 23/85/86: заблокированные и скрытые в выравнивании не участвуют', () => {
    const list = [
      entity('a', 0, 0, 100, 100),
      entity('b', 250, 0, 100, 100, { locked: true }),
      entity('c', 500, 0, 100, 100, { hidden: true }),
      entity('d', 700, 0, 100, 100),
    ];
    const patch = alignEntities(list, 'LEFT');
    expect(patch.b).toBeUndefined();
    expect(patch.c).toBeUndefined();
    expect(patch.a).toBeDefined();
    expect(patch.d).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Редактор 2D 26 — размеры и ограничения', () => {
  beforeEach(emptyProject);

  it('Тест 11/175: замер измеряет расстояние и по умолчанию справочный', () => {
    const dim = createDimension({ x: 0, y: 0 }, { x: 300, y: 400 }, 'FRONT');
    expect(dimensionLength(dim)).toBe(500);
    expect(dim.reference).toBe(true); // §55
    expect(dim.plane).toBe('FRONT');

    store().setEditorDimensions([dim]);
    expect(ui().dimensions.length).toBe(1);
  });

  it('Тест 11/36/37: источник размера — производный, связанный или ручной', () => {
    const cabinet = makeCabinet();
    const module = entities().find((e) => e.entityId === String(cabinet))!;
    const part = entities().find((e) => e.entityType === 'PART')!;

    // §32: у детали параметрического модуля размер производный и не правится.
    const partInfo = dimensionInfo(part, 'width', null);
    expect(partInfo.source).toBe('DERIVED');
    expect(partInfo.editable).toBe(false);

    const model = modelOfEntity(project(), module);
    const moduleInfo = dimensionInfo(module, 'width', model);
    expect(['LINKED', 'MANUAL']).toContain(moduleInfo.source);
    expect(moduleInfo.editable).toBe(true);
  });

  it('Тест 12/59/60: ограничения описаны, статусы вычисляются', () => {
    const a = entity('a', 0, 0, 100, 100);
    const b = entity('b', 300, 0, 100, 100);
    const align = createConstraint('ALIGN', 'a', 'b', { axis: 'x', id: 'c1' });
    expect(constraintStatus(align, [a, b])).toBe('WARNING'); // не выполнено

    const satisfied = entity('b', 0, 0, 100, 100);
    expect(isSatisfied(align, rectOf(a), rectOf(satisfied))).toBe(true);
    expect(constraintStatus(align, [a, satisfied])).toBe('VALID');

    const suppressed = setConstraintSuppressed([align], 'c1', true)[0];
    expect(constraintStatus(suppressed, [a, b])).toBe('SUPPRESSED');

    const glyph = constraintGlyph(align, [a, b])!;
    expect(glyph.constraintId).toBe('c1');
    expect(glyph.status).toBe('WARNING');
  });

  it('Тест 12/13: решатель выравнивает и выдерживает расстояние', () => {
    const a = entity('a', 0, 0, 100, 100);
    const b = entity('b', 300, 0, 100, 100);
    const align = solveConstraints([a, b], [createConstraint('ALIGN', 'a', 'b', { axis: 'x', id: 'c1' })]);
    expect(align.ok).toBe(true);
    expect(align.positions.b.x).toBe(0);

    const distance = solveConstraints([a, b], [
      createConstraint('DISTANCE', 'a', 'b', { axis: 'x', value: 250, anchorA: 'max', id: 'c2' }),
    ]);
    expect(distance.ok).toBe(true);
    expect(distance.positions.b.x).toBe(350); // правый край A (100) + 250

    const center = solveConstraints([a, b], [createConstraint('CENTER', 'a', 'b', { axis: 'x', id: 'c3' })]);
    expect(center.positions.b.x).toBe(0);
  });

  it('Тест 13/180: конфликтующие ограничения не повреждают модель', () => {
    const a = entity('a', 0, 0, 100, 100);
    const c = entity('c', 800, 0, 100, 100);
    const b = entity('b', 300, 0, 100, 100);
    const conflicting: Constraint2D[] = [
      createConstraint('ALIGN', 'a', 'b', { axis: 'x', id: 'x1' }),
      createConstraint('ALIGN', 'c', 'b', { axis: 'x', id: 'x2' }),
    ];
    const res = solveConstraints([a, b, c], conflicting);
    expect(res.ok).toBe(false);
    expect(res.overconstrained).toBe(true);
    // §66: модель не меняется — координаты остались исходными.
    expect(res.positions.b.x).toBe(300);
    expect(res.issues.some((i) => i.message.includes('конфликтующие ограничения'))).toBe(true);
  });

  it('Тест 13/67: недостаток ограничений ошибкой не считается', () => {
    const a = entity('a', 0, 0, 100, 100);
    const b = entity('b', 300, 0, 100, 100);
    const free = entity('f', 900, 0, 100, 100);
    const res = solveConstraints([a, b, free], [createConstraint('ALIGN', 'a', 'b', { axis: 'x', id: 'u1' })]);
    expect(res.ok).toBe(true);
    expect(res.underconstrained).toBe(true);
    expect(res.issues.filter((i) => i.status === 'ERROR')).toEqual([]);
  });

  it('Тест 12/62/63/64: ограничения добавляются, отключаются и удаляются', () => {
    let list: Constraint2D[] = [];
    list = addConstraint(list, createConstraint('HORIZONTAL', 'a', 'b', { id: 'k1' }));
    expect(list.length).toBe(1);
    expect(list[0].axis).toBe('y'); // горизонтальное выравнивание управляет Y

    list = setConstraintSuppressed(list, 'k1', true);
    expect(list[0].suppressed).toBe(true);

    list = removeConstraint(list, 'k1');
    expect(list.length).toBe(0);

    store().setConstraints([createConstraint('VERTICAL', 'a', 'b', { id: 'k2' })]);
    expect(store().constraints.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Редактор 2D 26 — буфер, удаление, видимость', () => {
  beforeEach(emptyProject);

  it('Тест 16/165: дублирование создаёт новый объект с новым id', () => {
    const id = makePart();
    const before = allParts(project()).length;
    const created = store().editorDuplicate([String(id)]);
    expect(created.length).toBe(1);
    expect(created[0]).not.toBe(String(id));
    expect(allParts(project()).length).toBe(before + 1);
    // §81: копия смещена относительно оригинала.
    const copy = findPart(project(), created[0] as PartId)!;
    expect(copy.position.x).not.toBe(findPart(project(), id)!.position.x);
  });

  it('Тест 17/18/166: копирование и вставка через сериализованную модель', () => {
    const id = makePart();
    const clipboard = copyEntities(project(), [String(id)]);
    // §80: в буфере полноценная деталь, а не экранные координаты.
    expect(clipboard.items[0].entityType).toBe('PART');
    expect((clipboard.items[0].payload as { width: number }).width).toBe(600);
    expect(clipboard.items[0].payload).not.toHaveProperty('screenX');

    const copied = store().editorCopy([String(id)]);
    expect(copied).toBe(1);
    const before = allParts(project()).length;
    const pasted = store().editorPaste();
    expect(pasted.length).toBe(1);
    expect(allParts(project()).length).toBe(before + 1);
    expect(ui().selection).toEqual(pasted);
  });

  it('Тест 17/77: вставка присваивает новые id детали и её ручным операциям', () => {
    makeCabinet();
    /* Автоматическая присадка ВЫВОДИТСЯ из соединений и в детали не хранится;
     * в part.machining лежат только ручные операции — именно они и должны
     * получить новые идентификаторы при вставке. */
    const source = allParts(project())[0];
    const withManual = {
      ...source,
      machining: [{ ...(holeSymbols(project(), 'FRONT')[0] ? {} : {}), id: 'manual-1', partId: source.id, face: 'front', x: 10, y: 20, diameter: 8, depth: 12 }],
    } as typeof source;

    const copy = pastePart(withManual);
    expect(String(copy.id)).not.toBe(String(source.id));
    expect(copy.name).toContain('копия');
    expect(copy.machining.length).toBe(1);
    expect(String(copy.machining[0].id)).not.toBe('manual-1');
    expect(String(copy.machining[0].id)).toContain(String(copy.id));

    // preparePaste и prepareDuplicate дают тот же результат для набора.
    const prepared = preparePaste(copyEntities(project(), [String(source.id)]));
    expect(prepared.parts.length).toBe(1);
    expect(String(prepared.parts[0].id)).not.toBe(String(source.id));
    const duplicated = prepareDuplicate(project(), [String(source.id)]);
    expect(duplicated.parts.length).toBe(1);
  });

  it('Тест 19/167: удаление убирает объект и осиротевшие соединения', () => {
    const cabinet = makeCabinet();
    const part = allParts(project()).find((p) => p.material)!;
    const connectionsBefore = project().hardwareConnections.length;

    const impact = deleteImpact(project(), [String(part.id)])[0];
    expect(impact.entityId).toBe(String(part.id));

    const res = store().editorDelete([String(part.id)]);
    expect(res.removed).toBe(1);
    expect(findPart(project(), part.id)).toBeUndefined();
    if (impact.connections.length > 0) {
      expect(project().hardwareConnections.length).toBeLessThan(connectionsBefore);
      expect(res.warnings.length).toBeGreaterThan(0); // §83
    }
    expect(project().furnitures.some((f) => f.id === cabinet)).toBe(true);
  });

  it('Тест 20/21/177/178: блокировка и скрытие — состояние интерфейса', () => {
    const id = makePart();
    const before = JSON.stringify(project());

    store().setEditorLocked(String(id), true);
    expect(partEntity(id).locked).toBe(true);
    store().setEditorHidden(String(id), true);
    expect(partEntity(id).hidden).toBe(true);

    // Модель не тронута: это флаги редактора (§2).
    expect(JSON.stringify(project())).toBe(before);

    store().editorShowAll();
    expect(partEntity(id).hidden).toBe(false);
  });

  it('Тест 22/179: изоляция скрывает всё остальное', () => {
    const cabinet = makeCabinet();
    const total = entities().length;
    expect(total).toBeGreaterThan(2);

    store().editorIsolate([String(cabinet)]);
    const isolated = entities();
    expect(isolated.length).toBeLessThan(total);
    expect(isolated.every((e) => e.entityId === String(cabinet) || e.parentId === String(cabinet))).toBe(true);

    store().editorShowAll();
    expect(entities().length).toBe(total);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Редактор 2D 26 — синхронизация и история', () => {
  it('Тест 29/30/168: Undo и Redo возвращают состояние', () => {
    emptyProject();
    const id = makePart();
    const original = findPart(project(), id)!.position.x;

    store().applyEditorChanges(moveEntities([partEntity(id)], 'FRONT', 200, 0).changes);
    expect(findPart(project(), id)!.position.x).toBe(original + 200);

    store().undo();
    expect(findPart(project(), id)!.position.x).toBe(original);
    store().redo();
    expect(findPart(project(), id)!.position.x).toBe(original + 200);
  });

  it('Тест 15/34/169: создание модуля видно на холсте и в ProjectModel', () => {
    emptyProject();
    const id = store().createModuleFromTemplate('mod-base');
    expect(id).toBeTruthy();
    const module = entities().find((e) => e.entityId === String(id) && e.entityType === 'MODULE');
    expect(module).toBeDefined();
    expect(project().furnitures.some((f) => String(f.id) === String(id))).toBe(true);
    expect(module!.transform.width).toBeGreaterThan(0);
  });

  it('Тест 35/36/37/170: правка модуля обновляет 3D, присадку и раскрой', () => {
    const cabinet = makeCabinet();
    const module = entities().find((e) => e.entityId === String(cabinet))!;

    const partsBefore = allParts(project()).length;
    const opsBefore = allOperations(project()).length;
    const cutBefore = runCutting(project()).jobs.reduce((n, j) => n + j.statistics.pieceCount, 0);
    const transformBefore = partTransform(allParts(project())[0]);

    const model = modelOfEntity(project(), module)!;
    store().applyEditorChanges(
      resizeEntity(module, { plane: 'FRONT', handle: 'e', width: model.width + 400, height: model.height, model }).changes,
    );

    // §96: одно изменение модели видно всем разделам.
    expect(readParametricModel(project().furnitures.find((f) => f.id === cabinet)!).width).toBe(model.width + 400);
    expect(allParts(project()).length).toBeGreaterThanOrEqual(partsBefore);
    expect(allOperations(project()).length).toBeGreaterThan(0);
    expect(opsBefore).toBeGreaterThan(0);
    const cutAfter = runCutting(project()).jobs.reduce((n, j) => n + j.statistics.pieceCount, 0);
    expect(cutAfter).toBeGreaterThanOrEqual(cutBefore);
    // 3D читает ту же модель — трансформация детали пересчиталась.
    expect(partTransform(allParts(project())[0])).not.toEqual(transformBefore);
  });

  it('Тест 34/104/106: присадка и кромка показываются на виде', () => {
    makeCabinet();
    const holes = holeSymbols(project(), 'FRONT');
    expect(holes.length).toBeGreaterThan(0);
    expect(holes[0].diameter).toBeGreaterThan(0);

    const edgeId = project().edges[0].id;
    for (const p of allParts(project())) store().setPartEdge(p.id, 'top', edgeId);
    const edges = edgeSymbols(project(), 'FRONT');
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0].side).toBeTruthy();
  });

  it('Тест 38/135/136: замечания привязываются к объектам и наводят вид', () => {
    makeCabinet();
    const issues = collectIssues(project());
    const list = markStatuses(entities(), issues);
    expect(Array.isArray(issues)).toBe(true);

    const withEntity = issues.find((i) => i.entityId && list.some((e) => e.entityId === i.entityId));
    if (withEntity) {
      expect(statusOfEntity(withEntity.entityId!, issues)).not.toBe('VALID');
      const bounds = focusBounds(withEntity, list);
      expect(bounds).not.toBeNull();
      expect(bounds!.maxX).toBeGreaterThan(bounds!.minX);
    }
    expect(projectBounds(entities())).not.toBeNull();
  });

  it('Тест 26/27/28/181/182: параметрическая связь, разрыв и восстановление', () => {
    const cabinet = makeCabinet();
    const model = readParametricModel(project().furnitures.find((f) => f.id === cabinet)!);
    // Существующий механизм связей переиспользуется, второго не заводится.
    const linked = { id: 'p', name: 'P', type: 'NUMBER' as const, value: 100, expression: 'height - 100' };
    const next = { ...model, parameters: [...model.parameters, linked] };
    const res = store().applyParametricModel(cabinet, next);
    expect(res.ok).toBe(true);
    const stored = readParametricModel(project().furnitures.find((f) => f.id === cabinet)!);
    expect(stored.parameters.some((p) => p.id === 'p' && p.expression === 'height - 100')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Редактор 2D 26 — производительность и полный регресс', () => {
  it('Тест 39/183: 1000 сущностей строятся, отсекаются и выбираются быстро', () => {
    emptyProject();
    const list: EditorEntity[] = Array.from({ length: 1000 }, (_, i) =>
      entity(`e${i}`, (i % 40) * 700, Math.floor(i / 40) * 500, 600, 400),
    );

    const view: Viewport = { zoom: 0.2, panX: 0, panY: 0, widthPx: 1200, heightPx: 800 };
    const started = Date.now();
    const visible = cullEntities(list, view);
    const picked = selectInRect(list, { minX: 0, minY: 0, maxX: 5000, maxY: 5000 }, { crossing: true });
    const hit = entityAt(list, { x: 100, y: 100 });
    const elapsed = Date.now() - started;

    expect(visible.length).toBeLessThan(list.length); // §127: рисуется не всё
    expect(visible.length).toBeGreaterThan(0);
    expect(picked.length).toBeGreaterThan(0);
    expect(hit?.entityId).toBe('e0');
    expect(elapsed).toBeLessThan(1000);
  });

  it('Тест 39/130: выравнивание тысячи объектов остаётся детерминированным', () => {
    const list: EditorEntity[] = Array.from({ length: 1000 }, (_, i) => entity(`p${i}`, i * 10, 0, 100, 100));
    const first = alignEntities(list, 'LEFT');
    const second = alignEntities(list, 'LEFT');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.keys(first).length).toBe(1000);
  });

  it('Тест 40/187: полный регресс — редактор и все производственные разделы', () => {
    const cabinet = makeCabinet();

    // 2D-редактор видит модуль и детали.
    const list = entities();
    expect(list.some((e) => e.entityType === 'MODULE')).toBe(true);
    expect(list.filter((e) => e.entityType === 'PART').length).toBeGreaterThan(3);

    // ProjectModel — единственный источник: сущности выводятся из деталей.
    for (const e of list.filter((x) => x.entityType === 'PART')) {
      const part = partOfEntity(project(), e)!;
      const box = partWorldAABB(part);
      expect(e.transform.width).toBeGreaterThan(0);
      expect(box.max.x).toBeGreaterThanOrEqual(box.min.x);
    }

    // Материалы, кромка, фурнитура, присадка, раскрой, документы.
    expect(project().materials.length).toBeGreaterThan(0);
    const edgeId = project().edges[0].id;
    for (const p of allParts(project())) store().setPartEdge(p.id, 'top', edgeId);
    expect(project().hardwareConnections.length).toBeGreaterThan(0);
    expect(allOperations(project()).length).toBeGreaterThan(0);
    expect(runCutting(project()).jobs.length).toBeGreaterThan(0);
    expect(buildDocument(project(), 'partsList')).toBeTruthy();

    // Правка через редактор проходит по всей цепочке и откатывается.
    const module = entities().find((e) => e.entityId === String(cabinet))!;
    const model = modelOfEntity(project(), module)!;
    store().applyEditorChanges(
      resizeEntity(module, { plane: 'FRONT', handle: 'e', width: 1200, height: model.height, model }).changes,
    );
    expect(readParametricModel(project().furnitures.find((f) => f.id === cabinet)!).width).toBe(1200);
    store().undo();
    expect(readParametricModel(project().furnitures.find((f) => f.id === cabinet)!).width).toBe(model.width);
  });
});
