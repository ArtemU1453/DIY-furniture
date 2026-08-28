import { Modal } from '../ui/Modal';
import { useEditorStore } from '@/app/store/editorStore';
import { NumberField } from '../ui/NumberField';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useEditorStore((s) => s.project.settings);
  const updateSettings = useEditorStore((s) => s.updateSettings);

  return (
    <Modal title="Настройки проекта" onClose={onClose}>
      {/* Все производственные размеры — в миллиметрах: раскрой, присадка,
        * спецификация и документы считают только в мм. Выбор других единиц
        * ничего не менял, поэтому вместо неработающего переключателя здесь
        * честная подпись. */}
      <div className="field">
        <label>Единицы измерения</label>
        <div className="dim" style={{ fontSize: 12 }} data-testid="settings-units">
          миллиметры — единые для модели, раскроя, присадки и документов
        </div>
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
