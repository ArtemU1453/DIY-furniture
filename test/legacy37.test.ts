/**
 * ЭТАП 37 · ОБРАТНАЯ СОВМЕСТИМОСТЬ СО СТАРЫМИ ПРОЕКТАМИ.
 *
 * Проекты прошлых этапов хранят параметры шкафа как CabinetParameters, где
 * верх и низ настраивались НЕЗАВИСИМО:
 *
 *   sideY.min = bottom === 'under'   ? t : 0
 *   sideY.max = top    === 'overlay' ? H − t : H
 *   верх по ширине:  overlay → [0, W],  between → [t, W − t]
 *   низ  по ширине:  under   → [0, W],  between → [t, W − t]
 *
 * Тест проверяет, что открытие такого проекта НЕ меняет производственную
 * геометрию: те же детали, размеры, позиции, толщины и материалы.
 * Эталон считается формулами старого движка, а не текущим кодом, — иначе
 * тест подтверждал бы сам себя.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import { createProject, createFurniture, createAssembly } from '@/core/model/factory';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';
import { readParametricModel, generateParts, constructionMounts } from '@/engines/parametric';
import { readCabinetParameters, defaultCabinetParameters } from '@/engines/furniture/cabinet';
import type { CabinetParameters, TopMount, BottomMount } from '@/engines/furniture/cabinet';
import type { Part, Project } from '@/core/model/types';

const store = () => useEditorStore.getState();
const mm = (v: number) => Math.round(v * 100) / 100;

/** Все четыре схемы, существовавшие в старых проектах. */
const SCHEMES: Array<{ name: string; top: TopMount; bottom: BottomMount }> = [
  { name: 'верх и низ между боковинами', top: 'between', bottom: 'between' },
  { name: 'верх и низ поверх боковин', top: 'overlay', bottom: 'under' },
  { name: 'смешанная: верх поверх, низ между', top: 'overlay', bottom: 'between' },
  { name: 'смешанная: верх между, низ под боковинами', top: 'between', bottom: 'under' },
];

/**
 * Эталон СТАРОГО движка: формулы выписаны из engines/furniture/cabinet
 * (context.ts + rules.ts) до объединения генераторов на этапе 35.
 */
function legacyGeometry(p: CabinetParameters) {
  const { width: W, height: H, depth: D, thickness: t } = p;
  const sideY = { min: p.bottom === 'under' ? t : 0, max: p.top === 'overlay' ? H - t : H };
  const topX = p.top === 'overlay' ? { min: 0, max: W } : { min: t, max: W - t };
  const bottomX = p.bottom === 'under' ? { min: 0, max: W } : { min: t, max: W - t };
  const plate = (x: { min: number; max: number }) => ({
    long: x.max - x.min, short: D, thickness: t,
  });
  return {
    side: { long: sideY.max - sideY.min, short: D, thickness: t },
    sideY,
    top: plate(topX),
    bottom: plate(bottomX),
    topX,
    bottomX,
  };
}

/** Старый проект: параметры лежат в params БЕЗ параметрической модели. */
function legacyProject(over: Partial<CabinetParameters>): { project: Project; params: CabinetParameters } {
  const project = createProject({ name: 'Старый проект' });
  const params: CabinetParameters = {
    ...defaultCabinetParameters({ material: project.materials[0].id }),
    width: 800, height: 2000, depth: 600, thickness: 16,
    shelves: 2, dividers: 0, doors: 0,
    backMaterial: project.materials.find((m) => m.thickness < 10)?.id ?? null,
    ...over,
  };
  const furniture = createFurniture('Шкаф из старого проекта');
  furniture.type = 'cabinet';
  furniture.assemblies = [createAssembly('Корпус')];
  // Именно так параметры хранились раньше: плоский объект, без 'parametric'.
  furniture.params = params as unknown as Record<string, unknown>;
  project.furnitures = [furniture];
  return { project, params };
}

/** Детали, которые построит текущий движок для старого изделия. */
function generatedParts(project: Project): Part[] {
  const furniture = project.furnitures[0];
  return generateParts(readParametricModel(furniture), []).parts;
}

const byType = (parts: Part[], type: string) => parts.find((p) => p.metadata?.partType === type)!;
const planeLong = (p: Part) => mm(Math.max(p.width, p.height));
const planeShort = (p: Part) => mm(Math.min(p.width, p.height));

describe('Этап 37 · старый проект открывается без изменения геометрии', () => {
  for (const scheme of SCHEMES) {
    it(`${scheme.name}: детали совпадают со старым движком`, () => {
      const { project, params } = legacyProject({ top: scheme.top, bottom: scheme.bottom });
      const expected = legacyGeometry(params);
      const parts = generatedParts(project);

      const side = byType(parts, 'side_left');
      expect(planeLong(side)).toBe(mm(expected.side.long));
      expect(planeShort(side)).toBe(mm(expected.side.short));
      expect(mm(side.thickness)).toBe(mm(expected.side.thickness));

      const top = byType(parts, 'top');
      expect(planeLong(top)).toBe(mm(expected.top.long));
      expect(mm(top.thickness)).toBe(mm(expected.top.thickness));

      const bottom = byType(parts, 'bottom');
      expect(planeLong(bottom)).toBe(mm(expected.bottom.long));
      expect(mm(bottom.thickness)).toBe(mm(expected.bottom.thickness));

      // Материал корпуса сохранён.
      expect(String(side.material)).toBe(String(params.material));
    });

    it(`${scheme.name}: позиции деталей совпадают со старым движком`, () => {
      const { project, params } = legacyProject({ top: scheme.top, bottom: scheme.bottom });
      const expected = legacyGeometry(params);
      const parts = generatedParts(project);

      // Центр боковины по высоте — прямое следствие схемы верха и низа.
      const side = byType(parts, 'side_left');
      expect(mm(side.position.y)).toBe(mm((expected.sideY.min + expected.sideY.max) / 2));

      // Центр верха и низа по ширине: в координатах изделия X отсчитывается
      // от середины, поэтому сравниваем со смещением на половину ширины.
      const top = byType(parts, 'top');
      expect(mm(top.position.x))
        .toBe(mm((expected.topX.min + expected.topX.max) / 2 - params.width / 2));
      const bottom = byType(parts, 'bottom');
      expect(mm(bottom.position.x))
        .toBe(mm((expected.bottomX.min + expected.bottomX.max) / 2 - params.width / 2));
    });

    it(`${scheme.name}: схема сохраняется при чтении параметров обратно`, () => {
      const { project, params } = legacyProject({ top: scheme.top, bottom: scheme.bottom });
      const model = readParametricModel(project.furnitures[0]);
      const mounts = constructionMounts(model.construction);

      expect(mounts.topOnSides).toBe(params.top === 'overlay');
      expect(mounts.bottomUnder).toBe(params.bottom === 'under');

      // Обратное чтение возвращает те же значения, а не «выпрямленную» схему.
      const back = readCabinetParameters({ parametric: model } as Record<string, unknown>);
      expect(back.top).toBe(params.top);
      expect(back.bottom).toBe(params.bottom);
    });
  }
});

describe('Этап 37 · загрузка, сохранение и повторное открытие старого проекта', () => {
  beforeEach(() => store().newProject('Проверка'));

  for (const scheme of SCHEMES) {
    it(`${scheme.name}: round trip не меняет геометрию`, () => {
      const { project } = legacyProject({ top: scheme.top, bottom: scheme.bottom });

      // Загрузка старого проекта в приложение.
      store().loadProject(deserializeProject(serializeProject(project)));
      const id = store().project.furnitures[0].id;

      // Пересчёт деталей текущим движком — как при первом открытии.
      const model = store().getParametricModel(id)!;
      const applied = store().applyParametricModel(id, model);
      expect(applied.ok).toBe(true);

      const first = allParts(store().project).map(
        (p) => `${p.metadata?.key}|${planeLong(p)}x${planeShort(p)}x${mm(p.thickness)}|${mm(p.position.x)},${mm(p.position.y)},${mm(p.position.z)}`,
      ).sort();

      // Сохранение и повторное открытие.
      const reloaded = deserializeProject(serializeProject(store().project));
      store().loadProject(reloaded);
      const second = allParts(store().project).map(
        (p) => `${p.metadata?.key}|${planeLong(p)}x${planeShort(p)}x${mm(p.thickness)}|${mm(p.position.x)},${mm(p.position.y)},${mm(p.position.z)}`,
      ).sort();

      expect(second).toEqual(first);
    });
  }

  it('старый проект сохраняет соединения и присадку своей схемы', () => {
    const { project } = legacyProject({ top: 'overlay', bottom: 'between' });
    store().loadProject(project);
    const id = store().project.furnitures[0].id;
    const applied = store().applyParametricModel(id, store().getParametricModel(id)!);
    expect(applied.ok).toBe(true);

    const parts = allParts(store().project);
    const ownIds = new Set(parts.map((p) => String(p.id)));
    const connections = store().project.hardwareConnections.filter(
      (c) => ownIds.has(String(c.partAId)) && ownIds.has(String(c.partBId)),
    );
    expect(connections.length).toBeGreaterThan(0);

    /* Смешанная схема: крыша накрывает боковины, дно входит между ними —
     * значит и узлы у них разные. */
    const keyOf = (partId: unknown) =>
      String(parts.find((p) => String(p.id) === String(partId))?.metadata?.partType ?? '');
    const topConn = connections.find((c) => keyOf(c.partAId) === 'top' || keyOf(c.partBId) === 'top')!;
    const bottomConn = connections.find((c) => keyOf(c.partAId) === 'bottom' || keyOf(c.partBId) === 'bottom')!;
    expect(String(topConn.stableId)).toContain('on-sides');
    expect(String(bottomConn.stableId)).toContain('between-sides');
  });

  it('новый проект по умолчанию использует схему «между боковинами»', () => {
    const id = store().createParametricCabinet({ type: 'CABINET', width: 800, height: 2000, depth: 600 })!;
    const model = store().getCabinetModel(id)!;
    expect(model.construction).toBe('BETWEEN_SIDES');
  });

  it('смена только верха не трогает низ и наоборот', () => {
    const id = store().createCabinet('Шкаф');
    store().updateCabinetParams(id, { top: 'overlay' });
    let params = readCabinetParameters(
      store().project.furnitures.find((f) => String(f.id) === String(id))!.params,
    );
    expect(params.top).toBe('overlay');
    expect(params.bottom).toBe('between');

    store().updateCabinetParams(id, { bottom: 'under' });
    params = readCabinetParameters(
      store().project.furnitures.find((f) => String(f.id) === String(id))!.params,
    );
    expect(params.top).toBe('overlay');
    expect(params.bottom).toBe('under');

    store().updateCabinetParams(id, { top: 'between' });
    params = readCabinetParameters(
      store().project.furnitures.find((f) => String(f.id) === String(id))!.params,
    );
    expect(params.top).toBe('between');
    expect(params.bottom).toBe('under');
  });
});
