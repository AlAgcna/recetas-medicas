import { useEffect, useRef, useState } from 'react';
import { BarChart3, Clock3, FileText, LogOut, ShieldCheck, Users, ExternalLink } from 'lucide-react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { SessionInfo } from '../shared/contracts';
import { api, ApiError, messageOf } from './api';
import { Alert, Brand, Loading, minutesLeft, useClock } from './ui';

/**
 * Ingreso real de la médica: código numérico de 6 dígitos al correo del consultorio.
 */
export function DoctorLogin() {
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const navigate = useNavigate();
  async function requestCode() {
    setBusy(true); setError('');
    try { await api('/api/doctor/request-code', { method: 'POST', body: JSON.stringify({ website: '' }) }); setSent(true); setCode(''); }
    catch (error) { setError(messageOf(error)); }
    finally { setBusy(false); }
  }
  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (code.length !== 6) return;
    setVerifying(true); setError('');
    try {
      await api<SessionInfo>('/api/doctor/verify-code', { method: 'POST', body: JSON.stringify({ code }) });
      navigate('/profesional');
    } catch (error) { setError(messageOf(error)); }
    finally { setVerifying(false); }
  }
  return <div className="public-page"><header className="public-header"><Brand /></header><main className="access-card">
    <span className="entry-icon"><ShieldCheck /></span><span className="eyebrow">ÁREA PROFESIONAL</span>
    <h1>Ingresá a tu consultorio</h1>
    <p>Te enviamos un código numérico de 6 dígitos al correo del consultorio. Vence en 10 minutos y sirve una sola vez.</p>
    {error && <Alert>{error}</Alert>}
    {sent ? <>
      <Alert success>Si el correo del consultorio está configurado, te enviamos un código. Revisá tu casilla e ingresá el código.</Alert>
      <form onSubmit={verifyCode} className="form">
        <label className="field">
          <span>Código</span>
          <input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))} required />
        </label>
        <button className="button primary full" type="submit" disabled={verifying || code.length !== 6}>{verifying ? 'Verificando…' : 'Ingresar'}</button>
      </form>
      <button className="button secondary full" type="button" disabled={busy || verifying} onClick={requestCode}>{busy ? 'Enviando…' : 'Pedir otro código'}</button>
    </> : <button className="button primary full" disabled={busy} onClick={requestCode}>{busy ? 'Enviando…' : 'Enviar código de acceso'}</button>}
    <Link className="text-link" to="/">Volver al inicio</Link>
  </main></div>;
}

export function DoctorShell({ demo = false }: { demo?: boolean } = {}) {
  const [session, setSession] = useState<SessionInfo | null>();
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const lastSignal = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const statisticsActive = location.pathname.startsWith('/profesional/estadisticas');
  const generalActive = location.pathname.startsWith('/profesional/indicacion-general');
  const now = useClock();

  useEffect(() => {
    const controller = new AbortController();
    void api<SessionInfo>('/api/doctor/session', { signal: controller.signal }).then(setSession).catch(error => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof ApiError && error.status === 401) setSession(null);
      else setError(messageOf(error));
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!session) return;
    const activity = () => {
      if (document.visibilityState !== 'visible' || Date.now() >= session.expiresAt || Date.now() - lastSignal.current < 30_000) return;
      lastSignal.current = Date.now();
      void api<SessionInfo>('/api/doctor/activity', { method: 'POST' }).then(setSession).catch(error => {
        if (error instanceof ApiError && error.status === 401) setSession(null);
      });
    };
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      void api<SessionInfo>('/api/doctor/session').then(setSession).catch(error => {
        if (error instanceof ApiError && error.status === 401) setSession(null);
      });
    };
    document.addEventListener('pointerdown', activity);
    document.addEventListener('keydown', activity);
    document.addEventListener('visibilitychange', check);
    return () => {
      document.removeEventListener('pointerdown', activity);
      document.removeEventListener('keydown', activity);
      document.removeEventListener('visibilitychange', check);
    };
  }, [session]);

  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  async function logout() {
    setLoggingOut(true); setError('');
    try { await api('/api/doctor/logout', { method: 'POST' }); setSession(null); navigate('/profesional/ingreso'); }
    catch (error) { setError(messageOf(error)); }
    finally { setLoggingOut(false); }
  }

  if (session === null || (session && now >= session.expiresAt)) return <Navigate to="/profesional/ingreso" replace />;
  if (error && session === undefined) return <main className="locked-page"><Alert>{error}</Alert><button className="button secondary" onClick={() => window.location.reload()}>Reintentar</button></main>;
  if (!session) return <Loading />;

  return <div className="workspace">
    <aside className="sidebar">
      <Brand />
      <div className="sidebar-label">MI CONSULTORIO</div>
      <nav aria-label="Navegación profesional"><Link to="/profesional" className={`nav-link${statisticsActive || generalActive ? '' : ' active'}`} aria-current={statisticsActive || generalActive ? undefined : 'page'}><Users size={21} /> Pacientes</Link><Link to="/profesional/indicacion-general" className={`nav-link${generalActive ? ' active' : ''}`} aria-current={generalActive ? 'page' : undefined}><FileText size={21} /> Indicación general</Link><Link to="/profesional/estadisticas" className={`nav-link${statisticsActive ? ' active' : ''}`} aria-current={statisticsActive ? 'page' : undefined}><BarChart3 size={21} /> Estadísticas</Link><Link to="/pacientes/ingreso" className="nav-link"><ExternalLink size={20} /> Ver portal del paciente</Link></nav>
      <div className="sidebar-bottom"><div className="session-label"><Clock3 size={18} /><span>Cierre por inactividad<br /><strong>Hasta {Math.min(120, minutesLeft(session.expiresAt, now))} min</strong></span></div><button className="nav-link logout" onClick={logout} disabled={loggingOut}><LogOut size={20} /> Cerrar sesión</button><span className="sidebar-footnote">La Rioja, Argentina<br />{demo ? 'Entorno de demostración' : 'Portal del consultorio'}</span></div>
    </aside>
    <div className="workspace-body">
      <header className="workspace-topbar"><span><span className="status-dot" /> Panel profesional</span><span className="professional-avatar">M</span></header>
      <main className="workspace-main">
        {error && <Alert>{error}</Alert>}
        {session.expiresAt - now < 5 * 60_000 && <Alert>Tu sesión está por terminar. <button className="text-button" onClick={() => { void api<SessionInfo>('/api/doctor/activity', { method: 'POST' }).then(setSession).catch(error => setError(messageOf(error))); }}>Continuar trabajando</button></Alert>}
        <Outlet />
      </main>
    </div>
  </div>;
}
