import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

// El esquema vive en db/migrations como SQL revisado (el formato que aplica D1).
// Estas pruebas lo cargan en un SQLite real en memoria para comprobar que los
// invariantes no dependen del código en memoria del prototipo. No hay conexión
// con Cloudflare, ni datos reales: sólo sentencias y datos ficticios.

const migrations = join(process.cwd(), 'db', 'migrations');

function statementsOf(sql: string) {
  return sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
    .split(';').map(part => part.trim()).filter(Boolean);
}

function migrate() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  const files = readdirSync(migrations).filter(file => file.endsWith('.sql')).sort();
  for (const file of files) {
    for (const statement of statementsOf(readFileSync(join(migrations, file), 'utf8'))) db.exec(statement);
  }
  return db;
}

function addPatient(db: DatabaseSync, id: string, dni: string, whatsapp = '+5493800000001') {
  return db.prepare('INSERT INTO patients (id, dni, whatsapp, created_at) VALUES (?, ?, ?, ?)').run(id, dni, whatsapp, 0);
}

function addPdf(db: DatabaseSync, id: string, patientId: string, key = `pdf/${id}.pdf`) {
  return db.prepare("INSERT INTO documents (id, patient_id, kind, name, mime_type, size_bytes, sha256, r2_key, provenance, created_at) VALUES (?, ?, 'prescription_pdf', 'receta.pdf', 'application/pdf', 12, ?, ?, 'uploaded', 0)")
    .run(id, patientId, 'a'.repeat(64), key);
}

function addPublication(db: DatabaseSync, id: string, kind: 'indication' | 'prescription', scope: 'general' | 'patient', patientId: string | null, documentId: string | null = null) {
  return db.prepare('INSERT INTO publications (id, kind, scope, patient_id, title, content, published_at, document_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
    .run(id, kind, scope, patientId, 'Título ficticio', 'Contenido ficticio', documentId);
}

function addConsultation(db: DatabaseSync, id: string, chain: string, status: 'draft' | 'finalized', supersedes: string | null = null, reason: string | null = null) {
  return db.prepare('INSERT INTO consultations (id, patient_id, chain_id, date, status, insurance_at_visit, updated_at, supersedes_id, amendment_reason) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)')
    .run(id, 'p1', chain, '2026-10-19', status, 'APOS', supersedes, reason);
}

function supersede(db: DatabaseSync, id: string, at = 5) {
  return db.prepare('UPDATE consultations SET superseded_at = ? WHERE id = ?').run(at, id);
}

function addChallenge(db: DatabaseSync, id: string, patientId = 'p1') {
  return db.prepare('INSERT INTO access_challenges (id, patient_id, verifier, created_at, expires_at) VALUES (?, ?, ?, 0, 600000)')
    .run(id, patientId, 'b'.repeat(64));
}

function addLink(db: DatabaseSync, hash: string) {
  return db.prepare("INSERT INTO access_links (token_hash, scope, created_at, expires_at) VALUES (?, 'doctor', 0, 600000)")
    .run(hash);
}

describe('migración inicial', () => {
  it('crea las tablas del modelo y los índices parciales de los invariantes', () => {
    const db = migrate();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
      .map(row => String(row.name)).sort();
    expect(tables).toEqual([
      'access_challenges', 'access_link_control', 'access_links', 'audit_events',
      'code_request_control', 'consultations', 'doctor_access_challenges', 'doctor_access_control',
      'doctor_access_ip_limit', 'documents', 'patients', 'publications', 'sessions',
    ]);
    const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index'").all()
      .filter(row => String(row.sql).includes('WHERE'))
      .map(row => String(row.name));
    expect(indexes).toEqual(expect.arrayContaining([
      'access_challenges_active', 'access_links_active', 'consultations_current', 'consultations_single_successor',
      'publications_active_general', 'publications_active_patient_indication',
    ]));
  });

  it('exige fecha clínica sin hora y referencias existentes', () => {
    const db = migrate();
    addPatient(db, 'p1', '00000001');
    expect(() => db.prepare("INSERT INTO consultations (id, patient_id, chain_id, date, status, insurance_at_visit, updated_at) VALUES ('c1', 'p1', 'c1', '19/10/2026', 'draft', 'APOS', 0)").run())
      .toThrow(/CHECK constraint failed/);
    expect(() => db.prepare("INSERT INTO consultations (id, patient_id, chain_id, date, status, insurance_at_visit, updated_at) VALUES ('c2', 'ausente', 'c2', '2026-10-19', 'draft', 'APOS', 0)").run())
      .toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('pacientes', () => {
  it('no repite el DNI y admite un teléfono compartido', () => {
    const db = migrate();
    addPatient(db, 'p1', '00000001');
    addPatient(db, 'p2', '00000002', '+5493800000001');
    expect(() => addPatient(db, 'p3', '00000001', '+5493800000003')).toThrow(/UNIQUE constraint failed: patients.dni/);
  });
});

describe('publicaciones', () => {
  it('admite una sola indicación general activa y conserva el historial', () => {
    const db = migrate();
    addPublication(db, 'g1', 'indication', 'general', null);
    expect(() => addPublication(db, 'g2', 'indication', 'general', null)).toThrow(/UNIQUE constraint failed: publications.kind/);
    // Reemplazar la desactiva y entonces sí se publica la siguiente: el historial queda.
    db.prepare("UPDATE publications SET active = 0, superseded_at = 1 WHERE id = 'g1'").run();
    addPublication(db, 'g3', 'indication', 'general', null);
    expect(db.prepare("SELECT count(*) AS total FROM publications WHERE scope = 'general'").get()).toEqual({ total: 2 });
  });

  it('admite una sola indicación específica activa por paciente y varias recetas', () => {
    const db = migrate();
    addPatient(db, 'p1', '00000001');
    addPatient(db, 'p2', '00000002');
    addPdf(db, 'd1', 'p1');
    addPublication(db, 'i1', 'indication', 'patient', 'p1');
    expect(() => addPublication(db, 'i2', 'indication', 'patient', 'p1')).toThrow(/UNIQUE constraint failed: publications.patient_id/);
    addPublication(db, 'i3', 'indication', 'patient', 'p2');
    addPublication(db, 'r1', 'prescription', 'patient', 'p1', 'd1');
    addPublication(db, 'r2', 'prescription', 'patient', 'p1', 'd1');
    expect(db.prepare("SELECT count(*) AS total FROM publications WHERE patient_id = 'p1'").get()).toEqual({ total: 3 });
  });

  it('no permite una receta general, ni sin PDF, ni con el PDF de otro paciente', () => {
    const db = migrate();
    addPatient(db, 'p1', '00000001');
    addPatient(db, 'p2', '00000002');
    addPdf(db, 'd1', 'p1');
    expect(() => addPublication(db, 'r1', 'prescription', 'general', null, 'd1')).toThrow(/CHECK constraint failed/);
    expect(() => addPublication(db, 'r2', 'prescription', 'patient', 'p1')).toThrow(/CHECK constraint failed/);
    expect(() => addPublication(db, 'r3', 'prescription', 'patient', 'p2', 'd1')).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('guarda una clave de R2 distinta por archivo', () => {
    const db = migrate();
    addPatient(db, 'p1', '00000001');
    addPdf(db, 'd1', 'p1', 'pdf/compartida.pdf');
    expect(() => addPdf(db, 'd2', 'p1', 'pdf/compartida.pdf')).toThrow(/UNIQUE constraint failed: documents.r2_key/);
  });
});

describe('enmiendas de consultas', () => {
  it('mantiene una sola versión vigente por cadena', () => {
    const db = migrate();
    addPatient(db, 'p1', '00000001');
    addConsultation(db, 'c1', 'c1', 'finalized');
    // Enmendar es reemplazar la anterior y agregar la vigente.
    supersede(db, 'c1');
    addConsultation(db, 'c2', 'c1', 'finalized', 'c1', 'Corrijo el diagnóstico.');
    // Una segunda versión vigente en la misma cadena no es válida.
    expect(() => addConsultation(db, 'c3', 'c1', 'finalized', 'c2', 'Otra corrección.'))
      .toThrow(/UNIQUE constraint failed: consultations.chain_id/);
    expect(db.prepare('SELECT id FROM consultations WHERE superseded_at IS NULL').all()).toEqual([{ id: 'c2' }]);
  });

  it('no corrige dos veces la misma versión ni deja la cadena sin vigente', () => {
    const db = migrate();
    addPatient(db, 'p1', '00000001');
    addConsultation(db, 'c1', 'c1', 'finalized');
    supersede(db, 'c1');
    addConsultation(db, 'c2', 'c1', 'finalized', 'c1', 'Primera corrección.');
    supersede(db, 'c2', 6);
    expect(() => addConsultation(db, 'c3', 'c1', 'finalized', 'c1', 'Segunda corrección.'))
      .toThrow(/UNIQUE constraint failed: consultations.supersedes_id/);
  });

  it('sólo enmienda lo finalizado y toda enmienda lleva motivo', () => {
    const db = migrate();
    addPatient(db, 'p1', '00000001');
    addConsultation(db, 'd1', 'd1', 'finalized');
    supersede(db, 'd1');
    // El borrador no se enmienda: se continúa.
    expect(() => addConsultation(db, 'd2', 'd1', 'draft', 'd1', 'Motivo ficticio.'))
      .toThrow(/CHECK constraint failed/);
    // Sin motivo no hay enmienda.
    addConsultation(db, 'c1', 'c1', 'finalized');
    supersede(db, 'c1');
    expect(() => addConsultation(db, 'c2', 'c1', 'finalized', 'c1')).toThrow(/CHECK constraint failed/);
    // Un borrador no puede quedar marcado como reemplazado.
    addConsultation(db, 'b1', 'b1', 'draft');
    expect(() => supersede(db, 'b1', 9)).toThrow(/CHECK constraint failed/);
  });
});

describe('acceso de la médica', () => {
  it('mantiene un solo enlace vigente y libera el lugar al consumirlo', () => {
    const db = migrate();
    const consume = db.prepare('UPDATE access_links SET consumed_at = ? WHERE token_hash = ? AND scope = \'doctor\' AND consumed_at IS NULL AND expires_at > ?');
    addLink(db, 'a'.repeat(64));
    expect(() => addLink(db, 'b'.repeat(64))).toThrow(/UNIQUE constraint failed: access_links.scope/);
    // Un enlace vencido no se consume; uno consumido no vuelve a servir.
    expect(consume.run(10, 'a'.repeat(64), 600_001).changes).toBe(0);
    expect(consume.run(10, 'a'.repeat(64), 10).changes).toBe(1);
    expect(consume.run(11, 'a'.repeat(64), 11).changes).toBe(0);
    // Ya consumido, el siguiente enlace ocupa su lugar.
    addLink(db, 'c'.repeat(64));
    expect(db.prepare("SELECT count(*) AS total FROM access_links WHERE consumed_at IS NULL").get()).toEqual({ total: 1 });
  });

  it('exige hash SHA-256, vencimiento posterior y el único ámbito de la médica', () => {
    const db = migrate();
    expect(() => addLink(db, 'corto')).toThrow(/CHECK constraint failed/);
    expect(() => db.prepare("INSERT INTO access_links (token_hash, scope, created_at, expires_at) VALUES (?, 'doctor', 100, 100)").run('d'.repeat(64)))
      .toThrow(/CHECK constraint failed/);
    expect(() => db.prepare("INSERT INTO access_links (token_hash, scope, created_at, expires_at) VALUES (?, 'patient', 0, 100)").run('e'.repeat(64)))
      .toThrow(/CHECK constraint failed/);
  });

  it('reserva el próximo pedido de enlace en una sola sentencia condicional', () => {
    const db = migrate();
    const reserve = db.prepare("INSERT INTO access_link_control (scope, next_request_at) VALUES ('doctor', ?) ON CONFLICT(scope) DO UPDATE SET next_request_at = excluded.next_request_at WHERE access_link_control.next_request_at <= ? RETURNING next_request_at");
    expect(reserve.get(60_000, 1_000)).toEqual({ next_request_at: 60_000 });
    expect(reserve.get(60_000, 2_000)).toBeUndefined();
    expect(reserve.get(120_000, 60_000)).toEqual({ next_request_at: 120_000 });
  });
});

describe('acceso del paciente', () => {
  it('mantiene un solo desafío activo por paciente', () => {
    const db = migrate();
    addPatient(db, 'p1', '00000001');
    addPatient(db, 'p2', '00000002');
    addChallenge(db, 'h1');
    expect(() => addChallenge(db, 'h2')).toThrow(/UNIQUE constraint failed: access_challenges.patient_id/);
    addChallenge(db, 'h3', 'p2');
    db.prepare("UPDATE access_challenges SET consumed_at = 20 WHERE id = 'h1'").run();
    addChallenge(db, 'h4');
  });

  it('reserva el próximo código en una sola sentencia condicional', () => {
    const db = migrate();
    addPatient(db, 'p1', '00000001');
    const reserve = db.prepare('INSERT INTO code_request_control (patient_id, next_request_at) VALUES (?, ?) ON CONFLICT(patient_id) DO UPDATE SET next_request_at = excluded.next_request_at WHERE code_request_control.next_request_at <= ? RETURNING next_request_at');
    expect(reserve.get('p1', 300_000, 1_000)).toEqual({ next_request_at: 300_000 });
    // Antes del vencimiento la reserva no devuelve fila: la solicitud se ignora.
    expect(reserve.get('p1', 300_000, 1_000)).toBeUndefined();
    expect(reserve.get('p1', 600_000, 300_000)).toEqual({ next_request_at: 600_000 });
  });

  it('consume el desafío y cuenta intentos sin leer y escribir por separado', () => {
    const db = migrate();
    addPatient(db, 'p1', '00000001');
    addChallenge(db, 'h1');
    const consume = db.prepare('UPDATE access_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND attempts < ? AND expires_at > ?');
    const attempt = db.prepare('UPDATE access_challenges SET attempts = attempts + 1 WHERE id = ? AND consumed_at IS NULL AND attempts < ?');
    expect(attempt.run('h1', 5).changes).toBe(1);
    expect(attempt.run('h1', 5).changes).toBe(1);
    expect(consume.run(30, 'h1', 5, 20).changes).toBe(1);
    expect(consume.run(31, 'h1', 5, 20).changes).toBe(0);
    expect(db.prepare("SELECT attempts, consumed_at FROM access_challenges WHERE id = 'h1'").get()).toEqual({ attempts: 2, consumed_at: 30 });
  });

  it('extiende la sesión profesional sólo si sigue vigente', () => {
    const db = migrate();
    addPatient(db, 'p1', '00000001');
    db.prepare("INSERT INTO sessions (token_hash, role, patient_id, created_at, expires_at) VALUES ('t1', 'doctor', NULL, 0, 1000)").run();
    const extend = db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ? AND expires_at > ?');
    expect(extend.run(200, 't1', 100).changes).toBe(1);
    expect(extend.run(300, 't1', 500).changes).toBe(0);
    // El rol del paciente siempre tiene paciente; el de la médica, nunca.
    expect(() => db.prepare("INSERT INTO sessions (token_hash, role, patient_id, created_at, expires_at) VALUES ('t2', 'patient', NULL, 0, 1000)").run())
      .toThrow(/CHECK constraint failed/);
    expect(() => db.prepare("INSERT INTO sessions (token_hash, role, patient_id, created_at, expires_at) VALUES ('t3', 'doctor', 'p1', 0, 1000)").run())
      .toThrow(/CHECK constraint failed/);
  });
});
