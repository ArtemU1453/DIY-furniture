import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import { instanceCounts, placementLabel, planStatus } from '@/engines/cutting';
import type { CuttingPlanStatus, Part, Placement } from '@/core/model/types';
import type { PartId } from '@/core/model/ids';

/** Строка таблицы РАСКРОЙ (§113). */
interface Row {
  key: string;
  materialName: string;
  materialId: string;
  sheetLabel: string;
  sheetId: string;
  partId: PartId;
  partNumber: string;
  partName: string;
  size: string;
  quantityLabel: string;
  rotation: string;
  grain: string;
  edge: string;
  status: CuttingPlanStatus;
}

const STATUS_COLOR: Record<CuttingPlanStatus, string> = {
  VALID: 'var(--ok,#4caf50)',
  WARNING: 'var(--warn,#e0a030)',
  ERROR: 'var(--danger,#e05252)',
  DIRTY: 'var(--warn,#e0a030)',
  OUTDATED: 'var(--warn,#e0a030)',
  LOCKED: 'var(--accent,#5a9cf8)',
};

const GRAIN_LABEL: Record<string, string> = { length: 'вдоль', width: 'поперёк', none: 'нет' };

/**
 * Таблица РАСКРОЙ (§113–§115): по строке на размещённый экземпляр детали,
 * с фильтрами по материалу, листу и статусу карты и поиском по деталям.
 * Собственных расчётов не делает — читает сохранённый CuttingReport.
 */
export function CuttingTable({ onOpenPart }: { onOpenPart?: (id: PartId) => void } = {}) {
  const project = useEditorStore((s) => s.project);
  const selectPiece = useEditorStore((s) => s.selectCuttingPiece);
  const selectPart = useEditorStore((s) => s.selectPart);

  const [search, setSearch] = useState('');
  const [materialFilter, setMaterialFilter] = useState('');
  const [sheetFilter, setSheetFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<CuttingPlanStatus | ''>('');

  const partsById = useMemo(() => {
    const map = new Map<string, Part>();
    for (const p of allParts(project)) map.set(String(p.id), p);
    return map;
  }, [project]);

  const edgeLabel = (part: Part | undefined): string => {
    if (!part) return '—';
    const sides: Array<[string, string | null]> = [
      ['Л', part.edges.left], ['П', part.edges.right], ['В', part.edges.top], ['Н', part.edges.bottom],
    ];
    const used = sides.filter(([, id]) => id).map(([s]) => s);
    return used.length ? used.join('') : '—';
  };

  const rows: Row[] = useMemo(() => {
    const report = project.cutting.report;
    if (!report) return [];
    const out: Row[] = [];
    for (const job of report.jobs) {
      const status = planStatus(project, job);
      const counts = instanceCounts(job.sheets.flatMap((s) => s.placements));
      for (const sheet of job.sheets) {
        for (const pl of sheet.placements as Placement[]) {
          const part = partsById.get(String(pl.partId));
          out.push({
            key: `${sheet.id}:${pl.pieceId}`,
            materialName: job.statistics.materialName,
            materialId: String(job.materialId),
            sheetLabel: `Лист ${sheet.index + 1}${sheet.fromRemnant ? ' (остаток)' : ''}`,
            sheetId: sheet.id,
            partId: pl.partId,
            partNumber: pl.number,
            partName: pl.name,
            size: `${Math.round(pl.length)}×${Math.round(pl.width)}`,
            quantityLabel: placementLabel(pl, counts),
            rotation: pl.rotation ? `${pl.rotation}°` : '0°',
            grain: GRAIN_LABEL[part?.grain ?? 'none'] ?? 'нет',
            edge: edgeLabel(part),
            status,
          });
        }
      }
    }
    return out;
  }, [project, partsById]);

  const sheetOptions = useMemo(
    () => [...new Map(rows.map((r) => [r.sheetId, r.sheetLabel])).entries()],
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (materialFilter && r.materialId !== materialFilter) return false;
      if (sheetFilter && r.sheetId !== sheetFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.partNumber.toLowerCase().includes(q) ||
        r.partName.toLowerCase().includes(q) ||
        String(r.partId).toLowerCase().includes(q) ||
        r.sheetId.toLowerCase().includes(q)
      );
    });
  }, [rows, search, materialFilter, sheetFilter, statusFilter]);

  const sel = { fontSize: 12 };

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px', maxHeight: 260, overflow: 'auto' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <input
          data-testid="cutting-table-search"
          placeholder="Поиск: Part ID, название, лист"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: '1 1 200px', fontSize: 12 }}
        />
        <select value={materialFilter} onChange={(e) => { setMaterialFilter(e.target.value); setSheetFilter(''); }} style={sel}>
          <option value="">Все материалы</option>
          {project.materials.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
        </select>
        <select value={sheetFilter} onChange={(e) => setSheetFilter(e.target.value)} style={sel}>
          <option value="">Все листы</option>
          {sheetOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CuttingPlanStatus | '')} style={sel}>
          <option value="">Любой статус</option>
          {(['VALID', 'WARNING', 'ERROR', 'DIRTY', 'OUTDATED', 'LOCKED'] as const).map((st) => (
            <option key={st} value={st}>{st}</option>
          ))}
        </select>
        <span className="dim" style={{ fontSize: 11, alignSelf: 'center' }}>Строк: {filtered.length}</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--dim,#9aa0a6)' }}>
            <th>Материал</th><th>Лист</th><th>Деталь</th><th>Размер</th>
            <th>Количество</th><th>Поворот</th><th>Текстура</th><th>Кромка</th><th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr
              key={r.key}
              data-cutting-row
              style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}
              onClick={() => {
                selectPiece(r.key.split(':').slice(1).join(':'));
                selectPart(r.partId);
                onOpenPart?.(r.partId);
              }}
            >
              <td className="dim">{r.materialName}</td>
              <td>{r.sheetLabel}</td>
              <td>{r.partNumber} {r.partName}</td>
              <td>{r.size}</td>
              <td>{r.quantityLabel}</td>
              <td>{r.rotation}</td>
              <td>{r.grain}</td>
              <td>{r.edge}</td>
              <td style={{ color: STATUS_COLOR[r.status] }}>{r.status}</td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={9} className="dim">Нет строк: раскрой не рассчитан или всё отфильтровано.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
