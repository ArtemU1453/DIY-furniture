import { useEffect, useState } from 'react';

interface Props {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  /** Минимум ПРИМЕНЯЕТСЯ, а не только подсказывается браузеру. */
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}

/**
 * Числовое поле с локальным черновиком: значение применяется на blur/Enter,
 * что не мешает набирать промежуточные значения.
 */
export function NumberField({ label, value, onCommit, min, max, step = 1, suffix }: Props) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  /* Границы проверяются ЗДЕСЬ, а не только атрибутом min: браузер атрибут
   * не навязывает, и «-50» уходило в модель как размер детали (этап 36).
   * Значение вне границ не применяется, поле возвращается к прежнему. */
  const commit = () => {
    const parsed = Number(draft.replace(',', '.'));
    const valid = Number.isFinite(parsed)
      && (min == null || parsed >= min)
      && (max == null || parsed <= max);
    if (valid) onCommit(parsed);
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
        max={max}
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
