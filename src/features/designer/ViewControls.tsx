import { VIEW_LABELS, VIEW_PRESETS, type StandardView } from '@/engines/viewer';

export type { StandardView };

/** Позиции камеры для стандартных видов (единая таблица из engines/viewer). */
export const VIEW_POSITIONS: Record<StandardView | 'perspective', [number, number, number]> = {
  ...VIEW_PRESETS,
  perspective: VIEW_PRESETS.isometric,
};

export function ViewControls({ onSetView }: { onSetView: (view: StandardView) => void }) {
  return (
    <div className="view-toolbar">
      {VIEW_LABELS.map(([view, label]) => (
        <button key={view} onClick={() => onSetView(view)} title={label}>
          {label}
        </button>
      ))}
    </div>
  );
}
