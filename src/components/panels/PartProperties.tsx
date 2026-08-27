import { useMemo } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { findPart } from '@/core/model/selectors';
import { NumberField } from '../ui/NumberField';
import { validatePartChange } from '@/engines/viewer';
import type { PartId } from '@/core/model/ids';

/**
 * Свойства выбранной детали: размеры, позиция, поворот, материал, кромка, P-ID.
 * Любое изменение идёт UI → ProjectModel (через store) → 3D перерисовывается;
 * раскрой становится DIRTY, документы — OUTDATED автоматически.
 */
export function PartProperties() {
  const project = useEditorStore((s) => s.project);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const updatePart = useEditorStore((s) => s.updatePart);
  const setPartFlag = useEditorStore((s) => s.setPartFlag);

  const part = useMemo(
    () => (selectedPartId ? findPart(project, selectedPartId) : undefined),
    [project, selectedPartId],
  );

  if (!part) {
    return <div style={{ padding: 10 }}><h3 style={hdr}>Свойства детали</h3><div className="empty-hint">Выберите деталь.</div></div>;
  }

  const locked = part.metadata?.locked === true;
  const hidden = part.metadata?.hidden === true;
  const material = project.materials.find((m) => m.id === part.material);
  const edgeName = (id: string | null) => (id ? project.edges.find((e) => e.id === id)?.name ?? '—' : 'нет');

  // Изменение размера: проверяем допустимость, затем пишем в модель.
  const setDim = (patch: { width?: number; height?: number; thickness?: number }) => {
    const issues = validatePartChange(project, String(part.id), patch);
    if (issues.some((i) => i.severity === 'error')) return;
    updatePart(part.id as PartId, patch);
  };
  const setPos = (axis: 'x' | 'y' | 'z', v: number) => {
    if (locked) return;
    updatePart(part.id as PartId, { position: { ...part.position, [axis]: v } });
  };

  return (
    <div style={{ padding: 10, overflow: 'auto', height: '100%' }}>
      <h3 style={hdr}>Свойства детали</h3>
      <Row k="P-ID" v={(part.metadata?.number as string) ?? '—'} />
      <Row k="Наименование" v={part.name} />
      <Row k="Материал" v={material?.name ?? '—'} />

      <div className="panel-section" style={{ padding: 0, marginTop: 10, borderBottom: 'none' }}>
        <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>Размер, мм</div>
        <div className="field-row">
          <NumberField label="W" min={1} value={part.width} onCommit={(v) => setDim({ width: v })} />
          <NumberField label="H" min={1} value={part.height} onCommit={(v) => setDim({ height: v })} />
        </div>
        <NumberField label="T" min={1} value={part.thickness} onCommit={(v) => setDim({ thickness: v })} />
      </div>

      <div className="panel-section" style={{ padding: 0, marginTop: 10, borderBottom: 'none' }}>
        <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>Позиция, мм</div>
        <div className="field-row">
          <NumberField label="X" value={part.position.x} onCommit={(v) => setPos('x', v)} />
          <NumberField label="Y" value={part.position.y} onCommit={(v) => setPos('y', v)} />
        </div>
        <NumberField label="Z" value={part.position.z} onCommit={(v) => setPos('z', v)} />
      </div>

      <div className="panel-section" style={{ padding: 0, marginTop: 10, borderBottom: 'none' }}>
        <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>Поворот, °</div>
        <Row k="X / Y / Z" v={`${part.rotation.x} / ${part.rotation.y} / ${part.rotation.z}`} />
      </div>

      <div className="panel-section" style={{ padding: 0, marginTop: 10, borderBottom: 'none' }}>
        <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>Кромка</div>
        <Row k="Левая" v={edgeName(part.edges.left)} />
        <Row k="Правая" v={edgeName(part.edges.right)} />
        <Row k="Верх" v={edgeName(part.edges.top)} />
        <Row k="Низ" v={edgeName(part.edges.bottom)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 12 }}>
        <button onClick={() => setPartFlag(part.id as PartId, { locked: !locked })} style={locked ? { borderColor: 'var(--accent)' } : undefined}>
          {locked ? 'Разблокировать' : 'Заблокировать'}
        </button>
        <button onClick={() => setPartFlag(part.id as PartId, { hidden: !hidden })}>
          {hidden ? 'Показать' : 'Скрыть'}
        </button>
      </div>
      {locked && <div className="dim" style={{ marginTop: 6, fontSize: 11 }}>Деталь заблокирована — перемещение запрещено.</div>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', gap: 8 }}>
      <span className="dim">{k}</span>
      <span style={{ textAlign: 'right' }}>{v}</span>
    </div>
  );
}

const hdr: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', margin: '0 0 8px' };
