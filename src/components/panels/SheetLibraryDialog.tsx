import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useEditorStore } from '@/app/store/editorStore';
import type { MaterialId } from '@/core/model/ids';
import type { GrainDirection } from '@/core/model/types';

/**
 * Библиотека форматов листов (SheetLibrary). Пользователь добавляет форматы
 * (название, размеры, толщина, материал, текстура, доступное количество).
 */
export function SheetLibraryDialog({ onClose }: { onClose: () => void }) {
  const project = useEditorStore((s) => s.project);
  const addSheet = useEditorStore((s) => s.addSheetMaterial);
  const updateSheet = useEditorStore((s) => s.updateSheetMaterial);
  const removeSheet = useEditorStore((s) => s.removeSheetMaterial);

  const firstMat = project.materials[0];
  const [materialId, setMaterialId] = useState<MaterialId | ''>(firstMat?.id ?? '');
  const [name, setName] = useState('Новый формат');
  const [height, setHeight] = useState(2750);
  const [width, setWidth] = useState(1830);
  const [qty, setQty] = useState(0);

  const materialName = (id: MaterialId) => project.materials.find((m) => m.id === id)?.name ?? '—';

  const add = () => {
    if (!materialId) return;
    const mat = project.materials.find((m) => m.id === materialId);
    addSheet({
      materialId,
      name,
      width,
      height,
      thickness: mat?.thickness ?? 16,
      grainDirection: (mat?.grain ?? 'none') as GrainDirection,
      availableQuantity: Math.max(0, qty),
      source: 'custom',
    });
  };

  return (
    <Modal title="Библиотека листов" onClose={onClose}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--dim,#9aa0a6)' }}>
            <th>Формат</th><th>Материал</th><th>Д×Ш</th><th>Толщ.</th><th>Запас</th><th></th>
          </tr>
        </thead>
        <tbody>
          {project.sheets.map((s) => (
            <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td>{s.name}</td>
              <td className="dim">{materialName(s.materialId)}</td>
              <td>{s.height}×{s.width}</td>
              <td>{s.thickness}</td>
              <td>
                <input type="number" min={0} style={{ width: 56 }} value={s.availableQuantity}
                  onChange={(e) => updateSheet(s.id, { availableQuantity: Math.max(0, Number(e.target.value) || 0) })} />
              </td>
              <td><button onClick={() => removeSheet(s.id)} style={{ color: 'var(--danger)' }}>✕</button></td>
            </tr>
          ))}
          {project.sheets.length === 0 && <tr><td colSpan={6} className="dim">Форматов нет.</td></tr>}
        </tbody>
      </table>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label className="field"><span>Название</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Материал</span>
          <select value={materialId} onChange={(e) => setMaterialId(e.target.value as MaterialId)}>
            {project.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Длина, мм</span><input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value) || 0)} /></label>
        <label className="field"><span>Ширина, мм</span><input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value) || 0)} /></label>
        <label className="field"><span>Запас (0 = ∞)</span><input type="number" min={0} value={qty} onChange={(e) => setQty(Number(e.target.value) || 0)} /></label>
      </div>
      <div style={{ marginTop: 10 }}>
        <button onClick={add} disabled={!materialId}>Добавить формат</button>
      </div>
      <p className="dim" style={{ fontSize: 11, marginTop: 8 }}>
        «Запас» ограничивает количество листов формата. Если материала не хватает — раскрой покажет предупреждение.
      </p>
    </Modal>
  );
}
