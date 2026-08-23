import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import { useEditorStore } from '@/app/store/editorStore';
import { validateHardware } from '@/core/validation/catalog';
import { HARDWARE_CATEGORY_LABELS } from '@/i18n/catalog';
import type { Hardware, HardwareCategory } from '@/core/model/types';

interface Props {
  hardware: Hardware;
  isNew: boolean;
  onClose: () => void;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

export function HardwareEditor({ hardware, isNew, onClose }: Props) {
  const [draft, setDraft] = useState<Hardware>(hardware);
  const [error, setError] = useState('');
  const addHardware = useEditorStore((s) => s.addHardware);
  const updateHardware = useEditorStore((s) => s.updateHardware);
  const removeHardware = useEditorStore((s) => s.removeHardware);

  const patch = (p: Partial<Hardware>) => setDraft((d) => ({ ...d, ...p }));
  const setParam = (key: string, value: number) =>
    setDraft((d) => ({ ...d, parameters: { ...d.parameters, [key]: value } }));

  const save = () => {
    const issues = validateHardware(draft);
    if (issues.length > 0) {
      setError(issues[0].message);
      return;
    }
    if (isNew) addHardware(draft);
    else updateHardware(draft.id, draft);
    onClose();
  };

  const remove = () => {
    const res = removeHardware(draft.id);
    if (!res.ok) setError(res.message ?? 'Удаление невозможно.');
    else onClose();
  };

  const params = draft.parameters ?? {};

  return (
    <Modal title={isNew ? 'Новая фурнитура' : 'Фурнитура'} onClose={onClose}>
      <TextField label="Название" value={draft.name} onCommit={(v) => patch({ name: v })} />
      <div className="field">
        <label>Категория</label>
        <select value={draft.category} onChange={(e) => patch({ category: e.target.value as HardwareCategory })}>
          {(Object.keys(HARDWARE_CATEGORY_LABELS) as HardwareCategory[]).map((c) => (
            <option key={c} value={c}>{HARDWARE_CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <TextField label="Производитель" value={draft.manufacturer ?? ''} onCommit={(v) => patch({ manufacturer: v || undefined })} />
        <TextField label="Модель" value={draft.model ?? ''} onCommit={(v) => patch({ model: v || undefined })} />
      </div>
      <div className="field-row">
        <NumberField label="Диаметр" suffix="мм" min={0} step={0.5} value={num(params.diameter)} onCommit={(v) => setParam('diameter', v)} />
        <NumberField label="Длина" suffix="мм" min={0} value={num(params.length)} onCommit={(v) => setParam('length', v)} />
      </div>
      <NumberField label="Диаметр головки" suffix="мм" min={0} step={0.5} value={num(params.headDiameter)} onCommit={(v) => setParam('headDiameter', v)} />

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
