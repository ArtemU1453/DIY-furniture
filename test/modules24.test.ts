/**
 * ЭТАП 24 — Параметрические мебельные модули.
 * Цепочка: параметры модуля → геометрия → детали → соединения → фурнитура →
 * кромка → присадка → раскрой → 3D → чертежи → спецификация.
 *
 * Проверяет модель модуля и его размещение, шаблоны и библиотеку, генерацию с
 * атомарностью, полки, фасады, ящики и заднюю стенку, связь параметров и её
 * разрыв, зеркало, поворот, перемещение с привязкой, выравнивание, группы,
 * видимость и блокировку, множественный выбор и групповую правку, интеграции
 * с остальными разделами, undo/redo и регрессию.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findFurniture } from '@/core/model/selectors';
import {
  GRID_STEPS,
  IDENTITY_TRANSFORM,
  MODULE_LIBRARY_FORMAT,
  MODULE_SCHEMA_VERSION,
  MODULE_TEMPLATES,
  alignModules,
  applyToAll,
  breakLink,
  buildDependencyGraph,
  commonValue,
  createGroup,
  createModule,
  createParametricModel,
  distributeModules,
  dirtyModules,
  exportModule,
  exportModuleLibrary,
  findModuleTemplate,
  flattenModules,
  footprint,
  fromLibraryEntry,
  generateModule,
  groupBounds,
  groupOfModule,
  hasParametricModel,
  highlightForModule,
  importModuleLibrary,
  invalidateModule,
  invalidatedSections,
  isLocked,
  isVisible,
  linkStatus,
  markDirty,
  migrateModule,
  mirrorModule,
  mirrorPart,
  moduleDocuments,
  moduleFromTemplate,
  moduleOfPart,
  moduleScope,
  moduleSummary,
  moveGroup,
  moveModule,
  readParametricModel,
  refreshStatuses,
  resetLink,
  resolveLinkedParameters,
  rotateGroup,
  rotateModule,
  snapToGrid,
  snapToModules,
  statusOfModule,
  templateOfModule,
  toLibraryEntry,
  transformOf,
  translateModule,
} from '@/engines/parametric';
import { allEdgeBanding } from '@/engines/edges';
import { allOperations } from '@/engines/machining';
import { runCutting } from '@/engines/cutting';
import { buildDocument } from '@/engines/drawing';
import { deserializeProject } from '@/storage/project/serialization';
import type { Furniture, Part, Project } from '@/core/model/types';
import type { ParametricModel } from '@/core/parametric/types';
import type { FurnitureId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;
const furniture = (id: FurnitureId): Furniture => findFurniture(project(), id)!;
const modelOf = (id: FurnitureId): ParametricModel => readParametricModel(furniture(id));

/** Модуль-шкаф 800×2000×600 из §123. */
function makeCabinet(): FurnitureId {
  store().newProject('Тест 24');
  const id = store().createParametricFurniture('param-cabinet');
  expect(id).toBeTruthy();
  return id!;
}

const partsOf = (id: FurnitureId): Part[] => furniture(id).assemblies.flatMap((a) => a.parts);
const roleCount = (id: FurnitureId, role: Part['role']) => partsOf(id).filter((p) => p.role === role).length;

// ─────────────────────────────────────────────────────────────────────────────
describe('Модули 24 — модель и шаблоны', () => {
  it('Тест 1: модуль описан и имеет размещение по умолчанию', () => {
    const module = createModule({ name: 'Шкаф' });
    expect(module.id).toBeTruthy();
    expect(module.name).toBe('Шкаф');
    expect(module.parameters.width).toBeGreaterThan(0);
    expect(module.schemaVersion).toBe(MODULE_SCHEMA_VERSION);
    expect(transformOf(module)).toEqual(IDENTITY_TRANSFORM);
    expect(isVisible(module)).toBe(true);
    expect(isLocked(module)).toBe(false);
  });

  it('Тест 1/11/12: видимость и блокировка', () => {
    const hidden = createModule({ visible: false });
    expect(isVisible(hidden)).toBe(false);
    const locked = createModule({ locked: true });
    expect(isLocked(locked)).toBe(true);
    // Модуль прошлых этапов без полей считается видимым и незаблокированным.
    const legacy = { ...createModule(), visible: undefined, locked: undefined };
    expect(isVisible(legacy)).toBe(true);
    expect(isLocked(legacy)).toBe(false);
  });

  it('Тест 1: смещение прошлых этапов остаётся действительным', () => {
    // Модуль этапа 18 хранил offset — он должен продолжать работать.
    const legacy = { ...createModule(), transform: undefined, offset: { x: 100, y: 0, z: 50 } };
    expect(transformOf(legacy).position).toEqual({ x: 100, y: 0, z: 50 });
  });

  it('Тест 2/4/33: шесть шаблонов модулей', () => {
    expect(MODULE_TEMPLATES).toHaveLength(6);
    const names = MODULE_TEMPLATES.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['Нижний шкаф', 'Верхний шкаф', 'Пенал', 'Тумба', 'Стеллаж', 'Комод']));
    for (const t of MODULE_TEMPLATES) {
      expect(t.description).toBeTruthy();
      expect(t.defaults.width).toBeGreaterThan(0);
    }
    expect(findModuleTemplate('mod-tall')?.type).toBe('TALL_CABINET');
    expect(findModuleTemplate('нет')).toBeUndefined();
  });

  it('Тест 4/33: шаблон — определение, а не копия проекта', () => {
    const template = findModuleTemplate('mod-base')!;
    const a = moduleFromTemplate(template);
    const b = moduleFromTemplate(template, 'Второй');

    expect(a.id).not.toBe(b.id);
    expect(b.name).toBe('Второй');
    expect(templateOfModule(a)?.id).toBe('mod-base');

    // §110: правка модуля не портит шаблон и не задевает другой модуль.
    a.parameters.width = 1234;
    expect(template.defaults.width).not.toBe(1234);
    expect(b.parameters.width).not.toBe(1234);
  });

  it('Тест 3/7: копия модуля получает новые идентификаторы', () => {
    const root = createModule({ name: 'Шкаф', children: [createModule({ name: 'Полка' })] });
    const flat = flattenModules(root);
    expect(flat).toHaveLength(2);
    const ids = new Set(flat.map((m) => m.id));
    expect(ids.size).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Модули 24 — параметры, связи, зависимости', () => {
  it('Тест 13/15: переменные модуля доступны выражениям', () => {
    const model = createParametricModel({ width: 800, height: 2000, depth: 600, thickness: 16 });
    const scope = moduleScope(model);
    expect(scope.width).toBe(800);
    expect(scope.height).toBe(2000);
    expect(scope.thickness).toBe(16);
    expect(scope.backThickness).toBe(model.backPanel.thickness);
    expect(scope.frontGap).toBe(model.doors.gaps.betweenGap);
  });

  it('Тест 15/23/24/145: выражение считается существующим парсером', () => {
    const model = createParametricModel({
      width: 800, height: 2000,
      parameters: [
        { id: 'shelfOffset', name: 'Отступ', type: 'NUMBER', value: 100 },
        { id: 'shelfPos', name: 'Позиция полки', type: 'NUMBER', value: 0, expression: 'height - shelfOffset' },
      ],
    });
    const resolved = resolveLinkedParameters(model);
    const pos = resolved.find((r) => r.parameter.id === 'shelfPos')!;
    expect(pos.value).toBe(1900);
    expect(pos.status).toBe('LINKED');

    // §146: изменение высоты меняет вычисленное значение.
    const taller = { ...model, height: 2200 };
    expect(resolveLinkedParameters(taller).find((r) => r.parameter.id === 'shelfPos')!.value).toBe(2100);
  });

  it('Тест 15: ошибка выражения не роняет расчёт', () => {
    const model = createParametricModel({
      parameters: [{ id: 'bad', name: 'Плохой', type: 'NUMBER', value: 42, expression: 'нет_такой_переменной + 1' }],
    });
    const resolved = resolveLinkedParameters(model)[0];
    expect(resolved.error).toBeTruthy();
    expect(resolved.value).toBe(42); // прежнее значение сохранено
  });

  it('Тест 14/147: круговая зависимость обнаруживается', () => {
    const model = createParametricModel({
      parameters: [
        { id: 'a', name: 'A', type: 'NUMBER', value: 0, expression: 'b + 1' },
        { id: 'b', name: 'B', type: 'NUMBER', value: 0, expression: 'a + 1' },
      ],
    });
    const graph = buildDependencyGraph(model.parameters, ['width', 'height', 'depth', 'thickness']);
    expect(graph.cycle).toBeTruthy();
  });

  it('Тест 17/18/19/79/148/149: разрыв и восстановление связи', () => {
    const linked = { id: 'p', name: 'P', type: 'NUMBER' as const, value: 100, expression: 'height - 100' };
    expect(linkStatus(linked)).toBe('LINKED');

    const broken = breakLink(linked, 1900);
    expect(linkStatus(broken)).toBe('MANUAL');
    expect(broken.value).toBe(1900);
    // §80: выражение сохранено, иначе связь было бы нечем восстанавливать.
    expect(broken.expression).toBe('height - 100');

    const restored = resetLink(broken);
    expect(linkStatus(restored)).toBe('LINKED');
    expect(restored.overridden).toBeUndefined();

    // Параметр без выражения всегда ручной.
    const manual = { id: 'm', name: 'M', type: 'NUMBER' as const, value: 5 };
    expect(linkStatus(manual)).toBe('MANUAL');
    expect(breakLink(manual)).toEqual(manual);
  });

  it('Тест 36/37/156: общий параметр выбранных модулей', () => {
    const a = createParametricModel({ width: 800 });
    const b = createParametricModel({ width: 800 });
    const c = createParametricModel({ width: 600 });

    expect(commonValue([a, b], 'width')).toBe(800);
    // Разные значения — общего нет; показывать одно из них было бы неверно.
    expect(commonValue([a, c], 'width')).toBeNull();
    expect(commonValue([], 'width')).toBeNull();

    const res = applyToAll([a, b, c], 'width', 900);
    expect(res.applied).toBe(3);
    expect(res.skipped).toBe(0);
    expect(res.models.every((m) => m.width === 900)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Модули 24 — генерация и атомарность', () => {
  it('Тест 3/16: успешная генерация даёт детали и статус VALID', () => {
    const module = createModule({ parameters: createParametricModel({ width: 800, height: 2000, depth: 600 }) });
    const outcome = generateModule(module);
    expect(outcome.ok).toBe(true);
    expect(outcome.partCount).toBeGreaterThan(0);
    expect(outcome.module.status).toBe('VALID');
    expect(outcome.module.parts.length).toBe(outcome.partCount);
    expect(outcome.errors).toEqual([]);
  });

  it('Тест 16/33: ошибка генерации сохраняет прежний модуль', () => {
    const good = generateModule(createModule({ parameters: createParametricModel({ width: 800 }) })).module;
    // Недопустимая ширина: модель не собирается.
    const broken = createModule({ parameters: createParametricModel({ width: -100 }) });

    const outcome = generateModule(broken, good);
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.length).toBeGreaterThan(0);
    // §16: прежний корректный модуль остался, его детали не потеряны.
    expect(outcome.module.parts).toEqual(good.parts);
    expect(outcome.module.status).toBe('ERROR');
  });

  it('Тест 32/66/67: DIRTY после правки, VALID после генерации', () => {
    const module = createModule({ parameters: createParametricModel({ width: 800 }) });
    expect(statusOfModule(module)).toBe('VALID');

    const dirty = markDirty(module);
    expect(dirty.status).toBe('DIRTY');
    expect(statusOfModule(dirty)).toBe('DIRTY');

    expect(generateModule(dirty).module.status).toBe('VALID');
  });

  it('Тест 32/68: правка модуля помечает зависимые разделы', () => {
    const module = markDirty(createModule());
    const sections = invalidatedSections(module);
    expect(sections).toEqual(expect.arrayContaining(['parts', 'hardware', 'edge', 'machining', 'cutting', 'documents']));
    expect(invalidatedSections(createModule())).toEqual([]);
  });

  it('Тест 32/154/155: изменение модуля не задевает соседние', () => {
    const target = createModule({ name: 'Цель' });
    const sibling = createModule({ name: 'Сосед' });
    const root = createModule({ name: 'Проект', children: [target, sibling] });

    const next = invalidateModule(root, target.id);
    const flat = flattenModules(next);
    expect(flat.find((m) => m.id === target.id)!.status).toBe('DIRTY');
    // §155: соседний модуль остался нетронутым.
    expect(flat.find((m) => m.id === sibling.id)!.status).toBe('VALID');
    expect(dirtyModules(next).map((m) => m.id)).toEqual([target.id]);
  });

  it('Тест 32: пересчёт статусов не трогает параметры', () => {
    const root = createModule({ children: [createModule({ parameters: createParametricModel({ width: 700 }) })] });
    const refreshed = refreshStatuses(root);
    expect(refreshed.children[0].parameters.width).toBe(700);
    expect(refreshed.children[0].status).toBe('VALID');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Модули 24 — трансформации', () => {
  it('Тест 10/87: перемещение и сдвиг', () => {
    const module = createModule();
    const moved = moveModule(module, { x: 500, y: 100 });
    expect(transformOf(moved).position).toEqual({ x: 500, y: 100, z: 0 });
    expect(transformOf(translateModule(moved, 100, 0, 50)).position).toEqual({ x: 600, y: 100, z: 50 });
  });

  it('Тест 9/85/86: поворот меняет только размещение', () => {
    const module = createModule({ parameters: createParametricModel({ width: 800, depth: 600 }) });
    const rotated = rotateModule(module, 90);
    expect(transformOf(rotated).rotation).toBe(90);
    // §86: локальные размеры деталей не меняются, меняется габарит в плане.
    expect(rotated.parameters.width).toBe(800);
    expect(footprint(module)).toEqual({ width: 800, depth: 600 });
    expect(footprint(rotated)).toEqual({ width: 600, depth: 800 });
    expect(footprint(rotateModule(module, 180))).toEqual({ width: 800, depth: 600 });
  });

  it('Тест 8/83: зеркало отражает модуль и вложенные', () => {
    const child = createModule({ name: 'Полка' });
    const root = createModule({ name: 'Шкаф', children: [child] });
    const mirrored = mirrorModule(root);
    expect(transformOf(mirrored).mirrored).toBe(true);
    expect(transformOf(mirrored.children[0]).mirrored).toBe(true);
    // Повторное отражение возвращает исходное состояние.
    expect(transformOf(mirrorModule(mirrored)).mirrored).toBe(false);
  });

  it('Тест 8/84/142: зеркало переносит кромку и присадку', () => {
    const id = makeCabinet();
    const edgeId = project().edges[0].id;
    const part = partsOf(id)[0];
    store().setPartEdge(part.id, 'left', edgeId);
    store().addManualOperation({ partId: part.id, face: 'front', x: 100, y: 50, diameter: 8, depth: 10 });

    const source = furniture(id).assemblies[0].parts.find((p) => p.id === part.id)!;
    const flipped = mirrorPart(source);

    // §84: кромка переехала на противоположную сторону …
    expect(flipped.edges.right).toBe(edgeId);
    expect(flipped.edges.left).toBeNull();
    // … и отверстие отсчитывается от другого края.
    expect(flipped.machining[0].x).toBe(source.width - source.machining[0].x);
    // Исходная деталь не изменилась.
    expect(source.edges.left).toBe(edgeId);
  });

  it('Тест 12/98: заблокированный модуль не двигается', () => {
    const locked = createModule({ locked: true });
    expect(transformOf(moveModule(locked, { x: 999 })).position.x).toBe(0);
    expect(transformOf(rotateModule(locked, 90)).rotation).toBe(0);
    expect(transformOf(mirrorModule(locked)).mirrored).toBe(false);
  });

  it('Тест 10/88/89/90: привязка к сетке и соседним модулям', () => {
    expect(GRID_STEPS).toEqual([1, 5, 10, 50]);
    expect(snapToGrid(507, 50)).toBe(500);
    expect(snapToGrid(507, 10)).toBe(510);
    expect(snapToGrid(507, 0)).toBe(507); // выключенная сетка не трогает значение

    const neighbour = moveModule(createModule({ parameters: createParametricModel({ width: 800 }) }), { x: 0 });
    // Правый край соседа — 800; значение рядом притягивается к нему.
    expect(snapToModules(795, [neighbour])).toEqual({ value: 800, snapped: true });
    // Далёкое значение остаётся как есть.
    expect(snapToModules(400, [neighbour])).toEqual({ value: 400, snapped: false });
  });

  it('Тест 10/91: выравнивание', () => {
    const a = moveModule(createModule({ parameters: createParametricModel({ width: 600 }) }), { x: 0 });
    const b = moveModule(createModule({ parameters: createParametricModel({ width: 400 }) }), { x: 900 });

    const left = alignModules([a, b], 'LEFT');
    expect(left.map((m) => transformOf(m).position.x)).toEqual([0, 0]);

    const right = alignModules([a, b], 'RIGHT');
    // Правый край общий: 1300 − собственная ширина.
    expect(right.map((m) => transformOf(m).position.x)).toEqual([700, 900]);

    // Один модуль выравнивать не с чем.
    expect(alignModules([a], 'LEFT')).toEqual([a]);
  });

  it('Тест 10/92: распределение оставляет крайние на месте', () => {
    const mk = (x: number) => moveModule(createModule({ parameters: createParametricModel({ width: 100 }) }), { x });
    const modules = [mk(0), mk(50), mk(1000)];
    const spread = distributeModules(modules);
    expect(transformOf(spread[0]).position.x).toBe(0);
    expect(transformOf(spread[2]).position.x).toBe(1000);
    // Средний сдвинулся между ними.
    expect(transformOf(spread[1]).position.x).toBeGreaterThan(0);
    expect(transformOf(spread[1]).position.x).toBeLessThan(1000);
    // Меньше трёх распределять нечего.
    expect(distributeModules([mk(0), mk(100)])).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Модули 24 — группы', () => {
  it('Тест 6: группа объединяет модули без дублей', () => {
    const a = createModule();
    const b = createModule();
    const group = createGroup([a.id, b.id, a.id], 'Кухня');
    expect(group.moduleIds).toHaveLength(2);
    expect(group.name).toBe('Кухня');
    expect(groupOfModule([group], a.id)?.id).toBe(group.id);
    expect(groupOfModule([group], 'нет')).toBeUndefined();
  });

  it('Тест 6/95: перемещение группы не меняет параметры модулей', () => {
    const a = moveModule(createModule({ parameters: createParametricModel({ width: 600 }) }), { x: 0 });
    const b = moveModule(createModule({ parameters: createParametricModel({ width: 800 }) }), { x: 600 });
    const moved = moveGroup([a, b], 300);

    expect(transformOf(moved[0]).position.x).toBe(300);
    expect(transformOf(moved[1]).position.x).toBe(900);
    // §95: локальные параметры не тронуты, взаимное расположение сохранено.
    expect(moved[0].parameters.width).toBe(600);
    expect(moved[1].parameters.width).toBe(800);
    expect(transformOf(moved[1]).position.x - transformOf(moved[0]).position.x).toBe(600);
  });

  it('Тест 6: габарит группы и поворот вокруг центра', () => {
    const a = moveModule(createModule({ parameters: createParametricModel({ width: 600, height: 800 }) }), { x: 0, y: 0 });
    const b = moveModule(createModule({ parameters: createParametricModel({ width: 400, height: 800 }) }), { x: 600, y: 0 });
    const bounds = groupBounds([a, b]);
    expect(bounds.x).toBe(0);
    expect(bounds.width).toBe(1000);

    const rotated = rotateGroup([a, b], 90);
    expect(transformOf(rotated[0]).rotation).toBe(90);
    // Модули поворачиваются и переезжают, но параметры не меняются.
    expect(rotated[0].parameters.width).toBe(600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Модули 24 — библиотека и обмен', () => {
  it('Тест 5/28/150: сохранение модуля в библиотеку', () => {
    const module = createModule({ name: 'Мой шкаф', parameters: createParametricModel({ width: 900 }) });
    const entry = toLibraryEntry(module, 'Шкаф 900');
    expect(entry.name).toBe('Шкаф 900');
    expect(entry.module.parameters.width).toBe(900);
    expect(entry.schemaVersion).toBe(MODULE_SCHEMA_VERSION);

    // Копия: правка модуля не меняет запись библиотеки.
    module.parameters.width = 1200;
    expect(entry.module.parameters.width).toBe(900);
  });

  it('Тест 5/29/151: загрузка из библиотеки даёт новый модуль', () => {
    const module = createModule({ name: 'Шкаф', children: [createModule({ name: 'Полка' })] });
    const entry = toLibraryEntry(module);
    const loaded = fromLibraryEntry(entry, 'Копия');

    expect(loaded.name).toBe('Копия');
    // §82: идентификаторы новые, иначе копия делила бы детали с оригиналом.
    expect(loaded.id).not.toBe(module.id);
    expect(loaded.children[0].id).not.toBe(module.children[0].id);
    expect(loaded.children).toHaveLength(1);
  });

  it('Тест 31/32/152/153: экспорт и импорт JSON', () => {
    const module = createModule({ name: 'Пенал', parameters: createParametricModel({ width: 600, height: 2100 }) });
    const json = exportModule(module);
    const parsed = JSON.parse(json) as { format: string; modules: unknown[] };
    expect(parsed.format).toBe(MODULE_LIBRARY_FORMAT);
    expect(parsed.modules).toHaveLength(1);

    const back = importModuleLibrary(json);
    expect(back.ok).toBe(true);
    expect(back.entries).toHaveLength(1);
    expect(back.entries[0].module.parameters.width).toBe(600);
    expect(back.entries[0].module.parameters.height).toBe(2100);
    expect(back.skipped).toBe(0);
  });

  it('Тест 31: импорт мусора не роняет программу', () => {
    expect(importModuleLibrary('не json').ok).toBe(false);
    expect(importModuleLibrary('[]').ok).toBe(false);
    expect(importModuleLibrary('{"format":"чужой"}').ok).toBe(false);

    const partial = importModuleLibrary(JSON.stringify({
      format: MODULE_LIBRARY_FORMAT,
      modules: [{ name: 'Хороший', parameters: { width: 700 } }, { parameters: {} }, 'мусор'],
    }));
    expect(partial.ok).toBe(true);
    expect(partial.entries).toHaveLength(1);
    expect(partial.entries[0].module.parameters.width).toBe(700);
    expect(partial.skipped).toBe(2);
  });

  it('Тест 5: миграция проставляет версию схемы', () => {
    const old = { ...createModule({ name: 'Старый' }), schemaVersion: 0 };
    const migrated = migrateModule(old, 0);
    expect(migrated.schemaVersion).toBe(MODULE_SCHEMA_VERSION);
    // Актуальная версия не пересоздаётся.
    const current = createModule();
    expect(migrateModule(current, MODULE_SCHEMA_VERSION)).toBe(current);
  });

  it('Тест 32: экспорт библиотеки из нескольких записей', () => {
    const entries = [toLibraryEntry(createModule({ name: 'A' })), toLibraryEntry(createModule({ name: 'B' }))];
    const parsed = JSON.parse(exportModuleLibrary(entries)) as { modules: unknown[] };
    expect(parsed.modules).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Модули 24 — генерация конструкции', () => {
  let cabinet: FurnitureId;
  beforeEach(() => { cabinet = makeCabinet(); });

  it('Тест 20/123: корпус шкафа 800×2000×600', () => {
    const model = modelOf(cabinet);
    expect(model.width).toBe(800);
    expect(model.height).toBe(2000);
    expect(model.depth).toBe(600);
    expect(roleCount(cabinet, 'side')).toBe(2);
    expect(roleCount(cabinet, 'top')).toBeGreaterThan(0);
    expect(roleCount(cabinet, 'bottom')).toBeGreaterThan(0);
  });

  it('Тест 20/124: изменение ширины обновляет корпус и фасады', () => {
    const before = partsOf(cabinet).map((p) => `${p.role}:${p.width}`).join('|');
    const res = store().applyParametricModel(cabinet, { ...modelOf(cabinet), width: 1000 });
    expect(res.ok).toBe(true);
    expect(modelOf(cabinet).width).toBe(1000);
    expect(partsOf(cabinet).map((p) => `${p.role}:${p.width}`).join('|')).not.toBe(before);
  });

  it('Тест 20/126/127: полки добавляются и удаляются', () => {
    store().applyParametricModel(cabinet, {
      ...modelOf(cabinet), shelves: { ...modelOf(cabinet).shelves, count: 3 },
    });
    const three = roleCount(cabinet, 'shelf');
    expect(three).toBeGreaterThan(0);

    store().applyParametricModel(cabinet, {
      ...modelOf(cabinet), shelves: { ...modelOf(cabinet).shelves, count: 2 },
    });
    expect(roleCount(cabinet, 'shelf')).toBeLessThan(three);
  });

  it('Тест 21/128/129: фасады создаются и пересчитываются', () => {
    store().applyParametricModel(cabinet, { ...modelOf(cabinet), doors: { ...modelOf(cabinet).doors, count: 2 } });
    const two = partsOf(cabinet).filter((p) => p.role === 'facade');
    expect(two).toHaveLength(2);
    const widthOfTwo = two[0].width;

    store().applyParametricModel(cabinet, { ...modelOf(cabinet), doors: { ...modelOf(cabinet).doors, count: 3 } });
    const three = partsOf(cabinet).filter((p) => p.role === 'facade');
    expect(three).toHaveLength(3);
    // §32: ширина фасада считается автоматически и уменьшилась.
    expect(three[0].width).toBeLessThan(widthOfTwo);
  });

  it('Тест 21/132: зазор фасадов влияет на их ширину', () => {
    const base = { ...modelOf(cabinet), doors: { ...modelOf(cabinet).doors, count: 2 } };
    store().applyParametricModel(cabinet, base);
    const narrow = partsOf(cabinet).find((p) => p.role === 'facade')!.width;

    store().applyParametricModel(cabinet, {
      ...base, doors: { ...base.doors, gaps: { ...base.doors.gaps, betweenGap: 20 } },
    });
    const wider = partsOf(cabinet).find((p) => p.role === 'facade')!.width;
    expect(wider).toBeLessThan(narrow);
  });

  it('Тест 22/130/131: ящики', () => {
    store().applyParametricModel(cabinet, { ...modelOf(cabinet), drawers: { ...modelOf(cabinet).drawers, count: 2 } });
    expect(modelOf(cabinet).drawers.count).toBe(2);
    store().applyParametricModel(cabinet, { ...modelOf(cabinet), drawers: { ...modelOf(cabinet).drawers, count: 3 } });
    expect(modelOf(cabinet).drawers.count).toBe(3);
  });

  it('Тест 23/133: задняя стенка и её толщина', () => {
    const model = modelOf(cabinet);
    store().applyParametricModel(cabinet, {
      ...model, backPanel: { ...model.backPanel, type: 'INSET', thickness: 6 },
    });
    const back = partsOf(cabinet).find((p) => p.role === 'back');
    expect(modelOf(cabinet).backPanel.thickness).toBe(6);
    if (back) expect(back.thickness).toBe(6);

    // Без задней стенки деталь исчезает.
    store().applyParametricModel(cabinet, {
      ...modelOf(cabinet), backPanel: { ...modelOf(cabinet).backPanel, type: 'NONE' },
    });
    expect(partsOf(cabinet).some((p) => p.role === 'back')).toBe(false);
  });

  it('Тест 20/125: изменение высоты пересчитывает зависимые детали', () => {
    const sideBefore = partsOf(cabinet).find((p) => p.role === 'side')!.height;
    store().applyParametricModel(cabinet, { ...modelOf(cabinet), height: 2200 });
    const sideAfter = partsOf(cabinet).find((p) => p.role === 'side')!.height;
    expect(sideAfter).toBeGreaterThan(sideBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Модули 24 — интеграции и проект', () => {
  let cabinet: FurnitureId;
  beforeEach(() => { cabinet = makeCabinet(); });

  it('Тест 7/141: дублирование даёт новые идентификаторы', () => {
    const copyId = store().duplicateFurniture(cabinet, 'Копия');
    expect(copyId).toBeTruthy();
    expect(copyId).not.toBe(cabinet);

    const original = partsOf(cabinet).map((p) => String(p.id));
    const copy = partsOf(copyId!).map((p) => String(p.id));
    expect(copy).toHaveLength(original.length);
    // §82: ни один идентификатор не совпадает.
    expect(copy.some((id) => original.includes(id))).toBe(false);
  });

  it('Тест 8/142: отражение изделия переносит кромку и присадку', () => {
    const edgeId = project().edges[0].id;
    const part = partsOf(cabinet)[0];
    store().setPartEdge(part.id, 'left', edgeId);
    expect(store().mirrorFurniture(cabinet)).toBe(true);
    const after = partsOf(cabinet).find((p) => p.id === part.id)!;
    expect(after.edges.right).toBe(edgeId);
    expect(furniture(cabinet).metadata?.mirrored).toBe(true);
  });

  it('Тест 9/10/12: поворот, перемещение, блокировка изделия', () => {
    expect(store().rotateFurniture(cabinet, 90)).toBe(true);
    expect(furniture(cabinet).rotation.y).toBe(90);
    // §86: размеры деталей не изменились.
    expect(partsOf(cabinet).find((p) => p.role === 'side')!.height).toBeGreaterThan(0);

    expect(store().moveFurniture(cabinet, { x: 507 }, 50)).toBe(true);
    expect(furniture(cabinet).position.x).toBe(500); // привязка к сетке 50

    store().setFurnitureLocked(cabinet, true);
    expect(store().moveFurniture(cabinet, { x: 1000 })).toBe(false);
    expect(furniture(cabinet).position.x).toBe(500);
    expect(store().rotateFurniture(cabinet, 180)).toBe(false);
  });

  it('Тест 11: видимость изделия', () => {
    store().setFurnitureVisible(cabinet, false);
    expect(furniture(cabinet).metadata?.hidden).toBe(true);
    store().setFurnitureVisible(cabinet, true);
    expect(furniture(cabinet).metadata?.hidden).toBe(false);
  });

  it('Тест 35/36/37/156: групповая правка нескольких модулей', () => {
    const second = store().createParametricFurniture('param-cabinet')!;
    const res = store().applyToModules([cabinet, second], 'width', 900);
    expect(res.applied).toBe(2);
    expect(res.skipped).toBe(0);
    expect(modelOf(cabinet).width).toBe(900);
    expect(modelOf(second).width).toBe(900);

    // §119: изделие без параметрической модели пропускается.
    store().addFurniture('Без модели');
    const plain = project().furnitures[project().furnitures.length - 1].id;
    const mixed = store().applyToModules([cabinet, plain], 'width', 1000);
    expect(mixed.applied).toBe(1);
    expect(mixed.skipped).toBe(1);
  });

  it('Тест 35/154: несколько модулей независимы', () => {
    const others = [1, 2].map(() => store().createParametricFurniture('param-cabinet')!);
    const before = others.map((id) => modelOf(id).width);

    store().applyParametricModel(cabinet, { ...modelOf(cabinet), width: 1200 });
    expect(modelOf(cabinet).width).toBe(1200);
    // §155: соседние модули не изменились.
    expect(others.map((id) => modelOf(id).width)).toEqual(before);
  });

  it('Тест 19/24/25/26/58/59: связи модуля с деталями и разделами', () => {
    const module = createModule({
      name: 'Шкаф',
      parts: partsOf(cabinet).map((p) => (p.metadata?.key as string) ?? String(p.id)),
    });
    const parts = highlightForModule(project(), module);
    expect(parts.length).toBeGreaterThan(0);

    const summary = moduleSummary(project(), module);
    expect(summary.partCount).toBeGreaterThan(0);
    expect(summary.operationCount).toBeGreaterThan(0);
    expect(summary.areaM2).toBeGreaterThan(0);

    // §58: по детали находится её модуль.
    const part = partsOf(cabinet)[0];
    expect(moduleOfPart([module], part)?.id).toBe(module.id);

    expect(moduleDocuments(project(), module)).toEqual(expect.arrayContaining(['partsList', 'parts']));
  });

  it('Тест 25/26/27/135/136/137: кромка, фурнитура, присадка пересчитываются', () => {
    const edgeId = project().edges[0].id;
    for (const p of partsOf(cabinet)) store().setPartEdge(p.id, 'top', edgeId);
    const bandedBefore = allEdgeBanding(project()).length;
    const edgeLengthBefore = allEdgeBanding(project()).reduce((s, b) => s + b.length, 0);
    const opsBefore = allOperations(project()).length;
    const connBefore = project().hardwareConnections.length;

    // §135/§136: новые полки добавляют присадку и соединения.
    store().applyParametricModel(cabinet, {
      ...modelOf(cabinet), shelves: { ...modelOf(cabinet).shelves, count: 6 },
    });
    expect(allOperations(project()).length).toBeGreaterThan(opsBefore);
    expect(project().hardwareConnections.length).toBeGreaterThan(connBefore);
    // Назначенная вручную кромка переживает перегенерацию (детали найдены по ключу).
    expect(allEdgeBanding(project()).length).toBe(bandedBefore);

    // §137: кромка выводится из размеров деталей — ширина модуля меняет её длину.
    store().applyParametricModel(cabinet, { ...modelOf(cabinet), width: 1200 });
    const edgeLengthAfter = allEdgeBanding(project()).reduce((s, b) => s + b.length, 0);
    expect(edgeLengthAfter).toBeGreaterThan(edgeLengthBefore);
  });

  it('Тест 27/134: раскрой пересчитывается после правки модуля', () => {
    const before = runCutting(project()).jobs
      .reduce((n, j) => n + j.statistics.pieceCount, 0);
    store().applyParametricModel(cabinet, {
      ...modelOf(cabinet), shelves: { ...modelOf(cabinet).shelves, count: 8 },
    });
    const after = runCutting(project()).jobs
      .reduce((n, j) => n + j.statistics.pieceCount, 0);
    expect(after).toBeGreaterThan(before);
  });

  it('Тест 29/30/139/140: документы строятся по модулю', () => {
    expect(store().generateDocuments().ok).toBe(true);
    for (const key of ['partsList', 'parts', 'machiningList'] as const) {
      const doc = buildDocument(project(), key);
      expect(doc).toBeTruthy();
      expect(doc!.pages.length).toBeGreaterThan(0);
    }
  });

  it('Тест 38/39/157: undo и redo правки модуля', () => {
    const before = modelOf(cabinet).width;
    store().applyParametricModel(cabinet, { ...modelOf(cabinet), width: 1100 });
    expect(modelOf(cabinet).width).toBe(1100);

    store().undo();
    expect(modelOf(cabinet).width).toBe(before);

    store().redo();
    expect(modelOf(cabinet).width).toBe(1100);
  });

  it('Тест 40: старый проект открывается, модель сохраняется', () => {
    store().applyParametricModel(cabinet, { ...modelOf(cabinet), width: 950 });
    const restored = deserializeProject(JSON.stringify(project()));
    const saved = restored.furnitures.find((f) => f.id === cabinet)!;
    expect(hasParametricModel(saved)).toBe(true);
    expect(readParametricModel(saved).width).toBe(950);
    expect(allParts(restored).length).toBeGreaterThan(0);
  });

  it('Тест 40/158: полная регрессия по цепочке', () => {
    expect(allParts(project()).length).toBeGreaterThan(0);
    expect(project().materials.length).toBeGreaterThan(0);
    expect(project().hardware.length).toBeGreaterThan(0);
    expect(project().hardwareConnections.length).toBeGreaterThan(0);
    expect(allEdgeBanding(project()).length).toBeGreaterThanOrEqual(0);
    expect(allOperations(project()).length).toBeGreaterThan(0);
    expect(runCutting(project()).jobs.length).toBeGreaterThan(0);
    expect(store().generateDocuments().ok).toBe(true);
  });
});
