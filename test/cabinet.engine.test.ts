import { describe, it, expect } from 'vitest';
import {
  buildCabinet,
  defaultCabinetParameters,
  rebuildCabinet,
  validateCabinetGeometry,
  validateCabinetParameters,
} from '@/engines/furniture/cabinet';
import type { CabinetParameters } from '@/engines/furniture/cabinet';

const base = (over: Partial<CabinetParameters> = {}): CabinetParameters => ({
  ...defaultCabinetParameters(),
  shelves: 0,
  dividers: 0,
  ...over,
});

function planeLength(p: { width: number; height: number }) {
  return Math.max(p.width, p.height);
}
function planeWidth(p: { width: number; height: number }) {
  return Math.min(p.width, p.height);
}
const byType = (parts: ReturnType<typeof buildCabinet>['parts'], t: string) =>
  parts.filter((p) => p.metadata?.partType === t);

describe('CabinetEngine — генерация деталей', () => {
  it('Тест 1: шкаф 800×2000×600/16 с 3 полками → 8 деталей', () => {
    const { parts } = buildCabinet(base({ shelves: 3, back: 'inset' }));
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
    const { parts } = buildCabinet(base());
    const side = byType(parts, 'side_left')[0];
    expect(planeLength(side)).toBe(2000);
    expect(planeWidth(side)).toBe(600);
    expect(side.thickness).toBe(16);
  });

  it('верх «между боковинами»: длина = W − 2T = 768', () => {
    const { parts } = buildCabinet(base());
    const top = byType(parts, 'top')[0];
    expect(planeLength(top)).toBe(768);
    expect(planeWidth(top)).toBe(600);
  });

  it('Тест 2: ширина 800→1000 меняет длину верха/низа (968), боковины неизменны', () => {
    const a = buildCabinet(base()).parts;
    const b = buildCabinet(base({ width: 1000 })).parts;
    expect(planeLength(byType(b, 'top')[0])).toBe(968);
    expect(planeLength(byType(b, 'bottom')[0])).toBe(968);
    // боковина не зависит от ширины
    expect(planeLength(byType(a, 'side_left')[0])).toBe(planeLength(byType(b, 'side_left')[0]));
  });

  it('Тест 3: высота 2000→2200 удлиняет боковины', () => {
    const b = buildCabinet(base({ height: 2200 })).parts;
    expect(planeLength(byType(b, 'side_left')[0])).toBe(2200);
  });

  it('Тест 4: +3 полки добавляют 3 детали', () => {
    const zero = buildCabinet(base({ shelves: 0 })).parts.length;
    const three = buildCabinet(base({ shelves: 3 })).parts.length;
    expect(three - zero).toBe(3);
  });

  it('Тест 6: толщина 16→18 меняет зависимые размеры (верх = 764)', () => {
    const b = buildCabinet(base({ thickness: 18 })).parts;
    expect(planeLength(byType(b, 'top')[0])).toBe(800 - 2 * 18);
    expect(byType(b, 'side_left')[0].thickness).toBe(18);
  });

  it('схема «верх поверх боковин» укорачивает боковины и уширяет верх', () => {
    const b = buildCabinet(base({ top: 'overlay' })).parts;
    expect(planeLength(byType(b, 'side_left')[0])).toBe(2000 - 16); // H − T
    expect(planeLength(byType(b, 'top')[0])).toBe(800); // на всю ширину
  });

  it('задняя стенка — реальная деталь со своей толщиной', () => {
    const b = buildCabinet(base({ back: 'inset' })).parts;
    const back = byType(b, 'back')[0];
    expect(back).toBeDefined();
    expect(back.thickness).toBe(3);
  });

  it('back=none убирает заднюю стенку', () => {
    const b = buildCabinet(base({ back: 'none' })).parts;
    expect(byType(b, 'back')).toHaveLength(0);
  });

  it('каждая деталь имеет id, номер Pxxx и материал корпуса', () => {
    const { parts } = buildCabinet(base({ shelves: 2 }));
    for (const p of parts) {
      expect(p.id).toBeTruthy();
      expect(String(p.metadata?.number)).toMatch(/^P\d{3}$/);
    }
    expect(byType(parts, 'side_left')[0].material).toBe(base().material);
  });
});

describe('CabinetEngine — секции и перегородки', () => {
  it('Тест 5: 1 перегородка → 2 секции, деталь-перегородка присутствует', () => {
    const { parts, sections } = buildCabinet(base({ dividers: 1 }));
    expect(sections).toHaveLength(2);
    expect(byType(parts, 'divider')).toHaveLength(1);
  });

  it('ширина секций учитывает толщину перегородки', () => {
    const { sections } = buildCabinet(base({ width: 800, dividers: 1 }));
    // (800 − 2*16 − 1*16) / 2 = 376
    expect(sections[0].width).toBeCloseTo(376, 3);
    expect(sections[1].width).toBeCloseTo(376, 3);
  });

  it('полки распределяются по каждой секции', () => {
    const { parts } = buildCabinet(base({ dividers: 1, shelves: 2 }));
    expect(byType(parts, 'shelf')).toHaveLength(4); // 2 секции × 2 полки
  });
});

describe('FurnitureValidator', () => {
  it('корректная геометрия шкафа не содержит пересечений', () => {
    const params = base({ shelves: 3, dividers: 1 });
    const { parts } = buildCabinet(params);
    const issues = validateCabinetGeometry(parts, params);
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
    const first = buildCabinet(base({ shelves: 2 })).parts;
    const rebuilt = rebuildCabinet(first, base({ shelves: 2, width: 1000 })).parts;

    const sideBefore = first.find((p) => p.metadata?.key === 'side_left')!;
    const sideAfter = rebuilt.find((p) => p.metadata?.key === 'side_left')!;
    expect(sideAfter.id).toBe(sideBefore.id);
    expect(sideAfter.metadata?.number).toBe(sideBefore.metadata?.number);
    // но размер верха пересчитан
    const topAfter = rebuilt.find((p) => p.metadata?.key === 'top')!;
    expect(Math.max(topAfter.width, topAfter.height)).toBe(968);
  });

  it('сохранённая кромка переживает пересчёт', () => {
    const first = buildCabinet(base()).parts;
    const withEdge = first.map((p) =>
      p.metadata?.key === 'side_left' ? { ...p, edges: { ...p.edges, left: 'edge-x' as never } } : p,
    );
    const rebuilt = rebuildCabinet(withEdge, base({ width: 900 })).parts;
    const side = rebuilt.find((p) => p.metadata?.key === 'side_left')!;
    expect(side.edges.left).toBe('edge-x');
  });
});
