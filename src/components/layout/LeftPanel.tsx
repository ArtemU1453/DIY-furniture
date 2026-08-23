import { useMemo } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';

export type NavSection =
  | 'project'
  | 'furniture'
  | 'parts'
  | 'materials'
  | 'hardware'
  | 'cutting'
  | 'drawings'
  | 'documents';

const NAV: Array<[NavSection, string]> = [
  ['project', 'Проект'],
  ['furniture', 'Изделия'],
  ['parts', 'Детали'],
  ['materials', 'Материалы'],
  ['hardware', 'Фурнитура'],
  ['cutting', 'Раскрой'],
  ['drawings', 'Чертежи'],
  ['documents', 'Документы'],
];

interface Props {
  section: NavSection;
  onSection: (s: NavSection) => void;
}

export function LeftPanel({ section, onSection }: Props) {
  const project = useEditorStore((s) => s.project);
  const parts = useMemo(() => allParts(project), [project]);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectPart = useEditorStore((s) => s.selectPart);
  const addPart = useEditorStore((s) => s.addPart);

  return (
    <div className="left-panel">
      <div className="panel-section">
        <h3>Разделы</h3>
        <ul className="nav-list">
          {NAV.map(([key, label]) => (
            <li
              key={key}
              className={key === section ? 'active' : ''}
              onClick={() => onSection(key)}
            >
              {label}
            </li>
          ))}
        </ul>
      </div>

      <div className="panel-section">
        <h3>Детали ({parts.length})</h3>
        <button style={{ width: '100%', marginBottom: 8 }} onClick={() => selectPart(addPart())}>
          + Добавить деталь
        </button>
        {parts.length === 0 && <div className="empty-hint">Нет деталей. Добавьте первую.</div>}
        <ul className="parts-list">
          {parts.map((p) => (
            <li
              key={p.id}
              className={p.id === selectedPartId ? 'selected' : ''}
              onClick={() => selectPart(p.id)}
            >
              <span>{p.name}</span>
              <span className="dim">
                {Math.round(p.width)}×{Math.round(p.height)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
