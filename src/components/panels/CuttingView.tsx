import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import { isCuttingStale, m2, reportToCsv, resultToSvg } from '@/engines/cutting';
import { SORT_STRATEGIES } from '@/engines/cutting';
import { CuttingMap } from './CuttingMap';
import type { CuttingResult, PieceRotation } from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function CuttingView() {
  const project = useEditorStore((s) => s.project);
  const running = useEditorStore((s) => s.cuttingRunning);
  const progress = useEditorStore((s) => s.cuttingProgress);
  const error = useEditorStore((s) => s.cuttingError);
  const selectedPieceId = useEditorStore((s) => s.selectedCuttingPieceId);
  const recalc = useEditorStore((s) => s.recalculateCutting);
  const cancel = useEditorStore((s) => s.cancelCutting);
  const selectPiece = useEditorStore((s) => s.selectCuttingPiece);
  const setLocked = useEditorStore((s) => s.setLockedPlacement);
  const clearLocked = useEditorStore((s) => s.clearLockedPlacements);
  const updateSettings = useEditorStore((s) => s.updateCuttingSettings);

  const [filter, setFilter] = useState<'all' | MaterialId>('all');
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [fitKey, setFitKey] = useState(0);

  const report = project.cutting.report;
  const stale = isCuttingStale(project);
  const settings = project.cutting.settings;

  const jobs: CuttingResult[] = useMemo(() => {
    if (!report) return [];
    return filter === 'all' ? report.jobs : report.jobs.filter((j) => j.materialId === filter);
  }, [report, filter]);
  const sheets = useMemo(() => jobs.flatMap((j) => j.sheets), [jobs]);
  const unplaced = useMemo(() => jobs.flatMap((j) => j.unplaced), [jobs]);
  const manual = mode === 'manual' && filter !== 'all';

  const onMove = (pieceId: string, sheetIndex: number, x: number, y: number, rotation: PieceRotation = 0) => {
    setLocked({ pieceId, sheetIndex, x, y, rotation });
    void recalc();
  };

  const exportSvg = () => {
    const target = jobs[0];
    if (!target) return;
    download('cutting.svg', resultToSvg(target), 'image/svg+xml');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Панель управления */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value as 'all' | MaterialId)} style={{ width: 'auto' }}>
          <option value="all">Все материалы</option>
          {project.materials.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'auto' | 'manual')} style={{ width: 'auto' }} title={filter === 'all' ? 'Для ручного режима выберите материал' : ''}>
          <option value="auto">Автоматический</option>
          <option value="manual" disabled={filter === 'all'}>Ручной</option>
        </select>
        {!running ? (
          <button onClick={() => void recalc()}>Пересчитать</button>
        ) : (
          <button onClick={cancel} style={{ color: 'var(--danger)' }}>Отменить расчёт</button>
        )}
        <button onClick={() => setFitKey((k) => k + 1)}>По экрану</button>
        <button onClick={exportSvg} disabled={!report}>SVG</button>
        <button onClick={() => report && download('cutting.csv', reportToCsv(report), 'text/csv')} disabled={!report}>CSV</button>
        {settings.locked.length > 0 && <button onClick={() => { clearLocked(); void recalc(); }}>Сбросить ручное</button>}
        <span style={{ marginLeft: 'auto' }} />
        <label className="dim" style={{ display: 'flex', gap: 4, alignItems: 'center', width: 'auto' }}>
          Сортировка
          <select style={{ width: 'auto' }} value={settings.sortStrategy} onChange={(e) => updateSettings({ sortStrategy: e.target.value })}>
            {SORT_STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>

      {running && (
        <div style={{ padding: '4px 10px', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
          Расчёт раскроя… {Math.round((progress?.fraction ?? 0) * 100)}% {progress?.message ? `· ${progress.message}` : ''}
        </div>
      )}
      {error && <div className="issue error" style={{ margin: 8 }}>{error}</div>}
      {report && stale && !running && (
        <div style={{ padding: '6px 10px', background: 'rgba(230,180,60,0.15)', color: '#e6c060', borderBottom: '1px solid var(--border)' }}>
          Раскрой устарел — модель изменилась. Нажмите «Пересчитать».
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Статистика и список */}
        <aside style={{ width: 250, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 10 }}>
          {!report && <div className="empty-hint">Нажмите «Пересчитать», чтобы получить раскрой.</div>}
          {jobs.map((job) => (
            <div key={job.materialId} style={{ marginBottom: 14 }}>
              <h3 style={hdr}>{job.statistics.materialName}</h3>
              <Row k="Деталей" v={String(job.statistics.pieceCount)} />
              <Row k="Листов" v={String(job.statistics.sheetCount)} />
              <Row k="Площадь деталей" v={`${m2(job.statistics.piecesAreaMm2)} м²`} />
              <Row k="Площадь листов" v={`${m2(job.statistics.sheetsUsableAreaMm2)} м²`} />
              <Row k="Отход" v={`${m2(job.statistics.wasteAreaMm2)} м²`} />
              <Row k="Использование" v={`${(job.statistics.utilization * 100).toFixed(1)}%`} />
              <div className="dim" style={{ marginTop: 4, fontSize: 11 }}>Расчётный вариант ({job.attemptsRun} попыток)</div>
              {job.unplaced.length > 0 && (
                <div className="issue error" style={{ marginTop: 6 }}>
                  Не помещается: {job.unplaced.map((p) => p.number).join(', ')}. Проверьте размер листа и поворот.
                </div>
              )}
            </div>
          ))}

          {report && (
            <>
              <h3 style={hdr}>Детали</h3>
              <ul className="parts-list">
                {sheets.flatMap((s) => s.placements).map((p) => (
                  <li key={p.pieceId} className={p.pieceId === selectedPieceId ? 'selected' : ''} onClick={() => selectPiece(p.pieceId)}>
                    <span>{p.number} {p.name}</span>
                    <span className="dim">{Math.round(p.length)}×{Math.round(p.width)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        {/* Карта раскроя */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {sheets.length > 0 ? (
            <CuttingMap key={fitKey} sheets={sheets} selectedPieceId={selectedPieceId} manual={manual} onSelect={selectPiece} onMove={onMove} />
          ) : (
            <div className="empty-hint" style={{ padding: 20 }}>
              {report ? 'Нет размещённых деталей для выбранного материала.' : 'Раскрой ещё не рассчитан.'}
            </div>
          )}
          {unplaced.length > 0 && (
            <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8 }}>
              <div className="issue error">Невозможно разместить {unplaced.length} дет. — увеличьте лист или разрешите поворот.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
      <span className="dim">{k}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
}

const hdr: React.CSSProperties = { fontSize: 12, margin: '0 0 6px', color: 'var(--text)' };
