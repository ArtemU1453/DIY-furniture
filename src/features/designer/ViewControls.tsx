export type StandardView =
  | 'perspective'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom';

const D = 3; // расстояние камеры (в метрах three)

/** Позиции камеры для стандартных видов (три-единицы). */
export const VIEW_POSITIONS: Record<StandardView, [number, number, number]> = {
  perspective: [2.4, 1.8, 2.4],
  front: [0, 0, D],
  back: [0, 0, -D],
  left: [-D, 0, 0],
  right: [D, 0, 0],
  top: [0, D, 0.001],
  bottom: [0, -D, 0.001],
};

const LABELS: Array<[StandardView, string]> = [
  ['perspective', 'Перспектива'],
  ['front', 'Спереди'],
  ['back', 'Сзади'],
  ['left', 'Слева'],
  ['right', 'Справа'],
  ['top', 'Сверху'],
  ['bottom', 'Снизу'],
];

export function ViewControls({ onSetView }: { onSetView: (view: StandardView) => void }) {
  return (
    <div className="view-toolbar">
      {LABELS.map(([view, label]) => (
        <button key={view} onClick={() => onSetView(view)} title={label}>
          {label}
        </button>
      ))}
    </div>
  );
}
