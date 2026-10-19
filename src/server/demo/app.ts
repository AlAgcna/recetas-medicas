import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { amendmentRequestSchema, consultationSchema, dniSchema, generalIndicationSchema, monthSchema, patientSchema, pdfPolicy, policy, publicationRequestSchema, publicationSchema, today, type Consultation, type Publication } from '../../shared/contracts';
import { createStore, type DemoSession } from './store';
import { examplePdf } from './pdf';
import { monthlyStatistics } from './statistics';
import { activeIndication, patientProjection, publish, visiblePublications } from './publications';
import { pdfFromFile, PdfInputError, preservePdf, prescriptionForm, sha256 } from './prescription-pdf';

type Env = { Variables: { session: DemoSession } };
type DemoOptions = { now?: () => number; origin?: string };
const encoder = new TextEncoder();
const genericRequest = { message: 'Si los datos corresponden a un contacto habilitado, recibirás un código de acceso.' };
const verificationSchema = z.object({ dni: dniSchema, code: z.string().regex(/^\d{6}$/) });
const editablePatientSchema = z.object({
  firstName: patientSchema.shape.firstName.removeDefault().optional(),
  lastName: patientSchema.shape.lastName.removeDefault().optional(),
  insurance: patientSchema.shape.insurance.removeDefault().optional(),
  memberNumber: patientSchema.shape.memberNumber.removeDefault().optional(),
}).strict();

function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}

async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}

function otp() {
  let random: number;
  do { random = crypto.getRandomValues(new Uint32Array(1))[0]; } while (random >= 4_294_000_000);
  return String(random % 1_000_000).padStart(6, '0');
}

const cookieName = (role: DemoSession['role']) => `demo_${role}`;
function cookie(c: Context, value: string, session: DemoSession, now: number) {
  // HTTP y nombre demo solo para loopback local. Producción no monta estas rutas.
  setCookie(c, cookieName(session.role), value, {
    httpOnly: true, sameSite: 'Strict', path: '/', secure: false,
    maxAge: Math.max(0, Math.ceil((session.expiresAt - now) / 1000)),
  });
}

async function body(c: Context) {
  return c.req.json().catch(() => null);
}

export function createDemoApp(options: DemoOptions = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('Simulación no permitida en producción.');
  const now = options.now ?? Date.now;
  const origin = options.origin ?? 'http://127.0.0.1:5173';
  const store = createStore(now());
  const ready = preservePdf(encoder.encode(examplePdf()), 'example').then(pdf => {
    store.prescriptionFiles.set('publication-luis-demo', pdf);
    const publication = store.publications.get('publication-luis-demo')!;
    store.publications.set(publication.id, { ...publication, pdf: pdf.metadata });
  });
  const secret = crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const app = new Hono<Env>();
  const audit = (action: string, resource: string) => store.audit.push({ action, resource, at: now() });

  // Protección secundaria orientativa, local y de un único proceso. No sustituye
  // límites distribuidos, presupuesto ni detección de abuso en producción.
  function withinLimit(key: string, maximum: number, duration: number) {
    const current = store.rateLimits.get(key);
    if (!current || current.expiresAt <= now()) {
      store.rateLimits.set(key, { count: 1, expiresAt: now() + duration });
      return true;
    }
    current.count += 1;
    return current.count <= maximum;
  }

  app.use('*', async (c, next) => {
    await ready;
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      if (c.req.header('Origin') !== origin || c.req.header('X-Portal-Request') !== '1') {
        return c.json({ message: 'Solicitud no permitida.' }, 403);
      }
    }
    await next();
  });
  const jsonBodyLimit = bodyLimit({ maxSize: 32 * 1024, onError: (c: Context) => c.json({ message: 'El contenido supera el tamaño permitido.' }, 413) });
  app.use('*', async (c, next) => {
    // El multipart tiene su propio lector acotado, después de autenticar.
    if (c.req.method === 'POST' && /^\/api\/doctor\/patients\/[^/]+\/prescriptions$/.test(c.req.path)) return next();
    return jsonBodyLimit(c, next);
  });
  app.onError(caught => {
    // No registrar cuerpos, cookies, códigos ni información clínica.
    void caught;
    return new Response(JSON.stringify({ message: 'No se pudo completar la operación.' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  });
  app.notFound(c => c.json({ message: 'Recurso no disponible.' }, 404));

  async function openSession(c: Context, role: DemoSession['role'], patientId?: string) {
    const previous = getCookie(c, cookieName(role));
    if (previous) store.sessions.delete(await digest(previous));
    const value = token();
    const session: DemoSession = { role, patientId, expiresAt: now() + (role === 'doctor' ? policy.doctorIdle : policy.patientLifetime) };
    store.sessions.set(await digest(value), session);
    cookie(c, value, session, now());
    audit('session.created', role);
    return session;
  }

  function authenticate(role: DemoSession['role']): MiddlewareHandler<Env> {
    return async (c, next) => {
      const value = getCookie(c, cookieName(role));
      const hash = value ? await digest(value) : undefined;
      const session = hash ? store.sessions.get(hash) : undefined;
      if (!session || session.role !== role || session.expiresAt <= now()) {
        if (hash) store.sessions.delete(hash);
        deleteCookie(c, cookieName(role), { path: '/' });
        return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
      }
      c.set('session', session);
      await next();
    };
  }

  function activity(c: Context<Env>) {
    const session = c.get('session');
    session.expiresAt = now() + policy.doctorIdle;
    const value = getCookie(c, cookieName('doctor'));
    if (value) cookie(c, value, session, now());
  }

  function stillAuthenticated(c: Context<Env>) {
    const session = c.get('session');
    return session.expiresAt > now() && [...store.sessions.values()].includes(session);
  }

  async function downloadPrescription(c: Context<Env>, publication: Publication) {
    const stored = store.prescriptionFiles.get(publication.id);
    const manifest = publication.pdf;
    const bytes = stored?.bytes.slice();
    if (!bytes || !manifest || bytes.length !== manifest.size || await sha256(bytes) !== manifest.sha256) {
      audit('prescription.integrity-failed', publication.id);
      return c.json({ message: 'El PDF no está disponible o no se pudo verificar su integridad. Contactá al consultorio.' }, 503);
    }
    if (!stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    const current = store.publications.get(publication.id);
    if (current !== publication || !current.active) return c.json({ message: 'Documento no disponible.' }, 404);
    audit('publication.downloaded', publication.id);
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', 'attachment; filename="receta.pdf"');
    c.header('Content-Length', String(manifest.size));
    c.header('X-Document-SHA256', manifest.sha256);
    // Nueva copia de los mismos bytes: no exponer un buffer modificable del almacén.
    return c.body(bytes.buffer);
  }

  app.get('/api/health', c => c.json({ mode: 'local-prototype', persistent: false, whatsapp: false }));

  // Herramientas de demostración intencionalmente visibles, nunca autenticación real.
  app.post('/api/demo/doctor-login', async c => {
    const session = await openSession(c, 'doctor');
    return c.json({ role: session.role, expiresAt: session.expiresAt });
  });
  app.post('/api/demo/inbox', async c => {
    const parsed = z.object({ dni: dniSchema }).safeParse(await body(c));
    const patient = parsed.success ? [...store.patients.values()].find(p => p.dni === parsed.data.dni) : undefined;
    const message = patient ? store.inbox.get(patient.id) : undefined;
    return c.json(message && message.expiresAt > now() ? message : {});
  });

  app.use('/api/doctor/*', authenticate('doctor'));
  app.get('/api/doctor/session', c => c.json({ role: 'doctor', expiresAt: c.get('session').expiresAt }));
  app.post('/api/doctor/activity', c => {
    activity(c);
    return c.json({ role: 'doctor', expiresAt: c.get('session').expiresAt });
  });
  app.post('/api/doctor/logout', async c => {
    const value = getCookie(c, cookieName('doctor'));
    if (value) store.sessions.delete(await digest(value));
    deleteCookie(c, cookieName('doctor'), { path: '/' });
    return c.json({ message: 'Sesión cerrada.' });
  });
  app.get('/api/doctor/patients', c => {
    activity(c);
    const query = (c.req.query('q') ?? '').toLocaleLowerCase('es').replace(/[.]/g, '').trim();
    const patients = [...store.patients.values()].filter(patient =>
      `${patient.dni} ${patient.firstName} ${patient.lastName}`.toLocaleLowerCase('es').includes(query));
    return c.json({ patients, stats: { patients: store.patients.size, consultations: [...store.consultations.values()].filter(item => !item.supersededAt).length, publications: store.publications.size } });
  });
  app.get('/api/doctor/statistics', c => {
    const parsed = monthSchema.safeParse(c.req.query('month') ?? today(now()).slice(0, 7));
    if (!parsed.success) return c.json({ message: 'Seleccioná un mes válido.' }, 400);
    activity(c);
    audit('statistics.viewed', parsed.data);
    return c.json(monthlyStatistics(store, parsed.data));
  });
  app.get('/api/doctor/general-indications', c => {
    activity(c);
    return c.json({
      active: activeIndication(store, null),
      history: [...store.publications.values()].filter(item => item.scope === 'general' && item.patientId === null)
        .sort((a, b) => b.publishedAt - a.publishedAt),
    });
  });
  app.get('/api/doctor/sample-prescription', c => {
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', 'attachment; filename="receta-ficticia.pdf"');
    return c.body(examplePdf());
  });
  app.post('/api/doctor/general-indications', async c => {
    const parsed = generalIndicationSchema.safeParse(await body(c));
    if (!stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    if (!parsed.success) return c.json({ message: 'Revisá la indicación general. No puede ser una receta ni tener un destinatario individual.' }, 400);
    const { expectedActiveId, ...input } = parsed.data;
    const result = publish(store, input, null, expectedActiveId, now());
    if (!result) return c.json({ message: 'La indicación general activa cambió. Volvé a abrir el formulario y revisá qué versión vas a reemplazar.' }, 409);
    activity(c);
    if (result.replacedId) audit('indication.superseded', result.replacedId);
    audit('general-indication.published', result.publication.id);
    return c.json({ publication: result.publication }, 201);
  });

  app.post('/api/doctor/patients/:id/prescriptions', async c => {
    const patientId = c.req.param('id');
    if (!store.patients.has(patientId)) return c.json({ message: 'No se encontró la ficha.' }, 404);
    try {
      const form = await prescriptionForm(c.req.raw);
      if ([...form.keys()].some(key => !['title', 'content', 'pdf'].includes(key)) || ['title', 'content', 'pdf'].some(key => form.getAll(key).length !== 1)) {
        throw new PdfInputError('El formulario de la receta tiene campos inválidos o duplicados.');
      }
      const parsed = publicationSchema.safeParse({ kind: 'prescription', title: form.get('title'), content: form.get('content') });
      if (!parsed.success) throw new PdfInputError(parsed.error.issues[0]?.message ?? 'Revisá los datos de la receta.');
      const file = form.get('pdf');
      if (!(file instanceof File)) throw new PdfInputError('Adjuntá el PDF original de la receta.');
      const stored = await pdfFromFile(file);
      if (!stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
      const total = [...store.prescriptionFiles.values()].reduce((sum, item) => sum + item.bytes.length, 0);
      if (total + stored.bytes.length > pdfPolicy.maxStoredBytes) throw new PdfInputError('Se alcanzó el límite de PDFs en memoria de esta demostración.', 413);
      const result = publish(store, parsed.data, patientId, null, now())!;
      const publication = { ...result.publication, pdf: stored.metadata };
      store.prescriptionFiles.set(publication.id, stored);
      store.publications.set(publication.id, publication);
      activity(c);
      audit('prescription.published', publication.id);
      return c.json({ publication }, 201);
    } catch (error) {
      if (error instanceof PdfInputError) return c.json({ message: error.message }, error.status);
      throw error;
    }
  });
  app.get('/api/doctor/patients/:id/prescriptions/:publicationId/download', async c => {
    const publication = store.publications.get(c.req.param('publicationId'));
    if (!publication || publication.kind !== 'prescription' || publication.scope !== 'patient' || !publication.active || publication.patientId !== c.req.param('id')) {
      return c.json({ message: 'Documento no disponible.' }, 404);
    }
    return downloadPrescription(c, publication);
  });
  app.post('/api/doctor/patients', async c => {
    const parsed = patientSchema.safeParse(await body(c));
    if (!stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    if (!parsed.success) return c.json({ message: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }, 400);
    if ([...store.patients.values()].some(p => p.dni === parsed.data.dni)) return c.json({ message: 'Ya existe un paciente con ese DNI. Buscalo antes de crear otra ficha.' }, 409);
    const patient = { ...parsed.data, id: crypto.randomUUID(), createdAt: now() };
    store.patients.set(patient.id, patient);
    activity(c);
    audit('patient.created', patient.id);
    return c.json({ patient }, 201);
  });
  app.patch('/api/doctor/patients/:id', async c => {
    const patient = store.patients.get(c.req.param('id'));
    if (!patient) return c.json({ message: 'No se encontró la ficha.' }, 404);
    const parsed = editablePatientSchema.safeParse(await body(c));
    if (!stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    if (!parsed.success) return c.json({ message: 'Revisá los datos. DNI y WhatsApp no se modifican en este prototipo.' }, 400);
    const updated = { ...patient, ...parsed.data };
    store.patients.set(patient.id, updated);
    activity(c);
    audit('patient.updated', patient.id);
    return c.json({ patient: updated });
  });
  app.get('/api/doctor/patients/:id', c => {
    const id = c.req.param('id');
    const patient = store.patients.get(id);
    if (!patient) return c.json({ message: 'No se encontró la ficha.' }, 404);
    activity(c);
    audit('patient.viewed', id);
    return c.json({
      patient,
      consultations: [...store.consultations.values()].filter(item => item.patientId === id).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt),
      publications: [...store.publications.values()].filter(item => item.patientId === id),
      generalIndication: activeIndication(store, null),
      documents: [...store.documents.values()].filter(item => item.patientId === id),
    });
  });

  async function saveConsultation(c: Context<Env>) {
    const patientId = c.req.param('id');
    if (!patientId) return c.json({ message: 'No se encontró la ficha.' }, 404);
    const patient = store.patients.get(patientId);
    if (!patient) return c.json({ message: 'No se encontró la ficha.' }, 404);
    const id = c.req.param('consultationId');
    const previous = id ? store.consultations.get(id) : undefined;
    if (id && (!previous || previous.patientId !== patientId)) return c.json({ message: 'Consulta no disponible.' }, 404);
    if (previous?.status === 'finalized') return c.json({ message: 'La consulta finalizada no se sobrescribe: la corrección se registra como una enmienda.' }, 409);
    const parsed = consultationSchema.safeParse(await body(c));
    if (!stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    if (!parsed.success) return c.json({ message: parsed.error.issues[0]?.message ?? 'Revisá la consulta.' }, 400);
    const currentPatient = store.patients.get(patientId);
    if (!currentPatient) return c.json({ message: 'No se encontró la ficha.' }, 404);
    if (parsed.data.status === 'finalized' && (!currentPatient.firstName || !currentPatient.lastName)) return c.json({ message: 'Completá nombre y apellido antes de finalizar una consulta.' }, 400);
    // Otra solicitud puede haber finalizado el registro durante la lectura del cuerpo.
    if (id && store.consultations.get(id)?.status === 'finalized') return c.json({ message: 'La consulta finalizada no se sobrescribe: la corrección se registra como una enmienda.' }, 409);
    const consultation = { ...parsed.data, id: id ?? crypto.randomUUID(), patientId, updatedAt: now(), insuranceAtVisit: currentPatient.insurance };
    store.consultations.set(consultation.id, consultation);
    activity(c);
    audit(`consultation.${consultation.status}`, consultation.id);
    return c.json({ consultation }, previous ? 200 : 201);
  }
  app.post('/api/doctor/patients/:id/consultations', saveConsultation);
  app.put('/api/doctor/patients/:id/consultations/:consultationId', saveConsultation);
  // Una enmienda nunca pisa el texto en silencio: crea una versión vigente, marca
  // la revisada como reemplazada y guarda el motivo. Solo se enmienda lo finalizado
  // y solo la versión vigente.
  app.post('/api/doctor/patients/:id/consultations/:consultationId/amendments', async c => {
    const patientId = c.req.param('id');
    if (!patientId || !store.patients.has(patientId)) return c.json({ message: 'No se encontró la ficha.' }, 404);
    const reviewed = store.consultations.get(c.req.param('consultationId') ?? '');
    if (!reviewed || reviewed.patientId !== patientId) return c.json({ message: 'Consulta no disponible.' }, 404);
    const parsed = amendmentRequestSchema.safeParse(await body(c));
    if (!stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    if (!parsed.success) return c.json({ message: parsed.error.issues[0]?.message ?? 'Revisá la enmienda.' }, 400);
    if (reviewed.status !== 'finalized') return c.json({ message: 'Solo se enmiendan consultas finalizadas. Continuá el borrador en su lugar.' }, 409);
    if (reviewed.supersededAt) return c.json({ message: 'Esa versión ya fue reemplazada. Abrí la versión vigente para corregirla.' }, 409);
    // Otra solicitud puede haber reemplazado la versión durante la lectura del cuerpo.
    const current = store.consultations.get(reviewed.id);
    if (!current || current.status !== 'finalized' || current.supersededAt) return c.json({ message: 'La consulta cambió mientras la revisabas. Actualizá la ficha y revisá la versión vigente.' }, 409);
    const { amendmentReason, ...input } = parsed.data;
    const amendment: Consultation = {
      ...input, id: crypto.randomUUID(), patientId, updatedAt: now(),
      // La cobertura es la de la visita: una corrección del registro no la cambia.
      insuranceAtVisit: current.insuranceAtVisit,
      supersedesId: current.id, amendmentReason,
    };
    // Sección crítica síncrona de un proceso local. La versión anterior no se
    // borra: queda con su texto original y la fecha del reemplazo.
    store.consultations.set(current.id, { ...current, supersededAt: amendment.updatedAt });
    store.consultations.set(amendment.id, amendment);
    activity(c);
    audit('consultation.superseded', current.id);
    audit('consultation.finalized', amendment.id);
    return c.json({ consultation: amendment }, 201);
  });
  app.post('/api/doctor/patients/:id/publications', async c => {
    const patientId = c.req.param('id');
    if (!store.patients.has(patientId)) return c.json({ message: 'No se encontró la ficha.' }, 404);
    const parsed = publicationRequestSchema.safeParse(await body(c));
    if (!stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    if (!parsed.success) return c.json({ message: parsed.error.issues[0]?.message ?? 'Revisá la publicación.' }, 400);
    const { expectedActiveId, ...input } = parsed.data;
    if (input.kind === 'prescription') return c.json({ message: 'Para publicar una receta, adjuntá su PDF original en el formulario de recetas.' }, 400);
    const result = publish(store, input, patientId, expectedActiveId, now());
    if (!result) return c.json({ message: 'La indicación específica activa cambió. Volvé a abrir el formulario y revisá qué versión vas a reemplazar.' }, 409);
    activity(c);
    if (result.replacedId) audit('indication.superseded', result.replacedId);
    audit('publication.published', result.publication.id);
    return c.json({ publication: result.publication }, 201);
  });

  app.post('/api/patient/request-code', async c => {
    // Cota global de prototipo. El límite por paciente es independiente del navegador.
    if (!withinLimit('requests', 50, policy.codeCooldown)) return c.json(genericRequest);
    const parsed = z.object({ dni: dniSchema }).safeParse(await body(c));
    if (!parsed.success) return c.json(genericRequest);
    const patient = [...store.patients.values()].find(p => p.dni === parsed.data.dni && p.contactVerified);
    if (!patient || (store.nextRequestAt.get(patient.id) ?? 0) > now()) return c.json(genericRequest);
    // Reserva sin await: sección crítica de un único proceso. No es implementación D1.
    const generatedAt = now();
    const reservedUntil = generatedAt + policy.codeCooldown;
    const expiresAt = generatedAt + policy.codeLifetime;
    store.nextRequestAt.set(patient.id, reservedUntil);
    const code = otp();
    const id = crypto.randomUUID();
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await secret, encoder.encode(`${id}:${code}`)));
    if (store.nextRequestAt.get(patient.id) !== reservedUntil || now() >= expiresAt) return c.json(genericRequest);
    store.challenges.set(patient.id, {
      id, patientId: patient.id, verifier: Array.from(signature, b => b.toString(16).padStart(2, '0')).join(''),
      expiresAt, attempts: 0, consumed: false,
    });
    // Buzón en memoria, único lugar que conserva el código claro para la demostración.
    // No existe proveedor de WhatsApp ni endpoint de buzón en producción.
    store.inbox.set(patient.id, { code, expiresAt });
    audit('challenge.created', id);
    return c.json(genericRequest);
  });
  app.post('/api/patient/verify-code', async c => {
    const rejected = () => c.json({ message: 'Código incorrecto, vencido o no disponible. Revisalo o solicitá uno nuevo.' }, 401);
    if (!withinLimit('verifications', 200, policy.codeCooldown)) return rejected();
    const parsed = verificationSchema.safeParse(await body(c));
    if (!parsed.success) return rejected();
    const patient = [...store.patients.values()].find(p => p.dni === parsed.data.dni && p.contactVerified);
    const challenge = patient ? store.challenges.get(patient.id) : undefined;
    if (!challenge || challenge.consumed || challenge.expiresAt <= now() || challenge.attempts >= policy.codeAttempts) return rejected();
    const signature = Uint8Array.from(challenge.verifier.match(/../g)!, item => parseInt(item, 16));
    const matches = await crypto.subtle.verify('HMAC', await secret, signature, encoder.encode(`${challenge.id}:${parsed.data.code}`));
    // Revalidar después de los await y consumir antes del siguiente await.
    if (store.challenges.get(challenge.patientId) !== challenge || challenge.consumed || challenge.expiresAt <= now() || challenge.attempts >= policy.codeAttempts) return rejected();
    challenge.attempts += 1;
    if (!matches) return rejected();
    challenge.consumed = true;
    store.inbox.delete(challenge.patientId);
    const session = await openSession(c, 'patient', challenge.patientId);
    return c.json({ role: 'patient', expiresAt: session.expiresAt });
  });

  const patientAuth = authenticate('patient');
  app.get('/api/patient/session', patientAuth, c => {
    const session = c.get('session');
    const patient = store.patients.get(session.patientId!);
    if (!patient) return c.json({ message: 'Sesión no disponible.' }, 401);
    return c.json({ role: 'patient', expiresAt: session.expiresAt, patient: { firstName: patient.firstName, lastName: patient.lastName } });
  });
  app.post('/api/patient/logout', patientAuth, async c => {
    const value = getCookie(c, cookieName('patient'));
    if (value) store.sessions.delete(await digest(value));
    deleteCookie(c, cookieName('patient'), { path: '/' });
    return c.json({ message: 'Sesión cerrada.' });
  });
  app.get('/api/patient/publications', patientAuth, c => {
    const patientId = c.get('session').patientId;
    const publications = visiblePublications(store, patientId!).map(patientProjection);
    audit('publications.viewed', patientId!);
    return c.json({ publications });
  });
  app.get('/api/patient/publications/:id/download', patientAuth, async c => {
    const publication = visiblePublications(store, c.get('session').patientId!).find(item => item.id === c.req.param('id'));
    if (!publication) return c.json({ message: 'Documento no disponible.' }, 404);
    if (publication.kind === 'prescription') {
      return await downloadPrescription(c, publication);
    }
    audit('publication.downloaded', publication.id);
    c.header('Content-Disposition', `attachment; filename="indicacion-${publication.scope === 'general' ? 'general' : 'especifica'}.txt"`);
    return c.text(`DEMONSTRACIÓN — SIN VALIDEZ MÉDICA\n\n${publication.title}\n\n${publication.content}`);
  });

  return { app, store };
}
