import type { SendEmail } from './port';

// Adaptador de Resend (https://resend.com/docs/api-reference/emails/send-email).
//
// La clave llega como secreto del Worker y nunca se registra, se devuelve ni se
// incluye en los mensajes de error. Se envía sólo texto plano: el correo del
// portal lleva un enlace de acceso, no HTML ni adjuntos.
export function resendEmail(options: { apiKey: string; from: string; fetch?: typeof fetch }): SendEmail {
  const send = options.fetch ?? fetch;
  return async email => {
    const response = await send('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: options.from, to: [email.to], subject: email.subject, text: email.text }),
    });
    // El cuerpo del error no se propaga: puede repetir la dirección o el mensaje.
    if (!response.ok) throw new Error(`Resend rechazó el envío (${response.status}).`);
  };
}
