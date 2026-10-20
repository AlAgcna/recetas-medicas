import { z } from 'zod';
import { dniSchema } from '../../shared/contracts';
import { createApp, demoCookies } from '../app';
import type { OutgoingEmail } from '../email/port';
import { preservePdf } from '../prescription-pdf';
import type { Storage } from '../storage/port';
import { examplePdf } from './pdf';
import { createMemoryStorage } from './storage';
import { createStore } from './store';

type DemoOptions = { now?: () => number; origin?: string };
type DemoApp = ReturnType<typeof createApp>['app'];
/** Código en claro del buzón simulado. Sólo existe en la demostración y en el desarrollo local. */
export type DemoInbox = Map<string, { code: string; expiresAt: number }>;
/** Correo saliente simulado. Reemplaza al proveedor real en el desarrollo local. */
export type DemoMailbox = OutgoingEmail[];

// Herramientas de demostración intencionalmente visibles, nunca autenticación
// real. Las comparten el prototipo en memoria y la entrada local con D1 y R2
// (`src/server/demo/worker.ts`); ninguna llega a la entrada de producción.
export function mountDemoTools(app: DemoApp, options: {
  storage: Storage;
  openSession: ReturnType<typeof createApp>['openSession'];
  inbox: DemoInbox;
  mailbox: DemoMailbox;
  now: () => number;
}) {
  const { storage, openSession, inbox, mailbox, now } = options;
  app.post('/api/demo/doctor-login', async c => {
    const session = await openSession(c, 'doctor');
    return c.json({ role: session.role, expiresAt: session.expiresAt });
  });
  app.post('/api/demo/inbox', async c => {
    const parsed = z.object({ dni: dniSchema }).safeParse(await c.req.json().catch(() => null));
    const patient = parsed.success ? await storage.findPatientByDni(parsed.data.dni) : undefined;
    const message = patient ? inbox.get(patient.id) : undefined;
    return c.json(message && message.expiresAt > now() ? message : {});
  });
  // Buzón de correo simulado: expone el enlace de acceso para poder probar el
  // ingreso de la médica sin proveedor ni casilla real, igual que `/inbox`.
  app.get('/api/demo/mailbox', c => c.json({ messages: mailbox.slice(-5) }));
  app.get('/api/doctor/sample-prescription', c => {
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', 'attachment; filename="receta-ficticia.pdf"');
    return c.body(examplePdf());
  });
}

// Composición del prototipo local: almacén en memoria, buzón simulado y rutas
// que sólo existen en la demostración. La aplicación en sí (src/server/app.ts)
// no conoce ninguno de estos atajos.
export function createDemoApp(options: DemoOptions = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('Simulación no permitida en producción.');
  const now = options.now ?? Date.now;
  const origin = options.origin ?? 'http://127.0.0.1:5173';
  const store = createStore(now());
  const storage = createMemoryStorage(store);
  const encoder = new TextEncoder();
  const ready = preservePdf(encoder.encode(examplePdf()), 'example').then(pdf => {
    const publication = store.publications.get('publication-luis-demo')!;
    store.files.set(publication.id, pdf.bytes);
    store.publications.set(publication.id, { ...publication, pdf: pdf.metadata });
  });
  const { app, openSession } = createApp({
    storage, now, origin, ready,
    health: { mode: 'local-prototype', persistent: false, whatsapp: false },
    // Corre por HTTP en loopback, así que pide la política de cookies de la
    // demostración en lugar de la de producción.
    cookie: demoCookies,
    // El ingreso de la médica usa el mismo circuito que producción, pero el
    // correo queda en un buzón en memoria en lugar de salir a un proveedor.
    doctorEmail: 'consultorio@ejemplo.test',
    sendEmail(email) {
      store.mailbox.push(email);
    },
    deliverCode(patient, code, expiresAt) {
      // Buzón en memoria, único lugar que conserva el código claro para la
      // demostración. No existe proveedor de WhatsApp en el prototipo.
      store.inbox.set(patient.id, { code, expiresAt });
    },
  });
  mountDemoTools(app, { storage, openSession, inbox: store.inbox, mailbox: store.mailbox, now });

  return { app, store };
}
