import { useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { createBlankEdge, createBlankMaterial } from '@/core/model/factory';
import { materialKindLabel } from '@/i18n/catalog';
import { MaterialEditor } from './MaterialEditor';
import { EdgeEditor } from './EdgeEditor';
import type { EdgeMaterial, Material } from '@/core/model/types';

export function MaterialsView() {
  const materials = useEditorStore((s) => s.project.materials);
  const edges = useEditorStore((s) => s.project.edges);

  const [matEdit, setMatEdit] = useState<{ material: Material; isNew: boolean } | null>(null);
  const [edgeEdit, setEdgeEdit] = useState<{ edge: EdgeMaterial; isNew: boolean } | null>(null);

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, height: '100%', overflow: 'auto', alignItems: 'flex-start' }}>
      <section style={{ flex: 1, minWidth: 260 }}>
        <div style={header}>
          <h3 style={{ margin: 0 }}>Материалы</h3>
          <button onClick={() => setMatEdit({ material: createBlankMaterial(), isNew: true })}>
            + Добавить материал
          </button>
        </div>
        {materials.map((m) => (
          <div key={m.id} style={card} onClick={() => setMatEdit({ material: m, isNew: false })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 16, height: 16, borderRadius: 3, background: m.color, border: '1px solid var(--border)' }} />
              <strong>{m.name}</strong>
            </div>
            <div className="dim">
              {materialKindLabel(m.kind)} · {m.thickness} мм · {m.sheet.length}×{m.sheet.width}
            </div>
          </div>
        ))}
      </section>

      <section style={{ flex: 1, minWidth: 220 }}>
        <div style={header}>
          <h3 style={{ margin: 0 }}>Кромка</h3>
          <button onClick={() => setEdgeEdit({ edge: createBlankEdge(), isNew: true })}>
            + Добавить кромку
          </button>
        </div>
        {edges.map((e) => (
          <div key={e.id} style={card} onClick={() => setEdgeEdit({ edge: e, isNew: false })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 16, height: 16, borderRadius: 3, background: e.color, border: '1px solid var(--border)' }} />
              <strong>{e.name}</strong>
            </div>
            <div className="dim">{e.thickness} мм</div>
          </div>
        ))}
      </section>

      {matEdit && <MaterialEditor material={matEdit.material} isNew={matEdit.isNew} onClose={() => setMatEdit(null)} />}
      {edgeEdit && <EdgeEditor edge={edgeEdit.edge} isNew={edgeEdit.isNew} onClose={() => setEdgeEdit(null)} />}
    </div>
  );
}

const header: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 };
const card: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  marginBottom: 8,
  cursor: 'pointer',
  background: 'var(--bg-panel)',
};
