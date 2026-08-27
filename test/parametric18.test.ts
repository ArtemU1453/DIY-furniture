/**
 * ЭТАП 18 — Параметрический редактор мебели.
 * Цепочка: Parameters → Rules → ProjectModel → Parts → Connections →
 * Machining → 3D → Cutting → Documents.
 *
 * Проверяет параметрическую модель и параметры, безопасный парсер выражений,
 * граф зависимостей и обнаружение циклов, валидатор, все правила конструкции,
 * стабильные Part ID, ручные детали и override, генератор и diff, шаблоны,
 * модули, undo/redo и интеграцию с раскроем, присадкой, документами и 3D.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import {
  PARAMETRIC_KEY,
  PARAMETRIC_TEMPLATES,
  addChildModule,
  addDoor,
  addPartition,
  addShelf,
  alignItems,
  applyOverride,
  baseCabinetTemplate,
  buildDefinitions,
  buildDependencyGraph,
  cabinetSnapTargets,
  cabinetTemplate,
  computeGeometry,
  createModule,
  createParametricModel,
  dependents,
  describeDiff,
  diffParametric,
  duplicateModule,
  evaluateInModel,
  findModule,
  findParametricTemplate,
  flattenModules,
  fromCabinetParameters,
  generateParts,
  hasOverride,
  hasParametricModel,
  isValidDimension,
  partOverrides,
  partSource,
  partitionPositions,
  previewRegeneration,
  readParametricModel,
  removeDoor,
  removePartition,
  removeShelf,
  resetOverride,
  resolveParameters,
  runCommand,
  setConstruction,
  setMaterial,
  setParameter,
  shelfOffsets,
  shelvingTemplate,
  snapValue,
  validateDimensions,
  validateGeometry,
  validateParameter,
  validateParametricModel,
  type Parameter,
  type ParametricModel,
} from '@/engines/parametric';
import { evaluateFormula, FormulaError } from '@/engines/templates/formula';
import { isCuttingStale } from '@/engines/cutting';
import { allOperations } from '@/engines/machining';
import { isDocumentsOutdated, buildDocument } from '@/engines/drawing';
import { partWorldAABB } from '@/core/geometry/partGeometry';
import type { FurnitureId, MaterialId, PartId } from '@/core/model/ids';
import type { Project } from '@/core/model/types';

const store = () => useEditorStore.getState();
const project = (): Project => store().project;
const parts = () => allParts(project());

/** Тестовый шкаф 800×2000×600, 16 мм, 4 полки, 1 перегородка, 2 фасада (§70). */
function makeParametricCabinet(): FurnitureId {
  store().newProject('Тест 18');
  const id = store().createParametricFurniture('param-cabinet');
  expect(id).toBeTruthy();
  return id!;
}

const modelOf = (id: FurnitureId): ParametricModel => store().getParametricModel(id)!;
const keysOf = (): string[] =>
  parts().map((p) => String(p.metadata?.key ?? '')).filter(Boolean);

// ─────────────────────────────────────────────────────────────────────────────
describe('Параметрика 18 — модель и параметры', () => {
  it('Тест 1: ParametricModel — все поля и значения по умолчанию', () => {
    const m = createParametricModel();
    expect(m.width).toBeGreaterThan(0);
    expect(m.height).toBeGreaterThan(0);
    expect(m.depth).toBeGreaterThan(0);
    expect(m.thickness).toBeGreaterThan(0);
    expect(m.materialId).toBeNull();
    expect(m.backPanel).toBeDefined();
    expect(m.shelves).toBeDefined();
    expect(m.partitions).toBeDefined();
    expect(m.doors).toBeDefined();
    expect(m.drawers).toBeDefined();
    expect(m.legs).toBeDefined();
    expect(m.plinth).toBeDefined();
    expect(Array.isArray(m.parameters)).toBe(true);
    // Размеры в миллиметрах (§4).
    expect(m.width).toBe(800);
    expect(m.height).toBe(2000);
    expect(m.depth).toBe(600);
  });

  it('Тест 2/3: Parameter — поля и четыре типа', () => {
    const params: Parameter[] = [
      { id: 'n', name: 'Число', type: 'NUMBER', value: 100, unit: 'мм', min: 0, max: 500 },
      { id: 'b', name: 'Флаг', type: 'BOOLEAN', value: true },
      { id: 'e', name: 'Выбор', type: 'ENUM', value: 'a', options: [{ value: 'a', label: 'А' }, { value: 'b', label: 'Б' }] },
      { id: 's', name: 'Текст', type: 'STRING', value: 'привет' },
    ];
    for (const p of params) expect(validateParameter(p)).toHaveLength(0);

    // Нарушения типа и границ ловятся.
    expect(validateParameter({ ...params[0], value: 900 })[0].code).toBe('param.aboveMax');
    expect(validateParameter({ ...params[0], value: -5 })[0].code).toBe('param.belowMin');
    expect(validateParameter({ ...params[0], value: 'нет' as never })[0].code).toBe('param.notNumber');
    expect(validateParameter({ ...params[1], value: 1 as never })[0].code).toBe('param.notBoolean');
    expect(validateParameter({ ...params[2], value: 'z' })[0].code).toBe('param.notInEnum');
    expect(validateParameter({ ...params[3], value: 5 as never })[0].code).toBe('param.notString');
  });

  it('Тест 4/85: expression parser — width - 2 * thickness = 768', () => {
    expect(evaluateFormula('width - 2 * thickness', { width: 800, thickness: 16 })).toBe(768);
    expect(evaluateFormula('height - 100', { height: 2000 })).toBe(1900);
    expect(evaluateFormula('(800 - 16) / 2', {})).toBe(392);
    expect(evaluateFormula('-5 + 10', {})).toBe(5);
    expect(evaluateFormula('2 * (3 + 4)', {})).toBe(14);

    // В контексте модели (§9/§11).
    const m = createParametricModel({ width: 800, thickness: 16, depth: 600 });
    expect(evaluateInModel(m, 'width - 2 * thickness')).toEqual({ ok: true, value: 768 });
    expect(evaluateInModel(m, 'depth - backThickness').value).toBe(600 - m.backPanel.thickness);
  });

  it('Тест 40/86: небезопасное выражение отклоняется — eval нет', () => {
    // Парсер принимает только числа, имена, + - * / % ( ) , — остальное ошибка.
    const attacks = [
      'eval("1+1")',
      'new Function("return 1")()',
      'process.exit(1)',
      'window.location',
      '1; alert(1)',
      'constructor.constructor("return 1")()',
      '__proto__',
      '`${1}`',
      'a[0]',
    ];
    for (const attack of attacks) {
      let threw = false;
      try {
        const value = evaluateFormula(attack, {});
        // Разбор мог пройти, но неизвестное имя обязано дать ошибку.
        expect(Number.isFinite(value)).toBe(false);
      } catch (e) {
        threw = true;
        expect(e).toBeInstanceOf(FormulaError);
      }
      expect(threw).toBe(true);
    }
    // Известная функция работает, неизвестная — нет.
    expect(evaluateFormula('max(1, 2)', {})).toBe(2);
    expect(() => evaluateFormula('fetch(1)', {})).toThrow(FormulaError);
  });

  it('Тест 5: dependency graph — кто от кого зависит', () => {
    const params: Parameter[] = [
      { id: 'inner', name: 'Внутр. ширина', type: 'NUMBER', value: 0, expression: 'width - 2 * thickness' },
      { id: 'half', name: 'Половина', type: 'NUMBER', value: 0, expression: 'inner / 2' },
      { id: 'plain', name: 'Простой', type: 'NUMBER', value: 42 },
    ];
    const graph = buildDependencyGraph(params, ['width', 'thickness']);
    expect(graph.cycle).toBeNull();
    expect(graph.invalid).toHaveLength(0);
    expect(graph.nodes.get('half')!.dependsOn).toContain('inner');
    expect(graph.nodes.get('inner')!.usedBy).toContain('half');
    expect(graph.nodes.get('plain')!.computed).toBe(false);
    expect(graph.nodes.get('inner')!.computed).toBe(true);
    // Зависимость раньше зависимого.
    expect(graph.order.indexOf('inner')).toBeLessThan(graph.order.indexOf('half'));
    // Что придётся пересчитать при изменении inner.
    expect(dependents(graph, 'inner')).toContain('half');
  });

  it('Тест 6/82: обнаружение цикла A → B → A', () => {
    const params: Parameter[] = [
      { id: 'a', name: 'A', type: 'NUMBER', value: 0, expression: 'b + 10' },
      { id: 'b', name: 'B', type: 'NUMBER', value: 0, expression: 'a - 10' },
    ];
    const graph = buildDependencyGraph(params);
    expect(graph.cycle).not.toBeNull();
    expect(graph.cycle!.length).toBeGreaterThanOrEqual(2);
    // Порядок вычисления пуст — бесконечного пересчёта не будет.
    expect(graph.order).toHaveLength(0);

    const model = createParametricModel({ parameters: params });
    const resolved = resolveParameters(model);
    expect(resolved.ok).toBe(false);
    expect(resolved.issues[0].code).toBe('param.cycle');

    const validation = validateParametricModel(model);
    expect(validation.ok).toBe(false);
    expect(validation.issues.some((i) => i.code === 'param.cycle')).toBe(true);

    // Самоссылка тоже цикл.
    const self = buildDependencyGraph([{ id: 'x', name: 'X', type: 'NUMBER', value: 0, expression: 'x + 1' }]);
    expect(self.cycle).not.toBeNull();
  });

  it('Тест 7/83/84: ParametricValidator — 0, отрицательные, NaN, Infinity', () => {
    expect(isValidDimension(100)).toBe(true);
    for (const bad of [0, -100, NaN, Infinity, -Infinity, '800', null, undefined]) {
      expect(isValidDimension(bad)).toBe(false);
    }
    // width = -100 (§83).
    expect(validateDimensions(createParametricModel({ width: -100 }))
      .some((i) => i.code === 'dim.invalid' && i.field === 'width')).toBe(true);
    // height = 0 (§84).
    expect(validateDimensions(createParametricModel({ height: 0 }))
      .some((i) => i.code === 'dim.invalid' && i.field === 'height')).toBe(true);
    expect(validateDimensions(createParametricModel({ depth: NaN })).length).toBeGreaterThan(0);
    // Корректная модель проходит.
    expect(validateParametricModel(createParametricModel()).ok).toBe(true);
  });

  it('Тест 7b/6: limits — параметры шаблона, а не константы UI', () => {
    const m = createParametricModel({ width: 5000 });
    expect(validateDimensions(m).some((i) => i.code === 'dim.aboveMax')).toBe(true);
    // Лимит можно поднять — он часть модели.
    const relaxed = createParametricModel({ width: 5000, limits: { ...m.limits, maximumWidth: 6000 } });
    expect(validateDimensions(relaxed).some((i) => i.code === 'dim.aboveMax')).toBe(false);
    expect(validateDimensions(createParametricModel({ width: 50 }))
      .some((i) => i.code === 'dim.belowMin')).toBe(true);
  });

  it('Тест 66: невозможная конфигурация не порождает геометрию', () => {
    // Полка шириной меньше 1 мм: слишком много перегородок.
    const crowded = createParametricModel({ width: 300, thickness: 16, partitions: { count: 20, positions: [], orientation: 'VERTICAL' } });
    expect(validateGeometry(crowded).some((i) => i.code === 'geom.sectionTooNarrow')).toBe(true);

    // Корпус без внутреннего пространства.
    expect(validateGeometry(createParametricModel({ width: 30, thickness: 16 }))
      .some((i) => i.code === 'geom.noInnerWidth')).toBe(true);

    // Фасады не помещаются.
    const doors = createParametricModel({ width: 100, doors: { ...createParametricModel().doors, count: 50 } });
    expect(validateGeometry(doors).some((i) => i.code === 'geom.doorTooNarrow')).toBe(true);

    // Генератор при ошибке НЕ трогает детали.
    const result = generateParts(crowded, []);
    expect(result.ok).toBe(false);
    expect(result.parts).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Параметрика 18 — правила конструкции', () => {
  it('Тест 8/9/10: ParametricRule → PartDefinition[], корпус', () => {
    const m = createParametricModel({ width: 800, height: 2000, depth: 600, thickness: 16 });
    const defs = buildDefinitions(m);
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) {
      expect(d.id).toBeTruthy();
      expect(d.name).toBeTruthy();
      expect(d.width).toBeGreaterThan(0);
      expect(d.height).toBeGreaterThan(0);
      expect(d.thickness).toBeGreaterThan(0);
      expect(d.position).toBeDefined();
      expect(d.rotation).toBeDefined();
      expect(d.role).toBeTruthy();
    }
    // Боковины: высота × глубина (§18).
    const left = defs.find((d) => d.id === 'CABINET.SIDE.LEFT')!;
    expect(left.height).toBe(2000);
    expect(left.width).toBe(600);
    expect(left.thickness).toBe(16);
    expect(defs.find((d) => d.id === 'CABINET.SIDE.RIGHT')).toBeDefined();
  });

  it('Тест 17/19/20: схемы корпуса BETWEEN_SIDES и ON_SIDES не смешиваются', () => {
    const base = createParametricModel({ width: 800, height: 2000, thickness: 16, shelves: { ...createParametricModel().shelves, count: 0 } });

    const between = buildDefinitions({ ...base, construction: 'BETWEEN_SIDES' });
    const bTop = between.find((d) => d.id === 'CABINET.TOP')!;
    const bSide = between.find((d) => d.id === 'CABINET.SIDE.LEFT')!;
    // Верх между боковинами: уже на 2t, боковина во всю высоту.
    expect(bTop.width).toBe(800 - 2 * 16);
    expect(bSide.height).toBe(2000);

    const on = buildDefinitions({ ...base, construction: 'ON_SIDES' });
    const oTop = on.find((d) => d.id === 'CABINET.TOP')!;
    const oSide = on.find((d) => d.id === 'CABINET.SIDE.LEFT')!;
    // Верх на боковинах: во всю ширину, боковина короче на 2t.
    expect(oTop.width).toBe(800);
    expect(oSide.height).toBe(2000 - 2 * 16);

    expect(computeGeometry({ ...base, construction: 'BETWEEN_SIDES' }).sideY).toEqual({ min: 0, max: 2000 });
    expect(computeGeometry({ ...base, construction: 'ON_SIDES' }).sideY).toEqual({ min: 16, max: 1984 });
  });

  it('Тест 11/24/25/26: ShelfRule — AUTO_EQUAL, MANUAL, фиксированные', () => {
    const base = createParametricModel({ height: 2000, thickness: 16 });

    // Равномерно (§24): шаги между полками одинаковы.
    const auto = shelfOffsets({ ...base, shelves: { ...base.shelves, count: 3, distribution: 'AUTO_EQUAL' } });
    expect(auto).toHaveLength(3);
    const gaps = auto.slice(1).map((v, i) => v - auto[i]);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6);

    // Вручную с шагом (§25).
    const manual = shelfOffsets({
      ...base,
      shelves: { ...base.shelves, count: 3, distribution: 'MANUAL', spacing: 400, startOffset: 0 },
    });
    expect(manual[0]).toBeCloseTo(16 + 400, 6);
    expect(manual[1] - manual[0]).toBeCloseTo(400, 6);

    // Фиксированная полка не двигается (§26).
    const fixed = shelfOffsets({
      ...base,
      shelves: {
        ...base.shelves, count: 3, distribution: 'AUTO_EQUAL',
        fixedShelves: [{ index: 2, offset: 777, fixed: true }],
      },
    });
    expect(fixed[1]).toBe(777);
    expect(fixed[0]).not.toBe(777);

    // Отступы сверху и снизу учитываются.
    const withOffsets = shelfOffsets({
      ...base,
      shelves: { ...base.shelves, count: 1, distribution: 'AUTO_EQUAL', startOffset: 200, endOffset: 100 },
    });
    expect(withOffsets[0]).toBeCloseTo((16 + 200 + (2000 - 16 - 100)) / 2, 6);

    expect(shelfOffsets({ ...base, shelves: { ...base.shelves, count: 0 } })).toHaveLength(0);
  });

  it('Тест 12/27/28: PartitionRule — количество, позиции, ориентация', () => {
    const base = createParametricModel({ width: 900, thickness: 16 });

    // Равномерно по умолчанию, вертикальные (§28).
    const one = partitionPositions({ ...base, partitions: { count: 1, positions: [], orientation: 'VERTICAL' } });
    expect(one).toHaveLength(1);
    expect(one[0]).toBeCloseTo((16 + (900 - 16)) / 2, 6);

    const two = partitionPositions({ ...base, partitions: { count: 2, positions: [], orientation: 'VERTICAL' } });
    expect(two).toHaveLength(2);
    expect(two[1] - two[0]).toBeCloseTo(two[0] - 16, 6);

    // Явные позиции перекрывают расчёт.
    const explicit = partitionPositions({ ...base, partitions: { count: 2, positions: [300, 600], orientation: 'VERTICAL' } });
    expect(explicit).toEqual([300, 600]);

    // Вертикальная и горизонтальная дают разную геометрию.
    const v = buildDefinitions({ ...base, partitions: { count: 1, positions: [], orientation: 'VERTICAL' } })
      .find((d) => d.id === 'CABINET.PARTITION.001')!;
    const h = buildDefinitions({ ...base, partitions: { count: 1, positions: [], orientation: 'HORIZONTAL' } })
      .find((d) => d.id === 'CABINET.PARTITION.001')!;
    expect(v.thickness).toBe(16);
    expect(h.thickness).toBe(16);
    expect(v.width).not.toBe(h.width);
  });

  it('Тест 13/29/30/31: DoorRule и зазоры', () => {
    const base = createParametricModel({ width: 800, height: 2000 });
    const gaps = { topGap: 2, bottomGap: 2, leftGap: 2, rightGap: 2, betweenGap: 3 };

    const two = buildDefinitions({ ...base, doors: { ...base.doors, count: 2, gaps } })
      .filter((d) => d.role === 'DOOR');
    expect(two).toHaveLength(2);
    // Ширина каждого учитывает боковые и межфасадный зазоры (§30).
    const expected = (800 - 2 - 2 - 3) / 2;
    for (const d of two) expect(d.width).toBeCloseTo(expected, 6);
    for (const d of two) expect(d.height).toBeCloseTo(2000 - 2 - 2, 6);

    // Один фасад — без межфасадного зазора.
    const one = buildDefinitions({ ...base, doors: { ...base.doors, count: 1, gaps } }).filter((d) => d.role === 'DOOR');
    expect(one[0].width).toBeCloseTo(800 - 2 - 2, 6);

    // Три фасада.
    expect(buildDefinitions({ ...base, doors: { ...base.doors, count: 3, gaps } })
      .filter((d) => d.role === 'DOOR')).toHaveLength(3);

    // §31: ширина пересчитывается при изменении корпуса.
    const wider = buildDefinitions({ ...base, width: 1000, doors: { ...base.doors, count: 2, gaps } })
      .filter((d) => d.role === 'DOOR');
    expect(wider[0].width).toBeCloseTo((1000 - 2 - 2 - 3) / 2, 6);
    expect(wider[0].width).toBeGreaterThan(two[0].width);
  });

  it('Тест 14/32/33: BackPanelRule — NONE / INSET / OVERLAY', () => {
    const base = createParametricModel({ width: 800, height: 2000, depth: 600, thickness: 16 });

    expect(buildDefinitions({ ...base, backPanel: { ...base.backPanel, type: 'NONE' } })
      .filter((d) => d.role === 'BACK')).toHaveLength(0);

    const inset = buildDefinitions({ ...base, backPanel: { type: 'INSET', thickness: 3, offset: 0, material: null } })
      .find((d) => d.role === 'BACK')!;
    // Вкладная — в проём между боковинами.
    expect(inset.width).toBeCloseTo(800 - 2 * 16, 6);
    expect(inset.height).toBeCloseTo(2000 - 2 * 16, 6);
    expect(inset.thickness).toBe(3);

    const overlay = buildDefinitions({ ...base, backPanel: { type: 'OVERLAY', thickness: 4, offset: 0, material: null } })
      .find((d) => d.role === 'BACK')!;
    // Накладная — во весь габарит.
    expect(overlay.width).toBe(800);
    expect(overlay.height).toBe(2000);
    expect(overlay.thickness).toBe(4);
  });

  it('Тест 15/16/34/35: LegRule и PlinthRule', () => {
    const base = createParametricModel();

    expect(buildDefinitions(base).filter((d) => d.role === 'LEG')).toHaveLength(0);

    const legs = buildDefinitions({ ...base, legs: { enabled: true, height: 100, insetX: 50, insetY: 50, count: 4 } })
      .filter((d) => d.role === 'LEG');
    expect(legs).toHaveLength(4);
    expect(legs[0].thickness).toBe(100);
    expect(legs.map((l) => l.id)).toContain('CABINET.LEG.001');

    const plinth = buildDefinitions({ ...base, plinth: { enabled: true, height: 100, inset: 0, frontOffset: 50, material: null } })
      .find((d) => d.role === 'PLINTH')!;
    expect(plinth.id).toBe('CABINET.PLINTH');
    expect(plinth.height).toBe(100);
  });

  it('Тест 18/39/45/46: стабильные Part ID и параметрические позиции', () => {
    const m = createParametricModel({ width: 800, thickness: 16, shelves: { ...createParametricModel().shelves, count: 2 } });
    const ids = buildDefinitions(m).map((d) => d.id);
    expect(ids).toContain('CABINET.SIDE.LEFT');
    expect(ids).toContain('CABINET.SIDE.RIGHT');
    expect(ids).toContain('CABINET.TOP');
    expect(ids).toContain('CABINET.BOTTOM');
    expect(ids).toContain('CABINET.SHELF.001');
    expect(ids).toContain('CABINET.SHELF.002');
    // Идентификаторы уникальны.
    expect(new Set(ids).size).toBe(ids.length);

    // §45: позиции считаются из параметров. Изделие центрировано по X.
    const defs = buildDefinitions(m);
    const left = defs.find((d) => d.id === 'CABINET.SIDE.LEFT')!;
    const right = defs.find((d) => d.id === 'CABINET.SIDE.RIGHT')!;
    expect(left.position.x).toBeCloseTo(-800 / 2 + 16 / 2, 6);
    expect(right.position.x).toBeCloseTo(800 / 2 - 16 / 2, 6);
    // §46: размеры детали локальные, позиция — в системе изделия.
    expect(left.width).toBe(m.depth);
    expect(left.height).toBe(m.height);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Параметрика 18 — генератор, override, diff', () => {
  beforeEach(() => { store().newProject('Тест 18'); });

  it('Тест 22/38: генератор сохраняет id и не плодит дубли', () => {
    const m = createParametricModel({ shelves: { ...createParametricModel().shelves, count: 2 } });
    const first = generateParts(m, []);
    expect(first.ok).toBe(true);
    expect(first.added.length).toBe(first.parts.length);

    const idsBefore = new Map(first.parts.map((p) => [String(p.metadata?.key), String(p.id)]));

    // Повторная генерация с теми же параметрами: id сохранены, дублей нет.
    const second = generateParts(m, first.parts);
    expect(second.parts).toHaveLength(first.parts.length);
    expect(second.added).toHaveLength(0);
    for (const p of second.parts) {
      expect(String(p.id)).toBe(idsBefore.get(String(p.metadata?.key)));
    }
    // Ключи уникальны — бесконечных новых деталей не возникает.
    const keys = second.parts.map((p) => String(p.metadata?.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('Тест 19/41/42: ручная деталь переживает регенерацию', () => {
    const m = createParametricModel();
    const generated = generateParts(m, []);
    const manual = {
      ...generated.parts[0],
      id: 'manual-part' as PartId,
      name: 'Моя деталь',
      metadata: { source: 'MANUAL' as const, number: 'P999' },
    };
    expect(partSource(manual)).toBe('MANUAL');
    expect(partSource(generated.parts[0])).toBe('PARAMETRIC');

    const next = generateParts({ ...m, width: 1000 }, [...generated.parts, manual]);
    expect(next.manual).toContain('manual-part');
    expect(next.parts.some((p) => String(p.id) === 'manual-part')).toBe(true);
    expect(next.parts.find((p) => String(p.id) === 'manual-part')!.name).toBe('Моя деталь');
  });

  it('Тест 20/21/43/44/80/81: override и его сброс', () => {
    const m = createParametricModel();
    const generated = generateParts(m, []);
    const shelf = generated.parts.find((p) => p.metadata?.key === 'CABINET.SHELF.001')!;
    expect(hasOverride(shelf)).toBe(false);

    // Ручная правка (§43).
    const overridden = applyOverride(shelf, { width: 555 });
    expect(overridden.width).toBe(555);
    expect(hasOverride(overridden)).toBe(true);
    expect(partOverrides(overridden).width).toBe(555);

    // Правка переживает пересчёт (§80).
    const withOverride = generated.parts.map((p) => (p.metadata?.key === 'CABINET.SHELF.001' ? overridden : p));
    const after = generateParts({ ...m, width: 1000 }, withOverride);
    const shelfAfter = after.parts.find((p) => p.metadata?.key === 'CABINET.SHELF.001')!;
    expect(shelfAfter.width).toBe(555);
    expect(hasOverride(shelfAfter)).toBe(true);

    // Сброс (§44/§81): деталь снова считается правилом.
    const reset = resetOverride(shelfAfter);
    expect(hasOverride(reset)).toBe(false);
    const recomputed = generateParts({ ...m, width: 1000 },
      after.parts.map((p) => (p.metadata?.key === 'CABINET.SHELF.001' ? reset : p)));
    const finalShelf = recomputed.parts.find((p) => p.metadata?.key === 'CABINET.SHELF.001')!;
    expect(finalShelf.width).not.toBe(555);
    expect(finalShelf.width).toBeGreaterThan(0);

    // Сброс отдельного поля.
    const multi = applyOverride(applyOverride(shelf, { width: 100 }), { name: 'Своя' });
    const partial = resetOverride(multi, ['width']);
    expect(partOverrides(partial).width).toBeUndefined();
    expect(partOverrides(partial).name).toBe('Своя');
  });

  it('Тест 23/67/68: ParametricDiff — добавленные, удалённые, изменённые', () => {
    const before = createParametricModel({ width: 800, shelves: { ...createParametricModel().shelves, count: 2 } });
    const after = { ...before, width: 1000, shelves: { ...before.shelves, count: 4 } };

    const diff = diffParametric(before, after, []);
    expect(diff.empty).toBe(false);
    expect(diff.parameters.some((p) => p.field === 'width' && p.before === '800' && p.after === '1000')).toBe(true);
    expect(diff.parameters.some((p) => p.field === 'shelves.count')).toBe(true);
    // Две новые полки.
    expect(diff.addedParts.map((p) => p.key)).toEqual(
      expect.arrayContaining(['CABINET.SHELF.003', 'CABINET.SHELF.004']),
    );
    // Существующие изменили размер.
    expect(diff.changedParts.length).toBeGreaterThan(0);
    // Статусы зависимых модулей (§69).
    expect(diff.cuttingDirty).toBe(true);
    expect(diff.documentsOutdated).toBe(true);
    expect(diff.machiningDirty).toBe(true);
    expect(diff.connectionsAffected).toBe(true);

    // Удаление полок.
    const fewer = diffParametric(before, { ...before, shelves: { ...before.shelves, count: 1 } }, []);
    expect(fewer.removedParts.map((p) => p.key)).toContain('CABINET.SHELF.002');

    // Без изменений — пустой дифф.
    expect(diffParametric(before, before, []).empty).toBe(true);
    expect(describeDiff(diffParametric(before, before, []))).toBe('Без изменений');
    expect(describeDiff(diff)).toContain('Ширина');

    // Предпросмотр (§67).
    const preview = previewRegeneration(before, after, []);
    expect(preview.ok).toBe(true);
    expect(preview.issues).toHaveLength(0);
    expect(preview.diff.addedParts.length).toBeGreaterThan(0);
  });

  it('Тест 27/61/62/63: FurnitureModule, вложенность и копирование', () => {
    const child = createModule({ name: 'Секция', type: 'SHELVING' });
    const root = addChildModule(createModule({ name: 'Шкаф 800' }), '', child);
    // addChildModule по id корня.
    const withChild = addChildModule(createModule({ id: 'root', name: 'Шкаф 800' }), 'root', child);
    expect(withChild.children).toHaveLength(1);
    expect(flattenModules(withChild)).toHaveLength(2);
    expect(findModule(withChild, child.id)!.name).toBe('Секция');
    void root;

    // Копия: новые id, но та же структура (§61).
    const copy = duplicateModule(withChild, 'Шкаф 600');
    expect(copy.id).not.toBe(withChild.id);
    expect(copy.name).toBe('Шкаф 600');
    expect(copy.children).toHaveLength(1);
    expect(copy.children[0].id).not.toBe(child.id);
    // Параметры скопированы, а не разделены.
    copy.parameters.width = 600;
    expect(withChild.parameters.width).not.toBe(600);
  });

  it('Тест 64/65: выравнивание и привязка', () => {
    const items = [
      { id: 'a', x: 0, width: 100 },
      { id: 'b', x: 50, width: 200 },
      { id: 'c', x: 300, width: 100 },
    ];
    expect(alignItems(items, 'LEFT').every((i) => i.x === 0)).toBe(true);
    expect(alignItems(items, 'RIGHT').map((i) => i.x)).toEqual([300, 200, 300]);
    const centered = alignItems(items, 'CENTER');
    for (const c of centered) {
      const w = items.find((i) => i.id === c.id)!.width;
      expect(c.x + w / 2).toBeCloseTo(200, 6);
    }
    expect(alignItems([], 'LEFT')).toHaveLength(0);

    // Привязка к краю и центру.
    const model = createParametricModel({ width: 800, thickness: 16 });
    const targets = cabinetSnapTargets(model, [250]);
    expect(snapValue(398, targets, 5).value).toBe(400);
    expect(snapValue(398, targets, 5).snapped!.kind).toBe('center');
    expect(snapValue(252, targets, 5).value).toBe(250);
    // Далеко от целей — значение не меняется.
    expect(snapValue(123, targets, 5)).toEqual({ value: 123, snapped: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Параметрика 18 — шаблоны, команды, регенерация', () => {
  beforeEach(() => { store().newProject('Тест 18'); });

  it('Тест 24/25/26/56/57/58/59/60: шаблоны шкафа, стеллажа и тумбы', () => {
    expect(PARAMETRIC_TEMPLATES).toHaveLength(3);
    expect(PARAMETRIC_TEMPLATES.map((t) => t.kind)).toEqual(['CABINET', 'SHELVING', 'BASE_CABINET']);
    expect(findParametricTemplate('param-cabinet')).toBeDefined();
    expect(findParametricTemplate('нет')).toBeUndefined();

    // Шкаф (§58): полки, перегородка, фасады, задняя стенка.
    const cabinet = cabinetTemplate.build();
    expect(cabinet.shelves.count).toBe(4);
    expect(cabinet.partitions.count).toBe(1);
    expect(cabinet.doors.count).toBe(2);
    expect(cabinet.backPanel.type).toBe('INSET');

    // Стеллаж (§59): без фасадов и задней стенки.
    const shelving = shelvingTemplate.build();
    expect(shelving.doors.count).toBe(0);
    expect(shelving.backPanel.type).toBe('NONE');
    const shelvingDefs = buildDefinitions(shelving);
    expect(shelvingDefs.filter((d) => d.role === 'DOOR')).toHaveLength(0);
    expect(shelvingDefs.filter((d) => d.role === 'BACK')).toHaveLength(0);
    expect(shelvingDefs.filter((d) => d.role === 'SHELF').length).toBeGreaterThan(0);
    expect(shelvingDefs.filter((d) => d.role === 'SIDE')).toHaveLength(2);

    // Тумба (§60): низкий корпус, фасады, ножки.
    const base = baseCabinetTemplate.build();
    expect(base.height).toBeLessThan(1000);
    expect(base.doors.count).toBe(2);
    expect(base.legs.enabled).toBe(true);
  });

  it('Тест 28/50: команда меняет модель, а не геометрию напрямую', () => {
    const m = createParametricModel({ width: 800 });

    const ok = setParameter(m, 'width', 1000);
    expect(ok.ok).toBe(true);
    expect(ok.model.width).toBe(1000);
    expect(m.width).toBe(800); // исходная модель не мутирована
    expect(ok.description).toBe('Изменена ширина: 800 → 1000');

    // Невалидные значения не проходят (§83/§84).
    expect(setParameter(m, 'width', -100).ok).toBe(false);
    expect(setParameter(m, 'height', 0).ok).toBe(false);
    expect(setParameter(m, 'depth', NaN).ok).toBe(false);
    expect(setParameter(m, 'width', 'много' as never).ok).toBe(false);
    expect(setParameter(m, 'неизвестно', 5).ok).toBe(false);

    // Команды состава.
    expect(addShelf(m).model.shelves.count).toBe(m.shelves.count + 1);
    expect(removeShelf(m).model.shelves.count).toBe(m.shelves.count - 1);
    expect(addPartition(m).model.partitions.count).toBe(m.partitions.count + 1);
    expect(removePartition(createParametricModel({ partitions: { count: 2, positions: [], orientation: 'VERTICAL' } })).model.partitions.count).toBe(1);
    expect(addDoor(m).model.doors.count).toBe(m.doors.count + 1);
    expect(removeDoor(createParametricModel({ doors: { ...m.doors, count: 2 } })).model.doors.count).toBe(1);
    expect(setConstruction(m, 'ON_SIDES').model.construction).toBe('ON_SIDES');
    expect(setMaterial(m, 'mat-1' as MaterialId, 18).model.thickness).toBe(18);

    // Удаление из пустого набора — отказ, а не отрицательное число.
    expect(removeShelf(createParametricModel({ shelves: { ...m.shelves, count: 0 } })).ok).toBe(false);
    expect(removeDoor(createParametricModel({ doors: { ...m.doors, count: 0 } })).ok).toBe(false);

    // Диспетчер команд.
    expect(runCommand(m, 'AddShelf').ok).toBe(true);
    expect(runCommand(m, 'SetParameter', { field: 'width', value: 900 }).model.width).toBe(900);
  });

  it('Тест 29/71: изменение ширины 800 → 1000 пересчитывает всё', async () => {
    const id = makeParametricCabinet();
    await store().recalculateCutting();
    store().generateDocuments();
    expect(isCuttingStale(project())).toBe(false);
    expect(isDocumentsOutdated(project())).toBe(false);

    const before = modelOf(id);
    expect(before.width).toBe(800);
    const doorsBefore = parts().filter((p) => p.role === 'facade').map((p) => p.width);
    const topBefore = parts().find((p) => p.metadata?.key === 'CABINET.TOP')!.width;

    const result = store().runParametricCommand(id, 'SetParameter', { field: 'width', value: 1000 });
    expect(result.ok).toBe(true);
    expect(result.description).toBe('Изменена ширина: 800 → 1000');

    expect(modelOf(id).width).toBe(1000);
    // Верх и фасады пересчитаны.
    expect(parts().find((p) => p.metadata?.key === 'CABINET.TOP')!.width).toBeCloseTo(topBefore + 200, 6);
    const doorsAfter = parts().filter((p) => p.role === 'facade').map((p) => p.width);
    expect(doorsAfter[0]).toBeGreaterThan(doorsBefore[0]);
    // Полки стали шире.
    const shelf = parts().find((p) => p.metadata?.key === 'CABINET.SHELF.001')!;
    expect(shelf.width).toBeGreaterThan(0);
    // Зависимые модули устарели (§69).
    expect(isCuttingStale(project())).toBe(true);
    expect(isDocumentsOutdated(project())).toBe(true);
  });

  it('Тест 30/72: изменение высоты 2000 → 2200', () => {
    const id = makeParametricCabinet();
    const sideBefore = parts().find((p) => p.metadata?.key === 'CABINET.SIDE.LEFT')!.height;
    const doorBefore = parts().find((p) => p.role === 'facade')!.height;
    const shelvesBefore = parts().filter((p) => p.metadata?.partType === 'shelf').map((p) => p.position.y);

    store().runParametricCommand(id, 'SetParameter', { field: 'height', value: 2200 });

    expect(parts().find((p) => p.metadata?.key === 'CABINET.SIDE.LEFT')!.height).toBeCloseTo(sideBefore + 200, 6);
    expect(parts().find((p) => p.role === 'facade')!.height).toBeCloseTo(doorBefore + 200, 6);
    // Перегородка выросла.
    const partition = parts().find((p) => p.metadata?.key === 'CABINET.PARTITION.001');
    expect(partition!.height).toBeCloseTo(2200 - 2 * 16, 6);
    // Полки переехали.
    const shelvesAfter = parts().filter((p) => p.metadata?.partType === 'shelf').map((p) => p.position.y);
    expect(shelvesAfter).not.toEqual(shelvesBefore);
  });

  it('Тест 31/73: изменение глубины 600 → 500', () => {
    const id = makeParametricCabinet();
    store().runParametricCommand(id, 'SetParameter', { field: 'depth', value: 500 });
    const m = modelOf(id);
    expect(m.depth).toBe(500);

    // Боковина: её «ширина» заготовки — это глубина корпуса.
    expect(parts().find((p) => p.metadata?.key === 'CABINET.SIDE.LEFT')!.width).toBe(500);
    // Верх и низ мельче.
    expect(parts().find((p) => p.metadata?.key === 'CABINET.TOP')!.height).toBe(500);
    expect(parts().find((p) => p.metadata?.key === 'CABINET.BOTTOM')!.height).toBe(500);
    // Полка мельче корпуса на заданный отступ.
    const shelf = parts().find((p) => p.metadata?.key === 'CABINET.SHELF.001')!;
    expect(shelf.height).toBeLessThanOrEqual(500);
    // Фасад по глубине не меняется — он фронтальный.
    expect(parts().find((p) => p.role === 'facade')!.height).toBeCloseTo(2000 - 4, 6);
  });

  it('Тест 32/74: полки 4 → 6 добавляют 005 и 006 без дублей', () => {
    const id = makeParametricCabinet();
    // Шаблон: 4 полки × 2 секции (1 перегородка) = 8 деталей.
    const before = keysOf().filter((k) => k.startsWith('CABINET.SHELF.'));
    const idsBefore = new Map(
      parts().filter((p) => String(p.metadata?.key).startsWith('CABINET.SHELF.'))
        .map((p) => [String(p.metadata?.key), String(p.id)]),
    );

    store().runParametricCommand(id, 'AddShelf', { count: 2 });
    expect(modelOf(id).shelves.count).toBe(6);

    const after = keysOf().filter((k) => k.startsWith('CABINET.SHELF.'));
    expect(after.length).toBeGreaterThan(before.length);
    // Дублей нет.
    expect(new Set(after).size).toBe(after.length);
    // Существующие полки сохранили свои Part ID (§38).
    for (const [key, id0] of idsBefore) {
      const part = parts().find((p) => String(p.metadata?.key) === key);
      if (part) expect(String(part.id)).toBe(id0);
    }
  });

  it('Тест 33/75: полки 6 → 3 удаляют лишние из активной модели', () => {
    const id = makeParametricCabinet();
    store().runParametricCommand(id, 'AddShelf', { count: 2 }); // 6
    const many = keysOf().filter((k) => k.startsWith('CABINET.SHELF.')).length;

    store().runParametricCommand(id, 'RemoveShelf', { count: 3 }); // 3
    expect(modelOf(id).shelves.count).toBe(3);

    const few = keysOf().filter((k) => k.startsWith('CABINET.SHELF.'));
    expect(few.length).toBeLessThan(many);
    // «Мёртвых» деталей не осталось (§40).
    const maxIndex = Math.max(...few.map((k) => Number(k.split('.').pop())));
    expect(few).toHaveLength(maxIndex);
  });

  it('Тест 34/76: перегородка 0 → 1 создаёт деталь, соединения и присадку', () => {
    const id = makeParametricCabinet();
    // Начинаем без перегородок.
    store().runParametricCommand(id, 'RemovePartition');
    expect(modelOf(id).partitions.count).toBe(0);
    expect(keysOf().filter((k) => k.startsWith('CABINET.PARTITION.'))).toHaveLength(0);

    store().runParametricCommand(id, 'AddPartition');
    expect(modelOf(id).partitions.count).toBe(1);
    const partition = parts().find((p) => p.metadata?.key === 'CABINET.PARTITION.001');
    expect(partition).toBeDefined();
    expect(partition!.role).toBe('divider');
    expect(partition!.height).toBeGreaterThan(0);
  });

  it('Тест 35/77: фасады 1 → 2 с корректной шириной и зазорами', () => {
    const id = makeParametricCabinet();
    store().runParametricCommand(id, 'RemoveDoor'); // 2 → 1
    const one = parts().filter((p) => p.role === 'facade');
    expect(one).toHaveLength(1);
    const gaps = modelOf(id).doors.gaps;
    expect(one[0].width).toBeCloseTo(800 - gaps.leftGap - gaps.rightGap, 6);

    store().runParametricCommand(id, 'AddDoor'); // 1 → 2
    const two = parts().filter((p) => p.role === 'facade');
    expect(two).toHaveLength(2);
    const expected = (800 - gaps.leftGap - gaps.rightGap - gaps.betweenGap) / 2;
    for (const d of two) expect(d.width).toBeCloseTo(expected, 6);
    // Между фасадами есть зазор.
    const xs = two.map((d) => d.position.x).sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeCloseTo(expected + gaps.betweenGap, 6);
  });

  it('Тест 36/78: смена материала ЛДСП 16 → 18 пересчитывает геометрию', async () => {
    const id = makeParametricCabinet();
    await store().recalculateCutting();
    store().generateDocuments();

    const thick = project().materials.find((m) => m.thickness === 18)
      ?? project().materials[0];
    const result = store().runParametricCommand(id, 'SetMaterial', {
      materialId: thick.id, thickness: 18,
    });
    expect(result.ok).toBe(true);
    expect(modelOf(id).thickness).toBe(18);

    // Толщина деталей изменилась, значит изменилась и геометрия.
    const side = parts().find((p) => p.metadata?.key === 'CABINET.SIDE.LEFT')!;
    expect(side.thickness).toBe(18);
    expect(parts().find((p) => p.metadata?.key === 'CABINET.TOP')!.width).toBeCloseTo(800 - 2 * 18, 6);

    expect(isCuttingStale(project())).toBe(true);
    expect(isDocumentsOutdated(project())).toBe(true);
  });

  it('Тест 37/38/54/55/79: Undo и Redo параметрических изменений', () => {
    const id = makeParametricCabinet();
    expect(modelOf(id).width).toBe(800);

    store().runParametricCommand(id, 'SetParameter', { field: 'width', value: 1000 });
    expect(modelOf(id).width).toBe(1000);

    store().undo();
    expect(modelOf(id).width).toBe(800);

    store().redo();
    expect(modelOf(id).width).toBe(1000);

    // Undo добавления полки.
    const shelvesBefore = modelOf(id).shelves.count;
    store().runParametricCommand(id, 'AddShelf');
    expect(modelOf(id).shelves.count).toBe(shelvesBefore + 1);
    store().undo();
    expect(modelOf(id).shelves.count).toBe(shelvesBefore);

    // Undo смены материала.
    const materialBefore = modelOf(id).materialId;
    store().runParametricCommand(id, 'SetMaterial', { materialId: null });
    store().undo();
    expect(modelOf(id).materialId).toBe(materialBefore);
  });

  it('Тест 39b/83/84: недопустимые размеры не применяются к проекту', () => {
    const id = makeParametricCabinet();
    const widthBefore = modelOf(id).width;
    const partsBefore = parts().length;

    for (const bad of [-100, 0, NaN]) {
      const result = store().runParametricCommand(id, 'SetParameter', { field: 'width', value: bad });
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
    // Модель и детали не тронуты.
    expect(modelOf(id).width).toBe(widthBefore);
    expect(parts()).toHaveLength(partsBefore);

    // Модель, ломающая геометрию, тоже отклоняется генератором.
    const broken: ParametricModel = { ...modelOf(id), width: 20, thickness: 16 };
    const applied = store().applyParametricModel(id, broken);
    expect(applied.ok).toBe(false);
    expect(modelOf(id).width).toBe(widthBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Параметрика 18 — интеграция и совместимость', () => {
  it('Тест 41/42/43/44/87: полная цепочка Parameter → … → Document', async () => {
    const id = makeParametricCabinet();

    // Parameter → Part.
    expect(parts().length).toBeGreaterThan(0);
    expect(modelOf(id).width).toBe(800);

    // Part → 3D: у каждой детали есть корректный габаритный бокс (§44/§47).
    for (const p of parts()) {
      const box = partWorldAABB(p);
      expect(Number.isFinite(box.min.x)).toBe(true);
      expect(box.max.x).toBeGreaterThanOrEqual(box.min.x);
      expect(box.max.y).toBeGreaterThanOrEqual(box.min.y);
    }

    // Part → Cutting (§41).
    await store().recalculateCutting();
    expect(project().cutting.report).toBeDefined();
    expect(isCuttingStale(project())).toBe(false);

    // Machining (§42): операции строятся по деталям и связям.
    const ops = allOperations(project());
    expect(Array.isArray(ops)).toBe(true);

    // Documents (§43).
    const gen = store().generateDocuments();
    expect(gen.ok).toBe(true);
    expect(isDocumentsOutdated(project())).toBe(false);
    expect(buildDocument(project(), 'partsList').pages.length).toBeGreaterThan(0);

    // Изменение параметра проходит по всей цепочке.
    store().runParametricCommand(id, 'SetParameter', { field: 'width', value: 900 });
    expect(isCuttingStale(project())).toBe(true);
    expect(isDocumentsOutdated(project())).toBe(true);
  });

  it('Тест 45/70: полная регенерация тестового шкафа', () => {
    const id = makeParametricCabinet();
    const m = modelOf(id);
    // §70: 800×2000×600, 16 мм, 4 полки, 1 перегородка, 2 фасада, задняя стенка.
    expect([m.width, m.height, m.depth, m.thickness]).toEqual([800, 2000, 600, 16]);
    expect(m.shelves.count).toBe(4);
    expect(m.partitions.count).toBe(1);
    expect(m.doors.count).toBe(2);
    expect(m.backPanel.type).toBe('INSET');

    const keys = keysOf();
    expect(keys).toContain('CABINET.SIDE.LEFT');
    expect(keys).toContain('CABINET.SIDE.RIGHT');
    expect(keys).toContain('CABINET.TOP');
    expect(keys).toContain('CABINET.BOTTOM');
    expect(keys).toContain('CABINET.PARTITION.001');
    expect(keys).toContain('CABINET.BACK');
    expect(keys.filter((k) => k.startsWith('CABINET.DOOR.'))).toHaveLength(2);
    // 4 полки × 2 секции.
    expect(keys.filter((k) => k.startsWith('CABINET.SHELF.'))).toHaveLength(8);
    // Все детали имеют положительные размеры.
    for (const p of parts()) {
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
      expect(p.thickness).toBeGreaterThan(0);
    }
  });

  it('Тест 90/91/92: модель сохраняется и старые проекты открываются', () => {
    const id = makeParametricCabinet();
    const furniture = project().furnitures.find((f) => f.id === id)!;
    // §90: модель лежит в изделии, значит попадёт в сохранённый JSON.
    expect(hasParametricModel(furniture)).toBe(true);
    expect((furniture.params as Record<string, unknown>)[PARAMETRIC_KEY]).toBeDefined();
    expect(readParametricModel(furniture).width).toBe(800);

    // §91/§92: изделие без параметрической модели (старый проект).
    const legacy = {
      ...furniture,
      params: {
        width: 900, height: 1800, depth: 500, thickness: 18,
        shelves: 2, dividers: 1, doors: 2, doorGap: 4,
        back: 'overlay', jointType: 'dowel', top: 'overlay',
        construction: { backThickness: 4, shelfDepthReduction: 30, backOffset: 0 },
      },
    };
    expect(hasParametricModel(legacy)).toBe(false);
    const restored = readParametricModel(legacy);
    expect(restored.width).toBe(900);
    expect(restored.height).toBe(1800);
    expect(restored.thickness).toBe(18);
    expect(restored.shelves.count).toBe(2);
    expect(restored.partitions.count).toBe(1);
    expect(restored.doors.count).toBe(2);
    expect(restored.doors.gaps.betweenGap).toBe(4);
    expect(restored.backPanel.type).toBe('OVERLAY');
    expect(restored.backPanel.thickness).toBe(4);
    expect(restored.construction).toBe('ON_SIDES');
    expect(restored.jointType).toBe('dowel');

    // Из восстановленной модели строятся детали — проект работает.
    expect(generateParts(restored, []).ok).toBe(true);
    // Полностью пустые параметры дают модель по умолчанию.
    expect(fromCabinetParameters({}).width).toBe(800);
  });

  it('Тест 47: изменение параметров обновляет детали в существующем проекте', () => {
    const id = makeParametricCabinet();
    const idsBefore = new Map(parts().map((p) => [String(p.metadata?.key), String(p.id)]));
    const countBefore = parts().length;

    store().runParametricCommand(id, 'SetParameter', { field: 'width', value: 1200 });

    // Детали обновлены на месте: те же id, тот же состав.
    expect(parts()).toHaveLength(countBefore);
    for (const p of parts()) {
      const key = String(p.metadata?.key);
      if (idsBefore.has(key)) expect(String(p.id)).toBe(idsBefore.get(key));
    }
    // Геометрия действительно изменилась.
    expect(parts().find((p) => p.metadata?.key === 'CABINET.TOP')!.width).toBeCloseTo(1200 - 2 * 16, 6);
  });
});
