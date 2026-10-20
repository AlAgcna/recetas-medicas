import { describe, expect, it } from 'vitest';
import { twilioSms } from '../src/server/sms/twilio';
import type { Patient } from '../src/shared/contracts';

// Adaptador de Twilio con un `fetch` inyectado: sin red y sin credenciales
// reales. Comprueba el contrato del proveedor y que los errores no filtren ni el
// token ni el contenido del mensaje.

const patient: Patient = {
  id: 'patient-ana-demo',
  dni: '00000001',
  firstName: 'Ana',
  lastName: 'Ejemplo',
  whatsapp: '+5493800000001',
  contactVerified: true,
  insurance: 'APOS',
  memberNumber: '',
  createdAt: Date.parse('2026-10-19T12:00:00Z'),
};

function capture(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchLike = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return response;
  }) as typeof fetch;
  return { calls, fetchLike };
}

describe('adaptador de Twilio', () => {
  it('envía el código al contacto verificado, con la credencial y el número remitente', async () => {
    const { calls, fetchLike } = capture(new Response('{"sid":"SM..."}', { status: 201 }));
    const deliver = twilioSms({ accountSid: 'AC123', authToken: 'token-de-prueba', from: '+15551234567', fetch: fetchLike });
    await deliver(patient, '123456', Date.parse('2026-10-19T12:10:00Z'));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({
      Authorization: `Basic ${btoa('AC123:token-de-prueba')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const body = new URLSearchParams(String(calls[0].init.body));
    expect(body.get('To')).toBe('+5493800000001');
    expect(body.get('From')).toBe('+15551234567');
    expect(body.get('Body')).toContain('123456');
    // Sólo el código: sin datos clínicos ni identidad del paciente.
    expect(body.get('Body')).not.toContain('Ana');
    expect(body.get('Body')).not.toContain('00000001');
  });

  it('falla sin propagar el cuerpo del proveedor ni el token', async () => {
    const { fetchLike } = capture(new Response('{"code":20003,"message":"Authenticate token-de-prueba"}', { status: 401 }));
    const deliver = twilioSms({ accountSid: 'AC123', authToken: 'token-de-prueba', from: '+15551234567', fetch: fetchLike });
    let error: Error | undefined;
    try {
      await deliver(patient, '123456', Date.parse('2026-10-19T12:10:00Z'));
    } catch (caught) {
      error = caught as Error;
    }
    expect(error?.message).toBe('Twilio rechazó el envío (401).');
    expect(error?.message).not.toContain('token-de-prueba');
    expect(error?.message).not.toContain('5493800000001');
  });
});
