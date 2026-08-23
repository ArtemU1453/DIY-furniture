import { useEffect, useState } from 'react';

interface Props {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}

/** Текстовое поле с применением значения на blur/Enter. */
export function TextField({ label, value, onCommit }: Props) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
