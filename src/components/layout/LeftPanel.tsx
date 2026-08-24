import { ConstructionTree } from '../panels/ConstructionTree';

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
  onCreateFurniture: () => void;
}

export function LeftPanel({ section, onSection, onCreateFurniture }: Props) {
  return (
    <div className="left-panel">
      <div className="panel-section">
        <button style={{ width: '100%' }} onClick={onCreateFurniture}>
          + Создать изделие
        </button>
      </div>
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

      <ConstructionTree />
    </div>
  );
}
