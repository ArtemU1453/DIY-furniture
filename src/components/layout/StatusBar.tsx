import { useEditorStore } from '@/app/store/editorStore';
import { allParts, totalPartCount } from '@/core/model/selectors';
import { validateProject } from '@/core/validation';

export function StatusBar({ status }: { status: string }) {
  const project = useEditorStore((s) => s.project);
  const uniqueParts = allParts(project).length;
  const totalParts = totalPartCount(project);
  const furnitures = project.furnitures.length;
  const validation = validateProject(project);
  const errors = validation.issues.filter((i) => i.severity === 'error').length;

  return (
    <div className="status-bar">
      <span>{status || 'Готово'}</span>
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
