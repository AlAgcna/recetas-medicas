import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createD1Storage } from '../src/server/d1/storage';
import { memoryBucket, sqliteD1 } from './helpers/sqlite-d1';

// Reproduce el esquema manual que hoy tiene la D1 remota (anterior a
// db/migrations): patients sin whatsapp ni contact_verified, consultations sin
// superseded_at ni versionado, publications con otro modelo y access_challenges
// con `consumed`. Comprueba que la reparación deja operativas las altas y el
// panel sin tocar las tablas técnicas del ingreso.

const remoteSchema = `
CREATE TABLE patients (
  id TEXT PRIMARY KEY NOT NULL, dni TEXT NOT NULL UNIQUE, first_name TEXT NOT NULL,
  last_name TEXT NOT NULL, insurance TEXT, member_number TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('doctor', 'patient')),
  patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  CHECK (expires_at > created_at),
  CHECK ((role = 'patient' AND patient_id IS NOT NULL) OR (role = 'doctor' AND patient_id IS NULL))
);
CREATE TABLE consultations (
  id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL, date TEXT NOT NULL,
  reason TEXT NOT NULL, history TEXT NOT NULL, physical_exam TEXT NOT NULL,
  diagnosis TEXT NOT NULL, treatment TEXT NOT NULL, indications TEXT NOT NULL,
  studies TEXT NOT NULL, notes TEXT, status TEXT NOT NULL CHECK (status IN ('draft', 'finalized')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finalized_at INTEGER, amended_from_id TEXT,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
  FOREIGN KEY (amended_from_id) REFERENCES consultations(id) ON DELETE RESTRICT
);
CREATE TABLE publications (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('indication_general', 'indication_specific', 'prescription')),
  patient_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT, dose TEXT,
  frequency TEXT, duration TEXT, notes TEXT, created_at INTEGER NOT NULL,
  published_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  replaced_by_id TEXT, replaced_at INTEGER,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
  FOREIGN KEY (replaced_by_id) REFERENCES publications(id) ON DELETE RESTRICT
);
CREATE TABLE access_challenges (
  id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL, verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1)),
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at), CHECK (attempts >= 0)
);
`;

function statementsOf(sql: string) {
  return sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
    .split(';').map(part => part.trim()).filter(Boolean);
}

function repairedStorage() {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  database.exec(remoteSchema);
  // Sesión profesional vigente: no debe perderse al reparar.
  database.exec("INSERT INTO sessions VALUES ('hash-de-prueba', 'doctor', NULL, 0, 600000)");
  for (const statement of statementsOf(readFileSync('db/repairs/esquema_clinico.sql', 'utf8'))) {
    database.exec(statement);
  }
  return { database, storage: createD1Storage(sqliteD1(database), memoryBucket()) };
}

describe('reparación del esquema clínico remoto', () => {
  it('permite dar de alta un paciente y calcular los contadores del panel', async () => {
    const { storage } = repairedStorage();
    await storage.createPatient({
      id: 'patient-ana', dni: '00000001', firstName: 'Ana', lastName: 'Ejemplo',
      whatsapp: '+5493800000001', insurance: 'APOS', memberNumber: '', contactVerified: true,
      createdAt: 0,
    });
    expect(await storage.listPatients()).toEqual([{
      id: 'patient-ana', dni: '00000001', firstName: 'Ana', lastName: 'Ejemplo',
      whatsapp: '+5493800000001', insurance: 'APOS', memberNumber: '', contactVerified: true,
      createdAt: 0,
    }]);
    expect(await storage.dashboardStats()).toEqual({ patients: 1, consultations: 0, publications: 0 });
    // El DNI repetido sigue siendo un conflicto, no un duplicado.
    await expect(storage.createPatient({
      id: 'patient-otra', dni: '00000001', firstName: 'Otra', lastName: 'Persona',
      whatsapp: '+5493800000002', insurance: 'Particular', memberNumber: '', contactVerified: false,
      createdAt: 0,
    })).rejects.toThrow('DNI duplicado');
  });

  it('guarda la consulta y conserva la sesión profesional existente', async () => {
    const { database, storage } = repairedStorage();
    await storage.createPatient({
      id: 'patient-ana', dni: '00000001', firstName: 'Ana', lastName: 'Ejemplo',
      whatsapp: '+5493800000001', insurance: 'APOS', memberNumber: '', contactVerified: true,
      createdAt: 0,
    });
    await storage.saveConsultation({
      id: 'consultation-1', patientId: 'patient-ana', date: '2026-10-23', status: 'finalized',
      reason: 'Control', examination: 'Sin hallazgos', diagnosis: 'Sano', vitals: { systolic: 120 },
      insuranceAtVisit: 'APOS', updatedAt: 1,
    });
    expect((await storage.getConsultation('consultation-1'))?.diagnosis).toBe('Sano');
    expect(await storage.dashboardStats()).toEqual({ patients: 1, consultations: 1, publications: 0 });
    expect(database.prepare('SELECT count(*) AS total FROM sessions').get()?.total).toBe(1);
  });

  it('se niega a correr sobre tablas con datos y no borra nada', async () => {
    const { database } = repairedStorage();
    database.exec("INSERT INTO patients VALUES ('p1', '1', 'Ana', 'Ejemplo', 'APOS', '', '+5493800000000', 1, 0)");
    const statements = statementsOf(readFileSync('db/repairs/esquema_clinico.sql', 'utf8'));
    expect(() => { for (const statement of statements) database.exec(statement); }).toThrow(/integer overflow/);
    expect(database.prepare('SELECT count(*) AS total FROM patients').get()?.total).toBe(1);
  });
});
