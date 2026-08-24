import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import { useEditorStore } from '@/app/store/editorStore';
import type { TopMount } from '@/engines/furniture/cabinet';

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const newProject = useEditorStore((s) => s.newProject);
  const createCabinet = useEditorStore((s) => s.createCabinet);
  const updateCabinetParams = useEditorStore((s) => s.updateCabinetParams);
  const removeFurniture = useEditorStore((s) => s.removeFurniture);

  const [name, setName] = useState('Новый проект');
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(2000);
  const [depth, setDepth] = useState(600);
  const [thickness, setThickness] = useState(16);
  const [top, setTop] = useState<TopMount>('between');

  const create = () => {
    newProject(name);
    // Убираем пустое изделие по умолчанию и создаём параметрический шкаф.
    const emptyId = useEditorStore.getState().project.furnitures[0]?.id;
    const cabId = createCabinet('Шкаф');
    updateCabinetParams(cabId, { width, height, depth, thickness, top });
    if (emptyId) removeFurniture(emptyId);
    onClose();
  };

  return (
    <Modal title="Новый проект" onClose={onClose}>
      <TextField label="Название" value={name} onCommit={setName} />
      <div className="field-row">
        <NumberField label="Ширина" suffix="мм" min={1} value={width} onCommit={setWidth} />
        <NumberField label="Высота" suffix="мм" min={1} value={height} onCommit={setHeight} />
      </div>
      <div className="field-row">
        <NumberField label="Глубина" suffix="мм" min={1} value={depth} onCommit={setDepth} />
        <NumberField label="Толщина" suffix="мм" min={1} value={thickness} onCommit={setThickness} />
      </div>
      <div className="field">
        <label>Тип конструкции (верх)</label>
        <select value={top} onChange={(e) => setTop(e.target.value as TopMount)}>
          <option value="between">Между боковинами</option>
          <option value="overlay">Поверх боковин</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={create}>Создать</button>
        <button onClick={onClose}>Отмена</button>
      </div>
    </Modal>
  );
}
