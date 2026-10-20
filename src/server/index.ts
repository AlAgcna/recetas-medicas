// Entrada de producción. Arma la aplicación real por pedido: los bindings viven
// en `env` y los secretos los carga el usuario con `wrangler secret put`.
//
// No importa nada de `src/server/demo/` (buzones, atajos ni datos ficticios) y
// las páginas públicas con JavaScript quedan en `public/` y no pasan por acá.
//
// Sin configuración, la aplicación no finge haber enviado nada: el ingreso de la
// médica responde 503 sin correo y el código del paciente falla de forma
// genérica si no hay SMS configurado (ver `createApp`).
import { createApp } from './app';
import type { FileBucket, SqlDatabase } from './d1/database';
import { createD1Storage } from './d1/storage';
import { resendEmail } from './email/resend';
import { twilioSms } from './sms/twilio';

/** Lo que el Worker recibe en `env`: bindings, variables y secretos. */
export type ProductionEnv = {
  DB: SqlDatabase;
  BUCKET: FileBucket;
  /** Origen público del portal; debe coincidir con el dominio desplegado. */
  PORTAL_ORIGIN: string;
  /** Secreto del verificador de códigos: el mismo en todos los pedidos. */
  SESSION_SECRET: string;
  /** Casilla de la médica: único destino del enlace de acceso. */
  DOCTOR_EMAIL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
};

export default {
  fetch(request: Request, env: ProductionEnv) {
    // Sin secreto del verificador, la aplicación generaría una clave distinta en
    // cada petición y ningún código de acceso podría verificarse. Falla de forma
    // explícita en lugar de quedar rota en silencio (basta con `wrangler secret
    // put SESSION_SECRET`).
    if (!env.SESSION_SECRET) throw new Error('Falta el secreto SESSION_SECRET: cargalo con `wrangler secret put SESSION_SECRET`.');
    const now = Date.now;
    const storage = createD1Storage(env.DB, env.BUCKET);
    // Cada proveedor se habilita sólo si están sus credenciales. Sin ellas, el
    // canal responde de forma genérica y queda el evento de auditoría: nunca se
    // abre acceso ni se promete un envío que no va a ocurrir.
    const configuredEmail = env.RESEND_API_KEY && env.RESEND_FROM && env.DOCTOR_EMAIL;
    const configuredSms = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER;
    const { app } = createApp({
      storage,
      now,
      origin: env.PORTAL_ORIGIN,
      challengeSecret: env.SESSION_SECRET,
      // La cookie de producción: sin prefijo y con `Secure`. No se pasa una
      // política propia porque el portal productivo sirve por HTTPS.
      health: { mode: 'worker', persistent: true, whatsapp: Boolean(configuredSms) },
      ...(configuredEmail ? {
        doctorEmail: env.DOCTOR_EMAIL!,
        sendEmail: resendEmail({ apiKey: env.RESEND_API_KEY!, from: env.RESEND_FROM! }),
      } : {}),
      deliverCode: configuredSms
        ? twilioSms({
            accountSid: env.TWILIO_ACCOUNT_SID!,
            authToken: env.TWILIO_AUTH_TOKEN!,
            from: env.TWILIO_FROM_NUMBER!,
          })
        // Sin SMS configurado no hay a quién entregar el código. Se registra el
        // fallo en lugar de dejar un desafío sin salida.
        : () => { throw new Error('SMS no configurado.'); },
    });
    return app.fetch(request);
  },
};
