import { useEffect, useRef, useState } from 'react';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, messageOf } from './api';
import { Alert, Brand, Loading } from './ui';

/**
 * Pantalla del enlace de acceso de la médica (`/acceso#<token>`).
 *
 * El token viaja en el fragmento de la URL: no llega al servidor en el `GET`,
 * así que no queda en registros ni lo consumen los escáneres de enlaces del
 * correo. Este componente lo lee del navegador y lo envía una sola vez por
 * `POST` a `/api/doctor/session`. Consumido el enlace, se limpia el fragmento
 * para que recargar o compartir la URL no lo reutilice.
 */
export function DoctorAccess() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const navigate = useNavigate();
  const attempted = useRef(false);

  useEffect(() => {
    // Un solo intento: el enlace sirve una sola vez y reintentar lo consumiría.
    if (attempted.current) return;
    attempted.current = true;
    const token = window.location.hash.replace(/^#/, '');
    if (!/^[0-9a-f]{64}$/.test(token)) { setError('El enlace no es válido o venció. Pedí uno nuevo.'); setBusy(false); return; }
    // Limpiar el fragmento antes de navegar: no dejarlo en el historial.
    window.history.replaceState(null, '', '/acceso');
    void api('/api/doctor/session', { method: 'POST', body: { token } })
      .then(() => navigate('/profesional', { replace: true }))
      .catch(caught => { setError(messageOf(caught)); setBusy(false); });
  }, [navigate]);

  return <div className="public-page"><header className="public-header"><Brand /></header><main className="access-card">
    <span className="entry-icon"><KeyRound /></span><span className="eyebrow">ÁREA PROFESIONAL</span>
    <h1>Abrir mi consultorio</h1>
    {busy && !error ? <><p>Verificando tu enlace de acceso…</p><Loading /></> : error && <><Alert>{error}</Alert><Link className="button primary full" to="/profesional/ingreso">Pedir un enlace nuevo <ArrowRight size={18} /></Link></>}
    <p className="privacy-note"><ShieldCheck size={18} /> El enlace es personal, dura 15 minutos y sirve una sola vez.</p>
  </main></div>;
}
