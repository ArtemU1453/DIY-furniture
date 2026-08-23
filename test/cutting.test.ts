import { describe, it, expect } from 'vitest';
import { BasicShelfEngine } from '@/engines/cutting/BasicShelfEngine';
import type { CuttingInput } from '@/engines/cutting/types';
import type { CuttingPiece } from '@/core/model/types';
import type { MaterialId, PartId } from '@/core/model/ids';

const MAT = 'mat-1' as MaterialId;

function piece(id: string, length: number, width: number): CuttingPiece {
  return {
    pieceId: id,
    partId: id as PartId,
    length,
    width,
    grain: 'none',
    allowRotate: true,
    materialId: MAT,
  };
}

function input(pieces: CuttingPiece[]): CuttingInput {
  return {
    pieces,
    stock: [{ materialId: MAT, length: 2800, width: 2070, trim: 10 }],
    kerf: 4,
    options: { respectGrain: false },
  };
}

describe('BasicShelfEngine — контракт раскроя', () => {
  const engine = new BasicShelfEngine();

  it('размещает все помещающиеся детали', () => {
    const res = engine.calculate(input([piece('a', 800, 300), piece('b', 600, 300)]));
    expect(res.unplaced).toHaveLength(0);
    const placed = res.sheets.flatMap((s) => s.placements);
    expect(placed).toHaveLength(2);
  });

  it('детали не выходят за пределы листа', () => {
    const res = engine.calculate(input([piece('a', 800, 300), piece('b', 600, 400)]));
    for (const sheet of res.sheets) {
      for (const p of sheet.placements) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + p.length).toBeLessThanOrEqual(sheet.length);
        expect(p.y + p.width).toBeLessThanOrEqual(sheet.width);
      }
    }
  });

  it('размещённые детали не пересекаются', () => {
    const pieces = Array.from({ length: 12 }, (_, i) => piece(`p${i}`, 600, 400));
    const res = engine.calculate(input(pieces));

    for (const sheet of res.sheets) {
      const rects = sheet.placements;
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const overlap =
            a.x < b.x + b.length &&
            a.x + a.length > b.x &&
            a.y < b.y + b.width &&
            a.y + a.width > b.y;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('деталь крупнее листа попадает в unplaced', () => {
    const res = engine.calculate(input([piece('huge', 5000, 300)]));
    expect(res.unplaced.map((p) => p.pieceId)).toContain('huge');
  });

  it('утилизация в диапазоне 0..1', () => {
    const res = engine.calculate(input([piece('a', 800, 300)]));
    expect(res.summary.utilization).toBeGreaterThan(0);
    expect(res.summary.utilization).toBeLessThanOrEqual(1);
  });

  it('детерминизм: одинаковый ввод → одинаковый результат', () => {
    const pieces = Array.from({ length: 8 }, (_, i) => piece(`p${i}`, 700, 350));
    const r1 = engine.calculate(input(pieces));
    const r2 = engine.calculate(input(pieces));
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
