import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { NumberField } from '../ui/NumberField';
import { useEditorStore } from '@/app/store/editorStore';
import type { Part, PartFace } from '@/core/model/types';
import { FACE_LABELS } from '@/i18n/machining';

export function ManualOpDialog({ part, face, onClose }: { part: Part; face: PartFace; onClose: () => void }) {
  const addOp = useEditorStore((s) => s.addManualOperation);
  const [f, setF] = useState<PartFace>(face);
  const [x, setX] = useState(100);
  const [y, setY] = useState(100);
  const [diameter, setDiameter] = useState(8);
  const [depth, setDepth] = useState(10);
  const [through, setThrough] = useState(false);

  return (
    <Modal title={`Добавить отверстие — ${part.name}`} onClose={onClose}>
      <div className="field">
        <label>Сторона</label>
        <select value={f} onChange={(e) => setF(e.target.value as PartFace)}>
          {(Object.keys(FACE_LABELS) as PartFace[]).map((k) => (
            <option key={k} value={k}>{FACE_LABELS[k]}</option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <NumberField label="X" suffix="мм" value={x} onCommit={setX} />
        <NumberField label="Y" suffix="мм" value={y} onCommit={setY} />
      </div>
      <div className="field-row">
        <NumberField label="Диаметр" suffix="мм" min={0.5} value={diameter} onCommit={setDiameter} />
        <NumberField label="Глубина" suffix="мм" min={0} value={depth} onCommit={setDepth} />
      </div>
      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={through} onChange={(e) => setThrough(e.target.checked)} />
          Сквозное
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          onClick={() => {
            addOp({ partId: part.id, face: f, x, y, diameter, depth, through });
            onClose();
          }}
        >
          Добавить
        </button>
        <button onClick={onClose}>Отмена</button>
      </div>
    </Modal>
  );
}
