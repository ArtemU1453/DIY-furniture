import { useMemo } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { findFurniture } from '@/core/model/selectors';
import { NumberField } from '../ui/NumberField';
import {
  readCabinetParameters,
  validateCabinet,
  type BackType,
  type BottomMount,
  type CabinetParameters,
  type DoorOpening,
  type JointType,
  type TopMount,
} from '@/engines/furniture/cabinet';
import { buildSpecification } from '@/engines/bom/specification';
import type { FurnitureId } from '@/core/model/ids';
import type { TemplateBinding } from '@/engines/templates';

const TOP_OPTIONS: Array<[TopMount, string]> = [
  ['between', 'Между боковинами'],
  ['overlay', 'Поверх боковин'],
];
const BOTTOM_OPTIONS: Array<[BottomMount, string]> = [
  ['between', 'Между боковинами'],
  ['under', 'Под боковинами'],
];
const BACK_OPTIONS: Array<[BackType, string]> = [
  ['none', 'Нет'],
  ['overlay', 'Накладная'],
  ['inset', 'Вкладная'],
  ['groove', 'В паз'],
];
const DOOR_OPTIONS: Array<[DoorOpening, string]> = [
  ['left', 'Левое'],
  ['right', 'Правое'],
  ['double', 'Двойное'],
];
const JOINT_OPTIONS: Array<[JointType, string]> = [
  ['confirmat', 'Конфирмат'],
  ['dowel', 'Шкант'],
  ['minifix', 'Минификс'],
];

export function CabinetPanel({ furnitureId }: { furnitureId: FurnitureId }) {
  const furniture = useEditorStore((s) => findFurniture(s.project, furnitureId));
  const materials = useEditorStore((s) => s.project.materials);
  const update = useEditorStore((s) => s.updateCabinetParams);
  const detach = useEditorStore((s) => s.detachTemplate);
  const saveAsTemplate = useEditorStore((s) => s.saveFurnitureAsTemplate);
  const binding = furniture?.metadata?.template as TemplateBinding | undefined;

  const params = useMemo(() => readCabinetParameters(furniture?.params), [furniture?.params]);
  const parts = furniture?.assemblies[0]?.parts ?? [];
  const spec = useMemo(() => buildSpecification(parts, materials), [parts, materials]);
  const issues = useMemo(() => validateCabinet(parts, params), [parts, params]);

  if (!furniture) return null;

  const set = (patch: Partial<CabinetParameters>) => update(furnitureId, patch);

  return (
    <>
      <div className="panel-section">
        <h3>Шкаф — размеры</h3>
        <div className="field-row">
          <NumberField label="Ширина" suffix="мм" min={1} value={params.width} onCommit={(v) => set({ width: v })} />
          <NumberField label="Высота" suffix="мм" min={1} value={params.height} onCommit={(v) => set({ height: v })} />
        </div>
        <div className="field-row">
          <NumberField label="Глубина" suffix="мм" min={1} value={params.depth} onCommit={(v) => set({ depth: v })} />
          <NumberField label="Толщина" suffix="мм" min={1} value={params.thickness} onCommit={(v) => set({ thickness: v })} />
        </div>
      </div>

      <div className="panel-section">
        <h3>Конструкция</h3>
        <label className="field">
          <span>Верх</span>
          <select value={params.top} onChange={(e) => set({ top: e.target.value as TopMount })}>
            {TOP_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Низ</span>
          <select value={params.bottom} onChange={(e) => set({ bottom: e.target.value as BottomMount })}>
            {BOTTOM_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <div className="field-row">
          <NumberField label="Полки (на секцию)" min={0} value={params.shelves} onCommit={(v) => set({ shelves: Math.max(0, Math.round(v)) })} />
          <NumberField label="Перегородки" min={0} value={params.dividers} onCommit={(v) => set({ dividers: Math.max(0, Math.round(v)) })} />
        </div>
        <label className="field">
          <span>Задняя стенка</span>
          <select value={params.back} onChange={(e) => set({ back: e.target.value as BackType })}>
            {BACK_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel-section">
        <h3>Фасады и соединения</h3>
        <div className="field-row">
          <NumberField label="Фасады" min={0} value={params.doors} onCommit={(v) => set({ doors: Math.max(0, Math.round(v)) })} />
          <NumberField label="Зазор фасадов" suffix="мм" min={0} value={params.doorGap} onCommit={(v) => set({ doorGap: Math.max(0, v) })} />
        </div>
        <label className="field">
          <span>Открывание</span>
          <select value={params.doorOpening} onChange={(e) => set({ doorOpening: e.target.value as DoorOpening })}>
            {DOOR_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Соединение корпуса</span>
          <select value={params.jointType} onChange={(e) => set({ jointType: e.target.value as JointType })}>
            {JOINT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="field" style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={params.handleEnabled} onChange={(e) => set({ handleEnabled: e.target.checked })} />
          <span>Ручки на фасадах</span>
        </label>
      </div>

      {binding && (
        <div className="panel-section">
          <h3>Шаблон</h3>
          <div className="dim" style={{ marginBottom: 6 }}>
            {binding.detached ? 'Отвязан от шаблона (свободное редактирование).' : `Связан с шаблоном.`}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {!binding.detached && <button onClick={() => detach(furnitureId)}>Отвязать от шаблона</button>}
            <button onClick={() => { const name = prompt('Название шаблона:', furniture.name); if (name) { saveAsTemplate(furnitureId, name); alert('Шаблон сохранён.'); } }}>Сохранить как шаблон</button>
          </div>
        </div>
      )}

      <div className="panel-section">
        <h3>Спецификация</h3>
        <div className="dim">Деталей: {spec.totals.uniqueParts} (всего {spec.totals.partCount})</div>
        <div className="dim">Площадь материала: {spec.totals.materialAreaM2.toFixed(3)} м²</div>
        <div className="dim">Длина кромки (предв.): {spec.totals.edgeLengthM.toFixed(2)} м</div>
      </div>

      {issues.length > 0 && (
        <div className="panel-section">
          <h3>Проверка</h3>
          <div className="issues">
            {issues.map((i, idx) => (
              <div key={idx} className={`issue ${i.severity === 'error' ? 'error' : 'warning'}`}>
                {i.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
