import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { readCabinetParameters } from '@/engines/furniture/cabinet';
import { allParts } from '@/core/model/selectors';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';

function activeCabinet() {
  const s = useEditorStore.getState();
  return s.project.furnitures.find((f) => f.id === s.activeFurnitureId)!;
}

describe('Store — параметрический шкаф', () => {
  beforeEach(() => useEditorStore.getState().newProject('Тест'));

  it('createCabinet добавляет изделие типа cabinet с деталями', () => {
    const id = useEditorStore.getState().createCabinet();
    const f = useEditorStore.getState().project.furnitures.find((x) => x.id === id)!;
    expect(f.type).toBe('cabinet');
    expect(f.assemblies[0].parts.length).toBeGreaterThan(0);
    expect(f.sections?.length).toBe(1);
  });

  it('изменение ширины пересчитывает детали, сохраняя стабильные id', () => {
    const id = useEditorStore.getState().createCabinet();
    const before = activeCabinet().assemblies[0].parts;
    const sideBefore = before.find((p) => p.metadata?.partType === 'side_left')!;

    useEditorStore.getState().updateCabinetParams(id, { width: 1000 });

    const after = activeCabinet().assemblies[0].parts;
    const sideAfter = after.find((p) => p.metadata?.partType === 'side_left')!;
    const topAfter = after.find((p) => p.metadata?.partType === 'top')!;

    expect(sideAfter.id).toBe(sideBefore.id); // стабильный id
    expect(Math.max(topAfter.width, topAfter.height)).toBe(968); // пересчитано
  });

  it('добавление полок увеличивает количество деталей', () => {
    const id = useEditorStore.getState().createCabinet();
    useEditorStore.getState().updateCabinetParams(id, { shelves: 0 });
    const zero = allParts(useEditorStore.getState().project).length;
    useEditorStore.getState().updateCabinetParams(id, { shelves: 4 });
    const four = allParts(useEditorStore.getState().project).length;
    expect(four - zero).toBe(4);
  });

  it('изменение параметров проходит через undo/redo', () => {
    const id = useEditorStore.getState().createCabinet();
    useEditorStore.getState().updateCabinetParams(id, { width: 1200 });
    expect(readCabinetParameters(activeCabinet().params).width).toBe(1200);
    useEditorStore.getState().undo();
    expect(readCabinetParameters(activeCabinet().params).width).toBe(800);
    useEditorStore.getState().redo();
    expect(readCabinetParameters(activeCabinet().params).width).toBe(1200);
  });

  it('Тест 7/8: параметры и детали переживают JSON round-trip', () => {
    const id = useEditorStore.getState().createCabinet();
    useEditorStore.getState().updateCabinetParams(id, { width: 900, height: 2200, shelves: 2 });

    const original = useEditorStore.getState().project;
    const restored = deserializeProject(serializeProject(original));

    expect(restored).toEqual(original);
    const cab = restored.furnitures.find((f) => f.id === id)!;
    const params = readCabinetParameters(cab.params);
    expect(params.width).toBe(900);
    expect(params.height).toBe(2200);
    expect(params.shelves).toBe(2);
    // детали сохранены как часть проекта
    expect(cab.assemblies[0].parts.length).toBeGreaterThan(0);
  });

  it('параметры сохраняются в JSON именно как параметры (не только детали)', () => {
    const id = useEditorStore.getState().createCabinet();
    const json = serializeProject(useEditorStore.getState().project);
    const obj = JSON.parse(json);
    const cab = obj.furnitures.find((f: { id: string }) => f.id === id);
    // Источник истины — параметрическая модель изделия (этап 35).
    expect(cab.params.parametric.width).toBe(800);
    expect(cab.params.parametric.thickness).toBeGreaterThan(0);
    // Простые параметры шкафа выводятся из неё без потери смысла.
    const params = readCabinetParameters(cab.params);
    expect(params.width).toBe(800);
    expect(params.construction).toBeDefined();
  });
});
