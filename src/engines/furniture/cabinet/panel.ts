/**
 * Промежуточное представление детали корпуса — PanelSpec — и его отображение в
 * поля производственной Part (размеры/позиция/поворот).
 *
 * Правила конструкции оперируют PanelSpec в координатах корпуса
 * (X — ширина, Y — высота, Z — глубина), а перевод в 3D-ориентацию Part
 * инкапсулирован здесь. Оси толщины: 'x' — боковины/перегородки,
 * 'y' — горизонтальные (верх/низ/полки), 'z' — фронтальные (задняя стенка).
 */
import type { GrainDirection, Rotation, Vec3 } from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';
import type { PartType } from '@/i18n/partNames';

export type ThicknessAxis = 'x' | 'y' | 'z';

export interface Range {
  min: number;
  max: number;
}

export interface PanelSpec {
  /** Стабильный ключ идентичности для сопоставления при пересчёте. */
  key: string;
  partType: PartType;
  index?: number; // для полок/перегородок
  sectionId?: string;
  x: Range;
  y: Range;
  z: Range;
  thicknessAxis: ThicknessAxis;
  material: MaterialId | null;
  grain?: GrainDirection;
}

export interface PartGeometryFields {
  width: number; // длина заготовки (в плоскости раскроя)
  height: number; // ширина заготовки (в плоскости раскроя)
  thickness: number; // толщина плиты (= материал)
  position: Vec3; // центр в координатах изделия (корпус центрирован по X/Z)
  rotation: Rotation;
}

const D90 = 90;

/**
 * Перевести PanelSpec в поля Part. Корпус центрируется по X и Z (X∈[-W/2,W/2],
 * Z∈[-D/2,D/2]) и стоит на плоскости Y=0, чтобы удобно ложиться на сетку 3D.
 */
export function panelToPartFields(spec: PanelSpec, cabinet: { width: number; depth: number }): PartGeometryFields {
  const ex = spec.x.max - spec.x.min;
  const ey = spec.y.max - spec.y.min;
  const ez = spec.z.max - spec.z.min;

  const cx = (spec.x.min + spec.x.max) / 2 - cabinet.width / 2;
  const cy = (spec.y.min + spec.y.max) / 2;
  const cz = (spec.z.min + spec.z.max) / 2 - cabinet.depth / 2;
  const position: Vec3 = { x: cx, y: cy, z: cz };

  switch (spec.thicknessAxis) {
    case 'z':
      // Фронтальная плита: толщина по Z, поворот не нужен.
      return {
        width: ex,
        height: ey,
        thickness: ez,
        position,
        rotation: { x: 0, y: 0, z: 0 },
      };
    case 'x':
      // Боковина/перегородка: толщина по X. Поворот вокруг Y на 90°.
      return {
        width: ez, // глубина
        height: ey, // высота
        thickness: ex, // толщина
        position,
        rotation: { x: 0, y: D90, z: 0 },
      };
    case 'y':
    default:
      // Горизонталь (верх/низ/полка): толщина по Y. Поворот вокруг X на 90°.
      return {
        width: ex, // ширина пролёта
        height: ez, // глубина
        thickness: ey, // толщина
        position,
        rotation: { x: D90, y: 0, z: 0 },
      };
  }
}
