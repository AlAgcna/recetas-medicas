import { describe, expect, it } from 'vitest';
import { policy, type Consultation, type Patient } from '../src/shared/contracts';
import { examplePdf } from '../src/server/demo/pdf';
import { sha256 } from '../src/server/prescription-pdf';
import { StorageConflict } from '../src/server/storage/port';
import { d1Storage } from './helpers/sqlite-d1';

// El adaptador D1 se prueba contra SQLite real con las migraciones revisadas.
// Son las mismas reglas que aplica el prototipo en memoria, pero sostenidas por
// sentencias condicionales y por `batch` en lugar de una sección crítica local.

const AT = Date.parse('2026-10-17T12:00:00Z');

function patient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 'patient-ana', dni: '00000001', firstName: 'Ana', lastName: 'Ejemplo',
    whatsapp: '+5493800000001', contactVerified: true, insurance: 'APOS', memberNumber: 'D-1',
    createdAt: AT, ...overrides,
  };
}

async function seed() {
  const harness = d1Storage();
  await harness.storage.createPatient(patient());
  await harness.storage.createPatient(patient({ id: 'patient-luis', dni: '00000002', firstName: 'Luis', insurance: 'Sin obra social' }));
  return harness;
}

function consultation(overrides: Partial<Consultation> = {}): Consultation {
  return {
    id: 'consulta-1', patientId: 'patient-ana', date: '2026-10-17', status: 'draft',
    reason: 'Motivo de ejemplo', examination: 'Examen de ejemplo', diagnosis: 'Diagnóstico de ejemplo',
    vitals: { systolic: 120, diastolic: 80 }, updatedAt: AT, insuranceAtVisit: 'APOS', ...overrides,
  };
}

async function prescriptionFile() {
  const bytes = new TextEncoder().encode(examplePdf());
  return { bytes, sha256: await sha256(bytes), size: bytes.length, origin: 'example' as const };
}

describe('adaptador D1: pacientes', () => {
  it('crea fichas y rechaza el DNI repetido sin leer antes', async () => {
    const { storage } = await seed();
    await expect(storage.createPatient(patient({ id: 'otra-ficha' }))).rejects.toBeInstanceOf(StorageConflict);
    expect((await storage.findPatientByDni('00000001'))?.id).toBe('patient-ana');
    expect(await storage.listPatients()).toHaveLength(2);
    expect(await storage.findPatientByDni('99999999')).toBeUndefined();
  });

  it('edita sólo la ficha y conserva DNI, WhatsApp y creación', async () => {
    const { storage } = await seed();
    const updated = await storage.updatePatient('patient-ana', { firstName: 'Ana María', memberNumber: '' });
    expect(updated).toMatchObject({ firstName: 'Ana María', insurance: 'APOS', dni: '00000001', whatsapp: '+5493800000001', memberNumber: '' });
    expect(await storage.updatePatient('no-existe', { firstName: 'Nadie' })).toBeUndefined();
  });
});

describe('adaptador D1: consultas y enmiendas', () => {
  it('guarda el borrador, lo finaliza y no deja pisar la versión finalizada', async () => {
    const { storage } = await seed();
    expect(await storage.saveConsultation(consultation())).toBe('saved');
    expect(await storage.saveConsultation(consultation({ diagnosis: 'Ajustado' }))).toBe('saved');
    expect((await storage.getConsultation('consulta-1'))?.diagnosis).toBe('Ajustado');
    expect(await storage.saveConsultation(consultation({ status: 'finalized', updatedAt: AT + 1 }))).toBe('saved');
    // Sin `WHERE status = 'draft'` esto sobrescribiría una versión cerrada.
    expect(await storage.saveConsultation(consultation({ status: 'finalized', diagnosis: 'Pisado', updatedAt: AT + 2 }))).toBe('finalized');
    expect((await storage.getConsultation('consulta-1'))?.diagnosis).toBe('Diagnóstico de ejemplo');
  });

  it('la enmienda conserva la versión anterior y no se repite ni se bifurca', async () => {
    const { storage } = await seed();
    await storage.saveConsultation(consultation({ status: 'finalized' }));
    const amendment = consultation({
      id: 'consulta-2', status: 'finalized', updatedAt: AT + 10,
      supersedesId: 'consulta-1', amendmentReason: 'Corrijo el diagnóstico', diagnosis: 'Corregido',
    });
    expect(await storage.amendConsultation('consulta-1', amendment)).toBe('saved');
    const reviewed = await storage.getConsultation('consulta-1');
    expect(reviewed).toMatchObject({ diagnosis: 'Diagnóstico de ejemplo', supersededAt: AT + 10 });
    expect(await storage.getConsultation('consulta-2')).toMatchObject({ diagnosis: 'Corregido', amendmentReason: 'Corrijo el diagnóstico' });
    // La versión ya reemplazada no se corrige otra vez.
    expect(await storage.amendConsultation('consulta-1', { ...amendment, id: 'consulta-3' })).toBe('conflict');
    // Sólo hay una vigente en la cadena.
    expect(await storage.listConsultationsByPatient('patient-ana')).toHaveLength(2);
    expect((await storage.listConsultationsFinalizedIn('2026-10')).map(item => item.id)).toEqual(['consulta-2']);
  });

  it('no enmienda borradores ni consultas de otra ficha', async () => {
    const { storage } = await seed();
    await storage.saveConsultation(consultation());
    const amendment = consultation({ id: 'consulta-2', status: 'finalized', updatedAt: AT + 1, supersedesId: 'consulta-1', amendmentReason: 'Motivo' });
    expect(await storage.amendConsultation('consulta-1', amendment)).toBe('conflict');
    expect(await storage.amendConsultation('inexistente', amendment)).toBe('conflict');
  });

  it('las estadísticas mensuales ignoran las versiones reemplazadas', async () => {
    const { storage } = await seed();
    await storage.saveConsultation(consultation({ status: 'finalized', date: '2026-10-17' }));
    await storage.saveConsultation(consultation({ id: 'consulta-2', patientId: 'patient-luis', status: 'finalized', date: '2026-10-18', insuranceAtVisit: 'Sin obra social' }));
    expect(await storage.listConsultationsFinalizedIn('2026-10')).toHaveLength(2);
    expect(await storage.listConsultationsFinalizedIn('2026-11')).toHaveLength(0);
    expect(await storage.dashboardStats()).toEqual({ patients: 2, consultations: 2, publications: 0 });
  });
});

describe('adaptador D1: publicaciones', () => {
  it('reemplaza la indicación general sólo si se confirma la versión revisada', async () => {
    const { storage } = await seed();
    const first = await storage.publish({ kind: 'indication', title: 'General 1', content: 'Texto' }, null, null, AT);
    expect(first?.replacedId).toBeNull();
    expect((await storage.listGeneralIndications()).filter(item => item.active)).toHaveLength(1);
    const second = await storage.publish({ kind: 'indication', title: 'General 2', content: 'Texto' }, null, first!.publication.id, AT + 1);
    expect(second?.replacedId).toBe(first!.publication.id);
    expect((await storage.getPublication(first!.publication.id))).toMatchObject({ active: false, supersededAt: AT + 1 });
    expect((await storage.getActiveIndication(null))?.id).toBe(second!.publication.id);
    // La versión revisada ya no es la activa: no hay reemplazo silencioso.
    expect(await storage.publish({ kind: 'indication', title: 'General 3', content: 'Texto' }, null, first!.publication.id, AT + 2)).toBeNull();
    expect(await storage.listGeneralIndications()).toHaveLength(2);
  });

  it('mantiene una sola indicación específica por paciente y separa ámbitos', async () => {
    const { storage } = await seed();
    const general = await storage.publish({ kind: 'indication', title: 'General', content: 'Texto' }, null, null, AT);
    const ana = await storage.publish({ kind: 'indication', title: 'Para Ana', content: 'Texto' }, 'patient-ana', null, AT + 1);
    const luis = await storage.publish({ kind: 'indication', title: 'Para Luis', content: 'Texto' }, 'patient-luis', null, AT + 2);
    const reemplazo = await storage.publish({ kind: 'indication', title: 'Para Ana 2', content: 'Texto' }, 'patient-ana', ana!.publication.id, AT + 3);
    expect(reemplazo?.replacedId).toBe(ana!.publication.id);
    expect(await storage.getActiveIndication('patient-ana')).toMatchObject({ title: 'Para Ana 2' });
    expect((await storage.getActiveIndication(null))?.id).toBe(general!.publication.id);
    // La general no aparece como específica y cada paciente ve lo suyo.
    expect((await storage.listVisiblePublications('patient-ana')).map(item => item.id)).toEqual([general!.publication.id, reemplazo!.publication.id]);
    expect((await storage.listVisiblePublications('patient-luis')).map(item => item.id)).toEqual([general!.publication.id, luis!.publication.id]);
  });
});

describe('adaptador D1: recetas y archivos (R2)', () => {
  it('guarda el PDF, cuenta los bytes y lo entrega sólo a su paciente', async () => {
    const { storage, bucket } = await seed();
    const file = await prescriptionFile();
    const publication = await storage.publishPrescription({ kind: 'prescription', title: 'Receta', content: 'Ejemplo' }, 'patient-ana', file, AT);
    expect(publication.pdf).toEqual({ sha256: file.sha256, size: file.size, origin: 'example' });
    expect(await storage.getPublicationFile(publication.id)).toEqual(file.bytes);
    expect(await storage.totalStoredBytes()).toBe(file.size);
    expect(bucket.objects.size).toBe(1);
    expect((await storage.listVisiblePublications('patient-ana')).map(item => item.id)).toContain(publication.id);
    expect((await storage.listVisiblePublications('patient-luis')).map(item => item.id)).not.toContain(publication.id);
    // La ficha interna no mezcla las recetas con los documentos históricos.
    expect(await storage.listDocumentsByPatient('patient-ana')).toHaveLength(0);
  });

  it('no deja el archivo huérfano si el registro falla', async () => {
    const { storage, bucket } = await seed();
    const file = await prescriptionFile();
    await expect(storage.publishPrescription({ kind: 'prescription', title: 'Receta', content: 'Ejemplo' }, 'patient-inexistente', file, AT)).rejects.toThrow();
    expect(bucket.objects.size).toBe(0);
    expect(await storage.totalStoredBytes()).toBe(0);
  });

  it('cuenta las recetas por mes en hora argentina', async () => {
    const { storage } = await seed();
    const file = await prescriptionFile();
    // 31/10 23:59 y 01/11 00:00 en La Rioja: el límite es la medianoche local.
    const october = await storage.publishPrescription({ kind: 'prescription', title: 'Octubre', content: 'Ejemplo' }, 'patient-ana', file, Date.parse('2026-11-01T02:59:00Z'));
    await storage.publishPrescription({ kind: 'prescription', title: 'Noviembre', content: 'Ejemplo' }, 'patient-ana', file, Date.parse('2026-11-01T03:00:00Z'));
    expect((await storage.listPrescriptionsPublishedIn('2026-10')).map(item => item.id)).toEqual([october.id]);
    expect((await storage.listPrescriptionsPublishedIn('2026-11')).map(item => item.title)).toEqual(['Noviembre']);
  });

  it('lista los documentos internos cargados aparte del archivo', async () => {
    const { storage, database } = await seed();
    database.exec(`INSERT INTO documents (id, patient_id, kind, name, description, created_at)
      VALUES ('doc-1', 'patient-ana', 'internal', 'Antecedentes de ejemplo.docx', 'Referencia', 1)`);
    expect(await storage.listDocumentsByPatient('patient-ana')).toEqual([
      { id: 'doc-1', patientId: 'patient-ana', name: 'Antecedentes de ejemplo.docx', description: 'Referencia' },
    ]);
    expect(await storage.listDocumentsByPatient('patient-luis')).toHaveLength(0);
  });
});

describe('adaptador D1: sesiones y acceso', () => {
  it('guarda la sesión por hash, la extiende sólo si sigue vigente y la revoca', async () => {
    const { storage } = await seed();
    await storage.putSession('hash-ana', { role: 'patient', patientId: 'patient-ana', createdAt: AT, expiresAt: AT + 1_000 });
    await storage.putSession('hash-doctor', { role: 'doctor', createdAt: AT, expiresAt: AT + 1_000 });
    expect(await storage.getSession('hash-ana')).toEqual({ role: 'patient', patientId: 'patient-ana', createdAt: AT, expiresAt: AT + 1_000 });
    expect((await storage.getSession('hash-doctor'))?.patientId).toBeUndefined();
    expect(await storage.touchSession('hash-ana', AT + 2_000, AT + 500)).toBe(true);
    expect((await storage.getSession('hash-ana'))?.expiresAt).toBe(AT + 2_000);
    // Vencida: no revive con actividad posterior.
    expect(await storage.touchSession('hash-ana', AT + 3_000, AT + 2_000)).toBe(false);
    await storage.deleteSession('hash-ana');
    expect(await storage.getSession('hash-ana')).toBeUndefined();
  });

  it('reserva el pedido de código y respeta el cooldown', async () => {
    const { storage } = await seed();
    expect(await storage.reserveCodeRequest('patient-ana', AT + policy.codeCooldown, AT)).toBe(true);
    expect(await storage.reserveCodeRequest('patient-ana', AT + policy.codeCooldown, AT + 1)).toBe(false);
    expect(await storage.reserveCodeRequest('patient-ana', AT + 2 * policy.codeCooldown, AT + policy.codeCooldown)).toBe(true);
  });

  it('reserva el pedido de código de la médica, invalida el anterior y lo consume una sola vez', async () => {
    const { storage } = await seed();
    expect(await storage.reserveDoctorCodeRequest(AT + policy.doctorCodeCooldown, AT)).toBe(true);
    expect(await storage.reserveDoctorCodeRequest(AT + policy.doctorCodeCooldown, AT + 1)).toBe(false);
    expect(await storage.reserveDoctorCodeRequest(AT + 2 * policy.doctorCodeCooldown, AT + policy.doctorCodeCooldown)).toBe(true);
    const challenge = { id: 'doc-1', patientId: 'doctor', verifier: 'a'.repeat(64), createdAt: AT, expiresAt: AT + policy.doctorCodeLifetime, attempts: 0, consumed: false };
    await storage.putDoctorChallenge(challenge);
    await storage.putDoctorChallenge({ ...challenge, id: 'doc-2', verifier: 'b'.repeat(64) });
    expect((await storage.getDoctorChallenge())?.id).toBe('doc-2');
    expect(await storage.consumeDoctorChallenge('doc-1', true, policy.doctorCodeAttempts, AT + 1)).toBe(false);
    expect(await storage.consumeDoctorChallenge('doc-2', false, policy.doctorCodeAttempts, AT + 2)).toBe(false);
    expect(await storage.consumeDoctorChallenge('doc-2', true, policy.doctorCodeAttempts, AT + 3)).toBe(true);
    expect(await storage.consumeDoctorChallenge('doc-2', true, policy.doctorCodeAttempts, AT + 4)).toBe(false);
  });

  it('mantiene un solo desafío activo y cierra el código sólo al acertar', async () => {
    const { storage } = await seed();
    const challenge = { patientId: 'patient-ana', verifier: 'a'.repeat(64), createdAt: AT, expiresAt: AT + policy.codeLifetime, attempts: 0, consumed: false };
    await storage.putChallenge({ ...challenge, id: 'desafio-1' });
    await storage.putChallenge({ ...challenge, id: 'desafio-2', verifier: 'b'.repeat(64) });
    expect((await storage.getChallenge('patient-ana'))?.id).toBe('desafio-2');
    // Código incorrecto: cuenta el intento, no habilita.
    expect(await storage.consumeChallenge('patient-ana', 'desafio-2', false, policy.codeAttempts, AT + 1)).toBe(false);
    expect((await storage.getChallenge('patient-ana'))?.attempts).toBe(1);
    // Desafío vencido: no habilita aunque el código sea correcto.
    expect(await storage.consumeChallenge('patient-ana', 'desafio-2', true, policy.codeAttempts, AT + policy.codeLifetime)).toBe(false);
    // Acierto: habilita y cierra el desafío.
    expect(await storage.consumeChallenge('patient-ana', 'desafio-2', true, policy.codeAttempts, AT + 2)).toBe(true);
    expect(await storage.getChallenge('patient-ana')).toBeUndefined();
  });

  it('agota los intentos y no reutiliza el código', async () => {
    const { storage } = await seed();
    await storage.putChallenge({ id: 'desafio', patientId: 'patient-ana', verifier: 'c'.repeat(64), createdAt: AT, expiresAt: AT + policy.codeLifetime, attempts: 0, consumed: false });
    expect(await storage.consumeChallenge('patient-ana', 'desafio', false, 2, AT + 1)).toBe(false);
    expect(await storage.consumeChallenge('patient-ana', 'desafio', false, 2, AT + 2)).toBe(false);
    // Agotados los intentos, ni el código correcto habilita.
    expect(await storage.consumeChallenge('patient-ana', 'desafio', true, 2, AT + 3)).toBe(false);
    expect((await storage.getChallenge('patient-ana'))?.attempts).toBe(2);
  });

  it('registra auditoría sin códigos ni identificadores sensibles', async () => {
    const { storage, database } = await seed();
    await storage.appendAudit({ actor: 'system', action: 'challenge.created', resource: 'desafio-1', at: AT });
    const row = await database.prepare('SELECT actor, action, resource FROM audit_events').get();
    expect(row).toMatchObject({ actor: 'system', action: 'challenge.created', resource: 'desafio-1' });
  });
});
