import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import { useEditorStore } from '@/app/store/editorStore';
import { validateEdge } from '@/core/validation/catalog';
import type { EdgeMaterial } from '@/core/model/types';

interface Props {
  edge: EdgeMaterial;
  isNew: boolean;
  onClose: () => void;
}

export function EdgeEditor({ edge, isNew, onClose }: Props) {
  const [draft, setDraft] = useState<EdgeMaterial>(edge);
  const [error, setError] = useState('');
  const addEdge = useEditorStore((s) => s.addEdge);
  const updateEdge = useEditorStore((s) => s.updateEdge);
  const removeEdge = useEditorStore((s) => s.removeEdge);

  const patch = (p: Partial<EdgeMaterial>) => setDraft((d) => ({ ...d, ...p }));

  const save = () => {
    const issues = validateEdge(draft);
    if (issues.length > 0) {
      setError(issues[0].message);
      return;
    }
    if (isNew) addEdge(draft);
    else updateEdge(draft.id, draft);
    onClose();
  };

  const remove = () => {
    const res = removeEdge(draft.id);
    if (!res.ok) setError(res.message ?? 'Удаление невозможно.');
    else onClose();
  };

  return (
    <Modal title={isNew ? 'Новая кромка' : 'Кромка'} onClose={onClose}>
      <TextField label="Название" value={draft.name} onCommit={(v) => patch({ name: v })} />
      <div className="field-row">
        <NumberField label="Толщина" suffix="мм" min={0.1} step={0.1} value={draft.thickness} onCommit={(v) => patch({ thickness: v })} />
        <NumberField label="Ширина ленты" suffix="мм" min={1} value={draft.width ?? 0} onCommit={(v) => patch({ width: v })} />
      </div>
      <div className="field">
        <label>Цвет</label>
        <input type="color" value={draft.color} onChange={(e) => patch({ color: e.target.value })} style={{ height: 30, padding: 2 }} />
      </div>

      {error && <div className="issue error">{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={save}>Сохранить</button>
        <button onClick={onClose}>Отмена</button>
        {!isNew && (
          <button onClick={remove} style={{ marginLeft: 'auto', color: 'var(--danger)' }}>
            Удалить
          </button>
        )}
      </div>
    </Modal>
  );
}
