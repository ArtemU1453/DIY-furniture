import { useEffect, useState } from 'react';

interface Props {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  step?: number;
  suffix?: string;
}

/**
 * Числовое поле с локальным черновиком: значение применяется на blur/Enter,
 * что не мешает набирать промежуточные значения.
 */
export function NumberField({ label, value, onCommit, min, step = 1, suffix }: Props) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft.replace(',', '.'));
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(String(value));
  };

  return (
    <div className="field">
      <label>
        {label}
        {suffix ? `, ${suffix}` : ''}
      </label>
      <input
        type="number"
        value={draft}
        min={min}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
