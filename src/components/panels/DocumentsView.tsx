import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import {
  buildAllDocuments,
  buildDocument,
  documentToSvgPages,
  DOCUMENT_LIST,
  isDocumentsOutdated,
} from '@/engines/drawing';
import { downloadSvgPages, printPages } from '@/features/documents/print';

export function DocumentsView() {
  const project = useEditorStore((s) => s.project);
  const markGenerated = useEditorStore((s) => s.markDocumentsGenerated);
  const selectPart = useEditorStore((s) => s.selectPart);

  const [docKey, setDocKey] = useState('assembly');
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);

  const outdated = useMemo(() => isDocumentsOutdated(project), [project]);
  const doc = useMemo(() => buildDocument(project, docKey), [project, docKey]);
  const pages = useMemo(() => documentToSvgPages(doc), [doc]);
  const page = pages[Math.min(pageIndex, pages.length - 1)] ?? '';

  const chooseDoc = (key: string) => { setDocKey(key); setPageIndex(0); };

  const exportAll = () => {
    const all = buildAllDocuments(project);
    const allPages = all.flatMap((d) => documentToSvgPages(d));
    printPages(`${project.name} — комплект`, allPages);
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Список документов */}
      <aside style={{ width: 220, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 10 }}>
        <h3 style={hdr}>Документы</h3>
        <ul className="nav-list">
          {DOCUMENT_LIST.map((d) => (
            <li key={d.key} className={d.key === docKey ? 'active' : ''} onClick={() => chooseDoc(d.key)}>
              {d.title}
            </li>
          ))}
        </ul>
        <div className="panel-section" style={{ padding: 0, marginTop: 12, borderBottom: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="dim">Статус</span>
            <span style={{ color: outdated ? '#e6c060' : 'var(--ok)' }}>{outdated ? 'OUTDATED' : 'CURRENT'}</span>
          </div>
          {outdated && <div className="issue warning" style={{ marginBottom: 6 }}>Документ требует обновления.</div>}
          <button style={{ width: '100%' }} onClick={markGenerated}>Обновить документы</button>
        </div>
      </aside>

      {/* Предпросмотр */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <strong>{doc.title}</strong>
          {pages.length > 1 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => setPageIndex((i) => Math.max(0, i - 1))} disabled={pageIndex === 0}>‹</button>
              <span className="dim">Лист {pageIndex + 1} / {pages.length}</span>
              <button onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))} disabled={pageIndex >= pages.length - 1}>›</button>
            </span>
          )}
          <span className="sep" style={{ margin: '0 4px' }} />
          <button onClick={() => setZoom((z) => z / 1.25)}>−</button>
          <button onClick={() => setZoom(1)}>100%</button>
          <button onClick={() => setZoom((z) => z * 1.25)}>+</button>
          <button onClick={() => setZoom(0.001)}>По экрану</button>
          <span className="sep" style={{ margin: '0 4px' }} />
          <button onClick={() => printPages(doc.title, pages)}>Печать / PDF</button>
          <button onClick={() => downloadSvgPages(doc.title, pages)}>SVG</button>
          <button onClick={exportAll}>Экспорт комплекта</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#3a3d43', padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
          <div
            onClick={() => { if (docKey === 'parts' || docKey === 'machining') { const p = doc.pages[pageIndex]; if (p.partId) selectPart(p.partId); } }}
            style={{
              width: zoom < 0.01 ? '100%' : `${zoom * 100}%`,
              maxWidth: zoom < 0.01 ? '100%' : 'none',
              background: '#fff',
              boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
            }}
            dangerouslySetInnerHTML={{ __html: page }}
          />
        </div>
      </div>
    </div>
  );
}

const hdr: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', margin: '0 0 8px' };
