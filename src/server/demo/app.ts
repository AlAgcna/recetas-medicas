import { z } from 'zod';
import { dniSchema } from '../../shared/contracts';
import { createApp } from '../app';
import { preservePdf } from '../prescription-pdf';
import { examplePdf } from './pdf';
import { createMemoryStorage } from './storage';
import { createStore } from './store';

type DemoOptions = { now?: () => number; origin?: string };

// Composición del prototipo local: almacén en memoria, buzón simulado y rutas
// que solo existen en la demostración. La aplicación en sí (src/server/app.ts)
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
    deliverCode(patient, code, expiresAt) {
      // Buzón en memoria, único lugar que conserva el código claro para la
      // demostración. No existe proveedor de WhatsApp en el prototipo.
      store.inbox.set(patient.id, { code, expiresAt });
    },
  });

  // Herramientas de demostración intencionalmente visibles, nunca autenticación real.
  app.post('/api/demo/doctor-login', async c => {
    const session = await openSession(c, 'doctor');
    return c.json({ role: session.role, expiresAt: session.expiresAt });
  });
  app.post('/api/demo/inbox', async c => {
    const parsed = z.object({ dni: dniSchema }).safeParse(await c.req.json().catch(() => null));
    const patient = parsed.success ? await storage.findPatientByDni(parsed.data.dni) : undefined;
    const message = patient ? store.inbox.get(patient.id) : undefined;
    return c.json(message && message.expiresAt > now() ? message : {});
  });
  app.get('/api/doctor/sample-prescription', c => {
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', 'attachment; filename="receta-ficticia.pdf"');
    return c.body(examplePdf());
  });

  return { app, store };
}
