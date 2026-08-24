import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useEditorStore } from '@/app/store/editorStore';
import {
  BUILTIN_TEMPLATES,
  CATEGORY_LABELS,
  defaultValues,
  loadCustomTemplates,
  removeCustomTemplate,
  validateTemplateValues,
  type FurnitureTemplate,
  type TemplateValues,
  type TemplateIssue,
} from '@/engines/templates';

/**
 * TemplateGallery + форма параметров изделия. Выбор шаблона → ввод параметров →
 * «Создать изделие» (createFromTemplate). Живое редактирование доступно после
 * создания через панель изделия (3D обновляется на каждое изменение).
 */
export function CreateFurnitureDialog({ onClose }: { onClose: () => void }) {
  const createFromTemplate = useEditorStore((s) => s.createFromTemplate);
  const [custom, setCustom] = useState<FurnitureTemplate[]>(() => loadCustomTemplates());
  const templates = useMemo(() => [...BUILTIN_TEMPLATES, ...custom], [custom]);

  const [selected, setSelected] = useState<FurnitureTemplate | null>(null);
  const [values, setValues] = useState<TemplateValues>({});
  const [errors, setErrors] = useState<TemplateIssue[]>([]);

  const choose = (t: FurnitureTemplate) => {
    setSelected(t);
    setValues(defaultValues(t));
    setErrors([]);
  };

  const create = () => {
    if (!selected) return;
    const errs = validateTemplateValues(selected, values).filter((i) => i.severity === 'error');
    if (errs.length > 0) { setErrors(errs); return; }
    const res = createFromTemplate(selected.id, values, selected.name);
    if (!res.ok) { setErrors(res.errors ?? []); return; }
    onClose();
  };

  const deleteCustom = (id: string) => setCustom(removeCustomTemplate(id));

  return (
    <Modal title={selected ? `Параметры: ${selected.name}` : 'Библиотека конструкций'} onClose={onClose}>
      {!selected ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {templates.map((t) => (
            <div key={t.id} className="card" style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', position: 'relative' }} onClick={() => choose(t)}>
              <div style={{ fontSize: 26 }}>{t.preview ?? '📦'}</div>
              <strong>{t.name}</strong>
              <div className="dim" style={{ fontSize: 11 }}>{CATEGORY_LABELS[t.category]}</div>
              <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>{t.description}</div>
              {!t.builtin && (
                <button style={{ position: 'absolute', top: 6, right: 6, color: 'var(--danger)' }} onClick={(e) => { e.stopPropagation(); deleteCustom(t.id); }} title="Удалить шаблон">✕</button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {selected.parameters.map((param) => (
              <label key={param.id} className="field">
                <span>{param.name}{param.unit ? `, ${param.unit}` : ''}</span>
                {param.type === 'BOOLEAN' ? (
                  <input type="checkbox" checked={Boolean(values[param.id])} onChange={(e) => setValues((v) => ({ ...v, [param.id]: e.target.checked }))} />
                ) : param.type === 'ENUM' ? (
                  <select value={String(values[param.id] ?? '')} onChange={(e) => setValues((v) => ({ ...v, [param.id]: e.target.value }))}>
                    {param.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input type="number" min={param.min} max={param.max} step={param.step}
                    value={Number(values[param.id] ?? 0)}
                    onChange={(e) => setValues((v) => ({ ...v, [param.id]: Number(e.target.value) }))} />
                )}
              </label>
            ))}
          </div>
          {errors.length > 0 && (
            <div className="issue error" style={{ marginTop: 8 }}>
              <ul style={{ margin: 0, paddingLeft: 16 }}>{errors.slice(0, 6).map((e, i) => <li key={i}>{e.message}</li>)}</ul>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={create}>Создать изделие</button>
            <button onClick={() => setSelected(null)}>← К списку</button>
            <button onClick={onClose} style={{ marginLeft: 'auto' }}>Отмена</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
