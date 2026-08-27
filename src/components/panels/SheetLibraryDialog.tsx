import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useEditorStore } from '@/app/store/editorStore';
import type { MaterialId } from '@/core/model/ids';
import type { GrainDirection, StockMode } from '@/core/model/types';
import {
  STANDARD_SHEET_SIZES,
  filterStock,
  stockItems,
  stockSummary,
  type StockFilter,
  type StockItemStatus,
  type StockKind,
} from '@/engines/cutting';

const STATUS_LABEL: Record<StockItemStatus, string> = {
  AVAILABLE: 'Доступен',
  RESERVED: 'Зарезервирован',
  USED: 'Израсходован',
  ARCHIVED: 'Архив',
};

const STATUS_COLOR: Record<StockItemStatus, string> = {
  AVAILABLE: 'var(--ok,#4caf50)',
  RESERVED: 'var(--warn,#e0a030)',
  USED: 'var(--dim,#9aa0a6)',
  ARCHIVED: 'var(--dim,#9aa0a6)',
};

/**
 * Склад листовых материалов (§75–§80): форматы листов и сохранённые остатки
 * в одном списке, с фильтрами, поиском, архивом и защитой от удаления
 * формата, на котором построена активная карта раскроя.
 */
export function SheetLibraryDialog({ onClose }: { onClose: () => void }) {
  const project = useEditorStore((s) => s.project);
  const addSheet = useEditorStore((s) => s.addSheetMaterial);
  const updateSheet = useEditorStore((s) => s.updateSheetMaterial);
  const removeSheet = useEditorStore((s) => s.removeSheetMaterial);
  const setArchived = useEditorStore((s) => s.setSheetArchived);
  const setRemnantStatus = useEditorStore((s) => s.setRemnantStatus);
  const removeRemnant = useEditorStore((s) => s.removeRemnant);

  const firstMat = project.materials[0];
  const [materialId, setMaterialId] = useState<MaterialId | ''>(firstMat?.id ?? '');
  const [name, setName] = useState('Новый формат');
  const [height, setHeight] = useState(2750);
  const [width, setWidth] = useState(1830);
  const [qty, setQty] = useState(0);
  const [stockMode, setStockMode] = useState<StockMode>('INFINITE');
  const [edgeAllowance, setEdgeAllowance] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<StockFilter>({
    query: '', materialId: '', thickness: '', minWidth: '', minHeight: '', status: '', kind: '',
  });

  const items = useMemo(() => filterStock(stockItems(project), filter), [project, filter]);
  const summary = useMemo(() => stockSummary(project), [project]);
  const thicknesses = useMemo(
    () => [...new Set(project.materials.map((m) => m.thickness))].sort((a, b) => a - b),
    [project.materials],
  );

  const add = () => {
    if (!materialId) return;
    const mat = project.materials.find((m) => m.id === materialId);
    addSheet({
      materialId,
      name,
      width,
      height,
      thickness: mat?.thickness ?? 16,
      grainDirection: (mat?.grain ?? 'none') as GrainDirection,
      availableQuantity: stockMode === 'LIMITED' ? Math.max(0, qty) : 0,
      stockMode,
      edgeAllowance: edgeAllowance > 0 ? edgeAllowance : undefined,
      source: 'custom',
    });
    setError(null);
  };

  const doRemove = (id: string, kind: StockKind) => {
    if (kind === 'REMNANT') {
      removeRemnant(id);
      return;
    }
    const res = removeSheet(id);
    setError(res.ok ? null : (res.reason ?? 'Удаление невозможно.'));
  };

  const sel = { fontSize: 12 };

  return (
    <Modal title="Склад листовых материалов" onClose={onClose}>
      {/* Сводка (§64/§75) */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10, fontSize: 12 }}>
        {summary.map((row) => (
          <span key={String(row.materialId)} className="dim">
            <strong style={{ color: 'var(--fg)' }}>{row.materialName}</strong>
            {' '}· листов {row.sheetCount || '∞'} · остатков {row.remnantCount} · {row.areaM2.toFixed(2)} м²
          </span>
        ))}
        {summary.length === 0 && <span className="dim">Склад пуст.</span>}
      </div>

      {/* Поиск и фильтры (§76/§77) */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <input
          data-testid="stock-search"
          placeholder="Поиск: название, ID, размер"
          value={filter.query}
          onChange={(e) => setFilter({ ...filter, query: e.target.value })}
          style={{ flex: '1 1 180px', fontSize: 12 }}
        />
        <select value={String(filter.materialId ?? '')} style={sel}
          onChange={(e) => setFilter({ ...filter, materialId: e.target.value as MaterialId | '' })}>
          <option value="">Все материалы</option>
          {project.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={String(filter.thickness ?? '')} style={sel}
          onChange={(e) => setFilter({ ...filter, thickness: e.target.value === '' ? '' : Number(e.target.value) })}>
          <option value="">Все толщины</option>
          {thicknesses.map((t) => <option key={t} value={t}>{t} мм</option>)}
        </select>
        <select value={filter.kind ?? ''} style={sel}
          onChange={(e) => setFilter({ ...filter, kind: e.target.value as StockKind | '' })}>
          <option value="">Листы и остатки</option>
          <option value="SHEET">Только листы</option>
          <option value="REMNANT">Только остатки</option>
        </select>
        <select value={filter.status ?? ''} style={sel}
          onChange={(e) => setFilter({ ...filter, status: e.target.value as StockItemStatus | '' })}>
          <option value="">Любой статус</option>
          {(['AVAILABLE', 'RESERVED', 'USED', 'ARCHIVED'] as const).map((st) => (
            <option key={st} value={st}>{STATUS_LABEL[st]}</option>
          ))}
        </select>
        <input type="number" placeholder="Ширина от" value={String(filter.minWidth ?? '')} style={{ width: 90, fontSize: 12 }}
          onChange={(e) => setFilter({ ...filter, minWidth: e.target.value === '' ? '' : Number(e.target.value) })} />
        <input type="number" placeholder="Длина от" value={String(filter.minHeight ?? '')} style={{ width: 90, fontSize: 12 }}
          onChange={(e) => setFilter({ ...filter, minHeight: e.target.value === '' ? '' : Number(e.target.value) })} />
      </div>

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }} role="alert">{error}</div>
      )}

      <div style={{ maxHeight: 280, overflow: 'auto', marginBottom: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--dim,#9aa0a6)' }}>
              <th>Позиция</th><th>Материал</th><th>Д×Ш</th><th>Толщ.</th><th>Запас</th><th>Статус</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} data-stock-row={it.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td>
                  {it.name}
                  {it.kind === 'REMNANT' && <span className="dim"> · остаток</span>}
                </td>
                <td className="dim">{it.materialName}</td>
                <td>{Math.round(it.height)}×{Math.round(it.width)}</td>
                <td>{it.thickness}</td>
                <td>
                  {it.kind === 'SHEET' ? (
                    <input type="number" min={0} style={{ width: 56 }} value={it.quantity}
                      disabled={it.infinite}
                      onChange={(e) => updateSheet(it.id, {
                        availableQuantity: Math.max(0, Number(e.target.value) || 0),
                        stockMode: 'LIMITED',
                      })} />
                  ) : '1'}
                  {it.infinite && <span className="dim"> ∞</span>}
                </td>
                <td style={{ color: STATUS_COLOR[it.status] }}>{STATUS_LABEL[it.status]}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {it.kind === 'SHEET' ? (
                    <button style={{ fontSize: 11 }} onClick={() => setArchived(it.id, it.status !== 'ARCHIVED')}>
                      {it.status === 'ARCHIVED' ? 'Вернуть' : 'В архив'}
                    </button>
                  ) : (
                    <button style={{ fontSize: 11 }}
                      onClick={() => setRemnantStatus(it.id, it.status === 'ARCHIVED' ? 'AVAILABLE' : 'ARCHIVED')}>
                      {it.status === 'ARCHIVED' ? 'Вернуть' : 'В архив'}
                    </button>
                  )}
                  <button onClick={() => doRemove(it.id, it.kind)} style={{ color: 'var(--danger)', marginLeft: 4 }}>✕</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={7} className="dim">Ничего не найдено.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Добавление формата вручную (§7/§78) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label className="field"><span>Название</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Материал</span>
          <select value={materialId} onChange={(e) => setMaterialId(e.target.value as MaterialId)}>
            {project.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Стандартный размер</span>
          <select value="" onChange={(e) => {
            const size = STANDARD_SHEET_SIZES.find((x) => x.name === e.target.value);
            if (size) { setHeight(size.height); setWidth(size.width); }
          }}>
            <option value="">Выбрать…</option>
            {STANDARD_SHEET_SIZES.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Режим запаса</span>
          <select value={stockMode} onChange={(e) => setStockMode(e.target.value as StockMode)}>
            <option value="INFINITE">Неограниченный</option>
            <option value="LIMITED">Ограниченный</option>
          </select>
        </label>
        <label className="field"><span>Длина, мм</span><input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value) || 0)} /></label>
        <label className="field"><span>Ширина, мм</span><input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value) || 0)} /></label>
        <label className="field"><span>Запас, листов</span>
          <input type="number" min={0} value={qty} disabled={stockMode === 'INFINITE'}
            onChange={(e) => setQty(Number(e.target.value) || 0)} />
        </label>
        <label className="field"><span>Припуск по краю, мм</span>
          <input type="number" min={0} value={edgeAllowance} onChange={(e) => setEdgeAllowance(Number(e.target.value) || 0)} />
        </label>
      </div>
      <div style={{ marginTop: 10 }}>
        <button onClick={add} disabled={!materialId}>Добавить формат</button>
      </div>
      <p className="dim" style={{ fontSize: 11, marginTop: 8 }}>
        Ограниченный запас задаёт количество листов формата: когда он исчерпан, детали получают статус
        «нет материала». Формат, использованный активной картой раскроя, удалить нельзя — отправьте его в архив.
      </p>
    </Modal>
  );
}
