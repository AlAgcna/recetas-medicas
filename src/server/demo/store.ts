import { today, type Consultation, type InternalDocument, type Patient, type Publication } from '../../shared/contracts';
import type { OutgoingEmail } from '../email/port';
import type { AccessChallenge, AccessLink, AccessSession, AuditEvent } from '../storage/port';

// Estado del almacén en memoria. Es el banco de pruebas del prototipo local:
// las pruebas de la API inicializan y consultan estas colecciones directamente.
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
    files: new Map<string, Uint8Array<ArrayBuffer>>(),
    sessions: new Map<string, AccessSession>(),
    challenges: new Map<string, AccessChallenge>(),
    codeRequests: new Map<string, number>(),
    accessLinks: new Map<string, AccessLink>(),
    accessLinkRequests: new Map<string, number>(),
    inbox: new Map<string, { code: string; expiresAt: number }>(),
    /** Correo saliente simulado: reemplaza al proveedor en el prototipo local. */
    mailbox: [] as OutgoingEmail[],
    audit: [] as AuditEvent[],
  };
}

export type DemoStore = ReturnType<typeof createStore>;
