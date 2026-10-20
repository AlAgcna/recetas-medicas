import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app';
import { createDemoApp } from '../src/server/demo/app';
import { createMemoryStorage } from '../src/server/demo/storage';
import { createStore } from '../src/server/demo/store';
import productionApp from '../src/server/index';
import { consultationSchema, patientSchema, policy } from '../src/shared/contracts';
import { examplePdf } from '../src/server/demo/pdf';

function harness(initialClock = Date.now()) {
  let clock = initialClock;
  const { app, store } = createDemoApp({ now: () => clock, origin: 'http://localhost' });
  const request = (method: string, path: string, body?: unknown, cookie?: string) => app.request(`http://localhost${path}`, {
    method, headers: { Origin: 'http://localhost', 'X-Portal-Request': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function doctor() {
    const response = await request('POST', '/api/demo/doctor-login');
    return response.headers.get('set-cookie')!.split(';')[0];
  }
  async function code(dni = '00000001') {
    await request('POST', '/api/patient/request-code', { dni });
    const response = await request('POST', '/api/demo/inbox', { dni });
    return (await response.json() as { code: string }).code;
  }
  async function patient(dni = '00000001') {
    const value = await code(dni);
    const response = await request('POST', '/api/patient/verify-code', { dni, code: value });
    expect(response.status).toBe(200);
    return response.headers.get('set-cookie')!.split(';')[0];
  }
  return { app, store, request, doctor, code, patient, advance: (duration: number) => { clock += duration; } };
}

describe('aislamiento y sesiones del prototipo', () => {
  it('impide acceso profesional sin sesión', async () => {
    const h = harness();
    expect((await h.request('GET', '/api/doctor/patients')).status).toBe(401);
    expect((await h.request('GET', '/api/patient/publications')).status).toBe(401);
  });

  it('usa cookies HttpOnly, SameSite y de demostración; no guarda el token utilizable en el servidor', async () => {
    const h = harness();
    const response = await h.request('POST', '/api/demo/doctor-login');
    const header = response.headers.get('set-cookie')!;
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    // La demo corre por HTTP en loopback: es la única que pide cookies sin
    // `Secure` y con el prefijo `demo_`; la política por defecto es la de
    // producción (ver `tests/d1-api.test.ts`).
    expect(header).toContain('demo_doctor=');
    expect(header).not.toContain('Secure');
    const raw = header.split(';')[0].split('=')[1];
    expect(h.store.sessions.has(raw)).toBe(false);
  });

  it('el sondeo de sesión no extiende las dos horas y una sesión vencida no revive', async () => {
    const h = harness();
    const cookie = await h.doctor();
    const initial = await (await h.request('GET', '/api/doctor/session', undefined, cookie)).json();
    h.advance(policy.doctorIdle - 1);
    const polled = await (await h.request('GET', '/api/doctor/session', undefined, cookie)).json();
    expect(polled.expiresAt).toBe(initial.expiresAt);
    h.advance(1);
    expect((await h.request('POST', '/api/doctor/activity', undefined, cookie)).status).toBe(401);
    expect((await h.request('GET', '/api/doctor/patients', undefined, cookie)).status).toBe(401);
  });

  it('la actividad válida extiende dos horas desde la última interacción', async () => {
    const h = harness();
    const cookie = await h.doctor();
    const initial = await (await h.request('GET', '/api/doctor/session', undefined, cookie)).json();
    h.advance(60_000);
    const renewed = await (await h.request('POST', '/api/doctor/activity', undefined, cookie)).json();
    expect(renewed.expiresAt).toBe(initial.expiresAt + 60_000);
    h.advance(policy.doctorIdle - 1);
    expect((await h.request('GET', '/api/doctor/session', undefined, cookie)).status).toBe(200);
    h.advance(1);
    expect((await h.request('GET', '/api/doctor/session', undefined, cookie)).status).toBe(401);
  });

  it('revoca el token al cerrar sesión', async () => {
    const h = harness();
    const cookie = await h.doctor();
    expect((await h.request('POST', '/api/doctor/logout', undefined, cookie)).status).toBe(200);
    expect((await h.request('GET', '/api/doctor/patients', undefined, cookie)).status).toBe(401);
  });

  it('revoca también la sesión del paciente y no intercambia roles', async () => {
    const h = harness();
    const doctor = await h.doctor();
    expect((await h.request('GET', '/api/patient/publications', undefined, doctor)).status).toBe(401);
    const patient = await h.patient();
    await h.request('POST', '/api/patient/logout', undefined, patient);
    expect((await h.request('GET', '/api/patient/publications', undefined, patient)).status).toBe(401);
  });

  it('la sesión del paciente vence a los 20 minutos aunque consulte documentos', async () => {
    const h = harness();
    const cookie = await h.patient();
    const initial = await (await h.request('GET', '/api/patient/session', undefined, cookie)).json();
    h.advance(policy.patientLifetime - 1);
    expect((await h.request('GET', '/api/patient/publications', undefined, cookie)).status).toBe(200);
    const polled = await (await h.request('GET', '/api/patient/session', undefined, cookie)).json();
    expect(polled.expiresAt).toBe(initial.expiresAt);
    h.advance(1);
    expect((await h.request('GET', '/api/patient/publications', undefined, cookie)).status).toBe(401);
    expect((await h.request('GET', '/api/patient/publications/publication-ana-demo/download', undefined, cookie)).status).toBe(401);
  });

  it('no expone registros ni metadatos internos y deniega descargas de otro paciente', async () => {
    const h = harness();
    const cookie = await h.patient();
    const response = await h.request('GET', '/api/patient/publications', undefined, cookie);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const payload = await response.text();
    expect(payload).toContain('Indicaciones de ejemplo');
    expect(payload).not.toContain('patientId');
    expect(payload).not.toContain('consultation-demo');
    expect(payload).not.toContain('docx');
    expect(payload).not.toContain('diagnosis');
    expect((await h.request('GET', '/api/patient/publications/publication-luis-demo/download', undefined, cookie)).status).toBe(404);
    expect((await h.request('GET', '/api/doctor/patients', undefined, cookie)).status).toBe(401);
    const download = await h.request('GET', '/api/patient/publications/publication-ana-demo/download', undefined, cookie);
    expect(download.status).toBe(200);
    expect(download.headers.get('cache-control')).toBe('no-store');
  });

  it('un PDF de demostración no es una receta emitida', async () => {
    const h = harness();
    const cookie = await h.patient('00000002');
    const response = await h.request('GET', '/api/patient/publications/publication-luis-demo/download', undefined, cookie);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    const pdf = await response.text();
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('Sin validez medica');
  });
});

describe('desafíos de acceso simulados', () => {
  it('responde igual para DNI conocido, desconocido y limitado, sin contacto ni código', async () => {
    const h = harness();
    const known = await h.request('POST', '/api/patient/request-code', { dni: '00000001' });
    const unknown = await h.request('POST', '/api/patient/request-code', { dni: '00000099', whatsapp: '+5491111111111' });
    const limited = await h.request('POST', '/api/patient/request-code', { dni: '00000001' });
    expect(known.status).toBe(unknown.status);
    const text = await known.text();
    expect(await unknown.text()).toBe(text);
    expect(await limited.text()).toBe(text);
    expect(text).not.toContain('00000001');
    expect(text).not.toContain('+549');
    expect(h.store.challenges.size).toBe(1);
  });

  it('no envía si no se verificó el contacto y el acceso público no puede elegir destino', async () => {
    const h = harness();
    const patient = h.store.patients.get('patient-ana-demo')!;
    patient.contactVerified = false;
    await h.request('POST', '/api/patient/request-code', { dni: patient.dni, whatsapp: '+5491111111111' });
    expect(h.store.inbox.size).toBe(0);
    expect(patient.whatsapp).toBe('+5493800000001');
  });

  it('garantiza un desafío ante solicitudes concurrentes y admite otro a los 5 minutos', async () => {
    const h = harness();
    await Promise.all(Array.from({ length: 8 }, () => h.request('POST', '/api/patient/request-code', { dni: '00000001' })));
    expect(h.store.audit.filter(event => event.action === 'challenge.created')).toHaveLength(1);
    const initial = h.store.challenges.get('patient-ana-demo')!.id;
    h.advance(policy.codeCooldown - 1);
    await h.code();
    expect(h.store.challenges.get('patient-ana-demo')!.id).toBe(initial);
    h.advance(1);
    await h.code();
    expect(h.store.challenges.get('patient-ana-demo')!.id).not.toBe(initial);
  });

  it('solo una validación concurrente puede consumir el código', async () => {
    const h = harness();
    const code = await h.code();
    const responses = await Promise.all(Array.from({ length: 6 }, () => h.request('POST', '/api/patient/verify-code', { dni: '00000001', code })));
    expect(responses.filter(response => response.status === 200)).toHaveLength(1);
    expect(responses.filter(response => response.status === 401)).toHaveLength(5);
    expect(h.store.sessions.size).toBe(1);
    expect((await h.request('POST', '/api/patient/verify-code', { dni: '00000001', code })).status).toBe(401);
  });

  it('vence exactamente a los 10 minutos', async () => {
    const h = harness();
    const code = await h.code();
    h.advance(policy.codeLifetime);
    expect((await h.request('POST', '/api/patient/verify-code', { dni: '00000001', code })).status).toBe(401);
  });

  it('bloquea el desafío después de cinco intentos fallidos', async () => {
    const h = harness();
    const code = await h.code();
    const incorrect = code === '000000' ? '999999' : '000000';
    for (let index = 0; index < 5; index++) {
      expect((await h.request('POST', '/api/patient/verify-code', { dni: '00000001', code: incorrect })).status).toBe(401);
    }
    expect((await h.request('POST', '/api/patient/verify-code', { dni: '00000001', code })).status).toBe(401);
  });

  it('el verificador no guarda el OTP claro y auditoría no contiene códigos ni datos clínicos', async () => {
    const h = harness();
    const code = await h.code();
    expect(h.store.challenges.get('patient-ana-demo')!.verifier).toHaveLength(64);
    expect(h.store.challenges.get('patient-ana-demo')!.verifier).not.toBe(code);
    expect(h.store.audit.every(event => !Object.values(event).includes(code))).toBe(true);
    expect(JSON.stringify(h.store.audit)).not.toContain('00000001');
  });
});

describe('registro clínico y publicación', () => {
  it('normaliza DNI y detecta duplicados; permite alta mínima y completar la ficha', async () => {
    const h = harness();
    const cookie = await h.doctor();
    expect((await h.request('POST', '/api/doctor/patients', { dni: '00.000.001', whatsapp: '+5493800000001' }, cookie)).status).toBe(409);
    const created = await h.request('POST', '/api/doctor/patients', { dni: '00000003', whatsapp: '+5493800000003' }, cookie);
    expect(created.status).toBe(201);
    const { patient } = await created.json();
    expect(patient.firstName).toBe('');
    expect((await h.request('PATCH', `/api/doctor/patients/${patient.id}`, { firstName: 'Rosa', lastName: 'Ejemplo' }, cookie)).status).toBe(200);
    expect((await h.request('PATCH', `/api/doctor/patients/${patient.id}`, { whatsapp: '+5493800000009' }, cookie)).status).toBe(400);
    await h.request('PATCH', '/api/doctor/patients/patient-ana-demo', { firstName: 'Ana de ejemplo' }, cookie);
    expect(h.store.patients.get('patient-ana-demo')!.lastName).toBe('Ejemplo');
    expect(h.store.patients.get('patient-ana-demo')!.insurance).toBe('APOS');
  });

  it('separa borrador, finalización y publicación y evita sobrescribir una consulta finalizada', async () => {
    const h = harness();
    const cookie = await h.doctor();
    const fields = { date: '2026-10-17', vitals: {}, reason: '', examination: '', diagnosis: '', status: 'draft' };
    const created = await h.request('POST', '/api/doctor/patients/patient-ana-demo/consultations', fields, cookie);
    expect(created.status).toBe(201);
    const { consultation } = await created.json();
    const path = `/api/doctor/patients/patient-ana-demo/consultations/${consultation.id}`;
    expect((await h.request('PUT', path, { ...fields, status: 'finalized' }, cookie)).status).toBe(400);
    const completed = { ...fields, reason: 'Ejemplo', examination: 'Ejemplo', diagnosis: 'Ejemplo', status: 'finalized' };
    expect((await h.request('PUT', path, completed, cookie)).status).toBe(200);
    expect((await h.request('PUT', path, { ...completed, diagnosis: 'Reemplazo' }, cookie)).status).toBe(409);
    expect(h.store.consultations.get(consultation.id)!.diagnosis).toBe('Ejemplo');
    expect(h.store.publications.size).toBe(2);
    expect((await h.request('PUT', `/api/doctor/patients/patient-luis-demo/consultations/${consultation.id}`, fields, cookie)).status).toBe(404);
  });

  it('corrige una consulta finalizada con una enmienda con motivo y conserva la versión original', async () => {
    const h = harness();
    const cookie = await h.doctor();
    const fields = { date: '2026-10-17', vitals: { systolic: 120 }, reason: 'Motivo original', examination: 'Examen original', diagnosis: 'Diagnóstico original', status: 'finalized' };
    const { consultation } = await (await h.request('POST', '/api/doctor/patients/patient-ana-demo/consultations', fields, cookie)).json();
    const amendments = `/api/doctor/patients/patient-ana-demo/consultations/${consultation.id}/amendments`;
    expect((await h.request('POST', amendments, { ...fields, amendmentReason: '' }, cookie)).status).toBe(400);
    expect((await h.request('POST', amendments, { ...fields, examination: '', amendmentReason: 'Motivo' }, cookie)).status).toBe(400);
    expect((await h.request('POST', amendments, { ...fields, status: 'draft', amendmentReason: 'Motivo' }, cookie)).status).toBe(400);
    const draft = await (await h.request('POST', '/api/doctor/patients/patient-ana-demo/consultations', { ...fields, status: 'draft' }, cookie)).json();
    expect((await h.request('POST', `/api/doctor/patients/patient-ana-demo/consultations/${draft.consultation.id}/amendments`, { ...fields, amendmentReason: 'Motivo' }, cookie)).status).toBe(409);
    expect((await h.request('POST', `/api/doctor/patients/patient-luis-demo/consultations/${consultation.id}/amendments`, { ...fields, amendmentReason: 'Motivo' }, cookie)).status).toBe(404);
    const before = await (await h.request('GET', '/api/doctor/patients', undefined, cookie)).json();
    const amended = await h.request('POST', amendments, { ...fields, diagnosis: 'Diagnóstico corregido', amendmentReason: 'Se transcribió mal el diagnóstico' }, cookie);
    expect(amended.status).toBe(201);
    const { consultation: corrected } = await amended.json();
    expect(corrected.id).not.toBe(consultation.id);
    expect(corrected.supersedesId).toBe(consultation.id);
    expect(corrected.amendmentReason).toBe('Se transcribió mal el diagnóstico');
    expect(corrected.insuranceAtVisit).toBe('APOS');
    const original = h.store.consultations.get(consultation.id)!;
    expect(original.status).toBe('finalized');
    expect(original.diagnosis).toBe('Diagnóstico original');
    expect(original.supersededAt).toBe(corrected.updatedAt);
    // Un reemplazo ya enmendado no se vuelve a corregir; la vigente sí.
    expect((await h.request('POST', amendments, { ...fields, amendmentReason: 'Otra' }, cookie)).status).toBe(409);
    expect((await h.request('POST', `/api/doctor/patients/patient-ana-demo/consultations/${corrected.id}/amendments`, { ...fields, amendmentReason: 'Segunda corrección', diagnosis: 'Diagnóstico corregido otra vez' }, cookie)).status).toBe(201);
    const after = await (await h.request('GET', '/api/doctor/patients', undefined, cookie)).json();
    expect(after.stats.consultations).toBe(before.stats.consultations);
    const detail = await (await h.request('GET', '/api/doctor/patients/patient-ana-demo', undefined, cookie)).json();
    expect(detail.consultations.filter((item: { supersededAt?: number }) => !item.supersededAt).some((item: { diagnosis: string }) => item.diagnosis === 'Diagnóstico corregido otra vez')).toBe(true);
    expect(detail.consultations.some((item: { diagnosis: string; supersededAt?: number }) => item.diagnosis === 'Diagnóstico original' && Boolean(item.supersededAt))).toBe(true);
  });

  it('una escritura concurrente no vuelve a borrador una consulta ya finalizada', async () => {
    const h = harness();
    const cookie = await h.doctor();
    const fields = { date: '2026-10-17', vitals: {}, reason: 'Ejemplo', examination: 'Ejemplo', diagnosis: 'Ejemplo', status: 'draft' };
    const { consultation } = await (await h.request('POST', '/api/doctor/patients/patient-ana-demo/consultations', fields, cookie)).json();
    const path = `/api/doctor/patients/patient-ana-demo/consultations/${consultation.id}`;
    await Promise.all([
      h.request('PUT', path, { ...fields, status: 'finalized' }, cookie),
      h.request('PUT', path, { ...fields, diagnosis: 'Otro borrador' }, cookie),
    ]);
    expect(h.store.consultations.get(consultation.id)!.status).toBe('finalized');
    expect(h.store.consultations.get(consultation.id)!.diagnosis).toBe('Ejemplo');
  });

  it('una publicación explícita reemplaza la específica sin acumular indicaciones activas', async () => {
    const h = harness();
    const doctor = await h.doctor();
    const patient = await h.patient();
    const before = await (await h.request('GET', '/api/patient/publications', undefined, patient)).json();
    const published = await h.request('POST', '/api/doctor/patients/patient-ana-demo/publications', { kind: 'indication', title: 'Entrega ficticia', content: 'Contenido ficticio', expectedActiveId: 'publication-ana-demo' }, doctor);
    expect(published.status).toBe(201);
    const after = await (await h.request('GET', '/api/patient/publications', undefined, patient)).json();
    expect(after.publications.length).toBe(before.publications.length);
    expect(after.publications[0].title).toBe('Entrega ficticia');
    expect(h.store.publications.get('publication-ana-demo')!.active).toBe(false);
    expect(h.store.publications.get('publication-ana-demo')!.content).toBe('Este documento permite probar el portal. No es una indicación médica ni corresponde a un paciente real.');
    expect((await h.request('POST', '/api/doctor/patients/patient-ana-demo/publications', { kind: 'indication', title: 'No permitido', content: 'No permitido' }, patient)).status).toBe(401);
  });
});

describe('indicaciones generales y específicas activas', () => {
  const generalInput = { kind: 'indication', title: 'General de ejemplo', content: 'Texto general ficticio sin datos personales.', expectedActiveId: null };

  it('comparte una sola general y mantiene una específica privada por paciente', async () => {
    const h = harness();
    const doctor = await h.doctor();
    const general = await h.request('POST', '/api/doctor/general-indications', generalInput, doctor);
    expect(general.status).toBe(201);
    const { publication } = await general.json();
    const ana = await h.patient();
    const luis = await h.patient('00000002');
    const anaResponse = await (await h.request('GET', '/api/patient/publications', undefined, ana)).json();
    const luisResponse = await (await h.request('GET', '/api/patient/publications', undefined, luis)).json();
    expect(anaResponse.publications.filter((item: { kind: string }) => item.kind === 'indication')).toHaveLength(2);
    expect(luisResponse.publications.filter((item: { kind: string }) => item.kind === 'indication')).toHaveLength(1);
    expect(anaResponse.publications.some((item: { id: string }) => item.id === publication.id)).toBe(true);
    expect(luisResponse.publications.some((item: { id: string }) => item.id === publication.id)).toBe(true);
    expect(JSON.stringify(luisResponse)).not.toContain('Indicaciones de ejemplo');
    expect(JSON.stringify(anaResponse)).not.toContain('patientId');
    expect(JSON.stringify(anaResponse)).not.toContain('supersededAt');
    expect((await h.request('GET', `/api/patient/publications/${publication.id}/download`, undefined, ana)).status).toBe(200);
    expect((await h.request('GET', `/api/patient/publications/${publication.id}/download`, undefined, luis)).status).toBe(200);
    expect((await h.request('GET', '/api/patient/publications/publication-ana-demo/download', undefined, luis)).status).toBe(404);
  });

  it('la general también aparece a pacientes incorporados después de publicarla', async () => {
    const h = harness();
    const doctor = await h.doctor();
    await h.request('POST', '/api/doctor/general-indications', generalInput, doctor);
    await h.request('POST', '/api/doctor/patients', { dni: '00000003', whatsapp: '+5493800000003', firstName: 'Eva', lastName: 'Ejemplo', contactVerified: true }, doctor);
    const patient = await h.patient('00000003');
    const { publications } = await (await h.request('GET', '/api/patient/publications', undefined, patient)).json();
    expect(publications).toHaveLength(1);
    expect(publications[0]).toMatchObject({ scope: 'general', title: 'General de ejemplo' });
  });

  it('archiva la general previa sin borrar contenido ni permitir sus descargas antiguas', async () => {
    const h = harness();
    const doctor = await h.doctor();
    const first = await (await h.request('POST', '/api/doctor/general-indications', generalInput, doctor)).json();
    h.advance(1000);
    const second = await h.request('POST', '/api/doctor/general-indications', { ...generalInput, title: 'General nueva', expectedActiveId: first.publication.id }, doctor);
    expect(second.status).toBe(201);
    const history = await (await h.request('GET', '/api/doctor/general-indications', undefined, doctor)).json();
    expect(history.active.title).toBe('General nueva');
    expect(history.history).toHaveLength(2);
    expect(h.store.publications.get(first.publication.id)).toMatchObject({ active: false, content: generalInput.content, supersededAt: expect.any(Number) });
    expect(h.store.publications.get('publication-ana-demo')!.active).toBe(true);
    const patient = await h.patient();
    expect((await h.request('GET', `/api/patient/publications/${first.publication.id}/download`, undefined, patient)).status).toBe(404);
    const { publications } = await (await h.request('GET', '/api/patient/publications', undefined, patient)).json();
    expect(publications.filter((item: { kind: string }) => item.kind === 'indication')).toHaveLength(2);
    expect(JSON.stringify(publications)).not.toContain('General de ejemplo');
    expect(JSON.stringify(publications)).not.toContain('supersededAt');
  });

  it('rechaza reemplazos sin confirmar la versión activa y no cambia la información', async () => {
    const h = harness();
    const doctor = await h.doctor();
    const payload = { kind: 'indication', title: 'No debería reemplazar', content: 'Ejemplo', expectedActiveId: null };
    const size = h.store.publications.size;
    expect((await h.request('POST', '/api/doctor/patients/patient-ana-demo/publications', payload, doctor)).status).toBe(409);
    expect(h.store.publications.size).toBe(size);
    expect(h.store.publications.get('publication-ana-demo')!.active).toBe(true);
    const first = await (await h.request('POST', '/api/doctor/general-indications', generalInput, doctor)).json();
    expect((await h.request('POST', '/api/doctor/general-indications', generalInput, doctor)).status).toBe(409);
    expect(h.store.publications.get(first.publication.id)!.active).toBe(true);
  });

  it('los reemplazos específicos concurrentes dejan una sola versión activa y conservan historial', async () => {
    const h = harness();
    const doctor = await h.doctor();
    const responses = await Promise.all(['Primera', 'Segunda'].map(title => h.request('POST', '/api/doctor/patients/patient-ana-demo/publications', {
      kind: 'indication', title, content: 'Ejemplo', expectedActiveId: 'publication-ana-demo',
    }, doctor)));
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    const records = [...h.store.publications.values()].filter(item => item.kind === 'indication' && item.patientId === 'patient-ana-demo');
    expect(records.filter(item => item.active)).toHaveLength(1);
    expect(records.filter(item => !item.active)).toHaveLength(1);
  });

  it('las publicaciones generales concurrentes dejan una sola general activa', async () => {
    const h = harness();
    const doctor = await h.doctor();
    const responses = await Promise.all(['Primera', 'Segunda'].map(title => h.request('POST', '/api/doctor/general-indications', { ...generalInput, title }, doctor)));
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect([...h.store.publications.values()].filter(item => item.scope === 'general' && item.active)).toHaveLength(1);
  });

  it('el límite de dos indicaciones no limita ni archiva las recetas PDF', async () => {
    const h = harness();
    const doctor = await h.doctor();
    await h.request('POST', '/api/doctor/general-indications', generalInput, doctor);
    const pdf = new TextEncoder().encode(examplePdf());
    for (let index = 0; index < 3; index++) {
      const form = new FormData();
      form.set('title', `Receta ficticia ${index}`);
      form.set('content', 'PDF de prueba');
      form.set('pdf', new File([pdf], 'receta.pdf', { type: 'application/pdf' }));
      const response = await h.app.request('http://localhost/api/doctor/patients/patient-ana-demo/prescriptions', {
        method: 'POST',
        headers: { Origin: 'http://localhost', 'X-Portal-Request': '1', Cookie: doctor },
        body: form,
      });
      expect(response.status).toBe(201);
    }
    const patient = await h.patient();
    const { publications } = await (await h.request('GET', '/api/patient/publications', undefined, patient)).json();
    expect(publications.filter((item: { kind: string }) => item.kind === 'indication')).toHaveLength(2);
    expect(publications.filter((item: { kind: string }) => item.kind === 'prescription')).toHaveLength(3);
  });

  it('no admite recetas generales ni alcances o destinatarios inyectados', async () => {
    const h = harness();
    const doctor = await h.doctor();
    expect((await h.request('POST', '/api/doctor/general-indications', { ...generalInput, kind: 'prescription' }, doctor)).status).toBe(400);
    expect((await h.request('POST', '/api/doctor/general-indications', { ...generalInput, patientId: 'patient-ana-demo' }, doctor)).status).toBe(400);
    expect((await h.request('POST', '/api/doctor/patients/patient-ana-demo/publications', { ...generalInput, scope: 'general' }, doctor)).status).toBe(400);
    expect((await h.request('GET', '/api/doctor/general-indications')).status).toBe(401);
    expect((await h.request('POST', '/api/doctor/general-indications', generalInput)).status).toBe(401);
    const patient = await h.patient();
    expect((await h.request('GET', '/api/doctor/general-indications', undefined, patient)).status).toBe(401);
    expect((await h.request('POST', '/api/doctor/general-indications', generalInput, patient)).status).toBe(401);
  });

  it('la descarga opcional entrega el mismo texto y verifica vigencia de sesión también para la general', async () => {
    const h = harness();
    const doctor = await h.doctor();
    const { publication } = await (await h.request('POST', '/api/doctor/general-indications', generalInput, doctor)).json();
    const patient = await h.patient();
    const path = `/api/patient/publications/${publication.id}/download`;
    const response = await h.request('GET', path, undefined, patient);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toContain('indicacion-general.txt');
    expect(await response.text()).toContain(generalInput.content);
    h.advance(policy.patientLifetime);
    expect((await h.request('GET', path, undefined, patient)).status).toBe(401);
  });
});

describe('estadísticas mensuales profesionales', () => {
  it('deniega acceso sin sesión o con una sesión de paciente', async () => {
    const h = harness();
    expect((await h.request('GET', '/api/doctor/statistics')).status).toBe(401);
    const cookie = await h.patient();
    expect((await h.request('GET', '/api/doctor/statistics', undefined, cookie)).status).toBe(401);
  });

  it('usa el mes de La Rioja y devuelve únicamente agregados sin datos personales', async () => {
    const h = harness(Date.parse('2026-11-01T02:30:00Z'));
    const cookie = await h.doctor();
    const response = await h.request('GET', '/api/doctor/statistics', undefined, cookie);
    const statistics = await response.json();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(statistics).toMatchObject({ month: '2026-10', attendedPatients: 1, consultations: 1, prescriptions: 1, leadingInsurances: ['APOS'] });
    const serialized = JSON.stringify(statistics);
    for (const privateValue of ['00000001', 'Ana', 'patientId', 'diagnosis', 'reason', '+549']) {
      expect(serialized).not.toContain(privateValue);
    }
    for (const month of ['2026-00', '2026-13', '2026-1', '0000-01', 'otro', '']) {
      expect((await h.request('GET', `/api/doctor/statistics?month=${month}`, undefined, cookie)).status).toBe(400);
    }
    const empty = await (await h.request('GET', '/api/doctor/statistics?month=2020-01', undefined, cookie)).json();
    expect(empty).toMatchObject({ attendedPatients: 0, consultations: 0, prescriptions: 0, insuranceBreakdown: [], leadingInsurances: [] });
  });

  it('captura la cobertura desde el servidor y editar la ficha no cambia una atención pasada', async () => {
    const h = harness(Date.parse('2026-10-17T15:00:00Z'));
    const cookie = await h.doctor();
    const payload = { date: '2026-09-15', vitals: {}, reason: 'Ejemplo', examination: 'Ejemplo', diagnosis: 'Ejemplo', status: 'finalized', insuranceAtVisit: 'Cobertura manipulada' };
    const result = await h.request('POST', '/api/doctor/patients/patient-ana-demo/consultations', payload, cookie);
    const { consultation } = await result.json();
    expect(consultation.insuranceAtVisit).toBe('APOS');
    await h.request('PATCH', '/api/doctor/patients/patient-ana-demo', { insurance: 'PAMI' }, cookie);
    const statistics = await (await h.request('GET', '/api/doctor/statistics?month=2026-09', undefined, cookie)).json();
    expect(statistics.insuranceBreakdown).toEqual([{ insurance: 'APOS', consultations: 1, patients: 1 }]);
    expect(h.store.consultations.get(consultation.id)!.insuranceAtVisit).toBe('APOS');
  });

  it('la cobertura de un borrador se actualiza al finalizarlo y los borradores no suman', async () => {
    const h = harness(Date.parse('2026-10-17T15:00:00Z'));
    const cookie = await h.doctor();
    const fields = { date: '2026-09-15', vitals: {}, reason: 'Ejemplo', examination: 'Ejemplo', diagnosis: 'Ejemplo', status: 'draft' };
    const { consultation } = await (await h.request('POST', '/api/doctor/patients/patient-ana-demo/consultations', fields, cookie)).json();
    await h.request('PATCH', '/api/doctor/patients/patient-ana-demo', { insurance: 'PAMI' }, cookie);
    const before = await (await h.request('GET', '/api/doctor/statistics?month=2026-09', undefined, cookie)).json();
    expect(before.consultations).toBe(0);
    await h.request('PUT', `/api/doctor/patients/patient-ana-demo/consultations/${consultation.id}`, { ...fields, status: 'finalized' }, cookie);
    const after = await (await h.request('GET', '/api/doctor/statistics?month=2026-09', undefined, cookie)).json();
    expect(after.leadingInsurances).toEqual(['PAMI']);
  });
});

describe('validación, CSRF y cierre de producción', () => {
  it('rechaza fechas inválidas y no inventa mediciones', () => {
    const schemaInput = { date: '2026-02-30', vitals: {}, reason: '', examination: '', diagnosis: '', status: 'draft' };
    expect(consultationSchema.safeParse(schemaInput).success).toBe(false);
    const valid = consultationSchema.parse({ ...schemaInput, date: '2026-10-17' });
    expect(valid.vitals).toEqual({});
    expect(patientSchema.safeParse({ dni: 'no-es-dni', whatsapp: '380' }).success).toBe(false);
  });

  it('rechaza mutaciones sin origen y cabecera válidos', async () => {
    const h = harness();
    const external = await h.app.request('http://localhost/api/demo/doctor-login', { method: 'POST', headers: { Origin: 'https://otro.example', 'X-Portal-Request': '1' } });
    expect(external.status).toBe(403);
    const missing = await h.app.request('http://localhost/api/demo/doctor-login', { method: 'POST', headers: { Origin: 'http://localhost' } });
    expect(missing.status).toBe(403);
  });

  it('limita el tamaño de cuerpos', async () => {
    const h = harness();
    const response = await h.request('POST', '/api/demo/doctor-login', { value: 'a'.repeat(40_000) });
    expect(response.status).toBe(413);
  });

  it('la entrada de producción no habilita API ni herramientas simuladas', async () => {
    for (const path of ['/api/demo/doctor-login', '/api/demo/inbox', '/api/doctor/patients', '/api/doctor/statistics', '/api/doctor/general-indications', '/api/patient/request-code']) {
      expect((await productionApp.request(`http://localhost${path}`, { method: 'POST' })).status).toBe(503);
    }
  });

  it('el servidor simulado rechaza iniciarse con NODE_ENV=production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try { expect(() => createDemoApp()).toThrow('Simulación no permitida en producción.'); }
    finally { vi.unstubAllEnvs(); }
  });
});

// La entrada de un Worker arma la aplicación por pedido, porque los bindings
// viven en `env`. El verificador de los códigos depende de un secreto estable:
// sin él, el código emitido en un pedido no se podría validar en el siguiente.
describe('la aplicación se arma por pedido con un secreto estable', () => {
  function perRequest(challengeSecret: string) {
    const now = () => Date.parse('2026-10-19T12:00:00Z');
    const storage = createMemoryStorage(createStore(now()));
    let delivered = '';
    const request = (secret: string, path: string, body: unknown) => createApp({
      storage, now, origin: 'http://localhost', challengeSecret: secret,
      health: { mode: 'test', persistent: true, whatsapp: false },
      deliverCode(_patient, code) { delivered = code; },
    }).app.request(`http://localhost${path}`, {
      method: 'POST', headers: { Origin: 'http://localhost', 'X-Portal-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { request, code: () => delivered, secret: challengeSecret };
  }

  it('un código emitido en un pedido se valida en el pedido siguiente', async () => {
    const runner = perRequest('secreto-estable-de-prueba');
    expect((await runner.request(runner.secret, '/api/patient/request-code', { dni: '00000001' })).status).toBe(200);
    const verified = await runner.request(runner.secret, '/api/patient/verify-code', { dni: '00000001', code: runner.code() });
    expect(verified.status).toBe(200);
  });

  it('con otro secreto el código emitido no valida', async () => {
    const issued = perRequest('secreto-estable-de-prueba');
    await issued.request(issued.secret, '/api/patient/request-code', { dni: '00000001' });
    const foreign = perRequest('otro-secreto');
    expect((await foreign.request(foreign.secret, '/api/patient/verify-code', { dni: '00000001', code: issued.code() })).status).toBe(401);
  });
});
