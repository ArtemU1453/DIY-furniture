import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, totalPartCount } from '@/core/model/selectors';
import { computeModuleStatuses, MODULE_STATE_COLOR, MODULE_STATE_LABEL } from '@/engines/status';
import { TextField } from '../ui/TextField';
import { ProductionCheckDialog } from './ProductionCheckDialog';

/** Свойства проекта (контекст, когда ничего не выбрано): статусы модулей и проверка. */
export function ProjectPanel() {
  const project = useEditorStore((s) => s.project);
  const cuttingRunning = useEditorStore((s) => s.cuttingRunning);
  const setProjectName = useEditorStore((s) => s.setProjectName);
  const [checkOpen, setCheckOpen] = useState(false);

  const statuses = useMemo(() => computeModuleStatuses(project, { cuttingRunning }), [project, cuttingRunning]);

  return (
    <>
      <div className="panel-section">
        <h3>Проект</h3>
        <TextField label="Название" value={project.name} onCommit={setProjectName} />
        <div className="dim">Изделий: {project.furnitures.length}</div>
        <div className="dim">Деталей: {allParts(project).length} (всего {totalPartCount(project)})</div>
        <div className="dim">Формат: {project.version}</div>
      </div>

      <div className="panel-section">
        <h3>Статусы модулей</h3>
        {statuses.map((s) => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span>{s.label}</span>
            <span style={{ color: MODULE_STATE_COLOR[s.state], fontVariantNumeric: 'tabular-nums' }}>
              {MODULE_STATE_LABEL[s.state]}{s.note ? ` · ${s.note}` : ''}
            </span>
          </div>
        ))}
      </div>

      <div className="panel-section">
        <button style={{ width: '100%' }} onClick={() => setCheckOpen(true)}>Проверить проект</button>
      </div>

      {checkOpen && <ProductionCheckDialog onClose={() => setCheckOpen(false)} />}
    </>
  );
}
