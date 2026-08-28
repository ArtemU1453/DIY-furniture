/**
 * Конструкция корпуса — через ЕДИНЫЙ генератор (этап 35).
 *
 * Раньше эти проверки шли через отдельный движок furniture/cabinet. Он удалён:
 * детали строит параметрический движок, а CabinetParameters остались способом
 * задать те же параметры. Сами гарантии конструкции не изменились.
 */
import { describe, it, expect } from 'vitest';
import {
  defaultCabinetParameters,
  validateCabinetGeometry,
  validateCabinetParameters,
} from '@/engines/furniture/cabinet';
import type { CabinetParameters } from '@/engines/furniture/cabinet';
import type { Part } from '@/core/model/types';
import { fromCabinetParameters, generateParts, modelSections } from '@/engines/parametric';

const base = (over: Partial<CabinetParameters> = {}): CabinetParameters => ({
  ...defaultCabinetParameters(),
  shelves: 0,
  dividers: 0,
  ...over,
});

/** Собрать детали шкафа единым генератором. */
const build = (params: CabinetParameters, existing: Part[] = []): Part[] =>
  generateParts(fromCabinetParameters(params), existing).parts;

const sectionsOf = (params: CabinetParameters) => modelSections(fromCabinetParameters(params));

function planeLength(p: { width: number; height: number }) {
  return Math.max(p.width, p.height);
}
function planeWidth(p: { width: number; height: number }) {
  return Math.min(p.width, p.height);
}
const byType = (parts: Part[], t: string) => parts.filter((p) => p.metadata?.partType === t);
const keyed = (parts: Part[], t: string) => parts.find((p) => p.metadata?.partType === t)!;

describe('Генерация деталей корпуса', () => {
  it('Тест 1: шкаф 800×2000×600/16 с 3 полками → 8 деталей', () => {
    const parts = build(base({ shelves: 3, back: 'inset' }));
    // 2 боковины + верх + низ + 3 полки + задняя стенка
    expect(parts).toHaveLength(8);
    expect(byType(parts, 'side_left')).toHaveLength(1);
    expect(byType(parts, 'side_right')).toHaveLength(1);
    expect(byType(parts, 'top')).toHaveLength(1);
    expect(byType(parts, 'bottom')).toHaveLength(1);
    expect(byType(parts, 'shelf')).toHaveLength(3);
    expect(byType(parts, 'back')).toHaveLength(1);
  });

  it('боковина: длина = высота, ширина = глубина, толщина = 16', () => {
    const side = keyed(build(base()), 'side_left');
    expect(planeLength(side)).toBe(2000);
    expect(planeWidth(side)).toBe(600);
    expect(side.thickness).toBe(16);
  });

  it('верх «между боковинами»: длина = W − 2T = 768', () => {
    const top = keyed(build(base()), 'top');
    expect(planeLength(top)).toBe(768);
    expect(planeWidth(top)).toBe(600);
  });

  it('Тест 2: ширина 800→1000 меняет длину верха/низа (968), боковины неизменны', () => {
    const a = build(base());
    const b = build(base({ width: 1000 }));
    expect(planeLength(keyed(b, 'top'))).toBe(968);
    expect(planeLength(keyed(b, 'bottom'))).toBe(968);
    // боковина не зависит от ширины
    expect(planeLength(keyed(a, 'side_left'))).toBe(planeLength(keyed(b, 'side_left')));
  });

  it('Тест 3: высота 2000→2200 удлиняет боковины', () => {
    expect(planeLength(keyed(build(base({ height: 2200 })), 'side_left'))).toBe(2200);
  });

  it('Тест 4: +3 полки добавляют 3 детали', () => {
    const zero = build(base({ shelves: 0 })).length;
    const three = build(base({ shelves: 3 })).length;
    expect(three - zero).toBe(3);
  });

  it('Тест 6: толщина 16→18 меняет зависимые размеры (верх = 764)', () => {
    const b = build(base({ thickness: 18 }));
    expect(planeLength(keyed(b, 'top'))).toBe(800 - 2 * 18);
    expect(keyed(b, 'side_left').thickness).toBe(18);
  });

  it('схема «поверх боковин» укорачивает боковины и уширяет верх', () => {
    const b = build(base({ top: 'overlay' }));
    // В единой модели крышка И дно ложатся поверх боковин: H − 2T.
    expect(planeLength(keyed(b, 'side_left'))).toBe(2000 - 2 * 16);
    expect(planeLength(keyed(b, 'top'))).toBe(800); // на всю ширину
  });

  it('задняя стенка — реальная деталь со своей толщиной', () => {
    const back = keyed(build(base({ back: 'inset' })), 'back');
    expect(back).toBeDefined();
    expect(back.thickness).toBe(3);
  });

  it('back=none убирает заднюю стенку', () => {
    expect(byType(build(base({ back: 'none' })), 'back')).toHaveLength(0);
  });

  it('каждая деталь имеет id, номер Pxxx и материал корпуса', () => {
    const parts = build(base({ shelves: 2 }));
    for (const p of parts) {
      expect(p.id).toBeTruthy();
      expect(String(p.metadata?.number)).toMatch(/^P\d{3}$/);
    }
    expect(keyed(parts, 'side_left').material).toBe(base().material);
  });

  it('полка-щит (boardOnly) строится тем же генератором: одна деталь', () => {
    const parts = build(base({ boardOnly: true, width: 800, height: 18, depth: 250, thickness: 18 }));
    expect(parts).toHaveLength(1);
    expect(parts[0].metadata?.partType).toBe('board');
    expect(planeLength(parts[0])).toBe(800);
    expect(parts[0].thickness).toBe(18);
  });
});

describe('Секции и перегородки', () => {
  it('Тест 5: 1 перегородка → 2 секции, деталь-перегородка присутствует', () => {
    const params = base({ dividers: 1 });
    expect(sectionsOf(params)).toHaveLength(2);
    expect(byType(build(params), 'divider')).toHaveLength(1);
  });

  it('ширина секций учитывает толщину перегородки', () => {
    const sections = sectionsOf(base({ width: 800, dividers: 1 }));
    // (800 − 2*16 − 1*16) / 2 = 376
    expect(sections[0].width).toBeCloseTo(376, 3);
    expect(sections[1].width).toBeCloseTo(376, 3);
  });

  it('полки распределяются по каждой секции', () => {
    expect(byType(build(base({ dividers: 1, shelves: 2 })), 'shelf')).toHaveLength(4);
  });
});

describe('FurnitureValidator', () => {
  it('корректная геометрия шкафа не содержит пересечений', () => {
    const params = base({ shelves: 3, dividers: 1 });
    const issues = validateCabinetGeometry(build(params), params);
    expect(issues.filter((i) => i.code === 'geometry.intersection')).toHaveLength(0);
    expect(issues.filter((i) => i.code === 'geometry.outOfBounds')).toHaveLength(0);
  });

  it('отрицательные/нулевые размеры дают ошибки', () => {
    const issues = validateCabinetParameters(base({ width: -100, height: 0 }));
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('слишком много перегородок для ширины → ошибка', () => {
    const issues = validateCabinetParameters(base({ width: 100, dividers: 10 }));
    expect(issues.some((i) => i.code === 'param.tooManyDividers')).toBe(true);
  });
});

describe('Пересчёт со стабильными идентификаторами', () => {
  it('id и номер детали сохраняются при изменении ширины', () => {
    const first = build(base({ shelves: 2 }));
    const rebuilt = build(base({ shelves: 2, width: 1000 }), first);

    const sideBefore = keyed(first, 'side_left');
    const sideAfter = keyed(rebuilt, 'side_left');
    expect(sideAfter.id).toBe(sideBefore.id);
    expect(sideAfter.metadata?.number).toBe(sideBefore.metadata?.number);
    // но размер верха пересчитан
    expect(planeLength(keyed(rebuilt, 'top'))).toBe(968);
  });

  it('сохранённая кромка переживает пересчёт', () => {
    const first = build(base());
    const withEdge = first.map((p) =>
      p.metadata?.partType === 'side_left' ? { ...p, edges: { ...p.edges, left: 'edge-x' as never } } : p,
    );
    const side = keyed(build(base({ width: 900 }), withEdge), 'side_left');
    expect(side.edges.left).toBe('edge-x');
  });
});
