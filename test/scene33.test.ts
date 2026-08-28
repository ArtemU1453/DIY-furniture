/**
 * ЭТАП 33 — Интерактивный 3D-редактор мебели.
 *
 * Цепочка: ProjectModel → FurnitureScene → узлы (корпус, модуль, деталь,
 * фурнитура, присадка) → материалы и кромка → выбор и дерево → камера, виды,
 * сечение, разнос → измерение и коллизии → правки через модель → раскрой,
 * спецификация, производство.
 *
 * Проверяет, что 3D НЕ хранит собственных данных о мебели: любое изменение
 * модели меняет сцену, а изменения из сцены проходят через ProjectModel.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_EXPLODE,
  DEFAULT_MEASURE,
  DEFAULT_SECTION,
  DEFAULT_SNAP,
  DEFAULT_TREE_FILTER,
  DEFAULT_VISIBILITY,
  SCENE_VIEWS,
  VIEW_CUBE_FACES,
  VIEW_HOTKEY,
  addMeasurePoint,
  allowedScale,
  ancestors,
  buildFurnitureScene,
  cameraPosition,
  clearMeasures,
  clearSelection,
  collisionSummary,
  composeTransform,
  debugInfo,
  dependentNodes,
  descendants,
  diffScenes,
  explodeOffset,
  explodedPosition,
  filterTree,
  fitModel,
  grainAngle,
  hardwareSize,
  hasTexture,
  hideOthers,
  homeView,
  isCut,
  isSceneStale,
  isSupportedModel,
  isVisible,
  isolate,
  machiningShape,
  materialPreview,
  measureBetween,
  moveSection,
  navigationCommands,
  nodeBoundingBox,
  nodeDimensions,
  nodeOfPart,
  nodesOfKind,
  partNumbers,
  partOfSelection,
  placeholderOf,
  planMove,
  planRotate,
  raycast,
  rebuildScene,
  round01,
  sceneBounds,
  sceneCollisions,
  sceneSignature,
  sceneTree,
  selectInBox,
  selectNode,
  selectionForPart,
  setSectionAxis,
  setView,
  showAll,
  snapAxis,
  snapToGrid,
  toggleExplode,
  toggleHidden,
  toggleMeasure,
  toggleNode,
  toggleSection,
  updateScene,
  viewOfCubeFace,
  visibleNodes,
  type SceneVisibility,
} from '@/engines/scene';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { hardwareBom } from '@/engines/hardware';
import { runCutting, isCuttingStale, productionSignature } from '@/engines/cutting';
import { productionParts, productionSnapshot } from '@/engines/production';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';
import { saveProject, loadProject as repoLoad } from '@/storage/project/projectRepository';
import { createProject } from '@/core/model/factory';
import type { Part, Project } from '@/core/model/types';
import type { HardwareId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;
const scene = (opts = {}) => buildFurnitureScene(project(), opts);

/** Шкаф 800 × 2000 × 600 с полками и фасадами. */
function makeCabinet(): void {
  store().newProject('Тест 33');
  const id = store().createParametricCabinet({ width: 800, height: 2000, depth: 600, name: 'Шкаф' })!;
  const model = store().getCabinetModel(id)!;
  store().applyCabinetPatch(id, {
    shelves: { ...model.shelves, count: 3 },
    doors: { ...model.doors, count: 2 },
  });
}

const firstPart = (): Part => allParts(project())[0];

/** Поставить фурнитуру каталога на деталь. */
function placeHardware(entryId: string, part: Part): string {
  store().addCatalogHardwareToProject(entryId);
  const result = store().placeHardwareItem({
    hardwareId: entryId as HardwareId,
    partId: part.id as PartId,
  });
  expect(result.ok).toBe(true);
  return result.itemId!;
}

beforeEach(() => {
  makeCabinet();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Сцена 33 — граф и трансформации', () => {
  it('Тест 1: сцена строится из ProjectModel и содержит все уровни', () => {
    placeHardware('cat-hinge', firstPart());
    const s = scene();
    expect(s.rootId).toContain('project:');
    expect(s.nodes[s.rootId].kind).toBe('PROJECT');
    expect(nodesOfKind(s, 'CABINET').length).toBe(project().furnitures.length);
    expect(nodesOfKind(s, 'MODULE').length).toBeGreaterThan(0);
    expect(nodesOfKind(s, 'PART').length).toBe(allParts(project()).length);
    expect(nodesOfKind(s, 'HARDWARE').length).toBeGreaterThan(0);
    expect(nodesOfKind(s, 'MACHINING').length).toBe(allOperations(project()).length);
  });

  it('Тест 2: у каждого узла есть ссылка на объект модели, а не копия данных', () => {
    const s = scene();
    const partIds = new Set(allParts(project()).map((p) => String(p.id)));
    for (const node of nodesOfKind(s, 'PART')) {
      expect(partIds.has(node.refId!)).toBe(true);
    }
    // Размер узла берётся из детали — второго источника размеров нет (§15).
    const part = firstPart();
    const node = nodeOfPart(s, String(part.id))!;
    expect(node.size.x).toBe(part.width);
    expect(node.size.y).toBe(part.height);
    expect(node.size.z).toBe(part.thickness);
  });

  it('Тест 3: иерархия узлов — Project → Cabinet → Module → Part', () => {
    const s = scene();
    const node = nodeOfPart(s, String(firstPart().id))!;
    const chain = ancestors(s, node.id).map((n) => n.kind);
    expect(chain).toEqual(['MODULE', 'CABINET', 'PROJECT']);
    expect(descendants(s, s.rootId).length).toBe(s.order.length - 1);
  });

  it('Тест 4: локальная и мировая трансформации связаны через родителя', () => {
    const s = scene();
    const node = nodesOfKind(s, 'PART')[0];
    const parent = s.nodes[node.parentId!];
    const expected = composeTransform(parent.world, node.local);
    expect(round01(node.world.position.x)).toBe(round01(expected.position.x));
    expect(round01(node.world.position.y)).toBe(round01(expected.position.y));

    // Смещение корпуса двигает детей (§13).
    const shifted = composeTransform(
      { position: { x: 100, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      node.local,
    );
    expect(round01(shifted.position.x)).toBe(round01(node.local.position.x + 100));
  });

  it('Тест 5: геометрия детали следует за её параметрами', () => {
    const part = firstPart();
    const before = nodeOfPart(scene(), String(part.id))!.size.x;
    store().updatePart(part.id, { width: part.width + 120 });
    const after = nodeOfPart(scene(), String(part.id))!.size.x;
    expect(after).toBe(before + 120);
  });

  it('Тест 6: фурнитура и присадка становятся детьми своей детали', () => {
    const part = firstPart();
    placeHardware('cat-hinge', part);
    const s = scene();
    const node = nodeOfPart(s, String(part.id))!;
    const children = node.childIds.map((id) => s.nodes[id].kind);
    expect(children).toContain('HARDWARE');
    expect(children).toContain('MACHINING');
    expect(dependentNodes(s, node.id).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Сцена 33 — материалы, текстура, кромка', () => {
  it('Тест 7: цвет узла берётся из материала проекта', () => {
    const part = firstPart();
    const material = project().materials.find((m) => String(m.id) === String(part.material))!;
    const node = nodeOfPart(scene(), String(part.id))!;
    expect(node.material!.color).toBe(material.color);
    expect(node.material!.materialId).toBe(String(material.id));
    expect(node.material!.name).toBe(material.name);
  });

  it('Тест 8: без материала показывается нейтральный цвет, а не выдуманный', () => {
    const part = firstPart();
    store().updatePart(part.id, { material: null });
    const node = nodeOfPart(scene(), String(part.id))!;
    expect(node.material!.materialId).toBeNull();
    expect(node.material!.color).toBeTruthy();
  });

  it('Тест 9: текстура используется, если она есть в материале', () => {
    const part = firstPart();
    const node = nodeOfPart(scene(), String(part.id))!;
    expect(hasTexture(node.material!)).toBe(node.material!.textureId !== undefined);
    expect(hasTexture({ ...node.material!, textureId: 'oak' })).toBe(true);
    expect(hasTexture({ ...node.material!, textureId: undefined })).toBe(false);
  });

  it('Тест 10: направление текстуры задаёт угол поворота', () => {
    const part = firstPart();
    expect(grainAngle({ ...part, grain: 'length' })).toBe(0);
    expect(grainAngle({ ...part, grain: 'width' })).toBe(90);
    expect(grainAngle({ ...part, grain: 'none' })).toBe(0);

    store().updatePart(part.id, { grain: 'width' });
    expect(nodeOfPart(scene(), String(part.id))!.material!.grainAngle).toBe(90);
  });

  it('Тест 11: кромка попадает в узел с материалом и толщиной', () => {
    const part = firstPart();
    const edge = project().edges[0];
    store().setPartEdge(part.id, 'top', edge.id);
    const node = nodeOfPart(scene(), String(part.id))!;
    const band = node.edges!.find((e) => e.side === 'top')!;
    expect(band.materialId).toBe(String(edge.id));
    expect(band.thickness).toBe(edge.thickness);
    expect(band.color).toBe(edge.color);
    expect(band.length).toBeGreaterThan(0);
  });

  it('Тест 12: предпросмотр материалов показывает использование', () => {
    const preview = materialPreview(project(), allParts(project()));
    expect(preview.length).toBeGreaterThan(0);
    expect(preview.some((m) => m.usedBy > 0)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Сцена 33 — выбор и дерево', () => {
  it('Тест 13: одиночный и множественный выбор, снятие выделения', () => {
    const s = scene();
    const [a, b] = nodesOfKind(s, 'PART');
    let selection = selectNode(a.id);
    expect(selection.ids).toEqual([a.id]);
    selection = toggleNode(selection, b.id);
    expect(selection.ids).toEqual([a.id, b.id]);
    expect(selection.activeId).toBe(b.id);
    selection = toggleNode(selection, b.id);
    expect(selection.ids).toEqual([a.id]);
    expect(clearSelection().ids).toEqual([]);
  });

  it('Тест 14: выделение рамкой отбирает узлы по проекции', () => {
    const s = scene();
    const nodes = nodesOfKind(s, 'PART');
    const projectNode = (node: typeof nodes[number]) => ({ x: node.world.position.x, y: node.world.position.y });
    const box = { minX: -10000, minY: -10000, maxX: 10000, maxY: 10000 };
    expect(selectInBox(s, box, projectNode).ids.length).toBe(nodes.length);
    expect(selectInBox(s, { minX: 1e6, minY: 1e6, maxX: 2e6, maxY: 2e6 }, projectNode).ids.length).toBe(0);
  });

  it('Тест 15: raycast находит ближайший узел по лучу', () => {
    const s = scene();
    const node = nodesOfKind(s, 'PART')[0];
    const hit = raycast(s, {
      origin: { x: node.world.position.x, y: node.world.position.y, z: node.world.position.z + 5000 },
      direction: { x: 0, y: 0, z: -1 },
    }, ['PART']);
    expect(hit).not.toBeNull();
    expect(raycast(s, {
      origin: { x: 1e6, y: 1e6, z: 1e6 }, direction: { x: 0, y: 1, z: 0 },
    }, ['PART'])).toBeNull();
  });

  it('Тест 16: дерево повторяет иерархию сцены', () => {
    const s = scene();
    const tree = sceneTree(s);
    expect(tree[0].kind).toBe('PROJECT');
    expect(tree[0].depth).toBe(0);
    expect(tree.some((i) => i.kind === 'PART' && i.depth === 3)).toBe(true);
    expect(tree.length).toBe(s.order.length);
  });

  it('Тест 17: поиск и фильтры дерева', () => {
    placeHardware('cat-hinge', firstPart());
    const s = scene();
    const tree = sceneTree(s);
    const numbers = partNumbers(allParts(project()));

    const onlyParts = filterTree(s, tree, { parts: true, hardware: false, machining: false }, numbers);
    expect(onlyParts.some((i) => i.kind === 'HARDWARE')).toBe(false);
    expect(onlyParts.some((i) => i.kind === 'PART')).toBe(true);

    const found = filterTree(s, tree, { ...DEFAULT_TREE_FILTER, query: firstPart().name }, numbers);
    expect(found.some((i) => i.label === firstPart().name)).toBe(true);
    // Родители найденного узла остаются в списке.
    expect(found.some((i) => i.kind === 'CABINET')).toBe(true);
  });

  it('Тест 18: выбор в 2D и в 3D указывает на одну деталь', () => {
    const s = scene();
    const part = firstPart();
    const selection = selectionForPart(s, String(part.id));
    expect(selection.activeId).toBe(nodeOfPart(s, String(part.id))!.id);
    expect(partOfSelection(s, selection)).toBe(String(part.id));

    // Для фурнитуры показывается её родительская деталь (§158).
    placeHardware('cat-hinge', part);
    const s2 = scene();
    const hardwareNodeId = nodesOfKind(s2, 'HARDWARE')[0].id;
    expect(partOfSelection(s2, selectNode(hardwareNodeId))).toBe(String(part.id));
  });

  it('Тест 19: store синхронизирует выбор узла и деталь', () => {
    const s = scene();
    const node = nodeOfPart(s, String(firstPart().id))!;
    store().selectSceneNode(node.id);
    expect(store().scene.selection.activeId).toBe(node.id);
    expect(String(store().selectedPartId)).toBe(String(firstPart().id));

    store().clearSceneSelection();
    expect(store().scene.selection.ids).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Сцена 33 — камера, виды, сетка, привязка', () => {
  it('Тест 20: семь стандартных видов и горячие клавиши', () => {
    expect(SCENE_VIEWS.length).toBe(7);
    expect(VIEW_HOTKEY['1']).toBe('FRONT');
    expect(VIEW_HOTKEY['7']).toBe('ISO');
    const camera = setView({ view: 'FRONT', target: { x: 0, y: 0, z: 0 }, distance: 1000 }, 'TOP');
    expect(camera.view).toBe('TOP');
    expect(cameraPosition(camera).y).toBeGreaterThan(0);
  });

  it('Тест 21: View Cube переключает вид по грани', () => {
    expect(VIEW_CUBE_FACES.length).toBe(7);
    expect(viewOfCubeFace('left')).toBe('LEFT');
    expect(viewOfCubeFace('iso')).toBe('ISO');
    expect(viewOfCubeFace('нет')).toBeUndefined();
  });

  it('Тест 22: Fit Model вписывает модель, пустой проект не ломает камеру', () => {
    const s = scene();
    const fitted = fitModel(s, { view: 'ISO', target: { x: 0, y: 0, z: 0 }, distance: 100 });
    const bounds = sceneBounds(s);
    expect(Math.round(fitted.target.y)).toBe(Math.round(bounds.center.y));
    expect(fitted.distance).toBeGreaterThan(100);

    const empty = buildFurnitureScene(createProject({ name: 'Пустой', withStarterContent: false }));
    const home = homeView(empty);
    expect(home.distance).toBeGreaterThan(0);
    expect(sceneBounds(empty).size).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('Тест 23: сетка и привязка', () => {
    expect(snapToGrid(107, 10)).toBe(110);
    expect(snapToGrid(107, 0)).toBe(107);

    const s = scene();
    const node = nodesOfKind(s, 'PART')[0];
    const target = node.world.position.x + node.size.x / 2;
    const snapped = snapAxis(s, 'x', target + 3, DEFAULT_SNAP, 'нет-такого');
    expect(snapped.snapped).not.toBeNull();
    expect(round01(snapped.value)).toBe(round01(target));

    const off = snapAxis(s, 'x', target + 3, { ...DEFAULT_SNAP, enabled: false });
    expect(off.snapped).toBeNull();
    expect(off.value).toBe(target + 3);
  });

  it('Тест 24: store переключает виды, вписывает и возвращает домашний вид', () => {
    store().setSceneView('TOP');
    expect(store().scene.camera.view).toBe('TOP');
    store().fitSceneModel();
    expect(store().scene.camera.distance).toBeGreaterThan(0);
    store().sceneHomeView();
    expect(store().scene.camera.view).toBe('ISO');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Сцена 33 — видимость, сечение, разнос', () => {
  it('Тест 25: скрытие, изоляция и показать всё', () => {
    const s = scene();
    const node = nodesOfKind(s, 'PART')[0];
    let visibility: SceneVisibility = { ...DEFAULT_VISIBILITY, hidden: [] };

    visibility = toggleHidden(visibility, node.id);
    expect(isVisible(s, visibility, node.id)).toBe(false);
    visibility = toggleHidden(visibility, node.id);
    expect(isVisible(s, visibility, node.id)).toBe(true);

    visibility = isolate(visibility, node.id);
    const other = nodesOfKind(s, 'PART')[1];
    expect(isVisible(s, visibility, node.id)).toBe(true);
    expect(isVisible(s, visibility, other.id)).toBe(false);

    visibility = showAll(visibility);
    expect(isVisible(s, visibility, other.id)).toBe(true);
  });

  it('Тест 26: скрыть прочие оставляет выбранный узел', () => {
    const s = scene();
    const node = nodesOfKind(s, 'PART')[0];
    const visibility = hideOthers(s, { ...DEFAULT_VISIBILITY, hidden: [] }, [node.id]);
    expect(isVisible(s, visibility, node.id)).toBe(true);
    expect(visibleNodes(s, visibility).some((n) => n.kind === 'PART' && n.id !== node.id)).toBe(false);
  });

  it('Тест 27: слои фурнитуры и присадки переключаются', () => {
    placeHardware('cat-hinge', firstPart());
    const s = scene();
    const hardware = nodesOfKind(s, 'HARDWARE')[0];
    const machining = nodesOfKind(s, 'MACHINING')[0];
    const visibility = { ...DEFAULT_VISIBILITY, hidden: [], showHardware: false, showMachining: true };
    expect(isVisible(s, visibility, hardware.id)).toBe(false);
    expect(isVisible(s, visibility, machining.id)).toBe(true);
    expect(isVisible(s, { ...visibility, showMachining: false }, machining.id)).toBe(false);
  });

  it('Тест 28: сечение отсекает узлы и не меняет модель', () => {
    const s = scene();
    let section = toggleSection(DEFAULT_SECTION, true);
    section = setSectionAxis(section, 'X', s);
    const before = JSON.stringify(project());

    const node = nodesOfKind(s, 'PART')[0];
    section = moveSection(section, node.world.position.x - node.size.x);
    expect(isCut(node, section)).toBe(true);
    expect(isCut(node, { ...section, enabled: false })).toBe(false);
    expect(JSON.stringify(project())).toBe(before);
  });

  it('Тест 29: разнос смещает узлы только визуально', () => {
    const s = scene();
    const state = toggleExplode({ ...DEFAULT_EXPLODE, factor: 1 }, true);
    const before = JSON.stringify(project());

    // Берём деталь, реально стоящую в стороне от центра модели.
    const node = nodesOfKind(s, 'PART')
      .find((n) => Math.abs(explodeOffset(s, n, state).x)
        + Math.abs(explodeOffset(s, n, state).y)
        + Math.abs(explodeOffset(s, n, state).z) > 1)!;
    expect(node).toBeDefined();

    const offset = explodeOffset(s, node, state);
    const moved = explodedPosition(s, node, state);
    expect(moved.x).toBe(node.world.position.x + offset.x);
    expect(moved.y).toBe(node.world.position.y + offset.y);
    expect([moved.x, moved.y, moved.z]).not.toEqual([
      node.world.position.x, node.world.position.y, node.world.position.z,
    ]);

    // ProjectModel не изменился (§75): деталь стоит там же, где стояла.
    expect(JSON.stringify(project())).toBe(before);
    expect(findPart(project(), node.refId as PartId)!.position.y).toBe(node.local.position.y);
    expect(explodeOffset(s, node, { enabled: false, factor: 1 })).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('Тест 30: store хранит состояние вида отдельно от модели', () => {
    const before = JSON.stringify(project());
    store().setSceneSection({ enabled: true, axis: 'Y', position: 100 });
    store().setSceneExplode({ enabled: true, factor: 1.2 });
    store().setSceneVisibility({ showMachining: true });
    const node = nodesOfKind(scene(), 'PART')[0];
    store().hideSceneNode(node.id, true);
    store().isolateSceneNode(node.id);
    store().showAllSceneNodes();

    expect(store().scene.section.enabled).toBe(true);
    expect(store().scene.explode.factor).toBe(1.2);
    expect(store().scene.visibility.isolated).toBeNull();
    expect(JSON.stringify(project())).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Сцена 33 — размеры, измерение, проверки', () => {
  it('Тест 31: размеры узла показываются в мм с точностью 0.1', () => {
    const s = scene();
    const node = nodeOfPart(s, String(firstPart().id))!;
    const dims = nodeDimensions(node);
    expect(dims.width).toBe(round01(node.size.x));
    expect(round01(123.456)).toBe(123.5);
  });

  it('Тест 32: измерение двух точек даёт расстояние и проекции', () => {
    const result = measureBetween({ x: 0, y: 0, z: 0 }, { x: 300, y: 400, z: 0 });
    expect(result.distance).toBe(500);
    expect(result.dx).toBe(300);
    expect(result.dy).toBe(400);
    expect(result.dz).toBe(0);

    let state = toggleMeasure(DEFAULT_MEASURE, true);
    state = addMeasurePoint(state, { x: 0, y: 0, z: 0 });
    expect(state.pending).not.toBeNull();
    state = addMeasurePoint(state, { x: 0, y: 0, z: 100 });
    expect(state.results.length).toBe(1);
    expect(state.results[0].distance).toBe(100);
    expect(clearMeasures(state).results).toEqual([]);
  });

  it('Тест 33: store ведёт измерения и очищает их', () => {
    store().toggleSceneMeasure(true);
    store().addSceneMeasurePoint({ x: 0, y: 0, z: 0 });
    store().addSceneMeasurePoint({ x: 100, y: 0, z: 0 });
    expect(store().scene.measure.results.length).toBe(1);
    store().clearSceneMeasures();
    expect(store().scene.measure.results.length).toBe(0);
  });

  it('Тест 34: коллизии и зазоры считаются по сцене с переходом к объекту', () => {
    const s = scene();
    const found = sceneCollisions(s, project());
    expect(Array.isArray(found)).toBe(true);
    const summary = collisionSummary(found);
    expect(summary.errors + summary.warnings).toBe(found.length);

    // Совмещаем две детали — появляется коллизия с узлами для перехода.
    const [a, b] = allParts(project());
    store().updatePart(b.id, { position: { ...a.position } });
    const conflicts = sceneCollisions(scene(), project());
    expect(conflicts.some((c) => c.code === 'collision')).toBe(true);
    const first = conflicts.find((c) => c.code === 'collision')!;
    expect(first.nodeIds.length).toBeGreaterThan(0);
    expect(first.severity).toBe('error');
  });

  it('Тест 35: отладочные данные показывают узел, координаты и бокс', () => {
    const s = scene();
    const node = nodeOfPart(s, String(firstPart().id))!;
    const world = debugInfo(s, node.id, 'WORLD')!;
    const local = debugInfo(s, node.id, 'LOCAL')!;
    expect(world.nodeId).toBe(node.id);
    expect(world.refId).toBe(String(firstPart().id));
    expect(world.unit).toBe('мм');
    expect(world.space).toBe('WORLD');
    expect(local.space).toBe('LOCAL');
    const box = nodeBoundingBox(node);
    expect(box.size.x).toBe(round01(node.size.x));
    expect(debugInfo(s, 'нет-такого')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Сцена 33 — присадка и фурнитура', () => {
  it('Тест 36: операции присадки получают форму, размер и направление', () => {
    placeHardware('cat-hinge', firstPart());
    const s = scene();
    const nodes = nodesOfKind(s, 'MACHINING');
    expect(nodes.length).toBeGreaterThan(0);
    const cup = nodes.find((n) => n.machining!.type === 'boring')!;
    expect(cup.machining!.shape).toBe('HOLE');
    expect(cup.size.x).toBe(cup.machining!.diameter);
    const dir = cup.machining!.direction;
    expect(Math.round(Math.hypot(dir.x, dir.y, dir.z))).toBe(1);

    expect(machiningShape('slot')).toBe('GROOVE');
    expect(machiningShape('pocket')).toBe('POCKET');
    expect(machiningShape('cutout')).toBe('CUTOUT');
    expect(machiningShape('drilling')).toBe('HOLE');
  });

  it('Тест 37: фурнитура получает заглушку и размер по параметрам', () => {
    placeHardware('cat-handle', firstPart());
    const s = scene();
    const node = nodesOfKind(s, 'HARDWARE')[0];
    expect(node.hardware!.placeholder).toBe('BOX');
    expect(node.size.x).toBe(128);
    expect(placeholderOf('HINGE')).toBe('CYLINDER');
    expect(placeholderOf('DRAWER_SLIDE')).toBe('PLATE');
    expect(hardwareSize('HINGE', { cupDiameter: 35, cupDepth: 12.5 })).toEqual({ x: 35, y: 35, z: 12.5 });
  });

  it('Тест 38: локальные 3D-модели поддерживаются, интернет-ссылки — нет', () => {
    expect(isSupportedModel('models/hinge.glb')).toBe(true);
    expect(isSupportedModel('models/hinge.gltf')).toBe(true);
    expect(isSupportedModel('models/hinge.obj')).toBe(false);
    expect(isSupportedModel('https://example.com/hinge.glb')).toBe(false);
    expect(isSupportedModel(undefined)).toBe(false);
  });

  it('Тест 39: положение фурнитуры следует за Override и Reset', () => {
    const part = firstPart();
    const itemId = placeHardware('cat-hinge', part);
    const before = nodesOfKind(scene(), 'HARDWARE')[0].world.position.y;

    store().moveHardwareItem(itemId, { x: 30, y: 500 });
    const moved = nodesOfKind(scene(), 'HARDWARE')[0].world.position.y;
    expect(Math.round(moved)).not.toBe(Math.round(before));

    store().resetHardwareItem(itemId);
    const reset = nodesOfKind(scene(), 'HARDWARE')[0].world.position.y;
    expect(Math.round(reset)).toBe(Math.round(before));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Сцена 33 — правки через модель и обновление', () => {
  it('Тест 40: перемещение проходит через ProjectModel и правила', () => {
    const s = scene();
    const node = nodeOfPart(s, String(firstPart().id))!;
    const part = firstPart();
    const plan = planMove(s, project(), part, { nodeId: node.id, delta: { x: 100, y: 0, z: 0 } }, DEFAULT_SNAP);
    expect(plan.position.x).not.toBe(part.position.x);
    expect(typeof plan.ok).toBe('boolean');

    const before = findPart(project(), part.id)!.position.x;
    const result = store().moveSceneNode(node.id, { x: 50, y: 0, z: 0 });
    if (result.ok) {
      expect(findPart(project(), part.id)!.position.x).not.toBe(before);
    } else {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('Тест 41: поворот и запрет масштабирования деталей', () => {
    const part = firstPart();
    const rotated = planRotate(project(), part, 'y', 90);
    expect(rotated.rotation.y).toBe((part.rotation.y ?? 0) + 90);

    const s = scene();
    const partNode = nodeOfPart(s, String(part.id))!;
    expect(allowedScale(partNode, 2)).toBe(1);
    const machining = nodesOfKind(s, 'MACHINING')[0];
    if (machining) expect(allowedScale(machining, 2)).toBe(2);
  });

  it('Тест 42: сцену нельзя менять в обход модели', () => {
    const s = scene();
    const node = nodesOfKind(s, 'MODULE')[0];
    const result = store().moveSceneNode(node.id, { x: 100, y: 0, z: 0 });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain('деталь');
  });

  it('Тест 43: изменение модели делает сцену устаревшей и даёт точечную разницу', () => {
    const before = scene();
    expect(isSceneStale(before, project())).toBe(false);

    const part = firstPart();
    store().updatePart(part.id, { width: part.width + 50 });
    expect(isSceneStale(before, project())).toBe(true);

    const updated = updateScene(before, project());
    expect(updated.diff.clean).toBe(false);
    // Изменился один узел детали, а не вся сцена (§126/§128).
    expect(updated.diff.changed).toContain(nodeOfPart(updated.scene, String(part.id))!.id);
    expect(updated.diff.changed.length).toBeLessThan(updated.scene.order.length);

    const same = updateScene(updated.scene, project());
    expect(same.diff.clean).toBe(true);
    expect(same.scene).toBe(updated.scene);
  });

  it('Тест 44: полная пересборка сцены доступна отдельной командой', () => {
    const before = scene();
    const rebuilt = rebuildScene(project());
    expect(rebuilt.rebuilt).toBe(true);
    expect(rebuilt.diff.added.length).toBe(rebuilt.scene.order.length);
    expect(diffScenes(before, rebuilt.scene).clean).toBe(true);
    expect(sceneSignature(project())).toBe(rebuilt.scene.signature);

    store().rebuildSceneRevision();
    expect(store().scene.revision).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Сцена 33 — интеграции и история', () => {
  it('Тест 45: правка из 3D меняет 2D, раскрой, производство и BOM', () => {
    store().applyCuttingReport(runCutting(project()));
    expect(isCuttingStale(project())).toBe(false);
    const parts = productionParts(project());
    const snapshotBefore = productionSnapshot(project(), parts);

    const part = firstPart();
    const node = nodeOfPart(scene(), String(part.id))!;
    store().selectSceneNode(node.id);
    store().updatePart(part.id, { width: part.width + 80 });

    // 2D работает с тем же ProjectModel (§43).
    expect(findPart(project(), part.id)!.width).toBe(part.width + 80);
    // Раскрой устарел (§44), производственный снимок изменился (§45).
    expect(isCuttingStale(project())).toBe(true);
    expect(productionSignature(project())).not.toBe('');
    const snapshotAfter = productionSnapshot(project(), productionParts(project()));
    expect(snapshotAfter.projectRevision).not.toBe(snapshotBefore.projectRevision);
  });

  it('Тест 46: изменение материала расходится по модели и сцене', () => {
    const part = firstPart();
    const other = project().materials.find((m) => String(m.id) !== String(part.material));
    if (!other) return;
    store().updatePart(part.id, { material: other.id });
    expect(nodeOfPart(scene(), String(part.id))!.material!.color).toBe(other.color);
    expect(productionParts(project()).find((p) => String(p.partId) === String(part.id))!.materialName)
      .toBe(other.name);
  });

  it('Тест 47: количество фурнитуры в сцене и в BOM совпадает по позиции', () => {
    const itemId = placeHardware('cat-hinge', firstPart());
    expect(itemId).toBeTruthy();
    const hardwareNodes = nodesOfKind(scene(), 'HARDWARE');
    const row = hardwareBom(project()).find((r) => r.hardwareId === 'cat-hinge')!;
    expect(row.quantity).toBe(hardwareNodes.length);
  });

  it('Тест 48: команды перехода зависят от выбранного объекта', () => {
    const s = scene();
    const node = nodeOfPart(s, String(firstPart().id))!;
    const commands = navigationCommands(s, selectNode(node.id), project());
    expect(commands.map((c) => c.target)).toContain('CUTTING');
    expect(commands.map((c) => c.target)).toContain('PRODUCTION');
    expect(commands.map((c) => c.target)).toContain('BOM');
    // Без раскроя переход в раскрой недоступен и объясняет причину (§156).
    expect(commands.find((c) => c.target === 'CUTTING')!.disabledReason).toBeTruthy();

    store().applyCuttingReport(runCutting(project()));
    const after = navigationCommands(scene(), selectNode(node.id), project());
    expect(after.find((c) => c.target === 'CUTTING')!.disabledReason).toBeUndefined();
  });

  it('Тест 49: правка из 3D — одна запись истории, Undo и Redo работают', () => {
    const part = firstPart();
    const before = part.width;
    store().updatePart(part.id, { width: before + 60 });
    expect(findPart(project(), part.id)!.width).toBe(before + 60);

    store().undo();
    expect(findPart(project(), part.id)!.width).toBe(before);
    store().redo();
    expect(findPart(project(), part.id)!.width).toBe(before + 60);
  });

  it('Тест 50: сцена восстанавливается из сохранённого проекта', async () => {
    placeHardware('cat-hinge', firstPart());
    const expected = scene().stats;

    await saveProject(project());
    const loaded = await repoLoad(project().id);
    store().loadProject(loaded!);
    expect(scene().stats.parts).toBe(expected.parts);
    expect(scene().stats.hardware).toBe(expected.hardware);

    const restored = deserializeProject(serializeProject(project()));
    expect(buildFurnitureScene(restored).stats.parts).toBe(expected.parts);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Сцена 33 — крайние случаи и производительность', () => {
  it('Тест 51: пустой проект и проект с одной деталью', () => {
    const empty = buildFurnitureScene(createProject({ name: 'Пустой', withStarterContent: false }));
    expect(empty.stats.parts).toBe(0);
    expect(sceneTree(empty).length).toBeGreaterThan(0);
    expect(visibleNodes(empty, { ...DEFAULT_VISIBILITY, hidden: [] }).length).toBeGreaterThan(0);

    store().newProject('Одна деталь');
    store().addPart();
    const one = scene();
    expect(one.stats.parts).toBe(allParts(project()).length);
    expect(nodesOfKind(one, 'PART').length).toBe(one.stats.parts);
  });

  it('Тест 52: 1000 деталей и 5000 операций собираются за разумное время', () => {
    const base = allParts(project())[0];
    const many: Part[] = Array.from({ length: 1000 }, (_, i) => ({
      ...base,
      id: `p-${i}` as PartId,
      name: `Деталь ${i}`,
      position: { x: (i % 50) * 100, y: Math.floor(i / 50) * 100, z: 0 },
      machining: Array.from({ length: 5 }, (_, k) => ({
        id: `op-${i}-${k}` as never,
        type: 'drilling' as const,
        partId: `p-${i}` as PartId,
        face: 'front' as const,
        x: 20 + k * 32,
        y: 30,
        z: 0,
        diameter: 5,
        depth: 12,
        origin: 'manual' as const,
      })),
    }));
    const big: Project = {
      ...project(),
      furnitures: [{
        ...project().furnitures[0],
        assemblies: [{ ...project().furnitures[0].assemblies[0], parts: many }],
      }],
    };

    const t0 = Date.now();
    const built = buildFurnitureScene(big);
    const elapsed = Date.now() - t0;
    expect(built.stats.parts).toBe(1000);
    expect(built.stats.machining).toBe(5000);
    expect(elapsed).toBeLessThan(8000);

    const t1 = Date.now();
    sceneTree(built);
    sceneBounds(built);
    expect(Date.now() - t1).toBeLessThan(4000);
  });

  it('Тест 53: прежние возможности проекта не сломаны', () => {
    placeHardware('cat-hinge', firstPart());
    expect(allParts(project()).length).toBeGreaterThan(0);
    expect(runCutting(project()).jobs.length).toBeGreaterThan(0);
    expect(productionParts(project()).length).toBe(allParts(project()).length);
    expect(allOperations(project()).length).toBeGreaterThan(0);
    expect(hardwareBom(project()).length).toBeGreaterThan(0);
    expect(scene().stats.parts).toBe(allParts(project()).length);
  });
});
