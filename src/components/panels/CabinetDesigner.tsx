/**
 * Конструктор корпусной мебели (§62–§75, §90–§101).
 *
 * Панель НЕ считает геометрию: она вызывает действия store, а те — движок
 * корпуса. Любое изменение проходит через ту же параметрическую модель, что и
 * весь редактор, поэтому детали, фурнитура, присадка, раскрой и документы
 * обновляются сами.
 */
import { useMemo, useState } from 'react';
import { useEditorStore, type CreateCabinetInput } from '@/app/store/editorStore';
import {
  BUILT_IN_CABINET_PRESETS,
  CABINET_TYPES,
  affectedByFields,
  cabinetBomCsv,
  customCabinetPresets,
  exportCabinetPresets,
  drawerSlots,
  type CabinetPreset,
} from '@/engines/cabinet';
import { shelfOffsets, CONSTRUCTION_LABELS, CONSTRUCTION_ORDER } from '@/engines/parametric';
import type { CabinetType, ParametricModel } from '@/core/parametric/types';
import type { FurnitureId } from '@/core/model/ids';
import { hasOverride, partOverrides, partSource } from '@/engines/parametric';
import { findPart } from '@/core/model/selectors';
import type { PartId } from '@/core/model/ids';

const GROUPS = [
  'Основные', 'Конструкция', 'Полки', 'Фасады', 'Ящики', 'Цоколь', 'Ножки', 'Перегородки', 'Кромка',
] as const;
type Group = (typeof GROUPS)[number];

/** Числовое поле с отложенным применением: пересчёт по Enter или blur. */
function NumberField({
  label, value, unit, min, max, computed, overridden, onCommit, onReset, disabled, testId,
}: {
  label: string; value: number; unit?: string; min?: number; max?: number; testId?: string;
  /** Значение вычисляется правилом — показываем fx (§73). */
  computed?: boolean;
  /** Пользователь изменил производное значение — показываем Override (§74). */
  overridden?: boolean;
  onCommit: (v: number) => void;
  onReset?: () => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
    if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed);
  };
  return (
    <label style={row}>
      <span className="dim" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        {computed && <em style={badge} title="Значение вычисляется">fx</em>}
        {overridden && <em style={{ ...badge, color: '#e6c060' }} title="Изменено вручную">Override</em>}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          data-testid={testId}
          type="number" value={draft ?? String(value)} min={min} max={max} disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }}
          style={{ width: 76 }}
        />
        {unit && <span className="dim" style={{ fontSize: 11 }}>{unit}</span>}
        {onReset && (
          <button title="Сбросить параметр" onClick={onReset} style={{ padding: '0 6px' }}>⟲</button>
        )}
      </span>
    </label>
  );
}

export function CabinetDesigner({ onOpenPart, onOpen3D }: {
  onOpenPart?: (id: PartId) => void;
  onOpen3D?: () => void;
}) {
  const project = useEditorStore((s) => s.project);
  const getModel = useEditorStore((s) => s.getCabinetModel);
  const applyPatch = useEditorStore((s) => s.applyCabinetPatch);
  const createCabinet = useEditorStore((s) => s.createParametricCabinet);
  const previewCreate = useEditorStore((s) => s.previewParametricCabinet);
  const checkConstruction = useEditorStore((s) => s.checkCabinetConstruction);
  const getBom = useEditorStore((s) => s.getCabinetBom);
  const distributeShelves = useEditorStore((s) => s.distributeShelvesEqually);
  const setShelf = useEditorStore((s) => s.setShelfPosition);
  const resetShelf = useEditorStore((s) => s.resetShelfPosition);
  const duplicate = useEditorStore((s) => s.duplicateFurniture);
  const copyCabinet = useEditorStore((s) => s.copyCabinetToClipboard);
  const pasteCabinet = useEditorStore((s) => s.pasteCabinetFromClipboard);
  const deleteCabinet = useEditorStore((s) => s.deleteCabinet);
  const savePreset = useEditorStore((s) => s.saveCabinetPreset);
  const removePreset = useEditorStore((s) => s.removeCabinetPreset);
  const importPresets = useEditorStore((s) => s.importCabinetPresetsFile);
  const clipboard = useEditorStore((s) => s.cabinetClipboard);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const resetPartOverride = useEditorStore((s) => s.resetPartOverride);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const [furnitureId, setFurnitureId] = useState<FurnitureId | null>(null);
  const [group, setGroup] = useState<Group>('Основные');
  const [messages, setMessages] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [wizard, setWizard] = useState<CreateCabinetInput>({ type: 'CABINET' });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [presetName, setPresetName] = useState('');

  const cabinets = project.furnitures;
  const activeId = furnitureId ?? cabinets[0]?.id ?? null;
  const model = useMemo(() => (activeId ? getModel(activeId) : null), [activeId, getModel, project]);
  const active = cabinets.find((f) => f.id === activeId) ?? null;
  const parts = active?.assemblies[0]?.parts ?? [];

  const check = useMemo(
    () => (activeId ? checkConstruction(activeId) : null),
    [activeId, checkConstruction, project],
  );
  const bom = useMemo(() => (activeId ? getBom(activeId) : null), [activeId, getBom, project]);
  const presets: CabinetPreset[] = [...BUILT_IN_CABINET_PRESETS, ...customCabinetPresets(project)];
  const preview = useMemo(() => (wizardOpen ? previewCreate(wizard) : null), [wizardOpen, wizard, previewCreate]);

  const patch = (next: Partial<ParametricModel>, description: string) => {
    if (!activeId) return;
    const result = applyPatch(activeId, next, description);
    if (!result.ok) { setErrors(result.errors); return; }
    setErrors([]);
    setMessages((m) => [result.description || description, ...m].slice(0, 20));
  };

  const selectedPart = selectedPartId ? findPart(project, selectedPartId) : null;

  // ── Мастер создания (§90–§94) ─────────────────────────────────────────────
  const wizardPanel = (
    <section style={{ ...section, background: 'var(--panel, transparent)' }} data-testid="cabinet-wizard">
      <h4 style={{ margin: '0 0 6px', fontSize: 12 }}>Новый шкаф</h4>
      <label style={row}>
        <span className="dim">Тип</span>
        <select
          data-testid="wizard-type"
          value={wizard.type ?? 'CABINET'}
          onChange={(e) => {
            const type = e.target.value as CabinetType;
            const info = CABINET_TYPES.find((t) => t.type === type);
            setWizard((w) => ({ ...w, type, width: info?.width, height: info?.height, depth: info?.depth }));
          }}
        >
          {CABINET_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
      </label>
      <label style={row}>
        <span className="dim">Пресет</span>
        <select
          data-testid="wizard-preset"
          value={wizard.presetId ?? ''}
          onChange={(e) => setWizard((w) => ({ ...w, presetId: e.target.value || undefined }))}
        >
          <option value="">— без пресета —</option>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label style={row}>
        <span className="dim">Ширина</span>
        <input data-testid="wizard-width" type="number" style={{ width: 76 }}
          value={wizard.width ?? 800}
          onChange={(e) => setWizard((w) => ({ ...w, width: Number(e.target.value) }))} />
      </label>
      <label style={row}>
        <span className="dim">Высота</span>
        <input data-testid="wizard-height" type="number" style={{ width: 76 }}
          value={wizard.height ?? 2000}
          onChange={(e) => setWizard((w) => ({ ...w, height: Number(e.target.value) }))} />
      </label>
      <label style={row}>
        <span className="dim">Глубина</span>
        <input data-testid="wizard-depth" type="number" style={{ width: 76 }}
          value={wizard.depth ?? 600}
          onChange={(e) => setWizard((w) => ({ ...w, depth: Number(e.target.value) }))} />
      </label>
      <label style={row}>
        <span className="dim">Материал</span>
        <select
          value={String(wizard.materialId ?? '')}
          onChange={(e) => setWizard((w) => ({
            ...w,
            materialId: (project.materials.find((m) => String(m.id) === e.target.value)?.id ?? null),
          }))}
        >
          <option value="">— по умолчанию —</option>
          {project.materials.map((m) => (
            <option key={m.id} value={String(m.id)}>{m.name} ({m.thickness} мм)</option>
          ))}
        </select>
      </label>
      <label style={row}>
        <span className="dim">Схема</span>
        <select value={wizard.construction ?? 'BETWEEN_SIDES'}
          onChange={(e) => setWizard((w) => ({ ...w, construction: e.target.value as ParametricModel['construction'] }))}>
          {CONSTRUCTION_ORDER.map((v) => (
            <option key={v} value={v}>{CONSTRUCTION_LABELS[v]}</option>
          ))}
        </select>
      </label>

      {/* Предпросмотр до подтверждения (§93) */}
      {preview && (
        <div className="dim" style={{ fontSize: 11, marginTop: 6 }} data-testid="wizard-preview">
          Деталей: {preview.parts} · Узлов: {preview.connections} · Материал: {preview.materialAreaM2} м²
          {preview.issues.length > 0 && <div>Замечаний: {preview.issues.length}</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        <button
          data-testid="wizard-create"
          onClick={() => {
            const id = createCabinet(wizard);
            if (!id) { setErrors(['Не удалось создать шкаф с такими параметрами.']); return; }
            setFurnitureId(id);
            setWizardOpen(false);
            setErrors([]);
            setMessages((m) => ['Создан шкаф', ...m]);
          }}
        >
          Создать
        </button>
        <button onClick={() => setWizardOpen(false)}>Отмена</button>
      </div>
    </section>
  );

  if (!model || !activeId) {
    return (
      <div style={{ padding: 16, maxWidth: 360 }}>
        <h3 style={hdr}>Конструктор шкафа</h3>
        <p className="dim">В проекте нет параметрического шкафа. Создайте новый:</p>
        {wizardOpen ? wizardPanel : (
          <button data-testid="cabinet-new" onClick={() => setWizardOpen(true)}>Новый шкаф</button>
        )}
        {errors.length > 0 && <div className="issue error">{errors.join(' ')}</div>}
      </div>
    );
  }

  const shelves = shelfOffsets(model);
  const drawers = drawerSlots(model);
  const affected = affectedByFields(['width']);

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Дерево изделий (§98/§99) */}
      <aside style={{ width: 210, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 12 }}>
        <h3 style={hdr}>Шкафы проекта</h3>
        {cabinets.map((f) => (
          <button
            key={f.id}
            data-testid="cabinet-item"
            className={String(f.id) === String(activeId) ? 'active' : ''}
            style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }}
            onClick={() => setFurnitureId(f.id as FurnitureId)}
          >
            {f.name}
            <span className="dim" style={{ fontSize: 10, display: 'block' }}>
              деталей: {f.assemblies[0]?.parts.length ?? 0}
            </span>
          </button>
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          <button data-testid="cabinet-new" onClick={() => setWizardOpen(true)}>Новый шкаф</button>
          <button data-testid="cabinet-duplicate" onClick={() => {
            const id = duplicate(activeId);
            if (id) { setFurnitureId(id); setMessages((m) => ['Шкаф продублирован', ...m]); }
          }}>Дублировать</button>
          <button data-testid="cabinet-copy" onClick={() => {
            copyCabinet(activeId);
            setMessages((m) => ['Шкаф скопирован', ...m]);
          }}>Копировать</button>
          <button data-testid="cabinet-paste" disabled={!clipboard} onClick={() => {
            const id = pasteCabinet();
            if (id) { setFurnitureId(id); setMessages((m) => ['Шкаф вставлен', ...m]); }
          }}>Вставить</button>
          <button data-testid="cabinet-delete" onClick={() => {
            if (!deleteCabinet(activeId)) return;
            setFurnitureId(null);
            setMessages((m) => ['Шкаф удалён', ...m]);
          }}>Удалить</button>
          {onOpen3D && <button onClick={onOpen3D}>Показать в 3D</button>}
        </div>
        {wizardOpen && wizardPanel}
      </aside>

      {/* Параметры по группам (§62–§75) */}
      <div style={{ width: 320, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 12 }}>
        <h3 style={hdr}>Параметры шкафа</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {GROUPS.map((g) => (
            <button key={g} data-testid={`group-${g}`} className={group === g ? 'active' : ''}
              onClick={() => setGroup(g)} style={{ fontSize: 11 }}>
              {g}
            </button>
          ))}
        </div>

        {group === 'Основные' && (
          <section style={section}>
            <label style={row}>
              <span className="dim">Тип шкафа</span>
              <select data-testid="cabinet-type" value={model.cabinetType}
                onChange={(e) => patch({ cabinetType: e.target.value as CabinetType }, 'Изменён тип шкафа')}>
                {CABINET_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </label>
            <NumberField label="Ширина" unit="мм" value={model.width}
              min={model.limits.minimumWidth} max={model.limits.maximumWidth}
              onCommit={(v) => patch({ width: v }, `Ширина: ${model.width} → ${v}`)}
              onReset={() => patch({ width: 800 }, 'Ширина сброшена')} />
            <NumberField label="Высота" unit="мм" value={model.height}
              min={model.limits.minimumHeight} max={model.limits.maximumHeight}
              onCommit={(v) => patch({ height: v }, `Высота: ${model.height} → ${v}`)} />
            <NumberField label="Глубина" unit="мм" value={model.depth}
              min={model.limits.minimumDepth} max={model.limits.maximumDepth}
              onCommit={(v) => patch({ depth: v }, `Глубина: ${model.depth} → ${v}`)} />
          </section>
        )}

        {group === 'Конструкция' && (
          <section style={section}>
            <NumberField label="Толщина материала" unit="мм" value={model.thickness}
              onCommit={(v) => patch({ thickness: v }, `Толщина: ${model.thickness} → ${v}`)} />
            <label style={row}>
              <span className="dim">Материал</span>
              <select value={String(model.materialId ?? '')}
                onChange={(e) => {
                  const material = project.materials.find((m) => String(m.id) === e.target.value);
                  patch(
                    { materialId: material?.id ?? null, thickness: material?.thickness ?? model.thickness },
                    'Изменён материал корпуса',
                  );
                }}>
                <option value="">— не задан —</option>
                {project.materials.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
              </select>
            </label>
            <label style={row}>
              <span className="dim">Схема корпуса</span>
              <select value={model.construction}
                onChange={(e) => patch({ construction: e.target.value as ParametricModel['construction'] }, 'Схема корпуса')}>
                {CONSTRUCTION_ORDER.map((v) => (
                  <option key={v} value={v}>{CONSTRUCTION_LABELS[v]}</option>
                ))}
              </select>
            </label>
            <label style={row}>
              <span className="dim">Задняя стенка</span>
              <select data-testid="back-type" value={model.backPanel.type}
                onChange={(e) => patch(
                  { backPanel: { ...model.backPanel, type: e.target.value as ParametricModel['backPanel']['type'] } },
                  'Тип задней стенки',
                )}>
                <option value="NONE">Нет</option>
                <option value="INSET">Вкладная</option>
                <option value="OVERLAY">Накладная</option>
                <option value="GROOVE">В паз</option>
              </select>
            </label>
            <NumberField label="Толщина задней" unit="мм" value={model.backPanel.thickness}
              disabled={model.backPanel.type === 'NONE'}
              onCommit={(v) => patch({ backPanel: { ...model.backPanel, thickness: v } }, 'Толщина задней стенки')} />
            <NumberField label="Глубина паза" unit="мм" value={model.backPanel.grooveDepth}
              disabled={model.backPanel.type !== 'GROOVE'} computed
              onCommit={(v) => patch({ backPanel: { ...model.backPanel, grooveDepth: v } }, 'Глубина паза')} />
            <NumberField label="Отступ паза" unit="мм" value={model.backPanel.grooveOffset}
              disabled={model.backPanel.type !== 'GROOVE'}
              onCommit={(v) => patch({ backPanel: { ...model.backPanel, grooveOffset: v } }, 'Отступ паза')} />
            <label style={row}>
              <span className="dim">Материал задней</span>
              <select value={String(model.backPanel.material ?? '')}
                onChange={(e) => patch(
                  { backPanel: { ...model.backPanel, material: (project.materials.find((m) => String(m.id) === e.target.value)?.id ?? null) } },
                  'Материал задней стенки',
                )}>
                <option value="">— как корпус —</option>
                {project.materials.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
              </select>
            </label>
          </section>
        )}

        {group === 'Полки' && (
          <section style={section}>
            <NumberField testId="shelf-count" label="Количество" value={model.shelves.count}
              onCommit={(v) => patch({ shelves: { ...model.shelves, count: Math.max(0, Math.trunc(v)) } }, 'Количество полок')} />
            <label style={row}>
              <span className="dim">Расположение</span>
              <select value={model.shelves.distribution}
                onChange={(e) => patch(
                  { shelves: { ...model.shelves, distribution: e.target.value as 'AUTO_EQUAL' | 'MANUAL' } },
                  'Расположение полок',
                )}>
                <option value="AUTO_EQUAL">Равномерно</option>
                <option value="MANUAL">Вручную</option>
              </select>
            </label>
            <label style={row}>
              <span className="dim">Тип полок</span>
              <select value={model.shelves.mode}
                onChange={(e) => patch(
                  { shelves: { ...model.shelves, mode: e.target.value as 'FIXED' | 'ADJUSTABLE' } },
                  'Тип полок',
                )}>
                <option value="ADJUSTABLE">Регулируемые</option>
                <option value="FIXED">Фиксированные</option>
              </select>
            </label>
            <NumberField label="Шаг" unit="мм" value={model.shelves.spacing}
              onCommit={(v) => patch({ shelves: { ...model.shelves, spacing: v } }, 'Шаг полок')} />
            <button data-testid="shelves-distribute" onClick={() => {
              const result = distributeShelves(activeId);
              setMessages((m) => [result.description, ...m]);
            }}>Распределить равномерно</button>
            <div style={{ marginTop: 8 }}>
              {shelves.map((offset, i) => {
                const index = i + 1;
                const manual = model.shelves.fixedShelves.some((f) => f.index === index);
                return (
                  <div key={index} style={row}>
                    <span className="dim">
                      Полка {index}{manual && <em style={{ ...badge, color: '#e6c060' }}>Override</em>}
                    </span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <input data-testid={`shelf-offset-${index}`}
                        type="number" style={{ width: 70 }} defaultValue={Math.round(offset)}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && Math.abs(v - offset) > 0.5) setShelf(activeId, index, v);
                        }} />
                      <button data-testid={`shelf-reset-${index}`} disabled={!manual}
                        onClick={() => resetShelf(activeId, index)}>⟲</button>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {group === 'Фасады' && (
          <section style={section}>
            <NumberField testId="door-count" label="Количество" value={model.doors.count}
              onCommit={(v) => patch({ doors: { ...model.doors, count: Math.max(0, Math.trunc(v)) } }, 'Количество фасадов')} />
            <label style={row}>
              <span className="dim">Тип</span>
              <select value={model.doors.kind}
                onChange={(e) => patch({ doors: { ...model.doors, kind: e.target.value as 'single' | 'double' } }, 'Тип фасада')}>
                <option value="single">Одностворчатый</option>
                <option value="double">Двустворчатый</option>
              </select>
            </label>
            <NumberField label="Зазор" unit="мм" value={model.doors.gaps.betweenGap}
              onCommit={(v) => patch({ doors: { ...model.doors, gaps: { ...model.doors.gaps, betweenGap: v } } }, 'Зазор фасадов')} />
            <label style={row}>
              <span className="dim">Наложение</span>
              <select data-testid="door-overlay" value={model.doors.overlay}
                onChange={(e) => patch(
                  { doors: { ...model.doors, overlay: e.target.value as 'FULL' | 'HALF' | 'INSET' } },
                  'Наложение фасада',
                )}>
                <option value="FULL">Полное</option>
                <option value="HALF">Половинное</option>
                <option value="INSET">Вкладной</option>
              </select>
            </label>
            <label style={row}>
              <span className="dim">Ручки</span>
              <input type="checkbox" checked={model.doors.handleEnabled}
                onChange={(e) => patch({ doors: { ...model.doors, handleEnabled: e.target.checked } }, 'Ручки')} />
            </label>
            <NumberField label="Отступ ручки" unit="мм" value={model.doors.handle.edgeOffset}
              disabled={!model.doors.handleEnabled}
              onCommit={(v) => patch(
                { doors: { ...model.doors, handle: { ...model.doors.handle, edgeOffset: v } } },
                'Отступ ручки',
              )} />
          </section>
        )}

        {group === 'Ящики' && (
          <section style={section}>
            <NumberField testId="drawer-count" label="Количество" value={model.drawers.count}
              onCommit={(v) => patch({ drawers: { ...model.drawers, count: Math.max(0, Math.trunc(v)) } }, 'Количество ящиков')} />
            <NumberField label="Высота фронта" unit="мм" value={model.drawers.frontHeight} computed={model.drawers.frontHeight === 0}
              onCommit={(v) => patch({ drawers: { ...model.drawers, frontHeight: v } }, 'Высота ящика')} />
            <NumberField label="Зазор" unit="мм" value={model.drawers.gap}
              onCommit={(v) => patch({ drawers: { ...model.drawers, gap: v } }, 'Зазор ящиков')} />
            <label style={row}>
              <span className="dim">Расположение</span>
              <select value={model.drawers.distribution}
                onChange={(e) => patch(
                  { drawers: { ...model.drawers, distribution: e.target.value as 'AUTO_EQUAL' | 'MANUAL' | 'PARAMETRIC' } },
                  'Расположение ящиков',
                )}>
                <option value="AUTO_EQUAL">Равномерно</option>
                <option value="PARAMETRIC">Параметрическое</option>
                <option value="MANUAL">Вручную</option>
              </select>
            </label>
            <div className="dim" style={{ fontSize: 11 }}>
              {drawers.map((d) => (
                <div key={d.index}>Ящик {d.index}: низ {Math.round(d.y)} мм, высота {Math.round(d.height)} мм</div>
              ))}
            </div>
          </section>
        )}

        {group === 'Цоколь' && (
          <section style={section}>
            <label style={row}>
              <span className="dim">Цоколь</span>
              <input type="checkbox" checked={model.plinth.enabled}
                onChange={(e) => patch({ plinth: { ...model.plinth, enabled: e.target.checked } }, 'Цоколь')} />
            </label>
            <NumberField label="Высота" unit="мм" value={model.plinth.height} disabled={!model.plinth.enabled}
              onCommit={(v) => patch({ plinth: { ...model.plinth, height: v } }, 'Высота цоколя')} />
            <NumberField label="Отступ" unit="мм" value={model.plinth.inset} disabled={!model.plinth.enabled}
              onCommit={(v) => patch({ plinth: { ...model.plinth, inset: v } }, 'Отступ цоколя')} />
            <NumberField label="Толщина" unit="мм" value={model.plinth.thickness} disabled={!model.plinth.enabled}
              onCommit={(v) => patch({ plinth: { ...model.plinth, thickness: v } }, 'Толщина цоколя')} />
          </section>
        )}

        {group === 'Ножки' && (
          <section style={section}>
            <label style={row}>
              <span className="dim">Ножки</span>
              <input type="checkbox" checked={model.legs.enabled}
                onChange={(e) => patch({ legs: { ...model.legs, enabled: e.target.checked } }, 'Ножки')} />
            </label>
            <NumberField label="Количество" value={model.legs.count} disabled={!model.legs.enabled}
              onCommit={(v) => patch({ legs: { ...model.legs, count: Math.max(0, Math.trunc(v)) } }, 'Количество ножек')} />
            <NumberField label="Отступ" unit="мм" value={model.legs.insetX} disabled={!model.legs.enabled}
              onCommit={(v) => patch({ legs: { ...model.legs, insetX: v, insetY: v } }, 'Отступ ножек')} />
            <label style={row}>
              <span className="dim">Размещение</span>
              <select value={model.legs.placement} disabled={!model.legs.enabled}
                onChange={(e) => patch(
                  { legs: { ...model.legs, placement: e.target.value as 'CORNERS' | 'INSET' | 'SYMMETRIC' } },
                  'Размещение ножек',
                )}>
                <option value="CORNERS">По углам</option>
                <option value="INSET">С отступом</option>
                <option value="SYMMETRIC">Симметрично</option>
              </select>
            </label>
          </section>
        )}

        {group === 'Перегородки' && (
          <section style={section}>
            <NumberField testId="partition-count" label="Количество" value={model.partitions.count}
              onCommit={(v) => patch({ partitions: { ...model.partitions, count: Math.max(0, Math.trunc(v)) } }, 'Количество перегородок')} />
            <label style={row}>
              <span className="dim">Расположение</span>
              <select value={model.partitions.orientation}
                onChange={(e) => patch(
                  { partitions: { ...model.partitions, orientation: e.target.value as 'VERTICAL' | 'HORIZONTAL' } },
                  'Ориентация перегородок',
                )}>
                <option value="VERTICAL">Вертикальные</option>
                <option value="HORIZONTAL">Горизонтальные</option>
              </select>
            </label>
            <div className="dim" style={{ fontSize: 11 }}>
              Секций: {Math.trunc(model.partitions.count) + 1}
            </div>
          </section>
        )}

        {group === 'Кромка' && (
          <section style={section}>
            <NumberField label="Толщина кромки" unit="мм" value={model.edge.thickness}
              onCommit={(v) => patch({ edge: { ...model.edge, thickness: v } }, 'Толщина кромки')} />
            <label style={row}>
              <span className="dim">Материал кромки</span>
              <select value={String(model.edge.materialId ?? '')}
                onChange={(e) => patch({ edge: { ...model.edge, materialId: e.target.value || null } }, 'Материал кромки')}>
                <option value="">— не задан —</option>
                {project.edges.map((e) => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
              </select>
            </label>
          </section>
        )}

        <section style={section}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => undo()}>↶ Отменить</button>
            <button onClick={() => redo()}>↷ Повторить</button>
          </div>
        </section>
      </div>

      {/* Состояние конструкции, спецификация, пресеты */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 12 }}>
        <h3 style={hdr}>Состояние конструкции</h3>

        {errors.length > 0 && (
          <div className="issue error" data-testid="cabinet-errors">{errors.map((e, i) => <div key={i}>{e}</div>)}</div>
        )}

        <div data-testid="cabinet-check" style={{ marginBottom: 8 }}>
          {check && check.issues.length === 0 && (
            <div className="dim">Пересечений и нарушений зазоров нет.</div>
          )}
          {check?.issues.map((issue, i) => (
            <div key={i} className={`issue ${issue.severity === 'error' ? 'error' : 'warning'}`}>{issue.message}</div>
          ))}
        </div>

        <div className="dim" style={{ fontSize: 11, marginBottom: 8 }}>
          Пересчёт при изменении ширины: {affected.join(' → ')}
        </div>

        {/* Спецификация (§108–§114) */}
        {bom && (
          <section style={{ marginBottom: 12 }} data-testid="cabinet-bom">
            <span className="dim">Спецификация деталей</span>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr><th style={th}>№</th><th style={th}>Деталь</th><th style={th}>Материал</th>
                  <th style={th}>Размер</th><th style={th}>Кол-во</th><th style={th}>Кромка</th></tr>
              </thead>
              <tbody>
                {bom.parts.map((r) => (
                  <tr key={r.key}>
                    <td style={td}>{r.number}</td>
                    <td style={td}>{r.name}</td>
                    <td style={td}>{r.materialName}</td>
                    <td style={td}>{r.length}×{r.width}×{r.thickness}</td>
                    <td style={td}>{r.quantity}</td>
                    <td style={td}>{r.edgeLength}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
              Деталей: {bom.totals.partCount} · строк: {bom.totals.uniqueRows} ·
              {' '}материал: {bom.totals.materialAreaM2} м² · кромка: {bom.totals.edgeLengthM} м ·
              {' '}фурнитура: {bom.totals.hardwareCount} шт.
            </div>
            <button style={{ marginTop: 4 }} onClick={() => {
              const csv = cabinetBomCsv(bom);
              setMessages((m) => [`Спецификация CSV: ${csv.split('\n').length - 1} строк`, ...m]);
            }}>Спецификация CSV</button>
          </section>
        )}

        {/* Выбранная деталь (§101/§102) */}
        {selectedPart && (
          <section style={{ marginBottom: 12 }}>
            <span className="dim">Выбранная деталь</span>
            <div>
              <strong>{selectedPart.name}</strong>
              <span className="dim"> · {partSource(selectedPart)}</span>
              {hasOverride(selectedPart) && <em style={{ ...badge, color: '#e6c060' }}>Override</em>}
            </div>
            <div className="dim" style={{ fontSize: 11 }}>
              {Math.round(selectedPart.width)} × {Math.round(selectedPart.height)} × {selectedPart.thickness}
              {hasOverride(selectedPart) && ` · переопределено: ${Object.keys(partOverrides(selectedPart)).join(', ')}`}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button disabled={!hasOverride(selectedPart)}
                onClick={() => resetPartOverride(selectedPart.id as PartId)}>Вернуть расчёт</button>
              {onOpenPart && <button onClick={() => onOpenPart(selectedPart.id as PartId)}>Открыть деталь</button>}
            </div>
          </section>
        )}

        {/* Пресеты (§86–§89) */}
        <section style={{ marginBottom: 12 }} data-testid="cabinet-presets">
          <span className="dim">Пресеты конструкции</span>
          {presets.map((p) => (
            <div key={p.id} style={row}>
              <span>{p.name}{p.builtIn && <em style={badge}>встроенный</em>}</span>
              <span style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => {
                  const id = createCabinet({ presetId: p.id, name: p.name });
                  if (id) { setFurnitureId(id); setMessages((m) => [`Создан шкаф по пресету «${p.name}»`, ...m]); }
                }}>Создать</button>
                {!p.builtIn && <button onClick={() => removePreset(p.id)}>Удалить</button>}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <input placeholder="Имя пресета" value={presetName} data-testid="preset-name"
              onChange={(e) => setPresetName(e.target.value)} style={{ width: 140 }} />
            <button data-testid="preset-save" onClick={() => {
              const preset = savePreset(activeId, presetName);
              if (preset) { setPresetName(''); setMessages((m) => [`Пресет «${preset.name}» сохранён`, ...m]); }
            }}>Сохранить</button>
            <button data-testid="preset-export" onClick={() => {
              const json = exportCabinetPresets(customCabinetPresets(project));
              setMessages((m) => [`Экспорт пресетов: ${json.length} байт`, ...m]);
            }}>Экспорт JSON</button>
            <label style={{ cursor: 'pointer' }}>
              <span className="dim" style={{ fontSize: 11 }}>Импорт JSON</span>
              <input type="file" accept="application/json" style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const result = importPresets(await file.text());
                  setMessages((m) => [result.ok ? `Импортировано пресетов: ${result.added}` : result.errors.join(' '), ...m]);
                }} />
            </label>
          </div>
        </section>

        {/* Детали изделия (§98) */}
        <section style={{ marginBottom: 12 }}>
          <span className="dim">Детали изделия: {parts.length}</span>
        </section>

        <section>
          <span className="dim">История действий</span>
          {messages.length === 0 && <div className="dim" style={{ fontSize: 11 }}>Пока пусто.</div>}
          {messages.map((m, i) => <div key={i} className="dim" style={{ fontSize: 11 }}>{m}</div>)}
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
  marginLeft: 6, padding: '0 4px', fontSize: 10, fontStyle: 'normal',
  border: '1px solid var(--border)', borderRadius: 3,
};
const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid var(--border)', padding: '2px 4px' };
const td: React.CSSProperties = { padding: '2px 4px', borderBottom: '1px solid var(--border)' };
