import { describe, expect, it } from 'vitest';
import { resendEmail } from '../src/server/email/resend';

// Adaptador de Resend con un `fetch` inyectado: sin red y sin credenciales
// reales. Comprueba el contrato del proveedor y que los errores no filtren ni
// la clave ni el contenido del mensaje.

function capture(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchLike = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return response;
  }) as typeof fetch;
  return { calls, fetchLike };
}

describe('adaptador de Resend', () => {
  it('envía sólo texto, al destinatario indicado y con la clave en la cabecera', async () => {
    const { calls, fetchLike } = capture(new Response('{}', { status: 200 }));
    const send = resendEmail({ apiKey: 'clave-de-prueba', from: 'onboarding@resend.dev', fetch: fetchLike });
    await send({ to: 'consultorio@ejemplo.test', subject: 'Acceso', text: 'Cuerpo de ejemplo' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({
      Authorization: 'Bearer clave-de-prueba', 'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: 'onboarding@resend.dev',
      to: ['consultorio@ejemplo.test'],
      subject: 'Acceso',
      text: 'Cuerpo de ejemplo',
    });
  });

  it('falla sin propagar el cuerpo del proveedor ni la clave', async () => {
    const { fetchLike } = capture(new Response('{"message":"clave-de-prueba rechazada"}', { status: 422 }));
    const send = resendEmail({ apiKey: 'clave-de-prueba', from: 'onboarding@resend.dev', fetch: fetchLike });
    let error: Error | undefined;
    try {
      await send({ to: 'consultorio@ejemplo.test', subject: 'Acceso', text: 'Cuerpo' });
    } catch (caught) {
      error = caught as Error;
    }
    expect(error?.message).toBe('Resend rechazó el envío (422).');
    expect(error?.message).not.toContain('clave-de-prueba');
  });
});
