import { useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { useEditorStore } from '@/app/store/editorStore';
import { runProductionCheck } from '@/engines/status';

export function ProductionCheckDialog({ onClose }: { onClose: () => void }) {
  const project = useEditorStore((s) => s.project);
  const cuttingRunning = useEditorStore((s) => s.cuttingRunning);
  const result = useMemo(() => runProductionCheck(project, { cuttingRunning }), [project, cuttingRunning]);

  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');

  return (
    <Modal title="Проверка проекта" onClose={onClose}>
      {result.ready ? (
        <div style={{ color: 'var(--ok)', fontWeight: 600, marginBottom: 10 }}>
          ✓ ГОТОВО — критических ошибок не найдено{warnings.length ? ` (предупреждений: ${warnings.length})` : ''}.
        </div>
      ) : (
        <div style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: 10 }}>
          Найдены ошибки: {errors.length}. Исправьте их перед выпуском документации.
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {errors.map((i, k) => (
            <div key={k} className="issue error">{i.message}</div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div>
          {warnings.map((i, k) => (
            <div key={k} className="issue warning">{i.message}</div>
          ))}
        </div>
      )}
      {result.issues.length === 0 && <div className="empty-hint">Проблем не обнаружено.</div>}

      <div style={{ marginTop: 12 }}>
        <button onClick={onClose}>Закрыть</button>
      </div>
    </Modal>
  );
}
