import { today, type Publication } from '../../shared/contracts';
import { StorageConflict, type Storage } from '../storage/port';
import { activeIndication, publish, visiblePublications } from './publications';
import type { DemoStore } from './store';

// Implementación del puerto sobre las colecciones en memoria. Conserva la
// semántica del prototipo: sus operaciones críticas no tienen `await` entre la
// lectura y la escritura, así que siguen siendo atómicas dentro del proceso.
export function createMemoryStorage(state: DemoStore): Storage {
  return {
    // ── Pacientes ──────────────────────────────────────────────────────────────
    async findPatientByDni(dni) {
      return [...state.patients.values()].find(patient => patient.dni === dni);
    },
    async getPatient(id) {
      return state.patients.get(id);
    },
    async listPatients() {
      return [...state.patients.values()];
    },
    async createPatient(patient) {
      if ([...state.patients.values()].some(item => item.dni === patient.dni)) {
        throw new StorageConflict('Ya existe un paciente con ese DNI. Buscalo antes de crear otra ficha.');
      }
      state.patients.set(patient.id, patient);
      return patient;
    },
    async updatePatient(id, changes) {
      const patient = state.patients.get(id);
      if (!patient) return undefined;
      const updated = { ...patient, ...changes };
      state.patients.set(id, updated);
      return updated;
    },
    async dashboardStats() {
      return {
        patients: state.patients.size,
        consultations: [...state.consultations.values()].filter(item => !item.supersededAt).length,
        publications: state.publications.size,
      };
    },

    // ── Consultas ──────────────────────────────────────────────────────────────
    async getConsultation(id) {
      return state.consultations.get(id);
    },
    async listConsultationsByPatient(patientId) {
      return [...state.consultations.values()].filter(item => item.patientId === patientId)
        .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
    },
    async listConsultationsFinalizedIn(month) {
      return [...state.consultations.values()].filter(item =>
        !item.supersededAt && item.status === 'finalized' && item.date.slice(0, 7) === month);
    },
    async saveConsultation(consultation) {
      if (state.consultations.get(consultation.id)?.status === 'finalized') return 'finalized';
      state.consultations.set(consultation.id, consultation);
      return 'saved';
    },
    async amendConsultation(reviewedId, amendment) {
      // Una sola condición: la versión revisada sigue finalizada y vigente. La
      // anterior no se borra: conserva su texto y la fecha del reemplazo.
      const reviewed = state.consultations.get(reviewedId);
      if (!reviewed || reviewed.status !== 'finalized' || reviewed.supersededAt) return 'conflict';
      state.consultations.set(reviewed.id, { ...reviewed, supersededAt: amendment.updatedAt });
      state.consultations.set(amendment.id, amendment);
      return 'saved';
    },

    // ── Publicaciones ──────────────────────────────────────────────────────────
    async getPublication(id) {
      return state.publications.get(id);
    },
    async getActiveIndication(patientId) {
      return activeIndication(state, patientId) ?? undefined;
    },
    async listPublicationsByPatient(patientId) {
      return [...state.publications.values()].filter(item => item.patientId === patientId);
    },
    async listGeneralIndications() {
      return [...state.publications.values()].filter(item => item.scope === 'general' && item.patientId === null)
        .sort((a, b) => b.publishedAt - a.publishedAt);
    },
    async listPrescriptionsPublishedIn(month) {
      return [...state.publications.values()].filter(item =>
        item.kind === 'prescription' && today(item.publishedAt).slice(0, 7) === month);
    },
    async listVisiblePublications(patientId) {
      return visiblePublications(state, patientId);
    },
    async publish(input, patientId, expectedActiveId, at) {
      return publish(state, input, patientId, expectedActiveId, at);
    },
    async publishPrescription(input, patientId, file, at) {
      const publication: Publication = {
        ...input, id: crypto.randomUUID(), patientId, scope: 'patient', publishedAt: at, active: true,
        pdf: { sha256: file.sha256, size: file.size, origin: file.origin },
      };
      state.files.set(publication.id, file.bytes.slice());
      state.publications.set(publication.id, publication);
      return publication;
    },

    // ── Documentos internos ────────────────────────────────────────────────────
    async listDocumentsByPatient(patientId) {
      return [...state.documents.values()].filter(item => item.patientId === patientId);
    },

    // ── Archivos de recetas ────────────────────────────────────────────────────
    async getPublicationFile(publicationId) {
      return state.files.get(publicationId)?.slice();
    },
    async totalStoredBytes() {
      return [...state.files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
    },

    // ── Sesiones ───────────────────────────────────────────────────────────────
    async putSession(tokenHash, session) {
      state.sessions.set(tokenHash, session);
    },
    async getSession(tokenHash) {
      return state.sessions.get(tokenHash);
    },
    async deleteSession(tokenHash) {
      state.sessions.delete(tokenHash);
    },
    async touchSession(tokenHash, expiresAt, at) {
      const session = state.sessions.get(tokenHash);
      if (!session || session.expiresAt <= at) return false;
      session.expiresAt = expiresAt;
      return true;
    },

    // ── Acceso del paciente ────────────────────────────────────────────────────
    async reserveCodeRequest(patientId, reservedUntil, at) {
      if ((state.codeRequests.get(patientId) ?? 0) > at) return false;
      state.codeRequests.set(patientId, reservedUntil);
      return true;
    },
    async putChallenge(challenge) {
      state.challenges.set(challenge.patientId, challenge);
    },
    async getChallenge(patientId) {
      return state.challenges.get(patientId);
    },
    async consumeChallenge(patientId, challengeId, matches, maxAttempts, at) {
      const challenge = state.challenges.get(patientId);
      if (!challenge || challenge.id !== challengeId || challenge.consumed
        || challenge.expiresAt <= at || challenge.attempts >= maxAttempts) return false;
      challenge.attempts += 1;
      if (!matches) return false;
      challenge.consumed = true;
      return true;
    },

    // ── Ingreso de la médica ───────────────────────────────────────────────────
    async reserveDoctorCodeRequest(reservedUntil: number, at: number) {
      if ((state.accessLinkRequests.get('doctor') ?? 0) > at) return false;
      state.accessLinkRequests.set('doctor', reservedUntil);
      return true;
    },
    async putDoctorChallenge(challenge: any) {
      for (const [id, existing] of state.challenges) {
        if (!existing.consumed) state.challenges.set(id, { ...existing, consumed: true });
      }
      state.challenges.set(challenge.id, { ...challenge, patientId: 'doctor' });
    },
    async getDoctorChallenge() {
      for (const challenge of state.challenges.values()) {
        if (challenge.patientId === 'doctor' && !challenge.consumed && challenge.expiresAt > Date.now()) return challenge;
      }
      return undefined;
    },
    async consumeDoctorChallenge(challengeId: string, matches: boolean, maxAttempts: number, at: number) {
      for (const challenge of state.challenges.values()) {
        if (challenge.patientId === 'doctor' && challenge.id === challengeId) {
          if (challenge.consumed || challenge.expiresAt <= at || challenge.attempts >= maxAttempts) return false;
          challenge.attempts += 1;
          if (matches) { challenge.consumed = true; return true; }
          return false;
        }
      }
      return false;
    },
    async reserveDoctorIpRequest(ipHash: string, windowStart: number, _windowEnd: number, maxAttempts: number, at: number) {
      const key = `ip:${ipHash}`;
      const row = state.accessLinkRequests.get(key);
      if (!row || row < windowStart) {
        state.accessLinkRequests.set(key, at as any);
        (state as any).doctorIpCounts = (state as any).doctorIpCounts || new Map();
        (state as any).doctorIpCounts.set(key, 1);
        return true;
      }
      const counts = (state as any).doctorIpCounts || new Map();
      const count = counts.get(key) ?? 1;
      if (count >= maxAttempts) return false;
      counts.set(key, count + 1);
      (state as any).doctorIpCounts = counts;
      state.accessLinkRequests.set(key, at as any);
      return true;
    },

    // ── Auditoría ──────────────────────────────────────────────────────────────
    async appendAudit(event) {
      state.audit.push(event);
    },
  };
}
