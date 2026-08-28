/**
 * ЭТАП 35 · СРАВНЕНИЕ ПУТЕЙ СОЗДАНИЯ ШКАФА И ЗОЛОТОЙ СНИМОК.
 *
 * Проверяет главное требование этапа: все пользовательские пути создания
 * изделия обращаются к ОДНОЙ системе генерации и дают одинаковый результат.
 *
 * Сравнение структурное: идентификаторы, выбор, камера и прочие временные
 * данные не сравниваются — только то, что уходит в производство: детали, их
 * размеры, материалы, кромка, соединения, присадка, раскрой и BOM.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { buildSpecification } from '@/engines/bom/specification';
import { productionParts } from '@/engines/production';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';
import type { Project } from '@/core/model/types';
import type { FurnitureId } from '@/core/model/ids';

const store = () => useEditorStore.getState();
const project = () => store().project;

/** Округление до 0.01 мм: сравнение не должно падать из-за плавающей точки. */
const mm = (v: number) => Math.round(v * 100) / 100;

/**
 * Структурный снимок детали — без id.
 *
 * Материалы и кромка сравниваются ПО ИМЕНИ: id у каждого проекта свои, и
 * сравнение по ним ловило бы не расхождение конструкции, а случайные UUID.
 */
function partShape(
  p: {
    name: string; role: string; width: number; height: number; thickness: number;
    material: unknown; grain: string; quantity: number;
    edges: Record<string, unknown>; metadata?: Record<string, unknown> | undefined;
  },
  nameOf: (id: unknown) => string | null,
) {
  return {
    partType: String(p.metadata?.partType ?? ''),
    key: String(p.metadata?.key ?? ''),
    role: p.role,
    width: mm(p.width),
    height: mm(p.height),
    thickness: mm(p.thickness),
    material: nameOf(p.material),
    grain: p.grain,
    quantity: p.quantity,
    edges: Object.fromEntries(
      Object.entries(p.edges).map(([k, v]) => [k, nameOf(v)]),
    ),
  };
}

/**
 * Структурный снимок изделия целиком (§«компаратор»).
 *
 * Сортировка по стабильным ключам делает снимок независимым от порядка
 * генерации, а отсутствие id — от того, каким путём изделие создано.
 */
function snapshot(p: Project, furnitureId: FurnitureId) {
  const furniture = p.furnitures.find((f) => String(f.id) === String(furnitureId))!;
  const names = new Map<string, string>([
    ...p.materials.map((m) => [String(m.id), m.name] as const),
    ...p.edges.map((e) => [String(e.id), e.name] as const),
  ]);
  const nameOf = (id: unknown) => (id == null ? null : names.get(String(id)) ?? String(id));
  const parts = furniture.assemblies.flatMap((a) => a.parts);
  const partIds = new Set(parts.map((x) => String(x.id)));
  const byId = new Map(parts.map((x) => [String(x.id), x]));
  const keyOf = (id: unknown) => String(byId.get(String(id))?.metadata?.key ?? '?');

  const connections = p.hardwareConnections
    .filter((c) => partIds.has(String(c.partAId)) && partIds.has(String(c.partBId)))
    .map((c) => ({
      stableId: c.stableId ?? null,
      a: keyOf(c.partAId),
      b: keyOf(c.partBId),
      category: p.hardware.find((h) => String(h.id) === String(c.hardwareId))?.category ?? null,
      connectionType: c.connectionType ?? null,
      jointType: c.jointType ?? null,
      quantity: c.quantity,
    }))
    .sort((x, y) => `${x.a}|${x.b}|${x.stableId}`.localeCompare(`${y.a}|${y.b}|${y.stableId}`));

  const machining = allOperations(p)
    .filter((o) => partIds.has(String(o.partId)))
    .map((o) => ({
      part: keyOf(o.partId),
      type: o.type,
      face: o.face,
      x: mm(o.x),
      y: mm(o.y),
      diameter: mm(o.diameter ?? 0),
      depth: mm(o.depth ?? 0),
      through: o.through === true,
    }))
    .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));

  const spec = buildSpecification(parts, p.materials, p.edges).rows
    .map((r) => ({
      name: r.name,
      length: mm(r.length),
      width: mm(r.width),
      thickness: mm(r.thickness),
      quantity: r.quantity,
      material: r.materialName,
    }))
    .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));

  return {
    kind: furniture.type,
    sections: (furniture.sections ?? []).map((s) => ({ x: mm(s.x), width: mm(s.width) })),
    parts: parts
      .map((x) => partShape(x, nameOf))
      .sort((x, y) => x.key.localeCompare(y.key)),
    connections,
    machining,
    spec,
  };
}

/** Одинаковые параметры шкафа для всех путей. */
const PARAMS = { width: 900, height: 2000, depth: 600, thickness: 16 };

/** Путь A — мастер «Новый шкаф» (параметрический вход). */
function createViaWizard(): FurnitureId {
  return store().createParametricCabinet({ type: 'CABINET', name: 'Шкаф', ...PARAMS })!;
}

/** Путь B — панель параметров (простые параметры шкафа). */
function createViaPanel(): FurnitureId {
  const id = store().createCabinet('Шкаф');
  store().updateCabinetParams(id, PARAMS);
  return id;
}

describe('Этап 35 · оба пути создания дают один и тот же шкаф', () => {
  beforeEach(() => store().newProject('Сравнение'));

  it('пустой шкаф: путь A и путь B структурно совпадают', () => {
    const idA = createViaWizard();
    const a = snapshot(project(), idA);

    store().newProject('Сравнение');
    const idB = createViaPanel();
    const b = snapshot(project(), idB);

    expect(b).toEqual(a);
  });

  it('сложный шкаф (полки, перегородки, фасады, задняя стенка) совпадает', () => {
    const complex = { shelves: 4, dividers: 1, doors: 2 };

    const idA = createViaWizard();
    store().applyCabinetPatch(idA, {
      shelves: { ...store().getCabinetModel(idA)!.shelves, count: complex.shelves },
      partitions: { ...store().getCabinetModel(idA)!.partitions, count: complex.dividers },
      doors: { ...store().getCabinetModel(idA)!.doors, count: complex.doors, handleEnabled: true },
    });
    const a = snapshot(project(), idA);

    store().newProject('Сравнение');
    const idB = store().createCabinet('Шкаф');
    store().updateCabinetParams(idB, { ...PARAMS, ...complex });
    // Ручки включаются отдельным параметром модели — как и в мастере.
    const model = store().getCabinetModel(idB)!;
    store().applyCabinetPatch(idB, { doors: { ...model.doors, handleEnabled: true } });
    const b = snapshot(project(), idB);

    expect(b).toEqual(a);
  });

  it('изменение размера обоими путями приводит к одному результату', () => {
    const idA = createViaWizard();
    store().applyCabinetPatch(idA, { width: 1100, height: 2200 });
    const a = snapshot(project(), idA);

    store().newProject('Сравнение');
    const idB = createViaPanel();
    store().updateCabinetParams(idB, { width: 1100, height: 2200 });
    const b = snapshot(project(), idB);

    expect(b).toEqual(a);
  });

  it('шаблон «Шкаф» использует тот же генератор: детали и узлы того же вида', () => {
    const fromTemplate = store().createFromTemplate('tpl-cabinet');
    expect(fromTemplate.ok).toBe(true);
    const t = snapshot(store().project, fromTemplate.id!);

    // Ключи деталей и категории узлов — из общего движка, а не из своих правил.
    expect(t.parts.every((p) => p.key.startsWith('CABINET.'))).toBe(true);
    expect(t.connections.length).toBeGreaterThan(0);
    expect(t.connections.every((c) => c.stableId !== null)).toBe(true);
    expect(t.machining.length).toBeGreaterThan(0);
  });
});

describe('Этап 35 · золотой снимок производственных данных', () => {
  beforeEach(() => store().newProject('Эталон'));

  /**
   * Снимок задан ПРОИЗВОДСТВЕННЫМИ величинами (типы деталей и их размеры), а не
   * идентификаторами: тест ловит изменение конструкции, а не смену id.
   */
  it('шкаф 900×2000×600/16 с 3 полками даёт ожидаемый состав деталей', () => {
    const id = store().createParametricCabinet({
      type: 'CABINET', name: 'Эталон', ...PARAMS,
    })!;
    const model = store().getCabinetModel(id)!;
    store().applyCabinetPatch(id, { shelves: { ...model.shelves, count: 3 } });

    const parts = allParts(project()).map((p) => ({
      type: String(p.metadata?.partType),
      w: mm(Math.max(p.width, p.height)),
      h: mm(Math.min(p.width, p.height)),
      t: mm(p.thickness),
    }));

    const sides = parts.filter((p) => p.type.startsWith('side_'));
    expect(sides).toHaveLength(2);
    for (const s of sides) {
      expect(s.w).toBe(2000); // высота корпуса
      expect(s.h).toBe(600); // глубина
      expect(s.t).toBe(16);
    }

    for (const type of ['top', 'bottom']) {
      const horiz = parts.filter((p) => p.type === type);
      expect(horiz).toHaveLength(1);
      expect(horiz[0].w).toBe(900 - 2 * 16); // между боковинами
    }

    const shelves = parts.filter((p) => p.type === 'shelf');
    expect(shelves).toHaveLength(3);
    for (const s of shelves) {
      expect(s.w).toBe(900 - 2 * 16);
      expect(s.h).toBeLessThan(600); // полка мельче корпуса
    }

    const back = parts.filter((p) => p.type === 'back');
    expect(back).toHaveLength(1);
    expect(back[0].t).toBeLessThan(16);
  });

  it('производственные данные согласованы: номера, материалы, присадка', () => {
    store().createParametricCabinet({ type: 'CABINET', ...PARAMS });
    const rows = productionParts(project());

    expect(rows.length).toBe(allParts(project()).length);
    for (const row of rows) {
      expect(row.number).toMatch(/^P-\d{3,}$/);
      expect(row.width).toBeGreaterThan(0);
      expect(row.height).toBeGreaterThan(0);
      expect(row.thickness).toBeGreaterThan(0);
      expect(row.materialId).toBeTruthy();
    }

    // Присадка ссылается только на существующие детали.
    const ids = new Set(allParts(project()).map((p) => String(p.id)));
    for (const op of allOperations(project())) {
      expect(ids.has(String(op.partId))).toBe(true);
    }
  });

  it('шкаф переживает сохранение и загрузку без потери данных', () => {
    const id = store().createParametricCabinet({ type: 'CABINET', ...PARAMS })!;
    const before = snapshot(project(), id);

    const restored = deserializeProject(serializeProject(project()));
    expect(snapshot(restored, id)).toEqual(before);
  });
});
