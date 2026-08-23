import { useEditorStore } from '@/app/store/editorStore';
import { findPart } from '@/core/model/selectors';
import { validatePart } from '@/core/validation';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import type { EdgeSide } from '@/core/model/types';

const EDGE_LABELS: Array<[EdgeSide, string]> = [
  ['left', 'Левая'],
  ['right', 'Правая'],
  ['top', 'Верхняя'],
  ['bottom', 'Нижняя'],
];

export function PropertiesPanel() {
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const part = useEditorStore((s) => (selectedPartId ? findPart(s.project, selectedPartId) : undefined));
  const materials = useEditorStore((s) => s.project.materials);
  const edges = useEditorStore((s) => s.project.edges);
  const updatePart = useEditorStore((s) => s.updatePart);
  const removePart = useEditorStore((s) => s.removePart);

  if (!part) {
    return (
      <div className="panel-section">
        <h3>Свойства</h3>
        <div className="empty-hint">Выберите деталь в 3D или в списке слева.</div>
      </div>
    );
  }

  const issues = validatePart(part);

  return (
    <>
      <div className="panel-section">
        <h3>Деталь</h3>
        <TextField label="Название" value={part.name} onCommit={(v) => updatePart(part.id, { name: v })} />
        <div className="field-row">
          <NumberField
            label="Ширина"
            suffix="мм"
            min={1}
            value={part.width}
            onCommit={(v) => updatePart(part.id, { width: v })}
          />
          <NumberField
            label="Высота"
            suffix="мм"
            min={1}
            value={part.height}
            onCommit={(v) => updatePart(part.id, { height: v })}
          />
        </div>
        <div className="field-row">
          <NumberField
            label="Толщина"
            suffix="мм"
            min={1}
            value={part.thickness}
            onCommit={(v) => updatePart(part.id, { thickness: v })}
          />
          <NumberField
            label="Количество"
            min={1}
            value={part.quantity}
            onCommit={(v) => updatePart(part.id, { quantity: Math.max(1, Math.round(v)) })}
          />
        </div>
        <div className="field">
          <label>Материал</label>
          <select
            value={part.material ?? ''}
            onChange={(e) =>
              updatePart(part.id, {
                material: e.target.value ? (e.target.value as typeof part.material) : null,
              })
            }
          >
            <option value="">— не задан —</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {issues.length > 0 && (
          <div className="issues">
            {issues.map((i, idx) => (
              <div key={idx} className={`issue ${i.severity}`}>
                {i.message}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel-section">
        <h3>Кромка</h3>
        {EDGE_LABELS.map(([side, label]) => (
          <div className="field" key={side}>
            <label>{label}</label>
            <select
              value={part.edges[side] ?? ''}
              onChange={(e) =>
                updatePart(part.id, {
                  edges: {
                    ...part.edges,
                    [side]: e.target.value ? (e.target.value as never) : null,
                  },
                })
              }
            >
              <option value="">Нет</option>
              {edges.map((ed) => (
                <option key={ed.id} value={ed.id}>
                  {ed.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="panel-section">
        <button style={{ width: '100%' }} onClick={() => removePart(part.id)}>
          Удалить деталь
        </button>
      </div>
    </>
  );
}
