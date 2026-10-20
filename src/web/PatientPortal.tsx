import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Clock3, Download, FileText, KeyRound, LogOut, MessageCircle, ShieldCheck } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { dniSchema, policy, type PatientPublication, type PatientSessionInfo } from '../shared/contracts';
import { api, ApiError, messageOf } from './api';
import { Alert, Badge, Brand, IndicationSignature, Loading, minutesLeft, useClock } from './ui';
import { PdfIntegrity } from './PdfIntegrity';

/**
 * Acceso del paciente. Es el mismo componente en la demostración y en
 * producción: el código llega por SMS al teléfono registrado. El buzón simulado
 * de la demostración es un componente aparte (`DemoPatientInbox`), para que la
 * aplicación desplegada no incluya ningún atajo del prototipo.
 */
export function PatientLogin({ demoInbox, demoHint }: { demoInbox?: ReactNode; demoHint?: ReactNode } = {}) {
  const [step, setStep] = useState<'dni' | 'code'>('dni');
  const [dni, setDni] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [nextRequestAt, setNextRequestAt] = useState(0);
  const now = useClock();
  const navigate = useNavigate();
  async function request(event?: FormEvent) {
    event?.preventDefault(); setError('');
    const parsed = dniSchema.safeParse(dni);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Revisá el DNI.'); return; }
    setBusy(true);
    try {
      const result = await api<{ message: string }>('/api/patient/request-code', { method: 'POST', body: { dni: parsed.data } });
      setDni(parsed.data); setNotice(result.message); setCode('');
      setNextRequestAt(Date.now() + policy.codeCooldown); setStep('code');
    } catch (error) { setError(messageOf(error)); }
    finally { setBusy(false); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try { await api('/api/patient/verify-code', { method: 'POST', body: { dni, code } }); navigate('/pacientes'); }
    catch (error) { setError(messageOf(error)); }
    finally { setBusy(false); }
  }
  return <div className="public-page"><header className="public-header"><Brand /><Link to="/profesional" className="text-link">Área profesional <ArrowRight size={17} /></Link></header>
    <main className="access-card patient-access"><span className="entry-icon patient-icon">{step === 'dni' ? <MessageCircle /> : <KeyRound />}</span><span className="eyebrow">PORTAL DEL PACIENTE</span><h1>{step === 'dni' ? 'Tus indicaciones, a mano' : 'Ingresá tu código'}</h1>
      <p>{step === 'dni' ? 'Ingresá tu DNI para solicitar un código al teléfono registrado en el consultorio.' : 'El código sirve una sola vez y vence a los 10 minutos. No necesitás autorización de la médica.'}</p>
      {error && <Alert>{error}</Alert>}
      {step === 'dni' ? <form onSubmit={request}><label>DNI<input required autoComplete="off" inputMode="numeric" value={dni} onChange={event => setDni(event.target.value)} placeholder="Sin puntos ni espacios" /></label><button className="button primary full" disabled={busy} type="submit">{busy ? 'Solicitando…' : 'Solicitar código'}<ArrowRight size={20} /></button></form> : <>
        <div className="generic-notice" role="status">{notice}</div>
        <form onSubmit={verify}><label>Código de acceso<input required className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" /></label><button className="button primary full" disabled={busy} type="submit">{busy ? 'Verificando…' : 'Entrar a mi portal'}</button></form>
        <div className="resend-row"><button className="text-button" disabled={busy || nextRequestAt > now} onClick={() => void request()}>Solicitar otro código{nextRequestAt > now ? ` (${Math.ceil((nextRequestAt - now) / 1000)} s)` : ''}</button><button className="text-button" onClick={() => { setStep('dni'); setError(''); }}>Corregir DNI</button></div>
        {demoInbox}
      </>}
      {step === 'dni' && demoHint}
      <p className="privacy-note"><ShieldCheck size={18} /> Acceso temporal de 20 minutos.</p><Link className="back-link" to="/"><ArrowLeft size={17} /> Volver al inicio</Link>
    </main>
  </div>;
}

export function PatientPortal() {
  const [session, setSession] = useState<PatientSessionInfo | null>();
  const [publications, setPublications] = useState<PatientPublication[]>();
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const now = useClock();
  useEffect(() => {
    const controller = new AbortController();
    const check = () => {
      void api<PatientSessionInfo>('/api/patient/session', { signal: controller.signal }).then(setSession).catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof ApiError && error.status === 401) setSession(null);
        else setError(messageOf(error));
      });
    };
    check();
    const loadPublications = () => {
      void api<{ publications: PatientPublication[] }>('/api/patient/publications', { signal: controller.signal }).then(data => setPublications(data.publications)).catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof ApiError && error.status === 401) setSession(null);
        else setError(messageOf(error));
      });
    };
    loadPublications();
    const onVisibility = () => { if (document.visibilityState === 'visible') { check(); loadPublications(); } };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { controller.abort(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
  async function logout() {
    setLoggingOut(true); setError('');
    try { await api('/api/patient/logout', { method: 'POST' }); setSession(null); }
    catch (error) { setError(messageOf(error)); }
    finally { setLoggingOut(false); }
  }
  if (session === null || (session && now >= session.expiresAt)) return <Navigate to="/pacientes/ingreso" replace />;
  const indications = publications?.filter(publication => publication.kind === 'indication');
  const prescriptions = publications?.filter(publication => publication.kind === 'prescription');
  return <div className="public-page"><header className="public-header"><Brand /><button className="button secondary" disabled={loggingOut} onClick={logout}><LogOut size={18} /> Cerrar sesión</button></header>
    <main className="portal-main">{error && <Alert>{error}</Alert>}{!session ? !error && <Loading /> : <>
      <div className="portal-greeting"><Badge tone="green"><ShieldCheck size={15} /> Portal del paciente</Badge><h1>Hola, {session.patient.firstName || 'bienvenido/a'}</h1><p>Acá están tus indicaciones y recetas publicadas por el consultorio.</p></div>
      <div className="portal-session"><Clock3 size={21} /><div><strong>Tu sesión termina en {Math.min(20, minutesLeft(session.expiresAt, now))} minutos</strong><span>El plazo no se extiende al navegar. Podés solicitar otro código después.</span></div></div>
      {session.expiresAt - now < 2 * 60_000 && <Alert>Tu sesión está por terminar. Después tendrás que ingresar nuevamente para seguir leyendo tus indicaciones.</Alert>}
      {!publications && !error && <Loading />}
      {publications && <>
        <section className="portal-section" aria-labelledby="patient-indications"><h2 id="patient-indications">Indicaciones</h2><p className="section-description">Leelas acá mismo y descargá una copia si querés. Podés tener una general para todos y una específica para vos.</p>
          <div className="portal-documents">{indications?.map(publication => <article className="card portal-document portal-indication" key={publication.id} aria-labelledby={`publication-${publication.id}`}><span className="document-symbol"><FileText /></span><div><Badge tone="green">{publication.scope === 'general' ? 'General · Para todos' : 'Específica · Para vos'}</Badge><h3 id={`publication-${publication.id}`}>{publication.title}</h3><p className="preserve-lines indication-content">{publication.content}</p><IndicationSignature /><a className="button secondary indication-download" href={`/api/patient/publications/${publication.id}/download`}><Download size={19} /> Descargar indicación</a></div></article>)}</div>
          {!indications?.length && <div className="empty-state"><FileText size={32} /><h3>Todavía no hay indicaciones publicadas</h3><p>Cuando el consultorio publique una indicación, vas a poder leerla acá.</p></div>}
        </section>
        <section className="portal-section" aria-labelledby="patient-prescriptions"><h2 id="patient-prescriptions">Recetas</h2><p className="section-description">Tus recetas se conservan como documentos PDF.</p>
          <div className="portal-documents">{prescriptions?.map(publication => <article className="card portal-document" key={publication.id} aria-labelledby={`publication-${publication.id}`}><span className="document-symbol"><FileText /></span><div><Badge>{publication.pdf?.origin === 'example' ? 'PDF de ejemplo' : 'Receta en PDF'}</Badge><h3 id={`publication-${publication.id}`}>{publication.title}</h3><p className="preserve-lines">{publication.content}</p><p className="helper-text">Se entrega el mismo archivo adjuntado por el consultorio, sin editarlo. No verificamos su firma digital.</p><a className="button primary" href={`/api/patient/publications/${publication.id}/download`}><Download size={19} /> Descargar receta (PDF)</a>{publication.pdf && <PdfIntegrity pdf={publication.pdf} />}</div></article>)}</div>
          {!prescriptions?.length && <div className="empty-state"><FileText size={32} /><h3>Todavía no hay recetas publicadas</h3><p>Cuando el consultorio publique una receta, la vas a encontrar acá.</p></div>}
        </section>
      </>}
      <div className="quiet-note"><ShieldCheck size={20} /><p>Este portal muestra lo publicado para vos. Para solicitar una copia de tu historia clínica completa, contactá al consultorio.</p></div>
    </>}</main>
  </div>;
}
