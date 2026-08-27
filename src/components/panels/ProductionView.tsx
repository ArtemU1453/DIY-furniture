import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { findPart, allParts } from '@/core/model/selectors';
import {
  SIDE_LABELS,
  allEdgeBanding,
  bandingTotalLength,
  edgeBandingCsv,
  edgeCuttingJobs,
  edgeSummary,
  edgeSummaryCsv,
  meters,
  validateEdges,
} from '@/engines/edges';
import { allOperations } from '@/engines/machining';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { downloadText } from '@/features/documents/print';
import type { EdgeBanding, EdgeSide, EdgeStatus } from '@/core/model/types';
import type { PartId } from '@/core/model/ids';

type SortKey = 'part' | 'side' | 'material' | 'length';

/**
 * Раздел ПРОИЗВОДСТВО (§69–§71).
 *
 * Сводит воедино то, что нужно цеху: сколько деталей, сколько листов, что и
 * сколько закромить, сколько операций присадки и позиций фурнитуры. Ничего не
 * пересчитывает сам — читает уже готовые результаты соответствующих движков.
 */
export function ProductionView({ onOpenPart, onOpenCutting }: {
  onOpenPart?: (id: PartId) => void;
  onOpenCutting?: () => void;
} = {}) {
  const project = useEditorStore((s) => s.project);
  const selectPart = useEditorStore((s) => s.selectPart);

  const [search, setSearch] = useState('');
  const [materialFilter, setMaterialFilter] = useState('');
  const [sideFilter, setSideFilter] = useState<EdgeSide | ''>('');
  const [statusFilter, setStatusFilter] = useState<EdgeStatus | ''>('');
  const [sort, setSort] = useState<SortKey>('part');

  const banding = useMemo(() => allEdgeBanding(project), [project]);
  const summary = useMemo(() => edgeSummary(project), [project]);
  const jobs = useMemo(() => edgeCuttingJobs(project), [project]);
  const report = useMemo(() => validateEdges(project), [project]);
  const ops = useMemo(() => allOperations(project), [project]);
  const ledger = useMemo(
    () => buildHardwareLedger(project.hardware, project.hardwareConnections),
    [project.hardware, project.hardwareConnections],
  );

  const edgeName = (id: string) => project.edges.find((e) => String(e.id) === String(id))?.name ?? 'не найден';
  const partOf = (b: EdgeBanding) => findPart(project, b.partId);
  const partLabel = (b: EdgeBanding) => {
    const part = partOf(b);
    return part ? `${(part.metadata?.number as string) ?? ''} ${part.name}`.trim() : String(b.partId);
  };

  /* Фильтр (§56) и поиск (§57) сужают таблицу, сортировка (§58) её
   * упорядочивает — они независимы и применяются в этом порядке. */
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = banding.filter((b) => {
      if (materialFilter && String(b.materialId) !== materialFilter) return false;
      if (sideFilter && b.side !== sideFilter) return false;
      if (statusFilter && b.status !== statusFilter) return false;
      if (!q) return true;
      const part = partOf(b);
      return [
        (part?.metadata?.number as string) ?? '',
        part?.name ?? '',
        edgeName(String(b.materialId)),
      ].some((v) => v.toLowerCase().includes(q));
    });
    out = [...out].sort((a, b) => {
      switch (sort) {
        case 'length': return bandingTotalLength(b) - bandingTotalLength(a);
        case 'material': return edgeName(String(a.materialId)).localeCompare(edgeName(String(b.materialId)));
        case 'side': return a.side.localeCompare(b.side);
        default: return partLabel(a).localeCompare(partLabel(b));
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banding, search, materialFilter, sideFilter, statusFilter, sort, project]);

  const totalMm = banding.reduce((n, b) => n + bandingTotalLength(b), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      {/* Общая картина производства (§69). */}
      <div style={{ display: 'flex', gap: 8, padding: 10, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
        <Card title="Детали" value={String(allParts(project).reduce((n, p) => n + p.quantity, 0))} />
        <Card
          title="Раскрой"
          value={project.cutting.report ? `${project.cutting.report.jobs.reduce((n, j) => n + j.statistics.sheetCount, 0)} л.` : '—'}
          onClick={onOpenCutting}
        />
        <Card title="Кромка" value={`${meters(totalMm).toFixed(1)} м`} />
        <Card title="Присадка" value={`${ops.length} оп.`} />
        <Card title="Фурнитура" value={`${ledger.reduce((n, r) => n + r.count, 0)} шт.`} />
        <Card title="Документы" value={(project.documents.history?.length ?? 0) > 0 ? 'есть' : '—'} />
      </div>

      {(report.errors > 0 || report.warnings > 0) && (
        <div style={{ padding: '6px 10px', display: 'flex', gap: 8 }}>
          {report.errors > 0 && <span className="issue error">Ошибок кромки: {report.errors}</span>}
          {report.warnings > 0 && <span className="issue warning">Предупреждений: {report.warnings}</span>}
        </div>
      )}

      {/* Расход по материалам (§31–§33). */}
      <div style={{ padding: 10 }}>
        <h3 style={hdr}>Расход кромки</h3>
        {summary.length === 0 && <div className="empty-hint">Кромка не назначена ни одной детали.</div>}
        {summary.length > 0 && (
          <table style={table}>
            <thead>
              <tr style={thead}>
                <th style={th}>Материал</th><th style={th}>Толщ.</th><th style={th}>Шир.</th>
                <th style={thEnd}>Расчёт</th><th style={thEnd}>С припуском</th><th style={thEnd}>К закупке</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((r) => (
                <tr key={`${r.materialId}-${r.thickness}`} style={tr}>
                  <td>{r.materialName}</td>
                  <td>{r.thickness} мм</td>
                  <td>{r.width} мм</td>
                  <td style={tdEnd}>{meters(r.lengthMm).toFixed(2)} м</td>
                  <td style={tdEnd}>{meters(r.withAllowanceMm).toFixed(2)} м</td>
                  <td style={tdEnd}><strong>{meters(r.purchaseMm).toFixed(2)} м</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Производственный список: что и сколько закромить (§70/§71). */}
      <div style={{ padding: '0 10px 10px' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <h3 style={{ ...hdr, margin: 0 }}>Кромкование ({rows.length})</h3>
          <input
            placeholder="Поиск: деталь или материал"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220, fontSize: 12 }}
          />
          <select value={materialFilter} onChange={(e) => setMaterialFilter(e.target.value)} style={sel}>
            <option value="">Все материалы</option>
            {project.edges.map((e) => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
          </select>
          <select value={sideFilter} onChange={(e) => setSideFilter(e.target.value as EdgeSide | '')} style={sel}>
            <option value="">Все стороны</option>
            {(Object.keys(SIDE_LABELS) as EdgeSide[]).map((s) => <option key={s} value={s}>{SIDE_LABELS[s]}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as EdgeStatus | '')} style={sel}>
            <option value="">Любой статус</option>
            {(['VALID', 'WARNING', 'ERROR', 'OUTDATED'] as EdgeStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={sel}>
            <option value="part">По детали</option>
            <option value="side">По стороне</option>
            <option value="material">По материалу</option>
            <option value="length">По длине</option>
          </select>
          <span style={{ marginLeft: 'auto' }} />
          <button
            style={{ fontSize: 11 }}
            onClick={() => downloadText('edgebanding.csv', edgeBandingCsv(project), 'text/csv;charset=utf-8')}
          >edgebanding.csv</button>
          <button
            style={{ fontSize: 11 }}
            onClick={() => downloadText('edge_summary.csv', edgeSummaryCsv(project), 'text/csv;charset=utf-8')}
          >Расход CSV</button>
        </div>

        <table style={table}>
          <thead>
            <tr style={thead}>
              <th style={th}>Деталь</th><th style={th}>Сторона</th><th style={th}>Материал</th>
              <th style={thEnd}>Толщ.</th><th style={thEnd}>Шир.</th><th style={thEnd}>Длина</th>
              <th style={thEnd}>Кол-во</th><th style={thEnd}>Итого</th><th style={th}>Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr
                key={b.id}
                style={{ ...tr, cursor: 'pointer' }}
                onClick={() => { selectPart(b.partId); onOpenPart?.(b.partId); }}
              >
                <td>{partLabel(b)}</td>
                <td>{SIDE_LABELS[b.side]}</td>
                <td>{edgeName(String(b.materialId))}</td>
                <td style={tdEnd}>{b.thickness}</td>
                <td style={tdEnd}>{b.width}</td>
                <td style={tdEnd}>{Math.round(b.length)}</td>
                <td style={tdEnd}>{b.quantity}</td>
                <td style={tdEnd}><strong>{Math.round(bandingTotalLength(b))}</strong></td>
                <td style={{ color: b.status === 'VALID' ? 'var(--ok)' : b.status === 'ERROR' ? 'var(--danger)' : '#e6c060', fontSize: 11 }}>
                  {b.status}
                  {b.override && <span className="dim" style={{ marginLeft: 4 }}>правка</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="dim" style={{ padding: 8 }}>Ничего не найдено.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Задания по лентам (§37/§71): по одному на материал+толщину. */}
      {jobs.length > 0 && (
        <div style={{ padding: '0 10px 16px' }}>
          <h3 style={hdr}>Задания на кромкование</h3>
          {jobs.map((job) => (
            <div key={job.id} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 12 }}>{job.materialName} · {job.thickness}×{job.width} мм</strong>
                <span className="dim" style={{ fontSize: 11 }}>
                  {job.banding.length} стор. · {meters(job.requiredMm).toFixed(2)} м
                  {job.purchaseMm !== job.requiredMm && ` → закупка ${meters(job.purchaseMm).toFixed(2)} м`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ title, value, onClick }: { title: string; value: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px',
        minWidth: 96, cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div className="dim" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>
      <div style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

const hdr: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', margin: '0 0 8px' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const thead: React.CSSProperties = { textAlign: 'left', color: 'var(--text-dim)' };
const th: React.CSSProperties = { fontWeight: 400, padding: '2px 4px' };
const thEnd: React.CSSProperties = { ...th, textAlign: 'right' };
const tr: React.CSSProperties = { borderTop: '1px solid var(--border)' };
const tdEnd: React.CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const sel: React.CSSProperties = { width: 'auto', fontSize: 11 };
