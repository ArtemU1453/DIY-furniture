/**
 * ЭТАП 12 — Библиотека типовых конструкций и параметрический конструктор.
 * Шаблон порождает обычный ProjectModel (без параллельной модели деталей).
 * Проверяет FormulaEngine, шаблоны, генераторы, распространение параметров,
 * соединения/присадку, инвалидацию раскроя/документов, отвязку, пользовательские
 * шаблоны, undo/redo, валидацию геометрии.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import {
  BUILTIN_TEMPLATES,
  findTemplate,
  defaultValues,
  evaluateFormula,
  detectCircular,
  validateFormulas,
  validateTemplateValues,
  validateTemplateGeometry,
  instantiateTemplate,
  loadCustomTemplates,
  removeCustomTemplate,
} from '@/engines/templates';
import type { CabinetParameters } from '@/engines/furniture/cabinet';
import { fromCabinetParameters, generateParts } from '@/engines/parametric';
import { cabinetConnectionContext, planConnections } from '@/engines/connections';

/* Детали строит тот же единый генератор, что и приложение (этап 35). */
const build = (params: CabinetParameters) => generateParts(fromCabinetParameters(params), []);
import { isCuttingStale } from '@/engines/cutting';
import { generateMachining as genM } from '@/engines/machining';
import { isDocumentsOutdated } from '@/engines/drawing';
import type { Part } from '@/core/model/types';

const store = () => useEditorStore.getState();
const project = () => store().project;
const partsOf = (id: string) => allParts(project()).filter((p) => {
  const f = project().furnitures.find((fu) => fu.id === id);
  return f?.assemblies.some((a) => a.parts.some((pp) => pp.id === p.id));
});
const mats = () => ({ body: project().materials[0].id, back: project().materials[0].id, front: project().materials[0].id });

describe('Шаблоны 12 — модель и формулы', () => {
  beforeEach(() => store().newProject('Тест'));

  it('Тест 1: FurnitureTemplate — каталог с параметрами и генератором', () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(7);
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.generator).toBeTruthy();
      expect(t.parameters.length).toBeGreaterThan(0);
    }
  });

  it('Тест 2: TemplateParameter — поля параметра', () => {
    const cab = findTemplate('tpl-cabinet')!;
    for (const p of cab.parameters) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(['NUMBER', 'BOOLEAN', 'ENUM', 'STRING']).toContain(p.type);
      expect(typeof p.required).toBe('boolean');
    }
  });

  it('Тест 3: FormulaEngine вычисляет выражения безопасно', () => {
    expect(evaluateFormula('width - 2 * thickness', { width: 800, thickness: 16 })).toBe(768);
    expect(evaluateFormula('(h - t) / (n + 1)', { h: 2000, t: 16, n: 3 })).toBeCloseTo(496, 0);
  });

  it('Тест 4: валидация формул выявляет ошибку', () => {
    const issues = validateFormulas({ a: 'width - ', b: 'a + 1' }, { width: 800 });
    expect(issues.some((i) => i.code === 'tpl.badFormula')).toBe(true);
  });

  it('Тест 5: обнаружение циклических зависимостей', () => {
    expect(detectCircular({ a: 'b', b: 'a' })).not.toBeNull();
    expect(validateFormulas({ a: 'b + 1', b: 'a + 1' }, {}).some((i) => i.code === 'tpl.circular')).toBe(true);
    expect(detectCircular({ a: 'x + 1', b: 'a * 2' })).toBeNull();
  });
});

describe('Шаблоны 12 — генераторы', () => {
  beforeEach(() => store().newProject('Тест'));

  const create = (id: string) => {
    const res = store().createFromTemplate(id);
    expect(res.ok).toBe(true);
    return res.id!;
  };

  it('Тест 6: генератор шкафа создаёт корпус с деталями', () => {
    const id = create('tpl-cabinet');
    const parts = partsOf(id);
    expect(parts.some((p) => p.metadata?.partType === 'side_left')).toBe(true);
    expect(parts.some((p) => p.metadata?.partType === 'top')).toBe(true);
    expect(parts.length).toBeGreaterThan(4);
  });

  it('Тест 7: генератор нижнего шкафа', () => { expect(partsOf(create('tpl-base')).length).toBeGreaterThan(3); });
  it('Тест 8: генератор навесного шкафа', () => { expect(partsOf(create('tpl-wall')).length).toBeGreaterThan(3); });
  it('Тест 9: генератор пенала', () => { expect(partsOf(create('tpl-tall')).length).toBeGreaterThan(4); });
  it('Тест 11: генератор стеллажа', () => { expect(partsOf(create('tpl-rack')).length).toBeGreaterThan(4); });
  it('Тест 12: генератор комода (ящики как щиты)', () => { expect(partsOf(create('tpl-drawer')).length).toBeGreaterThan(4); });

  it('Тест 10: генератор полки — единственный щит', () => {
    const id = create('tpl-shelf');
    const parts = partsOf(id);
    expect(parts.length).toBe(1);
    expect(parts[0].metadata?.partType).toBe('board');
  });
});

describe('Шаблоны 12 — параметры и распространение', () => {
  beforeEach(() => store().newProject('Тест'));

  it('Тест 13: количество полок влияет на число деталей', () => {
    const t = findTemplate('tpl-cabinet')!;
    const base = instantiateTemplate(t, { ...defaultValues(t), shelfCount: 2, doorCount: 0, verticalPartitionCount: 0 }, mats()).params;
    const more = instantiateTemplate(t, { ...defaultValues(t), shelfCount: 6, doorCount: 0, verticalPartitionCount: 0 }, mats()).params;
    expect(build(more).parts.length).toBeGreaterThan(build(base).parts.length);
  });

  it('Тест 14: количество перегородок', () => {
    const t = findTemplate('tpl-cabinet')!;
    const p = instantiateTemplate(t, { ...defaultValues(t), verticalPartitionCount: 2, doorCount: 0 }, mats()).params;
    expect(p.dividers).toBe(2);
    expect(build(p).parts.filter((x) => x.metadata?.partType === 'divider').length).toBe(2);
  });

  it('Тест 15: количество фасадов создаёт фасады нужной ширины', () => {
    const t = findTemplate('tpl-cabinet')!;
    const p = instantiateTemplate(t, { ...defaultValues(t), width: 800, doorCount: 2, doorGap: 2 }, mats()).params;
    const facades = build(p).parts.filter((x) => x.metadata?.partType === 'facade');
    expect(facades.length).toBe(2);
    // Ширина фасада: (ширина − боковые зазоры по 2 − зазор между) / 2.
    expect(facades[0].width).toBeCloseTo((800 - 2 * 2 - 2) / 2, 0);
    expect(facades[0].width).toBeLessThan(800);
  });

  it('Тест 16: материал распространяется в детали', () => {
    const id = store().createFromTemplate('tpl-cabinet').id!;
    const parts = partsOf(id);
    expect(parts.every((p) => p.material !== undefined)).toBe(true);
    expect(parts.some((p) => p.material === project().materials[0].id)).toBe(true);
  });

  it('Тест 17: толщина распространяется на зависимые размеры', () => {
    const t = findTemplate('tpl-cabinet')!;
    const p16 = instantiateTemplate(t, { ...defaultValues(t), materialThickness: 16, doorCount: 0 }, mats()).params;
    const p18 = instantiateTemplate(t, { ...defaultValues(t), materialThickness: 18, doorCount: 0 }, mats()).params;
    const top16 = build(p16).parts.find((x) => x.metadata?.partType === 'top')!;
    const top18 = build(p18).parts.find((x) => x.metadata?.partType === 'top')!;
    expect(top16.thickness).toBe(16);
    expect(top18.thickness).toBe(18);
    // Верх между боковинами: ширина = W - 2*t → при большей толщине меньше.
    expect(Math.max(top18.width, top18.height)).toBeLessThan(Math.max(top16.width, top16.height));
  });

  it('Тест 18: тип соединения задаёт категорию крепежа в плане', () => {
    const t = findTemplate('tpl-cabinet')!;
    const p = instantiateTemplate(t, { ...defaultValues(t), jointType: 'dowel', doorCount: 0 }, mats()).params;
    const plan = planConnections({ ...cabinetConnectionContext(p), parts: build(p).parts });
    expect(plan.some((c) => c.category === 'dowel')).toBe(true);
    expect(plan.some((c) => c.category === 'confirmat')).toBe(false);
  });

  it('Тест 19: фурнитура и соединения создаются', () => {
    const before = project().hardwareConnections.length;
    store().createFromTemplate('tpl-cabinet');
    expect(project().hardwareConnections.length).toBeGreaterThan(before);
  });

  it('Тест 20: присадка генерируется из соединений', () => {
    store().createFromTemplate('tpl-cabinet');
    expect(genM(project()).length).toBeGreaterThan(0);
  });
});

describe('Шаблоны 12 — инвалидация, отвязка, история', () => {
  beforeEach(() => store().newProject('Тест'));

  it('Тест 21/22: изменение параметров делает раскрой DIRTY и документы OUTDATED', async () => {
    const id = store().createFromTemplate('tpl-cabinet').id!;
    await store().recalculateCutting();
    store().markDocumentsGenerated();
    expect(isCuttingStale(project())).toBe(false);
    expect(isDocumentsOutdated(project())).toBe(false);
    store().updateTemplateValues(id, { width: 1000 });
    expect(isCuttingStale(project())).toBe(true);
    expect(isDocumentsOutdated(project())).toBe(true);
  });

  it('Тест 23: отвязка от шаблона', () => {
    const id = store().createFromTemplate('tpl-cabinet').id!;
    store().detachTemplate(id);
    const f = project().furnitures.find((x) => x.id === id)!;
    expect((f.metadata?.template as { detached?: boolean }).detached).toBe(true);
    // После отвязки updateTemplateValues не действует.
    const before = allParts(project()).length;
    store().updateTemplateValues(id, { shelfCount: 8 });
    expect(allParts(project()).length).toBe(before);
  });

  it('Тест 24/25: сохранение и загрузка пользовательского шаблона', () => {
    const id = store().createFromTemplate('tpl-cabinet').id!;
    const tpl = store().saveFurnitureAsTemplate(id, 'Мой шкаф');
    expect(tpl).not.toBeNull();
    expect(loadCustomTemplates().some((t) => t.id === tpl!.id)).toBe(true);
    removeCustomTemplate(tpl!.id); // очистка
  });

  it('Тест 26: создание из пользовательского шаблона', () => {
    const src = store().createFromTemplate('tpl-cabinet').id!;
    const tpl = store().saveFurnitureAsTemplate(src, 'Мой шкаф 2')!;
    const res = store().createFromTemplate(tpl.id);
    expect(res.ok).toBe(true);
    expect(partsOf(res.id!).length).toBeGreaterThan(3);
    removeCustomTemplate(tpl.id);
  });

  it('Тест 27/28: undo/redo создания изделия', () => {
    const before = project().furnitures.length;
    store().createFromTemplate('tpl-cabinet');
    expect(project().furnitures.length).toBe(before + 1);
    store().undo();
    expect(project().furnitures.length).toBe(before);
    store().redo();
    expect(project().furnitures.length).toBe(before + 1);
  });
});

describe('Шаблоны 12 — валидация и полный сценарий', () => {
  beforeEach(() => store().newProject('Тест'));

  it('Тест 29: валидация геометрии и параметров', () => {
    const t = findTemplate('tpl-cabinet')!;
    // Отрицательная ширина → пользовательская ошибка (не stack trace).
    const errs = validateTemplateValues(t, { ...defaultValues(t), width: -100 });
    expect(errs.some((i) => i.severity === 'error')).toBe(true);
    // Корректные параметры → геометрия без ошибок.
    const good = instantiateTemplate(t, { ...defaultValues(t), doorCount: 0 }, mats()).params;
    expect(validateTemplateGeometry(good).some((i) => i.severity === 'error')).toBe(false);
  });

  it('Тест 30: полная генерация проекта (шкаф 800×2000×600) и пересчёт', () => {
    const t = findTemplate('tpl-cabinet')!;
    const id = store().createFromTemplate('tpl-cabinet', {
      ...defaultValues(t), width: 800, height: 2000, depth: 600, materialThickness: 16,
      shelfCount: 4, verticalPartitionCount: 1, doorCount: 2, jointType: 'confirmat',
    }).id!;
    const parts: Part[] = partsOf(id);
    expect(parts.some((p) => p.metadata?.partType === 'facade')).toBe(true);
    expect(parts.some((p) => p.metadata?.partType === 'divider')).toBe(true);
    expect(project().hardwareConnections.length).toBeGreaterThan(0);
    expect(genM(project()).length).toBeGreaterThan(0);

    // Пересчёт: 800 → 1000.
    store().updateTemplateValues(id, { width: 1000 });
    const side = partsOf(id).find((p) => p.metadata?.partType === 'side_left')!;
    expect(side).toBeDefined();
    // 4 полки → 6.
    const before = partsOf(id).filter((p) => p.metadata?.partType === 'shelf').length;
    store().updateTemplateValues(id, { shelfCount: 6 });
    const after = partsOf(id).filter((p) => p.metadata?.partType === 'shelf').length;
    expect(after).toBeGreaterThan(before);
    // 2 фасада → 3.
    store().updateTemplateValues(id, { doorCount: 3 });
    expect(partsOf(id).filter((p) => p.metadata?.partType === 'facade').length).toBe(3);
  });
});
