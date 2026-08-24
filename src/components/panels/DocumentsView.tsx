import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import {
  buildDocument,
  documentToSvgPages,
  DOCUMENT_LIST,
  isDocumentsOutdated,
  pdfPreflight,
  buildDocumentModel,
  partsListCsv,
  hardwareListCsv,
  cuttingListCsv,
} from '@/engines/drawing';
import { downloadSvgPages, printPages } from '@/features/documents/print';
import type { ProjectIssue } from '@/engines/status';

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

export function DocumentsView() {
  const project = useEditorStore((s) => s.project);
  const generate = useEditorStore((s) => s.generateDocuments);
  const selectPart = useEditorStore((s) => s.selectPart);

  const [docKey, setDocKey] = useState('summary');
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(0.001); // по экрану по умолчанию
  const [rotation, setRotation] = useState(0);
  const [genErrors, setGenErrors] = useState<ProjectIssue[] | null>(null);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  const outdated = useMemo(() => isDocumentsOutdated(project), [project]);
  const doc = useMemo(() => buildDocument(project, docKey), [project, docKey]);
  const pages = useMemo(() => documentToSvgPages(doc), [doc]);
  const page = pages[Math.min(pageIndex, pages.length - 1)] ?? '';
  const docVersion = project.documents.docVersion ?? '—';

  const chooseDoc = (key: string) => { setDocKey(key); setPageIndex(0); setRotation(0); };

  const onGenerate = () => {
    const res = generate();
    if (!res.ok) {
      setGenErrors(res.errors);
      setGenMsg(null);
    } else {
      setGenErrors(null);
      setGenMsg(`Комплект сформирован (версия ${useEditorStore.getState().project.documents.docVersion}).`);
    }
  };

  const exportAll = () => {
    const model = buildDocumentModel(project);
    const pre = pdfPreflight(model);
    if (!pre.ok) {
      setGenErrors(pre.issues.filter((i) => i.severity === 'error').map((i) => ({ severity: 'error' as const, code: i.code, message: i.message })));
      return;
    }
    const allPages = model.documents.flatMap((e) => documentToSvgPages(e.doc));
    printPages(`${project.name} — комплект`, allPages);
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Содержание */}
      <aside style={{ width: 230, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 10 }}>
        <h3 style={hdr}>Содержание</h3>
        <ul className="nav-list">
          {DOCUMENT_LIST.map((d) => (
            <li key={d.key} className={d.key === docKey ? 'active' : ''} onClick={() => chooseDoc(d.key)}>
              {d.title}
            </li>
          ))}
        </ul>

        <div className="panel-section" style={{ padding: 0, marginTop: 12, borderBottom: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span className="dim">Статус</span>
            <span style={{ color: outdated ? '#e6c060' : 'var(--ok)' }}>{outdated ? 'OUTDATED' : 'CURRENT'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="dim">Версия документов</span>
            <span>{docVersion}</span>
          </div>
          {outdated && <div className="issue warning" style={{ marginBottom: 6 }}>Документы требуют обновления.</div>}
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

        <div className="panel-section" style={{ padding: 0, marginTop: 12, borderBottom: 'none' }}>
          <span className="dim">Экспорт CSV</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            <button onClick={() => download('PartsList.csv', partsListCsv(project), 'text/csv')}>Спецификация деталей</button>
            <button onClick={() => download('HardwareList.csv', hardwareListCsv(project), 'text/csv')}>Спецификация фурнитуры</button>
            <button onClick={() => download('CuttingList.csv', cuttingListCsv(project), 'text/csv')}>Карта раскроя</button>
          </div>
        </div>
      </aside>

      {/* Предпросмотр (DocumentViewer) */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <strong>{doc.title}</strong>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => setPageIndex((i) => Math.max(0, i - 1))} disabled={pageIndex === 0}>‹</button>
            <span className="dim">Лист {pageIndex + 1} / {pages.length}</span>
            <button onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))} disabled={pageIndex >= pages.length - 1}>›</button>
          </span>
          <span className="sep" style={{ margin: '0 4px' }} />
          <button onClick={() => setZoom((z) => Math.max(0.05, (z < 0.01 ? 1 : z) / 1.25))}>−</button>
          <button onClick={() => setZoom(1)}>100%</button>
          <button onClick={() => setZoom((z) => (z < 0.01 ? 1 : z) * 1.25)}>+</button>
          <button onClick={() => setZoom(0.001)}>По экрану</button>
          <button onClick={() => setRotation((r) => (r + 90) % 360)} title="Повернуть страницу">⟳</button>
          <span className="sep" style={{ margin: '0 4px' }} />
          <button onClick={() => printPages(doc.title, pages)}>Печать / PDF</button>
          <button onClick={() => downloadSvgPages(doc.title, pages)}>SVG</button>
          <button onClick={exportAll}>Экспорт комплекта (PDF)</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#3a3d43', padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
          <div
            onClick={() => { if (docKey === 'parts' || docKey === 'machining') { const p = doc.pages[pageIndex]; if (p?.partId) selectPart(p.partId); } }}
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
        </div>
      </div>
    </div>
  );
}

const hdr: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', margin: '0 0 8px' };
