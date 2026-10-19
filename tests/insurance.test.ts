import { describe, expect, it } from 'vitest';
import { insuranceKey, insuranceLabel, insuranceOptions, isNamedInsurance } from '../src/shared/insurance';

describe('catálogo de coberturas del consultorio', () => {
  it('incluye exactamente las coberturas solicitadas, sin perder nombres ni unir opciones', () => {
    const requested = ['Osde', 'Swiss Medical', 'Federada Salud', 'Sancor Salud', 'Osunlar', 'Apos', 'OSPJN', 'OSSEG', 'Osuthgra', 'Pami', 'Policia Federal', 'Dasuten', 'Ossacra', 'Sanatorio Pasteur', 'Particular', 'Boreal', 'Nobis', 'Medicus Fuerzas de Seguridad', 'Mutual de Luz y Fuerza', 'Galeno', 'Jerarquico Salud', 'Osfatun', 'OSSBA', 'Prevencion Salud'];
    expect(insuranceOptions.map(insuranceKey)).toEqual(requested.map(insuranceKey));
    expect(new Set(insuranceOptions.map(insuranceKey)).size).toBe(requested.length);
  });

  it('admite búsquedas sin distinguir mayúsculas, espacios y tildes', () => {
    expect(insuranceKey('  POLICÍA   Federal ')).toBe(insuranceKey('policia federal'));
    expect(insuranceLabel('prevencion salud')).toBe('Prevención Salud');
    expect(insuranceLabel('osunlar')).toBe('OSUNLaR');
  });

  it('conserva coberturas anteriores y agrupa Sin obra social como Particular', () => {
    expect(insuranceLabel('Cobertura histórica de ejemplo')).toBe('Cobertura histórica de ejemplo');
    expect(insuranceLabel('Sin obra social')).toBe('Particular');
    expect(isNamedInsurance('Particular')).toBe(false);
    expect(isNamedInsurance('Sin obra social')).toBe(false);
    expect(isNamedInsurance('Sin registrar')).toBe(false);
    expect(isNamedInsurance('APOS')).toBe(true);
  });
});
