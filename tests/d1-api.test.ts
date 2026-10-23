import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { policy } from '../src/shared/contracts';
import { createApp, type CookiePolicy } from '../src/server/app';
import { examplePdf } from '../src/server/demo/pdf';
import type { OutgoingEmail } from '../src/server/email/port';
import { d1Storage } from './helpers/sqlite-d1';

// Integración real: la aplicación (src/server/app.ts) sobre el adaptador D1 y
// un doble de R2. Comprueba que el puerto intercambia implementaciones sin tocar
// la aplicación y que el aislamiento entre pacientes no vive en la interfaz.

const origin = 'http://localhost';
const doctorAddress = 'consultorio@ejemplo.test';
const seed = [
  { id: 'patient-ana', dni: '00000001', firstName: 'Ana', lastName: 'Ejemplo', whatsapp: '+5493800000001', insurance: 'APOS', memberNumber: 'DEMO-1' },
  { id: 'patient-luis', dni: '00000002', firstName: 'Luis', lastName: 'Demostración', whatsapp: '+5493800000002', insurance: 'Sin obra social', memberNumber: '' },
];

async function harness(options: { email?: boolean; cookie?: CookiePolicy; initial?: number } = {}) {
  let clock = options.initial ?? Date.parse('2026-10-17T12:00:00Z');
  const now = () => clock;
  const { storage, database } = d1Storage();
  for (const patient of seed) await storage.createPatient({ ...patient, contactVerified: true, createdAt: now() });

  let inbox: { code: string; expiresAt: number } | undefined;
  const mail: OutgoingEmail[] = [];
  const { app } = createApp({
    storage, now, origin,
    health: { mode: 'worker', persistent: true, whatsapp: false },
    cookie: options.cookie,
    // Sin configuración de correo el ingreso de la médica queda en 503: nunca
    // finge haber enviado un código.
    ...(options.email === false ? {} : {
      doctorEmail: doctorAddress,
      sendEmail(email: OutgoingEmail) { mail.push(email); },
    }),
    deliverCode(_patient, code, expiresAt) { inbox = { code, expiresAt }; },
  });

  const request = (method: string, path: string, body?: unknown, cookie?: string) => app.request(`${origin}${path}`, {
    method,
    headers: { Origin: origin, 'X-Portal-Request': '1', 'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.0.2.1', 'CF-IPCountry': 'AR', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];
  const codeOf = (message: OutgoingEmail) => message.text.match(/\b\d{6}\b/)![0];

  /** Pide el código y lo usa contra la ruta real de ingreso. */
  async function doctor() {
    const requested = await request('POST', '/api/doctor/request-code', { website: '' });
    expect(requested.status).toBe(200);
    const opened = await request('POST', '/api/doctor/verify-code', { code: codeOf(mail.at(-1)!) });
    expect(opened.status).toBe(200);
    return cookieOf(opened);
  }
  async function patient(dni = '00000001') {
    inbox = undefined;
    await request('POST', '/api/patient/request-code', { dni });
    const response = await request('POST', '/api/patient/verify-code', { dni, code: inbox!.code });
    expect(response.status).toBe(200);
    return cookieOf(response);
  }
  async function prescribe(cookie: string, patientId: string, title: string) {
    const form = new FormData();
    form.set('title', title);
    form.set('content', 'PDF ficticio de prueba');
    form.set('pdf', new File([new TextEncoder().encode(examplePdf())], 'receta.pdf', { type: 'application/pdf' }));
    return app.request(`${origin}/api/doctor/patients/${patientId}/prescriptions`, {
      method: 'POST',
      headers: { Origin: origin, 'X-Portal-Request': '1', Cookie: cookie },
      body: form,
    });
  }

  return {
    storage, database, mail, request, doctor, patient, prescribe, cookieOf, codeOf,
    advance: (ms: number) => { clock += ms; },
  };
}

const consultationBody = (overrides: Record<string, unknown> = {}) => ({
  date: '2026-10-17', vitals: {}, reason: 'Motivo de ejemplo', examination: 'Examen de ejemplo',
  diagnosis: 'Diagnóstico de ejemplo', status: 'finalized' as const, ...overrides,
});

describe('aplicación sobre D1', () => {
  it('crea fichas y el DNI repetido es un conflicto', async () => {
    const h = await harness();
    const doctor = await h.doctor();
    const created = await h.request('POST', '/api/doctor/patients', { dni: '00000003', whatsapp: '+5493800000003', firstName: 'Nuevo', lastName: 'Paciente', insurance: 'APOS' }, doctor);
    expect(created.status).toBe(201);
    const duplicated = await h.request('POST', '/api/doctor/patients', { dni: '00000003', whatsapp: '+5493800000004' }, doctor);
    expect(duplicated.status).toBe(409);
    const { patients } = await (await h.request('GET', '/api/doctor/patients', undefined, doctor)).json();
    expect(patients).toHaveLength(3);
  });

  it('finaliza una consulta y la corrige sólo por enmienda', async () => {
    const h = await harness();
    const doctor = await h.doctor();
    const created = await h.request('POST', '/api/doctor/patients/patient-ana/consultations', consultationBody(), doctor);
    expect(created.status).toBe(201);
    const saved = (await created.json()).consultation;
    expect(saved.insuranceAtVisit).toBe('APOS');
    const overwrite = await h.request('PUT', `/api/doctor/patients/patient-ana/consultations/${saved.id}`, consultationBody({ diagnosis: 'Pisado' }), doctor);
    expect(overwrite.status).toBe(409);
    const amendment = await h.request(
      'POST', `/api/doctor/patients/patient-ana/consultations/${saved.id}/amendments`,
      consultationBody({ diagnosis: 'Corregido', amendmentReason: 'Corrijo el diagnóstico' }), doctor,
    );
    expect(amendment.status).toBe(201);
    const detail = await (await h.request('GET', '/api/doctor/patients/patient-ana', undefined, doctor)).json();
    const byId = Object.fromEntries(detail.consultations.map((item: { id: string; diagnosis: string }) => [item.id, item.diagnosis]));
    expect(byId[saved.id]).toBe('Diagnóstico de ejemplo');
    expect(Object.values(byId)).toContain('Corregido');
  });

  it('reemplaza la indicación general sólo confirmando la versión revisada', async () => {
    const h = await harness();
    const doctor = await h.doctor();
    const first = await h.request('POST', '/api/doctor/general-indications', { kind: 'indication', title: 'General 1', content: 'Texto', expectedActiveId: null }, doctor);
    expect(first.status).toBe(201);
    const publication = (await first.json()).publication;
    expect((await h.request('POST', '/api/doctor/general-indications', { kind: 'indication', title: 'Otra', content: 'Texto', expectedActiveId: null }, doctor)).status).toBe(409);
    const replaced = await h.request('POST', '/api/doctor/general-indications', { kind: 'indication', title: 'General 2', content: 'Texto', expectedActiveId: publication.id }, doctor);
    expect(replaced.status).toBe(201);
    const indications = await (await h.request('GET', '/api/doctor/general-indications', undefined, doctor)).json();
    expect(indications.active.title).toBe('General 2');
    expect(indications.history).toHaveLength(2);
  });

  it('el paciente ve sólo lo suyo y descarga su receta, no la ajena', async () => {
    const h = await harness();
    const doctor = await h.doctor();
    await h.request('POST', '/api/doctor/general-indications', { kind: 'indication', title: 'General', content: 'Texto', expectedActiveId: null }, doctor);
    await h.request('POST', '/api/doctor/patients/patient-luis/publications', { kind: 'indication', title: 'Para Luis', content: 'Texto', expectedActiveId: null }, doctor);
    const uploaded = await h.prescribe(doctor, 'patient-ana', 'Receta de Ana');
    expect(uploaded.status).toBe(201);
    const prescription = (await uploaded.json()).publication;

    const ana = await h.patient('00000001');
    const seen = await (await h.request('GET', '/api/patient/publications', undefined, ana)).json();
    expect(seen.publications.map((item: { title: string }) => item.title)).toEqual(['General', 'Receta de Ana']);

    const luis = await h.patient('00000002');
    const other = await (await h.request('GET', '/api/patient/publications', undefined, luis)).json();
    expect(other.publications.map((item: { title: string }) => item.title)).toEqual(['General', 'Para Luis']);

    const download = await h.request('GET', `/api/patient/publications/${prescription.id}/download`, undefined, ana);
    expect(download.status).toBe(200);
    expect(download.headers.get('x-document-sha256')).toBe(prescription.pdf.sha256);
    expect(new TextDecoder().decode(await download.arrayBuffer())).toContain('%PDF');
    expect((await h.request('GET', `/api/patient/publications/${prescription.id}/download`, undefined, luis)).status).toBe(404);
  });

  it('la sesión del paciente vence y no revive', async () => {
    const h = await harness();
    const patient = await h.patient();
    h.advance(policy.patientLifetime - 1);
    expect((await h.request('GET', '/api/patient/publications', undefined, patient)).status).toBe(200);
    h.advance(1);
    expect((await h.request('GET', '/api/patient/publications', undefined, patient)).status).toBe(401);
  });

  it('revoca el token al cerrar sesión', async () => {
    const h = await harness();
    const doctor = await h.doctor();
    expect((await h.request('POST', '/api/doctor/logout', undefined, doctor)).status).toBe(200);
    expect((await h.request('GET', '/api/doctor/patients', undefined, doctor)).status).toBe(401);
  });
});

describe('ingreso de la médica por correo', () => {
  it('envía un código de seis dígitos, no lo expone y abre una única sesión', async () => {
    const h = await harness();
    const requested = await h.request('POST', '/api/doctor/request-code', { website: '' });
    expect(requested.status).toBe(200);
    expect(h.mail).toHaveLength(1);
    expect(h.mail[0].to).toBe(doctorAddress);
    const code = h.codeOf(h.mail[0]);
    expect(code).toMatch(/^\d{6}$/);
    expect(h.mail[0].text).not.toContain('/acceso#');
    expect(await requested.text()).not.toContain(code);
    const stored = h.database.prepare('SELECT verifier, attempts, consumed_at FROM doctor_access_challenges').get()!;
    expect(stored.verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.verifier).not.toBe(code);
    expect(stored.attempts).toBe(0);
    expect(stored.consumed_at).toBeNull();
    const audit = await h.database.prepare('SELECT action, resource FROM audit_events').all();
    expect(audit).toContainEqual({ action: 'doctor-access.requested', resource: 'doctor' });
    expect(JSON.stringify(audit)).not.toContain(code);
    const opened = await h.request('POST', '/api/doctor/verify-code', { code });
    expect(opened.status).toBe(200);
    expect(opened.headers.get('set-cookie')).toContain('HttpOnly');
    expect((await h.request('GET', '/api/doctor/patients', undefined, h.cookieOf(opened))).status).toBe(200);
    expect((await h.request('POST', '/api/doctor/verify-code', { code })).status).toBe(401);
  });

  it('respeta los tres minutos y descarta el código vencido o reemplazado', async () => {
    const h = await harness();
    await h.request('POST', '/api/doctor/request-code', { website: '' });
    const first = h.codeOf(h.mail[0]);
    const firstChallenge = (await h.storage.getDoctorChallenge())!.id;
    // Dentro del enfriamiento no se envía otro correo.
    await h.request('POST', '/api/doctor/request-code', { website: '' });
    expect(h.mail).toHaveLength(1);
    expect((await h.storage.getDoctorChallenge())?.id).toBe(firstChallenge);
    h.advance(policy.doctorCodeCooldown);
    await h.request('POST', '/api/doctor/request-code', { website: '' });
    expect(h.mail).toHaveLength(2);
    const second = h.codeOf(h.mail[1]);
    expect((await h.storage.getDoctorChallenge())?.id).not.toBe(firstChallenge);
    // Dos sorteos de seis dígitos pueden coincidir; no asumir que son distintos.
    if (second !== first) expect((await h.request('POST', '/api/doctor/verify-code', { code: first })).status).toBe(401);
    // Y el vigente vence por tiempo.
    h.advance(policy.doctorCodeLifetime);
    expect((await h.request('POST', '/api/doctor/verify-code', { code: second })).status).toBe(401);
  });

  it('rechaza códigos inventados, mal formados o sin configuración de correo', async () => {
    const h = await harness();
    expect((await h.request('POST', '/api/doctor/verify-code', { code: '123456'   })).status).toBe(401);
    expect((await h.request('POST', '/api/doctor/verify-code', { code: '12345a'   })).status).toBe(401);
    expect((await h.request('POST', '/api/doctor/verify-code', {})).status).toBe(401);
    expect((await h.request('GET', '/api/doctor/patients')).status).toBe(401);

    const closed = await harness({ email: false });
    expect((await closed.request('POST', '/api/doctor/request-code', { website: '' })).status).toBe(503);
    expect(closed.mail).toHaveLength(0);
    expect(await closed.database.prepare('SELECT count(*) AS total FROM doctor_access_challenges').get()).toEqual({ total: 0 });
  });

  it('la política por defecto de sesión es la de producción: Secure, HttpOnly y sin prefijo demo', async () => {
    const h = await harness();
    await h.request('POST', '/api/doctor/request-code', { website: '' });
    const opened = await h.request('POST', '/api/doctor/verify-code', { code: h.codeOf(h.mail[0]) });
    const raw = opened.headers.get('set-cookie')!;
    expect(raw).toMatch(/^doctor=/);
    expect(raw).toContain('Secure');
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Strict');
    expect(raw).not.toContain('demo_');
    // La demostración declara su propia política aparte (`demoCookies`).
    const demo = await harness({ cookie: { prefix: 'demo_', secure: false } });
    await demo.request('POST', '/api/doctor/request-code', { website: '' });
    const local = (await demo.request('POST', '/api/doctor/verify-code', { code: demo.codeOf(demo.mail[0]) })).headers.get('set-cookie')!;
    expect(local).toMatch(/^demo_doctor=/);
    expect(local).not.toContain('Secure');
  });

  it('rechaza JSON doble sin tocar el desafío, y acepta luego el objeto correcto', async () => {
    const h = await harness();
    await h.request('POST', '/api/doctor/request-code', { website: '' });
    const code = h.codeOf(h.mail[0]);
    const malformed = await h.request('POST', '/api/doctor/verify-code', JSON.stringify({ code }));
    expect(malformed.status).toBe(401);
    expect((await h.storage.getDoctorChallenge())?.attempts).toBe(0);
    expect((await h.request('POST', '/api/doctor/verify-code', { code })).status).toBe(200);
  });

  it('un error de tipeo no consume el código y cinco errores agotan los intentos', async () => {
    const h = await harness();
    await h.request('POST', '/api/doctor/request-code', { website: '' });
    const code = h.codeOf(h.mail[0]);
    const wrong = code === '000000' ? '000001' : '000000';
    expect((await h.request('POST', '/api/doctor/verify-code', { code: wrong })).status).toBe(401);
    expect((await h.storage.getDoctorChallenge())?.attempts).toBe(1);
    expect((await h.request('POST', '/api/doctor/verify-code', { code })).status).toBe(200);

    h.advance(policy.doctorCodeCooldown);
    await h.request('POST', '/api/doctor/request-code', { website: '' });
    const next = h.codeOf(h.mail[1]);
    for (let attempt = 0; attempt < policy.doctorCodeAttempts; attempt++) {
      expect((await h.request('POST', '/api/doctor/verify-code', { code: next === '000000' ? '000001' : '000000' })).status).toBe(401);
    }
    expect((await h.request('POST', '/api/doctor/verify-code', { code: next })).status).toBe(401);
  });

  it('dos verificaciones concurrentes crean como máximo una sesión', async () => {
    const h = await harness();
    await h.request('POST', '/api/doctor/request-code', { website: '' });
    const code = h.codeOf(h.mail[0]);
    const results = await Promise.all([
      h.request('POST', '/api/doctor/verify-code', { code }),
      h.request('POST', '/api/doctor/verify-code', { code }),
    ]);
    expect(results.map(response => response.status).sort()).toEqual([200, 401]);
    expect(h.database.prepare('SELECT count(*) AS total FROM sessions').get()?.total).toBe(1);
  });

  it('la sesión profesional vence sin actividad y no revive', async () => {
    const h = await harness();
    const doctor = await h.doctor();
    h.advance(policy.doctorIdle);
    expect((await h.request('GET', '/api/doctor/session', undefined, doctor)).status).toBe(401);
    expect((await h.request('POST', '/api/doctor/activity', undefined, doctor)).status).toBe(401);
  });

  it('reproduce el consumo seguido de 500 si falta sessions y verifica la reparación sin borrar datos', async () => {
    const h = await harness();
    // Esquema manual observado en producción: access_sessions no sustituye a sessions.
    h.database.exec('DROP TABLE sessions');
    h.database.exec('CREATE TABLE access_sessions (token_hash TEXT PRIMARY KEY)');
    h.database.exec("INSERT INTO access_sessions VALUES ('registro-que-no-se-debe-borrar')");
    await h.request('POST', '/api/doctor/request-code', { website: '' });
    const code = h.codeOf(h.mail[0]);
    expect((await h.request('POST', '/api/doctor/verify-code', { code })).status).toBe(500);
    expect(await h.storage.getDoctorChallenge()).toBeUndefined();
    expect((await h.request('POST', '/api/doctor/verify-code', { code })).status).toBe(401);

    const repair = readFileSync('db/repairs/sesiones_faltantes.sql', 'utf8');
    h.database.exec(repair);
    h.database.exec(repair); // Repetible, no descarta tablas ni registros existentes.
    expect(h.database.prepare('SELECT count(*) AS total FROM access_sessions').get()?.total).toBe(1);
    expect(h.database.prepare('SELECT count(*) AS total FROM patients').get()?.total).toBe(2);
    h.advance(policy.doctorCodeCooldown);
    const doctor = await h.doctor();
    expect((await h.request('GET', '/api/doctor/session', undefined, doctor)).status).toBe(200);
  });
});
