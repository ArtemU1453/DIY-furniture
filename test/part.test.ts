import { describe, it, expect } from 'vitest';
import { createPart } from '@/core/model/factory';
import { partBoxGeometry, partFaceArea } from '@/core/geometry/partGeometry';
import { validatePart, isValidDimension } from '@/core/validation';

describe('Part — создание и геометрия', () => {
  it('createPart назначает стабильный уникальный id', () => {
    const a = createPart();
    const b = createPart();
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it('создаёт деталь с заданными размерами', () => {
    const part = createPart({ name: 'Полка', width: 800, height: 300, thickness: 16 });
    expect(part.name).toBe('Полка');
    expect(part.width).toBe(800);
    expect(part.height).toBe(300);
    expect(part.thickness).toBe(16);
    expect(part.quantity).toBe(1);
  });

  it('преобразование размеров детали в геометрию (мм → размеры бокса)', () => {
    const part = createPart({ width: 800, height: 300, thickness: 16 });
    const geom = partBoxGeometry(part);
    expect(geom.size).toEqual({ x: 800, y: 300, z: 16 });
  });

  it('изменение ширины детали меняет геометрию', () => {
    const part = createPart({ width: 800, height: 300, thickness: 16 });
    const changed = { ...part, width: 900 };
    expect(partBoxGeometry(changed).size.x).toBe(900);
  });

  it('площадь пласти считается верно', () => {
    const part = createPart({ width: 800, height: 300, thickness: 16 });
    expect(partFaceArea(part)).toBe(240000);
  });
});

describe('Part — валидация', () => {
  it('корректная деталь не даёт ошибок', () => {
    const part = createPart({ width: 800, height: 300, thickness: 16 });
    expect(validatePart(part)).toHaveLength(0);
  });

  it('отрицательные и нулевые размеры дают ошибки', () => {
    const bad = createPart({ width: -100, height: 0, thickness: -16 });
    const issues = validatePart(bad);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('part.width.nonPositive');
    expect(codes).toContain('part.height.nonPositive');
    expect(codes).toContain('part.thickness.nonPositive');
  });

  it('isValidDimension отклоняет некорректные значения', () => {
    expect(isValidDimension(100)).toBe(true);
    expect(isValidDimension(0)).toBe(false);
    expect(isValidDimension(-5)).toBe(false);
    expect(isValidDimension(NaN)).toBe(false);
  });
});
