import { describe, expect, it } from 'vitest';
import { policy } from '../src/shared/contracts';
import { createApp, type CookiePolicy } from '../src/server/app';
import { examplePdf } from '../src/server/demo/pdf';
import type { OutgoingEmail } from '../src/server/email/port';
import { sha256 } from '../src/server/prescription-pdf';
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
    // finge haber enviado un enlace.
    ...(options.email === false ? {} : {
      doctorEmail: doctorAddress,
      sendEmail(email: OutgoingEmail) { mail.push(email); },
    }),
    deliverCode(_patient, code, expiresAt) { inbox = { code, expiresAt }; },
  });

  const request = (method: string, path: string, body?: unknown, cookie?: string) => app.request(`${origin}${path}`, {
    method,
    headers: { Origin: origin, 'X-Portal-Request': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];
  const tokenOf = (message: OutgoingEmail) => message.text.match(/#([0-9a-f]{64})/)![1];

  /** Pide el enlace y lo usa contra la ruta real de ingreso. */
  async function doctor() {
    const requested = await request('POST', '/api/doctor/request-link');
    expect(requested.status).toBe(200);
    const opened = await request('POST', '/api/doctor/session', { token: tokenOf(mail.at(-1)!) });
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
    storage, database, mail, request, doctor, patient, prescribe, cookieOf, tokenOf,
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
  it('envía un enlace de un solo uso y no lo expone en la respuesta ni en la base', async () => {
    const h = await harness();
    const requested = await h.request('POST', '/api/doctor/request-link');
    expect(requested.status).toBe(200);
    // La respuesta es siempre la misma y no incluye el token.
    const message = (await requested.json()).message as string;
    expect(message).not.toMatch(/[0-9a-f]{64}/);

    expect(h.mail).toHaveLength(1);
    expect(h.mail[0].to).toBe(doctorAddress);
    const token = h.tokenOf(h.mail[0]);
    expect(h.mail[0].text).toContain(`${origin}/acceso#`);

    // En la base y en la auditoría vive el hash del token, nunca el token.
    expect(await h.database.prepare('SELECT token_hash FROM access_links').all())
      .toEqual([{ token_hash: await sha256(new TextEncoder().encode(token)) }]);
    const audit = await h.database.prepare('SELECT action, resource FROM audit_events').all();
    expect(audit).toContainEqual({ action: 'access-link.created', resource: 'doctor' });
    expect(JSON.stringify(audit)).not.toContain(token);

    // Un solo uso: la primera vez abre la sesión, la segunda no sirve.
    const opened = await h.request('POST', '/api/doctor/session', { token });
    expect(opened.status).toBe(200);
    expect(opened.headers.get('set-cookie')).toContain('HttpOnly');
    expect((await h.request('GET', '/api/doctor/patients', undefined, h.cookieOf(opened))).status).toBe(200);
    expect((await h.request('POST', '/api/doctor/session', { token })).status).toBe(401);
  });

  it('respeta el enfriamiento y descarta el enlace vencido o reemplazado', async () => {
    const h = await harness();
    await h.request('POST', '/api/doctor/request-link');
    const first = h.tokenOf(h.mail[0]);
    // Dentro del enfriamiento no se envía otro correo.
    await h.request('POST', '/api/doctor/request-link');
    expect(h.mail).toHaveLength(1);
    h.advance(policy.accessLinkCooldown);
    await h.request('POST', '/api/doctor/request-link');
    expect(h.mail).toHaveLength(2);
    const second = h.tokenOf(h.mail[1]);
    expect(second).not.toBe(first);
    // Un enlace nuevo invalida el anterior.
    expect((await h.request('POST', '/api/doctor/session', { token: first })).status).toBe(401);
    // Y el vigente vence por tiempo.
    h.advance(policy.accessLinkLifetime);
    expect((await h.request('POST', '/api/doctor/session', { token: second })).status).toBe(401);
  });

  it('rechaza enlaces inventados, mal formados o sin configuración de correo', async () => {
    const h = await harness();
    expect((await h.request('POST', '/api/doctor/session', { token: 'a'.repeat(64) })).status).toBe(401);
    expect((await h.request('POST', '/api/doctor/session', { token: 'no-es-un-token' })).status).toBe(401);
    expect((await h.request('POST', '/api/doctor/session', {})).status).toBe(401);
    expect((await h.request('GET', '/api/doctor/patients')).status).toBe(401);

    const closed = await harness({ email: false });
    expect((await closed.request('POST', '/api/doctor/request-link')).status).toBe(503);
    expect(closed.mail).toHaveLength(0);
    expect(await closed.database.prepare('SELECT count(*) AS total FROM access_links').get()).toEqual({ total: 0 });
  });

  it('la política por defecto de sesión es la de producción: Secure, HttpOnly y sin prefijo demo', async () => {
    const h = await harness();
    await h.request('POST', '/api/doctor/request-link');
    const opened = await h.request('POST', '/api/doctor/session', { token: h.tokenOf(h.mail[0]) });
    const raw = opened.headers.get('set-cookie')!;
    expect(raw).toMatch(/^doctor=/);
    expect(raw).toContain('Secure');
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Strict');
    expect(raw).not.toContain('demo_');
    // La demostración declara su propia política aparte (`demoCookies`).
    const demo = await harness({ cookie: { prefix: 'demo_', secure: false } });
    await demo.request('POST', '/api/doctor/request-link');
    const local = (await demo.request('POST', '/api/doctor/session', { token: demo.tokenOf(demo.mail[0]) })).headers.get('set-cookie')!;
    expect(local).toMatch(/^demo_doctor=/);
    expect(local).not.toContain('Secure');
  });
});
