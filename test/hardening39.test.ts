/**
 * ЭТАП 39 · RELEASE HARDENING.
 *
 * Проверяется не наличие функций, а устойчивость инструмента к тому, что
 * происходит в реальной работе: пользователь открывает чужой или испорченный
 * файл, ошибается в данных, отменяет действия, сохраняет и переносит проект.
 *
 * Главное правило раздела: НИ ОДНА ошибочная операция не должна стоить
 * пользователю уже сделанной работы.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { runCutting } from '@/engines/cutting';
import { buildSpecification } from '@/engines/bom/specification';
import { productionParts } from '@/engines/production';
import { validateProjectModel } from '@/engines/status';
import {
  serializeProject,
  deserializeProject,
  ProjectParseError,
} from '@/storage/project/serialization';
import { createAutosaver } from '@/storage/backup/autosave';

const store = () => useEditorStore.getState();
const project = () => store().project;

/** Обычный рабочий проект: шкаф с полками, дверями и фурнитурой. */
function buildProject() {
  store().newProject('Рабочий проект');
  const id = store().createParametricCabinet({
    type: 'CABINET', name: 'Шкаф', width: 1200, height: 2000, depth: 600, thickness: 16,
  })!;
  const model = store().getCabinetModel(id)!;
  store().applyCabinetPatch(id, {
    shelves: { ...model.shelves, count: 3 },
    doors: { ...model.doors, count: 2, handleEnabled: true },
  });
  return id;
}

describe('Этап 39 · испорченный файл не стоит пользователю проекта', () => {
  beforeEach(() => { buildProject(); });

  /**
   * Формы файла, которые проходят проверку «поле есть и это массив», но по
   * которым приложение не может обойти модель. Раньше такой файл принимался,
   * заменял собой открытый проект — и каждый раздел падал на первой же детали.
   */
  const brokenShapes: Array<[string, (raw: Record<string, unknown>) => void]> = [
    ['изделие — число', (r) => { r.furnitures = [1, 2, 3]; }],
    ['изделие — null', (r) => { r.furnitures = [null]; }],
    ['изделие без сборок', (r) => { r.furnitures = [{}]; }],
    ['сборки не массив', (r) => { first(r).assemblies = 'нет'; }],
    ['сборка — null', (r) => { first(r).assemblies = [null]; }],
    ['детали не массив', (r) => { firstAssembly(r).parts = 7; }],
    ['деталь — null', (r) => { firstAssembly(r).parts = [null]; }],
    ['деталь — строка', (r) => { firstAssembly(r).parts = ['деталь']; }],
    ['материал — число', (r) => { r.materials = [1, 2]; }],
    ['кромка — null', (r) => { r.edges = [null]; }],
    ['фурнитура — строка', (r) => { r.hardware = ['болт']; }],
  ];

  function first(raw: Record<string, unknown>): Record<string, unknown> {
    return (raw.furnitures as Record<string, unknown>[])[0];
  }
  function firstAssembly(raw: Record<string, unknown>): Record<string, unknown> {
    return (first(raw).assemblies as Record<string, unknown>[])[0];
  }

  for (const [label, mutate] of brokenShapes) {
    it(`§16/§40 файл, где ${label}, отклоняется и не заменяет открытый проект`, () => {
      const partsBefore = allParts(project()).length;
      const nameBefore = project().name;
      const raw = JSON.parse(serializeProject(project())) as Record<string, unknown>;
      mutate(raw);

      let message = '';
      try {
        deserializeProject(JSON.stringify(raw));
        throw new Error('файл принят, хотя приложение не может его обойти');
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectParseError);
        message = (error as Error).message;
      }

      // Сообщение для человека: без стека, без служебных подробностей.
      expect(message.length).toBeGreaterThan(5);
      expect(message).not.toMatch(/\bat \w+\.|\.ts:\d+|is not iterable|Cannot read/);

      // §17: открытый проект не пострадал.
      expect(allParts(project())).toHaveLength(partsBefore);
      expect(project().name).toBe(nameBefore);
    });
  }

  it('§40 принятый файл действительно считается всеми разделами', () => {
    const restored = deserializeProject(serializeProject(project()));
    const parts = allParts(restored);
    expect(parts.length).toBeGreaterThan(0);
    // Ни один раздел не падает — то, ради чего структура и проверяется.
    expect(validateProjectModel(restored).issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(runCutting(restored).jobs.flatMap((j) => j.unplaced)).toHaveLength(0);
    expect(buildSpecification(parts, restored.materials, restored.edges).rows).toHaveLength(parts.length);
    expect(productionParts(restored)).toHaveLength(parts.length);
  });

  it('§17 неудачный импорт оставляет открытый проект нетронутым', () => {
    const before = serializeProject(project());
    for (const bad of ['', '{', 'null', '{"нет":"проекта"}', '[1,2,3]']) {
      expect(() => deserializeProject(bad)).toThrow(ProjectParseError);
    }
    expect(serializeProject(project())).toBe(before);
  });
});

describe('Этап 39 · целостность данных на полном круге', () => {
  beforeEach(() => { buildProject(); });

  it('§7/§14 создать → изменить → сохранить → загрузить → экспортировать → импортировать', () => {
    const id = project().furnitures.find((f) => f.type === 'cabinet')!.id;
    // Изменение: размеры, материал, кромка.
    store().applyCabinetPatch(id, { width: 1400 });
    const part = allParts(project())[0];
    store().setPartEdge(part.id, 'left', project().edges[0].id);

    const snapshot = {
      parts: allParts(project()).map((p) => ({
        key: String(p.metadata?.key ?? p.name),
        w: p.width, h: p.height, t: p.thickness, q: p.quantity,
        material: String(p.material), edges: { ...p.edges },
      })).sort((a, b) => a.key.localeCompare(b.key)),
      operations: allOperations(project()).length,
      hardware: project().hardwareConnections.length,
    };

    // Сохранение/загрузка и экспорт/импорт идут через один формат — круг общий.
    const roundTrip = deserializeProject(serializeProject(
      deserializeProject(serializeProject(project())),
    ));

    const after = {
      parts: allParts(roundTrip).map((p) => ({
        key: String(p.metadata?.key ?? p.name),
        w: p.width, h: p.height, t: p.thickness, q: p.quantity,
        material: String(p.material), edges: { ...p.edges },
      })).sort((a, b) => a.key.localeCompare(b.key)),
      operations: allOperations(roundTrip).length,
      hardware: roundTrip.hardwareConnections.length,
    };

    expect(after).toEqual(snapshot);
  });

  it('§13 разделы согласованы между собой после круга', () => {
    const restored = deserializeProject(serializeProject(project()));
    const parts = allParts(restored);
    const spec = buildSpecification(parts, restored.materials, restored.edges);
    const production = productionParts(restored);

    expect(spec.rows).toHaveLength(parts.length);
    expect(production).toHaveLength(parts.length);

    // Материал каждой детали существует в проекте, размеры совпадают с моделью.
    const materials = new Set(restored.materials.map((m) => String(m.id)));
    for (const p of parts) expect(materials.has(String(p.material))).toBe(true);

    for (const p of parts) {
      const made = production.find((x) => String(x.partId) === String(p.id));
      expect(made).toBeDefined();
      expect(Math.max(made!.width, made!.height)).toBeCloseTo(Math.max(p.width, p.height), 2);
      expect(Math.min(made!.width, made!.height)).toBeCloseTo(Math.min(p.width, p.height), 2);
    }

    // Присадка принадлежит только существующим деталям.
    const live = new Set(parts.map((p) => String(p.id)));
    expect(allOperations(restored).every((o) => live.has(String(o.partId)))).toBe(true);
  });
});

describe('Этап 39 · undo и redo критических операций', () => {
  beforeEach(() => { buildProject(); });

  it('§15 добавление и удаление детали полностью отменяются', () => {
    const before = allParts(project()).length;

    const id = store().addElement('shelf');
    expect(allParts(project())).toHaveLength(before + 1);
    store().undo();
    expect(allParts(project())).toHaveLength(before);
    store().redo();
    expect(allParts(project())).toHaveLength(before + 1);

    store().removePart(id);
    expect(allParts(project())).toHaveLength(before);
    store().undo();
    expect(allParts(project())).toHaveLength(before + 1);
    // Деталь вернулась именно та же.
    expect(findPart(project(), id)).toBeDefined();
  });

  it('§15 размер, материал, кромка и фурнитура отменяются без следа', () => {
    const part = allParts(project())[0];
    const before = {
      w: part.width,
      material: String(part.material),
      edge: part.edges.left,
      connections: project().hardwareConnections.length,
      operations: allOperations(project()).length,
    };

    store().updatePart(part.id, { width: part.width + 100 });
    const otherMaterial = project().materials.find((m) => String(m.id) !== String(part.material))!;
    store().updatePart(part.id, { material: otherMaterial.id });
    store().setPartEdge(part.id, 'left', project().edges[0].id);

    store().undo();
    store().undo();
    store().undo();

    const after = findPart(project(), part.id)!;
    expect({
      w: after.width,
      material: String(after.material),
      edge: after.edges.left,
      connections: project().hardwareConnections.length,
      operations: allOperations(project()).length,
    }).toEqual(before);
  });

  it('§15 отмена не оставляет присадку на исчезнувших деталях', () => {
    const id = store().addElement('shelf');
    store().removePart(id);
    store().undo();
    store().undo();

    const live = new Set(allParts(project()).map((p) => String(p.id)));
    expect(allOperations(project()).every((o) => live.has(String(o.partId)))).toBe(true);
    expect(validateProjectModel(project()).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('Этап 39 · автосохранение (существующий механизм)', () => {
  beforeEach(() => { buildProject(); });

  it('§41 отказ хранилища сообщается человеку и не теряет проект', async () => {
    const statuses: string[] = [];
    const errors: string[] = [];
    const saver = createAutosaver({
      delayMs: 1,
      onStatus: (s) => statuses.push(s),
      onError: (m) => errors.push(m),
    });

    const repository = await import('@/storage/project/projectRepository');
    const save = vi.spyOn(repository, 'saveProject').mockRejectedValue(new Error('хранилище недоступно'));

    saver.schedule(project());
    await saver.flush();

    expect(statuses).toContain('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Не удалось сохранить проект/);
    // Сообщение без стека и без служебных подробностей.
    expect(errors[0]).not.toMatch(/\bat \w+\.|\.ts:\d+/);

    // Проект остался в очереди: после восстановления хранилища он сохраняется.
    save.mockResolvedValue(undefined as never);
    await saver.flush();
    expect(statuses[statuses.length - 1]).toBe('saved');
    expect(save).toHaveBeenCalledTimes(2);
    save.mockRestore();
  });
});
