/**
 * Подготовка деталей к раскрою (§47–§53, §93–§128).
 *
 * Экран дополняет карту раскроя тем, что нужно ПЕРЕД пилой: очередь групп,
 * склад остатков и резерв, ручная правка размещения, порядок резов, ошибки и
 * выгрузка. Считает по-прежнему движок раскроя — панель только показывает.
 */
import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import {
  buildCuttingJobs,
  buildCuttingQueue,
  cuttingReport,
  cutSummary,
  enrichJob,
  fromStoredRemnant,
  leftoverSummary,
  leftoverTableCsv,
  listCuttingExporters,
  orderCuts,
  projectCuttingCost,
  projectCuttingErrors,
  projectLeftovers,
  reportTotals,
  reservationSummary,
  resultToDxf,
  sheetToSvg,
  summarizeErrors,
  type CuttingErrorItem,
} from '@/engines/cutting';
import type { CuttingSheetResult, PieceRotation } from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';

export function CuttingPrep({ onOpenPart }: { onOpenPart?: (partId: string) => void }) {
  const project = useEditorStore((s) => s.project);
  const movePiece = useEditorStore((s) => s.moveCuttingPiece);
  const lockPiece = useEditorStore((s) => s.lockCuttingPiece);
  const lockSheet = useEditorStore((s) => s.lockCuttingSheet);
  const reoptimize = useEditorStore((s) => s.reoptimizeCuttingPieces);
  const harvest = useEditorStore((s) => s.harvestCuttingLeftovers);
  const reserve = useEditorStore((s) => s.reserveCuttingMaterial);
  const release = useEditorStore((s) => s.releaseCuttingMaterial);
  const moveQueue = useEditorStore((s) => s.moveCuttingQueueItem);
  const exportJobs = useEditorStore((s) => s.exportCuttingJobsJson);
  const importJobs = useEditorStore((s) => s.importCuttingJobsJson);
  const recalculate = useEditorStore((s) => s.recalculateCutting);
  const running = useEditorStore((s) => s.cuttingRunning);

  const [messages, setMessages] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [pieceId, setPieceId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ x: '0', y: '0', rotation: '0' });

  const note = (text: string) => setMessages((m) => [text, ...m].slice(0, 20));

  const jobs = useMemo(() => buildCuttingJobs(project).map((job) => enrichJob(job, project)), [project]);
  const queueOrder = Array.isArray(project.metadata?.cuttingQueueOrder)
    ? (project.metadata!.cuttingQueueOrder as string[])
    : [];
  const queue = useMemo(() => buildCuttingQueue(project, queueOrder), [project, queueOrder]);
  const sheets: CuttingSheetResult[] = useMemo(
    () => (project.cutting.report?.jobs ?? []).flatMap((job) => job.sheets),
    [project],
  );
  const activeSheet = sheets.find((s) => s.id === sheetId) ?? sheets[0] ?? null;
  const leftovers = useMemo(() => projectLeftovers(project), [project]);
  const stored = useMemo(() => project.remnants.map((r) => fromStoredRemnant(r)), [project]);
  const errors: CuttingErrorItem[] = useMemo(() => projectCuttingErrors(project), [project]);
  const errorSummary = summarizeErrors(errors);
  const report = useMemo(() => cuttingReport(project), [project]);
  const totals = reportTotals(report);
  const costs = useMemo(() => projectCuttingCost(project), [project]);
  const reservations = useMemo(() => reservationSummary(project), [project]);

  const materialNameOf = (id: unknown): string =>
    project.materials.find((m) => String(m.id) === String(id))?.name ?? '';

  const placements = activeSheet?.placements ?? [];
  const visiblePlacements = placements.filter(
    (p) => search.trim() === '' || p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const activePlacement = placements.find((p) => p.pieceId === pieceId) ?? null;

  const applyManual = () => {
    if (!activeSheet || !activePlacement) return;
    const result = movePiece(activeSheet.id, {
      pieceId: activePlacement.pieceId,
      x: Number(draft.x),
      y: Number(draft.y),
      rotation: Number(draft.rotation) as PieceRotation,
    });
    note(result.ok
      ? `Деталь «${activePlacement.name}» перемещена`
      : `Перемещение отклонено: ${result.issues.join(' ')}`);
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Очередь групп и склад (§93–§103) */}
      <aside style={{ width: 260, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 10 }}>
        <h3 style={hdr}>Очередь раскроя</h3>
        <div data-testid="cutting-queue">
          {queue.length === 0 && <div className="dim" style={{ fontSize: 11 }}>Деталей нет.</div>}
          {queue.map((item) => (
            <div key={item.key} style={row} data-testid="queue-item">
              <span style={{ fontSize: 11 }}>
                {item.priority}. {item.materialName} · {item.thickness} мм
                <span className="dim"> · деталей: {item.parts}</span>
              </span>
              <span style={{ display: 'flex', gap: 2 }}>
                <button data-testid="queue-up" onClick={() => moveQueue(item.key, -1)}>↑</button>
                <button onClick={() => moveQueue(item.key, 1)}>↓</button>
              </span>
            </div>
          ))}
        </div>

        <h3 style={{ ...hdr, marginTop: 12 }}>Задания</h3>
        <div data-testid="cutting-jobs">
          {jobs.map((job) => (
            <div key={job.id} style={{ fontSize: 11, marginBottom: 4 }}>
              {job.thickness} мм · v{job.version}
              <span className="dim"> · {job.status}</span>
              <span className="dim"> · листов: {job.result?.sheets.length ?? 0}</span>
            </div>
          ))}
        </div>

        <h3 style={{ ...hdr, marginTop: 12 }}>Склад</h3>
        <div data-testid="stock-summary">
          {reservations.map((r) => (
            <div key={`${r.materialId}:${r.thickness}`} className="dim" style={{ fontSize: 11 }}>
              {r.thickness} мм · листов: {r.available} · резерв: {r.reserved}
              {' · '}остатков: {r.remnantsAvailable}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          <button data-testid="reserve-sheets" onClick={() => {
            const first = queue[0];
            if (!first) { note('Нет групп для резервирования.'); return; }
            const result = reserve({
              jobId: `job-${first.key}`,
              materialId: first.materialId as MaterialId,
              thickness: first.thickness,
              sheets: Math.max(1, first.sheets || 1),
            });
            note(`Зарезервировано листов: ${result.reservedSheets}. ${result.warnings.join(' ')}`);
          }}>Резервировать</button>
          <button data-testid="release-sheets" onClick={() => {
            const first = queue[0];
            if (!first) return;
            const result = release(`job-${first.key}`);
            note(`Резерв снят: ${result.releasedSheets} листов`);
          }}>Снять резерв</button>
        </div>
      </aside>

      {/* Листы, детали и ручная правка (§53–§83) */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 12 }}>
        <h3 style={hdr}>Листы</h3>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }} data-testid="sheet-list">
          {sheets.map((sheet) => (
            <button key={sheet.id} data-testid="sheet-button"
              className={activeSheet?.id === sheet.id ? 'active' : ''}
              onClick={() => { setSheetId(sheet.id); setPieceId(null); }}>
              Лист {sheet.index + 1}
              <span className="dim"> · {Math.round(sheet.utilization * 100)}%</span>
            </button>
          ))}
          {sheets.length === 0 && <span className="dim" style={{ fontSize: 11 }}>Раскрой ещё не рассчитан.</span>}
        </div>

        {activeSheet && (
          <>
            <div className="dim" style={{ fontSize: 11, marginBottom: 6 }} data-testid="sheet-info">
              {Math.round(activeSheet.length)} × {Math.round(activeSheet.width)} мм ·
              {' '}использовано {Math.round(activeSheet.usedAreaMm2 / 1000) / 1000} м² ·
              {' '}отход {Math.round(activeSheet.wasteAreaMm2 / 1000) / 1000} м² ·
              {' '}загрузка {Math.round(activeSheet.utilization * 100)}% ·
              {' '}резов: {cutSummary(activeSheet).total}
            </div>

            {/* Карта листа (§64–§68) */}
            <div
              data-testid="sheet-canvas"
              style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 6, marginBottom: 8, overflow: 'auto' }}
              dangerouslySetInnerHTML={{
                __html: sheetToSvg(activeSheet, materialNameOf(activeSheet.materialId)),
              }}
            />

            {/* Порядок резов (§84–§88) */}
            <details style={{ marginBottom: 8 }}>
              <summary className="dim" style={{ fontSize: 11, cursor: 'pointer' }}>
                Порядок резов ({orderCuts(activeSheet).length})
              </summary>
              <div data-testid="cut-order">
                {orderCuts(activeSheet).slice(0, 20).map((cut) => (
                  <div key={cut.id} className="dim" style={{ fontSize: 11 }}>
                    {cut.order}. {cut.orientation === 'vertical' ? 'вертикальный' : 'горизонтальный'}
                    {cut.through ? ' сквозной' : ''} · {Math.round(cut.length)} мм
                  </div>
                ))}
              </div>
            </details>

            {/* Детали листа (§59–§63) */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <input data-testid="part-search" placeholder="Поиск детали"
                value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 160 }} />
              <span className="dim" style={{ fontSize: 11 }}>
                деталей: {visiblePlacements.length} из {placements.length}
              </span>
            </div>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }} data-testid="part-table">
              <thead>
                <tr><th style={th}>№</th><th style={th}>Деталь</th><th style={th}>Размер</th>
                  <th style={th}>Поворот</th><th style={th}>Позиция</th><th style={th}></th></tr>
              </thead>
              <tbody>
                {visiblePlacements.map((placement) => (
                  <tr key={placement.pieceId}
                    data-testid="part-row"
                    style={{ background: pieceId === placement.pieceId ? 'var(--accent-dim)' : undefined, cursor: 'pointer' }}
                    onClick={() => {
                      setPieceId(placement.pieceId);
                      setDraft({
                        x: String(Math.round(placement.x)),
                        y: String(Math.round(placement.y)),
                        rotation: String(placement.rotation),
                      });
                    }}>
                    <td style={td}>{placement.number}</td>
                    <td style={td}>{placement.name}</td>
                    <td style={td}>{Math.round(placement.length)} × {Math.round(placement.width)}</td>
                    <td style={td}>{placement.rotation}°</td>
                    <td style={td}>{Math.round(placement.x)}, {Math.round(placement.y)}</td>
                    <td style={td}>
                      {onOpenPart && (
                        <button onClick={(e) => { e.stopPropagation(); onOpenPart(String(placement.partId)); }}>
                          Деталь
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Ручное размещение (§74–§80) */}
            {activePlacement && (
              <section style={section} data-testid="manual-placement">
                <span className="dim">Ручное размещение: {activePlacement.name}</span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span className="dim" style={{ fontSize: 11 }}>X</span>
                    <input data-testid="manual-x" type="number" style={{ width: 80 }} value={draft.x}
                      onChange={(e) => setDraft((d) => ({ ...d, x: e.target.value }))} />
                  </label>
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span className="dim" style={{ fontSize: 11 }}>Y</span>
                    <input data-testid="manual-y" type="number" style={{ width: 80 }} value={draft.y}
                      onChange={(e) => setDraft((d) => ({ ...d, y: e.target.value }))} />
                  </label>
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span className="dim" style={{ fontSize: 11 }}>Поворот</span>
                    <select data-testid="manual-rotation" value={draft.rotation}
                      onChange={(e) => setDraft((d) => ({ ...d, rotation: e.target.value }))}>
                      <option value="0">0°</option>
                      <option value="90">90°</option>
                    </select>
                  </label>
                  <button data-testid="manual-apply" onClick={applyManual}>Применить</button>
                  <button data-testid="lock-piece" onClick={() => {
                    note(lockPiece(activeSheet.id, activePlacement.pieceId)
                      ? `Деталь «${activePlacement.name}» зафиксирована`
                      : 'Не удалось зафиксировать деталь');
                  }}>Зафиксировать</button>
                  <button data-testid="lock-sheet" onClick={() => {
                    note(`Зафиксировано деталей на листе: ${lockSheet(activeSheet.id)}`);
                  }}>Зафиксировать лист</button>
                  <button data-testid="reoptimize-piece" disabled={running} onClick={() => {
                    void reoptimize([activePlacement.pieceId]);
                    note('Перерасчёт выбранной детали запущен');
                  }}>Пересчитать выбранное</button>
                </div>
              </section>
            )}
          </>
        )}

        {/* Ошибки (§124–§129) */}
        <section style={section} data-testid="cutting-errors">
          <span className="dim">
            Ошибки раскроя: {errorSummary.errors}, предупреждений: {errorSummary.warnings}
          </span>
          {errors.slice(0, 10).map((error, i) => (
            <div key={i} className={`issue ${error.severity === 'error' ? 'error' : 'warning'}`}>
              {error.partName}
              {error.sheetId ? ` · лист ${error.sheetId}` : ''}
              {error.x !== undefined ? ` · ${Math.round(error.x)}, ${Math.round(error.y ?? 0)}` : ''}
              {': '}{error.message}
            </div>
          ))}
          {errors.length === 0 && <div className="dim" style={{ fontSize: 11 }}>Ошибок нет.</div>}
        </section>

        <section style={section}>
          <span className="dim">История</span>
          {messages.length === 0 && <div className="dim" style={{ fontSize: 11 }}>Пока пусто.</div>}
          {messages.map((m, i) => <div key={i} className="dim" style={{ fontSize: 11 }}>{m}</div>)}
        </section>
      </div>

      {/* Остатки, отчёт и выгрузка (§37–§46, §107–§117) */}
      <aside style={{ width: 280, borderLeft: '1px solid var(--border)', overflow: 'auto', padding: 10 }}>
        <h3 style={hdr}>Остатки</h3>
        <div data-testid="leftovers">
          {(() => {
            const summary = leftoverSummary(leftovers);
            return (
              <div className="dim" style={{ fontSize: 11 }}>
                всего: {summary.total} · пригодных: {summary.usable} · мелких: {summary.tooSmall}
                {' · '}площадь: {summary.usableAreaM2} м²
              </div>
            );
          })()}
          {leftovers.slice(0, 8).map((leftover) => (
            <div key={leftover.id} style={{ fontSize: 11 }} data-testid="leftover-row">
              {Math.round(leftover.width)} × {Math.round(leftover.height)}
              <span className="dim"> · {leftover.status}</span>
            </div>
          ))}
        </div>
        <button style={{ marginTop: 6 }} data-testid="harvest-leftovers" onClick={() => {
          note(`Оприходовано остатков: ${harvest()}`);
        }}>Оприходовать на склад</button>

        <h3 style={{ ...hdr, marginTop: 12 }}>Склад остатков</h3>
        <div data-testid="stored-leftovers">
          {stored.length === 0 && <div className="dim" style={{ fontSize: 11 }}>Склад пуст.</div>}
          {stored.slice(0, 8).map((leftover) => (
            <div key={leftover.id} style={{ fontSize: 11 }}>
              {Math.round(leftover.width)} × {Math.round(leftover.height)}
              <span className="dim"> · {leftover.status}</span>
            </div>
          ))}
        </div>

        <h3 style={{ ...hdr, marginTop: 12 }}>Отчёт</h3>
        <div data-testid="cutting-report" className="dim" style={{ fontSize: 11 }}>
          разделов: {totals.sections} · листов: {totals.sheets} · деталей: {totals.parts}
          {' · '}загрузка: {totals.utilization}% · отход: {totals.wasteAreaM2} м²
          {' · '}пригодных остатков: {totals.usableLeftovers}
        </div>
        {costs.length > 0 && (
          <div data-testid="cutting-cost" className="dim" style={{ fontSize: 11, marginTop: 4 }}>
            {costs.map((cost) => (
              <div key={cost.materialId}>
                {cost.materialName}: {cost.materialCost} {cost.currency}
                {' · отход: '}{cost.wasteCost} {cost.currency}
              </div>
            ))}
          </div>
        )}

        <h3 style={{ ...hdr, marginTop: 12 }}>Выгрузка</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button data-testid="export-svg" disabled={!activeSheet} onClick={() => {
            if (!activeSheet) return;
            const svg = sheetToSvg(activeSheet, materialNameOf(activeSheet.materialId));
            note(`SVG листа: ${svg.length} символов`);
          }}>Экспорт SVG</button>
          <button data-testid="export-dxf" disabled={sheets.length === 0} onClick={() => {
            const result = project.cutting.report?.jobs[0];
            if (!result) return;
            note(`DXF: ${resultToDxf(result).split('\n').length} строк`);
          }}>Экспорт DXF</button>
          <button data-testid="export-csv" onClick={() => {
            note(`CSV остатков: ${leftoverTableCsv(report).split('\n').length - 1} строк`);
          }}>Экспорт CSV остатков</button>
          <button data-testid="export-json" onClick={() => {
            const json = exportJobs();
            note(`JSON задания: ${json.length} байт`);
          }}>Экспорт JSON задания</button>
          <label style={{ cursor: 'pointer' }}>
            <span className="dim" style={{ fontSize: 11 }}>Импорт JSON задания</span>
            <input type="file" accept="application/json" style={{ display: 'none' }}
              data-testid="import-json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const result = importJobs(await file.text());
                note(result.ok ? `Импортировано заданий: ${result.jobs}` : result.errors.join(' '));
              }} />
          </label>
          <button data-testid="rebuild-cutting" disabled={running} onClick={() => {
            void recalculate();
            note('Пересчёт раскроя запущен');
          }}>Пересчитать раскрой</button>
          <span className="dim" style={{ fontSize: 10 }}>
            Форматы: {listCuttingExporters().map((x) => x.label).join(', ')}, SVG, CSV, JSON
          </span>
        </div>
      </aside>
    </div>
  );
}

const hdr: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-dim)', margin: '0 0 8px',
};
const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8,
};
const section: React.CSSProperties = {
  paddingTop: 8, marginTop: 8, borderTop: '1px solid var(--border)',
};
const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid var(--border)', padding: '2px 4px' };
const td: React.CSSProperties = { padding: '2px 4px', borderBottom: '1px solid var(--border)' };
