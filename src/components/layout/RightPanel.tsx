import { useEditorStore } from '@/app/store/editorStore';
import { findFurniture } from '@/core/model/selectors';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { CabinetPanel } from '../panels/CabinetPanel';

/**
 * Правая панель: показывает свойства выбранной детали, иначе — параметры
 * активного изделия (шкафа).
 */
export function RightPanel() {
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const activeFurnitureId = useEditorStore((s) => s.activeFurnitureId);
  const activeFurniture = useEditorStore((s) =>
    s.activeFurnitureId ? findFurniture(s.project, s.activeFurnitureId) : undefined,
  );
  const selectPart = useEditorStore((s) => s.selectPart);

  if (selectedPartId) {
    return (
      <div className="right-panel">
        <div className="panel-section" style={{ paddingBottom: 4 }}>
          <button onClick={() => selectPart(null)}>← К параметрам изделия</button>
        </div>
        <PropertiesPanel />
      </div>
    );
  }

  if (activeFurnitureId && activeFurniture?.type === 'cabinet') {
    return (
      <div className="right-panel">
        <CabinetPanel furnitureId={activeFurnitureId} />
      </div>
    );
  }

  return (
    <div className="right-panel">
      <div className="panel-section">
        <h3>Свойства</h3>
        <div className="empty-hint">
          Создайте изделие (кнопка «+ Создать изделие») или выберите деталь.
        </div>
      </div>
    </div>
  );
}
