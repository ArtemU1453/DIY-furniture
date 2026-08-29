/**
 * Производственный центр (§113–§163).
 *
 * Экран собирает то, что нужно цеху: панель готовности с чек-листом, таблицу
 * деталей с поиском и фильтрами, карту детали с присадкой и кромкой,
 * этикетки, партии, выпуски и выгрузку пакета. Считают движки production и
 * cutting — панель только показывает и вызывает действия store.
 */
import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import {
  DEFAULT_LABEL_SIZE,
  LABEL_SIZES,
  PRODUCTION_DOCUMENTS,
  PRODUCTION_DOCUMENT_LABELS,
  barcodeSvg,
  batchSummary,
  detectChanges,
  filterProductionParts,
  jobOf,
  labelSheets,
  labelSize,
  packageContents,
  productionPackage,
  partCard,
  productionBatches,
  productionDashboard,
  productionHistory,
  productionLabels,
  productionParts,
  productionReadiness,
  productionSnapshot,
  qrMatrix,
  qrMatrixToSvg,
  sortProductionParts,
  type ProductionSortField,
} from '@/engines/production';
import type { ProductionPartStatus } from '@/core/model/types';

const STATUS_LABELS: Record<ProductionPartStatus, string> = {
  NEW: 'новая',
  MODIFIED: 'изменена',
  READY: 'готова',
  ERROR: 'ошибка',
};

export function ProductionCenter({
  onOpenPart,
  onOpenCutting,
  onOpenDocuments,
}: {
  onOpenPart?: (partId: string) => void;
  onOpenCutting?: () => void;
  onOpenDocuments?: () => void;
}) {
  const project = useEditorStore((s) => s.project);
  const cuttingRunning = useEditorStore((s) => s.cuttingRunning);
  const refresh = useEditorStore((s) => s.refreshProduction);
  const release = useEditorStore((s) => s.createProductionRelease);
  const complete = useEditorStore((s) => s.completeProduction);
  const setNote = useEditorStore((s) => s.setProductionNote);
  const exportJob = useEditorStore((s) => s.exportProductionJobJson);
  const importJob = useEditorStore((s) => s.importProductionJobJson);

  const [messages, setMessages] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ProductionPartStatus | ''>('');
  const [sort, setSort] = useState<ProductionSortField>('number');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [labelSizeId, setLabelSizeId] = useState(DEFAULT_LABEL_SIZE.id);
  const [releaseNote, setReleaseNote] = useState('');

  const note = (text: string) => setMessages((m) => [text, ...m].slice(0, 20));

  const job = useMemo(() => jobOf(project), [project]);
  const parts = useMemo(() => productionParts(project, job.snapshot?.parts), [project, job]);
  const snapshot = useMemo(() => productionSnapshot(project, parts), [project, parts]);
  const changes = useMemo(
    () => detectChanges(job.snapshot, snapshot, parts),
    [job.snapshot, snapshot, parts],
  );
  const batches = useMemo(() => productionBatches(parts), [parts]);
  const readiness = useMemo(
    () => productionReadiness(project, parts, { cuttingRunning }),
    [project, parts, cuttingRunning],
  );
  const dashboard = useMemo(
    () => productionDashboard(job, parts, batches, readiness),
    [job, parts, batches, readiness],
  );
  const history = useMemo(() => productionHistory(project.production), [project.production]);

  const visible = useMemo(() => {
    const filtered = filterProductionParts(parts, {
      query,
      status: status === '' ? undefined : status,
    });
    return sortProductionParts(filtered, sort, direction);
  }, [parts, query, status, sort, direction]);

  const active = useMemo(
    () => visible.find((p) => String(p.partId) === activeId) ?? visible[0],
    [visible, activeId],
  );
  const card = useMemo(() => (active ? partCard(project, active) : null), [project, active]);

  const size = labelSize(labelSizeId);
  const labels = useMemo(
    () => productionLabels(project, parts, { size }),
    [project, parts, size],
  );
  const sheets = useMemo(() => labelSheets(labels, size), [labels, size]);
  const activeLabel = labels.find((l) => l.partId === String(active?.partId));
  /* Состав пакета (§138): те же файлы, что уйдут при выгрузке. */
  const files = useMemo(
    () => packageContents(productionPackage(project, { job, parts, batches, readiness })),
    [project, job, parts, batches, readiness],
  );

  const toggleSort = (field: ProductionSortField) => {
    if (sort === field) setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(field); setDirection('asc'); }
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }} data-testid="production-center">
      {/* Панель готовности и чек-лист (§63–§75, §113–§115) */}
      <aside style={{ width: 260, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 12 }}>
        <h3 style={hdr}>Готовность</h3>
        <div data-testid="production-dashboard">
          <div style={row}>
            <span className="dim">Статус</span>
            <span data-testid="production-status">{dashboard.status}</span>
          </div>
          <div style={row}>
            <span className="dim">Ревизия</span><span>{dashboard.revision}</span>
          </div>
          {/* Пустой проект не бывает «готов на 100%»: проверять нечего, поэтому
            * чек-лист и не находит ошибок. Показывать мастеру «готово», когда
            * делать нечего, — прямая дезинформация, поэтому пустой случай
            * назван своими словами. Расчёт готовности при этом не меняется. */}
          <div style={row}>
            <span className="dim">Готовность</span>
            <span data-testid="production-progress">
              {dashboard.parts === 0 ? 'нечего производить' : `${dashboard.progress}%`}
            </span>
          </div>
          {dashboard.parts > 0 && (
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', margin: '4px 0 8px' }}>
              <div style={{ width: `${dashboard.progress}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
          )}
          {dashboard.parts === 0 && (
            <div className="dim" style={{ fontSize: 11, margin: '4px 0 8px' }} data-testid="production-empty">
              В проекте нет деталей. Создайте изделие — задание для цеха соберётся само.
            </div>
          )}
          <div style={row}>
            <span className="dim">Деталей</span><span>{dashboard.parts} ({dashboard.quantity} шт.)</span>
          </div>
          <div style={row}>
            <span className="dim">Партий</span><span>{dashboard.batches}</span>
          </div>
          <div style={row}>
            <span className="dim">Ошибок</span>
            <span data-testid="production-errors">{dashboard.errors}</span>
          </div>
          <div style={row}>
            <span className="dim">Предупреждений</span><span>{dashboard.warnings}</span>
          </div>
        </div>

        <h3 style={{ ...hdr, marginTop: 12 }}>Чек-лист</h3>
        <div data-testid="production-checklist">
          {readiness.checklist.map((item) => (
            <div key={item.id} data-testid="checklist-item" style={{ marginBottom: 4, fontSize: 11 }}>
              <span style={{ color: item.ok ? 'var(--ok, #4b6a45)' : 'var(--danger, #a33)' }}>
                {item.ok ? '✓' : '✕'}
              </span>{' '}
              {item.label}
              {item.detail && <div className="dim" style={{ fontSize: 10 }}>{item.detail}</div>}
              {item.target && !item.ok && (
                <button
                  data-testid="checklist-goto"
                  style={{ fontSize: 10, marginTop: 2 }}
                  onClick={() => {
                    if (item.target?.kind === 'PART') {
                      setActiveId(item.target.id);
                      onOpenPart?.(item.target.id);
                    } else if (item.target?.id === 'cutting') onOpenCutting?.();
                    else if (item.target?.id === 'documents') onOpenDocuments?.();
                  }}
                >Перейти</button>
              )}
            </div>
          ))}
        </div>

        <h3 style={{ ...hdr, marginTop: 12 }}>Изменения</h3>
        <div data-testid="production-changes" className="dim" style={{ fontSize: 11 }}>
          {changes.length === 0 && 'Изменений после снимка нет.'}
          {changes.slice(0, 10).map((change) => (
            <div key={`${change.kind}:${change.partId}`}>
              {change.kind === 'ADDED' ? 'Новая' : change.kind === 'REMOVED' ? 'Удалена' : 'Изменена'}
              {' '}{change.number ?? change.partId}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
          <button data-testid="refresh-production" onClick={() => {
            const result = refresh();
            note(`Снимок обновлён: ревизия ${result.revision}, статус ${result.status}, изменений ${result.changes}`);
          }}>Пересчитать</button>
          <button data-testid="complete-production" onClick={() => {
            complete();
            note('Задание отмечено как завершённое.');
          }}>Завершить</button>
        </div>
      </aside>

      {/* Таблица деталей и карта детали (§141–§150) */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 12 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <input
            data-testid="production-search"
            placeholder="Поиск детали"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 180 }}
          />
          <select
            data-testid="production-status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as ProductionPartStatus | '')}
          >
            <option value="">Все статусы</option>
            {(['NEW', 'MODIFIED', 'READY', 'ERROR'] as ProductionPartStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
          <span className="dim" style={{ fontSize: 11 }}>
            деталей: {visible.length} из {parts.length}
          </span>
        </div>

        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }} data-testid="production-table">
          <thead>
            <tr>
              {([
                ['number', '№'], ['name', 'Деталь'], ['material', 'Материал'],
                ['size', 'Размер'], ['quantity', 'Кол-во'], ['status', 'Статус'],
              ] as Array<[ProductionSortField, string]>).map(([field, label]) => (
                <th key={field} style={{ ...th, cursor: 'pointer' }}
                  data-testid={`sort-${field}`}
                  onClick={() => toggleSort(field)}>
                  {label}{sort === field ? (direction === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
              <th style={th}>Присадка</th>
              <th style={th}>Кромка</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {visible.map((part) => (
              <tr key={String(part.partId)}
                data-testid="production-row"
                style={{
                  background: String(part.partId) === String(active?.partId) ? 'var(--accent-dim)' : undefined,
                  cursor: 'pointer',
                }}
                onClick={() => setActiveId(String(part.partId))}>
                <td style={td}>{part.number}</td>
                <td style={td}>{part.name}</td>
                <td style={td}>{part.materialName}</td>
                <td style={td}>{part.width} × {part.height} × {part.thickness}</td>
                <td style={td}>{part.quantity}</td>
                <td style={td}>{STATUS_LABELS[part.status]}</td>
                <td style={td}>{part.operations.length}</td>
                <td style={td}>
                  {part.edges.filter((e) => e.edgeMaterialId).map((e) => e.label).join(' ') || '—'}
                </td>
                <td style={td}>
                  {onOpenPart && (
                    <button onClick={(e) => { e.stopPropagation(); onOpenPart(String(part.partId)); }}>
                      Деталь
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {card && (
          <section style={section} data-testid="part-card">
            <h3 style={hdr}>Карта детали {card.mark}</h3>
            <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
              {card.name} · {card.materialName} · чистовой {card.width} × {card.height} × {card.thickness} ·
              {' '}заготовка {card.rawWidth} × {card.rawHeight} · {card.grain} ·
              {' '}{card.orientation === 'LANDSCAPE' ? 'горизонтально' : 'вертикально'} ({card.rotation}°)
            </div>

            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }} data-testid="card-views">
              {card.views.filter((v) => v.visible).map((view) => (
                <span key={view.view} className="dim" style={{ fontSize: 11 }}>
                  {view.label} ({view.operationCount})
                </span>
              ))}
            </div>

            {card.edges.length > 0 && (
              <table style={{ fontSize: 11, borderCollapse: 'collapse', marginBottom: 8 }} data-testid="card-edges">
                <thead>
                  <tr><th style={th}>Сторона</th><th style={th}>Материал</th><th style={th}>Толщина</th><th style={th}>Длина</th></tr>
                </thead>
                <tbody>
                  {card.edges.map((edge) => (
                    <tr key={edge.label}>
                      <td style={td}>{edge.label}</td>
                      <td style={td}>{edge.materialName}</td>
                      <td style={td}>{edge.thickness}</td>
                      <td style={td}>{Math.round(edge.length)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {card.operations.length > 0 && (
              <table style={{ fontSize: 11, borderCollapse: 'collapse', marginBottom: 8 }} data-testid="card-operations">
                <thead>
                  <tr>
                    <th style={th}>№</th><th style={th}>Тип</th><th style={th}>Грань</th>
                    <th style={th}>X</th><th style={th}>Y</th><th style={th}>Обозначение</th>
                  </tr>
                </thead>
                <tbody>
                  {card.operations.map((op) => (
                    <tr key={op.index}>
                      <td style={td}>{op.index}</td>
                      <td style={td}>{op.type}</td>
                      <td style={td}>{op.face}</td>
                      <td style={td}>{Math.round(op.x)}</td>
                      <td style={td}>{Math.round(op.y)}</td>
                      <td style={td}>{op.notation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {card.page && (
              <div
                data-testid="card-drawing"
                style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 6, overflow: 'auto' }}
              >
                <span className="dim" style={{ fontSize: 11 }}>
                  Чертёж: {card.page.title.title} · {card.page.format} · примитивов: {card.page.scene.prims.length}
                </span>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Партии, этикетки, выпуски и выгрузка (§59–§62, §76–§84, §108–§112, §136–§140) */}
      <aside style={{ width: 280, borderLeft: '1px solid var(--border)', overflow: 'auto', padding: 12 }}>
        <h3 style={hdr}>Партии</h3>
        <div data-testid="production-batches">
          {batches.map((batch) => (
            <div key={batch.id} style={{ fontSize: 11, marginBottom: 3 }}>
              {batch.kind} · {batch.materialName} {batch.thickness} мм
              <span className="dim"> · {batch.partIds.length} дет. / {batch.quantity} шт. · {batch.status}</span>
            </div>
          ))}
          {batches.length === 0 && <span className="dim" style={{ fontSize: 11 }}>Партий нет.</span>}
          {batches.length > 0 && (
            <div className="dim" style={{ fontSize: 10, marginTop: 4 }}>
              Всего: {batchSummary(batches).parts} шт.
            </div>
          )}
        </div>

        <h3 style={{ ...hdr, marginTop: 12 }}>Этикетки</h3>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6 }}>
          <select data-testid="label-size" value={labelSizeId} onChange={(e) => setLabelSizeId(e.target.value)}>
            {LABEL_SIZES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className="dim" style={{ fontSize: 11 }}>листов: {sheets.length}</span>
        </div>
        {activeLabel && (
          <div data-testid="label-preview" style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 6 }}>
            {activeLabel.lines.map((line, i) => (
              <div key={i} style={{ fontSize: i === 0 ? 12 : 11 }}>{line}</div>
            ))}
            <div className="dim" style={{ fontSize: 10, marginTop: 4 }} data-testid="label-code">
              {activeLabel.code}
            </div>
            <div
              data-testid="label-barcode"
              style={{ marginTop: 4 }}
              dangerouslySetInnerHTML={{ __html: barcodeSvg(activeLabel.barcode, 160, 28) }}
            />
            {(() => {
              const svg = qrMatrixToSvg(qrMatrix(activeLabel.code), 64);
              return svg
                ? <div data-testid="label-qr" dangerouslySetInnerHTML={{ __html: svg }} />
                : (
                  <div className="dim" style={{ fontSize: 10, marginTop: 4 }} data-testid="label-qr-missing">
                    QR-генератор не подключён — код показан текстом.
                  </div>
                );
            })()}
          </div>
        )}

        <h3 style={{ ...hdr, marginTop: 12 }}>Выпуски</h3>
        <div data-testid="production-releases">
          {history.map((rel) => (
            <div key={rel.id} style={{ fontSize: 11, marginBottom: 3 }}>
              {rel.id} · деталей: {rel.partCount}
              <span className="dim"> · {rel.snapshot.projectRevision}</span>
              {rel.note && <div className="dim" style={{ fontSize: 10 }}>{rel.note}</div>}
            </div>
          ))}
          {history.length === 0 && <span className="dim" style={{ fontSize: 11 }}>Выпусков ещё нет.</span>}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          <input
            data-testid="release-note"
            placeholder="Примечание к выпуску"
            value={releaseNote}
            onChange={(e) => setReleaseNote(e.target.value)}
            style={{ width: 150 }}
          />
          <button data-testid="create-release" onClick={() => {
            const result = release(releaseNote || undefined);
            note(result.ok ? `Создан выпуск ${result.releaseId}` : (result.error ?? 'Выпуск не создан.'));
            if (result.ok) setReleaseNote('');
          }}>Выпустить</button>
          <button data-testid="save-note" onClick={() => {
            setNote(releaseNote);
            note('Примечание сохранено.');
          }}>Примечание</button>
        </div>

        <h3 style={{ ...hdr, marginTop: 12 }}>Документы и выгрузка</h3>
        <div className="dim" style={{ fontSize: 11, marginBottom: 6 }} data-testid="production-documents">
          {PRODUCTION_DOCUMENTS.map((kind) => (
            <div key={kind}>{PRODUCTION_DOCUMENT_LABELS[kind]}</div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button data-testid="export-production-job" onClick={() => {
            const json = exportJob();
            note(`production-job.json: ${json.length} байт`);
          }}>Экспорт задания</button>
          <label style={{ cursor: 'pointer' }}>
            <span className="dim" style={{ fontSize: 11 }}>Импорт задания</span>
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              data-testid="import-production-job"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const result = importJob(await file.text());
                note(result.ok ? `Импортировано выпусков: ${result.releases}` : (result.error ?? 'Импорт не выполнен.'));
              }}
            />
          </label>
          {onOpenDocuments && (
            <button data-testid="open-documents" onClick={() => onOpenDocuments()}>Документы</button>
          )}
        </div>
        <div className="dim" style={{ fontSize: 10, marginTop: 4 }} data-testid="package-contents">
          {files.map((f) => <div key={f.name}>{f.name} · {f.size} б</div>)}
        </div>

        <h3 style={{ ...hdr, marginTop: 12 }}>Журнал</h3>
        <div data-testid="production-log" className="dim" style={{ fontSize: 11 }}>
          {messages.map((m, i) => <div key={i}>{m}</div>)}
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
