import { Modal } from '../ui/Modal';
import { useEditorStore } from '@/app/store/editorStore';

const TYPES: Array<{ type: string; label: string; enabled: boolean }> = [
  { type: 'cabinet', label: 'Шкаф', enabled: true },
  { type: 'nightstand', label: 'Тумба', enabled: false },
  { type: 'shelving', label: 'Стеллаж', enabled: false },
];

export function CreateFurnitureDialog({ onClose }: { onClose: () => void }) {
  const createCabinet = useEditorStore((s) => s.createCabinet);

  return (
    <Modal title="Создать изделие" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {TYPES.map((t) => (
          <button
            key={t.type}
            disabled={!t.enabled}
            onClick={() => {
              if (t.type === 'cabinet') {
                createCabinet();
                onClose();
              }
            }}
            style={{ textAlign: 'left', padding: '10px 12px' }}
          >
            {t.label}
            {!t.enabled && <span className="dim"> — скоро</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}
