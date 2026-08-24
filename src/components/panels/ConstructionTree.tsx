import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import type { Furniture, Part, PartRole } from '@/core/model/types';
import type { PartId } from '@/core/model/ids';

/** Группы дерева по ролям деталей. */
const GROUPS: Array<{ label: string; roles: PartRole[] }> = [
  { label: 'Корпус', roles: ['side', 'top', 'bottom', 'back'] },
  { label: 'Внутренние', roles: ['shelf', 'divider'] },
  { label: 'Фасады', roles: ['facade'] },
  { label: 'Прочее', roles: ['custom', 'plinth', 'leg'] as PartRole[] },
];

const ADD_KINDS: Array<[Parameters<ReturnType<typeof useEditorStore.getState>['addElement']>[0], string]> = [
  ['panel', 'Панель'],
  ['shelf', 'Полка'],
  ['divider', 'Перегородка'],
  ['facade', 'Фасад'],
  ['back', 'Задняя стенка'],
];

/** Дерево конструкции: изделия → группы → детали. Выбор синхронизирован по ID. */
export function ConstructionTree() {
  const project = useEditorStore((s) => s.project);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectPart = useEditorStore((s) => s.selectPart);
  const addElement = useEditorStore((s) => s.addElement);
  const [addOpen, setAddOpen] = useState(false);

  const furnitures = project.furnitures;

  return (
    <div className="panel-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>Конструкция</h3>
        <button style={{ padding: '2px 8px' }} onClick={() => setAddOpen((v) => !v)}>+ элемент</button>
      </div>
      {addOpen && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {ADD_KINDS.map(([kind, label]) => (
            <button
              key={kind}
              style={{ padding: '2px 6px', fontSize: 12 }}
              onClick={() => { selectPart(addElement(kind)); setAddOpen(false); }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {furnitures.map((f) => (
        <FurnitureNode key={f.id} furniture={f} selectedPartId={selectedPartId} onSelect={selectPart} />
      ))}
    </div>
  );
}

function FurnitureNode({ furniture, selectedPartId, onSelect }: { furniture: Furniture; selectedPartId: string | null; onSelect: (id: PartId) => void }) {
  const parts = useMemo(() => furniture.assemblies.flatMap((a) => a.parts), [furniture]);
  const grouped = GROUPS.map((g) => ({ label: g.label, parts: parts.filter((p) => g.roles.includes(p.role)) })).filter((g) => g.parts.length > 0);

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{furniture.name}</div>
      {grouped.map((g) => (
        <div key={g.label} style={{ marginLeft: 8, marginBottom: 4 }}>
          <div className="dim" style={{ fontSize: 11, margin: '2px 0' }}>{g.label}</div>
          <ul className="parts-list" style={{ marginLeft: 4 }}>
            {g.parts.map((p) => (
              <PartRow key={p.id} part={p} selected={p.id === selectedPartId} onSelect={onSelect} />
            ))}
          </ul>
        </div>
      ))}
      {parts.length === 0 && <div className="empty-hint" style={{ marginLeft: 8 }}>Нет деталей.</div>}
    </div>
  );
}

function PartRow({ part, selected, onSelect }: { part: Part; selected: boolean; onSelect: (id: PartId) => void }) {
  const hidden = part.metadata?.hidden === true;
  const locked = part.metadata?.locked === true;
  return (
    <li className={selected ? 'selected' : ''} onClick={() => onSelect(part.id)} style={{ opacity: hidden ? 0.5 : 1 }}>
      <span>
        {(part.metadata?.number as string) ? `${part.metadata?.number} ` : ''}{part.name}
        {locked && ' 🔒'}
        {hidden && ' 🚫'}
      </span>
      <span className="dim">{Math.round(part.width)}×{Math.round(part.height)}</span>
    </li>
  );
}
