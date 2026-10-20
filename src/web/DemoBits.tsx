import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, messageOf } from './api';
import { Alert, Brand } from './ui';

// Piezas exclusivas de la demostración. Viven en su propio módulo para que la
// aplicación desplegada no incluya ninguna: el bundle de producción nunca
// importa este archivo, ni las rutas `/api/demo/*`.

/** Ingreso de la médica en la demostración: un clic, sin enlace ni contraseña. */
export function DemoDoctorLogin() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function enter() {
    setBusy(true); setError('');
    try { await api('/api/demo/doctor-login', { method: 'POST' }); navigate('/profesional'); }
    catch (caught) { setError(messageOf(caught)); }
    finally { setBusy(false); }
  }
  return <div className="public-page"><header className="public-header"><Brand /></header><main className="access-card">
    <span className="entry-icon"><ShieldCheck /></span><span className="eyebrow">ÁREA PROFESIONAL · DEMOSTRACIÓN</span>
    <h1>Conocé tu consultorio</h1><p>Probá las pantallas con pacientes ficticios. Este ingreso de demostración no utiliza contraseñas ni segundo factor.</p>
    <Alert>La autenticación profesional real todavía no está implementada. No cargues datos de pacientes.</Alert>
    {error && <Alert>{error}</Alert>}
    <button className="button primary full" disabled={busy} onClick={enter}>{busy ? 'Abriendo…' : 'Entrar a la demostración'}</button>
    <Link className="text-link" to="/">Volver al inicio</Link>
  </main></div>;
}

/** Buzón simulado: muestra el código que en producción llegaría por SMS. */
export function DemoPatientInbox() {
  const [dni, setDni] = useState('');
  const [message, setMessage] = useState<{ code?: string; expiresAt?: number }>();
  const [error, setError] = useState('');
  async function look() {
    setError('');
    try { setMessage(await api('/api/demo/inbox', { method: 'POST', body: { dni } })); }
    catch (caught) { setError(messageOf(caught)); }
  }
  return <aside className="demo-inbox"><strong>Simulación de SMS</strong><p>No enviamos mensajes reales. Este buzón existe únicamente en el prototipo local.</p>
    <label>DNI<input inputMode="numeric" value={dni} onChange={event => setDni(event.target.value)} placeholder="00000001" /></label>
    <button className="button secondary full" onClick={look}>Ver mensaje simulado</button>
    {error && <p role="status">{error}</p>}
    {message && (message.code ? <div className="demo-code" role="status">Código ficticio: <strong>{message.code}</strong></div> : <p role="status">No hay un mensaje de prueba disponible.</p>)}
  </aside>;
}

/** Ayuda de la demostración: qué datos usar para recorrer el flujo. */
export function DemoPatientHint() {
  return <div className="demo-help"><strong>Para probar:</strong> DNI <code>00000001</code> o <code>00000002</code>. El código se muestra en el buzón simulado del siguiente paso.</div>;
}
