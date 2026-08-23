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
  type TopMount,
} from '@/engines/furniture/cabinet';
import { buildSpecification } from '@/engines/bom/specification';
import type { FurnitureId } from '@/core/model/ids';

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

export function CabinetPanel({ furnitureId }: { furnitureId: FurnitureId }) {
  const furniture = useEditorStore((s) => findFurniture(s.project, furnitureId));
  const materials = useEditorStore((s) => s.project.materials);
  const update = useEditorStore((s) => s.updateCabinetParams);

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
        <div className="field">
          <label>Верх</label>
          <select value={params.top} onChange={(e) => set({ top: e.target.value as TopMount })}>
            {TOP_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Низ</label>
          <select value={params.bottom} onChange={(e) => set({ bottom: e.target.value as BottomMount })}>
            {BOTTOM_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <NumberField label="Полки (на секцию)" min={0} value={params.shelves} onCommit={(v) => set({ shelves: Math.max(0, Math.round(v)) })} />
          <NumberField label="Перегородки" min={0} value={params.dividers} onCommit={(v) => set({ dividers: Math.max(0, Math.round(v)) })} />
        </div>
        <div className="field">
          <label>Задняя стенка</label>
          <select value={params.back} onChange={(e) => set({ back: e.target.value as BackType })}>
            {BACK_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>

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
