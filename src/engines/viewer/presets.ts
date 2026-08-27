/**
 * Пресеты камеры (стандартные виды) и визуальные материалы 3D.
 * Только визуальные данные — производственная модель не затрагивается.
 */
export type StandardView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric';

const D = 3; // расстояние камеры (единицы three)

/** Позиции камеры для стандартных видов. */
export const VIEW_PRESETS: Record<StandardView, [number, number, number]> = {
  front: [0, 0, D],
  back: [0, 0, -D],
  left: [-D, 0, 0],
  right: [D, 0, 0],
  top: [0, D, 0.001],
  bottom: [0, -D, 0.001],
  isometric: [2.4, 1.8, 2.4],
};

export const VIEW_LABELS: Array<[StandardView, string]> = [
  ['front', 'Спереди'],
  ['back', 'Сзади'],
  ['left', 'Слева'],
  ['right', 'Справа'],
  ['top', 'Сверху'],
  ['bottom', 'Снизу'],
  ['isometric', 'Изометрия'],
];

/** Быстрый выбор вида по горячей клавише 1..6, 0. */
export const VIEW_HOTKEYS: Record<string, StandardView> = {
  '1': 'front', '2': 'back', '3': 'left', '4': 'right', '5': 'top', '6': 'bottom', '0': 'isometric',
};

// ── Визуальные материалы (библиотека) ────────────────────────────────────────
export interface MaterialPreset {
  id: string;
  name: string;
  color: string;
  roughness: number;
  metalness: number;
  opacity?: number;
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'white', name: 'Белый', color: '#f2f0ec', roughness: 0.8, metalness: 0.02 },
  { id: 'oak', name: 'Дуб', color: '#c9a97a', roughness: 0.7, metalness: 0.03 },
  { id: 'walnut', name: 'Орех', color: '#6b4a2f', roughness: 0.65, metalness: 0.04 },
  { id: 'grey', name: 'Серый', color: '#8b8f96', roughness: 0.75, metalness: 0.05 },
  { id: 'black', name: 'Чёрный', color: '#2a2c30', roughness: 0.6, metalness: 0.08 },
  { id: 'glass', name: 'Стекло', color: '#bfe0e6', roughness: 0.1, metalness: 0.1, opacity: 0.4 },
];

export function getMaterialPreset(id: string | undefined): MaterialPreset | undefined {
  return MATERIAL_PRESETS.find((m) => m.id === id);
}
