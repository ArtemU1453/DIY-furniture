import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, totalPartCount } from '@/core/model/selectors';

function reset() {
  useEditorStore.getState().newProject('Тест');
}

describe('Project store — CRUD и история', () => {
  beforeEach(reset);

  it('создаёт проект с изделием и материалом по умолчанию', () => {
    const { project } = useEditorStore.getState();
    expect(project.name).toBe('Тест');
    expect(project.furnitures).toHaveLength(1);
    expect(project.materials.length).toBeGreaterThan(0);
  });

  it('добавляет и удаляет деталь', () => {
    const id = useEditorStore.getState().addPart({ name: 'Боковина' });
    expect(allParts(useEditorStore.getState().project)).toHaveLength(1);

    useEditorStore.getState().removePart(id);
    expect(allParts(useEditorStore.getState().project)).toHaveLength(0);
  });

  it('изменяет размеры детали', () => {
    const id = useEditorStore.getState().addPart({ width: 800 });
    useEditorStore.getState().updatePart(id, { width: 900 });
    const part = allParts(useEditorStore.getState().project).find((p) => p.id === id);
    expect(part?.width).toBe(900);
  });

  it('учитывает количество в totalPartCount', () => {
    useEditorStore.getState().addPart({ quantity: 3 });
    expect(totalPartCount(useEditorStore.getState().project)).toBe(3);
  });

  it('undo/redo отменяет и повторяет изменение размера', () => {
    const store = useEditorStore.getState();
    const id = store.addPart({ width: 800 });
    store.updatePart(id, { width: 900 });

    const get = () => allParts(useEditorStore.getState().project).find((p) => p.id === id);
    expect(get()?.width).toBe(900);

    useEditorStore.getState().undo();
    expect(get()?.width).toBe(800);

    useEditorStore.getState().redo();
    expect(get()?.width).toBe(900);
  });

  it('undo отменяет добавление детали', () => {
    useEditorStore.getState().addPart();
    expect(allParts(useEditorStore.getState().project)).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(allParts(useEditorStore.getState().project)).toHaveLength(0);
  });

  it('canUndo/canRedo отражают состояние истории', () => {
    expect(useEditorStore.getState().canUndo()).toBe(false);
    useEditorStore.getState().addPart();
    expect(useEditorStore.getState().canUndo()).toBe(true);
    expect(useEditorStore.getState().canRedo()).toBe(false);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().canRedo()).toBe(true);
  });
});
