import type { Consultation, InternalDocument, Patient, PdfMetadata, Publication } from '../../shared/contracts';
import { StorageConflict, type AccessChallenge, type AccessSession, type DashboardStats, type PublicationResult, type Storage } from '../storage/port';
import type { FileBucket, SqlDatabase, SqlResult, SqlValue } from './database';

// Implementación del puerto sobre D1 y R2.
//
// Reglas que se respetan acá y que el esquema sostiene por sí mismo:
//   * Nunca leer y después escribir: cada operación crítica es una sentencia
//     condicional (`UPDATE ... WHERE`, `... RETURNING`) o un `db.batch()`
//     (todo o nada) cuando hacen falta varias sentencias.
//   * Los códigos de acceso, tokens y secretos no llegan a la base: sólo el
//     verificador HMAC, el hash del token de sesión y datos clínicos.
//   * El PDF se guarda en R2 antes de registrar la publicación. Si el registro
//     falla, se borra el objeto para no dejar archivos huérfanos.

type Row = Record<string, unknown>;
const text = (value: unknown) => String(value ?? '');
const number = (value: unknown) => Number(value ?? 0);
const nil = (value: unknown) => value === null || value === undefined;

function toPatient(row: Row): Patient {
  return {
    id: text(row.id),
    dni: text(row.dni),
    firstName: text(row.first_name),
    lastName: text(row.last_name),
    insurance: text(row.insurance),
    memberNumber: text(row.member_number),
    whatsapp: text(row.whatsapp),
    contactVerified: number(row.contact_verified) === 1,
    createdAt: number(row.created_at),
  };
}

const vitalsColumns: [string, keyof Consultation['vitals']][] = [
  ['systolic', 'systolic'], ['diastolic', 'diastolic'], ['heart_rate', 'heartRate'], ['respiratory_rate', 'respiratoryRate'],
  ['temperature', 'temperature'], ['oxygen', 'oxygen'], ['weight', 'weight'], ['height', 'height'],
];

function toConsultation(row: Row): Consultation {
  const vitals: Consultation['vitals'] = {};
  for (const [column, key] of vitalsColumns) {
    if (!nil(row[column])) vitals[key] = number(row[column]);
  }
  return {
    id: text(row.id),
    patientId: text(row.patient_id),
    date: text(row.date),
    status: text(row.status) === 'finalized' ? 'finalized' : 'draft',
    reason: text(row.reason),
    examination: text(row.examination),
    diagnosis: text(row.diagnosis),
    vitals,
    updatedAt: number(row.updated_at),
    insuranceAtVisit: text(row.insurance_at_visit),
    ...(nil(row.superseded_at) ? {} : { supersededAt: number(row.superseded_at) }),
    ...(nil(row.supersedes_id) ? {} : { supersedesId: text(row.supersedes_id) }),
    ...(nil(row.amendment_reason) ? {} : { amendmentReason: text(row.amendment_reason) }),
  };
}

// La publicación siempre se lee con su documento, para reconstruir `pdf`.
const publicationColumns = 'p.id, p.kind, p.scope, p.patient_id, p.title, p.content, p.published_at, p.active, p.superseded_at, d.sha256 AS pdf_sha256, d.size_bytes AS pdf_size, d.provenance AS pdf_provenance';
const publicationFrom = 'FROM publications p LEFT JOIN documents d ON d.id = p.document_id';

function toPublication(row: Row): Publication {
  const pdf = nil(row.pdf_sha256) ? undefined : {
    sha256: text(row.pdf_sha256),
    size: number(row.pdf_size),
    origin: text(row.pdf_provenance) === 'example' ? 'example' : 'uploaded',
  } satisfies PdfMetadata;
  return {
    id: text(row.id),
    kind: text(row.kind) === 'prescription' ? 'prescription' : 'indication',
    title: text(row.title),
    content: text(row.content),
    patientId: nil(row.patient_id) ? null : text(row.patient_id),
    scope: text(row.scope) === 'general' ? 'general' : 'patient',
    publishedAt: number(row.published_at),
    active: number(row.active) === 1,
    ...(nil(row.superseded_at) ? {} : { supersededAt: number(row.superseded_at) }),
    ...(pdf ? { pdf } : {}),
  };
}

// La Rioja, Argentina: UTC-3 todo el año, sin horario de verano. El mes clínico
// empieza a las 03:00 UTC del día 1 y termina a la misma hora del mes siguiente.
function monthBounds(month: string) {
  const [year, index] = month.split('-').map(Number);
  return { start: Date.UTC(year, index - 1, 1, 3), end: Date.UTC(year, index, 1, 3) };
}

function changes(result: SqlResult<unknown> | undefined) {
  return Number(result?.meta?.changes ?? 0) === 1;
}

export function createD1Storage(db: SqlDatabase, bucket: FileBucket): Storage {
  return {
    // ── Pacientes ──────────────────────────────────────────────────────────────
    async findPatientByDni(dni) {
      const row = await db.prepare('SELECT * FROM patients WHERE dni = ?').bind(dni).first<Row>();
      return row ? toPatient(row) : undefined;
    },
    async getPatient(id) {
      const row = await db.prepare('SELECT * FROM patients WHERE id = ?').bind(id).first<Row>();
      return row ? toPatient(row) : undefined;
    },
    async listPatients() {
      const { results } = await db.prepare('SELECT * FROM patients ORDER BY created_at, id').all<Row>();
      return results.map(toPatient);
    },
    async createPatient(patient) {
      // Sin leer antes: la unicidad la decide la base. Si el DNI ya existe, no
      // inserta ninguna fila y la operación se informa como conflicto.
      const row = await db.prepare(`INSERT INTO patients
        (id, dni, first_name, last_name, insurance, member_number, whatsapp, contact_verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dni) DO NOTHING
        RETURNING id`).bind(
        patient.id, patient.dni, patient.firstName, patient.lastName, patient.insurance,
        patient.memberNumber, patient.whatsapp, patient.contactVerified ? 1 : 0, patient.createdAt,
      ).first<Row>();
      if (!row) throw new StorageConflict('DNI duplicado');
      return patient;
    },
    async updatePatient(id, changes) {
      // Sólo se editan los campos de la ficha; DNI y WhatsApp quedan afuera.
      const row = await db.prepare(`UPDATE patients SET
        first_name = coalesce(?, first_name), last_name = coalesce(?, last_name),
        insurance = coalesce(?, insurance), member_number = coalesce(?, member_number)
        WHERE id = ? RETURNING *`).bind(
        changes.firstName ?? null, changes.lastName ?? null, changes.insurance ?? null, changes.memberNumber ?? null, id,
      ).first<Row>();
      return row ? toPatient(row) : undefined;
    },
    async dashboardStats() {
      const row = await db.prepare(`SELECT
        (SELECT count(*) FROM patients) AS patients,
        (SELECT count(*) FROM consultations WHERE superseded_at IS NULL) AS consultations,
        (SELECT count(*) FROM publications) AS publications`).first<Row>();
      return {
        patients: number(row?.patients),
        consultations: number(row?.consultations),
        publications: number(row?.publications),
      } satisfies DashboardStats;
    },

    // ── Consultas ──────────────────────────────────────────────────────────────
    async getConsultation(id) {
      const row = await db.prepare('SELECT * FROM consultations WHERE id = ?').bind(id).first<Row>();
      return row ? toConsultation(row) : undefined;
    },
    async listConsultationsByPatient(patientId) {
      const { results } = await db.prepare('SELECT * FROM consultations WHERE patient_id = ? ORDER BY date DESC, updated_at DESC')
        .bind(patientId).all<Row>();
      return results.map(toConsultation);
    },
    async listConsultationsFinalizedIn(month) {
      const { results } = await db.prepare(`SELECT * FROM consultations
        WHERE superseded_at IS NULL AND status = 'finalized' AND substr(date, 1, 7) = ?`)
        .bind(month).all<Row>();
      return results.map(toConsultation);
    },
    async saveConsultation(consultation) {
      const vitals = consultation.vitals;
      const values: SqlValue[] = [
        consultation.id, consultation.patientId, consultation.id, consultation.date, consultation.status,
        consultation.reason, consultation.examination, consultation.diagnosis,
        vitals.systolic ?? null, vitals.diastolic ?? null, vitals.heartRate ?? null, vitals.respiratoryRate ?? null,
        vitals.temperature ?? null, vitals.oxygen ?? null, vitals.weight ?? null, vitals.height ?? null,
        consultation.insuranceAtVisit, consultation.updatedAt,
      ];
      // `WHERE status = 'draft'` impide pisar una versión finalizada aunque otra
      // solicitud la haya finalizado después de esta lectura.
      const row = await db.prepare(`INSERT INTO consultations (
        id, patient_id, chain_id, date, status, reason, examination, diagnosis,
        systolic, diastolic, heart_rate, respiratory_rate, temperature, oxygen, weight, height,
        insurance_at_visit, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          date = excluded.date, status = excluded.status, reason = excluded.reason,
          examination = excluded.examination, diagnosis = excluded.diagnosis,
          systolic = excluded.systolic, diastolic = excluded.diastolic, heart_rate = excluded.heart_rate,
          respiratory_rate = excluded.respiratory_rate, temperature = excluded.temperature, oxygen = excluded.oxygen,
          weight = excluded.weight, height = excluded.height,
          insurance_at_visit = excluded.insurance_at_visit, updated_at = excluded.updated_at
        WHERE consultations.status = 'draft'
        RETURNING id`).bind(...values).first<Row>();
      // Sin fila: la versión existente ya estaba finalizada y no se sobrescribe.
      return row ? 'saved' : 'finalized';
    },
    async amendConsultation(reviewedId, amendment) {
      const vitals = amendment.vitals;
      const at = amendment.updatedAt;
      // Todo o nada: cierra la versión revisada y agrega la vigente en el mismo
      // lote. Si la revisada ya no está vigente, las dos sentencias no tocan
      // ninguna fila y se informa el conflicto sin dejar estado parcial.
      const results = await db.batch([
        db.prepare(`UPDATE consultations SET superseded_at = ?
          WHERE id = ? AND status = 'finalized' AND superseded_at IS NULL`).bind(at, reviewedId),
        db.prepare(`INSERT INTO consultations (
          id, patient_id, chain_id, date, status, reason, examination, diagnosis,
          systolic, diastolic, heart_rate, respiratory_rate, temperature, oxygen, weight, height,
          insurance_at_visit, updated_at, supersedes_id, amendment_reason)
          SELECT ?, patient_id, chain_id, ?, 'finalized', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          FROM consultations
          WHERE id = ? AND status = 'finalized' AND superseded_at = ?
            AND NOT EXISTS (SELECT 1 FROM consultations successor WHERE successor.supersedes_id = ?)`)
          .bind(
            amendment.id, amendment.date, amendment.reason, amendment.examination, amendment.diagnosis,
            vitals.systolic ?? null, vitals.diastolic ?? null, vitals.heartRate ?? null, vitals.respiratoryRate ?? null,
            vitals.temperature ?? null, vitals.oxygen ?? null, vitals.weight ?? null, vitals.height ?? null,
            amendment.insuranceAtVisit, at, reviewedId, amendment.amendmentReason ?? null,
            reviewedId, at, reviewedId,
          ),
      ]);
      return changes(results[0]) && changes(results[1]) ? 'saved' : 'conflict';
    },

    // ── Publicaciones ──────────────────────────────────────────────────────────
    async getPublication(id) {
      const row = await db.prepare(`SELECT ${publicationColumns} ${publicationFrom} WHERE p.id = ?`).bind(id).first<Row>();
      return row ? toPublication(row) : undefined;
    },
    async getActiveIndication(patientId) {
      // La indicación de un paciente es la suya; la general es otra versión y no
      // cuenta como reemplazo. El ámbito se compara junto con el destinatario.
      const scope = patientId === null ? 'general' : 'patient';
      const row = await db.prepare(`SELECT ${publicationColumns} ${publicationFrom}
        WHERE p.active = 1 AND p.kind = 'indication' AND p.scope = ? AND p.patient_id IS ?
        LIMIT 1`).bind(scope, patientId).first<Row>();
      return row ? toPublication(row) : undefined;
    },
    async listPublicationsByPatient(patientId) {
      const { results } = await db.prepare(`SELECT ${publicationColumns} ${publicationFrom}
        WHERE p.patient_id = ? ORDER BY p.published_at, p.id`).bind(patientId).all<Row>();
      return results.map(toPublication);
    },
    async listGeneralIndications() {
      const { results } = await db.prepare(`SELECT ${publicationColumns} ${publicationFrom}
        WHERE p.scope = 'general' AND p.patient_id IS NULL ORDER BY p.published_at DESC`).all<Row>();
      return results.map(toPublication);
    },
    async listPrescriptionsPublishedIn(month) {
      const { start, end } = monthBounds(month);
      const { results } = await db.prepare(`SELECT ${publicationColumns} ${publicationFrom}
        WHERE p.kind = 'prescription' AND p.published_at >= ? AND p.published_at < ?`)
        .bind(start, end).all<Row>();
      return results.map(toPublication);
    },
    async listVisiblePublications(patientId) {
      // Sólo lo activo y propio: la general, la específica del paciente y sus
      // recetas. Las versiones reemplazadas no se listan ni se descargan.
      const { results } = await db.prepare(`SELECT ${publicationColumns} ${publicationFrom}
        WHERE p.active = 1 AND (p.scope = 'general' OR (p.scope = 'patient' AND p.patient_id = ?))
        ORDER BY CASE p.scope WHEN 'general' THEN 0 ELSE 1 END,
          CASE p.kind WHEN 'indication' THEN 0 ELSE 1 END, p.published_at`).bind(patientId).all<Row>();
      return results.map(toPublication);
    },
    async publish(input, patientId, expectedActiveId, at) {
      const id = crypto.randomUUID();
      const scope = patientId === null ? 'general' : 'patient';
      // La versión nueva primero queda inactiva (así no choca con el índice de
      // "una sola activa"), se cierra la revisada esperada y recién entonces se
      // activa. Si la versión revisada cambió, ninguna sentencia toca filas.
      const results = await db.batch([
        db.prepare(`INSERT INTO publications (id, kind, scope, patient_id, title, content, published_at, active)
        SELECT ?, 'indication', ?, ?, ?, ?, ?, 0
          WHERE (SELECT current.id FROM publications current
                   WHERE current.active = 1 AND current.kind = 'indication'
                     AND current.scope = ? AND current.patient_id IS ?) IS ?
          -- Una sola indicación activa por ámbito: el índice parcial lo sostiene.`)
          .bind(id, scope, patientId, input.title, input.content, at, scope, patientId, expectedActiveId),
        db.prepare('UPDATE publications SET active = 0, superseded_at = ? WHERE id = ? AND active = 1')
          .bind(at, expectedActiveId),
        db.prepare('UPDATE publications SET active = 1 WHERE id = ?').bind(id),
      ]);
      if (!changes(results[0]) || !changes(results[2])) return null;
      const publication: Publication = { ...input, id, patientId, scope, publishedAt: at, active: true };
      return { publication, replacedId: changes(results[1]) ? expectedActiveId : null } satisfies PublicationResult;
    },
    async publishPrescription(input, patientId, file, at) {
      const documentId = crypto.randomUUID();
      const publicationId = crypto.randomUUID();
      const key = `patients/${patientId}/${documentId}.pdf`;
      // Primero el archivo, después el registro. Un objeto sin registro es
      // basura eliminable; un registro sin archivo sería una receta rota.
      await bucket.put(key, file.bytes);
      try {
        await db.batch([
          db.prepare(`INSERT INTO documents
            (id, patient_id, kind, name, description, mime_type, size_bytes, sha256, r2_key, provenance, created_at)
            VALUES (?, ?, 'prescription_pdf', ?, ?, 'application/pdf', ?, ?, ?, ?, ?)`).bind(
            documentId, patientId, input.title, input.content, file.size, file.sha256, key, file.origin, at),
          db.prepare(`INSERT INTO publications
            (id, kind, scope, patient_id, title, content, published_at, active, document_id)
            VALUES (?, 'prescription', 'patient', ?, ?, ?, ?, 1, ?)`).bind(
            publicationId, patientId, input.title, input.content, at, documentId),
        ]);
      } catch (error) {
        await bucket.delete(key).catch(() => undefined);
        throw error;
      }
      return {
        ...input, id: publicationId, patientId, scope: 'patient', publishedAt: at, active: true,
        pdf: { sha256: file.sha256, size: file.size, origin: file.origin },
      };
    },

    // ── Documentos internos ────────────────────────────────────────────────────
    async listDocumentsByPatient(patientId) {
      const { results } = await db.prepare(`SELECT id, patient_id, name, description FROM documents
        WHERE patient_id = ? AND kind = 'internal' ORDER BY created_at DESC`).bind(patientId).all<Row>();
      return results.map(row => ({
        id: text(row.id), patientId: text(row.patient_id), name: text(row.name), description: text(row.description),
      })) satisfies InternalDocument[];
    },

    // ── Archivos de recetas (R2) ───────────────────────────────────────────────
    async getPublicationFile(publicationId) {
      const row = await db.prepare(`SELECT d.r2_key AS key FROM publications p
        JOIN documents d ON d.id = p.document_id WHERE p.id = ?`).bind(publicationId).first<Row>();
      const key = row?.key;
      if (typeof key !== 'string') return undefined;
      const object = await bucket.get(key);
      return object ? new Uint8Array(await object.arrayBuffer()) : undefined;
    },
    async totalStoredBytes() {
      const row = await db.prepare('SELECT coalesce(sum(size_bytes), 0) AS total FROM documents WHERE r2_key IS NOT NULL').first<Row>();
      return number(row?.total);
    },

    // ── Sesiones ───────────────────────────────────────────────────────────────
    async putSession(tokenHash, session) {
      await db.prepare('INSERT INTO sessions (token_hash, role, patient_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(tokenHash, session.role, session.patientId ?? null, session.createdAt, session.expiresAt).run();
    },
    async getSession(tokenHash) {
      const row = await db.prepare('SELECT * FROM sessions WHERE token_hash = ?').bind(tokenHash).first<Row>();
      if (!row) return undefined;
      return {
        role: text(row.role) === 'patient' ? 'patient' : 'doctor',
        patientId: nil(row.patient_id) ? undefined : text(row.patient_id),
        createdAt: number(row.created_at),
        expiresAt: number(row.expires_at),
      } satisfies AccessSession;
    },
    async deleteSession(tokenHash) {
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    },
    async touchSession(tokenHash, expiresAt, at) {
      const result = await db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ? AND expires_at > ?')
        .bind(expiresAt, tokenHash, at).run();
      return Number(result.meta.changes) === 1;
    },

    // ── Acceso del paciente ────────────────────────────────────────────────────
    async reserveCodeRequest(patientId, reservedUntil, at) {
      // Una sola sentencia: si el cooldown sigue vigente, la condición del
      // upsert no se cumple y no se modifica ni se devuelve fila.
      const row = await db.prepare(`INSERT INTO code_request_control (patient_id, next_request_at)
        VALUES (?, ?)
        ON CONFLICT(patient_id) DO UPDATE SET next_request_at = excluded.next_request_at
        WHERE code_request_control.next_request_at <= ?
        RETURNING next_request_at`).bind(patientId, reservedUntil, at).first<Row>();
      return row !== null;
    },
    async putChallenge(challenge) {
      // Un desafío nuevo invalida el anterior: se cierra el activo y se inserta
      // el nuevo en el mismo lote, para no chocar con el índice único parcial.
      await db.batch([
        db.prepare('DELETE FROM access_challenges WHERE patient_id = ? AND consumed_at IS NULL').bind(challenge.patientId),
        db.prepare(`INSERT INTO access_challenges (id, patient_id, verifier, created_at, expires_at, attempts, consumed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
          challenge.id, challenge.patientId, challenge.verifier, challenge.createdAt, challenge.expiresAt,
          challenge.attempts, challenge.consumed ? challenge.createdAt : null),
      ]);
    },
    async getChallenge(patientId) {
      const row = await db.prepare(`SELECT * FROM access_challenges
        WHERE patient_id = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`).bind(patientId).first<Row>();
      if (!row) return undefined;
      return {
        id: text(row.id), patientId: text(row.patient_id), verifier: text(row.verifier),
        createdAt: number(row.created_at), expiresAt: number(row.expires_at), attempts: number(row.attempts), consumed: false,
      } satisfies AccessChallenge;
    },
    async consumeChallenge(patientId, challengeId, matches, maxAttempts, at) {
      // Cuenta el intento y, si el código coincide, cierra el desafío en la
      // misma sentencia condicional. Vencido, consumido o agotado: sin cambios.
      const result = matches
        ? await db.prepare(`UPDATE access_challenges SET attempts = attempts + 1, consumed_at = ?
            WHERE id = ? AND patient_id = ? AND consumed_at IS NULL AND attempts < ? AND expires_at > ?`)
          .bind(at, challengeId, patientId, maxAttempts, at).run()
        : await db.prepare(`UPDATE access_challenges SET attempts = attempts + 1
            WHERE id = ? AND patient_id = ? AND consumed_at IS NULL AND attempts < ? AND expires_at > ?`)
          .bind(challengeId, patientId, maxAttempts, at).run();
      return matches && Number(result.meta.changes) === 1;
    },

    // ── Ingreso de la médica ───────────────────────────────────────────────────
    async reserveAccessLinkRequest(reservedUntil, at) {
      // Una sola sentencia: si el cooldown sigue vigente, la condición del
      // upsert no se cumple y no se modifica ni se devuelve fila.
      const row = await db.prepare(`INSERT INTO access_link_control (scope, next_request_at)
        VALUES ('doctor', ?)
        ON CONFLICT(scope) DO UPDATE SET next_request_at = excluded.next_request_at
        WHERE access_link_control.next_request_at <= ?
        RETURNING next_request_at`).bind(reservedUntil, at).first<Row>();
      return row !== null;
    },
    async putAccessLink(link) {
      // Un enlace nuevo invalida el anterior: se cierra el vigente y se inserta
      // el nuevo en el mismo lote, para no chocar con el índice único parcial.
      await db.batch([
        db.prepare(`DELETE FROM access_links WHERE scope = 'doctor' AND consumed_at IS NULL`),
        db.prepare(`INSERT INTO access_links (token_hash, scope, created_at, expires_at)
          VALUES (?, 'doctor', ?, ?)`).bind(link.tokenHash, link.createdAt, link.expiresAt),
      ]);
    },
    async consumeAccessLink(tokenHash, at) {
      // Vencido o ya usado: sin cambios. Dos pedidos simultáneos con el mismo
      // enlace no pueden consumirlo dos veces.
      const result = await db.prepare(`UPDATE access_links SET consumed_at = ?
        WHERE token_hash = ? AND scope = 'doctor' AND consumed_at IS NULL AND expires_at > ?`)
        .bind(at, tokenHash, at).run();
      return Number(result.meta.changes) === 1;
    },

    // ── Auditoría ──────────────────────────────────────────────────────────────
    async appendAudit(event) {
      await db.prepare('INSERT INTO audit_events (actor, action, resource, at) VALUES (?, ?, ?, ?)')
        .bind(event.actor, event.action, event.resource, event.at).run();
    },
  };
}
