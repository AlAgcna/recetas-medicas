import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app';
import { createMemoryStorage } from '../src/server/demo/storage';
import { createStore } from '../src/server/demo/store';
import { policy, today, type ImportedIndication } from '../src/shared/contracts';
import { exampleIndicationDocx, exampleWordFile } from './helpers/indication-docx';
import { d1Storage } from './helpers/sqlite-d1';

const AT = Date.now();
const origin = 'https://portal.ejemplo.test';
const path = '/api/doctor/patients/patient-ana-demo/indication-imports';
async function harness(mode: 'memory' | 'D1') {
  let clock = AT;
  const store = createStore(AT);
  const d1 = mode === 'D1' ? d1Storage() : null;
  const storage = d1?.storage ?? createMemoryStorage(store);
  if (d1) for (const patient of store.patients.values()) await storage.createPatient(patient);
  let email = '';
  let sms = '';
  const { app } = createApp({ storage, origin, now: () => clock, health: { mode: 'test', persistent: !!d1, whatsapp: false },
    doctorEmail: 'consultorio@ejemplo.test', sendEmail: message => { email = message.text; }, deliverCode: (_patient, code) => { sms = code; } });
  const request = (method: string, route: string, data?: unknown, cookie?: string) => app.request(`${origin}${route}`, {
    method, headers: { Origin: origin, 'X-Portal-Request': '1', 'CF-Connecting-IP': '192.0.2.1', 'CF-IPCountry': 'AR',
      ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data),
  });
  await request('POST', '/api/doctor/request-code', {});
  const login = await request('POST', '/api/doctor/verify-code', { code: email.match(/\b\d{6}\b/)![0] });
  expect(login.status).toBe(200);
  const doctor = login.headers.get('set-cookie')!.split(';')[0];
  const patient = async (dni = '00000001') => {
    await request('POST', '/api/patient/request-code', { dni });
    const result = await request('POST', '/api/patient/verify-code', { dni, code: sms });
    expect(result.status).toBe(200);
    return result.headers.get('set-cookie')!.split(';')[0];
  };
  const bytes = exampleIndicationDocx();
  const form = (metadata?: unknown) => {
    const data = new FormData(); data.set('word', exampleWordFile(bytes));
    if (metadata !== undefined) data.set('metadata', JSON.stringify(metadata));
    return data;
  };
  const preview = await (await request('POST', `${path}/preview`, form(), doctor)).json();
  const input = { title: 'Histórica ficticia', content: 'Texto histórico revisado y ficticio.', documentDate: '2024-02-10', sourceSha256: preview.sha256, reviewed: true };
  return { storage, store, d1, request, doctor, patient, bytes, form, preview, input, advance: (ms: number) => { clock += ms; } };
}

describe.each(['memory', 'D1'] as const)('importación histórica sobre %s', mode => {
  it('la vista previa no guarda; la importación conserva original, fecha y activa sin publicar ni alterar contactos', async () => {
    const h = await harness(mode);
    const active = await h.storage.publish({ kind: 'indication', title: 'Vigente', content: 'Texto vigente' }, 'patient-ana-demo', (await h.storage.getActiveIndication('patient-ana-demo'))?.id ?? null, AT);
    const before = await h.storage.getPatient('patient-ana-demo');
    expect(await h.storage.listImportedIndications('patient-ana-demo')).toEqual([]);
    const result = await h.request('POST', path, h.form(h.input), h.doctor);
    expect(result.status).toBe(201);
    const { importedIndication: record } = await result.json() as { importedIndication: ImportedIndication };
    expect(record).toMatchObject({ documentDate: '2024-02-10', importedAt: AT, originalName: 'indicacion-ficticia.docx', content: h.input.content });
    expect(await h.storage.getActiveIndication('patient-ana-demo')).toEqual(active!.publication);
    expect(await h.storage.getPatient('patient-ana-demo')).toEqual(before);
    expect(await h.storage.listImportedIndications('patient-luis-demo')).toEqual([]);
    expect(await h.storage.listPrescriptionsPublishedIn(today(AT).slice(0, 7))).toHaveLength(mode === 'memory' ? 1 : 0);
    const detail = await (await h.request('GET', '/api/doctor/patients/patient-ana-demo', undefined, h.doctor)).json();
    expect(detail.importedIndications).toEqual([record]);
    const download = await h.request('GET', `${path}/${record.id}/original`, undefined, h.doctor);
    expect(download.status).toBe(200);
    expect(download.headers.get('cache-control')).toBe('no-store');
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(h.bytes);
    const patient = await h.patient();
    const listed = await (await h.request('GET', '/api/patient/publications', undefined, patient)).json();
    expect(JSON.stringify(listed)).not.toContain(h.input.content);
    expect(JSON.stringify(listed)).not.toContain(record.id);
    expect((await h.request('GET', `/api/patient/publications/${record.id}/download`, undefined, patient)).status).toBe(404);
    const events = h.d1 ? h.d1.database.prepare('SELECT * FROM audit_events').all() : h.store.audit;
    const importedEvents = events.filter(event => event.action === 'indication.imported');
    expect(importedEvents).toHaveLength(1);
    expect(JSON.stringify(importedEvents)).not.toContain(h.input.content);
    expect(JSON.stringify(importedEvents)).not.toContain('indicacion-ficticia.docx');
  });
  it('admite fecha desconocida sin inventar una y evita duplicados concurrentes', async () => {
    const h = await harness(mode);
    const input = { ...h.input, documentDate: null };
    const results = await Promise.all([1, 2].map(() => h.request('POST', path, h.form(input), h.doctor)));
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await h.storage.listImportedIndications('patient-ana-demo')).toHaveLength(1);
    expect((await h.storage.listImportedIndications('patient-ana-demo'))[0].documentDate).toBeNull();
    if (h.d1) expect(h.d1.bucket.objects.size).toBe(1);
  });
  it('rechaza formularios sin revisión, fechas inválidas y campos que intentan publicar o cambiar de paciente', async () => {
    const h = await harness(mode);
    for (const change of [{ reviewed: false }, { documentDate: '' }, { documentDate: '2024-02-30' }, { documentDate: '2099-01-01' }, { active: true }, { patientId: 'patient-luis-demo' }, { sourceSha256: 'a'.repeat(64) }]) {
      expect((await h.request('POST', path, h.form({ ...h.input, ...change }), h.doctor)).status).toBe(400);
    }
    const duplicate = h.form(); duplicate.append('word', exampleWordFile());
    expect((await h.request('POST', `${path}/preview`, duplicate, h.doctor)).status).toBe(400);
    expect(await h.storage.listImportedIndications('patient-ana-demo')).toEqual([]);
  });
  it('aísla ficha y original, requiere rol médico y revoca el acceso por cierre o vencimiento', async () => {
    const h = await harness(mode);
    const result = await (await h.request('POST', path, h.form(h.input), h.doctor)).json();
    const id = result.importedIndication.id;
    const download = `${path}/${id}/original`;
    const patient = await h.patient('00000002');
    for (const cookie of [undefined, patient]) {
      expect((await h.request('POST', `${path}/preview`, h.form(), cookie)).status).toBe(401);
      expect((await h.request('POST', path, h.form(h.input), cookie)).status).toBe(401);
      expect((await h.request('GET', download, undefined, cookie)).status).toBe(401);
    }
    expect((await h.request('GET', download.replace('patient-ana-demo', 'patient-luis-demo'), undefined, h.doctor)).status).toBe(404);
    h.advance(policy.doctorIdle);
    expect((await h.request('GET', download, undefined, h.doctor)).status).toBe(401);
    expect((await h.request('POST', path, h.form(h.input), h.doctor)).status).toBe(401);
  });
  it('no guarda si la sesión vence mientras se procesa el archivo', async () => {
    const h = await harness(mode);
    vi.spyOn(h.storage, 'totalStoredBytes').mockImplementation(async () => { h.advance(policy.doctorIdle); return 0; });
    expect((await h.request('POST', path, h.form(h.input), h.doctor)).status).toBe(401);
    expect(await h.storage.listImportedIndications('patient-ana-demo')).toEqual([]);
  });
  it('cerrar sesión invalida también la descarga del original', async () => {
    const h = await harness(mode);
    const result = await (await h.request('POST', path, h.form(h.input), h.doctor)).json();
    await h.request('POST', '/api/doctor/logout', {}, h.doctor);
    expect((await h.request('GET', `${path}/${result.importedIndication.id}/original`, undefined, h.doctor)).status).toBe(401);
  });
});

it('una falla de base limpia R2; un original alterado no se descarga', async () => {
  const h = await harness('D1');
  h.d1!.database.exec("CREATE TRIGGER fail_import BEFORE INSERT ON imported_indications BEGIN SELECT RAISE(ABORT, 'fallo ficticio'); END");
  expect((await h.request('POST', path, h.form(h.input), h.doctor)).status).toBe(500);
  expect(h.d1!.bucket.objects.size).toBe(0);
  h.d1!.database.exec('DROP TRIGGER fail_import');
  const result = await (await h.request('POST', path, h.form(h.input), h.doctor)).json();
  const key = [...h.d1!.bucket.objects.keys()][0];
  h.d1!.bucket.objects.get(key)![0] ^= 1;
  expect((await h.request('GET', `${path}/${result.importedIndication.id}/original`, undefined, h.doctor)).status).toBe(503);
});
