import { describe, expect, it } from 'vitest';
import { policy } from '../src/shared/contracts';
import { createApp } from '../src/server/app';
import { examplePdf } from '../src/server/demo/pdf';
import { d1Storage } from './helpers/sqlite-d1';

// Integración real: la aplicación (src/server/app.ts) sobre el adaptador D1 y
// un doble de R2. Comprueba que el puerto intercambia implementaciones sin tocar
// la aplicación y que el aislamiento entre pacientes no vive en la interfaz.

const origin = 'http://localhost';
const seed = [
  { id: 'patient-ana', dni: '00000001', firstName: 'Ana', lastName: 'Ejemplo', whatsapp: '+5493800000001', insurance: 'APOS', memberNumber: 'DEMO-1' },
  { id: 'patient-luis', dni: '00000002', firstName: 'Luis', lastName: 'Demostración', whatsapp: '+5493800000002', insurance: 'Sin obra social', memberNumber: '' },
];

async function harness(initial = Date.parse('2026-10-17T12:00:00Z')) {
  let clock = initial;
  const now = () => clock;
  const { storage } = d1Storage();
  for (const patient of seed) await storage.createPatient({ ...patient, contactVerified: true, createdAt: now() });

  let inbox: { code: string; expiresAt: number } | undefined;
  const { app, openSession } = createApp({
    storage, now, origin,
    health: { mode: 'worker', persistent: true, whatsapp: false },
    deliverCode(_patient, code, expiresAt) { inbox = { code, expiresAt }; },
  });
  // La entrada de producción definirá acá su autenticación profesional real.
  app.post('/api/test/doctor-login', async c => {
    const session = await openSession(c, 'doctor');
    return c.json({ role: session.role, expiresAt: session.expiresAt });
  });

  const request = (method: string, path: string, body?: unknown, cookie?: string) => app.request(`${origin}${path}`, {
    method,
    headers: { Origin: origin, 'X-Portal-Request': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];

  async function doctor() {
    return cookieOf(await request('POST', '/api/test/doctor-login'));
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

  return { storage, request, doctor, patient, prescribe, advance: (ms: number) => { clock += ms; } };
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
