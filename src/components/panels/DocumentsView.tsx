import { useEffect, useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import {
  buildDocument,
  buildDocumentCached,
  buildDocumentModel,
  documentToSvgPages,
  DOCUMENT_LIST,
  exportFileName,
  exportWarnings,
  isDocumentsOutdated,
  pdfPreflight,
  partsListCsv,
  hardwareListCsv,
  cuttingListCsv,
  machiningListCsv,
  materialListCsv,
  projectJson,
  searchDocuments,
  buildPartsDocument,
  documentFileName,
  ALL_VIEWS,
  VIEW_LABELS,
  STANDARD_SCALES,
  USER_FORMATS,
  PART_FILTERS,
  type DocumentSearchHit,
  type PartFilterKey,
  type ViewName,
} from '@/engines/drawing';
import {
  downloadSvgPages,
  downloadSvgNamed,
  downloadText,
  printPages,
  printSinglePage,
  pdfPageCountLabel,
} from '@/features/documents/print';
import { downloadPng } from '@/features/documents/png';
import type { ProjectIssue } from '@/engines/status';
import type { PartId } from '@/core/model/ids';

export interface DocumentsViewProps {
  /** Открыть деталь в 3D-редакторе (§50). */
  onOpenIn3D?: (partId: PartId) => void;
  /** Открыть положение детали на карте раскроя (§51). */
  onOpenInCutting?: (partId: PartId) => void;
  /** Открыть операции присадки детали (§52). */
  onOpenInMachining?: (partId: PartId) => void;
}

export function DocumentsView({ onOpenIn3D, onOpenInCutting, onOpenInMachining }: DocumentsViewProps = {}) {
  const project = useEditorStore((s) => s.project);
  const generate = useEditorStore((s) => s.generateDocuments);
  const selectPart = useEditorStore((s) => s.selectPart);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const setDocumentScale = useEditorStore((s) => s.setDocumentScale);
  const setDocumentFormat = useEditorStore((s) => s.setDocumentFormat);
  const setDocumentViews = useEditorStore((s) => s.setDocumentViews);
  const setDocumentPartFilter = useEditorStore((s) => s.setDocumentPartFilter);
  const resetDocumentLayout = useEditorStore((s) => s.resetDocumentLayout);

  const [docKey, setDocKey] = useState('title');
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(0.001); // < 0.01 — «по экрану»
  const [rotation, setRotation] = useState(0);
  const [genErrors, setGenErrors] = useState<ProjectIssue[] | null>(null);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const settings = project.documents.settings;
  const outdated = useMemo(() => isDocumentsOutdated(project), [project]);
  const warnings = useMemo(() => exportWarnings(project), [project]);
  // Кэш документов: ключ учитывает модель, тип, настройки и версию оформления.
  const doc = useMemo(() => buildDocumentCached(project, docKey, buildDocument), [project, docKey]);
  const pages = useMemo(() => documentToSvgPages(doc), [doc]);
  const pageCount = pages.length;
  const safeIndex = pageCount === 0 ? 0 : Math.min(pageIndex, pageCount - 1);
  const page = pages[safeIndex] ?? '';
  const currentPartId = doc.pages[safeIndex]?.partId ?? null;
  const docVersion = project.documents.docVersion ?? '—';

  const hits: DocumentSearchHit[] = useMemo(
    () => (query.trim() ? searchDocuments(project, query).slice(0, 20) : []),
    [project, query],
  );

  // Общее число страниц комплекта — для предпросмотра PDF (§45).
  const totalPages = useMemo(
    () => DOCUMENT_LIST.reduce((n, d) => {
      try { return n + buildDocumentCached(project, d.key, buildDocument).pages.length; } catch { return n; }
    }, 0),
    [project],
  );

  useEffect(() => { setPageIndex(0); setRotation(0); }, [docKey]);

  const chooseDoc = (key: string) => setDocKey(key);
  const goToHit = (hit: DocumentSearchHit) => {
    setDocKey(hit.docKey);
    setPageIndex(hit.pageIndex);
    selectPart(hit.partId as PartId);
  };

  const onGenerate = () => {
    const res = generate();
    if (!res.ok) { setGenErrors(res.errors); setGenMsg(null); return; }
    setGenErrors(null);
    setGenMsg(`Комплект сформирован (версия ${useEditorStore.getState().project.documents.docVersion}).`);
  };

  const exportAll = () => {
    const model = buildDocumentModel(project);
    const pre = pdfPreflight(model);
    if (!pre.ok) {
      setGenErrors(pre.issues.filter((i) => i.severity === 'error')
        .map((i) => ({ severity: 'error' as const, code: i.code, message: i.message })));
      return;
    }
    const allPages = model.documents.flatMap((e) => documentToSvgPages(e.doc));
    printPages(`${project.name} — комплект`, allPages);
  };

  /** Печать чертежей всех деталей одним PDF (§64). */
  const printAllParts = () => {
    const partsDoc = buildPartsDocument(project, { filter: settings?.partFilter });
    printPages(`${project.name} — чертежи деталей`, documentToSvgPages(partsDoc));
  };

  /** Печать чертежа выбранной детали (§63). */
  const printSelectedPart = () => {
    if (!selectedPartId) return;
    const partDoc = buildPartsDocument(project, { onlyPartId: String(selectedPartId) });
    const svg = documentToSvgPages(partDoc)[0];
    if (svg) printSinglePage(`${project.name} — деталь`, svg);
  };

  const exportPng = async () => {
    if (!page) return;
    setBusy('png');
    try {
      await downloadPng(documentFileName(project.name, doc.title, 'png'), page, { scale: 2 });
    } catch (e) {
      setGenMsg(`Не удалось сохранить PNG: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const csvExports: Array<[string, string, () => string]> = [
    ['Детали', 'parts', () => partsListCsv(project)],
    ['Фурнитура', 'hardware', () => hardwareListCsv(project)],
    ['Присадка', 'machining', () => machiningListCsv(project)],
    ['Материалы', 'materials', () => materialListCsv(project)],
    ['Раскрой', 'cutting', () => cuttingListCsv(project)],
  ];

  const selectedViews = (settings?.views as ViewName[] | undefined) ?? [];
  const toggleView = (v: ViewName) => {
    const next = selectedViews.includes(v) ? selectedViews.filter((x) => x !== v) : [...selectedViews, v];
    setDocumentViews(next);
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Document Center — структура документов (§62) */}
      <aside style={{ width: 250, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 10 }}>
        <h3 style={hdr}>Документы</h3>
        <ul className="nav-list">
          {DOCUMENT_LIST.map((d) => (
            <li key={d.key} className={d.key === docKey ? 'active' : ''} onClick={() => chooseDoc(d.key)}>
              {d.title}
            </li>
          ))}
        </ul>

        {/* Поиск по Part ID / названию / позиции (§61) */}
        <div className="panel-section" style={sect}>
          <span className="dim">Поиск</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="P001, «Полка», позиция"
            style={{ width: '100%', marginTop: 4 }}
          />
          {query.trim() !== '' && (
            <div style={{ marginTop: 6, maxHeight: 180, overflow: 'auto' }}>
              {hits.length === 0 && <div className="dim">Ничего не найдено.</div>}
              {hits.map((h, i) => (
                <div key={i} className="nav-list" style={{ margin: 0 }}>
                  <div
                    onClick={() => goToHit(h)}
                    style={{ cursor: 'pointer', padding: '3px 4px', fontSize: 12 }}
                    title={`${h.docTitle}, лист ${h.pageIndex + 1}`}
                  >
                    <strong>{h.partNumber}</strong> {h.partName}
                    <span className="dim"> · поз. {h.position} · {h.docTitle}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Статус и версия документации */}
        <div className="panel-section" style={sect}>
          <div style={row}>
            <span className="dim">Статус</span>
            <span style={{ color: outdated ? '#e6c060' : 'var(--ok)' }}>{outdated ? 'OUTDATED' : 'CURRENT'}</span>
          </div>
          <div style={row}>
            <span className="dim">Версия</span>
            <span>Rev. {docVersion}</span>
          </div>
          {warnings.messages.map((m, i) => (
            <div key={i} className="issue warning" style={{ marginBottom: 6 }}>{m}</div>
          ))}
          <button style={{ width: '100%' }} onClick={onGenerate}>Сформировать документы</button>
          {genMsg && <div className="dim" style={{ marginTop: 6, color: 'var(--ok)' }}>{genMsg}</div>}
          {genErrors && genErrors.length > 0 && (
            <div className="issue error" style={{ marginTop: 6 }}>
              Генерация заблокирована — ошибки модели:
              <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                {genErrors.slice(0, 6).map((e, i) => <li key={i}>{e.message}</li>)}
              </ul>
            </div>
          )}
        </div>

        {/* Оформление: формат, масштаб, виды, фильтр деталей (§8/§9/§10/§65) */}
        <div className="panel-section" style={sect}>
          <span className="dim">Оформление</span>
          <div style={{ ...row, marginTop: 4 }}>
            <span className="dim">Лист</span>
            <select
              value={settings?.formatOverrides?.[docKey] ?? 'A3'}
              onChange={(e) => setDocumentFormat(docKey, e.target.value as 'A4' | 'A3' | 'A2')}
            >
              {USER_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div style={row}>
            <span className="dim">Масштаб</span>
            <select
              value={String(settings?.scaleOverrides?.[docKey] ?? 'AUTO')}
              onChange={(e) => {
                const v = e.target.value;
                setDocumentScale(docKey, v === 'AUTO' ? 'AUTO' : Number(v));
              }}
            >
              {STANDARD_SCALES.map((s) => (
                <option key={String(s.value)} value={String(s.value)}>{s.label}</option>
              ))}
            </select>
          </div>
          {docKey === 'generalView' && (
            <div style={{ marginTop: 6 }}>
              <span className="dim">Виды</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {ALL_VIEWS.map((v) => (
                  <button
                    key={v}
                    className={selectedViews.includes(v) ? 'active' : ''}
                    style={{ fontSize: 11, padding: '2px 6px' }}
                    onClick={() => toggleView(v)}
                  >
                    {VIEW_LABELS[v]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(docKey === 'parts' || docKey === 'machining') && (
            <div style={{ marginTop: 6 }}>
              <span className="dim">Детали</span>
              <select
                style={{ width: '100%', marginTop: 4 }}
                value={settings?.partFilter ?? 'all'}
                onChange={(e) => setDocumentPartFilter(e.target.value as PartFilterKey)}
              >
                {PART_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </div>
          )}
          <button style={{ width: '100%', marginTop: 6 }} onClick={() => resetDocumentLayout(docKey)}>
            Сбросить оформление
          </button>
        </div>

        {/* Экспорт CSV/JSON (§48/§49) — имена файлов от названия проекта (§47) */}
        <div className="panel-section" style={sect}>
          <span className="dim">Экспорт данных</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            {csvExports.map(([label, kind, make]) => (
              <button
                key={kind}
                onClick={() => downloadText(
                  exportFileName(project.name, kind as 'parts'), make(), 'text/csv;charset=utf-8',
                )}
              >
                {label} — CSV
              </button>
            ))}
            <button
              onClick={() => downloadText(
                exportFileName(project.name, 'json'), projectJson(project), 'application/json',
              )}
            >
              Проект — JSON
            </button>
          </div>
        </div>
      </aside>

      {/* Document Preview (§59/§60) */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={toolbar}>
          <strong>{doc.title}</strong>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => setPageIndex(0)} disabled={safeIndex === 0} title="Первая страница">«</button>
            <button onClick={() => setPageIndex((i) => Math.max(0, i - 1))} disabled={safeIndex === 0}>‹</button>
            <span className="dim">{pageCount === 0 ? '0 / 0' : `${safeIndex + 1} / ${pageCount}`}</span>
            <button onClick={() => setPageIndex((i) => Math.min(pageCount - 1, i + 1))} disabled={safeIndex >= pageCount - 1}>›</button>
            <button onClick={() => setPageIndex(Math.max(0, pageCount - 1))} disabled={safeIndex >= pageCount - 1} title="Последняя страница">»</button>
          </span>
          <span className="sep" style={{ margin: '0 4px' }} />
          <button onClick={() => setZoom((z) => Math.max(0.05, (z < 0.01 ? 1 : z) / 1.25))}>−</button>
          <button onClick={() => setZoom(1)}>100%</button>
          <button onClick={() => setZoom((z) => (z < 0.01 ? 1 : z) * 1.25)}>+</button>
          <button onClick={() => setZoom(0.001)}>По экрану</button>
          <button onClick={() => setRotation((r) => (r + 90) % 360)} title="Повернуть страницу">⟳</button>
          <span className="sep" style={{ margin: '0 4px' }} />
          <button onClick={() => printSinglePage(doc.title, page)} disabled={!page}>Печать листа</button>
          <button onClick={() => printPages(doc.title, pages)} disabled={pageCount === 0}>Печать документа</button>
          <button onClick={() => downloadSvgNamed(documentFileName(project.name, doc.title, 'svg'), page)} disabled={!page}>SVG</button>
          <button onClick={() => downloadSvgPages(doc.title, pages)} disabled={pageCount === 0}>SVG (все)</button>
          <button onClick={exportPng} disabled={!page || busy === 'png'}>{busy === 'png' ? 'PNG…' : 'PNG'}</button>
          <span className="sep" style={{ margin: '0 4px' }} />
          <button onClick={printAllParts}>Печать всех деталей</button>
          <button onClick={printSelectedPart} disabled={!selectedPartId}>Печать выбранной детали</button>
          <span className="sep" style={{ margin: '0 4px' }} />
          <button onClick={exportAll} title={pdfPageCountLabel(totalPages)}>
            Экспорт комплекта ({pdfPageCountLabel(totalPages)})
          </button>
        </div>

        {/* Связь с 3D, раскроем и присадкой (§50–§52) */}
        {currentPartId && (
          <div style={{ ...toolbar, borderTop: 'none', paddingTop: 4, paddingBottom: 4 }}>
            <span className="dim">Деталь на листе:</span>
            <strong>{doc.pages[safeIndex]?.title.partNumber || doc.pages[safeIndex]?.title.title}</strong>
            <button onClick={() => { selectPart(currentPartId); onOpenIn3D?.(currentPartId); }}>Открыть в 3D</button>
            <button onClick={() => { selectPart(currentPartId); onOpenInCutting?.(currentPartId); }}>Открыть в раскрое</button>
            <button onClick={() => { selectPart(currentPartId); onOpenInMachining?.(currentPartId); }}>Открыть присадку</button>
          </div>
        )}

        <div style={canvas}>
          {pageCount === 0 ? (
            <div className="dim" style={{ color: '#e6e7e9', padding: 24 }}>
              В этом документе нет страниц — добавьте детали или измените фильтр.
            </div>
          ) : (
            <div
              onClick={() => { if (currentPartId) selectPart(currentPartId); }}
              style={{
                width: zoom < 0.01 ? '100%' : `${zoom * 100}%`,
                maxWidth: zoom < 0.01 ? '100%' : 'none',
                background: '#fff',
                boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                transform: rotation ? `rotate(${rotation}deg)` : undefined,
                transition: 'transform 0.15s',
              }}
              dangerouslySetInnerHTML={{ __html: page }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const hdr: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-dim)', margin: '0 0 8px',
};
const sect: React.CSSProperties = { padding: 0, marginTop: 12, borderBottom: 'none' };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 };
const toolbar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px',
  borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
};
const canvas: React.CSSProperties = {
  flex: 1, minHeight: 0, overflow: 'auto', background: '#3a3d43',
  padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
};
