import type { DeliverCode } from '../app';

// Adaptador de Twilio para entregar el código de acceso del paciente por SMS
// (https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource).
//
// Sustituye al canal de WhatsApp mientras ese trámite queda postergado. Es una
// decisión reversible: la aplicación sólo conoce el puerto `DeliverCode`, así que
// volver a otro proveedor es cambiar este archivo y su composición.
//
// El SID, el token y el número remitente llegan como secretos del Worker y nunca
// se registran, se devuelven ni se incluyen en los mensajes de error. El cuerpo
// del error del proveedor tampoco se propaga: puede repetir el número destino.
export function twilioSms(options: {
  accountSid: string;
  authToken: string;
  /** Número remitente en formato internacional, por ejemplo +15551234567. */
  from: string;
  fetch?: typeof fetch;
}): DeliverCode {
  const send = options.fetch ?? fetch;
  return async (patient, code) => {
    const body = new URLSearchParams({
      To: patient.whatsapp,
      From: options.from,
      // Sólo el código: ni diagnóstico, ni nombre del estudio, ni datos clínicos.
      // Un SMS puede leerse desde la pantalla de bloqueo de un teléfono perdido.
      Body: `Tu codigo de acceso al portal del consultorio es ${code}. Vence en pocos minutos y sirve una sola vez. Si no lo pediste, ignoralo.`,
    });
    const response = await send(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(options.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${options.accountSid}:${options.authToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );
    // El fallo no se propaga al llamador: la respuesta pública ya es genérica y
    // el evento queda en la auditoría como `challenge.delivery-failed`.
    if (!response.ok) {
      throw new Error(`Twilio rechazó el envío (${response.status}).`);
    }
  };
}
