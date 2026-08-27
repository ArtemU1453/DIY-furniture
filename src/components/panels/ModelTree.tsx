import { useMemo } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { buildModelTree } from '@/engines/viewer';
import type { PartId } from '@/core/model/ids';

/**
 * Дерево модели: группы деталей (корпус/полки/перегородки/фасады/задняя стенка)
 * и фурнитура. Дерево — производное от ProjectModel; выбор синхронизирован с 3D
 * через общий selectedPartId.
 */
export function ModelTree() {
  const project = useEditorStore((s) => s.project);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectPart = useEditorStore((s) => s.selectPart);
  const setPartFlag = useEditorStore((s) => s.setPartFlag);

  const tree = useMemo(() => buildModelTree(project), [project]);

  return (
    <div style={{ padding: 10, overflow: 'auto', height: '100%' }}>
      <h3 style={hdr}>Дерево модели</h3>
      {tree.groups.length === 0 && <div className="empty-hint">Деталей нет.</div>}
      {tree.groups.map((g) => (
        <div key={g.id} style={{ marginBottom: 10 }}>
          <div className="dim" style={{ fontSize: 11, marginBottom: 2 }}>{g.label} ({g.nodes.length})</div>
          <ul className="parts-list">
            {g.nodes.map((n) => (
              <li
                key={n.partId}
                className={n.partId === selectedPartId ? 'selected' : ''}
                onClick={() => selectPart(n.partId as PartId)}
                style={{ opacity: n.hidden ? 0.45 : 1 }}
              >
                <span>{n.label}</span>
                <button
                  title={n.hidden ? 'Показать' : 'Скрыть'}
                  onClick={(e) => { e.stopPropagation(); setPartFlag(n.partId as PartId, { hidden: !n.hidden }); }}
                  style={{ fontSize: 11, padding: '0 4px' }}
                >{n.hidden ? '◌' : '👁'}</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {tree.hardware.length > 0 && (
        <div>
          <div className="dim" style={{ fontSize: 11, marginBottom: 2 }}>Фурнитура</div>
          <ul className="parts-list">
            {tree.hardware.map((h) => (
              <li key={h.id}><span>{h.label}</span><span className="dim">{h.count} шт.</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const hdr: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', margin: '0 0 8px' };
