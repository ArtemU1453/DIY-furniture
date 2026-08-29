import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: Props) {
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);

  /* Esc закрывает окно наравне с ✕ и щелчком по фону: человек, открывший
   * диалог случайно, не должен искать глазами крестик. Обработчик висит на
   * документе, потому что фокус может быть в любом поле внутри окна. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Фокус переходит внутрь окна, иначе клавиатура продолжает управлять фоном.
  useEffect(() => {
    const focusable = bodyRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        className="modal-root"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          minWidth: 360,
          maxWidth: 520,
          maxHeight: '80vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 14px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <strong id={titleId}>{title}</strong>
          <button onClick={onClose} aria-label="Закрыть окно">✕</button>
        </div>
        <div ref={bodyRef} style={{ padding: 14 }}>{children}</div>
      </div>
    </div>
  );
}
