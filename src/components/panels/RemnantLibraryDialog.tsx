import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useEditorStore } from '@/app/store/editorStore';
import type { MaterialId } from '@/core/model/ids';
import type { GrainDirection } from '@/core/model/types';

/**
 * Библиотека остатков (RemnantLibrary). Сохранённые остатки можно добавить
 * вручную, удалить или переиспользовать в будущем раскрое (настройка
 * «Использовать остатки»).
 */
export function RemnantLibraryDialog({ onClose }: { onClose: () => void }) {
  const project = useEditorStore((s) => s.project);
  const saveRemnant = useEditorStore((s) => s.saveRemnant);
  const removeRemnant = useEditorStore((s) => s.removeRemnant);
  const clearRemnants = useEditorStore((s) => s.clearRemnants);
  const saveUsable = useEditorStore((s) => s.saveUsableRemnantsFromResult);

  const firstMat = project.materials[0];
  const [materialId, setMaterialId] = useState<MaterialId | ''>(firstMat?.id ?? '');
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(300);

  const materialName = (id: MaterialId) => project.materials.find((m) => m.id === id)?.name ?? '—';

  const add = () => {
    if (!materialId) return;
    const mat = project.materials.find((m) => m.id === materialId);
    saveRemnant({
      materialId,
      thickness: mat?.thickness ?? 16,
      width,
      height,
      grainDirection: (mat?.grain ?? 'none') as GrainDirection,
      sourceSheetId: 'manual',
    });
  };

  return (
    <Modal title="Библиотека остатков" onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={() => { const n = saveUsable(); if (n) alert(`Добавлено остатков из раскроя: ${n}`); else alert('Полезных остатков в текущем раскрое нет.'); }}>
          Забрать полезные из раскроя
        </button>
        {project.remnants.length > 0 && <button onClick={clearRemnants} style={{ color: 'var(--danger)' }}>Очистить</button>}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--dim,#9aa0a6)' }}>
            <th>Материал</th><th>Ш×В</th><th>Толщ.</th><th>Дата</th><th></th>
          </tr>
        </thead>
        <tbody>
          {project.remnants.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td className="dim">{materialName(r.materialId)}</td>
              <td>{r.width}×{r.height}</td>
              <td>{r.thickness}</td>
              <td className="dim">{r.createdAt.slice(0, 10)}</td>
              <td><button onClick={() => removeRemnant(r.id)} style={{ color: 'var(--danger)' }}>✕</button></td>
            </tr>
          ))}
          {project.remnants.length === 0 && <tr><td colSpan={5} className="dim">Остатков нет.</td></tr>}
        </tbody>
      </table>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <label className="field"><span>Материал</span>
          <select value={materialId} onChange={(e) => setMaterialId(e.target.value as MaterialId)}>
            {project.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Ширина, мм</span><input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value) || 0)} /></label>
        <label className="field"><span>Высота, мм</span><input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value) || 0)} /></label>
      </div>
      <div style={{ marginTop: 10 }}>
        <button onClick={add} disabled={!materialId}>Добавить остаток</button>
      </div>
      <p className="dim" style={{ fontSize: 11, marginTop: 8 }}>
        Чтобы остатки использовались автоматически, включите «Использовать остатки» в параметрах раскроя.
      </p>
    </Modal>
  );
}
