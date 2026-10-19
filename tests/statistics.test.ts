import { describe, expect, it } from 'vitest';
import { monthlyStatistics } from '../src/server/statistics';
import { createStore } from '../src/server/demo/store';
import type { Consultation, Publication } from '../src/shared/contracts';

const monthly = (store: ReturnType<typeof createStore>, month: string) =>
  monthlyStatistics([...store.consultations.values()], [...store.publications.values()], month);

function fixture() {
  const store = createStore(Date.parse('2026-10-17T15:00:00Z'));
  store.consultations.clear(); store.publications.clear();
  function consultation(id: string, patientId: string, date: string, insuranceAtVisit: string, status: Consultation['status'] = 'finalized') {
    store.consultations.set(id, { id, patientId, date, insuranceAtVisit, status, vitals: {}, reason: 'Ejemplo', examination: 'Ejemplo', diagnosis: 'Ejemplo', updatedAt: Date.parse('2026-10-17T15:00:00Z') });
  }
  function publication(id: string, kind: Publication['kind'], publishedAt: string) {
    store.publications.set(id, { id, kind, patientId: 'patient-ana-demo', scope: 'patient', active: true, title: 'Ejemplo', content: 'Ejemplo', publishedAt: Date.parse(publishedAt) });
  }
  return { store, consultation, publication };
}

describe('cálculo mensual de actividad', () => {
  it('no confunde fichas registradas con pacientes efectivamente atendidos', () => {
    const { store } = fixture();
    expect(store.patients.size).toBe(2);
    expect(monthly(store, '2026-10')).toEqual({ month: '2026-10', attendedPatients: 0, consultations: 0, prescriptions: 0, insuranceBreakdown: [], leadingInsurances: [], leadingInsuranceConsultations: 0 });
  });

  it('cuenta pacientes únicos, visitas repetidas y únicamente consultas finalizadas del mes', () => {
    const { store, consultation } = fixture();
    consultation('first', 'patient-ana-demo', '2026-10-01', 'APOS');
    consultation('second', 'patient-ana-demo', '2026-10-31', 'APOS');
    consultation('draft', 'patient-luis-demo', '2026-10-12', 'PAMI', 'draft');
    consultation('previous', 'patient-luis-demo', '2026-09-30', 'PAMI');
    consultation('next', 'patient-luis-demo', '2026-11-01', 'PAMI');
    const statistics = monthly(store, '2026-10');
    expect(statistics.attendedPatients).toBe(1);
    expect(statistics.consultations).toBe(2);
    expect(statistics.insuranceBreakdown).toEqual([{ insurance: 'APOS', consultations: 2, patients: 1 }]);
  });

  it('no cambia las coberturas históricas al editar la ficha y agrupa variantes del catálogo', () => {
    const { store, consultation } = fixture();
    consultation('first', 'patient-ana-demo', '2026-10-01', ' APOS ');
    consultation('second', 'patient-ana-demo', '2026-10-10', 'apos');
    store.patients.get('patient-ana-demo')!.insurance = 'PAMI';
    expect(monthly(store, '2026-10').insuranceBreakdown).toEqual([{ insurance: 'APOS', consultations: 2, patients: 1 }]);
  });

  it('no cuenta dos veces una consulta corregida con una enmienda', () => {
    const { store, consultation } = fixture();
    consultation('original', 'patient-ana-demo', '2026-10-01', 'APOS');
    consultation('correction', 'patient-ana-demo', '2026-10-01', 'APOS');
    store.consultations.set('original', { ...store.consultations.get('original')!, supersededAt: 1 });
    store.consultations.set('correction', { ...store.consultations.get('correction')!, supersedesId: 'original', amendmentReason: 'Se corrigió la fecha' });
    const statistics = monthly(store, '2026-10');
    expect(statistics.consultations).toBe(1);
    expect(statistics.attendedPatients).toBe(1);
    expect(statistics.insuranceBreakdown).toEqual([{ insurance: 'APOS', consultations: 1, patients: 1 }]);
  });

  it('muestra empates y no presenta Particular o Sin registrar como una obra social líder', () => {
    const { store, consultation } = fixture();
    consultation('apos', 'patient-ana-demo', '2026-10-01', 'APOS');
    consultation('pami', 'patient-luis-demo', '2026-10-01', 'PAMI');
    consultation('private-one', 'patient-luis-demo', '2026-10-02', 'Sin obra social');
    consultation('private-two', 'patient-luis-demo', '2026-10-03', 'Sin obra social');
    consultation('unknown', 'patient-ana-demo', '2026-10-04', '');
    const statistics = monthly(store, '2026-10');
    expect(statistics.leadingInsurances).toEqual(['APOS', 'PAMI']);
    expect(statistics.leadingInsuranceConsultations).toBe(1);
    expect(statistics.insuranceBreakdown[0]).toEqual({ insurance: 'Particular', consultations: 2, patients: 1 });
    expect(statistics.insuranceBreakdown).toContainEqual({ insurance: 'Sin registrar', consultations: 1, patients: 1 });
    expect(statistics.attendedPatients).toBe(2);
  });

  it('no inventa una obra social líder si solo hay atenciones particulares', () => {
    const { store, consultation } = fixture();
    consultation('private', 'patient-ana-demo', '2026-10-01', 'Sin obra social');
    const statistics = monthly(store, '2026-10');
    expect(statistics.consultations).toBe(1);
    expect(statistics.leadingInsurances).toEqual([]);
    expect(statistics.leadingInsuranceConsultations).toBe(0);
  });

  it('cuenta únicamente PDF de receta por fecha local de publicación, incluso en el cambio de mes', () => {
    const { store, publication } = fixture();
    publication('october-last', 'prescription', '2026-11-01T02:59:59Z');
    publication('november-first', 'prescription', '2026-11-01T03:00:00Z');
    publication('indication', 'indication', '2026-10-17T15:00:00Z');
    publication('september', 'prescription', '2026-09-30T15:00:00Z');
    expect(monthly(store, '2026-10').prescriptions).toBe(1);
    expect(monthly(store, '2026-11').prescriptions).toBe(1);
    expect(monthly(store, '2026-10').attendedPatients).toBe(0);
  });
});
