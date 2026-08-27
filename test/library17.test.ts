/**
 * ЭТАП 17 — Библиотека материалов, фурнитуры, профилей и правил.
 * Цепочка: Library → Project → Parts → Cutting → Machining → Documents.
 *
 * Проверяет модель библиотеки, сервисы, RuleEngine, совместимость, архив,
 * дублирование, поиск и фильтры, снимок проекта и изоляцию от глобальной
 * библиотеки, Update from Library с diff, массовую замену, импорт/экспорт,
 * версию схемы и миграцию, а также интеграцию с раскроем, присадкой и
 * документами.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import {
  EdgeMaterialService,
  HardwareService,
  MaterialService,
  ManufacturingProfileService,
  SheetFormatService,
  DEFAULT_PROFILE,
  GRAIN_OPTIONS,
  LIBRARY_SCHEMA_VERSION,
  MATERIAL_CATEGORIES,
  PRESET_IDS,
  WORKSHOP_PROFILE,
  applyRules,
  buildUpdatePatches,
  categoryOfKind,
  checkHardwareConnection,
  checkMaterialPart,
  createDefaultLibrary,
  createEmptyLibrary,
  detectVersion,
  diffFromLibrary,
  edgeUsage,
  grainOfOption,
  grainOptionOf,
  hardwareUsage,
  hasLibraryUpdates,
  isApplicable,
  kindOfCategory,
  materialCategory,
  materialThicknesses,
  materialUsage,
  mergeLibrary,
  migrateLibrary,
  needsMigration,
  parseLibrary,
  planHardwareReplace,
  planMaterialReplace,
  previewRules,
  projectLibrarySnapshot,
  searchEdges,
  searchHardware,
  searchMaterials,
  serializeLibrary,
  validateCompatibility,
} from '@/engines/library';
import { isCuttingStale } from '@/engines/cutting';
import { allOperations, generateMachining } from '@/engines/machining';
import { isDocumentsOutdated, buildDocument, materialListRows } from '@/engines/drawing';
import type { Hardware, HardwareRule, Material, Project } from '@/core/model/types';
import type { LibraryModel } from '@/core/library/types';
import type { MaterialId, PartId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;
const parts = () => allParts(project());

/** Тестовый шкаф 800×2000×600, ЛДСП 16 мм, конфирмат (§67). */
function makeCabinet(): string {
  store().newProject('Тест 17');
  const res = store().createFromTemplate('tpl-cabinet', {
    width: 800, height: 2000, depth: 600, materialThickness: 16, backThickness: 3,
    shelfCount: 4, verticalPartitionCount: 1, doorCount: 2, doorGap: 3,
    backType: 'inset', jointType: 'confirmat', handleEnabled: true,
  });
  expect(res.ok).toBe(true);
  return res.id!;
}

/**
 * Свежая библиотека для каждого теста. Библиотеку держит store, поэтому
 * локальная переменная и состояние store всегда синхронны — иначе действия
 * store (updateFromLibrary) работали бы со старым снимком.
 */
let lib: LibraryModel;
const setLib = (next: LibraryModel) => {
  lib = next;
  store().setLibrary(next);
};

beforeEach(() => {
  setLib(createDefaultLibrary());
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Библиотека 17 — модель', () => {
  it('Тест 1: Material — поля модели и категория', () => {
    const materials = MaterialService.list(lib);
    expect(materials.length).toBeGreaterThan(0);
    for (const m of materials) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.thickness).toBeGreaterThan(0);
      expect(m.sheet.length).toBeGreaterThan(0);
      expect(m.sheet.width).toBeGreaterThan(0);
      expect(m.density).toBeGreaterThan(0);
      expect(MATERIAL_CATEGORIES).toContain(materialCategory(m));
      expect(m.schemaVersion).toBe(LIBRARY_SCHEMA_VERSION);
    }
    // Категория и технический kind соответствуют друг другу в обе стороны.
    expect(categoryOfKind('ldsp')).toBe('LDSP');
    expect(categoryOfKind('hdf')).toBe('HDF');
    expect(kindOfCategory('MDF')).toBe('mdf');
    expect(kindOfCategory('SOLID_WOOD')).toBe('solid');
    // Разные толщины одного материала (§4).
    const thicknesses = materialThicknesses(MaterialService.list(lib));
    expect(thicknesses).toContain(16);
    expect(thicknesses).toContain(18);
  });

  it('Тест 2: SheetFormat — несколько форматов на материал, приоритет и active', () => {
    const formats = SheetFormatService.list(lib, PRESET_IDS.ldsp16);
    expect(formats.length).toBeGreaterThanOrEqual(2);
    for (const f of formats) {
      expect(f.materialId).toBe(PRESET_IDS.ldsp16);
      expect(f.length).toBeGreaterThan(0);
      expect(f.width).toBeGreaterThan(0);
      expect(typeof f.priority).toBe('number');
      expect(typeof f.active).toBe('boolean');
    }
    // Активные отсортированы по приоритету.
    const active = SheetFormatService.listActive(lib, PRESET_IDS.ldsp16);
    expect(active.map((f) => f.priority)).toEqual([...active.map((f) => f.priority)].sort((a, b) => a - b));

    // CRUD формата.
    const created = SheetFormatService.create(lib, { materialId: PRESET_IDS.ldsp16, length: 2440, width: 1220, priority: 3, active: true });
    expect(created.ok).toBe(true);
    setLib(created.library);
    expect(SheetFormatService.list(lib, PRESET_IDS.ldsp16)).toHaveLength(formats.length + 1);

    const off = SheetFormatService.update(lib, created.value!.id, { active: false });
    setLib(off.library);
    expect(SheetFormatService.listActive(lib, PRESET_IDS.ldsp16).some((f) => f.id === created.value!.id)).toBe(false);

    setLib(SheetFormatService.remove(lib, created.value!.id).library);
    expect(SheetFormatService.list(lib, PRESET_IDS.ldsp16)).toHaveLength(formats.length);
  });

  it('Тест 3: EdgeMaterial — толщина, ширина, материал, код', () => {
    const edges = EdgeMaterialService.list(lib);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.thickness).toBeGreaterThan(0);
      expect(e.width).toBeGreaterThan(0);
      expect(e.material).toBeTruthy();
      // Производитель и код не выдуманы (§66) — их просто нет.
      expect(e.manufacturer).toBeUndefined();
      expect(e.code).toBeUndefined();
    }
    expect(edges.map((e) => e.thickness).sort()).toEqual([0.4, 1, 2]);
  });

  it('Тест 4: Hardware — категории, параметры, отсутствие выдуманных брендов', () => {
    const hardware = HardwareService.list(lib);
    expect(hardware.length).toBeGreaterThanOrEqual(5);
    for (const h of hardware) {
      expect(h.name).toBeTruthy();
      expect(h.category).toBeTruthy();
      expect(Object.keys(h.parameters ?? {}).length).toBeGreaterThan(0);
      // §66: производителей не придумываем.
      expect(h.manufacturer).toBeUndefined();
    }
    const categories = hardware.map((h) => h.category);
    for (const c of ['confirmat', 'dowel', 'minifix', 'hinge', 'handle']) {
      expect(categories).toContain(c);
    }
  });

  it('Тест 5: HardwareRule — операция, диаметр, глубина, положение, ограничения', () => {
    const confirmat = HardwareService.get(lib, PRESET_IDS.confirmat)!;
    const rules = confirmat.machiningRules!;
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.id).toBeTruthy();
      expect(r.operation).toBeTruthy();
      expect(['through', 'receiving', 'both']).toContain(r.target);
      expect(r.diameter).toBeGreaterThan(0);
      expect(r.count).toBeGreaterThan(0);
      expect(r.edgeOffset).toBeGreaterThan(0);
    }
    // Сквозное и глухое описаны по-разному.
    expect(rules.some((r) => r.through === true)).toBe(true);
    expect(rules.some((r) => r.depth != null)).toBe(true);
    // Ограничение по толщине присутствует.
    expect(rules.some((r) => r.constraints?.minThickness != null)).toBe(true);
  });

  it('Тест 6: ManufacturingProfile — все поля и профиль по умолчанию', () => {
    expect(DEFAULT_PROFILE.id).toBe('profile-default');
    for (const p of [DEFAULT_PROFILE, WORKSHOP_PROFILE]) {
      expect(p.name).toBeTruthy();
      expect(p.sawKerf).toBeGreaterThan(0);
      expect(p.trimAllowance).toBeGreaterThanOrEqual(0);
      expect(p.minimumRemnant).toBeGreaterThanOrEqual(0);
      expect(p.minHoleEdgeDistance).toBeGreaterThan(0);
      expect(p.defaultDrillDepth).toBeGreaterThan(0);
      expect(p.defaultJointType).toBeTruthy();
    }
    // Пользовательские профили доступны (§19).
    expect(ManufacturingProfileService.list(lib).map((p) => p.name)).toContain('Домашняя мастерская');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Библиотека 17 — RuleEngine и совместимость', () => {
  beforeEach(() => { makeCabinet(); });

  it('Тест 7: RuleEngine — получить, проверить, применить, валидировать', () => {
    const conn = project().hardwareConnections[0];
    const partA = findPart(project(), conn.partAId)!;
    const partB = findPart(project(), conn.partBId)!;
    const hardware: Hardware = {
      ...HardwareService.get(lib, PRESET_IDS.confirmat)!,
      id: conn.hardwareId,
    };
    const ctx = { connection: conn, hardware, partA, partB };

    // Получить + применить.
    const result = applyRules(ctx);
    expect(result.source).toBe('declarative');
    expect(result.operations.length).toBeGreaterThan(0);
    for (const op of result.operations) {
      expect(op.origin).toBe('generated');
      expect(op.sourceHardwareConnectionId).toBe(conn.id);
      expect(op.hardwareId).toBe(hardware.id);
      expect(op.diameter).toBeGreaterThan(0);
    }
    // Проверить применимость.
    expect(isApplicable(hardware.machiningRules![0], ctx).applicable).toBe(true);

    // Без собственных правил работает встроенное правило категории.
    const builtin = applyRules({ ...ctx, hardware: { ...hardware, machiningRules: undefined } });
    expect(builtin.source).toBe('builtin');
    expect(builtin.operations.length).toBeGreaterThan(0);
  });

  it('Тест 17/73: CompatibilityValidator — минимальная толщина 18 против детали 16', () => {
    const conn = project().hardwareConnections[0];
    const partA = findPart(project(), conn.partAId)!;
    const partB = findPart(project(), conn.partBId)!;
    expect(partA.thickness).toBe(16);

    const strictRule: HardwareRule = {
      id: 'strict', operation: 'confirmat', target: 'through',
      diameter: 7, through: true, count: 2, edgeOffset: 32,
      constraints: { minThickness: 18 },
    };
    const strict: Hardware = {
      id: conn.hardwareId, name: 'Крепёж для 18 мм', category: 'confirmat',
      parameters: {}, machiningRules: [strictRule],
    };

    const check = isApplicable(strictRule, { connection: conn, hardware: strict, partA, partB });
    expect(check.applicable).toBe(false);
    expect(check.reasons[0]).toContain('18');

    const issues = checkHardwareConnection(conn, strict, partA, partB);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe('compat.hardware.rule');

    // Неприменимое правило не порождает операций.
    expect(applyRules({ connection: conn, hardware: strict, partA, partB }).operations).toHaveLength(0);
  });

  it('Тест 17b: CompatibilityValidator — корректный проект без ошибок', () => {
    const report = validateCompatibility(project());
    expect(report.errors).toBe(0);
    expect(report.ok).toBe(true);
  });

  it('Тест 17c: CompatibilityValidator — несовпадение толщины и слишком толстая кромка', () => {
    const part = parts()[0];
    const material = project().materials.find((m) => m.id === part.material)!;
    // Толщина детали разошлась с материалом.
    const mismatched = { ...part, thickness: 25 };
    const issues = checkMaterialPart(mismatched, material);
    expect(issues.some((i) => i.code === 'compat.part.thickness')).toBe(true);

    // Кромка толще детали.
    const thickEdge = project().edges.find((e) => e.thickness === 2)!;
    store().updatePart(part.id, { edges: { ...part.edges, top: thickEdge.id } });
    store().updatePart(part.id, { thickness: 1 });
    const report = validateCompatibility(project());
    expect(report.issues.some((i) => i.code === 'compat.edge.tooThick')).toBe(true);
  });

  it('Тест 43: предпросмотр правил — «2 × DRILL Ø7»', () => {
    const confirmat = HardwareService.get(lib, PRESET_IDS.confirmat)!;
    const preview = previewRules(confirmat);
    expect(preview.length).toBe(confirmat.machiningRules!.length);
    expect(preview[0].label).toMatch(/^\d+ × [A-Z]+ Ø[\d.]+/);
    expect(preview.some((r) => r.label.includes('THRU'))).toBe(true);

    const handle = HardwareService.get(lib, PRESET_IDS.handle)!;
    expect(previewRules(handle)[0].label).toContain('DRILL');

    // Крепёж без своих правил — предпросмотр пуст, работает правило категории.
    expect(previewRules({ ...handle, machiningRules: undefined })).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Библиотека 17 — сервисы, архив, поиск', () => {
  it('Тест 8: MaterialService — create/update/get/list/duplicate', () => {
    const before = MaterialService.list(lib).length;
    const created = MaterialService.create(lib, {
      name: 'ЛДСП тест 22', kind: 'ldsp', category: 'LDSP', thickness: 22,
      sheet: { length: 2750, width: 1830 }, grain: 'none', allowRotate: true, color: '#fff',
    });
    expect(created.ok).toBe(true);
    setLib(created.library);
    expect(MaterialService.list(lib)).toHaveLength(before + 1);

    const id = created.value!.id;
    setLib(MaterialService.update(lib, id, { name: 'ЛДСП тест 22 (обновлён)' }).library);
    expect(MaterialService.get(lib, id)!.name).toBe('ЛДСП тест 22 (обновлён)');
    // Ревизия растёт — по ней проект узнаёт об обновлении.
    expect(MaterialService.entry(lib, id)!.revision).toBe(2);

    // id менять нельзя — на него ссылаются проекты.
    setLib(MaterialService.update(lib, id, { id: 'подмена' } as Partial<Material>).library);
    expect(MaterialService.get(lib, id)).toBeDefined();

    // Удаление неиспользуемой пользовательской записи разрешено.
    const removed = MaterialService.remove(lib, id, 0);
    expect(removed.ok).toBe(true);
    setLib(removed.library);
    expect(MaterialService.get(lib, id)).toBeUndefined();
  });

  it('Тест 9/10/11: Hardware, Edge и Profile сервисы', () => {
    const hw = HardwareService.create(lib, {
      name: 'Конфирмат 7×70', category: 'confirmat', parameters: { diameter: 7, length: 70 },
    });
    expect(hw.ok).toBe(true);
    setLib(hw.library);
    expect(HardwareService.get(lib, hw.value!.id)!.parameters!.length).toBe(70);

    const edge = EdgeMaterialService.create(lib, { name: 'Кромка ПВХ 2', thickness: 2, color: '#eee', material: 'PVC' });
    expect(edge.ok).toBe(true);
    setLib(edge.library);
    expect(EdgeMaterialService.get(lib, edge.value!.id)!.material).toBe('PVC');

    const profile = ManufacturingProfileService.create(lib, {
      name: 'Мебельный цех', sawKerf: 4, trimAllowance: 15, minimumRemnant: 200,
      minHoleEdgeDistance: 9, defaultDrillDepth: 14, defaultJointType: 'MINIFIX',
    });
    expect(profile.ok).toBe(true);
    setLib(profile.library);
    expect(ManufacturingProfileService.list(lib).map((p) => p.name)).toContain('Мебельный цех');
  });

  it('Тест 12/13/51: архив вместо удаления используемой и встроенной записи', () => {
    makeCabinet();
    // Материал проекта используется деталями.
    const projectMaterial = project().materials[0];
    const usage = materialUsage(project(), String(projectMaterial.id));
    expect(usage.usedCount).toBeGreaterThan(0);

    // Удаление используемой записи запрещено и предлагает архив.
    const denied = MaterialService.remove(lib, PRESET_IDS.ldsp16, usage.usedCount);
    expect(denied.ok).toBe(false);
    expect(denied.suggestArchive).toBe(true);
    expect(denied.message).toContain('Архивируйте');

    // Встроенную запись тоже нельзя удалить — только архивировать.
    const builtin = MaterialService.remove(lib, PRESET_IDS.ldsp16, 0);
    expect(builtin.ok).toBe(false);
    expect(builtin.suggestArchive).toBe(true);

    // Архивирование работает.
    setLib(MaterialService.setArchived(lib, PRESET_IDS.ldsp16, true).library);
    expect(MaterialService.get(lib, PRESET_IDS.ldsp16)!.archived).toBe(true);
    setLib(HardwareService.setArchived(lib, PRESET_IDS.confirmat, true).library);
    expect(HardwareService.get(lib, PRESET_IDS.confirmat)!.archived).toBe(true);
  });

  it('Тест 70: архивная позиция не предлагается, старый проект работает', () => {
    makeCabinet();
    const opsBefore = allOperations(project()).length;

    setLib(MaterialService.setArchived(lib, PRESET_IDS.ldsp16, true).library);
    // Активный список её больше не содержит…
    expect(MaterialService.listActive(lib).map((m) => m.id)).not.toContain(PRESET_IDS.ldsp16);
    expect(MaterialService.listArchived(lib).map((m) => m.id)).toContain(PRESET_IDS.ldsp16);
    // …и поиск по умолчанию тоже.
    expect(searchMaterials(MaterialService.list(lib)).map((m) => m.id)).not.toContain(PRESET_IDS.ldsp16);
    expect(searchMaterials(MaterialService.list(lib), { includeArchived: true }).map((m) => m.id))
      .toContain(PRESET_IDS.ldsp16);

    // Старый проект не изменился: у него свои копии материалов.
    expect(parts().length).toBeGreaterThan(0);
    expect(allOperations(project())).toHaveLength(opsBefore);
    expect(validateCompatibility(project()).errors).toBe(0);
  });

  it('Тест 14/31: Duplicate — копия с новым id и именем', () => {
    const source = MaterialService.get(lib, PRESET_IDS.ldsp16)!;
    const dup = MaterialService.duplicate(lib, PRESET_IDS.ldsp16);
    expect(dup.ok).toBe(true);
    setLib(dup.library);

    const copy = dup.value!;
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe(`${source.name} (копия)`);
    expect(copy.thickness).toBe(source.thickness);
    // Копия встроенной записи — пользовательская: её можно удалить.
    expect(MaterialService.entry(lib, copy.id)!.builtin).toBe(false);
    expect(MaterialService.remove(lib, copy.id, 0).ok).toBe(true);

    // Переименование при копировании (§31: «ЛДСП белый» → «ЛДСП дуб»).
    const oak = MaterialService.duplicate(lib, PRESET_IDS.ldsp16, 'ЛДСП дуб 16');
    setLib(oak.library);
    expect(oak.value!.name).toBe('ЛДСП дуб 16');

    // Повторная копия не конфликтует по имени.
    const second = MaterialService.duplicate(lib, PRESET_IDS.ldsp16);
    expect(second.value!.name).toBe(`${source.name} (копия 2)`);
  });

  it('Тест 15: поиск по имени, категории, коду и производителю', () => {
    const materials = MaterialService.list(lib);
    expect(searchMaterials(materials, { query: 'ЛДСП' }).length).toBeGreaterThan(0);
    expect(searchMaterials(materials, { query: 'ldsp' }).length).toBeGreaterThan(0);
    expect(searchMaterials(materials, { query: 'МДФ' }).every((m) => materialCategory(m) === 'MDF')).toBe(true);
    expect(searchMaterials(materials, { query: 'нет-такого' })).toHaveLength(0);

    const hardware = HardwareService.list(lib);
    expect(searchHardware(hardware, { query: 'конфирмат' }).length).toBeGreaterThan(0);
    expect(searchHardware(hardware, { query: 'петля' }).length).toBeGreaterThan(0);

    // Поиск по артикулу и производителю.
    const withArticle = HardwareService.create(lib, {
      name: 'Крепёж особый', category: 'other', article: 'ART-777', manufacturer: 'Мой цех', parameters: {},
    });
    setLib(withArticle.library);
    expect(searchHardware(HardwareService.list(lib), { query: 'ART-777' })).toHaveLength(1);
    expect(searchHardware(HardwareService.list(lib), { query: 'мой цех' })).toHaveLength(1);

    expect(searchEdges(EdgeMaterialService.list(lib), { query: 'ABS' }).length).toBeGreaterThan(0);
  });

  it('Тест 16: фильтры — категория, толщина, текстура, активные', () => {
    const materials = MaterialService.list(lib);
    expect(searchMaterials(materials, { category: 'MDF' }).every((m) => materialCategory(m) === 'MDF')).toBe(true);
    expect(searchMaterials(materials, { thickness: 18 }).every((m) => m.thickness === 18)).toBe(true);
    expect(searchMaterials(materials, { grain: 'NONE' }).every((m) => grainOptionOf(m.grain) === 'NONE')).toBe(true);

    // Комбинация фильтров.
    const combo = searchMaterials(materials, { category: 'LDSP', thickness: 16 });
    expect(combo.length).toBe(1);
    expect(combo[0].id).toBe(PRESET_IDS.ldsp16);

    // Текстура: три варианта и обратимое преобразование (§7).
    expect(GRAIN_OPTIONS).toEqual(['NONE', 'HORIZONTAL', 'VERTICAL']);
    for (const o of GRAIN_OPTIONS) expect(grainOptionOf(grainOfOption(o))).toBe(o);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Библиотека 17 — проект, снимок, замена', () => {
  beforeEach(() => { makeCabinet(); });

  it('Тест 18: материал из библиотеки попадает в проект копией со ссылкой', () => {
    const before = project().materials.length;
    const id = store().addMaterialFromLibrary(PRESET_IDS.mdf18);
    expect(id).toBeTruthy();
    expect(project().materials).toHaveLength(before + 1);

    const added = project().materials.find((m) => m.id === id)!;
    // Это КОПИЯ: свой id, но ссылка на библиотеку сохранена (§60).
    expect(String(added.id)).not.toBe(PRESET_IDS.mdf18);
    expect(added.libraryRef?.libraryId).toBe(PRESET_IDS.mdf18);
    expect(added.libraryRef?.revision).toBe(1);
    expect(added.thickness).toBe(18);
  });

  it('Тест 19: фурнитура и кромка из библиотеки, профиль применяется', () => {
    const hwId = store().addHardwareFromLibrary(PRESET_IDS.dowel);
    expect(hwId).toBeTruthy();
    const hw = project().hardware.find((h) => h.id === hwId)!;
    expect(hw.category).toBe('dowel');
    expect(hw.machiningRules?.length).toBeGreaterThan(0);
    expect(hw.libraryRef?.libraryId).toBe(PRESET_IDS.dowel);

    const edgeId = store().addEdgeFromLibrary(PRESET_IDS.edge2);
    expect(project().edges.find((e) => e.id === edgeId)!.thickness).toBe(2);

    expect(store().applyProfileFromLibrary(PRESET_IDS.profileWorkshop)).toBe(true);
    expect(project().machining.profile!.name).toBe('Домашняя мастерская');
    expect(project().machining.profile!.sawKerf).toBe(2);
  });

  it('Тест 22/59: снимок библиотеки проекта — проекция собственных данных', () => {
    store().addMaterialFromLibrary(PRESET_IDS.mdf16);
    const snapshot = projectLibrarySnapshot(project());
    expect(snapshot.materials.length).toBe(project().materials.length);
    expect(snapshot.hardware.length).toBe(project().hardware.length);
    expect(snapshot.profile).toBeDefined();
    // У добавленного из библиотеки есть ссылка, у созданного шаблоном — нет.
    expect(snapshot.materials.some((m) => m.libraryId === PRESET_IDS.mdf16)).toBe(true);
  });

  it('Тест 23/61/68: изменение библиотеки НЕ меняет сохранённый проект', () => {
    const materialId = store().addMaterialFromLibrary(PRESET_IDS.ldsp16)!;
    // Назначим материал детали и сформируем документацию.
    const part = parts()[0];
    store().updatePart(part.id, { material: materialId as MaterialId });
    store().generateDocuments();

    const nameBefore = project().materials.find((m) => m.id === materialId)!.name;
    const thicknessBefore = project().materials.find((m) => m.id === materialId)!.thickness;
    const docsOutdatedBefore = isDocumentsOutdated(project());

    // «ЛДСП белый 16» → «ЛДСП дуб 16» в ГЛОБАЛЬНОЙ библиотеке.
    setLib(MaterialService.update(lib, PRESET_IDS.ldsp16, { name: 'ЛДСП дуб 16', thickness: 18 }).library);
    expect(MaterialService.get(lib, PRESET_IDS.ldsp16)!.name).toBe('ЛДСП дуб 16');

    // Проект не изменился ничем: ни именем, ни толщиной, ни статусом документов.
    const after = project().materials.find((m) => m.id === materialId)!;
    expect(after.name).toBe(nameBefore);
    expect(after.thickness).toBe(thicknessBefore);
    expect(isDocumentsOutdated(project())).toBe(docsOutdatedBefore);
  });

  it('Тест 21/62/63/69: Update from Library — diff и применение', () => {
    const materialId = store().addMaterialFromLibrary(PRESET_IDS.ldsp16)!;
    expect(hasLibraryUpdates(project(), lib)).toBe(false);

    setLib(MaterialService.update(lib, PRESET_IDS.ldsp16, { name: 'ЛДСП дуб 16', thickness: 18 }).library);

    // Diff показывает, что именно изменится (§63).
    const diffs = diffFromLibrary(project(), lib);
    expect(diffs).toHaveLength(1);
    const d = diffs[0];
    expect(d.section).toBe('materials');
    expect(d.fromRevision).toBe(1);
    expect(d.toRevision).toBe(2);
    expect(d.affectsProduction).toBe(true);
    const nameDiff = d.fields.find((f) => f.field === 'name')!;
    expect(nameDiff.before).toContain('ЛДСП');
    expect(nameDiff.after).toBe('ЛДСП дуб 16');
    expect(d.fields.find((f) => f.field === 'thickness')).toEqual(
      expect.objectContaining({ before: '16', after: '18' }),
    );

    // Патчи сохраняют id объекта проекта — ссылки деталей не рвутся.
    const patches = buildUpdatePatches(project(), lib);
    expect(patches).toHaveLength(1);
    expect(String(patches[0].value.id)).toBe(String(materialId));

    // Применение.
    expect(store().updateFromLibrary()).toBe(1);
    const updated = project().materials.find((m) => m.id === materialId)!;
    expect(updated.name).toBe('ЛДСП дуб 16');
    expect(updated.thickness).toBe(18);
    expect(updated.libraryRef!.revision).toBe(2);
    // Повторно обновлять нечего.
    expect(hasLibraryUpdates(project(), lib)).toBe(false);
  });

  it('Тест 20/71: массовая замена материала только в нужных деталях', () => {
    const white = store().addMaterialFromLibrary(PRESET_IDS.ldsp16)! as MaterialId;
    const oak = store().addMaterialFromLibrary(PRESET_IDS.ldsp18)! as MaterialId;

    // 10 деталей: 5 на «белом», 5 на другом материале.
    const ids: PartId[] = [];
    for (let i = 0; i < 10; i++) {
      const id = store().addPart({ name: `Щит ${i + 1}`, width: 600, height: 400, thickness: 16 });
      store().updatePart(id, { material: i < 5 ? white : oak });
      ids.push(id);
    }

    const plan = planMaterialReplace(project(), String(white), String(oak));
    expect(plan!.partIds.length).toBe(5);
    expect(plan!.thicknessChanges).toBe(true);
    expect(plan!.fromThickness).toBe(16);
    expect(plan!.toThickness).toBe(18);

    expect(store().replaceMaterial(String(white), String(oak))).toBe(5);

    // Заменены ровно первые пять; толщина подтянулась, габариты не тронуты.
    for (let i = 0; i < 10; i++) {
      const p = findPart(project(), ids[i])!;
      expect(p.material).toBe(oak);
      expect(p.width).toBe(600);
      expect(p.height).toBe(400);
      if (i < 5) expect(p.thickness).toBe(18);
    }
    expect(materialUsage(project(), String(white)).usedCount).toBe(0);
  });

  it('Тест 20b/48: массовая замена фурнитуры', () => {
    const conn = project().hardwareConnections[0];
    const fromId = String(conn.hardwareId);
    const toId = store().addHardwareFromLibrary(PRESET_IDS.dowel)!;

    const usedBefore = hardwareUsage(project(), fromId).usedCount;
    expect(usedBefore).toBeGreaterThan(0);

    const plan = planHardwareReplace(project(), fromId, String(toId));
    expect(plan!.connectionIds.length).toBe(usedBefore);
    expect(plan!.categoryChanges).toBe(true);

    expect(store().replaceHardware(fromId, String(toId))).toBe(usedBefore);
    expect(hardwareUsage(project(), fromId).usedCount).toBe(0);
    expect(hardwareUsage(project(), String(toId)).usedCount).toBe(usedBefore);

    // Присадка пересчиталась под новый крепёж.
    expect(generateMachining(project()).some((o) => String(o.hardwareId) === String(toId))).toBe(true);
  });

  it('Тест 49/50: показ использования материала и фурнитуры', () => {
    const material = project().materials[0];
    const usage = materialUsage(project(), String(material.id));
    expect(usage.usedCount).toBeGreaterThan(0);
    expect(usage.references[0]).toMatch(/^P\d+/);

    const conn = project().hardwareConnections[0];
    const hwUsage = hardwareUsage(project(), String(conn.hardwareId));
    expect(hwUsage.usedCount).toBeGreaterThan(0);
    expect(hwUsage.references[0]).toMatch(/^C\d{3}$/);

    const edge = project().edges[0];
    expect(edgeUsage(project(), String(edge.id)).usedCount).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Библиотека 17 — экспорт, импорт, версия, миграция', () => {
  it('Тест 24: экспорт JSON — схема и все разделы', () => {
    const json = serializeLibrary(lib);
    const parsed = JSON.parse(json) as LibraryModel;
    expect(parsed.schemaVersion).toBe(LIBRARY_SCHEMA_VERSION);
    expect(parsed.materials.length).toBe(lib.materials.length);
    expect(parsed.hardware.length).toBe(lib.hardware.length);
    expect(parsed.profiles.length).toBe(lib.profiles.length);
    expect(parsed.sheetFormats.length).toBe(lib.sheetFormats.length);
  });

  it('Тест 25/74: импорт JSON восстанавливает удалённый материал', () => {
    // Экспортируем, затем удаляем пользовательский материал.
    const created = MaterialService.create(lib, {
      name: 'Материал для восстановления', kind: 'mdf', category: 'MDF', thickness: 19,
      sheet: { length: 2800, width: 2070 }, grain: 'none', allowRotate: true, color: '#abc',
    });
    setLib(created.library);
    const json = serializeLibrary(lib);
    const id = created.value!.id;

    setLib(MaterialService.remove(lib, id, 0).library);
    expect(MaterialService.get(lib, id)).toBeUndefined();

    const result = parseLibrary(json);
    expect(result.ok).toBe(true);
    expect(result.counts.materials).toBe(created.library.materials.length);
    setLib(mergeLibrary(lib, result.library));
    expect(MaterialService.get(lib, id)).toBeDefined();
    expect(MaterialService.get(lib, id)!.thickness).toBe(19);
  });

  it('Тест 25b/56/78: импорт защищён от повреждённых данных', () => {
    // Не JSON.
    const broken = parseLibrary('это не json {{{');
    expect(broken.ok).toBe(false);
    expect(broken.issues[0].code).toBe('lib.json');

    // Корень не объект.
    expect(parseLibrary('[1,2,3]').ok).toBe(false);

    // Отсутствуют обязательные поля — запись отбрасывается, файл не падает.
    const partial = parseLibrary(JSON.stringify({
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      materials: [
        { id: 'ok', name: 'Хороший', kind: 'ldsp', thickness: 16, sheet: { length: 2750, width: 1830 }, color: '#fff', grain: 'none' },
        { name: 'Без id', thickness: 16 },
        { id: 'bad', name: 'Без толщины', kind: 'ldsp', sheet: { length: 2750, width: 1830 } },
      ],
    }));
    expect(partial.ok).toBe(true);
    expect(partial.counts.materials).toBe(1);
    expect(partial.issues.filter((i) => i.severity === 'error').length).toBe(2);

    // Неизвестный enum не роняет импорт — заменяется с предупреждением.
    const unknownEnum = parseLibrary(JSON.stringify({
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      materials: [{ id: 'x', name: 'Странный', kind: 'титан', thickness: 16, sheet: { length: 2750, width: 1830 }, color: '#fff' }],
      hardware: [{ id: 'h', name: 'Странный крепёж', category: 'телепорт' }],
    }));
    expect(unknownEnum.ok).toBe(true);
    expect(unknownEnum.library.materials[0].value.kind).toBe('other');
    expect(unknownEnum.library.hardware[0].value.category).toBe('other');
    expect(unknownEnum.issues.filter((i) => i.severity === 'warning').length).toBe(2);

    // Версия новее поддерживаемой отклоняется целиком.
    const future = parseLibrary(JSON.stringify({ schemaVersion: 99, materials: [] }));
    expect(future.ok).toBe(false);
    expect(future.issues[0].code).toBe('lib.version');

    // Пустой набор — тоже не ok, но приложение не падает.
    expect(parseLibrary(JSON.stringify({ schemaVersion: 2 })).ok).toBe(false);
  });

  it('Тест 26: schemaVersion присутствует у материала, фурнитуры и профиля', () => {
    expect(LIBRARY_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
    expect(MaterialService.list(lib).every((m) => m.schemaVersion === LIBRARY_SCHEMA_VERSION)).toBe(true);
    expect(HardwareService.list(lib).every((h) => h.schemaVersion === LIBRARY_SCHEMA_VERSION)).toBe(true);
    expect(ManufacturingProfileService.list(lib).every((p) => p.schemaVersion === LIBRARY_SCHEMA_VERSION)).toBe(true);
    expect(EdgeMaterialService.list(lib).every((e) => e.schemaVersion === LIBRARY_SCHEMA_VERSION)).toBe(true);
  });

  it('Тест 27/75: миграция JSON старой версии', () => {
    // v1: без версии, без обёртки LibraryEntry, без категорий и форматов.
    const v1 = {
      materials: [
        { id: 'old-1', name: 'Старый ЛДСП', kind: 'ldsp', thickness: 16, sheet: { length: 2750, width: 1830 }, grain: 'none', color: '#ddd' },
      ],
      hardware: [],
      edges: [],
      profiles: [],
    };
    expect(detectVersion(v1)).toBe(1);
    expect(needsMigration(v1)).toBe(true);

    const migrated = migrateLibrary(v1);
    expect(migrated.fromVersion).toBe(1);
    expect(migrated.toVersion).toBe(LIBRARY_SCHEMA_VERSION);
    expect(migrated.steps.length).toBeGreaterThan(0);

    // Импорт старого файла проходит и достраивает категорию.
    const result = parseLibrary(JSON.stringify(v1));
    expect(result.ok).toBe(true);
    expect(result.migration?.fromVersion).toBe(1);
    const material = result.library.materials[0].value;
    expect(material.category).toBe('LDSP');
    expect(material.schemaVersion).toBe(LIBRARY_SCHEMA_VERSION);
    expect(material.name).toBe('Старый ЛДСП');

    // Текущая версия миграции не требует.
    expect(needsMigration({ schemaVersion: LIBRARY_SCHEMA_VERSION })).toBe(false);
  });

  it('Тест 56b: импорт сливается с библиотекой и не затирает её', () => {
    const before = MaterialService.list(lib).length;
    const incoming = parseLibrary(JSON.stringify({
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      materials: [{ id: 'brand-new', name: 'Новый из файла', kind: 'mdf', thickness: 10, sheet: { length: 2800, width: 2070 }, color: '#fff', grain: 'none' }],
    }));
    expect(incoming.ok).toBe(true);
    const merged = mergeLibrary(lib, incoming.library);
    // Старые записи на месте, новая добавилась.
    expect(merged.materials.length).toBe(before + 1);
    expect(merged.materials.some((e) => e.value.id === PRESET_IDS.ldsp16)).toBe(true);
    expect(merged.materials.some((e) => e.value.id === 'brand-new')).toBe(true);
    // Пустая библиотека сливается без потерь.
    expect(mergeLibrary(createEmptyLibrary(), lib).materials.length).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Библиотека 17 — интеграция с раскроем, присадкой и документами', () => {
  beforeEach(() => { makeCabinet(); });

  it('Тест 28/29/46: смена материала делает раскрой DIRTY и присадку актуальной', async () => {
    await store().recalculateCutting();
    store().generateDocuments();
    expect(isCuttingStale(project())).toBe(false);
    expect(isDocumentsOutdated(project())).toBe(false);

    const thick = store().addMaterialFromLibrary(PRESET_IDS.ldsp18)! as MaterialId;
    const part = parts()[0];
    const widthBefore = part.width;
    store().updatePart(part.id, { material: thick, thickness: 18 });

    // Габариты детали не поменялись сами по себе (§46).
    expect(findPart(project(), part.id)!.width).toBe(widthBefore);
    // Раскрой и документы устарели (§29).
    expect(isCuttingStale(project())).toBe(true);
    expect(isDocumentsOutdated(project())).toBe(true);

    await store().recalculateCutting();
    store().generateDocuments();
    expect(isCuttingStale(project())).toBe(false);
    expect(isDocumentsOutdated(project())).toBe(false);
  });

  it('Тест 30/72: фурнитура из библиотеки порождает присадку через HardwareRule', () => {
    const conn = project().hardwareConnections[0];
    const dowelId = store().addHardwareFromLibrary(PRESET_IDS.dowel)!;
    store().replaceHardware(String(conn.hardwareId), String(dowelId), [String(conn.id)]);

    const ops = generateMachining(project()).filter((o) => o.sourceHardwareConnectionId === conn.id);
    expect(ops.length).toBeGreaterThan(0);
    // Правила шканта: Ø8 в обеих деталях.
    expect(ops.every((o) => o.diameter === 8)).toBe(true);
    expect(ops.every((o) => o.type === 'dowel')).toBe(true);
    expect(new Set(ops.map((o) => String(o.partId))).size).toBe(2);
    // Все операции ссылаются на фурнитуру.
    expect(ops.every((o) => String(o.hardwareId) === String(dowelId))).toBe(true);
  });

  it('Тест 30b: ведомость материалов и документы видят библиотечные данные', () => {
    const mdfId = store().addMaterialFromLibrary(PRESET_IDS.mdf18)! as MaterialId;
    const id = store().addPart({ name: 'Полка МДФ', width: 700, height: 300, thickness: 18 });
    store().updatePart(id, { material: mdfId });

    const rows = materialListRows(project());
    const mdfRow = rows.find((r) => r.material.includes('МДФ'))!;
    expect(mdfRow).toBeDefined();
    expect(mdfRow.thickness).toBe(18);
    expect(mdfRow.partCount).toBeGreaterThan(0);

    // Документ строится без ошибок.
    const doc = buildDocument(project(), 'materialList');
    expect(doc.pages.length).toBeGreaterThan(0);
  });

  it('Тест 31/67: полный проект шкафа на данных библиотеки', async () => {
    // Материал, кромка, фурнитура и профиль — всё из библиотеки.
    const materialId = store().addMaterialFromLibrary(PRESET_IDS.ldsp16)! as MaterialId;
    const edgeId = store().addEdgeFromLibrary(PRESET_IDS.edge2)!;
    store().applyProfileFromLibrary(PRESET_IDS.profileDefault);

    /* Материал 16 мм назначаем только деталям этой толщины: задняя стенка
     * тоньше, и назначить ей 16 мм означало бы реальную несовместимость,
     * которую валидатор справедливо поймает. */
    for (const p of parts().filter((x) => x.thickness === 16)) {
      store().updatePart(p.id, {
        material: materialId,
        edges: { ...p.edges, top: edgeId, bottom: edgeId },
      });
    }

    // Совместимость в порядке.
    expect(validateCompatibility(project()).errors).toBe(0);

    // Раскрой считается, присадка есть, документы формируются.
    await store().recalculateCutting();
    expect(project().cutting.report).toBeDefined();
    expect(allOperations(project()).length).toBeGreaterThan(0);
    const gen = store().generateDocuments();
    expect(gen.ok).toBe(true);

    // Снимок проекта содержит ссылки на библиотеку.
    const snapshot = projectLibrarySnapshot(project());
    expect(snapshot.materials.some((m) => m.libraryId === PRESET_IDS.ldsp16)).toBe(true);
    expect(snapshot.edges.some((e) => e.libraryId === PRESET_IDS.edge2)).toBe(true);
    expect(snapshot.profile!.name).toBe('Базовый профиль');
  });
});
