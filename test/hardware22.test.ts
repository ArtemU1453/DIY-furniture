/**
 * ЭТАП 22 — Библиотека фурнитуры и автоматический расчёт количества.
 * Цепочка: Hardware → Connections → HardwareInstance → Specification →
 * Machining → 3D → Documents.
 *
 * Проверяет модель позиции и комплекта, экземпляры и их стабильные id,
 * подсчёт количества из соединений, правила полкодержателей и крепежа задней
 * стенки, совместимость, замену фурнитуры и её сброс, пресеты и профили,
 * отсутствующие и архивные позиции, импорт/экспорт JSON, CSV и документы,
 * параметрический пересчёт, undo/redo и регрессию соседних модулей.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import {
  DEFAULT_HARDWARE_RULES,
  HARDWARE_LIBRARY_FORMAT,
  HARDWARE_PROFILES,
  HARDWARE_UNIT,
  SLIDE_LENGTHS,
  allHardwareInstances,
  backFixingCount,
  builtinHardwarePresets,
  checkConnectionCompatibility,
  compatibilityRules,
  connectionsOfHardware,
  documentsOfHardware,
  drawerSlideSpec,
  expandKit,
  expandedSpecification,
  exportHardwareLibrary,
  findDuplicateInstances,
  findHardware,
  hardwareCounts,
  hardwareCsv,
  hardwareExpandedCsv,
  hardwareSpecification,
  hardwareStatus,
  highlightForHardware,
  importHardwareLibrary,
  instanceId,
  instancesOfHardware,
  kitOfHardware,
  missingHardwareIds,
  operationsOfHardware,
  partsOfHardware,
  planPresetApplication,
  presetFromProject,
  profileByKind,
  profileOf,
  readHardware,
  ruleSettings,
  shelfSupportCount,
  shelfSupportsTotal,
  slideLengthFor,
  slidesTotal,
  totalHardwareUnits,
  unitsOf,
  validateHardwareCompatibility,
  validateHardwareReferences,
} from '@/engines/hardware';
import { buildDocument, hardwareListRows, hardwareListExpandedRows } from '@/engines/drawing';
import { allOperations } from '@/engines/machining';
import { deserializeProject } from '@/storage/project/serialization';
import type { Hardware, HardwareKit, Project } from '@/core/model/types';
import type { HardwareConnectionId, HardwareId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;

/** Тестовый шкаф 800×2000×600 с двумя фасадами (§90). */
function makeCabinet(doorCount = 2, shelfCount = 4): void {
  store().newProject('Тест 22');
  const res = store().createFromTemplate('tpl-cabinet', {
    width: 800, height: 2000, depth: 600, materialThickness: 16, backThickness: 3,
    shelfCount, verticalPartitionCount: 1, doorCount, doorGap: 3,
    backType: 'inset', jointType: 'confirmat', handleEnabled: true,
  });
  expect(res.ok).toBe(true);
}

const byCategory = (category: Hardware['category']): Hardware =>
  project().hardware.find((h) => h.category === category)!;

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 22 — позиции и библиотека', () => {
  beforeEach(() => makeCabinet());

  it('Тест 1/2: позиция описана и лежит в библиотеке проекта', () => {
    expect(project().hardware.length).toBeGreaterThan(0);
    for (const item of project().hardware) {
      expect(item.id).toBeTruthy();
      expect(item.name).toBeTruthy();
      expect(item.category).toBeTruthy();
    }
    // Библиотека хранится в самом проекте — отдельной несовместимой базы нет.
    const restored = deserializeProject(JSON.stringify(project()));
    expect(restored.hardware.length).toBe(project().hardware.length);
  });

  it('Тест 1/4/5: артикул и расширяемые параметры', () => {
    const hinge = byCategory('hinge');
    expect(hinge.parameters?.cupDiameter).toBe(35);
    // Параметры — свободный набор, новые ключи не требуют правки модели.
    store().updateHardware(hinge.id, { article: 'HNG-35-110', parameters: { ...hinge.parameters, openingAngle: 110 } });
    const updated = findHardware(project(), hinge.id)!;
    expect(updated.article).toBe('HNG-35-110');
    expect(updated.parameters?.openingAngle).toBe(110);
    expect(updated.parameters?.cupDiameter).toBe(35); // прежние не потерялись
  });

  it('Тест 2/8: стандартный набор покрывает базовые категории', () => {
    const categories = new Set(project().hardware.map((h) => h.category));
    for (const needed of ['confirmat', 'dowel', 'shelf-support', 'hinge', 'handle'] as const) {
      expect(categories.has(needed)).toBe(true);
    }
  });

  it('Тест 22/96: архивная позиция не ломает существующий проект', () => {
    const confirmat = byCategory('confirmat');
    const before = hardwareCounts(project()).get(String(confirmat.id));
    expect(before).toBeGreaterThan(0);

    store().archiveHardware(confirmat.id, true);
    expect(hardwareStatus(project(), confirmat.id)).toBe('ARCHIVED');
    // Узлы на месте, количество не изменилось — архив это не удаление.
    expect(hardwareCounts(project()).get(String(confirmat.id))).toBe(before);
    const issues = validateHardwareReferences(project());
    expect(issues.some((i) => i.code === 'hardware.archived')).toBe(true);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);

    store().archiveHardware(confirmat.id, false);
    expect(hardwareStatus(project(), confirmat.id)).toBe('VALID');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 22 — экземпляры и количество', () => {
  beforeEach(() => makeCabinet());

  it('Тест 5/19: экземпляр имеет стабильный id', () => {
    expect(instanceId('c1', 0)).toBe('c1#1');
    expect(instanceId('c1', 2)).toBe('c1#3');
    const instances = allHardwareInstances(project());
    expect(instances.length).toBeGreaterThan(0);
    for (const inst of instances) {
      expect(inst.id).toContain('#');
      expect(inst.connectionId).toBeTruthy();
      expect(findPart(project(), inst.partId)).toBeDefined();
    }
  });

  it('Тест 26/20: дублей экземпляров не бывает', () => {
    expect(findDuplicateInstances(allHardwareInstances(project()))).toEqual([]);
    // Повторный вызов даёт те же id — расчёт детерминирован.
    const a = allHardwareInstances(project()).map((i) => i.id);
    const b = allHardwareInstances(project()).map((i) => i.id);
    expect(a).toEqual(b);
  });

  it('Тест 10/17/22: количество считается из соединений', () => {
    const counts = hardwareCounts(project());
    for (const [hardwareId, count] of counts) {
      const expected = connectionsOfHardware(project(), hardwareId)
        .reduce((n, c) => n + unitsOf(c), 0);
      expect(count).toBe(expected);
    }
    expect(totalHardwareUnits(project())).toBe(allHardwareInstances(project()).length);
  });

  it('Тест 10/22: соединение с количеством даёт несколько единиц', () => {
    const hinge = byCategory('hinge');
    const conn = connectionsOfHardware(project(), hinge.id)[0];
    expect(conn).toBeDefined();
    expect(unitsOf(conn)).toBe(conn.quantity ?? 1);
    expect(instancesOfHardware(project(), hinge.id).length)
      .toBe(connectionsOfHardware(project(), hinge.id).reduce((n, c) => n + unitsOf(c), 0));
  });

  it('Тест 15/90: количество петель считается правилом этапа 19', () => {
    const hinge = byCategory('hinge');
    const doors = allParts(project()).filter((p) => p.role === 'facade');
    expect(doors).toHaveLength(2);
    // По соединению на фасад, в каждом — рассчитанное правилом число петель.
    const conns = connectionsOfHardware(project(), hinge.id);
    expect(conns).toHaveLength(doors.length);
    const total = hardwareCounts(project()).get(String(hinge.id))!;
    expect(total).toBe(conns.reduce((n, c) => n + unitsOf(c), 0));
    expect(total).toBeGreaterThanOrEqual(doors.length * 2);
  });

  it('Тест 31/60/61/91: смена числа фасадов пересчитывает петли', () => {
    const hinge = byCategory('hinge');
    const before = hardwareCounts(project()).get(String(hinge.id))!;

    makeCabinet(3);
    const after = hardwareCounts(project()).get(String(byCategory('hinge').id))!;
    // Третий фасад — больше петель; количество нигде не вводилось руками.
    expect(after).toBeGreaterThan(before);
    expect(allParts(project()).filter((p) => p.role === 'facade')).toHaveLength(3);
  });

  it('Тест 16/93: ручка даёт экземпляр и присадку', () => {
    const handle = byCategory('handle');
    expect(connectionsOfHardware(project(), handle.id).length).toBeGreaterThan(0);
    expect(instancesOfHardware(project(), handle.id).length).toBeGreaterThan(0);
    const ops = operationsOfHardware(project(), handle.id);
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) expect(findPart(project(), op.partId)!.role).toBe('facade');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 22 — комплекты', () => {
  beforeEach(() => makeCabinet());

  it('Тест 3/4/25/95: комплект × 10 даёт компоненты × 10', () => {
    const [a, b, c] = project().hardware;
    const kit: HardwareKit = {
      id: 'kit-minifix',
      name: 'Минификс (комплект)',
      article: 'MFX-KIT',
      components: [
        { hardwareId: a.id, quantity: 1 },
        { hardwareId: b.id, quantity: 1 },
        { hardwareId: c.id, quantity: 1 },
      ],
    };
    const expanded = expandKit(kit, 10, project().hardware);
    expect(expanded).toHaveLength(3);
    for (const component of expanded) {
      expect(component.perKit).toBe(1);
      expect(component.quantity).toBe(10); // §25
      expect(component.name).toBeTruthy();
    }
  });

  it('Тест 3: комплект с кратностью больше единицы', () => {
    const [a, b] = project().hardware;
    const kit: HardwareKit = {
      id: 'kit-x', name: 'Комплект', components: [
        { hardwareId: a.id, quantity: 2 },
        { hardwareId: b.id, quantity: 4 },
      ],
    };
    const expanded = expandKit(kit, 3, project().hardware);
    expect(expanded.map((c) => c.quantity)).toEqual([6, 12]);
  });

  it('Тест 3/4: позиция находится по комплекту', () => {
    const [a] = project().hardware;
    const kit: HardwareKit = { id: 'kit-y', name: 'Комплект', components: [{ hardwareId: a.id, quantity: 1 }] };
    const withKits: Project = { ...project(), hardwareKits: [kit] };
    expect(kitOfHardware(withKits, a.id)?.id).toBe('kit-y');
    expect(kitOfHardware(withKits, 'нет' as HardwareId)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 22 — правила количества', () => {
  beforeEach(() => makeCabinet());

  it('Тест 18/34/35/94: полкодержатели — параметр правила, не константа', () => {
    const settings = ruleSettings(project());
    expect(settings.shelfSupportsPerShelf).toBe(DEFAULT_HARDWARE_RULES.shelfSupportsPerShelf);

    const shelf = allParts(project()).find((p) => p.role === 'shelf')!;
    expect(shelfSupportCount(shelf, settings)).toBe(4);
    // Не полка полкодержателей не требует.
    const side = allParts(project()).find((p) => p.role === 'side')!;
    expect(shelfSupportCount(side, settings)).toBe(0);

    // Норму можно изменить, не трогая исходники.
    expect(shelfSupportCount(shelf, { ...settings, shelfSupportsPerShelf: 2 })).toBe(2);

    const shelves = allParts(project()).filter((p) => p.role === 'shelf');
    expect(shelfSupportsTotal(allParts(project()), settings))
      .toBe(shelves.reduce((n, p) => n + 4 * p.quantity, 0));
  });

  it('Тест 20/36: крепёж задней стенки считается по периметру', () => {
    const settings = ruleSettings(project());
    const back = allParts(project()).find((p) => p.role === 'back');
    if (back) {
      const perimeter = 2 * (back.width + back.height);
      expect(backFixingCount(back, settings)).toBe(Math.max(settings.backFixingMin, Math.ceil(perimeter / settings.backFixingSpacing)));
    }
    // Мелкая стенка всё равно получает минимум крепежа.
    const tiny = { role: 'back', width: 100, height: 100, quantity: 1 } as never;
    expect(backFixingCount(tiny, settings)).toBe(settings.backFixingMin);
    // Не задняя стенка крепежа не требует.
    const shelf = allParts(project()).find((p) => p.role === 'shelf')!;
    expect(backFixingCount(shelf, settings)).toBe(0);
  });

  it('Тест 19/37/38: направляющие — архитектура и подбор типоразмера', () => {
    const settings = ruleSettings(project());
    expect(slideLengthFor(600)).toBe(600);
    expect(slideLengthFor(580)).toBe(550);
    // Слишком мелкий корпус получает наименьший типоразмер, а не ноль.
    expect(slideLengthFor(100)).toBe(SLIDE_LENGTHS[0]);

    const spec = drawerSlideSpec(600, settings);
    expect(spec.length).toBe(600);
    expect(spec.perDrawer).toBe(2);
    expect(slidesTotal(3, settings)).toBe(6);
    // Ящиков нет — направляющих не выдумываем.
    expect(slidesTotal(0, settings)).toBe(0);
  });

  it('Тест 17: опоры используют правило параметрической модели', () => {
    // Опоры создаются генератором изделия (этап 18), отдельного правила
    // здесь не заводится — проверяем, что категория поддержана.
    expect(profileOf('leg')?.kind).toBe('CARCASS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 22 — совместимость', () => {
  beforeEach(() => makeCabinet());

  it('Тест 8/32/41/101: выход за диапазон толщины → WARNING', () => {
    const confirmat = byCategory('confirmat');
    store().updateHardware(confirmat.id, { thicknessRange: { min: 15, max: 16 } });

    // 16 мм — в диапазоне, замечаний нет.
    expect(validateHardwareCompatibility(project())
      .filter((i) => i.code.startsWith('hardware.thickness'))).toEqual([]);

    // Переводим детали на 18 мм.
    for (const part of allParts(project())) store().updatePart(part.id, { thickness: 18 });
    const issues = validateHardwareCompatibility(project());
    const thickness = issues.filter((i) => i.code === 'hardware.thicknessAbove');
    expect(thickness.length).toBeGreaterThan(0);
    // Предупреждение, а не запрет: решает человек.
    expect(thickness.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('Тест 8/32: список совместимых материалов', () => {
    const confirmat = byCategory('confirmat');
    const other = project().materials[1].id;
    store().updateHardware(confirmat.id, { compatibleMaterials: [other] });
    const issues = validateHardwareCompatibility(project());
    expect(issues.some((i) => i.code === 'hardware.materialMismatch')).toBe(true);

    // Пустой список означает «совместим с любыми» — позиции прошлых этапов
    // продолжают работать без правки.
    store().updateHardware(confirmat.id, { compatibleMaterials: [] });
    expect(validateHardwareCompatibility(project())
      .some((i) => i.code === 'hardware.materialMismatch')).toBe(false);
  });

  it('Тест 8: чашка глубже фасада — ошибка, а не предупреждение', () => {
    const hinge = byCategory('hinge');
    store().updateHardware(hinge.id, { parameters: { ...hinge.parameters, cupDepth: 20 } });
    const issues = validateHardwareCompatibility(project());
    const deep = issues.filter((i) => i.code === 'hardware.cupTooDeep');
    expect(deep.length).toBeGreaterThan(0);
    expect(deep.every((i) => i.severity === 'error')).toBe(true);
  });

  it('Тест 8: правила зарегистрированы и одно замечание не дублируется', () => {
    const ids = compatibilityRules().map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['THICKNESS', 'MATERIAL', 'CUP_DEPTH']));
    const confirmat = byCategory('confirmat');
    store().updateHardware(confirmat.id, { thicknessRange: { max: 10 } });
    const conn = connectionsOfHardware(project(), confirmat.id)[0];
    const issues = checkConnectionCompatibility(project(), conn);
    // Обе детали узла толще — сообщение одно.
    expect(issues.filter((i) => i.code === 'hardware.thicknessAbove')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 22 — замена, пресеты, профили', () => {
  beforeEach(() => makeCabinet());

  it('Тест 12/23/57/92: замена конфирмата на шкант меняет присадку', () => {
    const confirmat = byCategory('confirmat');
    const dowel = byCategory('dowel');
    const conn = connectionsOfHardware(project(), confirmat.id)[0];
    const opsBefore = allOperations(project()).filter((o) => String(o.sourceHardwareConnectionId) === String(conn.id));
    expect(opsBefore.length).toBeGreaterThan(0);

    store().setConnectionHardware(conn.id as HardwareConnectionId, dowel.id);

    const updated = project().hardwareConnections.find((c) => c.id === conn.id)!;
    expect(String(updated.hardwareId)).toBe(String(dowel.id));
    const opsAfter = allOperations(project()).filter((o) => String(o.sourceHardwareConnectionId) === String(conn.id));
    // Присадка производна от связи — она пересчиталась под другой крепёж.
    expect(opsAfter.map((o) => o.diameter).join()).not.toBe(opsBefore.map((o) => o.diameter).join());
  });

  it('Тест 24/63: сброс возвращает расчётную фурнитуру', () => {
    const confirmat = byCategory('confirmat');
    const dowel = byCategory('dowel');
    const conn = connectionsOfHardware(project(), confirmat.id)[0];

    store().setConnectionHardware(conn.id as HardwareConnectionId, dowel.id);
    expect(store().resetConnectionHardware(conn.id as HardwareConnectionId)).toBe(true);
    const restored = project().hardwareConnections.find((c) => c.id === conn.id)!;
    expect(String(restored.hardwareId)).toBe(String(confirmat.id));
    expect(restored.metadata?.hardwareOverride).toBeUndefined();

    // Сбрасывать нечего — действие честно сообщает об этом.
    expect(store().resetConnectionHardware(conn.id as HardwareConnectionId)).toBe(false);
  });

  it('Тест 6/7/64: пресеты и профили', () => {
    const presets = builtinHardwarePresets(project().hardware);
    expect(presets.length).toBeGreaterThan(0);
    expect(presets.some((p) => p.profile === 'CARCASS')).toBe(true);
    expect(presets.some((p) => p.profile === 'FACADE')).toBe(true);

    expect(HARDWARE_PROFILES).toHaveLength(3);
    expect(profileByKind('FACADE')?.categories).toEqual(expect.arrayContaining(['hinge', 'handle']));
    expect(profileOf('hinge')?.kind).toBe('FACADE');
    expect(profileOf('slide')?.kind).toBe('DRAWER');
  });

  it('Тест 23/103: пресет к выбранным деталям не трогает остальные', () => {
    const dowelPreset = builtinHardwarePresets(project().hardware).find((p) => p.id === 'hw-carcass-dowel')!;
    const confirmat = byCategory('confirmat');
    const conns = connectionsOfHardware(project(), confirmat.id);
    expect(conns.length).toBeGreaterThan(1);

    // Выбираем детали ОДНОГО узла.
    const target = conns[0];
    const selected = [target.partAId, target.partBId] as PartId[];
    const plan = planPresetApplication(project(), dowelPreset, selected);
    expect(plan.map((c) => c.connectionId)).toEqual([String(target.id)]);

    const changed = store().applyHardwarePreset(dowelPreset, selected);
    expect(changed).toBe(1);

    // Изменился ровно один узел, остальные остались на конфирмате (§66).
    const after = project().hardwareConnections.find((c) => c.id === target.id)!;
    expect(String(after.hardwareId)).toBe(String(byCategory('dowel').id));
    const untouched = conns.slice(1);
    for (const c of untouched) {
      const now = project().hardwareConnections.find((x) => x.id === c.id)!;
      expect(String(now.hardwareId)).toBe(String(confirmat.id));
    }
  });

  it('Тест 6: пресет из проекта собирает текущий состав', () => {
    const preset = presetFromProject(project(), 'my', 'Мой', 'FACADE');
    // Профиль фасадов — только петли и ручки.
    expect(Object.keys(preset.selection).sort()).toEqual(['handle', 'hinge']);
    const all = presetFromProject(project(), 'all', 'Всё');
    expect(Object.keys(all.selection).length).toBeGreaterThan(2);
  });

  it('Тест 33/34/102: undo и redo замены фурнитуры', () => {
    const confirmat = byCategory('confirmat');
    const dowel = byCategory('dowel');
    const conn = connectionsOfHardware(project(), confirmat.id)[0];

    store().setConnectionHardware(conn.id as HardwareConnectionId, dowel.id);
    expect(String(project().hardwareConnections.find((c) => c.id === conn.id)!.hardwareId)).toBe(String(dowel.id));

    store().undo();
    expect(String(project().hardwareConnections.find((c) => c.id === conn.id)!.hardwareId)).toBe(String(confirmat.id));

    store().redo();
    expect(String(project().hardwareConnections.find((c) => c.id === conn.id)!.hardwareId)).toBe(String(dowel.id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 22 — отсутствующие позиции', () => {
  beforeEach(() => makeCabinet());

  it('Тест 21/79/97: отсутствующая позиция не удаляет соединение', () => {
    const confirmat = byCategory('confirmat');
    const connCount = connectionsOfHardware(project(), confirmat.id).length;

    // Имитируем проект, в котором позиции уже нет (правка библиотеки извне).
    const broken: Project = { ...project(), hardware: project().hardware.filter((h) => h.id !== confirmat.id) };

    expect(hardwareStatus(broken, confirmat.id)).toBe('MISSING');
    expect(missingHardwareIds(broken)).toContain(String(confirmat.id));
    // Соединения на месте — конструкцию не теряем.
    expect(connectionsOfHardware(broken, confirmat.id)).toHaveLength(connCount);

    const issues = validateHardwareReferences(broken);
    expect(issues.some((i) => i.code === 'hardware.missing' && i.severity === 'error')).toBe(true);

    // В спецификации строка остаётся с понятным примечанием.
    const row = hardwareSpecification(broken).find((r) => String(r.hardwareId) === String(confirmat.id))!;
    expect(row.status).toBe('MISSING');
    expect(row.quantity).toBeGreaterThan(0);
    expect(row.note).toBeTruthy();
  });

  it('Тест 21/98: назначение замены убирает MISSING', () => {
    const confirmat = byCategory('confirmat');
    const dowel = byCategory('dowel');
    const affected = connectionsOfHardware(project(), confirmat.id).length;

    // Позиция «пропала»: заменяем её ссылку у всех узлов на существующую.
    const replaced = store().replaceMissingHardware(String(confirmat.id), dowel.id);
    expect(replaced).toBe(affected);
    expect(connectionsOfHardware(project(), confirmat.id)).toHaveLength(0);
    expect(missingHardwareIds(project())).toEqual([]);
    expect(validateHardwareReferences(project()).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 22 — импорт и экспорт', () => {
  beforeEach(() => makeCabinet());

  it('Тест 28/100: экспорт библиотеки в JSON', () => {
    const json = exportHardwareLibrary(project().hardware, []);
    const parsed = JSON.parse(json) as { format: string; hardware: Hardware[] };
    expect(parsed.format).toBe(HARDWARE_LIBRARY_FORMAT);
    expect(parsed.hardware).toHaveLength(project().hardware.length);
  });

  it('Тест 27/100: импорт восстанавливает позиции', () => {
    const json = exportHardwareLibrary(project().hardware, []);
    const result = importHardwareLibrary(json);
    expect(result.ok).toBe(true);
    expect(result.hardware).toHaveLength(project().hardware.length);
    expect(result.skipped).toBe(0);
    for (const item of result.hardware) {
      expect(item.name).toBeTruthy();
      expect(item.category).toBeTruthy();
    }
  });

  it('Тест 27/109: импорт — это данные, а не код', () => {
    // Мусор не роняет программу.
    expect(importHardwareLibrary('не json').ok).toBe(false);
    expect(importHardwareLibrary('[]').ok).toBe(false);
    expect(importHardwareLibrary('{"format":"чужой"}').ok).toBe(false);

    // Неизвестные и опасные поля отбрасываются, а не переносятся.
    const hostile = JSON.stringify({
      format: HARDWARE_LIBRARY_FORMAT,
      hardware: [{
        name: 'Крепёж', category: 'confirmat',
        parameters: { diameter: 7, evil: { nested: 1 } },
        __proto__: { polluted: true },
        onLoad: 'alert(1)',
      }],
    });
    const result = importHardwareLibrary(hostile);
    expect(result.ok).toBe(true);
    const item = result.hardware[0] as Hardware & { onLoad?: unknown };
    expect(item.name).toBe('Крепёж');
    expect(item.parameters?.diameter).toBe(7);
    expect(item.parameters?.evil).toBeUndefined(); // вложенный объект отброшен
    expect(item.onLoad).toBeUndefined();           // неизвестное поле не перенесено
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('Тест 27: непригодные записи пропускаются и считаются', () => {
    const json = JSON.stringify({
      format: HARDWARE_LIBRARY_FORMAT,
      hardware: [{ name: 'Хороший', category: 'screw' }, { category: 'screw' }, 'мусор'],
      kits: [{ name: 'Пустой комплект', components: [] }],
    });
    const result = importHardwareLibrary(json);
    expect(result.ok).toBe(true);
    expect(result.hardware).toHaveLength(1);
    expect(result.kits).toHaveLength(0);
    expect(result.skipped).toBe(3);
    // Неизвестная категория приводится к «прочему», а не роняет импорт.
    expect(readHardware({ name: 'X', category: 'выдумка' })?.category).toBe('other');
    expect(readHardware({ category: 'screw' })).toBeNull(); // без названия — бесполезна
  });

  it('Тест 27: импорт в проект не плодит дубли', () => {
    const before = project().hardware.length;
    const json = exportHardwareLibrary(project().hardware, []);
    const first = store().importHardwareLibraryJson(json);
    expect(first.ok).toBe(true);
    expect(project().hardware.length).toBe(before);

    // Повторный импорт того же файла тоже не увеличивает библиотеку.
    store().importHardwareLibraryJson(json);
    expect(project().hardware.length).toBe(before);

    // Новая позиция добавляется.
    const extended = JSON.stringify({
      format: HARDWARE_LIBRARY_FORMAT,
      hardware: [...project().hardware, { id: 'new-1', name: 'Новый крепёж', category: 'screw' }],
    });
    store().importHardwareLibraryJson(extended);
    expect(project().hardware.length).toBe(before + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Фурнитура 22 — спецификация, экспорт, интеграции', () => {
  beforeEach(() => makeCabinet());

  it('Тест 9/49/51/52: спецификация группирует по позиции', () => {
    const spec = hardwareSpecification(project());
    expect(spec.length).toBeGreaterThan(0);
    const ids = spec.map((r) => String(r.hardwareId));
    expect(new Set(ids).size).toBe(ids.length); // без дублей
    for (const row of spec) {
      expect(row.position).toBeGreaterThan(0);
      expect(row.name).toBeTruthy();
      expect(row.unit).toBe(HARDWARE_UNIT);
      expect(row.quantity).toBeGreaterThan(0);
    }
  });

  it('Тест 9/85: спецификация не хранит собственное количество', () => {
    const before = hardwareSpecification(project());
    const hinge = byCategory('hinge');
    const conn = connectionsOfHardware(project(), hinge.id)[0];
    store().removeConnection(conn.id as HardwareConnectionId);

    const after = hardwareSpecification(project());
    const beforeCount = before.find((r) => String(r.hardwareId) === String(hinge.id))!.quantity;
    const afterRow = after.find((r) => String(r.hardwareId) === String(hinge.id));
    // Количество упало вместе с соединением — оно нигде не закэшировано.
    expect(afterRow ? afterRow.quantity : 0).toBeLessThan(beforeCount);
  });

  it('Тест 25/54/55: раскрытие комплекта в спецификации', () => {
    const [a, b] = project().hardware;
    const kit: HardwareKit = {
      id: 'kit-mfx', name: 'Минификс (комплект)',
      components: [{ hardwareId: a.id, quantity: 1 }, { hardwareId: b.id, quantity: 2 }],
    };
    const withKit: Project = { ...project(), hardwareKits: [kit] };
    const expanded = expandedSpecification(withKit);
    expect(expanded.length).toBeGreaterThan(0);
    for (const row of expanded) expect(row.quantity).toBeGreaterThan(0);
  });

  it('Тест 29/71/72/99: hardware.csv соответствует соединениям', () => {
    const csv = hardwareCsv(project());
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Name,Article,Type,Quantity,Unit,Notes');
    const spec = hardwareSpecification(project());
    expect(lines.length - 1).toBe(spec.length);

    // Количество в CSV равно числу единиц из соединений.
    const total = spec.reduce((n, r) => n + r.quantity, 0);
    expect(total).toBe(totalHardwareUnits(project()));

    expect(hardwareExpandedCsv(project()).split('\n')[0]).toBe('Name,Article,Type,Quantity,Unit,Notes');
  });

  it('Тест 14/30/69/70: спецификация фурнитуры как документ', () => {
    const doc = buildDocument(project(), 'hardwareList');
    expect(doc).toBeTruthy();
    expect(doc!.type).toBe('HARDWARE_LIST');
    expect(doc!.pages.length).toBeGreaterThan(0);
    for (const page of doc!.pages) expect(page.scene.prims.length).toBeGreaterThan(0);

    const rows = hardwareListRows(project());
    expect(rows.length).toBe(hardwareSpecification(project()).length);
    for (const row of rows) {
      expect(row.index).toMatch(/^H\d{3}$/);
      expect(row.unit).toBe(HARDWARE_UNIT);
    }
    expect(hardwareListExpandedRows(project()).length).toBeGreaterThan(0);
  });

  it('Тест 11/12/86/87/88: связи фурнитуры с моделью', () => {
    const hinge = byCategory('hinge');
    const parts = partsOfHardware(project(), hinge.id);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) expect(findPart(project(), part.id)).toBeDefined();

    const conns = connectionsOfHardware(project(), hinge.id);
    expect(conns.length).toBeGreaterThan(0);
    for (const c of conns) expect(String(c.hardwareId)).toBe(String(hinge.id));

    const ops = operationsOfHardware(project(), hinge.id);
    expect(ops.length).toBeGreaterThan(0);
  });

  it('Тест 13/14/89/104: подсветка и документы позиции', () => {
    const hinge = byCategory('hinge');
    const highlight = highlightForHardware(project(), hinge.id);
    expect(highlight.partIds.length).toBeGreaterThan(0);
    expect(highlight.connectionIds.length).toBeGreaterThan(0);
    expect(highlight.operationIds.length).toBeGreaterThan(0);
    // Подсвеченные детали действительно существуют.
    for (const id of highlight.partIds) expect(findPart(project(), id as PartId)).toBeDefined();

    const docs = documentsOfHardware(project(), hinge.id);
    expect(docs).toEqual(expect.arrayContaining(['hardwareList', 'machiningList']));
  });

  it('Тест 107/108: настройки фурнитуры переживают сохранение', () => {
    const confirmat = byCategory('confirmat');
    const dowel = byCategory('dowel');
    const conn = connectionsOfHardware(project(), confirmat.id)[0];
    store().setConnectionHardware(conn.id as HardwareConnectionId, dowel.id);

    const restored = deserializeProject(JSON.stringify(project()));
    const saved = restored.hardwareConnections.find((c) => String(c.id) === String(conn.id))!;
    expect(String(saved.hardwareId)).toBe(String(dowel.id));
    expect(saved.metadata?.hardwareOverride).toBe(String(confirmat.id));

    // Проект без новых полей открывается как раньше.
    const legacy = JSON.parse(JSON.stringify(project())) as Project;
    delete legacy.hardwareKits;
    delete legacy.hardwarePresets;
    const old = deserializeProject(JSON.stringify(legacy));
    expect(hardwareSpecification(old).length).toBeGreaterThan(0);
    expect(validateHardwareReferences(old).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('Тест 35: полная регрессия — соседние модули работают', () => {
    expect(store().generateDocuments().ok).toBe(true);
    expect(project().hardwareConnections.length).toBeGreaterThan(0);
    expect(allOperations(project()).length).toBeGreaterThan(0);
    expect(allParts(project()).length).toBeGreaterThan(0);
    expect(validateHardwareReferences(project()).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
