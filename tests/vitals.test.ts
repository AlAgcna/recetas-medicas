import { describe, expect, it } from 'vitest';
import { bodyMassIndex, consultationSchema, vitalSchema } from '../src/shared/contracts';

describe('signos vitales: perímetro abdominal e IMC', () => {
  it('acepta el perímetro en centímetros y rechaza valores fuera de rango', () => {
    expect(vitalSchema.safeParse({ abdominalPerimeter: 98.5 }).success).toBe(true);
    expect(vitalSchema.safeParse({}).success).toBe(true);
    expect(vitalSchema.safeParse({ abdominalPerimeter: 0 }).success).toBe(false);
    expect(vitalSchema.safeParse({ abdominalPerimeter: 301 }).success).toBe(false);
  });

  it('calcula el IMC sólo con peso y talla válidos', () => {
    expect(bodyMassIndex({ weight: 70, height: 170 })).toBe(24.2);
    expect(bodyMassIndex({ weight: 82.4, height: 168 })).toBe(29.2);
    expect(bodyMassIndex({ weight: 70 })).toBeUndefined();
    expect(bodyMassIndex({ height: 170 })).toBeUndefined();
    expect(bodyMassIndex({ weight: 70, height: 0 })).toBeUndefined();
  });

  it('la consulta guarda el perímetro sin exigir el IMC', () => {
    const parsed = consultationSchema.safeParse({
      date: '2026-11-02', vitals: { weight: 70, height: 170, abdominalPerimeter: 92 },
      reason: 'Control', examination: 'Sin hallazgos', diagnosis: 'Sano', status: 'finalized',
    });
    expect(parsed.success).toBe(true);
  });
});
