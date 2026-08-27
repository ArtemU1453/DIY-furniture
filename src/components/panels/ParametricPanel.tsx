import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import {
  PARAMETRIC_TEMPLATES,
  diffParametric,
  hasParametricModel,
  hasOverride,
  partOverrides,
  partSource,
  previewRegeneration,
  resolveParameters,
  runCommand,
  setParameter,
  validateParametricModel,
  type CabinetConstructionType,
  type ParametricModel,
  type ShelfDistribution,
} from '@/engines/parametric';
import { isCuttingStale } from '@/engines/cutting';
import { isDocumentsOutdated } from '@/engines/drawing';
import { allParts, findPart } from '@/core/model/selectors';
import type { FurnitureId, PartId } from '@/core/model/ids';

const CONSTRUCTIONS: Array<[CabinetConstructionType, string]> = [
  ['BETWEEN_SIDES', 'Верх и низ между боковинами'],
  ['ON_SIDES', 'Верх и низ на боковинах'],
];

const DISTRIBUTIONS: Array<[ShelfDistribution, string]> = [
  ['AUTO_EQUAL', 'Равномерно'],
  ['MANUAL', 'Вручную'],
];

/** Числовое поле параметра с отложенным применением: пересчёт по Enter/blur. */
function NumberRow({
  label, value, unit, min, max, onCommit, disabled,
}: {
  label: string; value: number; unit?: string; min?: number; max?: number;
  onCommit: (v: number) => void; disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);

  /* Пересчёт запускается на Enter или потере фокуса, а не на каждый символ:
   * иначе промежуточное «10» при наборе «1000» вызвало бы лишнюю регенерацию
   * всего проекта (§89). */
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
    if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed);
  };

  return (
    <label style={row}>
      <span className="dim">{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          type="number" value={shown} min={min} max={max} disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }}
          style={{ width: 76 }}
        />
        {unit && <span className="dim" style={{ fontSize: 11 }}>{unit}</span>}
      </span>
    </label>
  );
}

export function ParametricPanel() {
  const project = useEditorStore((s) => s.project);
  const getModel = useEditorStore((s) => s.getParametricModel);
  const applyModel = useEditorStore((s) => s.applyParametricModel);
  const runStoreCommand = useEditorStore((s) => s.runParametricCommand);
  const createParametric = useEditorStore((s) => s.createParametricFurniture);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const setPartOverrideAction = useEditorStore((s) => s.setPartOverride);
  const resetPartOverrideAction = useEditorStore((s) => s.resetPartOverride);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const [furnitureId, setFurnitureId] = useState<FurnitureId | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const furnitures = project.furnitures;
  const activeId = furnitureId ?? furnitures[0]?.id ?? null;
  const activeFurniture = furnitures.find((f) => f.id === activeId) ?? null;
  const model = useMemo(() => (activeId ? getModel(activeId) : null), [activeId, getModel, project]);

  /* Пустая заготовка без параметрической модели и без деталей — редактировать
   * в ней нечего: предлагаем начать с шаблона. */
  const needsTemplate = !activeFurniture
    || (!hasParametricModel(activeFurniture)
      && (activeFurniture.assemblies[0]?.parts.length ?? 0) === 0);

  const validation = useMemo(() => (model ? validateParametricModel(model) : null), [model]);
  const resolved = useMemo(() => (model ? resolveParameters(model) : null), [model]);

  const cuttingDirty = isCuttingStale(project);
  const docsOutdated = isDocumentsOutdated(project);

  const selectedPart = selectedPartId ? findPart(project, selectedPartId) : null;
  const parametricParts = allParts(project).filter((p) => partSource(p) === 'PARAMETRIC');
  const manualParts = allParts(project).filter((p) => partSource(p) === 'MANUAL');

  const apply = (next: ParametricModel, description: string) => {
    if (!activeId) return;
    const result = applyModel(activeId, next);
    if (!result.ok) { setErrors(result.errors); return; }
    setErrors([]);
    setHistory((h) => [description || result.description, ...h].slice(0, 20));
  };

  const command = (type: Parameters<typeof runCommand>[1], payload?: Record<string, unknown>) => {
    if (!activeId) return;
    const result = runStoreCommand(activeId, type, payload);
    if (!result.ok) { setErrors(result.errors); return; }
    setErrors([]);
    setHistory((h) => [result.description, ...h].slice(0, 20));
  };

  // Предпросмотр: что даст изменение габарита до его применения (§67).
  const [preview, setPreview] = useState<{ label: string; lines: string[] } | null>(null);
  const showPreview = (field: 'width' | 'height' | 'depth', value: number) => {
    if (!model) return;
    const next = setParameter(model, field, value);
    if (!next.ok) return;
    const result = previewRegeneration(model, next.model, allParts(project));
    setPreview({
      label: next.description,
      lines: [
        ...result.diff.parameters.map((p) => `${p.label}: ${p.before} → ${p.after}`),
        ...(result.diff.addedParts.length ? [`Добавится деталей: ${result.diff.addedParts.length}`] : []),
        ...(result.diff.removedParts.length ? [`Удалится деталей: ${result.diff.removedParts.length}`] : []),
        ...(result.diff.changedParts.length ? [`Изменится деталей: ${result.diff.changedParts.length}`] : []),
        ...result.issues,
      ],
    });
  };

  if (!model || !activeId || needsTemplate) {
    return (
      <div style={{ padding: 16 }}>
        <h3 style={hdr}>Параметрический редактор</h3>
        <p className="dim">
          {activeFurniture
            ? 'Изделие пока пустое. Создайте параметрическую заготовку:'
            : 'В проекте нет изделия. Создайте параметрическую заготовку:'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, maxWidth: 320 }}>
          {PARAMETRIC_TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => {
              const id = createParametric(t.id);
              if (id) { setFurnitureId(id); setHistory((h) => [`Создано изделие «${t.name}»`, ...h]); }
            }}>
              {t.name} — {t.description}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const diffNow = diffParametric(model, model, allParts(project));
  void diffNow;

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Параметры изделия (§49) */}
      <aside style={{ width: 290, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 12 }}>
        <h3 style={hdr}>Параметры изделия</h3>

        {furnitures.length > 1 && (
          <label style={row}>
            <span className="dim">Изделие</span>
            <select value={String(activeId)} onChange={(e) => setFurnitureId(e.target.value as FurnitureId)}>
              {furnitures.map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
            </select>
          </label>
        )}

        <section style={section}>
          <NumberRow label="Ширина" unit="мм" value={model.width}
            min={model.limits.minimumWidth} max={model.limits.maximumWidth}
            onCommit={(v) => command('SetParameter', { field: 'width', value: v })} />
          <NumberRow label="Высота" unit="мм" value={model.height}
            min={model.limits.minimumHeight} max={model.limits.maximumHeight}
            onCommit={(v) => command('SetParameter', { field: 'height', value: v })} />
          <NumberRow label="Глубина" unit="мм" value={model.depth}
            min={model.limits.minimumDepth} max={model.limits.maximumDepth}
            onCommit={(v) => command('SetParameter', { field: 'depth', value: v })} />
          <NumberRow label="Толщина" unit="мм" value={model.thickness}
            onCommit={(v) => command('SetParameter', { field: 'thickness', value: v })} />
        </section>

        <section style={section}>
          <label style={row}>
            <span className="dim">Материал</span>
            <select
              value={String(model.materialId ?? '')}
              onChange={(e) => {
                const material = project.materials.find((m) => String(m.id) === e.target.value);
                command('SetMaterial', { materialId: material?.id ?? null, thickness: material?.thickness });
              }}
            >
              <option value="">— не задан —</option>
              {project.materials.map((m) => (
                <option key={m.id} value={String(m.id)}>{m.name} ({m.thickness} мм)</option>
              ))}
            </select>
          </label>
          <label style={row}>
            <span className="dim">Схема корпуса</span>
            <select value={model.construction}
              onChange={(e) => command('SetConstruction', { construction: e.target.value })}>
              {CONSTRUCTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </section>

        <section style={section}>
          <div style={row}>
            <span className="dim">Полки</span>
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button onClick={() => command('RemoveShelf')}>−</button>
              <strong style={{ minWidth: 20, textAlign: 'center' }}>{model.shelves.count}</strong>
              <button onClick={() => command('AddShelf')}>+</button>
            </span>
          </div>
          <label style={row}>
            <span className="dim">Распределение</span>
            <select value={model.shelves.distribution}
              onChange={(e) => command('SetShelfDistribution', { distribution: e.target.value })}>
              {DISTRIBUTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          <div style={row}>
            <span className="dim">Перегородки</span>
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button onClick={() => command('RemovePartition')}>−</button>
              <strong style={{ minWidth: 20, textAlign: 'center' }}>{model.partitions.count}</strong>
              <button onClick={() => command('AddPartition')}>+</button>
            </span>
          </div>

          <div style={row}>
            <span className="dim">Фасады</span>
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button onClick={() => command('RemoveDoor')}>−</button>
              <strong style={{ minWidth: 20, textAlign: 'center' }}>{model.doors.count}</strong>
              <button onClick={() => command('AddDoor')}>+</button>
            </span>
          </div>
          <NumberRow label="Зазор фасадов" unit="мм" value={model.doors.gaps.betweenGap}
            onCommit={(v) => command('SetParameter', { field: 'doorGap', value: v })} />
        </section>

        <section style={section}>
          <label style={row}>
            <span className="dim">Задняя стенка</span>
            <select value={model.backPanel.type}
              onChange={(e) => apply(
                { ...model, backPanel: { ...model.backPanel, type: e.target.value as ParametricModel['backPanel']['type'] } },
                `Задняя стенка: ${model.backPanel.type} → ${e.target.value}`,
              )}>
              {(['NONE', 'INSET', 'OVERLAY', 'GROOVE'] as const).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <NumberRow label="Толщина задней" unit="мм" value={model.backPanel.thickness}
            disabled={model.backPanel.type === 'NONE'}
            onCommit={(v) => command('SetParameter', { field: 'backThickness', value: v })} />
        </section>

        <section style={section}>
          <label style={row}>
            <span className="dim">Ножки</span>
            <input type="checkbox" checked={model.legs.enabled}
              onChange={(e) => command('SetLegs', { enabled: e.target.checked })} />
          </label>
          {model.legs.enabled && (
            <NumberRow label="Высота ножек" unit="мм" value={model.legs.height}
              onCommit={(v) => command('SetLegs', { height: v })} />
          )}
          <label style={row}>
            <span className="dim">Цоколь</span>
            <input type="checkbox" checked={model.plinth.enabled}
              onChange={(e) => command('SetPlinth', { enabled: e.target.checked })} />
          </label>
          {model.plinth.enabled && (
            <NumberRow label="Высота цоколя" unit="мм" value={model.plinth.height}
              onCommit={(v) => command('SetPlinth', { height: v })} />
          )}
        </section>

        <section style={section}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => undo()}>↶ Отменить</button>
            <button onClick={() => redo()}>↷ Повторить</button>
          </div>
        </section>
      </aside>

      {/* Состояние, предпросмотр, история */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 12 }}>
        <h3 style={hdr}>Состояние модели</h3>

        {errors.length > 0 && (
          <div className="issue error" style={{ marginBottom: 8 }}>
            {errors.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        {validation && validation.issues.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {validation.issues.map((i, n) => (
              <div key={n} className={`issue ${i.severity === 'error' ? 'error' : 'warning'}`}>{i.message}</div>
            ))}
          </div>
        )}

        {/* Статусы зависимых модулей (§69) */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <span>Раскрой: <strong style={{ color: cuttingDirty ? '#e6c060' : 'var(--ok)' }}>
            {cuttingDirty ? 'DIRTY' : 'актуален'}
          </strong></span>
          <span>Документы: <strong style={{ color: docsOutdated ? '#e6c060' : 'var(--ok)' }}>
            {docsOutdated ? 'OUTDATED' : 'CURRENT'}
          </strong></span>
          <span className="dim">Деталей: {parametricParts.length} параметрических, {manualParts.length} ручных</span>
        </div>

        {/* Предпросмотр изменения (§67) */}
        <section style={{ marginBottom: 12 }}>
          <span className="dim">Предпросмотр изменения</span>
          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            <button onClick={() => showPreview('width', model.width + 200)}>Ширина +200</button>
            <button onClick={() => showPreview('height', model.height + 200)}>Высота +200</button>
            <button onClick={() => showPreview('depth', model.depth - 100)}>Глубина −100</button>
            {preview && <button onClick={() => setPreview(null)}>Скрыть</button>}
          </div>
          {preview && (
            <div className="panel-section" style={{ marginTop: 6, padding: 8, border: '1px solid var(--border)', borderRadius: 6 }}>
              <strong style={{ fontSize: 12 }}>{preview.label}</strong>
              {preview.lines.map((l, i) => <div key={i} className="dim" style={{ fontSize: 11 }}>{l}</div>)}
            </div>
          )}
        </section>

        {/* Ручная правка выбранной детали (§43/§44) */}
        {selectedPart && (
          <section style={{ marginBottom: 12 }}>
            <span className="dim">Выбранная деталь</span>
            <div style={{ marginTop: 4 }}>
              <strong>{selectedPart.name}</strong>
              <span className="dim"> · {partSource(selectedPart)}</span>
              {hasOverride(selectedPart) && <span className="issue warning" style={badge}>Ручное изменение</span>}
            </div>
            <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
              {Math.round(selectedPart.width)} × {Math.round(selectedPart.height)} × {selectedPart.thickness}
            </div>
            {hasOverride(selectedPart) && (
              <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                Переопределено: {Object.keys(partOverrides(selectedPart)).join(', ')}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              <button onClick={() => setPartOverrideAction(selectedPart.id as PartId, { width: selectedPart.width + 10 })}>
                Ширина +10 (вручную)
              </button>
              <button disabled={!hasOverride(selectedPart)}
                onClick={() => resetPartOverrideAction(selectedPart.id as PartId)}>
                Вернуть расчётное значение
              </button>
            </div>
          </section>
        )}

        {/* Вычисленные параметры (§7/§9) */}
        {resolved && resolved.parameters.length > 0 && (
          <section style={{ marginBottom: 12 }}>
            <span className="dim">Параметры и выражения</span>
            {resolved.parameters.map((p) => (
              <div key={p.id} style={{ ...row, marginTop: 2 }}>
                <span className="dim">{p.name}{p.expression ? ` = ${p.expression}` : ''}</span>
                <span>{String(p.value)}{p.unit ? ` ${p.unit}` : ''}</span>
              </div>
            ))}
          </section>
        )}

        {/* История действий (§53) */}
        <section>
          <span className="dim">История действий</span>
          {history.length === 0 && <div className="dim" style={{ fontSize: 11 }}>Пока пусто.</div>}
          {history.map((h, i) => (
            <div key={i} className="dim" style={{ fontSize: 11, marginTop: 2 }}>{h}</div>
          ))}
        </section>
      </div>
    </div>
  );
}

const hdr: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-dim)', margin: '0 0 8px',
};
const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8,
};
const section: React.CSSProperties = {
  paddingTop: 8, marginTop: 8, borderTop: '1px solid var(--border)',
};
const badge: React.CSSProperties = {
  marginLeft: 6, padding: '0 4px', fontSize: 10, display: 'inline-block',
};
