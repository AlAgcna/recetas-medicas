import { z } from 'zod';

export const policy = {
  codeCooldown: 5 * 60_000,
  codeLifetime: 10 * 60_000,
  codeAttempts: 5,
  patientLifetime: 20 * 60_000,
  doctorIdle: 2 * 60 * 60_000,
  // Ingreso de la médica: un pedido de enlace por minuto y 15 minutos de validez.
  accessLinkCooldown: 60_000,
  accessLinkLifetime: 15 * 60_000,
} as const;

export const dniSchema = z.string().trim().transform(value => value.replace(/[.\s-]/g, ''))
  .pipe(z.string().regex(/^\d{7,8}$/, 'Ingresá un DNI de 7 u 8 dígitos.'));

export const patientSchema = z.object({
  dni: dniSchema,
  whatsapp: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Usá el formato internacional, por ejemplo +5493800000001.'),
  firstName: z.string().trim().max(100).default(''),
  lastName: z.string().trim().max(100).default(''),
  insurance: z.string().trim().max(150).default('Particular'),
  memberNumber: z.string().trim().max(100).default(''),
  contactVerified: z.boolean().default(false),
});

const measurement = z.number().positive('La medición debe ser mayor que cero.').max(1000).optional();
export const vitalSchema = z.object({
  systolic: measurement, diastolic: measurement, heartRate: measurement,
  respiratoryRate: measurement, temperature: measurement,
  oxygen: z.number().positive().max(100).optional(), weight: measurement, height: measurement,
});

export const consultationSchema = z.object({
  date: z.iso.date('Ingresá una fecha válida.'),
  vitals: vitalSchema,
  reason: z.string().trim().max(5000),
  examination: z.string().trim().max(10000),
  diagnosis: z.string().trim().max(5000),
  status: z.enum(['draft', 'finalized']),
}).superRefine((value, ctx) => {
  if (value.status === 'finalized') {
    for (const field of ['reason', 'examination', 'diagnosis'] as const) {
      if (!value[field]) ctx.addIssue({ code: 'custom', path: [field], message: 'Completá este campo antes de finalizar.' });
    }
  }
});

// Una enmienda corrige una consulta finalizada sin borrar la versión anterior:
// exige el motivo y siempre crea una versión nueva y vigente. Igual que al
// guardar una consulta, el servidor reconstruye el registro y descarta el resto
// de las claves que lleguen del formulario.
export const amendmentRequestSchema = consultationSchema.safeExtend({
  status: z.literal('finalized'),
  amendmentReason: z.string().trim().min(1, 'Escribí el motivo de la enmienda.').max(500),
});

export const publicationSchema = z.object({
  kind: z.enum(['indication', 'prescription']),
  title: z.string().trim().min(1, 'Escribí un título.').max(150),
  content: z.string().trim().min(1, 'Escribí las indicaciones o la descripción del ejemplo.').max(5000),
});

// Una sustitución debe confirmar la versión que la médica revisó. Null significa
// que no había una indicación activa; impide reemplazos silenciosos entre pestañas.
export const publicationRequestSchema = publicationSchema.extend({
  expectedActiveId: z.string().min(1).max(100).nullable().default(null),
}).strict();
export const generalIndicationSchema = publicationRequestSchema.extend({ kind: z.literal('indication') });
export const pdfPolicy = { maxFileBytes: 5 * 1024 * 1024, maxFormBytes: 5 * 1024 * 1024 + 32 * 1024, maxStoredBytes: 30 * 1024 * 1024 } as const;
export type PdfMetadata = { sha256: string; size: number; origin: 'uploaded' | 'example' };

export type PatientInput = z.input<typeof patientSchema>;
export type Patient = z.output<typeof patientSchema> & { id: string; createdAt: number };
export type ConsultationInput = z.infer<typeof consultationSchema>;
export type AmendmentInput = z.infer<typeof amendmentRequestSchema>;
// La corrección de una consulta finalizada se guarda como una versión nueva que
// enlaza la anterior (`supersedesId`); la reemplazada se conserva con su texto y
// `supersededAt`. La versión vigente es la que no está reemplazada.
export type Consultation = ConsultationInput & {
  id: string; patientId: string; updatedAt: number; insuranceAtVisit: string;
  supersededAt?: number; supersedesId?: string; amendmentReason?: string;
};
export type PublicationInput = z.infer<typeof publicationSchema>;
export type Publication = PublicationInput & {
  id: string; patientId: string | null; publishedAt: number;
  scope: 'general' | 'patient'; active: boolean; supersededAt?: number;
  pdf?: PdfMetadata;
};
export type PatientPublication = Pick<Publication, 'id' | 'kind' | 'title' | 'content' | 'publishedAt' | 'scope' | 'pdf'>;

// Lo único que el portal del paciente puede ver de una publicación. El resto de
// los campos (destinatario, actividad, historial) queda del lado profesional.
export function patientProjection(publication: Publication): PatientPublication {
  const { id, kind, title, content, publishedAt, scope, pdf } = publication;
  return { id, kind, title, content, publishedAt, scope, ...(pdf ? { pdf } : {}) };
}
export type GeneralIndications = { active: Publication | null; history: Publication[] };
export type InternalDocument = { id: string; patientId: string; name: string; description: string };
export type PatientDetail = {
  patient: Patient; consultations: Consultation[]; publications: Publication[]; documents: InternalDocument[];
  generalIndication: Publication | null;
};
export type SessionInfo = { expiresAt: number; role: 'doctor' | 'patient' };
export type PatientSessionInfo = SessionInfo & { patient: { firstName: string; lastName: string } };
export type MonthlyStatistics = {
  month: string;
  attendedPatients: number;
  consultations: number;
  prescriptions: number;
  insuranceBreakdown: { insurance: string; consultations: number; patients: number }[];
  leadingInsurances: string[];
  leadingInsuranceConsultations: number;
};

export const monthSchema = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/, 'Seleccioná un mes válido.');

export function today(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/La_Rioja', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

export function displayDate(value: string) {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

export function displayDni(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Las enmiendas forman una cadena: la versión reemplazada conserva su texto y la
// vigente enlaza la que corrige. Devuelve la cadena de la más antigua a la
// vigente, sin importar cuál de las versiones se consulte.
export function consultationChain(all: Consultation[], consultation: Consultation): Consultation[] {
  const byId = new Map(all.map(item => [item.id, item]));
  const seen = new Set([consultation.id]);
  let current = consultation;
  let successor = all.find(item => item.supersedesId === current.id);
  while (successor && !seen.has(successor.id)) {
    seen.add(successor.id);
    current = successor;
    successor = all.find(item => item.supersedesId === current.id);
  }
  const chain = [current];
  let previous = current.supersedesId ? byId.get(current.supersedesId) : undefined;
  while (previous && !seen.has(previous.id)) {
    seen.add(previous.id);
    chain.unshift(previous);
    previous = previous.supersedesId ? byId.get(previous.supersedesId) : undefined;
  }
  return chain;
}

export function displayMoment(value: number) {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Argentina/La_Rioja' }).format(new Date(value));
}
