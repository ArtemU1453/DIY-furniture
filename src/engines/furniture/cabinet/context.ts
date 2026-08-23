/**
 * Вычислимый контекст корпуса: производные размеры, диапазоны и секции.
 * Правила конструкции читают контекст, а не пересчитывают геометрию заново.
 */
import type { Section } from '@/core/model/types';
import type { CabinetParameters } from './parameters';
import type { Range } from './panel';

export interface CabinetContext {
  params: CabinetParameters;
  t: number; // толщина корпуса
  /** Вертикальный диапазон боковин (зависит от схем верха/низа). */
  sideY: Range;
  /** Внутреннее пространство между боковинами и между верхом/низом. */
  interior: { x: Range; y: Range };
  /** Диапазон глубины полок. */
  shelfZ: Range;
  /** Передняя граница задней стенки — предел глубины внутренних деталей. */
  interiorDepthMax: number;
  sections: Section[];
}

export function computeCabinetContext(params: CabinetParameters): CabinetContext {
  const { width: W, height: H, depth: D, thickness: t, dividers, construction } = params;

  const sideY: Range = {
    min: params.bottom === 'under' ? t : 0,
    max: params.top === 'overlay' ? H - t : H,
  };

  const interior = {
    x: { min: t, max: W - t },
    y: { min: t, max: H - t },
  };
  const interiorHeight = interior.y.max - interior.y.min;

  // Задняя стенка вкладная/в паз занимает глубину у заднего торца — внутренние
  // детали (полки, перегородки) не должны в неё заходить.
  const backReserve =
    params.back === 'inset' || params.back === 'groove'
      ? construction.backThickness + construction.backOffset
      : 0;
  const interiorDepthMax = Math.max(1, D - backReserve);

  const shelfZ: Range = {
    min: 0,
    max: Math.max(1, Math.min(D - construction.shelfDepthReduction, interiorDepthMax)),
  };

  // Секции: n перегородок делят внутреннюю ширину на n+1 секций.
  const innerWidth = interior.x.max - interior.x.min;
  const sectionWidth = (innerWidth - dividers * t) / (dividers + 1);
  const sections: Section[] = [];
  let cursor = interior.x.min;
  for (let i = 0; i <= dividers; i++) {
    sections.push({
      id: `sec_${i}`,
      index: i,
      x: cursor,
      width: sectionWidth,
      y: interior.y.min,
      height: interiorHeight,
      z: 0,
      depth: D,
    });
    cursor += sectionWidth + t; // пропускаем толщину перегородки
  }

  return { params, t, sideY, interior, shelfZ, interiorDepthMax, sections };
}
