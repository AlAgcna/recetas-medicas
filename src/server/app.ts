import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  amendmentRequestSchema, consultationSchema, dniSchema, generalIndicationSchema, monthSchema, patientProjection,
  patientSchema, pdfPolicy, policy, publicationRequestSchema, publicationSchema, today,
  type Consultation, type Patient, type Publication,
} from '../shared/contracts';
import { PdfInputError, pdfFromFile, prescriptionForm, sha256 } from './prescription-pdf';
import type { SendEmail } from './email/port';
import { monthlyStatistics } from './statistics';
import { StorageConflict, type AccessSession, type Storage } from './storage/port';

export type PortalEnv = { Variables: { session: AccessSession } };
export type DeliverCode = (patient: Patient, code: string, expiresAt: number) => void | Promise<void>;
export type HealthInfo = { mode: string; persistent: boolean; whatsapp: boolean };
/** Nombre y requisitos de la cookie de sesión, distintos en demo y producción. */
export type CookiePolicy = { prefix: string; secure: boolean };
/** Cookies de la demostración: prefijo `demo_` y sin `Secure`, sólo para loopback HTTP. */
export const demoCookies: CookiePolicy = { prefix: 'demo_', secure: false };
export type AppOptions = {
  storage: Storage;
  origin: string;
  deliverCode: DeliverCode;
  health: HealthInfo;
  now?: () => number;
  /**
   * Envío del correo del portal. Sin él, y sin `doctorEmail`, el ingreso
   * profesional responde 503 en lugar de fingir que envió algo.
   */
  sendEmail?: SendEmail;
  /** Casilla de la médica: único destino del enlace de acceso. */
  doctorEmail?: string;
  /**
   * Política de cookies. Por defecto la de producción: nombre sin prefijo y
   * `Secure`. La demostración declara la suya (`demoCookies`) porque corre en
   * loopback HTTP.
   */
  cookie?: CookiePolicy;
  /** Trabajo de arranque que debe terminar antes de atender el primer pedido. */
  ready?: Promise<unknown>;
  /**
   * Secreto del servidor que protege el verificador de los códigos de acceso.
   * En producción llega como binding/secret y debe ser el mismo en todos los
   * pedidos e instancias. Sin él se genera uno aleatorio por proceso, válido
   * sólo para el prototipo y las pruebas.
   */
  challengeSecret?: string;
};

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

async function body(c: Context) {
  return c.req.json().catch(() => null);
}

export function createApp(options: AppOptions) {
  const now = options.now ?? Date.now;
  const { storage, origin, sendEmail, doctorEmail } = options;
  // Cookies de sesión. Por defecto, la política de producción; la demostración
  // pide la suya porque corre en loopback HTTP.
  const cookies = options.cookie ?? { prefix: '', secure: true };
  const cookieName = (role: AccessSession['role']) => `${cookies.prefix}${role}`;
  function cookie(c: Context, value: string, session: AccessSession) {
    setCookie(c, cookieName(session.role), value, {
      httpOnly: true, sameSite: 'Strict', path: '/', secure: cookies.secure,
      maxAge: Math.max(0, Math.ceil((session.expiresAt - now()) / 1000)),
    });
  }
  const secret = crypto.subtle.importKey(
    'raw',
    options.challengeSecret ? encoder.encode(options.challengeSecret) : crypto.getRandomValues(new Uint8Array(32)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
  const app = new Hono<PortalEnv>();
  const audit = (actor: AccessSession['role'] | 'system', action: string, resource: string) =>
    storage.appendAudit({ actor, action, resource, at: now() });

  // Protección secundaria orientativa, local y de un único proceso. No sustituye
  // límites distribuidos, presupuesto ni detección de abuso en producción.
  const rateLimits = new Map<string, { count: number; expiresAt: number }>();
  function withinLimit(key: string, maximum: number, duration: number) {
    const current = rateLimits.get(key);
    if (!current || current.expiresAt <= now()) {
      rateLimits.set(key, { count: 1, expiresAt: now() + duration });
      return true;
    }
    current.count += 1;
    return current.count <= maximum;
  }

  app.use('*', async (c, next) => {
    if (options.ready) await options.ready;
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

  async function openSession(c: Context<PortalEnv>, role: AccessSession['role'], patientId?: string) {
    const previous = getCookie(c, cookieName(role));
    if (previous) await storage.deleteSession(await digest(previous));
    const value = token();
    const session: AccessSession = {
      role, patientId, createdAt: now(),
      expiresAt: now() + (role === 'doctor' ? policy.doctorIdle : policy.patientLifetime),
    };
    await storage.putSession(await digest(value), session);
    cookie(c, value, session);
    await audit(role, 'session.created', role);
    return session;
  }

  function authenticate(role: AccessSession['role']) {
    return async (c: Context<PortalEnv>, next: () => Promise<void>) => {
      const value = getCookie(c, cookieName(role));
      const hash = value ? await digest(value) : undefined;
      const session = hash ? await storage.getSession(hash) : undefined;
      if (!session || session.role !== role || session.expiresAt <= now()) {
        if (hash) await storage.deleteSession(hash);
        deleteCookie(c, cookieName(role), { path: '/' });
        return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
      }
      c.set('session', session);
      await next();
    };
  }

  async function activity(c: Context<PortalEnv>) {
    const session = c.get('session');
    const value = getCookie(c, cookieName('doctor'));
    if (!value) return;
    const expiresAt = now() + policy.doctorIdle;
    if (!await storage.touchSession(await digest(value), expiresAt, now())) return;
    session.expiresAt = expiresAt;
    cookie(c, value, session);
  }

  // Detecta que la sesión dejó de ser la vigente durante una operación con `await`.
  async function stillAuthenticated(c: Context<PortalEnv>) {
    const session = c.get('session');
    if (session.expiresAt <= now()) return false;
    const value = getCookie(c, cookieName(session.role));
    if (!value) return false;
    const current = await storage.getSession(await digest(value));
    return !!current && current.expiresAt === session.expiresAt;
  }

  async function downloadPrescription(c: Context<PortalEnv>, publication: Publication) {
    const manifest = publication.pdf;
    const stored = await storage.getPublicationFile(publication.id);
    const bytes = stored?.slice();
    if (!bytes || !manifest || bytes.length !== manifest.size || await sha256(bytes) !== manifest.sha256) {
      await audit('system', 'prescription.integrity-failed', publication.id);
      return c.json({ message: 'El PDF no está disponible o no se pudo verificar su integridad. Contactá al consultorio.' }, 503);
    }
    if (!await stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    const current = await storage.getPublication(publication.id);
    if (!current || !current.active) return c.json({ message: 'Documento no disponible.' }, 404);
    await audit(c.get('session').role, 'publication.downloaded', publication.id);
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', 'attachment; filename="receta.pdf"');
    c.header('Content-Length', String(manifest.size));
    c.header('X-Document-SHA256', manifest.sha256);
    // Nueva copia de los mismos bytes: no exponer un buffer modificable del almacén.
    return c.body(bytes.buffer);
  }

  app.get('/api/health', c => c.json(options.health));

  // ── Ingreso de la médica ───────────────────────────────────────────────────
  // No hay contraseña: pide un enlace de un solo uso a su correo y con ese
  // enlace abre su sesión. Las respuestas son siempre las mismas para no revelar
  // si el correo está configurado, y el token nunca aparece en una respuesta.
  const accessRequest = { message: 'Si el correo del consultorio está configurado, te enviamos un enlace de acceso.' };
  app.post('/api/doctor/request-link', async c => {
    if (!sendEmail || !doctorEmail) {
      return c.json({ message: 'El ingreso por correo todavía no está configurado.' }, 503);
    }
    if (!withinLimit('access-links', 5, policy.accessLinkCooldown)) return c.json(accessRequest);
    const at = now();
    if (!await storage.reserveAccessLinkRequest(at + policy.accessLinkCooldown, at)) return c.json(accessRequest);
    const value = token();
    await storage.putAccessLink({
      tokenHash: await digest(value), createdAt: at, expiresAt: at + policy.accessLinkLifetime, consumed: false,
    });
    const minutes = Math.round(policy.accessLinkLifetime / 60_000);
    try {
      await sendEmail({
        to: doctorEmail,
        subject: 'Acceso al portal del consultorio',
        // El token viaja en el fragmento de la URL: no llega al servidor en el
        // GET. Los escáneres de enlaces del proveedor de correo no lo consumen.
        text: `Para entrar al portal, abrí este enlace:\n\n${origin}/acceso#${value}\n\n`
          + `Vence en ${minutes} minutos y sirve una sola vez. Si no lo pediste, ignoralo.\n`,
      });
    } catch {
      await audit('system', 'access-link.failed', 'doctor');
      return c.json({ message: 'No pudimos enviar el correo. Probá de nuevo en unos minutos.' }, 502);
    }
    await audit('system', 'access-link.created', 'doctor');
    return c.json(accessRequest);
  });
  app.post('/api/doctor/session', async c => {
    const rejected = () => c.json({ message: 'El enlace no es válido, ya se usó o venció. Pedí uno nuevo.' }, 401);
    if (!withinLimit('access-sessions', 20, policy.accessLinkCooldown)) return rejected();
    const parsed = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(await body(c));
    if (!parsed.success) return rejected();
    if (!await storage.consumeAccessLink(await digest(parsed.data.token), now())) return rejected();
    const session = await openSession(c, 'doctor');
    return c.json({ role: session.role, expiresAt: session.expiresAt });
  });

  app.use('/api/doctor/*', authenticate('doctor'));
  app.get('/api/doctor/session', c => c.json({ role: 'doctor', expiresAt: c.get('session').expiresAt }));
  app.post('/api/doctor/activity', async c => {
    await activity(c);
    return c.json({ role: 'doctor', expiresAt: c.get('session').expiresAt });
  });
  app.post('/api/doctor/logout', async c => {
    const value = getCookie(c, cookieName('doctor'));
    if (value) await storage.deleteSession(await digest(value));
    deleteCookie(c, cookieName('doctor'), { path: '/' });
    return c.json({ message: 'Sesión cerrada.' });
  });
  app.get('/api/doctor/patients', async c => {
    await activity(c);
    const query = (c.req.query('q') ?? '').toLocaleLowerCase('es').replace(/[.]/g, '').trim();
    const patients = (await storage.listPatients()).filter(patient =>
      `${patient.dni} ${patient.firstName} ${patient.lastName}`.toLocaleLowerCase('es').includes(query));
    return c.json({ patients, stats: await storage.dashboardStats() });
  });
  app.get('/api/doctor/statistics', async c => {
    const parsed = monthSchema.safeParse(c.req.query('month') ?? today(now()).slice(0, 7));
    if (!parsed.success) return c.json({ message: 'Seleccioná un mes válido.' }, 400);
    await activity(c);
    await audit('doctor', 'statistics.viewed', parsed.data);
    const consultations = await storage.listConsultationsFinalizedIn(parsed.data);
    const publications = await storage.listPrescriptionsPublishedIn(parsed.data);
    return c.json(monthlyStatistics(consultations, publications, parsed.data));
  });
  app.get('/api/doctor/general-indications', async c => {
    await activity(c);
    return c.json({
      active: await storage.getActiveIndication(null) ?? null,
      history: await storage.listGeneralIndications(),
    });
  });
  app.post('/api/doctor/general-indications', async c => {
    const parsed = generalIndicationSchema.safeParse(await body(c));
    if (!await stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    if (!parsed.success) return c.json({ message: 'Revisá la indicación general. No puede ser una receta ni tener un destinatario individual.' }, 400);
    const { expectedActiveId, ...input } = parsed.data;
    const result = await storage.publish(input, null, expectedActiveId, now());
    if (!result) return c.json({ message: 'La indicación general activa cambió. Volvé a abrir el formulario y revisá qué versión vas a reemplazar.' }, 409);
    await activity(c);
    if (result.replacedId) await audit('doctor', 'indication.superseded', result.replacedId);
    await audit('doctor', 'general-indication.published', result.publication.id);
    return c.json({ publication: result.publication }, 201);
  });

  app.post('/api/doctor/patients/:id/prescriptions', async c => {
    const patientId = c.req.param('id');
    if (!await storage.getPatient(patientId)) return c.json({ message: 'No se encontró la ficha.' }, 404);
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
      if (!await stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
      const total = await storage.totalStoredBytes();
      if (total + stored.bytes.length > pdfPolicy.maxStoredBytes) throw new PdfInputError('Se alcanzó el límite de PDFs en memoria de esta demostración.', 413);
      const publication = await storage.publishPrescription(parsed.data, patientId, { bytes: stored.bytes, ...stored.metadata }, now());
      await activity(c);
      await audit('doctor', 'prescription.published', publication.id);
      return c.json({ publication }, 201);
    } catch (error) {
      if (error instanceof PdfInputError) return c.json({ message: error.message }, error.status);
      throw error;
    }
  });
  app.get('/api/doctor/patients/:id/prescriptions/:publicationId/download', async c => {
    const publication = await storage.getPublication(c.req.param('publicationId'));
    if (!publication || publication.kind !== 'prescription' || publication.scope !== 'patient' || !publication.active || publication.patientId !== c.req.param('id')) {
      return c.json({ message: 'Documento no disponible.' }, 404);
    }
    return downloadPrescription(c, publication);
  });
  app.post('/api/doctor/patients', async c => {
    const parsed = patientSchema.safeParse(await body(c));
    if (!await stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    if (!parsed.success) return c.json({ message: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }, 400);
    const patient = { ...parsed.data, id: crypto.randomUUID(), createdAt: now() };
    try {
      await storage.createPatient(patient);
    } catch (error) {
      if (error instanceof StorageConflict) return c.json({ message: 'Ya existe un paciente con ese DNI. Buscalo antes de crear otra ficha.' }, 409);
      throw error;
    }
    await activity(c);
    await audit('doctor', 'patient.created', patient.id);
    return c.json({ patient }, 201);
  });
  app.patch('/api/doctor/patients/:id', async c => {
    const patient = await storage.getPatient(c.req.param('id'));
    if (!patient) return c.json({ message: 'No se encontró la ficha.' }, 404);
    const parsed = editablePatientSchema.safeParse(await body(c));
    if (!await stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    if (!parsed.success) return c.json({ message: 'Revisá los datos. DNI y WhatsApp no se modifican en este prototipo.' }, 400);
    const updated = await storage.updatePatient(patient.id, parsed.data);
    if (!updated) return c.json({ message: 'No se encontró la ficha.' }, 404);
    await activity(c);
    await audit('doctor', 'patient.updated', patient.id);
    return c.json({ patient: updated });
  });
  app.get('/api/doctor/patients/:id', async c => {
    const id = c.req.param('id');
    const patient = await storage.getPatient(id);
    if (!patient) return c.json({ message: 'No se encontró la ficha.' }, 404);
    await activity(c);
    await audit('doctor', 'patient.viewed', id);
    return c.json({
      patient,
      consultations: await storage.listConsultationsByPatient(id),
      publications: await storage.listPublicationsByPatient(id),
      generalIndication: await storage.getActiveIndication(null) ?? null,
      documents: await storage.listDocumentsByPatient(id),
    });
  });

  async function saveConsultation(c: Context<PortalEnv>) {
    const patientId = c.req.param('id');
    if (!patientId) return c.json({ message: 'No se encontró la ficha.' }, 404);
    const patient = await storage.getPatient(patientId);
    if (!patient) return c.json({ message: 'No se encontró la ficha.' }, 404);
    const id = c.req.param('consultationId');
    const previous = id ? await storage.getConsultation(id) : undefined;
    if (id && (!previous || previous.patientId !== patientId)) return c.json({ message: 'Consulta no disponible.' }, 404);
    if (previous?.status === 'finalized') return c.json({ message: 'La consulta finalizada no se sobrescribe: la corrección se registra como una enmienda.' }, 409);
    const parsed = consultationSchema.safeParse(await body(c));
    if (!await stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    if (!parsed.success) return c.json({ message: parsed.error.issues[0]?.message ?? 'Revisá la consulta.' }, 400);
    const currentPatient = await storage.getPatient(patientId);
    if (!currentPatient) return c.json({ message: 'No se encontró la ficha.' }, 404);
    if (parsed.data.status === 'finalized' && (!currentPatient.firstName || !currentPatient.lastName)) return c.json({ message: 'Completá nombre y apellido antes de finalizar una consulta.' }, 400);
    const consultation = { ...parsed.data, id: id ?? crypto.randomUUID(), patientId, updatedAt: now(), insuranceAtVisit: currentPatient.insurance };
    // El almacenamiento rechaza sobrescribir una versión finalizada, incluso si
    // otra solicitud la finalizó durante la lectura del cuerpo.
    if (await storage.saveConsultation(consultation) === 'finalized') {
      return c.json({ message: 'La consulta finalizada no se sobrescribe: la corrección se registra como una enmienda.' }, 409);
    }
    await activity(c);
    await audit('doctor', `consultation.${consultation.status}`, consultation.id);
    return c.json({ consultation }, previous ? 200 : 201);
  }
  app.post('/api/doctor/patients/:id/consultations', saveConsultation);
  app.put('/api/doctor/patients/:id/consultations/:consultationId', saveConsultation);
  // Una enmienda nunca pisa el texto en silencio: crea una versión vigente, marca
  // la revisada como reemplazada y guarda el motivo. Solo se enmienda lo finalizado
  // y solo la versión vigente.
  app.post('/api/doctor/patients/:id/consultations/:consultationId/amendments', async c => {
    const patientId = c.req.param('id');
    if (!patientId || !await storage.getPatient(patientId)) return c.json({ message: 'No se encontró la ficha.' }, 404);
    const reviewed = await storage.getConsultation(c.req.param('consultationId') ?? '');
    if (!reviewed || reviewed.patientId !== patientId) return c.json({ message: 'Consulta no disponible.' }, 404);
    const parsed = amendmentRequestSchema.safeParse(await body(c));
    if (!await stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    if (!parsed.success) return c.json({ message: parsed.error.issues[0]?.message ?? 'Revisá la enmienda.' }, 400);
    if (reviewed.status !== 'finalized') return c.json({ message: 'Solo se enmiendan consultas finalizadas. Continuá el borrador en su lugar.' }, 409);
    if (reviewed.supersededAt) return c.json({ message: 'Esa versión ya fue reemplazada. Abrí la versión vigente para corregirla.' }, 409);
    const { amendmentReason, ...input } = parsed.data;
    const amendment: Consultation = {
      ...input, id: crypto.randomUUID(), patientId, updatedAt: now(),
      // La cobertura es la de la visita: una corrección del registro no la cambia.
      insuranceAtVisit: reviewed.insuranceAtVisit,
      supersedesId: reviewed.id, amendmentReason,
    };
    // La versión anterior no se borra: queda con su texto original y la fecha del
    // reemplazo. La operación falla si otra solicitud la reemplazó mientras tanto.
    if (await storage.amendConsultation(reviewed.id, amendment) === 'conflict') {
      return c.json({ message: 'La consulta cambió mientras la revisabas. Actualizá la ficha y revisá la versión vigente.' }, 409);
    }
    await activity(c);
    await audit('doctor', 'consultation.superseded', reviewed.id);
    await audit('doctor', 'consultation.finalized', amendment.id);
    return c.json({ consultation: amendment }, 201);
  });
  app.post('/api/doctor/patients/:id/publications', async c => {
    const patientId = c.req.param('id');
    if (!await storage.getPatient(patientId)) return c.json({ message: 'No se encontró la ficha.' }, 404);
    const parsed = publicationRequestSchema.safeParse(await body(c));
    if (!await stillAuthenticated(c)) return c.json({ message: 'Tu sesión terminó. Volvé a ingresar.' }, 401);
    if (!parsed.success) return c.json({ message: parsed.error.issues[0]?.message ?? 'Revisá la publicación.' }, 400);
    const { expectedActiveId, ...input } = parsed.data;
    if (input.kind === 'prescription') return c.json({ message: 'Para publicar una receta, adjuntá su PDF original en el formulario de recetas.' }, 400);
    const result = await storage.publish(input, patientId, expectedActiveId, now());
    if (!result) return c.json({ message: 'La indicación específica activa cambió. Volvé a abrir el formulario y revisá qué versión vas a reemplazar.' }, 409);
    await activity(c);
    if (result.replacedId) await audit('doctor', 'indication.superseded', result.replacedId);
    await audit('doctor', 'publication.published', result.publication.id);
    return c.json({ publication: result.publication }, 201);
  });

  app.post('/api/patient/request-code', async c => {
    // Cota global de prototipo. El límite por paciente es independiente del navegador.
    if (!withinLimit('requests', 50, policy.codeCooldown)) return c.json(genericRequest);
    const parsed = z.object({ dni: dniSchema }).safeParse(await body(c));
    if (!parsed.success) return c.json(genericRequest);
    const patient = await storage.findPatientByDni(parsed.data.dni);
    if (!patient?.contactVerified) return c.json(genericRequest);
    const generatedAt = now();
    const reservedUntil = generatedAt + policy.codeCooldown;
    // Reserva atómica: si otra solicitud ya reservó, ésta se descarta igual.
    if (!await storage.reserveCodeRequest(patient.id, reservedUntil, generatedAt)) return c.json(genericRequest);
    const code = otp();
    const id = crypto.randomUUID();
    const expiresAt = generatedAt + policy.codeLifetime;
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await secret, encoder.encode(`${id}:${code}`)));
    await storage.putChallenge({
      id, patientId: patient.id, verifier: Array.from(signature, b => b.toString(16).padStart(2, '0')).join(''),
      createdAt: generatedAt, expiresAt, attempts: 0, consumed: false,
    });
    await options.deliverCode(patient, code, expiresAt);
    await audit('system', 'challenge.created', id);
    return c.json(genericRequest);
  });
  app.post('/api/patient/verify-code', async c => {
    const rejected = () => c.json({ message: 'Código incorrecto, vencido o no disponible. Revisalo o solicitá uno nuevo.' }, 401);
    if (!withinLimit('verifications', 200, policy.codeCooldown)) return rejected();
    const parsed = verificationSchema.safeParse(await body(c));
    if (!parsed.success) return rejected();
    const patient = await storage.findPatientByDni(parsed.data.dni);
    if (!patient?.contactVerified) return rejected();
    const challenge = await storage.getChallenge(patient.id);
    if (!challenge) return rejected();
    const signature = Uint8Array.from(challenge.verifier.match(/../g)!, item => parseInt(item, 16));
    const matches = await crypto.subtle.verify('HMAC', await secret, signature, encoder.encode(`${challenge.id}:${parsed.data.code}`));
    // Cuenta el intento y consume el código en una sola operación condicional.
    if (!await storage.consumeChallenge(patient.id, challenge.id, matches, policy.codeAttempts, now())) return rejected();
    const session = await openSession(c, 'patient', patient.id);
    return c.json({ role: session.role, expiresAt: session.expiresAt });
  });

  const patientAuth = authenticate('patient');
  app.post('/api/patient/logout', patientAuth, async c => {
    const value = getCookie(c, cookieName('patient'));
    if (value) await storage.deleteSession(await digest(value));
    deleteCookie(c, cookieName('patient'), { path: '/' });
    return c.json({ message: 'Sesión cerrada.' });
  });
  app.get('/api/patient/session', patientAuth, async c => {
    const session = c.get('session');
    const patient = session.patientId ? await storage.getPatient(session.patientId) : undefined;
    if (!patient) return c.json({ message: 'Sesión no disponible.' }, 401);
    return c.json({ role: 'patient', expiresAt: session.expiresAt, patient: { firstName: patient.firstName, lastName: patient.lastName } });
  });
  app.get('/api/patient/publications', patientAuth, async c => {
    const patientId = c.get('session').patientId!;
    const publications = (await storage.listVisiblePublications(patientId)).map(patientProjection);
    await audit('patient', 'publications.viewed', patientId);
    return c.json({ publications });
  });
  app.get('/api/patient/publications/:id/download', patientAuth, async c => {
    const publication = (await storage.listVisiblePublications(c.get('session').patientId!)).find(item => item.id === c.req.param('id'));
    if (!publication) return c.json({ message: 'Documento no disponible.' }, 404);
    if (publication.kind === 'prescription') {
      return await downloadPrescription(c, publication);
    }
    await audit('patient', 'publication.downloaded', publication.id);
    c.header('Content-Disposition', `attachment; filename="indicacion-${publication.scope === 'general' ? 'general' : 'especifica'}.txt"`);
    return c.text(`DEMOSTRACIÓN — SIN VALIDEZ MÉDICA\n\n${publication.title}\n\n${publication.content}`);
  });

  return { app, openSession };
}
