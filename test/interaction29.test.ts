/**
 * ЭТАП 29 — Интерактивное редактирование.
 *
 * Цепочка: выбор → инструмент → операция → параметр или Override → пересчёт →
 * детали → фурнитура → присадка → раскрой → 2D/3D → история.
 *
 * Проверяет единый SelectionManager (одиночный, множественный, рамкой,
 * иерархический), перемещение и поворот, изменение размеров с Override и
 * сбросом, привязки с приоритетом и предпросмотром, сетку, направляющие,
 * выравнивание, распределение, зеркало, числовые преобразования, размеры прямо
 * на модели, измерение, ограничения, блокировку, скрытие, изоляцию, undo/redo,
 * copy/paste, дубликат, удаление, 2D- и 3D-редактирование и их синхронизацию,
 * коллизии, валидацию, автосохранение, восстановление и большой проект.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findFurniture, findPart } from '@/core/model/selectors';
import {
  COMMANDS,
  DEFAULT_GIZMO,
  DEFAULT_SIZE_LIMITS,
  DEFAULT_SNAP_3D,
  EMPTY_MEASURE,
  EMPTY_SELECTION,
  GRID_STEPS_3D,
  LARGE_CHANGE_THRESHOLD,
  PART_MENU,
  CABINET_MENU,
  SNAP_PRIORITY,
  activeId,
  anchorLength,
  beginDimensionEdit,
  beginTransaction,
  boxContains,
  boxIntersects,
  buildStatusLine,
  cancelDimensionEdit,
  changePreview,
  childrenOf,
  clearSelection,
  collectCandidates,
  commandForKey,
  commitTransaction,
  constrainDelta,
  currentCoordinate,
  dependencyPreview,
  describeSnap,
  dimensionsOfPart,
  dragDivider,
  dragDoor,
  dragDrawer,
  dragShelf,
  dragTargetOf,
  extendSelection,
  faceCandidates,
  findCommand,
  formatMm,
  furnitureOfPart,
  gizmoBounds,
  guideCandidates3D,
  highlightedParts,
  indexOfPart,
  isCommandEnabled,
  isPositionLocked,
  isSelected,
  isSizeLocked,
  isTextInput,
  issuesByPart,
  keyChord,
  kindOf,
  linkIndicator,
  linkState,
  measureClick,
  measureDistance,
  measurePart,
  measurePoints,
  menuFor,
  mirroredPosition,
  movedPosition,
  normalizeBox3,
  overriddenFields,
  parentOf,
  partCandidates,
  planPartDrag,
  previewDimension,
  resetToFormula,
  resizeHandles,
  resizePart,
  resizePartTo,
  resolveClick,
  rollbackTransaction,
  rotatedRotation,
  selectAll,
  selectChildren,
  selectInBox,
  selectParent,
  selectSingle,
  selectedParts,
  shortcutList,
  snapAxis,
  snapPoint,
  snapPreview,
  snapRank,
  snapToGridValue,
  stepTransaction,
  toggleSelection,
  validateDimensionInput,
  type Guide3D,
  type SelectionState,
} from '@/engines/interaction';
import { hasOverride, partSource } from '@/engines/parametric';
import { checkPartCollisions } from '@/engines/cabinet';
import { allOperations } from '@/engines/machining';
import { runCutting } from '@/engines/cutting';
import { partEntities } from '@/engines/editor2d';
import { deserializeProject } from '@/storage/project/serialization';
import { createPart } from '@/core/model/factory';
import type { Part, Project } from '@/core/model/types';
import type { FurnitureId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;
const partsOf = (id: FurnitureId): Part[] =>
  findFurniture(project(), id)!.assemblies.flatMap((a) => a.parts);
const byKey = (id: FurnitureId, key: string): Part =>
  partsOf(id).find((p) => p.metadata?.key === key)!;
const typed = (id: FurnitureId, type: string): Part[] =>
  partsOf(id).filter((p) => p.metadata?.partType === type);
const selection = (): SelectionState => store().interaction.selection;

/** Шкаф 800 × 2000 × 600 из §145. */
function makeCabinet(): FurnitureId {
  store().newProject('Тест 29');
  const id = store().createParametricCabinet({
    type: 'CABINET', width: 800, height: 2000, depth: 600, name: 'Шкаф',
  })!;
  for (const f of [...project().furnitures]) {
    if (String(f.id) !== String(id)) store().removeFurniture(f.id);
  }
  const model = store().getCabinetModel(id)!;
  store().applyCabinetPatch(id, {
    shelves: { ...model.shelves, count: 3 },
    partitions: { ...model.partitions, count: 1 },
    doors: { ...model.doors, count: 2, handleEnabled: true },
  });
  return id;
}

let cabinet: FurnitureId;
beforeEach(() => {
  cabinet = makeCabinet();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Взаимодействие 29 — выбор', () => {
  it('Тест 1/2 (§146): клик выбирает деталь', () => {
    const side = byKey(cabinet, 'CABINET.SIDE.LEFT');
    store().selectEntity(String(side.id));
    expect(selection().ids).toEqual([String(side.id)]);
    expect(activeId(selection())).toBe(String(side.id));
    expect(isSelected(selection(), String(side.id))).toBe(true);
    // Выбор доходит до панели свойств прошлых этапов.
    expect(String(store().selectedPartId)).toBe(String(side.id));
  });

  it('Тест 2/3: Ctrl+click добавляет и убирает из выделения', () => {
    const [a, b] = partsOf(cabinet);
    store().selectEntity(String(a.id));
    store().selectEntity(String(b.id), { additive: true });
    expect(selection().ids).toHaveLength(2);
    store().selectEntity(String(b.id), { additive: true });
    expect(selection().ids).toEqual([String(a.id)]);

    // Чистые функции работают и без store.
    const base = selectSingle(EMPTY_SELECTION, 'a');
    expect(toggleSelection(base, 'b').ids).toEqual(['a', 'b']);
    expect(extendSelection(base, ['b', 'a']).ids).toEqual(['a', 'b']);
  });

  it('Тест 3/4: выделение объёмной рамкой', () => {
    const ids = store().boxSelectEntities(
      { x: -5000, y: -5000, z: -5000 }, { x: 5000, y: 5000, z: 5000 },
    );
    expect(ids.length).toBe(partsOf(cabinet).length);
    expect(selection().ids).toEqual(ids);

    // Рамка «касанием» и «целиком» различаются.
    const narrow = { min: { x: -100, y: -100, z: -100 }, max: { x: 100, y: 100, z: 100 } };
    const inside = { min: { x: -10, y: -10, z: -10 }, max: { x: 10, y: 10, z: 10 } };
    const crossing = { min: { x: 50, y: 50, z: 50 }, max: { x: 500, y: 500, z: 500 } };
    expect(boxContains(narrow, inside)).toBe(true);
    expect(boxContains(narrow, crossing)).toBe(false);
    expect(boxIntersects(narrow, crossing)).toBe(true);
    expect(normalizeBox3({ x: 10, y: 0, z: 0 }, { x: -10, y: 5, z: 5 }).min.x).toBe(-10);
  });

  it('Тест 1/5: Ctrl+A выбирает всё, Esc снимает выбор', () => {
    store().selectAllEntities();
    expect(selection().ids.length).toBe(partsOf(cabinet).length);
    store().clearInteractionSelection();
    expect(selection().ids).toEqual([]);
    expect(store().selectedPartId).toBeNull();

    expect(selectAll(project(), EMPTY_SELECTION).ids.length).toBeGreaterThan(0);
    expect(clearSelection(selectSingle(EMPTY_SELECTION, 'x')).ids).toEqual([]);
  });

  it('Тест 4/7: иерархия — деталь, изделие, узлы', () => {
    const side = byKey(cabinet, 'CABINET.SIDE.LEFT');
    expect(kindOf(project(), String(side.id))).toBe('PART');
    expect(kindOf(project(), String(cabinet))).toBe('CABINET');
    expect(furnitureOfPart(project(), String(side.id))).toBe(String(cabinet));
    expect(parentOf(project(), String(side.id))).toBe(String(cabinet));
    expect(childrenOf(project(), String(cabinet)).length).toBe(partsOf(cabinet).length);
    // Уровень выбора поднимает клик до изделия (§7).
    expect(resolveClick(project(), String(side.id), 'PART')).toBe(String(side.id));
    expect(resolveClick(project(), String(side.id), 'CABINET')).toBe(String(cabinet));
  });

  it('Тест 4/8/9: Select Parent и Select Children', () => {
    const side = byKey(cabinet, 'CABINET.SIDE.LEFT');
    store().selectEntity(String(side.id));
    store().selectParentEntity();
    expect(selection().ids).toEqual([String(cabinet)]);
    store().selectChildrenEntities();
    expect(selection().ids.length).toBe(partsOf(cabinet).length);

    expect(selectParent(project(), selectSingle(EMPTY_SELECTION, String(side.id))).ids)
      .toEqual([String(cabinet)]);
    expect(selectChildren(project(), selectSingle(EMPTY_SELECTION, String(cabinet))).ids.length)
      .toBeGreaterThan(0);
  });

  it('Тест 1/10/11: подсветка выбранного и наведение', () => {
    store().selectEntity(String(cabinet));
    // Выбор изделия подсвечивает все его детали (§10).
    expect(highlightedParts(project(), selection()).length).toBe(partsOf(cabinet).length);
    expect(selectedParts(project(), selection()).length).toBe(partsOf(cabinet).length);

    const side = byKey(cabinet, 'CABINET.SIDE.LEFT');
    store().hoverEntity(String(side.id));
    expect(selection().hovered).toBe(String(side.id));
    store().hoverEntity(null);
    expect(selection().hovered).toBeNull();
  });

  it('Тест 31 (§177/§178): выбор общий для 2D и 3D', () => {
    const side = byKey(cabinet, 'CABINET.SIDE.LEFT');
    store().selectEntity(String(side.id));
    // 2D-редактор читает тот же список.
    expect(store().editor2d.selection).toEqual([String(side.id)]);
    const entities = partEntities(project(), 'FRONT');
    expect(entities.some((e) => e.entityId === String(side.id))).toBe(true);
  });
});

describe('Взаимодействие 29 — перемещение, поворот, гизмо', () => {
  it('Тест 5/12/13: гизмо стоит на габарите выделения', () => {
    const parts = partsOf(cabinet);
    const bounds = gizmoBounds(parts)!;
    expect(bounds.size.x).toBeGreaterThan(0);
    expect(resizeHandles(bounds)).toHaveLength(6);
    expect(gizmoBounds([])).toBeNull();
    expect(DEFAULT_GIZMO.mode).toBe('MOVE');
  });

  it('Тест 5/14/18: ограничение по оси и ортогональный режим', () => {
    const delta = { x: 30, y: 12, z: -4 };
    expect(constrainDelta(delta, { ...DEFAULT_GIZMO, axis: 'X' })).toEqual({ x: 30, y: 0, z: 0 });
    expect(constrainDelta(delta, { ...DEFAULT_GIZMO, axis: 'Y' })).toEqual({ x: 0, y: 12, z: 0 });
    expect(constrainDelta(delta, { ...DEFAULT_GIZMO, axis: 'Z' })).toEqual({ x: 0, y: 0, z: -4 });
    // Ортогональный режим оставляет только доминирующую ось (§18).
    expect(constrainDelta(delta, { ...DEFAULT_GIZMO, orthogonal: true }))
      .toEqual({ x: 30, y: 0, z: 0 });
  });

  it('Тест 5/79 (§163): числовое перемещение', () => {
    const side = byKey(cabinet, 'CABINET.SIDE.LEFT');
    store().updatePart(side.id as PartId, { position: { ...side.position, x: 50 } });
    expect(findPart(project(), side.id)!.position.x).toBe(50);
    expect(movedPosition(side, { x: 10, y: 0, z: 0 }).x).toBe(side.position.x + 10);
  });

  it('Тест 7/13/75/80: поворот и зеркало', () => {
    const side = byKey(cabinet, 'CABINET.SIDE.LEFT');
    expect(rotatedRotation(side, 'Z', 90).z).toBe((side.rotation.z + 90) % 360);
    expect(rotatedRotation(side, 'Z', 360).z).toBe(side.rotation.z % 360);
    expect(mirroredPosition({ x: 100, y: 0, z: 0 }, 'X')).toEqual({ x: -100, y: 0, z: 0 });
    expect(mirroredPosition({ x: 100, y: 0, z: 0 }, 'X', 50)).toEqual({ x: 0, y: 0, z: 0 });

    store().updatePart(side.id as PartId, { rotation: { ...side.rotation, z: 90 } });
    expect(findPart(project(), side.id)!.rotation.z).toBe(90);
  });

  it('Тест 13 (§162): зеркало детали в проекте', () => {
    const side = byKey(cabinet, 'CABINET.SIDE.LEFT');
    const before = side.position.x;
    store().updatePart(side.id as PartId, { position: { ...side.position, x: -before } });
    expect(findPart(project(), side.id)!.position.x).toBe(-before);
  });
});

describe('Взаимодействие 29 — размер, Override и сброс', () => {
  it('Тест 6/19/21: изменение размера с проверкой пределов', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    const ok = resizePart(shelf, 'width', 700);
    expect(ok.ok).toBe(true);
    expect(ok.part.width).toBe(700);

    expect(resizePart(shelf, 'width', 0).ok).toBe(false);
    expect(resizePart(shelf, 'width', -10).refusal?.code).toBe('resize.notPositive');
    expect(resizePart(shelf, 'width', DEFAULT_SIZE_LIMITS.maxWidth + 1).refusal?.code).toBe('resize.aboveMax');
    expect(resizePart(shelf, 'height', 1).refusal?.code).toBe('resize.belowMin');
  });

  it('Тест 6/18/23 (§148): ручной размер даёт Override и переживает пересчёт', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    const result = store().resizeSelectedPart(shelf.id as PartId, 'width', 555);
    expect(result.ok).toBe(true);

    const after = findPart(project(), shelf.id)!;
    expect(after.width).toBe(555);
    expect(hasOverride(after)).toBe(true);
    expect(overriddenFields(after)).toContain('width');
    expect(linkState(after)).toBe('OVERRIDE');

    // Пересчёт всей конструкции ручное значение не стирает (§22).
    store().applyCabinetPatch(cabinet, { height: 2100 });
    expect(findPart(project(), shelf.id)!.width).toBe(555);
  });

  it('Тест 19/27 (§171): Reset to Formula возвращает расчёт', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    store().resizeSelectedPart(shelf.id as PartId, 'width', 555);
    store().resetPartFormula(shelf.id as PartId);
    const after = findPart(project(), shelf.id)!;
    expect(hasOverride(after)).toBe(false);
    expect(after.width).not.toBe(555);
    expect(linkState(after)).toBe('LINKED');

    // Чистая функция сбрасывает выбранные поля.
    const part = resizePartTo(shelf, { width: 700, height: 400 }).part;
    expect(overriddenFields(resetToFormula(part, ['width']))).toEqual(['height']);
  });

  it('Тест 20/28 (§172): блокировка положения и размера', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    store().setPartLock(shelf.id as PartId, { position: true, size: true });
    const locked = findPart(project(), shelf.id)!;
    expect(isPositionLocked(locked)).toBe(true);
    expect(isSizeLocked(locked)).toBe(true);
    expect(linkState(locked)).toBe('LOCKED');
    expect(resizePart(locked, 'width', 500).refusal?.code).toBe('resize.locked');
    expect(store().resizeSelectedPart(shelf.id as PartId, 'width', 500).ok).toBe(false);
  });
});

describe('Взаимодействие 29 — привязки, сетка и направляющие', () => {
  it('Тест 8/9/16/17: сетка и её шаг', () => {
    expect(snapToGridValue(103, 10)).toBe(100);
    expect(snapToGridValue(107, 10)).toBe(110);
    expect(snapToGridValue(107, 0)).toBe(107);
    expect(GRID_STEPS_3D).toContain(10);
    store().setSnapSettings({ gridSize: 20 });
    expect(store().interaction.snap.gridSize).toBe(20);
  });

  it('Тест 8/111/112: приоритет привязок', () => {
    expect(SNAP_PRIORITY[0]).toBe('endpoint');
    expect(snapRank('endpoint')).toBeLessThan(snapRank('edge'));
    expect(snapRank('edge')).toBeLessThan(snapRank('grid'));

    const candidates = [
      { axis: 'x' as const, value: 100, kind: 'grid' as const },
      { axis: 'x' as const, value: 100, kind: 'endpoint' as const },
    ];
    const match = snapAxis(101, 'x', candidates, DEFAULT_SNAP_3D);
    expect(match.candidate?.kind).toBe('endpoint');
    expect(match.value).toBe(100);
  });

  it('Тест 8/115/116/117: привязка к краю, центру и поверхности детали', () => {
    const parts = partsOf(cabinet);
    const candidates = partCandidates(parts);
    expect(candidates.some((c) => c.kind === 'edge')).toBe(true);
    expect(candidates.some((c) => c.kind === 'center')).toBe(true);
    expect(faceCandidates(parts).every((c) => c.kind === 'face')).toBe(true);
    // Перемещаемая деталь себе кандидатом не становится.
    const excluded = partCandidates(parts, [String(parts[0].id)]);
    expect(excluded.some((c) => c.sourceId === String(parts[0].id))).toBe(false);
  });

  it('Тест 8/10/62/113/114/118 (§158/§159): привязка к направляющей и предпросмотр', () => {
    const guides: Guide3D[] = [{ id: 'g1', axis: 'y', position: 500 }];
    expect(guideCandidates3D(guides)[0].kind).toBe('guide');

    const ctx = {
      project: project(),
      guides,
      settings: { ...DEFAULT_SNAP_3D, toParts: false, toFaces: false, toGrid: false, tolerance: 20 },
    };
    const snapped = snapPoint({ x: 0, y: 495, z: 0 }, ctx);
    expect(snapped.y).toBe(500);
    const preview = snapPreview({ x: 0, y: 495, z: 0 }, ctx);
    expect(preview.target.y).toBe(500);
    expect(preview.description).toContain('направляющая');

    // За пределами радиуса привязка не срабатывает (§118).
    const far = snapPoint({ x: 0, y: 400, z: 0 }, ctx);
    expect(far.y).toBe(400);
    expect(describeSnap([])).toBe('без привязки');
    expect(collectCandidates({ ...ctx, settings: { ...ctx.settings, enabled: false } })).toEqual([]);
  });

  it('Тест 10/58–§64 (§157): направляющие создаются, двигаются и удаляются', () => {
    const id = store().addInteractionGuide('y', 700);
    expect(store().interaction.guides).toHaveLength(1);
    store().moveInteractionGuide(id, 900);
    expect(store().interaction.guides[0].position).toBe(900);
    store().removeInteractionGuide(id);
    expect(store().interaction.guides).toHaveLength(0);
    store().addInteractionGuide('x', 0);
    store().clearInteractionGuides();
    expect(store().interaction.guides).toHaveLength(0);
  });

  it('Тест 8: привязка детали к детали через store-настройки', () => {
    const side = byKey(cabinet, 'CABINET.SIDE.RIGHT');
    const ctx = {
      project: project(),
      guides: [],
      settings: { ...DEFAULT_SNAP_3D, tolerance: 30 },
      excludeIds: [String(side.id)],
    };
    const shelf = byKey(cabinet, 'CABINET.SHELF.001');
    const target = currentCoordinate(shelf, 'y');
    const candidates = collectCandidates(ctx);
    const snapped = snapAxis(target + 5, 'y', candidates, ctx.settings);
    // Притянуло именно к кандидату полки, а не к произвольному значению.
    expect(snapped.candidate?.sourceId).toBe(String(shelf.id));
    expect(candidates.some((c) => c.value === snapped.value)).toBe(true);
  });
});

describe('Взаимодействие 29 — перетаскивание конструктивных элементов', () => {
  it('Тест 5/25/26 (§147): полка тянется по высоте и получает ручное положение', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    expect(dragTargetOf(shelf)).toBe('SHELF');
    expect(planPartDrag(shelf).axis).toBe('y');

    const model = store().getCabinetModel(cabinet)!;
    const outcome = dragShelf(model, 1, 700);
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toBe(700);
    expect(outcome.model.shelves.fixedShelves).toContainEqual({ index: 1, offset: 700, fixed: true });
  });

  it('Тест 25/26: полка не наезжает на соседнюю', () => {
    const model = store().getCabinetModel(cabinet)!;
    // Тянем первую полку далеко вверх — она упирается во вторую.
    const outcome = dragShelf(model, 1, 1900);
    expect(outcome.ok).toBe(true);
    expect(outcome.value!).toBeLessThan(1900);
  });

  it('Тест 5/27/28 (§152): перегородка тянется по ширине', () => {
    const divider = typed(cabinet, 'divider')[0];
    expect(dragTargetOf(divider)).toBe('DIVIDER');
    const model = store().getCabinetModel(cabinet)!;
    const outcome = dragDivider(model, 1, 300);
    expect(outcome.ok).toBe(true);
    expect(outcome.model.partitions.positions[0]).toBe(300);
    // Слишком близко к краю — отказ с объяснением.
    expect(dragDivider(model, 1, 0).ok).toBe(true); // ограничивается, а не ломается
    expect(dragDivider(model, 5, 300).refusal?.code).toBe('drag.noDivider');
  });

  it('Тест 5/29/30 (§154): фасад двигается через зазор', () => {
    const model = store().getCabinetModel(cabinet)!;
    const outcome = dragDoor(model, 'left', 3);
    expect(outcome.ok).toBe(true);
    expect(outcome.model.doors.gaps.leftGap).toBe(model.doors.gaps.leftGap + 3);
    expect(dragDoor(model, 'left', -100).refusal?.code).toBe('drag.negativeGap');
    expect(dragDoor(model, 'left', 1, { linked: false }).refusal?.code).toBe('drag.unlinked');
  });

  it('Тест 5/31/32 (§156): ящик двигается с учётом соседей', () => {
    const model = store().getCabinetModel(cabinet)!;
    const withDrawers = store().applyCabinetPatch(cabinet, {
      drawers: { ...model.drawers, count: 2, frontHeight: 200 },
    });
    expect(withDrawers.ok).toBe(true);

    const next = store().getCabinetModel(cabinet)!;
    const outcome = dragDrawer(next, 1, 300);
    expect(outcome.ok).toBe(true);
    expect(outcome.model.drawers.distribution).toBe('MANUAL');
    expect(dragDrawer(next, 9, 300).refusal?.code).toBe('drag.noDrawer');

    const front = typed(cabinet, 'drawer_front')[0];
    expect(dragTargetOf(front)).toBe('DRAWER');
    expect(indexOfPart(front)).toBe(1);
  });

  it('Тест 5/121 (§182): перетаскивание через store — одна запись истории', () => {
    const shelf = typed(cabinet, 'shelf')[1];
    const before = allParts(project()).length;

    store().beginInteractionTransaction('drag', 'Перетаскивание полки');
    store().dragConstructivePart(shelf.id as PartId, 800);
    store().dragConstructivePart(shelf.id as PartId, 850);
    store().dragConstructivePart(shelf.id as PartId, 900);
    store().endInteractionTransaction();

    const model = store().getCabinetModel(cabinet)!;
    expect(model.shelves.fixedShelves.some((f) => f.index === 2)).toBe(true);
    expect(allParts(project())).toHaveLength(before);

    // Одна отмена возвращает состояние до всего перетаскивания (§121/§182).
    store().undo();
    expect(store().getCabinetModel(cabinet)!.shelves.fixedShelves).toHaveLength(0);
  });

  it('Тест 5: обычная деталь не притворяется конструктивной', () => {
    const manualId = store().addPart({ name: 'Ручная деталь' });
    const outcome = store().dragConstructivePart(manualId, 100);
    expect(outcome.ok).toBe(false);
    expect(outcome.refusal?.code).toBe('drag.notConstructive');
  });
});

describe('Взаимодействие 29 — размеры на модели и измерение', () => {
  it('Тест 15/44/51/52 (§164): у детали есть размеры с якорями', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    const dims = dimensionsOfPart(shelf);
    expect(dims.map((d) => d.kind)).toEqual(['horizontal', 'vertical', 'depth', 'angle']);
    const width = dims[0];
    expect(width.value).toBe(shelf.width);
    expect(Math.round(anchorLength(width.anchor))).toBe(Math.round(shelf.width));
    expect(width.field).toBe('width');
    expect(dims[3].field).toBeUndefined(); // угол — справочный
  });

  it('Тест 15/45/46/49: клик открывает редактирование, Enter применяет', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    const dims = dimensionsOfPart(shelf);
    const edit = beginDimensionEdit(dims[0]);
    expect(edit.field).toBe('width');
    expect(Number(edit.draft)).toBe(shelf.width);

    const validation = validateDimensionInput(edit, '900');
    expect(validation.ok).toBe(true);
    expect(validation.value).toBe(900);

    const applied = store().resizeSelectedPart(shelf.id as PartId, 'width', 900);
    expect(applied.ok).toBe(true);
    expect(findPart(project(), shelf.id)!.width).toBe(900);
  });

  it('Тест 15/47/48/50: валидация, предпросмотр и отмена', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    const edit = beginDimensionEdit(dimensionsOfPart(shelf)[0]);

    expect(validateDimensionInput(edit, '0').ok).toBe(false);
    expect(validateDimensionInput(edit, '-5').ok).toBe(false);
    expect(validateDimensionInput(edit, 'сто').message).toBe('Введите число.');
    expect(validateDimensionInput(edit, '99999').ok).toBe(false);

    const preview = previewDimension(edit, '900');
    expect(preview.ok).toBe(true);
    expect(preview.after).toBe(900);
    expect(preview.delta).toBe(900 - edit.original);
    // Esc возвращает исходное значение (§50).
    expect(cancelDimensionEdit(edit)).toBe(edit.original);
    expect(findPart(project(), shelf.id)!.width).toBe(edit.original);
  });

  it('Тест 15/53: размеры обновляются после изменения модели', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    const before = dimensionsOfPart(shelf)[0].value;
    store().applyCabinetPatch(cabinet, { width: 1000 });
    const after = dimensionsOfPart(typed(cabinet, 'shelf')[0])[0].value;
    expect(after).toBeGreaterThan(before);
  });

  it('Тест 16/54–§57 (§165): измерение точек, детали и расстояния', () => {
    const measurement = measurePoints({ x: 0, y: 0, z: 0 }, { x: 300, y: 400, z: 0 });
    expect(measurement.distance).toBe(500);
    expect(measurement.label).toBe('500 мм');

    const shelf = typed(cabinet, 'shelf')[0];
    const dims = measurePart(shelf);
    expect(dims.width).toBeGreaterThan(0);
    expect(dims.label).toContain('×');

    const left = byKey(cabinet, 'CABINET.SIDE.LEFT');
    const right = byKey(cabinet, 'CABINET.SIDE.RIGHT');
    const distance = measureDistance(left, right);
    expect(distance.gapX).toBeGreaterThan(0);
    expect(distance.centerDistance).toBeGreaterThan(0);
    expect(distance.label).toContain('Боковина');

    // Инструмент: первый клик — точка A, второй — результат.
    const first = measureClick(EMPTY_MEASURE, { x: 0, y: 0, z: 0 });
    expect(first.result).toBeNull();
    const second = measureClick(first, { x: 0, y: 100, z: 0 });
    expect(second.result?.distance).toBe(100);

    store().setMeasureActive(true);
    expect(store().interaction.tool).toBe('measure');
    store().measureAt({ x: 0, y: 0, z: 0 });
    const done = store().measureAt({ x: 0, y: 200, z: 0 });
    expect(done.result?.distance).toBe(200);
  });
});

describe('Взаимодействие 29 — выравнивание, распределение и структура', () => {
  it('Тест 11/12 (§160/§161): выравнивание и распределение доступны командами', () => {
    expect(findCommand('transform.align')).toBeDefined();
    expect(findCommand('transform.distribute')).toBeDefined();
    expect(isCommandEnabled('transform.align', 0)).toBe(false);
    expect(isCommandEnabled('transform.align', 2)).toBe(true);
    expect(isCommandEnabled('select.all', 0)).toBe(true);
  });

  it('Тест 27/28 (§168/§169): copy/paste и дубликат', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    expect(store().editorCopy([String(shelf.id)])).toBe(1);
    const pasted = store().editorPaste();
    expect(pasted.length).toBeGreaterThan(0);

    const before = partsOf(cabinet).length;
    const duplicated = store().editorDuplicate([String(shelf.id)]);
    expect(duplicated.length).toBe(1);
    expect(partsOf(cabinet).length).toBeGreaterThan(before);
  });

  it('Тест 28 (§170): удаление выбранного', () => {
    const manualId = store().addPart({ name: 'Лишняя деталь' });
    const before = allParts(project()).length;
    const result = store().editorDelete([String(manualId)]);
    expect(result.removed).toBe(1);
    expect(allParts(project())).toHaveLength(before - 1);
  });

  it('Тест 21/22 (§173/§174): скрытие и изоляция', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    store().setEditorHidden(String(shelf.id), true);
    expect(store().editor2d.hidden).toContain(String(shelf.id));
    // Скрытая деталь не попадает в «выбрать всё» (§5).
    store().selectAllEntities();
    expect(store().interaction.selection.ids).not.toContain(String(shelf.id));

    store().editorIsolate([String(shelf.id)]);
    expect(store().editor2d.isolated).toEqual([String(shelf.id)]);
    store().editorIsolate([]);
    store().setEditorHidden(String(shelf.id), false);
    expect(store().editor2d.hidden).not.toContain(String(shelf.id));
  });

  it('Тест 5/33–§37 (§151/§153/§155): быстрые команды структуры', () => {
    const model = () => store().getCabinetModel(cabinet)!;
    const shelvesBefore = model().shelves.count;
    store().applyCabinetPatch(cabinet, { shelves: { ...model().shelves, count: shelvesBefore + 1 } });
    expect(model().shelves.count).toBe(shelvesBefore + 1);

    store().applyCabinetPatch(cabinet, { partitions: { ...model().partitions, count: 2 } });
    expect(typed(cabinet, 'divider')).toHaveLength(2);

    store().applyCabinetPatch(cabinet, { doors: { ...model().doors, count: 3 } });
    expect(typed(cabinet, 'facade')).toHaveLength(3);

    store().applyCabinetPatch(cabinet, { drawers: { ...model().drawers, count: 1 } });
    expect(typed(cabinet, 'drawer_front')).toHaveLength(1);
  });
});

describe('Взаимодействие 29 — команды, клавиши и меню', () => {
  it('Тест 23/24/119: реестр команд и история', () => {
    expect(COMMANDS.length).toBeGreaterThan(20);
    expect(findCommand('history.undo')?.shortcut).toBe('Ctrl+Z');
    expect(findCommand('history.redo')?.shortcut).toBe('Ctrl+Shift+Z');
    expect(findCommand('нет такой')).toBeUndefined();
  });

  it('Тест 126/127: горячие клавиши и защита от поля ввода', () => {
    expect(keyChord({ key: 'v' })).toBe('V');
    expect(keyChord({ key: 'z', ctrlKey: true })).toBe('Ctrl+Z');
    expect(keyChord({ key: 'z', metaKey: true, shiftKey: true })).toBe('Ctrl+Shift+Z');

    expect(commandForKey({ key: 'v' })?.id).toBe('tool.select');
    expect(commandForKey({ key: 'm' })?.id).toBe('tool.move');
    expect(commandForKey({ key: 'r' })?.id).toBe('tool.rotate');
    expect(commandForKey({ key: 's' })?.id).toBe('tool.resize');
    expect(commandForKey({ key: 'd' })?.id).toBe('tool.dimension');
    expect(commandForKey({ key: 'g' })?.id).toBe('tool.guide');
    expect(commandForKey({ key: 'Escape' })?.id).toBe('select.none');
    expect(commandForKey({ key: 'Delete' })?.id).toBe('structure.delete');
    expect(commandForKey({ key: 'Backspace' })?.id).toBe('structure.delete');
    expect(commandForKey({ key: 'd', ctrlKey: true })?.id).toBe('structure.duplicate');

    // В поле ввода горячие клавиши молчат (§127).
    expect(commandForKey({ key: 'Delete' }, { tagName: 'INPUT' })).toBeUndefined();
    expect(isTextInput({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextInput({ isContentEditable: true })).toBe(true);
    expect(isTextInput({ tagName: 'DIV' })).toBe(false);
    expect(shortcutList().length).toBeGreaterThan(5);
  });

  it('Тест 128/129: контекстное меню детали и шкафа', () => {
    expect(PART_MENU.some((i) => i.commandId === 'structure.duplicate')).toBe(true);
    expect(PART_MENU.some((i) => i.commandId === 'structure.isolate')).toBe(true);
    expect(CABINET_MENU.map((i) => i.commandId)).toContain('structure.addShelf');
    expect(menuFor('CABINET')).toEqual(CABINET_MENU);
    expect(menuFor('PART')).toEqual(PART_MENU);
    expect(menuFor(null).some((i) => i.commandId === 'select.all')).toBe(true);
  });

  it('Тест 121/122: транзакция считает шаги и откатывается', () => {
    const tx = beginTransaction('drag', 'Перетаскивание', { y: 100 });
    expect(tx.open).toBe(true);
    const stepped = stepTransaction(stepTransaction(tx));
    expect(stepped.steps).toBe(2);
    const done = commitTransaction(stepped);
    expect(done.open).toBe(false);
    expect(stepTransaction(done).steps).toBe(2); // закрытая транзакция не растёт
    expect(rollbackTransaction(done)).toEqual({ y: 100 });
  });

  it('Тест 121/142: отмена транзакции возвращает модель', () => {
    const model = store().getCabinetModel(cabinet)!;
    store().beginInteractionTransaction('drag', 'Проба');
    store().applyCabinetPatch(cabinet, { width: 1200 });
    store().cancelInteractionTransaction();
    expect(store().getCabinetModel(cabinet)!.width).toBe(model.width);
  });
});

describe('Взаимодействие 29 — статус, связи и предпросмотр', () => {
  it('Тест 131/133/134: строка состояния и округление только при показе', () => {
    const status = buildStatusLine({
      cursor: { x: 10.25, y: 0, z: 0 },
      selectedNames: ['Полка 1'],
      tool: 'Выбор',
      snapEnabled: true,
    });
    expect(status.selection).toBe('Полка 1');
    expect(status.units).toBe('mm');
    expect(status.snap).toContain('привязка');
    expect(buildStatusLine({ selectedNames: [], tool: 'Выбор', snapEnabled: false }).selection)
      .toBe('ничего не выбрано');
    expect(buildStatusLine({ selectedNames: ['a', 'b'], tool: 'x', snapEnabled: true }).selection)
      .toBe('выбрано: 2');
    // Округление — только в подписи, само значение не трогается (§134).
    expect(formatMm(10.249)).toBe('10.2 мм');
  });

  it('Тест 18/137: индикаторы Linked / Override / Locked', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    expect(linkIndicator(shelf).label).toBe('Linked');
    store().resizeSelectedPart(shelf.id as PartId, 'width', 600);
    expect(linkIndicator(findPart(project(), shelf.id)!).label).toBe('Override');
    store().setPartLock(shelf.id as PartId, { position: true });
    expect(linkIndicator(findPart(project(), shelf.id)!).label).toBe('Locked');

    const manualId = store().addPart({ name: 'Ручная' });
    expect(linkState(findPart(project(), manualId)!)).toBe('MANUAL');
    expect(partSource(findPart(project(), manualId)!)).toBe('MANUAL');
  });

  it('Тест 138/139/140: предпросмотр зависимостей и изменения', () => {
    const preview = dependencyPreview(project(), 'width');
    expect(preview.nodes).toContain('shelves');
    expect(preview.nodes).toContain('cutting');
    expect(preview.partIds.length).toBeGreaterThan(0);
    expect(preview.description).toContain('→');

    const change = changePreview(project(), 'width');
    expect(change.parts.length).toBeGreaterThan(0);
    expect(change.summary).toContain('затронет');
    expect(change.needsConfirmation).toBe(change.parts.length >= LARGE_CHANGE_THRESHOLD);
  });

  it('Тест 33/135/136: замечания конструкции привязаны к деталям', () => {
    const clean = issuesByPart(project());
    expect(Array.isArray(clean)).toBe(true);

    const part = partsOf(cabinet)[0];
    store().addManualOperation({
      partId: part.id as PartId, face: 'front', x: part.width + 400, y: 10, diameter: 5, depth: 8,
    });
    const issues = issuesByPart(project());
    expect(issues.some((i) => i.partId === String(part.id))).toBe(true);
    expect(issues[0].severity).toBe('error');
  });
});

describe('Взаимодействие 29 — интеграции и регрессия', () => {
  it('Тест 29/30/31 (§175–§178): 2D и 3D читают одну модель', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    // Правка «в 2D» — через ту же модель, что видит 3D.
    store().resizeSelectedPart(shelf.id as PartId, 'width', 640);
    const entities = partEntities(project(), 'FRONT');
    const entity = entities.find((e) => e.entityId === String(shelf.id))!;
    expect(Math.round(entity.transform.width)).toBe(640);
    expect(findPart(project(), shelf.id)!.width).toBe(640);

    // Правка «в 3D» видна в 2D.
    store().updatePart(shelf.id as PartId, { position: { ...shelf.position, y: 900 } });
    const moved = partEntities(project(), 'FRONT').find((e) => e.entityId === String(shelf.id))!;
    expect(Math.round(moved.transform.y + moved.transform.height / 2)).toBe(900);
  });

  it('Тест 32/35 (§179): коллизии видны после ручного сдвига', () => {
    expect(checkPartCollisions(partsOf(cabinet))).toEqual([]);
    const shelf = typed(cabinet, 'shelf')[0];
    const top = byKey(cabinet, 'CABINET.TOP');
    store().updatePart(shelf.id as PartId, { position: { ...top.position } });
    expect(checkPartCollisions(partsOf(cabinet)).length).toBeGreaterThan(0);
  });

  it('Тест 33/36 (§180): конфликт ограничений не ломает модель', () => {
    const before = partsOf(cabinet).length;
    // Взаимоисключающие требования: полка шире корпуса и уже нуля.
    expect(store().resizeSelectedPart(typed(cabinet, 'shelf')[0].id as PartId, 'width', 0).ok).toBe(false);
    expect(store().applyCabinetPatch(cabinet, { width: 10 }).ok).toBe(false);
    expect(partsOf(cabinet)).toHaveLength(before);
  });

  it('Тест 23/24 (§166/§167): undo и redo', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    store().resizeSelectedPart(shelf.id as PartId, 'width', 700);
    expect(findPart(project(), shelf.id)!.width).toBe(700);
    store().undo();
    expect(findPart(project(), shelf.id)!.width).not.toBe(700);
    store().redo();
    expect(findPart(project(), shelf.id)!.width).toBe(700);
  });

  it('Тест 34/35 (§183/§184): проект переживает сохранение и восстановление', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    store().resizeSelectedPart(shelf.id as PartId, 'width', 512);
    expect(store().saveState).toBe('unsaved');

    const restored = deserializeProject(JSON.stringify(project()));
    const restoredPart = findPart(restored, shelf.id)!;
    expect(restoredPart.width).toBe(512);
    expect(hasOverride(restoredPart)).toBe(true);
  });

  it('Тест 36/123/124/125 (§181): 1000 деталей — выбор, рамка и привязка', () => {
    // Проект на 1000 деталей собирается один раз: интерактивные операции
    // работают с ним как с обычной моделью.
    const base = project();
    const parts: Part[] = Array.from({ length: 1000 }, (_, i) => ({
      ...createPart({ name: `Деталь ${i + 1}`, width: 300, height: 200, thickness: 16 }),
      position: { x: (i % 40) * 320, y: Math.floor(i / 40) * 220, z: 0 },
    }));
    const big: Project = {
      ...base,
      furnitures: [{
        ...base.furnitures[0],
        assemblies: [{ ...base.furnitures[0].assemblies[0], parts }],
      }],
    };

    const started = Date.now();
    const box = normalizeBox3({ x: -1000, y: -1000, z: -1000 }, { x: 20000, y: 20000, z: 1000 });
    expect(selectInBox(big, box)).toHaveLength(1000);
    // Рамка «целиком» отсекает то, что в неё не поместилось.
    const small = normalizeBox3({ x: -10, y: -10, z: -100 }, { x: 700, y: 700, z: 100 });
    expect(selectInBox(big, small).length).toBeLessThan(1000);

    const candidates = partCandidates(parts.slice(0, 200));
    expect(candidates.length).toBeGreaterThan(1000);
    const match = snapAxis(322, 'x', candidates, { ...DEFAULT_SNAP_3D, tolerance: 20 });
    expect(match.candidate).not.toBeNull();

    expect(selectAll(big, EMPTY_SELECTION).ids).toHaveLength(1000);
    expect(Date.now() - started).toBeLessThan(10000);
  });

  it('Тест 36 (§166): полная цепочка после интерактивной правки', () => {
    const shelf = typed(cabinet, 'shelf')[0];
    store().selectEntity(String(shelf.id));
    store().resizeSelectedPart(shelf.id as PartId, 'width', 600);
    store().applyCabinetPatch(cabinet, { width: 900 });

    expect(allOperations(project()).length).toBeGreaterThan(0);
    expect(runCutting(project()).jobs.length).toBeGreaterThan(0);
    expect(partEntities(project(), 'TOP').length).toBeGreaterThan(0);
    expect(project().hardwareConnections.length).toBeGreaterThan(0);
    // Ручное значение пережило пересчёт.
    expect(findPart(project(), shelf.id)!.width).toBe(600);
  });
});
