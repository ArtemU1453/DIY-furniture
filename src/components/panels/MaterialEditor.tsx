import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import { useEditorStore } from '@/app/store/editorStore';
import { validateMaterial } from '@/core/validation/catalog';
import { MATERIAL_KIND_LABELS } from '@/i18n/catalog';
import type { GrainDirection, Material, MaterialKind } from '@/core/model/types';

interface Props {
  material: Material;
  isNew: boolean;
  onClose: () => void;
}

export function MaterialEditor({ material, isNew, onClose }: Props) {
  const [draft, setDraft] = useState<Material>(material);
  const [error, setError] = useState('');
  const addMaterial = useEditorStore((s) => s.addMaterial);
  const updateMaterial = useEditorStore((s) => s.updateMaterial);
  const removeMaterial = useEditorStore((s) => s.removeMaterial);

  const patch = (p: Partial<Material>) => setDraft((d) => ({ ...d, ...p }));

  const save = () => {
    const issues = validateMaterial(draft);
    if (issues.length > 0) {
      setError(issues[0].message);
      return;
    }
    if (isNew) addMaterial(draft);
    else updateMaterial(draft.id, draft);
    onClose();
  };

  const remove = () => {
    const res = removeMaterial(draft.id);
    if (!res.ok) setError(res.message ?? 'Удаление невозможно.');
    else onClose();
  };

  return (
    <Modal title={isNew ? 'Новый материал' : 'Материал'} onClose={onClose}>
      <TextField label="Название" value={draft.name} onCommit={(v) => patch({ name: v })} />
      <div className="field">
        <label>Категория</label>
        <select value={draft.kind} onChange={(e) => patch({ kind: e.target.value as MaterialKind })}>
          {(Object.keys(MATERIAL_KIND_LABELS) as MaterialKind[]).map((k) => (
            <option key={k} value={k}>{MATERIAL_KIND_LABELS[k]}</option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <NumberField label="Толщина" suffix="мм" min={0.1} value={draft.thickness} onCommit={(v) => patch({ thickness: v })} />
        <NumberField label="Плотность" suffix="кг/м³" min={0} value={draft.density ?? 0} onCommit={(v) => patch({ density: v })} />
      </div>
      <div className="field-row">
        <NumberField label="Длина листа" suffix="мм" min={1} value={draft.sheet.length} onCommit={(v) => patch({ sheet: { ...draft.sheet, length: v } })} />
        <NumberField label="Ширина листа" suffix="мм" min={1} value={draft.sheet.width} onCommit={(v) => patch({ sheet: { ...draft.sheet, width: v } })} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Направление текстуры</label>
          <select value={draft.grain} onChange={(e) => patch({ grain: e.target.value as GrainDirection })}>
            <option value="none">Нет</option>
            <option value="length">Вдоль листа</option>
            <option value="width">Поперёк листа</option>
          </select>
        </div>
        <NumberField label="Пропил (kerf)" suffix="мм" min={0} step={0.1} value={draft.kerf ?? 0} onCommit={(v) => patch({ kerf: v })} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Поворот деталей</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={draft.allowRotate} onChange={(e) => patch({ allowRotate: e.target.checked })} />
            разрешён
          </label>
        </div>
        <div className="field">
          <label>Цвет</label>
          <input type="color" value={draft.color} onChange={(e) => patch({ color: e.target.value })} style={{ height: 30, padding: 2 }} />
        </div>
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
