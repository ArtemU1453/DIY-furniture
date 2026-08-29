/**
 * ЭТАЛОННЫЙ ПРОЕКТ («золотой проект») — ОДИН НА ВЕСЬ ПРОЕКТ.
 *
 * Раньше он жил внутри test/production38.test.ts. Здесь он ровно тот же —
 * вынесен в общий модуль, чтобы регрессия базовой версии (baseline46) и
 * проверка согласованности разделов (production38) сверялись с ОДНИМ
 * эталоном. Второй эталонный проект не создаётся: расхождение двух эталонов
 * между собой — это и есть та ошибка, от которой они должны защищать.
 *
 * Проект задан производственными величинами (типы деталей, размеры,
 * материалы), а не идентификаторами: id и время создания у каждой сборки
 * свои, и завязываться на них нельзя.
 */
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import type { FurnitureId } from '@/core/model/ids';
import type { Part, Project } from '@/core/model/types';

export const store = () => useEditorStore.getState();
export const project = () => store().project;

/** Округление до сотых миллиметра: убирает дрожание double, не трогая размер. */
export const mm = (v: number) => Math.round(v * 100) / 100;

/** Стабильный ключ детали: конструктивная роль, а не случайный id. */
export const key = (p: Part) => String(p.metadata?.key ?? p.id);

/**
 * Шкаф 2400×2400×600 с двумя перегородками, полками и фасадами плюс тумба с
 * ящиками: в проекте есть все виды деталей, узлы корпуса и присадка.
 */
export function buildGoldenProject(): { cabinet: FurnitureId; base: FurnitureId } {
  store().newProject('Эталон производства');

  const cabinet = store().createParametricCabinet({
    type: 'CABINET', name: 'Шкаф 2400', width: 2400, height: 2400, depth: 600, thickness: 16,
  })!;
  const cabinetModel = store().getCabinetModel(cabinet)!;
  store().applyCabinetPatch(cabinet, {
    partitions: { ...cabinetModel.partitions, count: 2 },
    shelves: { ...cabinetModel.shelves, count: 4 },
    doors: { ...cabinetModel.doors, count: 3, handleEnabled: true },
  });

  const base = store().createParametricCabinet({
    type: 'BASE_UNIT', name: 'Тумба с ящиками', width: 800, height: 820, depth: 560, thickness: 16,
  })!;
  const baseModel = store().getCabinetModel(base)!;
  store().applyCabinetPatch(base, {
    drawers: { ...baseModel.drawers, count: 3 },
    doors: { ...baseModel.doors, count: 0 },
  });

  // Кромка на видимых торцах шкафа — производственные данные, не оформление.
  const edge = project().edges[0].id;
  for (const part of allParts(project())) {
    if (part.metadata?.partType === 'shelf' || part.metadata?.partType === 'facade') {
      store().setPartEdge(part.id, 'top', edge);
    }
  }

  // Ручная присадка поверх автоматической: она тоже обязана дойти до цеха.
  const side = allParts(project()).find((p) => p.metadata?.partType === 'side_left')!;
  store().addManualOperation({ partId: side.id, face: 'front', x: 120, y: 300, diameter: 8, depth: 12 });

  return { cabinet, base };
}

/** Производственный снимок детали: то, что уходит в цех. */
export function partSnapshot(p: Part, proj: Project) {
  const names = new Map<string, string>([
    ...proj.materials.map((m) => [String(m.id), m.name] as const),
    ...proj.edges.map((e) => [String(e.id), e.name] as const),
  ]);
  const nameOf = (id: unknown) => (id == null ? null : names.get(String(id)) ?? String(id));
  return {
    key: key(p),
    partType: String(p.metadata?.partType ?? ''),
    width: mm(p.width),
    height: mm(p.height),
    thickness: mm(p.thickness),
    material: nameOf(p.material),
    grain: p.grain,
    quantity: p.quantity,
    edges: {
      left: nameOf(p.edges.left), right: nameOf(p.edges.right),
      top: nameOf(p.edges.top), bottom: nameOf(p.edges.bottom),
    },
    position: { x: mm(p.position.x), y: mm(p.position.y), z: mm(p.position.z) },
  };
}

/** Снимок всего проекта: детали в устойчивом порядке — по ключу, не по id. */
export const snapshotOf = (proj: Project) =>
  allParts(proj).map((p) => partSnapshot(p, proj)).sort((a, b) => a.key.localeCompare(b.key));
