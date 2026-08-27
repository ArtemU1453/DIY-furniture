import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import { checkNewConnection } from '@/engines/connections';
import { previewRules } from '@/engines/library';
import { connectionTypeOfCategory, CONNECTION_TYPE_LABELS } from '@/engines/machining';
import type { HardwareId, PartId } from '@/core/model/ids';

export function ConnectionDialog({ onClose }: { onClose: () => void }) {
  const project = useEditorStore((s) => s.project);
  const addConnection = useEditorStore((s) => s.addConnection);
  const parts = useMemo(() => allParts(project), [project]);

  const [hardwareId, setHardwareId] = useState<HardwareId | ''>(project.hardware[0]?.id ?? '');
  const [partAId, setPartAId] = useState<PartId | ''>('');
  const [partBId, setPartBId] = useState<PartId | ''>('');
  const [quantity, setQuantity] = useState(2);
  const [error, setError] = useState('');

  const partLabel = (id: string) => {
    const p = parts.find((x) => x.id === id);
    return p ? `${p.metadata?.number ?? ''} ${p.name}`.trim() : '';
  };

  const hardware = project.hardware.find((h) => h.id === hardwareId);
  const connectionType = hardware ? connectionTypeOfCategory(hardware.category) : undefined;

  /* Проверка и предпросмотр до создания (§26/§40): пользователь заранее
   * видит, какие операции присадки появятся и что мешает соединению. */
  const check = useMemo(() => {
    if (!hardwareId || !partAId || !partBId) return null;
    return checkNewConnection(
      { hardwareId, partAId, partBId, connectionType, quantity },
      project,
    );
  }, [hardwareId, partAId, partBId, connectionType, quantity, project]);

  const preview = useMemo(() => (hardware ? previewRules(hardware) : []), [hardware]);

  const create = () => {
    if (!hardwareId || !partAId || !partBId) {
      setError('Выберите фурнитуру и обе детали.');
      return;
    }
    const res = addConnection({ hardwareId, partAId, partBId, quantity: Math.max(1, quantity) });
    if (!res.ok) setError(res.message ?? 'Не удалось создать соединение.');
    else onClose();
  };

  return (
    <Modal title="Новое соединение" onClose={onClose}>
      <div className="field">
        <label>Тип фурнитуры</label>
        <select value={hardwareId} onChange={(e) => setHardwareId(e.target.value as HardwareId)}>
          <option value="">— выберите —</option>
          {project.hardware.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Деталь A</label>
        <select value={partAId} onChange={(e) => setPartAId(e.target.value as PartId)}>
          <option value="">— выберите —</option>
          {parts.map((p) => (
            <option key={p.id} value={p.id}>{partLabel(p.id)}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Деталь B</label>
        <select value={partBId} onChange={(e) => setPartBId(e.target.value as PartId)}>
          <option value="">— выберите —</option>
          {parts.map((p) => (
            <option key={p.id} value={p.id}>{partLabel(p.id)}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Количество крепежа</label>
        <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)} />
      </div>

      {/* Тип соединения выводится из категории крепежа (§25). */}
      {connectionType && (
        <div className="field">
          <label>Тип соединения</label>
          <div>{CONNECTION_TYPE_LABELS[connectionType] ?? connectionType}</div>
        </div>
      )}

      {/* Что будет создано (§26). */}
      {preview.length > 0 && (
        <div className="field">
          <label>Будет создано</label>
          {preview.map((r, i) => <div key={i} className="dim">{r.label}</div>)}
        </div>
      )}

      {check && check.issues.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {check.issues.map((i, n) => (
            <div key={n} className={`issue ${i.severity === 'error' ? 'error' : 'warning'}`}>{i.message}</div>
          ))}
        </div>
      )}
      {check && check.issues.length === 0 && (
        <div className="issue" style={{ marginTop: 6, color: 'var(--ok)' }}>Соединение корректно.</div>
      )}

      {error && <div className="issue error">{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={create}>Создать соединение</button>
        <button onClick={onClose}>Отмена</button>
      </div>
    </Modal>
  );
}
