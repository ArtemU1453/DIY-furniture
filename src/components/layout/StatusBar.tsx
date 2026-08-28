import { useEditorStore } from '@/app/store/editorStore';
import { allParts, totalPartCount } from '@/core/model/selectors';
import { validateProjectModel } from '@/engines/status';

const SAVE_LABEL: Record<'saved' | 'unsaved' | 'saving' | 'error', { text: string; color: string }> = {
  saved: { text: '● Сохранено', color: 'var(--ok)' },
  unsaved: { text: '● Есть несохранённые изменения', color: '#e6c060' },
  saving: { text: '● Сохранение…', color: 'var(--accent)' },
  // Молчать о неудачном сохранении нельзя: пользователь должен успеть
  // выгрузить проект в файл, пока правки не потеряны.
  error: { text: '● Не удалось сохранить', color: 'var(--danger)' },
};

export function StatusBar({ status }: { status: string }) {
  const project = useEditorStore((s) => s.project);
  const saveState = useEditorStore((s) => s.saveState);
  const cuttingRunning = useEditorStore((s) => s.cuttingRunning);
  const uniqueParts = allParts(project).length;
  const totalParts = totalPartCount(project);
  const furnitures = project.furnitures.length;
  const validation = validateProjectModel(project);
  const errors = validation.issues.filter((i) => i.severity === 'error').length;
  const save = SAVE_LABEL[saveState];

  return (
    <div className="status-bar">
      <span>{cuttingRunning ? 'Расчёт раскроя…' : status || 'Готово'}</span>
      <span style={{ color: save.color }}>{save.text}</span>
      <span className="spacer" />
      {errors > 0 ? (
        <span style={{ color: 'var(--danger)' }}>Ошибок: {errors}</span>
      ) : (
        <span style={{ color: 'var(--ok)' }}>Модель корректна</span>
      )}
      <span>Изделий: {furnitures}</span>
      <span>
        Деталей: {uniqueParts} (всего {totalParts})
      </span>
    </div>
  );
}
