import { describe, it, expect } from 'vitest';
import { toMm, fromMm, convert, round } from '@/core/units';

describe('core/units', () => {
  it('mm → mm без изменений', () => {
    expect(toMm(100, 'mm')).toBe(100);
  });

  it('cm → mm', () => {
    expect(toMm(1, 'cm')).toBe(10);
    expect(toMm(15, 'cm')).toBe(150);
  });

  it('m → mm', () => {
    expect(toMm(1, 'm')).toBe(1000);
    expect(toMm(2.5, 'm')).toBe(2500);
  });

  it('дюймы → мм', () => {
    expect(toMm(1, 'in')).toBeCloseTo(25.4, 5);
  });

  it('mm → cm/m обратно', () => {
    expect(fromMm(150, 'cm')).toBe(15);
    expect(fromMm(2500, 'm')).toBe(2.5);
  });

  it('convert между единицами через базу', () => {
    expect(convert(1, 'm', 'cm')).toBe(100);
    expect(convert(100, 'cm', 'm')).toBe(1);
  });

  it('round округляет корректно', () => {
    expect(round(16.4)).toBe(16);
    expect(round(16.5)).toBe(17);
    expect(round(16.44, 1)).toBe(16.4);
  });
});
