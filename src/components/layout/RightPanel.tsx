import { useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { findFurniture } from '@/core/model/selectors';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { CabinetPanel } from '../panels/CabinetPanel';
import { ProjectPanel } from '../panels/ProjectPanel';

/**
 * Контекстная правая панель:
 *  - выбрана деталь → свойства детали;
 *  - активно изделие (шкаф) → параметры изделия;
 *  - иначе → свойства проекта.
 * Переключатель «Изделие / Проект» доступен, когда есть активный шкаф.
 */
export function RightPanel() {
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const activeFurnitureId = useEditorStore((s) => s.activeFurnitureId);
  const activeFurniture = useEditorStore((s) =>
    s.activeFurnitureId ? findFurniture(s.project, s.activeFurnitureId) : undefined,
  );
  const selectPart = useEditorStore((s) => s.selectPart);
  const [tab, setTab] = useState<'furniture' | 'project'>('furniture');

  if (selectedPartId) {
    return (
      <div className="right-panel">
        <div className="panel-section" style={{ paddingBottom: 4 }}>
          <button onClick={() => selectPart(null)}>← К свойствам изделия</button>
        </div>
        <PropertiesPanel />
      </div>
    );
  }

  const hasCabinet = activeFurnitureId && activeFurniture?.type === 'cabinet';

  return (
    <div className="right-panel">
      {hasCabinet && (
        <div className="panel-section" style={{ display: 'flex', gap: 4, paddingBottom: 4 }}>
          <button className={tab === 'furniture' ? 'active' : ''} style={tab === 'furniture' ? activeBtn : undefined} onClick={() => setTab('furniture')}>Изделие</button>
          <button className={tab === 'project' ? 'active' : ''} style={tab === 'project' ? activeBtn : undefined} onClick={() => setTab('project')}>Проект</button>
        </div>
      )}
      {hasCabinet && tab === 'furniture' ? <CabinetPanel furnitureId={activeFurnitureId!} /> : <ProjectPanel />}
    </div>
  );
}

const activeBtn: React.CSSProperties = { borderColor: 'var(--accent)', background: 'var(--accent-dim)' };
