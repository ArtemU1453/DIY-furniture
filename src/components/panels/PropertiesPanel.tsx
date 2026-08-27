import { useEditorStore } from '@/app/store/editorStore';
import { findPart } from '@/core/model/selectors';
import { validatePart } from '@/core/validation';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import type { EdgeSide } from '@/core/model/types';
import type { EdgeMaterialId } from '@/core/model/ids';
import {
  bandingTotalLength, builtinPresets, defaultEdgeFor, edgeBandingForPart,
  longSides, presetWithMaterial, shortSides, sideLength, type EdgeQuickAction,
} from '@/engines/edges';

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
  const project = useEditorStore((s) => s.project);
  const setPartEdge = useEditorStore((s) => s.setPartEdge);
  const applyQuickAction = useEditorStore((s) => s.applyEdgeQuickAction);
  const applyPreset = useEditorStore((s) => s.applyEdgePreset);
  const resetEdgeOverride = useEditorStore((s) => s.resetEdgeOverride);
  const removePart = useEditorStore((s) => s.removePart);
  const duplicatePart = useEditorStore((s) => s.duplicatePart);
  const setPartFlag = useEditorStore((s) => s.setPartFlag);
  const selectPart = useEditorStore((s) => s.selectPart);
  const requestFocus = useEditorStore((s) => s.requestFocus);

  if (!part) {
    return (
      <div className="panel-section">
        <h3>Свойства</h3>
        <div className="empty-hint">Выберите деталь в 3D или в списке слева.</div>
      </div>
    );
  }

  const issues = validatePart(part);

  // Кромка производна от Part.edges (§6): считаем её здесь, не храня отдельно.
  const banding = edgeBandingForPart(project, part);
  const bandingBySide = new Map(banding.map((b) => [b.side, b]));
  const totalMm = banding.reduce((n, b) => n + bandingTotalLength(b), 0);
  // Материал по умолчанию для быстрых действий: кромка плиты, иначе первая в библиотеке.
  const defaultEdge = defaultEdgeFor(project, part) ?? edges[0]?.id ?? null;
  const presets = builtinPresets(defaultEdge);
  const quickAction = (action: EdgeQuickAction) => applyQuickAction([part.id], action, defaultEdge);

  return (
    <>
      <div className="panel-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3>Деталь</h3>
          <span className="dim" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {(part.metadata?.number as string) || part.id.slice(0, 6)}
          </span>
        </div>
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

        {/* Быстрые действия (§15). Длинную/короткую сторону определяет
            геометрия детали, а не порядок сторон в списке (§16). */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 }}>
          <button style={{ fontSize: 11 }} onClick={() => quickAction('all')}>Кромить все</button>
          <button style={{ fontSize: 11 }} onClick={() => quickAction('long')} disabled={longSides(part).length === 0}>Длинные</button>
          <button style={{ fontSize: 11 }} onClick={() => quickAction('short')} disabled={shortSides(part).length === 0}>Короткие</button>
          <button style={{ fontSize: 11 }} onClick={() => quickAction('none')}>Снять всю</button>
        </div>

        {/* Пресеты (§14/§51/§52) — применяются только к этой детали (§55). */}
        <div className="field">
          <label>Пресет</label>
          <select
            value=""
            onChange={(e) => {
              const preset = presets.find((x) => x.id === e.target.value);
              if (preset) applyPreset([part.id], presetWithMaterial(preset, defaultEdge));
            }}
          >
            <option value="">Применить пресет…</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </select>
        </div>

        {EDGE_LABELS.map(([side, label]) => {
          const banding = bandingBySide.get(side);
          return (
            <div className="field" key={side}>
              <label>
                {label}
                <span className="dim" style={{ fontSize: 10, marginLeft: 6 }}>
                  {Math.round(sideLength(part, side))} мм
                  {longSides(part).includes(side) ? ' · длинная' : shortSides(part).includes(side) ? ' · короткая' : ''}
                </span>
              </label>
              <select
                value={part.edges[side] ?? ''}
                onChange={(e) => setPartEdge(part.id, side, e.target.value ? (e.target.value as EdgeMaterialId) : null)}
              >
                <option value="">Нет</option>
                {edges.map((ed) => (
                  <option key={ed.id} value={ed.id}>
                    {ed.name}
                  </option>
                ))}
              </select>
              {banding && (
                <div className="dim" style={{ fontSize: 10, marginTop: 2 }}>
                  {/* §29: материал, толщина, ширина, длина, сторона. */}
                  EB {banding.thickness}×{banding.width} мм · {Math.round(banding.length)} мм
                  {banding.quantity > 1 && ` × ${banding.quantity}`}
                  {banding.status !== 'VALID' && (
                    <span className="issue warning" style={{ marginLeft: 4, padding: '0 3px' }}>{banding.status}</span>
                  )}
                  {banding.override && (
                    <button
                      style={{ fontSize: 10, marginLeft: 4 }}
                      onClick={() => resetEdgeOverride(part.id, side)}
                      title="Вернуть расчётное значение"
                    >Сбросить правку</button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {totalMm > 0 && (
          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
            Всего кромки: {(totalMm / 1000).toFixed(2)} м ({bandingBySide.size} стор.)
          </div>
        )}
      </div>

      <div className="panel-section">
        <h3>Действия</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button onClick={() => { const id = duplicatePart(part.id); if (id) selectPart(id); }}>Дублировать</button>
          <button onClick={requestFocus}>Показать</button>
          <button onClick={() => setPartFlag(part.id, { hidden: !(part.metadata?.hidden === true) })}>
            {part.metadata?.hidden ? 'Показать деталь' : 'Скрыть'}
          </button>
          <button onClick={() => setPartFlag(part.id, { locked: !(part.metadata?.locked === true) })}>
            {part.metadata?.locked ? 'Разблокировать' : 'Заблокировать'}
          </button>
        </div>
        <button
          style={{ width: '100%', marginTop: 8, color: 'var(--danger)' }}
          onClick={() => {
            const hasData = part.machining.length > 0;
            if (!hasData || window.confirm(`Удалить «${part.name}»? Связанные операции присадки будут удалены.`)) {
              removePart(part.id);
            }
          }}
        >
          Удалить деталь
        </button>
      </div>
    </>
  );
}
