import { today, type MonthlyStatistics } from '../../shared/contracts';
import { insuranceKey, insuranceLabel, isNamedInsurance } from '../../shared/insurance';
import type { DemoStore } from './store';

export function monthlyStatistics(store: DemoStore, month: string): MonthlyStatistics {
  const consultations = [...store.consultations.values()].filter(consultation =>
    !consultation.supersededAt && consultation.status === 'finalized' && consultation.date.slice(0, 7) === month);
  const groups = new Map<string, { insurance: string; consultations: number; patients: Set<string> }>();

  for (const consultation of consultations) {
    // La cobertura del registro finalizado no cambia al editar la ficha actual.
    // Nunca completar estadísticas históricas silenciosamente con cobertura actual.
    const insurance = insuranceLabel(consultation.insuranceAtVisit ?? '');
    const key = insuranceKey(insurance);
    const group = groups.get(key) ?? { insurance, consultations: 0, patients: new Set<string>() };
    group.consultations += 1;
    group.patients.add(consultation.patientId);
    groups.set(key, group);
  }

  const insuranceBreakdown = [...groups.values()]
    .map(group => ({ insurance: group.insurance, consultations: group.consultations, patients: group.patients.size }))
    .sort((a, b) => b.consultations - a.consultations || a.insurance.localeCompare(b.insurance, 'es'));
  const namedInsurances = insuranceBreakdown.filter(row => isNamedInsurance(row.insurance));
  const leadingInsuranceConsultations = namedInsurances[0]?.consultations ?? 0;

  return {
    month,
    attendedPatients: new Set(consultations.map(consultation => consultation.patientId)).size,
    consultations: consultations.length,
    // Se cuentan PDF publicados, no recetas emitidas en una plataforma externa.
    prescriptions: [...store.publications.values()].filter(publication =>
      publication.kind === 'prescription' && today(publication.publishedAt).slice(0, 7) === month).length,
    insuranceBreakdown,
    leadingInsurances: namedInsurances.filter(row => row.consultations === leadingInsuranceConsultations).map(row => row.insurance),
    leadingInsuranceConsultations,
  };
}
