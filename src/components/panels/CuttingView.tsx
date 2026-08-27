import { useMemo, useRef, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import {
  isCuttingStale, m2, reportToCsv, reportToJson, resultToSvg, sheetToSvg,
  cuttingPartsCsv, wasteReportCsv, compareAlgorithms, listCuttingEngines,
  type AlgorithmComparisonRow,
} from '@/engines/cutting';
import { SORT_STRATEGIES } from '@/engines/cutting';
import { printPages, downloadSvg } from '@/features/documents/print';
import { allParts } from '@/core/model/selectors';
import { CuttingMap, type CuttingMapHandle, type EdgeFlags } from './CuttingMap';
import { SheetLibraryDialog } from './SheetLibraryDialog';
import { RemnantLibraryDialog } from './RemnantLibraryDialog';
import type { CuttingResult, OptimizationMode, Part, PieceRotation, Placement } from '@/core/model/types';
import type { MaterialId, PartId } from '@/core/model/ids';

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

const MODE_LABELS: Record<OptimizationMode, string> = {
  FAST: 'Быстрый',
  BALANCED: 'Сбалансированный',
  MAX_UTILIZATION: 'Макс. использование',
};

export function CuttingView({ onOpenDrawing }: { onOpenDrawing?: (partId: PartId) => void } = {}) {
  const project = useEditorStore((s) => s.project);
  const running = useEditorStore((s) => s.cuttingRunning);
  const progress = useEditorStore((s) => s.cuttingProgress);
  const error = useEditorStore((s) => s.cuttingError);
  const selectedPieceId = useEditorStore((s) => s.selectedCuttingPieceId);
  const recalc = useEditorStore((s) => s.recalculateCutting);
  const cancel = useEditorStore((s) => s.cancelCutting);
  const selectPiece = useEditorStore((s) => s.selectCuttingPiece);
  const selectPart = useEditorStore((s) => s.selectPart);
  const setLocked = useEditorStore((s) => s.setLockedPlacement);
  const clearLocked = useEditorStore((s) => s.clearLockedPlacements);
  const toggleLocked = useEditorStore((s) => s.toggleLockedPlacement);
  const rotatePlacement = useEditorStore((s) => s.rotatePlacement);
  const updateSettings = useEditorStore((s) => s.updateCuttingSettings);
  const saveRemnants = useEditorStore((s) => s.saveUsableRemnantsFromResult);
  const applyReport = useEditorStore((s) => s.applyCuttingReport);

  const [filter, setFilter] = useState<'all' | MaterialId>('all');
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [showSettings, setShowSettings] = useState(true);
  const [sheetLibOpen, setSheetLibOpen] = useState(false);
  const [remnantLibOpen, setRemnantLibOpen] = useState(false);
  const mapRef = useRef<CuttingMapHandle>(null);
  const [comparison, setComparison] = useState<AlgorithmComparisonRow[] | null>(null);

  const report = project.cutting.report;
  const stale = isCuttingStale(project);
  const settings = project.cutting.settings;

  // Быстрый доступ к деталям (для текстуры/кромки/подсветки).
  const partsById = useMemo(() => {
    const map = new Map<PartId, Part>();
    for (const p of allParts(project)) map.set(p.id, p);
    return map;
  }, [project]);
  const thicknessById = useMemo(() => {
    const o: Record<string, number> = {};
    for (const m of project.materials) o[m.id as string] = m.thickness;
    return o;
  }, [project.materials]);

  const jobs: CuttingResult[] = useMemo(() => {
    if (!report) return [];
    return filter === 'all' ? report.jobs : report.jobs.filter((j) => j.materialId === filter);
  }, [report, filter]);
  const sheets = useMemo(() => jobs.flatMap((j) => j.sheets), [jobs]);
  const warnings = useMemo(() => jobs.flatMap((j) => j.warnings), [jobs]);
  const usableRemnantCount = useMemo(
    () => jobs.reduce((n, j) => n + j.sheets.reduce((k, s) => k + s.remnants.filter((r) => r.usable).length, 0), 0),
    [jobs],
  );
  const manual = mode === 'manual' && filter !== 'all';

  const selectedPlacement: Placement | undefined = useMemo(() => {
    for (const s of sheets) {
      const p = s.placements.find((pl) => pl.pieceId === selectedPieceId);
      if (p) return p;
    }
    return undefined;
  }, [sheets, selectedPieceId]);
  const selectedSheetIndex = useMemo(() => {
    for (const s of sheets) if (s.placements.some((pl) => pl.pieceId === selectedPieceId)) return s.index;
    return 0;
  }, [sheets, selectedPieceId]);

  const onMove = (pieceId: string, sheetIndex: number, x: number, y: number, rotation: PieceRotation = 0) => {
    setLocked({ pieceId, sheetIndex, x, y, rotation });
    void recalc();
  };

  /**
   * Пересчёт с предупреждением: ручные корректировки (зафиксированные детали)
   * сохраняются, но пользователь должен знать, что раскладка изменится (§42).
   */
  const onRecalculate = () => {
    if (settings.locked.length > 0) {
      const ok = window.confirm(
        `Есть ручные корректировки (${settings.locked.length}). Автоматический раскрой изменит раскладку остальных деталей. Зафиксированные детали останутся на местах. Продолжить?`,
      );
      if (!ok) return;
    }
    setComparison(null);
    void recalc();
  };

  /** Рассчитать несколькими алгоритмами и показать сравнение (§18/§50). */
  const onCompare = () => {
    const rows = compareAlgorithms(project, { preferFewerSheets: settings.preferFewerSheets });
    setComparison(rows);
  };

  const grainOf = (p: Placement) => partsById.get(p.partId)?.grain ?? 'none';
  const edgesOf = (p: Placement): EdgeFlags | undefined => {
    const part = partsById.get(p.partId);
    if (!part) return undefined;
    const has = (e: unknown) => e != null;
    const base = { left: has(part.edges.left), right: has(part.edges.right), top: has(part.edges.top), bottom: has(part.edges.bottom) };
    // При повороте на 90° стороны меняются местами.
    return p.rotation === 90 ? { left: base.bottom, right: base.top, top: base.left, bottom: base.right } : base;
  };

  const exportSvg = () => {
    const target = jobs[0];
    if (!target) return;
    downloadSvg(`Раскрой_${target.statistics.materialName}`, resultToSvg(target));
  };
  // PNG карты раскроя: рендер SVG в canvas (только карта, без интерфейса).
  const exportPng = () => {
    const target = jobs[0];
    if (!target) return;
    const svg = resultToSvg(target);
    const img = new Image();
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width || 1600;
      canvas.height = img.height || 1200;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0f1012';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = 'cutting.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const exportPdf = () => {
    const pages = jobs.flatMap((j) => j.sheets.map((s) => sheetToSvg(s, j.statistics.materialName)));
    if (pages.length === 0) return;
    printPages('Карта раскроя', pages);
  };

  const isLocked = selectedPlacement ? settings.locked.some((l) => l.pieceId === selectedPlacement.pieceId) : false;
  const canRotateSelected = (() => {
    if (!selectedPlacement) return false;
    const part = partsById.get(selectedPlacement.partId);
    const material = part?.material ? project.materials.find((m) => m.id === part.material) : undefined;
    if (!material?.allowRotate) return false;
    if (settings.respectGrain && part && part.grain !== 'none') return false;
    return true;
  })();

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
          <button onClick={onRecalculate}>Пересчитать</button>
        ) : (
          <button onClick={cancel} style={{ color: 'var(--danger)' }}>Отменить расчёт</button>
        )}
        <span className="sep" />
        <button onClick={() => mapRef.current?.zoomOut()} disabled={!report} title="Уменьшить">−</button>
        <button onClick={() => mapRef.current?.zoomIn()} disabled={!report} title="Увеличить">+</button>
        <button onClick={() => mapRef.current?.fit()} disabled={!report}>По экрану</button>
        <button onClick={() => mapRef.current?.reset100()} disabled={!report}>100%</button>
        <span className="sep" />
        <button onClick={onCompare} disabled={running}>Сравнить алгоритмы</button>
        <span className="sep" />
        <button onClick={exportSvg} disabled={!report}>SVG</button>
        <button onClick={exportPng} disabled={!report}>PNG</button>
        <button onClick={exportPdf} disabled={!report}>PDF</button>
        <button onClick={() => report && download('cutting.csv', reportToCsv(report, thicknessById), 'text/csv')} disabled={!report}>CSV</button>
        <button onClick={() => report && download('cutting_parts.csv', cuttingPartsCsv(report, thicknessById), 'text/csv')} disabled={!report} title="cutting_parts.csv">Детали CSV</button>
        <button onClick={() => report && download('waste_report.csv', wasteReportCsv(report), 'text/csv')} disabled={!report} title="waste_report.csv">Отходы CSV</button>
        <button onClick={() => report && download('cutting.json', reportToJson(report), 'application/json')} disabled={!report}>JSON</button>
        <span style={{ marginLeft: 'auto' }} />
        <button onClick={() => setSheetLibOpen(true)}>Листы…</button>
        <button onClick={() => setRemnantLibOpen(true)}>Остатки…</button>
        <button onClick={() => setShowSettings((v) => !v)}>{showSettings ? 'Скрыть параметры' : 'Параметры'}</button>
        {settings.locked.length > 0 && <button onClick={() => { clearLocked(); void recalc(); }}>Сбросить ручное</button>}
      </div>

      {/* Параметры раскроя */}
      {showSettings && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', fontSize: 12 }}>
          <label style={lbl}>Алгоритм
            <select style={{ width: 'auto' }} value={settings.algorithm} onChange={(e) => updateSettings({ algorithm: e.target.value })}>
              {listCuttingEngines().map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label style={lbl}>Режим
            <select style={{ width: 'auto' }} value={settings.optimizationMode} onChange={(e) => updateSettings({ optimizationMode: e.target.value as OptimizationMode })}>
              {(Object.keys(MODE_LABELS) as OptimizationMode[]).map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
            </select>
          </label>
          <label style={{ ...lbl, gap: 4 }}>
            <input type="checkbox" checked={settings.preferFewerSheets} onChange={(e) => updateSettings({ preferFewerSheets: e.target.checked })} />
            Меньше листов
          </label>
          <label style={lbl}>Сортировка
            <select style={{ width: 'auto' }} value={settings.sortStrategy} onChange={(e) => updateSettings({ sortStrategy: e.target.value })}>
              {SORT_STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={lbl}>Пропил, мм
            <input type="number" min={0} step={0.1} style={num} value={settings.kerfOverride ?? ''} placeholder="из мат."
              onChange={(e) => updateSettings({ kerfOverride: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </label>
          <span style={lbl}>Отступы
            {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
              <input key={side} type="number" min={0} style={num} title={side} value={settings.trim[side]}
                onChange={(e) => updateSettings({ trim: { ...settings.trim, [side]: Number(e.target.value) || 0 } })} />
            ))}
          </span>
          <label style={{ ...lbl, gap: 4 }}>
            <input type="checkbox" checked={settings.respectGrain} onChange={(e) => updateSettings({ respectGrain: e.target.checked })} />
            Учитывать текстуру
          </label>
          <label style={{ ...lbl, gap: 4 }}>
            <input type="checkbox" checked={settings.useRemnants} onChange={(e) => updateSettings({ useRemnants: e.target.checked })} />
            Использовать остатки ({project.remnants.length})
          </label>
          {filter !== 'all' && (
            <label style={lbl}>Формат листа
              <select style={{ width: 'auto' }} value={settings.sheetSelection[filter] ?? ''} onChange={(e) => updateSettings({ sheetSelection: { ...settings.sheetSelection, [filter]: e.target.value } })}>
                {project.sheets.filter((s) => s.materialId === filter).map((s) => (
                  <option key={s.id} value={s.id}>{s.height}×{s.width} {s.availableQuantity ? `(${s.availableQuantity} шт.)` : ''}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

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
      {comparison && comparison.length > 0 && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <strong style={{ fontSize: 12 }}>Сравнение алгоритмов</strong>
            <button style={{ marginLeft: 'auto' }} onClick={() => setComparison(null)}>✕</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-dim)' }}>
                <th>Алгоритм</th><th>Листов</th><th>Не размещено</th><th>Остатки</th><th>Отход</th><th>КПД</th><th></th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row) => (
                <tr key={row.algorithmId} style={{ borderTop: '1px solid var(--border)' }}>
                  <td>{row.algorithmName}</td>
                  <td>{row.sheetCount}</td>
                  <td style={row.unplacedCount > 0 ? { color: 'var(--danger)' } : undefined}>{row.unplacedCount}</td>
                  <td>{m2(row.remnantAreaMm2)} м²</td>
                  <td>{(row.wasteRatio * 100).toFixed(1)}%</td>
                  <td>{(row.efficiency * 100).toFixed(1)}%</td>
                  <td>
                    <button onClick={() => { applyReport(row.report, row.algorithmId); setComparison(null); }}>
                      Выбрать
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {warnings.map((w, i) => (
        <div key={i} style={{ padding: '6px 10px', background: 'rgba(230,120,60,0.15)', color: '#e8a06a', borderBottom: '1px solid var(--border)' }}>{w}</div>
      ))}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Статистика и список */}
        <aside style={{ width: 250, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 10 }}>
          {!report && <div className="empty-hint">Нажмите «Пересчитать», чтобы получить оптимизированный раскрой.</div>}
          {jobs.map((job) => (
            <div key={job.materialId} style={{ marginBottom: 14 }}>
              <h3 style={hdr}>{job.statistics.materialName}</h3>
              <Row k="Деталей" v={String(job.statistics.pieceCount)} />
              <Row k="Листов" v={String(job.statistics.sheetCount)} />
              <Row k="Площадь деталей" v={`${m2(job.statistics.piecesAreaMm2)} м²`} />
              <Row k="Площадь листов (раб.)" v={`${m2(job.statistics.sheetsUsableAreaMm2)} м²`} />
              <Row k="Отход (WASTE)" v={`${m2(job.statistics.wasteAreaMm2)} м²`} />
              <Row k="Остатки (REMNANT)" v={`${m2(job.statistics.remnantAreaMm2)} м²`} />
              <Row k="Полезных остатков" v={String(job.sheets.reduce((n, s) => n + s.remnants.filter((r) => r.usable).length, 0))} />
              <Row k="Использование" v={`${(job.statistics.utilization * 100).toFixed(1)}%`} />
              <div className="dim" style={{ marginTop: 4, fontSize: 11 }}>Оптимизированный раскрой ({job.attemptsRun} попыток)</div>
              {job.unplaced.length > 0 && (
                <div className="issue error" style={{ marginTop: 6 }}>
                  Не удалось разместить:{' '}
                  {job.unplaced.map((p) => `${p.number} (${Math.round(p.length)}×${Math.round(p.width)})`).join(', ')}.
                  <div className="dim" style={{ marginTop: 2 }}>{job.unplaced[0].reason}</div>
                </div>
              )}
            </div>
          ))}

          {report && (
            <>
              {usableRemnantCount > 0 && (
                <button style={{ width: '100%', marginBottom: 8 }} onClick={() => { const n = saveRemnants(); if (n) alert(`Сохранено остатков: ${n}`); }}>
                  Сохранить полезные остатки ({usableRemnantCount})
                </button>
              )}
              <h3 style={hdr}>Детали</h3>
              <ul className="parts-list">
                {sheets.flatMap((s) => s.placements).map((p) => (
                  <li key={p.pieceId} className={p.pieceId === selectedPieceId ? 'selected' : ''} onClick={() => { selectPiece(p.pieceId); selectPart(p.partId); }}>
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
            <CuttingMap ref={mapRef} sheets={sheets} selectedPieceId={selectedPieceId} manual={manual} onSelect={(id) => { selectPiece(id); const pl = sheets.flatMap((s) => s.placements).find((x) => x.pieceId === id); if (pl) selectPart(pl.partId); }} onMove={onMove} grainOf={grainOf} edgesOf={edgesOf} />
          ) : (
            <div className="empty-hint" style={{ padding: 20 }}>
              {report ? 'Нет размещённых деталей для выбранного материала.' : 'Раскрой ещё не рассчитан.'}
            </div>
          )}
        </div>

        {/* Свойства выбранной детали */}
        {selectedPlacement && (
          <aside style={{ width: 230, borderLeft: '1px solid var(--border)', overflow: 'auto', padding: 10 }}>
            <h3 style={hdr}>Деталь на раскрое</h3>
            <Row k="P-ID" v={selectedPlacement.number} />
            <Row k="Наименование" v={selectedPlacement.name} />
            <Row k="Размер" v={`${Math.round(selectedPlacement.length)}×${Math.round(selectedPlacement.width)}`} />
            <Row k="Материал" v={partsById.get(selectedPlacement.partId)?.material ? (project.materials.find((m) => m.id === partsById.get(selectedPlacement.partId)!.material)?.name ?? '—') : '—'} />
            <Row k="Толщина" v={`${partsById.get(selectedPlacement.partId)?.thickness ?? '—'} мм`} />
            <Row k="Текстура" v={partsById.get(selectedPlacement.partId)?.grain ?? 'none'} />
            <Row k="Лист" v={String(selectedSheetIndex + 1)} />
            <Row k="X / Y" v={`${Math.round(selectedPlacement.x)} / ${Math.round(selectedPlacement.y)}`} />
            <Row k="Поворот" v={`${selectedPlacement.rotation}°`} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
              <button
                disabled={!canRotateSelected}
                title={canRotateSelected ? '' : 'Поворот запрещён (текстура/материал)'}
                onClick={() => { rotatePlacement({ pieceId: selectedPlacement.pieceId, sheetIndex: selectedSheetIndex, x: selectedPlacement.x, y: selectedPlacement.y, rotation: selectedPlacement.rotation }); void recalc(); }}
              >Повернуть 90°</button>
              <button
                onClick={() => { toggleLocked({ pieceId: selectedPlacement.pieceId, sheetIndex: selectedSheetIndex, x: selectedPlacement.x, y: selectedPlacement.y, rotation: selectedPlacement.rotation }); void recalc(); }}
                style={isLocked ? { borderColor: 'var(--accent)' } : undefined}
              >{isLocked ? 'Разблокировать' : 'Заблокировать'}</button>
            </div>
            {/* Связь с чертежом и 3D — по общему partId (§33/§34). */}
            <button
              style={{ width: '100%', marginTop: 6 }}
              onClick={() => { selectPart(selectedPlacement.partId); onOpenDrawing?.(selectedPlacement.partId); }}
            >Открыть чертёж детали</button>
            <Row k="Порядок реза" v={selectedPlacement.cutOrder != null ? String(selectedPlacement.cutOrder) : '—'} />
          </aside>
        )}
      </div>

      {sheetLibOpen && <SheetLibraryDialog onClose={() => setSheetLibOpen(false)} />}
      {remnantLibOpen && <RemnantLibraryDialog onClose={() => setRemnantLibOpen(false)} />}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', gap: 8 }}>
      <span className="dim">{k}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{v}</span>
    </div>
  );
}

const hdr: React.CSSProperties = { fontSize: 12, margin: '0 0 6px', color: 'var(--text)' };
const lbl: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', width: 'auto', color: 'var(--dim, #9aa0a6)' };
const num: React.CSSProperties = { width: 52 };
