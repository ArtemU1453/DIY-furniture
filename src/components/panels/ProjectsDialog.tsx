import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import {
  deleteProjectById,
  listSavedProjects,
  openProjectById,
} from '@/features/project/projectActions';
import type { ProjectSummary } from '@/storage/project/projectRepository';

export function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setProjects(await listSavedProjects());
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <Modal title="Открыть проект" onClose={onClose}>
      {loading && <div className="empty-hint">Загрузка…</div>}
      {!loading && projects.length === 0 && (
        <div className="empty-hint">Сохранённых проектов пока нет.</div>
      )}
      <ul className="parts-list">
        {projects.map((p) => (
          <li key={p.id} style={{ alignItems: 'center' }}>
            <span
              style={{ cursor: 'pointer', flex: 1 }}
              onClick={async () => {
                await openProjectById(p.id);
                onClose();
              }}
            >
              {p.name}
              <span className="dim"> · {new Date(p.updatedAt).toLocaleString()}</span>
            </span>
            <button
              onClick={async () => {
                await deleteProjectById(p.id);
                await refresh();
              }}
            >
              Удалить
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
