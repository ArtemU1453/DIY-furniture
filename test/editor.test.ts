import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/app/store/editorStore';
import { createProject, createPart } from '@/core/model/factory';
import { allParts, findPart } from '@/core/model/selectors';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';
import { saveProject, loadProject as repoLoad, listProjects } from '@/storage/project/projectRepository';
import { validateProjectModel, runProductionCheck } from '@/engines/status';
import { isCuttingStale } from '@/engines/cutting';
import { buildSpecification } from '@/engines/bom/specification';

const store = () => useEditorStore.getState();
const project = () => store().project;
const partByType = (t: string) => allParts(project()).find((p) => p.metadata?.partType === t)!;

describe('Редактор проекта — Project Model', () => {
  beforeEach(() => {
    store().newProject('Тест');
    store().createCabinet();
  });

  it('1: новый проект создаётся с единой моделью', () => {
    store().newProject('Пустой');
    expect(project().name).toBe('Пустой');
    expect(project().version).toBeTruthy();
    expect(project().materials.length).toBeGreaterThan(0);
    expect(project().cutting).toBeDefined();
    expect(project().machining).toBeDefined();
  });

  it('2-3: сохранение и загрузка через IndexedDB', async () => {
    await saveProject(project());
    const list = await listProjects();
    expect(list.some((p) => p.id === project().id)).toBe(true);
    const loaded = await repoLoad(project().id);
    expect(loaded?.id).toBe(project().id);
    store().loadProject(loaded!);
    expect(project().id).toBe(loaded!.id);
  });

  it('4: изменение параметров пересчитывает модель', () => {
    const cabId = store().activeFurnitureId!;
    const topLen = () => { const t = partByType('top'); return Math.max(t.width, t.height); };
    const before = topLen();
    store().updateCabinetParams(cabId, { width: 1000 });
    expect(topLen()).not.toBe(before);
  });

  it('5-6: добавление и удаление детали', () => {
    const before = allParts(project()).length;
    const id = store().addElement('shelf');
    expect(allParts(project()).length).toBe(before + 1);
    store().removePart(id);
    expect(allParts(project()).length).toBe(before);
  });

  it('добавленная деталь переживает пересчёт шкафа', () => {
    const id = store().addElement('panel');
    store().updateCabinetParams(store().activeFurnitureId!, { width: 1100 });
    expect(findPart(project(), id)).toBeDefined();
  });

  it('7: дублирование создаёт новый ID и копирует поля', () => {
    const src = partByType('side_left');
    const copyId = store().duplicatePart(src.id)!;
    const copy = findPart(project(), copyId)!;
    expect(copy.id).not.toBe(src.id);
    expect(copy.width).toBe(src.width);
    expect(copy.name).toContain('копия');
    // все id уникальны
    const ids = allParts(project()).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('дубль с присадкой получает новые id операций', () => {
    const src = partByType('side_left');
    store().addManualOperation({ partId: src.id, face: 'front', x: 50, y: 50, diameter: 8, depth: 10 });
    const withOps = findPart(project(), src.id)!;
    const copyId = store().duplicatePart(src.id)!;
    const copy = findPart(project(), copyId)!;
    expect(copy.machining.length).toBe(withOps.machining.length);
    expect(copy.machining[0].id).not.toBe(withOps.machining[0].id);
  });

  it('8-9: undo и redo изменения размера', () => {
    const id = store().addElement('shelf');
    store().updatePart(id, { width: 900 });
    expect(findPart(project(), id)!.width).toBe(900);
    store().undo();
    expect(findPart(project(), id)!.width).not.toBe(900);
    store().redo();
    expect(findPart(project(), id)!.width).toBe(900);
  });

  it('10-11: экспорт и импорт JSON восстанавливают модель', () => {
    store().updateCabinetParams(store().activeFurnitureId!, { shelves: 5 });
    const json = serializeProject(project());
    const restored = deserializeProject(json);
    expect(restored).toEqual(project());
  });

  it('импорт отклоняет повреждённый файл', () => {
    expect(() => deserializeProject('{ broken')).toThrow();
  });

  it('12: ProjectValidator — валидная модель', () => {
    expect(validateProjectModel(project()).valid).toBe(true);
  });

  it('13: валидатор ловит дубль ID', () => {
    const p = createProject();
    const part = createPart({ material: p.materials[0].id });
    p.furnitures[0].assemblies[0].parts.push(part);
    p.furnitures[0].assemblies[0].parts.push({ ...part }); // тот же id
    const res = validateProjectModel(p);
    expect(res.issues.some((i) => i.code === 'part.duplicateId')).toBe(true);
    expect(res.valid).toBe(false);
  });

  it('14-15: изменение материала и кромки отражается в модели', () => {
    const side = partByType('side_left');
    const edgeId = project().edges[0].id;
    store().updatePart(side.id, { edges: { left: edgeId, right: null, top: null, bottom: null } });
    expect(findPart(project(), side.id)!.edges.left).toBe(edgeId);
    const mat = project().materials[1].id;
    store().updatePart(side.id, { material: mat });
    expect(findPart(project(), side.id)!.material).toBe(mat);
  });

  it('16: изменение присадки (ручная операция) отражается', () => {
    const side = partByType('side_left');
    const opId = store().addManualOperation({ partId: side.id, face: 'front', x: 30, y: 30, diameter: 5, depth: 8 });
    expect(findPart(project(), side.id)!.machining.some((o) => o.id === opId)).toBe(true);
  });

  it('17: изменение модели делает раскрой устаревшим', async () => {
    await store().recalculateCutting();
    expect(isCuttingStale(project())).toBe(false);
    store().updateCabinetParams(store().activeFurnitureId!, { width: 1000 });
    expect(isCuttingStale(project())).toBe(true);
  });

  it('18: документы/спецификация обновляются по модели', () => {
    const spec1 = buildSpecification(allParts(project()), project().materials, project().edges);
    const count1 = spec1.totals.uniqueParts;
    store().updateCabinetParams(store().activeFurnitureId!, { shelves: 6 });
    const spec2 = buildSpecification(allParts(project()), project().materials, project().edges);
    expect(spec2.totals.uniqueParts).toBeGreaterThan(count1);
  });

  it('19: 2D/3D синхронизированы через единый selectedPartId', () => {
    const side = partByType('side_left');
    store().selectPart(side.id);
    expect(store().selectedPartId).toBe(side.id); // общий ID для 2D/3D/дерева
    store().selectPart(null);
    expect(store().selectedPartId).toBeNull();
  });

  it('20: ProductionCheck — готов при валидной модели', () => {
    const res = runProductionCheck(project(), { cuttingRunning: false });
    expect(res.ready).toBe(true);
    expect(res.statuses.length).toBeGreaterThan(0);
  });

  it('скрытие и блокировка не удаляют деталь из модели', () => {
    const side = partByType('side_left');
    store().setPartFlag(side.id, { hidden: true, locked: true });
    const p = findPart(project(), side.id)!;
    expect(p.metadata?.hidden).toBe(true);
    expect(p.metadata?.locked).toBe(true);
    expect(findPart(project(), side.id)).toBeDefined();
  });
});
