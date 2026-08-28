/**
 * ЭТАП 38 · НАГРУЗКА, НЕВОЗМОЖНЫЕ ДАННЫЕ И БЕЗОПАСНОСТЬ ФАЙЛОВ.
 *
 * Проверяется не «падает или нет», а поведение инструмента: большой проект
 * остаётся считаемым, невозможные производственные данные отклоняются, а не
 * молча исправляются, и повреждённый файл не ломает приложение.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { runCutting } from '@/engines/cutting';
import { buildSpecification } from '@/engines/bom/specification';
import { productionParts } from '@/engines/production';
import { rebuildScene } from '@/engines/scene';
import { serializeProject, deserializeProject, ProjectParseError } from '@/storage/project/serialization';
import { validateProjectModel } from '@/engines/status';

const store = () => useEditorStore.getState();
const project = () => store().project;
const mm = (v: number) => Math.round(v * 100) / 100;

/** Набрать проект примерно нужного размера обычными шкафами. */
function fillProject(targetParts: number) {
  while (allParts(project()).length < targetParts) {
    const id = store().createParametricCabinet({
      type: 'CABINET', width: 900, height: 2000, depth: 600, thickness: 16,
    });
    if (!id) break;
    const model = store().getCabinetModel(id)!;
    store().applyCabinetPatch(id, {
      shelves: { ...model.shelves, count: 6 },
      doors: { ...model.doors, count: 2, handleEnabled: true },
    });
  }
}

describe('Этап 38 · большой производственный проект', () => {
  beforeEach(() => store().newProject('Нагрузка'));

  it('§46/§47 1000 деталей и 5000 операций присадки остаются считаемыми', () => {
    fillProject(1000);
    const parts = allParts(project());
    expect(parts.length).toBeGreaterThanOrEqual(1000);

    const ops = allOperations(project());
    expect(ops.length).toBeGreaterThanOrEqual(5000);

    // Все разделы считаются и остаются согласованными с моделью.
    const t0 = Date.now();
    const report = runCutting(project());
    const cuttingMs = Date.now() - t0;
    expect(report.jobs.flatMap((j) => j.unplaced)).toHaveLength(0);

    const t1 = Date.now();
    const spec = buildSpecification(parts, project().materials, project().edges);
    const specMs = Date.now() - t1;
    expect(spec.rows).toHaveLength(parts.length);

    const t2 = Date.now();
    const production = productionParts(project());
    const productionMs = Date.now() - t2;
    expect(production).toHaveLength(parts.length);

    const t3 = Date.now();
    const { scene } = rebuildScene(project());
    const sceneMs = Date.now() - t3;
    expect(Object.values(scene.nodes).filter((n) => n.kind === 'PART')).toHaveLength(parts.length);

    // Пороги щедрые: ловим деградацию на порядок, а не колебания машины.
    expect(cuttingMs).toBeLessThan(20_000);
    expect(specMs).toBeLessThan(5_000);
    expect(productionMs).toBeLessThan(10_000);
    expect(sceneMs).toBeLessThan(10_000);

    // Присадка вся принадлежит существующим деталям.
    const live = new Set(parts.map((p) => String(p.id)));
    expect(ops.every((o) => live.has(String(o.partId)))).toBe(true);
  }, 180_000);

  it('§46 большой проект переживает сохранение и загрузку', () => {
    fillProject(1000);
    const before = allParts(project()).length;
    const opsBefore = allOperations(project()).length;

    const restored = deserializeProject(serializeProject(project()));
    expect(allParts(restored)).toHaveLength(before);
    expect(allOperations(restored)).toHaveLength(opsBefore);
  }, 180_000);
});

describe('Этап 38 · невозможные производственные данные', () => {
  beforeEach(() => {
    store().newProject('Проверка данных');
    store().createParametricCabinet({ type: 'CABINET', width: 800, height: 2000, depth: 600 });
  });

  it('§43–§45 размеры детали не принимают ноль, минус и не-число', () => {
    const part = allParts(project())[0];
    const before = {
      w: part.width, h: part.height, t: part.thickness, q: part.quantity,
    };

    for (const patch of [
      { width: 0 }, { width: -100 }, { height: 0 }, { height: -1 },
      { thickness: 0 }, { thickness: -16 },
      { width: Number.NaN }, { height: Number.POSITIVE_INFINITY },
      { quantity: 0 }, { quantity: -2 },
    ]) {
      store().updatePart(part.id, patch);
      const after = findPart(project(), part.id)!;
      // Ничего не изменилось и ничего не «исправилось» само.
      expect({ w: after.width, h: after.height, t: after.thickness, q: after.quantity })
        .toEqual(before);
    }
  });

  it('§43–§45 габариты изделия не принимают невозможные значения', () => {
    const id = store().project.furnitures.find((f) => f.type === 'cabinet')!.id;
    const before = store().getCabinetModel(id)!;

    for (const patch of [
      { width: 0 }, { width: -800 }, { height: Number.NaN },
      { depth: 0 }, { thickness: 0 }, { thickness: -16 },
    ]) {
      const result = store().applyCabinetPatch(id, patch);
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Сообщение для человека, без служебных подробностей.
      for (const message of result.errors) {
        expect(message).not.toMatch(/undefined|NaN at|Error:|\bstack\b|\bat \w+\./i);
      }
      const after = store().getCabinetModel(id)!;
      expect({ w: after.width, h: after.height, d: after.depth, t: after.thickness })
        .toEqual({ w: before.width, h: before.height, d: before.depth, t: before.thickness });
    }
  });

  it('§43 невозможная присадка не попадает в деталь', () => {
    const part = allParts(project())[0];
    const opsBefore = allOperations(project()).length;

    // Отверстие глубже детали и с нулевым диаметром — не производственные данные.
    store().addManualOperation({
      partId: part.id, face: 'front', x: 50, y: 50, diameter: 0, depth: 10,
    });
    store().addManualOperation({
      partId: part.id, face: 'front', x: 50, y: 50, diameter: 8, depth: -5,
    });
    // Операция на несуществующей детали.
    store().addManualOperation({
      partId: 'нет-такой-детали' as never, face: 'front', x: 10, y: 10, diameter: 8, depth: 10,
    });

    const ops = allOperations(project());
    const live = new Set(allParts(project()).map((p) => String(p.id)));
    expect(ops.every((o) => live.has(String(o.partId)))).toBe(true);
    expect(ops.every((o) => (o.diameter ?? 1) > 0)).toBe(true);
    expect(ops.every((o) => (o.depth ?? 1) > 0)).toBe(true);
    expect(ops.length).toBeGreaterThanOrEqual(opsBefore);
  });

  it('§43 соединение с несуществующей фурнитурой или деталью отклоняется', () => {
    const parts = allParts(project());
    const hw = project().hardware[0];
    const before = project().hardwareConnections.length;

    expect(store().addConnection({
      hardwareId: 'нет-такой' as never, partAId: parts[0].id, partBId: parts[1].id,
    }).ok).toBe(false);
    expect(store().addConnection({
      hardwareId: hw.id, partAId: parts[0].id, partBId: 'нет-такой' as never,
    }).ok).toBe(false);
    expect(store().addConnection({
      hardwareId: hw.id, partAId: parts[0].id, partBId: parts[0].id,
    }).ok).toBe(false);

    expect(project().hardwareConnections).toHaveLength(before);
    expect(validateProjectModel(project()).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('§45 введённые размеры не округляются молча', () => {
    const part = allParts(project())[0];
    store().updatePart(part.id, { width: 123.4 });
    expect(mm(findPart(project(), part.id)!.width)).toBe(123.4);

    const spec = buildSpecification(allParts(project()), project().materials, project().edges);
    const row = spec.rows.find((r) => String(r.partId) === String(part.id))!;
    expect(mm(Math.max(row.length, row.width))).toBe(mm(Math.max(123.4, part.height)));
  });
});

describe('Этап 38 · безопасность файлов', () => {
  beforeEach(() => {
    store().newProject('Файлы');
    store().createParametricCabinet({ type: 'CABINET', width: 800, height: 2000, depth: 600 });
  });

  const badFiles: Array<[string, string]> = [
    ['пустой файл', ''],
    ['пробелы', '   \n  '],
    ['повреждённый JSON', '{"version":"1.0", "furnitures": [ '],
    ['не тот JSON', '{"какие-то":"данные"}'],
    ['массив вместо объекта', '[1,2,3]'],
    ['число', '42'],
    ['строка', '"проект"'],
    ['null', 'null'],
    ['HTML вместо JSON', '<!doctype html><html><body>не проект</body></html>'],
    ['чужая версия формата', '{"version":"99.0","id":"x","name":"n","furnitures":[],"materials":[],"edges":[],"hardware":[],"hardwareConnections":[]}'],
  ];

  for (const [label, content] of badFiles) {
    it(`§53 ${label} отклоняется с понятной ошибкой`, () => {
      const parts = allParts(project()).length;
      let message = '';
      try {
        deserializeProject(content);
        throw new Error('файл принят, хотя не должен был');
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectParseError);
        message = error instanceof Error ? error.message : String(error);
      }
      // Сообщение человеческое: без стека и без сырого содержимого файла.
      expect(message.length).toBeGreaterThan(5);
      expect(message).not.toMatch(/\bat \w+\.|\.ts:\d+|JSON\.parse/);
      // Текущий проект не пострадал.
      expect(allParts(project())).toHaveLength(parts);
    });
  }

  it('§53 очень большой файл не принимается как проект', () => {
    // 5 МБ мусора: разбор не должен завершиться «успехом».
    const huge = `{"version":"1.0","junk":"${'x'.repeat(5_000_000)}"}`;
    expect(() => deserializeProject(huge)).toThrow(ProjectParseError);
  });

  it('§52 данные файла остаются данными и не исполняются', () => {
    const evil = {
      ...JSON.parse(serializeProject(project())),
      name: '<img src=x onerror="globalThis.__взлом = true">',
    };
    evil.furnitures[0].name = '"><script>globalThis.__взлом = true</script>';
    const restored = deserializeProject(JSON.stringify(evil));

    // Строки сохранены как есть, ничего не выполнено.
    expect(restored.name).toBe('<img src=x onerror="globalThis.__взлом = true">');
    expect((globalThis as Record<string, unknown>).__взлом).toBeUndefined();
  });

  it('§52 поля-прототипы из файла не попадают в объект проекта', () => {
    const payload = JSON.parse(serializeProject(project()));
    payload.__proto__ = { взломан: true };
    payload.constructor = { prototype: { взломан: true } };
    const restored = deserializeProject(JSON.stringify(payload));

    expect((Object.prototype as Record<string, unknown>).взломан).toBeUndefined();
    expect((restored as unknown as Record<string, unknown>).взломан).toBeUndefined();
  });
});
