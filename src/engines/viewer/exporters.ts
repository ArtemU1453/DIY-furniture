/**
 * Экспорт геометрии сцены в STL/OBJ (текстовые форматы, без three).
 *
 * Экспорт — это выгрузка ГЕОМЕТРИИ из ProjectModel, а не замена модели.
 * Каждая деталь — ориентированный бокс (8 вершин, 12 треугольников) в мировых
 * координатах (мм). Источник геометрии — PartTransformAdapter.
 */
import type { Part } from '@/core/model/types';
import { partWorldCorners } from './transform';

// Грани бокса по индексам угловых точек (см. порядок в partWorldCorners).
const QUADS: Array<[number, number, number, number]> = [
  [0, 1, 3, 2], // -X
  [4, 6, 7, 5], // +X
  [0, 4, 5, 1], // -Y
  [2, 3, 7, 6], // +Y
  [0, 2, 6, 4], // -Z
  [1, 5, 7, 3], // +Z
];

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalize(v: V3): V3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
const f = (n: number) => (Math.abs(n) < 1e-6 ? '0' : n.toFixed(3));

/** ASCII STL всей модели (детали как ориентированные боксы, координаты в мм). */
export function partsToStl(parts: Part[], name = 'furniture'): string {
  const lines: string[] = [`solid ${name}`];
  const tri = (a: V3, b: V3, c: V3) => {
    const nrm = normalize(cross(sub(b, a), sub(c, a)));
    lines.push(`  facet normal ${f(nrm[0])} ${f(nrm[1])} ${f(nrm[2])}`);
    lines.push('    outer loop');
    lines.push(`      vertex ${f(a[0])} ${f(a[1])} ${f(a[2])}`);
    lines.push(`      vertex ${f(b[0])} ${f(b[1])} ${f(b[2])}`);
    lines.push(`      vertex ${f(c[0])} ${f(c[1])} ${f(c[2])}`);
    lines.push('    endloop');
    lines.push('  endfacet');
  };
  for (const part of parts) {
    if (part.metadata?.hidden === true) continue;
    const c = partWorldCorners(part);
    for (const [i0, i1, i2, i3] of QUADS) {
      tri(c[i0], c[i1], c[i2]);
      tri(c[i0], c[i2], c[i3]);
    }
  }
  lines.push(`endsolid ${name}`);
  return lines.join('\n');
}

/** OBJ всей модели (вершины + треугольные грани, глобальная нумерация). */
export function partsToObj(parts: Part[], name = 'furniture'): string {
  const lines: string[] = [`# ${name}`, `o ${name}`];
  let base = 0;
  for (const part of parts) {
    if (part.metadata?.hidden === true) continue;
    const c = partWorldCorners(part);
    for (const v of c) lines.push(`v ${f(v[0])} ${f(v[1])} ${f(v[2])}`);
    for (const [i0, i1, i2, i3] of QUADS) {
      lines.push(`f ${base + i0 + 1} ${base + i1 + 1} ${base + i2 + 1}`);
      lines.push(`f ${base + i0 + 1} ${base + i2 + 1} ${base + i3 + 1}`);
    }
    base += 8;
  }
  return lines.join('\n');
}
