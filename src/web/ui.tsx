import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import { Link, useBlocker } from 'react-router-dom';
import logoUrl from './assets/Logo_morado_inverso.png';
import signatureUrl from './assets/firma-logo.jpg';

export function Brand() {
  return <Link to="/" className="brand" aria-label="Consultorio, inicio"><img className="brand-logo" src={logoUrl} alt="Consultorio, portal clínico" /></Link>;
}

// Firma visual del consultorio al pie de las indicaciones. Es una imagen fija,
// no una firma digital: no acredita autoría ni integridad del documento.
export function IndicationSignature() {
  return <img className="indication-signature" src={signatureUrl} alt="Firma de la médica" />;
}

export function Alert({ children, success = false }: { children: ReactNode; success?: boolean }) {
  const Icon = success ? CheckCircle2 : AlertCircle;
  return <div className={`alert ${success ? 'alert-success' : ''}`} role={success ? 'status' : 'alert'}><Icon size={21} aria-hidden="true" /><div>{children}</div></div>;
}

export function Loading() {
  return <div className="loading" role="status"><LoaderCircle className="spin" size={25} aria-hidden="true" /> Cargando…</div>;
}

export function Badge({ children, tone = 'neutral', live = false }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber'; live?: boolean }) {
  return <span className={`badge badge-${tone}`} {...(live ? { role: 'status', 'aria-live': 'polite' as const } : {})}>{children}</span>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [title]);
  return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1 tabIndex={-1} ref={heading}>{title}</h1>{description && <p>{description}</p>}</div>{action}</header>;
}

export function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  return now;
}

export function useUnsavedChanges(dirty: boolean) {
  const enabled = useRef(dirty);
  enabled.current = dirty;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => enabled.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Hay cambios sin guardar. ¿Querés salir y descartarlos?')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  return { allowNavigation: () => { enabled.current = false; } };
}

export function initials(firstName: string, lastName: string) {
  return `${firstName[0] ?? '?'}${lastName[0] ?? ''}`;
}

export function minutesLeft(expiresAt: number, now: number) {
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}
