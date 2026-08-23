import { Modal } from '../ui/Modal';
import { useEditorStore } from '@/app/store/editorStore';
import { NumberField } from '../ui/NumberField';
import type { ProjectSettings } from '@/core/model/types';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useEditorStore((s) => s.project.settings);
  const updateSettings = useEditorStore((s) => s.updateSettings);

  return (
    <Modal title="Настройки проекта" onClose={onClose}>
      <div className="field">
        <label>Единицы отображения</label>
        <select
          value={settings.displayUnits}
          onChange={(e) =>
            updateSettings({ displayUnits: e.target.value as ProjectSettings['displayUnits'] })
          }
        >
          <option value="mm">мм</option>
          <option value="cm">см</option>
          <option value="m">м</option>
          <option value="in">дюймы</option>
        </select>
      </div>
      <NumberField
        label="Ширина пропила"
        suffix="мм"
        value={settings.kerf}
        min={0}
        onCommit={(v) => updateSettings({ kerf: v })}
      />
      <NumberField
        label="Обрезка листа по краям"
        suffix="мм"
        value={settings.sheetTrim}
        min={0}
        onCommit={(v) => updateSettings({ sheetTrim: v })}
      />
      <div className="field">
        <label>
          <input
            type="checkbox"
            style={{ width: 'auto', marginRight: 6 }}
            checked={settings.costEnabled}
            onChange={(e) => updateSettings({ costEnabled: e.target.checked })}
          />
          Учитывать стоимость (опционально)
        </label>
      </div>
    </Modal>
  );
}
