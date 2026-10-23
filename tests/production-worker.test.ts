import { describe, expect, it, vi } from 'vitest';
import productionWorker, { type ProductionEnv } from '../src/server/index';
import { d1Storage, sqliteD1 } from './helpers/sqlite-d1';

// Entrada productiva real: el Worker sobre D1/R2 (doble local), con y sin
// proveedores configurados. Comprueba los invariantes de seguridad que importan
// antes de desplegar: sin credenciales no se abre acceso ni se finge un envío, y
// ninguna herramienta simulada de la demostración queda expuesta.

const origin = 'https://portal.ejemplo.test';

// La aplicación arma su propio adaptador a partir de los bindings de `env`. En
// las pruebas se le pasa el doble de D1 sobre SQLite real y un bucket en memoria.
async function worker(overrides: Partial<ProductionEnv> = {}) {
  const { database, bucket, storage } = d1Storage();
  await storage.createPatient({
    id: 'patient-ana', dni: '00000001', firstName: 'Ana', lastName: 'Ejemplo',
    whatsapp: '+5493800000001', insurance: 'APOS', memberNumber: '', contactVerified: true,
    createdAt: Date.parse('2026-10-19T12:00:00Z'),
  });
  const env: ProductionEnv = {
    DB: sqliteD1(database),
    BUCKET: bucket,
    PORTAL_ORIGIN: origin,
    SESSION_SECRET: 'secreto-de-prueba',
    ...overrides,
  };
  const request = (path: string, init: RequestInit = {}) => productionWorker.fetch(new Request(`${origin}${path}`, {
    ...init,
    headers: { Origin: origin, 'X-Portal-Request': '1', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  }), env);
  return { request };
}

describe('entrada productiva', () => {
  it('sin SESSION_SECRET falla de forma explícita en lugar de arrancar rota', async () => {
    const { database, bucket } = d1Storage();
    const env: ProductionEnv = {
      DB: sqliteD1(database), BUCKET: bucket, PORTAL_ORIGIN: origin, SESSION_SECRET: '',
    };
    expect(() => productionWorker.fetch(new Request(`${origin}/`), env)).toThrow(/SESSION_SECRET/);
  });

  it('sin proveedores configurados no abre acceso: el código de la médica responde 503', async () => {
    const { request } = await worker();
    expect((await request('/api/doctor/request-code', { method: 'POST' })).status).toBe(503);
  });

  it('sin SMS configurado el pedido de código responde de forma genérica', async () => {
    const { request } = await worker();
    const response = await request('/api/patient/request-code', { method: 'POST', body: JSON.stringify({ dni: '00000001' }) });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('00000001');
    // Un DNI inexistente recibe exactamente la misma respuesta.
    const unknown = await request('/api/patient/request-code', { method: 'POST', body: JSON.stringify({ dni: '00000099' }) });
    expect(await unknown.text()).toBe(text);
  });

  it('no expone ninguna ruta de la demostración', async () => {
    const { request } = await worker();
    for (const path of ['/api/demo/doctor-login', '/api/demo/inbox', '/api/demo/mailbox', '/api/doctor/sample-prescription']) {
      const response = await request(path, { method: path === '/api/demo/mailbox' || path.endsWith('sample-prescription') ? 'GET' : 'POST' });
      // Ninguna ruta simulada está montada: no responde 2xx ni entrega datos.
      expect(response.ok).toBe(false);
      const text = await response.text();
      expect(text).not.toMatch(/code|expiresAt|messages/i);
    }
  });

  it('sin sesión, una ruta profesional responde 401 aunque la API esté montada', async () => {
    const { request } = await worker();
    expect((await request('/api/doctor/patients', { method: 'GET' })).status).toBe(401);
  });

  it('un código emitido en una invocación abre sesión en otra con el mismo secreto, sin depender de Twilio', async () => {
    let code = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const email = JSON.parse(String(init.body)) as { text: string };
      code = email.text.match(/\b\d{6}\b/)![0];
      return Response.json({ id: 'correo-ficticio' });
    }));
    try {
      const { request } = await worker({
        RESEND_API_KEY: 'clave-ficticia', RESEND_FROM: 'portal@ejemplo.test', DOCTOR_EMAIL: 'medica@ejemplo.test',
      });
      const requested = await request('/api/doctor/request-code', {
        method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.1', 'CF-IPCountry': 'AR' },
        body: JSON.stringify({ website: '' }),
      });
      expect(requested.status).toBe(200);
      expect(code).toMatch(/^\d{6}$/);
      const opened = await request('/api/doctor/verify-code', { method: 'POST', body: JSON.stringify({ code }) });
      expect(opened.status).toBe(200);
      const cookie = opened.headers.get('set-cookie')!.split(';')[0];
      expect((await request('/api/doctor/session', { headers: { Cookie: cookie } })).status).toBe(200);
      expect((await request('/api/doctor/verify-code', { method: 'POST', body: JSON.stringify({ code }) })).status).toBe(401);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
