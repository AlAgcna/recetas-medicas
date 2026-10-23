import type { Consultation, InternalDocument, Patient, PdfMetadata, Publication, PublicationInput } from '../../shared/contracts';

// Puerto de almacenamiento.
//
// La aplicación no conoce Maps, SQL ni R2: sólo estos casos de uso. Hay dos
// implementaciones: memoria (prototipo local y pruebas) y D1 + R2 (Cloudflare).
//
// Las operaciones que en el prototipo eran "sección crítica de un proceso" se
// exponen como casos de uso completos y no como CRUD, porque en D1 la
// atomicidad se resuelve con sentencias condicionales o `db.batch()`, nunca
// leyendo y después escribiendo.

export type Role = 'doctor' | 'patient';

export type AccessSession = {
  role: Role;
  patientId?: string;
  createdAt: number;
  expiresAt: number;
};

export type AccessChallenge = {
  id: string;
  patientId: string;
  verifier: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  consumed: boolean;
};

// Enlace de ingreso de la médica. Se guarda el hash del token, nunca el token.
export type AccessLink = {
  /** SHA-256 del token en hexadecimal. */
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  /** Un enlace consumido no vuelve a servir. */
  consumed: boolean;
};

export type AuditEvent = {
  actor: Role | 'system';
  action: string;
  resource: string;
  at: number;
};

export type DashboardStats = {
  patients: number;
  consultations: number;
  publications: number;
};

export type EditablePatient = Partial<Pick<Patient, 'firstName' | 'lastName' | 'insurance' | 'memberNumber'>>;

/** Resultado de publicar: la versión nueva y la que reemplazó, si hubo. */
export type PublicationResult = { publication: Publication; replacedId: string | null };

/** El PDF original que acompaña a una receta, con los datos que se guardan. */
export type PrescriptionFile = { bytes: Uint8Array<ArrayBuffer> } & PdfMetadata;

/** Se intentó crear un registro cuyo valor único ya existe (por ejemplo, DNI). */
export class StorageConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConflict';
  }
}

export interface Storage {
  // ── Pacientes ──────────────────────────────────────────────────────────────
  findPatientByDni(dni: string): Promise<Patient | undefined>;
  getPatient(id: string): Promise<Patient | undefined>;
  listPatients(): Promise<Patient[]>;
  /** Lanza StorageConflict si ya existe un paciente con ese DNI. */
  createPatient(patient: Patient): Promise<Patient>;
  updatePatient(id: string, changes: EditablePatient): Promise<Patient | undefined>;
  dashboardStats(): Promise<DashboardStats>;

  // ── Consultas ──────────────────────────────────────────────────────────────
  getConsultation(id: string): Promise<Consultation | undefined>;
  listConsultationsByPatient(patientId: string): Promise<Consultation[]>;
  listConsultationsFinalizedIn(month: string): Promise<Consultation[]>;
  /** Crea o actualiza un borrador. Nunca sobrescribe una versión finalizada. */
  saveConsultation(consultation: Consultation): Promise<'saved' | 'finalized'>;
  /** Reemplaza la versión revisada y agrega la vigente, en una sola operación. */
  amendConsultation(reviewedId: string, amendment: Consultation): Promise<'saved' | 'conflict'>;

  // ── Publicaciones ──────────────────────────────────────────────────────────
  getPublication(id: string): Promise<Publication | undefined>;
  getActiveIndication(patientId: string | null): Promise<Publication | undefined>;
  listPublicationsByPatient(patientId: string): Promise<Publication[]>;
  listGeneralIndications(): Promise<Publication[]>;
  listPrescriptionsPublishedIn(month: string): Promise<Publication[]>;
  /** Lo que ve un paciente: general activa, su específica activa y sus recetas activas. */
  listVisiblePublications(patientId: string): Promise<Publication[]>;
  /** Devuelve null si la versión activa revisada ya no es la esperada. */
  publish(input: PublicationInput, patientId: string | null, expectedActiveId: string | null, at: number): Promise<PublicationResult | null>;
  /** Guarda el PDF original y publica la receta en una sola operación. */
  publishPrescription(input: PublicationInput, patientId: string, file: PrescriptionFile, at: number): Promise<Publication>;

  // ── Documentos internos ────────────────────────────────────────────────────
  listDocumentsByPatient(patientId: string): Promise<InternalDocument[]>;

  // ── Archivos de recetas (R2) ───────────────────────────────────────────────
  getPublicationFile(publicationId: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
  totalStoredBytes(): Promise<number>;

  // ── Sesiones ───────────────────────────────────────────────────────────────
  putSession(tokenHash: string, session: AccessSession): Promise<void>;
  getSession(tokenHash: string): Promise<AccessSession | undefined>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Extiende la sesión sólo si sigue vigente. Devuelve false si ya venció. */
  touchSession(tokenHash: string, expiresAt: number, at: number): Promise<boolean>;

  // ── Acceso del paciente ────────────────────────────────────────────────────
  /** Reserva el próximo pedido de código. Una sola operación condicional. */
  reserveCodeRequest(patientId: string, reservedUntil: number, at: number): Promise<boolean>;
  /** Instala el desafío vigente, invalidando cualquier anterior del paciente. */
  putChallenge(challenge: AccessChallenge): Promise<void>;
  getChallenge(patientId: string): Promise<AccessChallenge | undefined>;
  /**
   * Cierra una verificación de código: cuenta el intento si el desafío sigue
   * vigente y consume el código sólo si el verificador coincidió. Devuelve si
   * el acceso queda autorizado. Una sola operación condicional.
   */
  consumeChallenge(patientId: string, challengeId: string, matches: boolean, maxAttempts: number, at: number): Promise<boolean>;

  // ── Ingreso de la médica ───────────────────────────────────────────────────
  /** Reserva el próximo pedido de código por correo. Una sola operación condicional. */
  reserveDoctorCodeRequest(reservedUntil: number, at: number): Promise<boolean>;
  /** Instala el desafío vigente de la médica, invalidando cualquier anterior. */
  putDoctorChallenge(challenge: AccessChallenge): Promise<void>;
  getDoctorChallenge(): Promise<AccessChallenge | undefined>;
  /**
   * Cierra la verificación del código de la médica: cuenta el intento si sigue
   * vigente y consume el código sólo si el verificador coincidió. Devuelve si
   * el acceso queda autorizado. Una sola operación condicional.
   */
  consumeDoctorChallenge(challengeId: string, matches: boolean, maxAttempts: number, at: number): Promise<boolean>;
  /** Reserva intento por IP para el ingreso de la médica. Devuelve true si permitido. */
  reserveDoctorIpRequest(ipHash: string, windowStart: number, windowEnd: number, maxAttempts: number, at: number): Promise<boolean>;

  // ── Auditoría ──────────────────────────────────────────────────────────────
  appendAudit(event: AuditEvent): Promise<void>;
}
