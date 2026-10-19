import { today, type Consultation, type InternalDocument, type Patient, type Publication } from '../../shared/contracts';
import type { StoredPdf } from './prescription-pdf';

export type DemoSession = {
  role: 'doctor' | 'patient'; patientId?: string; expiresAt: number;
};
export type Challenge = {
  id: string; patientId: string; verifier: string; expiresAt: number; attempts: number; consumed: boolean;
};

export function createStore(now: number) {
  const ana: Patient = {
    id: 'patient-ana-demo', dni: '00000001', firstName: 'Ana', lastName: 'Ejemplo',
    whatsapp: '+5493800000001', contactVerified: true, insurance: 'APOS',
    memberNumber: 'DEMO-0001', createdAt: now,
  };
  const luis: Patient = {
    ...ana, id: 'patient-luis-demo', dni: '00000002', firstName: 'Luis', lastName: 'Demostración',
    whatsapp: '+5493800000002', insurance: 'Sin obra social', memberNumber: '',
  };
  return {
    patients: new Map<string, Patient>([[ana.id, ana], [luis.id, luis]]),
    consultations: new Map<string, Consultation>([['consultation-demo', {
      id: 'consultation-demo', patientId: ana.id, date: today(now), status: 'finalized', vitals: {}, insuranceAtVisit: ana.insurance,
      reason: 'Consulta ficticia para conocer la pantalla.',
      examination: 'Registro de ejemplo. No contiene información de una persona real.',
      diagnosis: 'Ejemplo de registro, sin validez clínica.', updatedAt: now,
    }]]),
    publications: new Map<string, Publication>([['publication-ana-demo', {
      id: 'publication-ana-demo', patientId: ana.id, scope: 'patient', active: true, kind: 'indication', title: 'Indicaciones de ejemplo',
      content: 'Este documento permite probar el portal. No es una indicación médica ni corresponde a un paciente real.', publishedAt: now,
    }], ['publication-luis-demo', {
      id: 'publication-luis-demo', patientId: luis.id, scope: 'patient', active: true, kind: 'prescription', title: 'PDF de demostración',
      content: 'Documento ficticio. No es una receta válida.', publishedAt: now,
    }]]),
    documents: new Map<string, InternalDocument>([['word-demo', {
      id: 'word-demo', patientId: ana.id, name: 'Antecedentes de ejemplo.docx',
      description: 'Referencia visual de un Word histórico. No hay un archivo real cargado.',
    }]]),
    prescriptionFiles: new Map<string, StoredPdf>(),
    sessions: new Map<string, DemoSession>(),
    challenges: new Map<string, Challenge>(),
    nextRequestAt: new Map<string, number>(),
    inbox: new Map<string, { code: string; expiresAt: number }>(),
    rateLimits: new Map<string, { count: number; expiresAt: number }>(),
    audit: [] as { action: string; resource: string; at: number }[],
  };
}

export type DemoStore = ReturnType<typeof createStore>;
