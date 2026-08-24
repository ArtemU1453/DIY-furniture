import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import type { HardwareId, PartId } from '@/core/model/ids';

export function ConnectionDialog({ onClose }: { onClose: () => void }) {
  const project = useEditorStore((s) => s.project);
  const addConnection = useEditorStore((s) => s.addConnection);
  const parts = useMemo(() => allParts(project), [project]);

  const [hardwareId, setHardwareId] = useState<HardwareId | ''>(project.hardware[0]?.id ?? '');
  const [partAId, setPartAId] = useState<PartId | ''>('');
  const [partBId, setPartBId] = useState<PartId | ''>('');
  const [quantity, setQuantity] = useState(2);
  const [error, setError] = useState('');

  const partLabel = (id: string) => {
    const p = parts.find((x) => x.id === id);
    return p ? `${p.metadata?.number ?? ''} ${p.name}`.trim() : '';
  };

  const create = () => {
    if (!hardwareId || !partAId || !partBId) {
      setError('Выберите фурнитуру и обе детали.');
      return;
    }
    const res = addConnection({ hardwareId, partAId, partBId, quantity: Math.max(1, quantity) });
    if (!res.ok) setError(res.message ?? 'Не удалось создать соединение.');
    else onClose();
  };

  return (
    <Modal title="Новое соединение" onClose={onClose}>
      <div className="field">
        <label>Тип фурнитуры</label>
        <select value={hardwareId} onChange={(e) => setHardwareId(e.target.value as HardwareId)}>
          <option value="">— выберите —</option>
          {project.hardware.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Деталь A</label>
        <select value={partAId} onChange={(e) => setPartAId(e.target.value as PartId)}>
          <option value="">— выберите —</option>
          {parts.map((p) => (
            <option key={p.id} value={p.id}>{partLabel(p.id)}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Деталь B</label>
        <select value={partBId} onChange={(e) => setPartBId(e.target.value as PartId)}>
          <option value="">— выберите —</option>
          {parts.map((p) => (
            <option key={p.id} value={p.id}>{partLabel(p.id)}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Количество крепежа</label>
        <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)} />
      </div>

      {error && <div className="issue error">{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={create}>Создать соединение</button>
        <button onClick={onClose}>Отмена</button>
      </div>
    </Modal>
  );
}
