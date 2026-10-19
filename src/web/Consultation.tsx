import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, CheckCircle2, CloudOff, LoaderCircle, LockKeyhole, PencilLine, TriangleAlert } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { amendmentRequestSchema, consultationChain, consultationSchema, displayDate, displayDni, displayMoment, today, type Consultation, type ConsultationInput } from '../shared/contracts';
import { api, ApiError, messageOf } from './api';
import { usePatientDetail } from './Patients';
import { Alert, Badge, Loading, PageHeader, useUnsavedChanges } from './ui';

const measurements = [
  ['systolic', 'Presión arterial sistólica', 'mmHg'], ['diastolic', 'Presión arterial diastólica', 'mmHg'],
  ['heartRate', 'Frecuencia cardíaca', 'lpm'], ['respiratoryRate', 'Frecuencia respiratoria', 'rpm'],
  ['temperature', 'Temperatura', '°C'], ['oxygen', 'Saturación de oxígeno', '%'],
  ['weight', 'Peso', 'kg'], ['height', 'Talla', 'cm'],
] as const;
const empty = (): ConsultationInput => ({ date: today(), vitals: {}, reason: '', examination: '', diagnosis: '', status: 'draft' });

// El borrador se guarda solo, tras una pausa breve desde la última tecla. Nunca
// cambia el estado del registro: finalizar sigue siendo una acción explícita.
const autosavePause = 1500;
const retryLimit = 30_000;
type Autosave =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'retrying' }
  | { state: 'invalid'; message: string }
  | { state: 'expired' };

function savedTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function AutosaveBadge({ autosave, resume }: { autosave: Autosave; resume: boolean }) {
  switch (autosave.state) {
    case 'saving': return <Badge live><LoaderCircle className="spin" size={14} /> Guardando el borrador…</Badge>;
    case 'saved': return <Badge tone="green" live><CheckCircle2 size={14} /> Borrador guardado a las {savedTime(autosave.at)}</Badge>;
    case 'retrying': return <Badge tone="amber" live><CloudOff size={14} /> Sin guardar; se reintenta</Badge>;
    case 'invalid': return <Badge tone="amber" live><TriangleAlert size={14} /> No se puede guardar</Badge>;
    case 'expired': return <Badge tone="amber" live><TriangleAlert size={14} /> Sesión vencida</Badge>;
    default: return <Badge><LockKeyhole size={14} /> {resume ? 'Borrador guardado' : 'Todavía no se guardó'}</Badge>;
  }
}

function autosaveMessage(autosave: Autosave) {
  if (autosave.state === 'retrying') return 'No se pudo guardar el borrador. Revisá la conexión: se reintenta automáticamente y el texto sigue en pantalla.';
  if (autosave.state === 'expired') return 'Tu sesión terminó y el borrador no se guardó. Volvé a ingresar; el texto que escribiste sigue en pantalla.';
  if (autosave.state === 'invalid') return autosave.message;
  return '';
}

export function ConsultationPage() {
  const { id, consultationId } = useParams();
  const { detail, error: loadError } = usePatientDetail(id);
  const [form, setForm] = useState<ConsultationInput>(empty);
  const [dirty, setDirty] = useState(false);
  const [amending, setAmending] = useState(false);
  const [amendmentReason, setAmendmentReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [autosave, setAutosave] = useState<Autosave>({ state: 'idle' });
  const navigate = useNavigate();
  const unsaved = useUnsavedChanges(dirty);
  const createdId = useRef<string | undefined>(undefined);
  const formRef = useRef(form);
  formRef.current = form;
  const revision = useRef(0);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const attempts = useRef(0);
  const retryTimer = useRef<number | undefined>(undefined);
  const persistRef = useRef<() => Promise<void>>(async () => {});
  const existing = detail?.consultations.find(consultation => consultation.id === consultationId);
  const finalized = existing?.status === 'finalized';
  useEffect(() => {
    if (existing) setForm(existing);
    else if (!consultationId) setForm(empty());
  }, [existing, consultationId]);

  useEffect(() => { persistRef.current = persist; });
  useEffect(() => () => window.clearTimeout(retryTimer.current), []);
  // Cada tecla reinicia la pausa. Un guardado fallido no reprograma acá: lo
  // resuelve el reintento escalonado de persist(). Una consulta finalizada no se
  // autoguarda: su corrección se confirma como enmienda.
  useEffect(() => {
    if (finalized || !dirty) return;
    const timer = window.setTimeout(() => { void persistRef.current(); }, autosavePause);
    return () => window.clearTimeout(timer);
  }, [form, dirty, finalized]);

  // Un solo escritor: si hay un guardado en curso, el siguiente espera y vuelve
  // a enviar el estado más reciente en lugar de pisarlo con datos viejos.
  async function persist() {
    if (!id) return;
    if (inFlight.current) { queued.current = true; return; }
    window.clearTimeout(retryTimer.current);
    inFlight.current = true;
    try {
      do {
        queued.current = false;
        const currentRevision = revision.current;
        const parsed = consultationSchema.safeParse({ ...formRef.current, status: 'draft' });
        if (!parsed.success) { setAutosave({ state: 'invalid', message: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }); return; }
        const target = consultationId ?? createdId.current;
        setAutosave({ state: 'saving' });
        try {
          const { consultation } = await api<{ consultation: Consultation }>(`/api/doctor/patients/${id}/consultations${target ? `/${target}` : ''}`, { method: target ? 'PUT' : 'POST', body: parsed.data });
          if (!target) createdId.current = consultation.id;
          attempts.current = 0;
          if (revision.current === currentRevision) { unsaved.allowNavigation(); setDirty(false); }
          setAutosave({ state: 'saved', at: Date.now() });
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) { setAutosave({ state: 'expired' }); return; }
          if (error instanceof ApiError && error.status === 400) { setAutosave({ state: 'invalid', message: messageOf(error) }); return; }
          attempts.current += 1;
          setAutosave({ state: 'retrying' });
          retryTimer.current = window.setTimeout(() => { void persistRef.current(); }, Math.min(3000 * 2 ** (attempts.current - 1), retryLimit));
          return;
        }
      } while (queued.current);
    } finally { inFlight.current = false; }
  }

  function markDirty() { revision.current += 1; setDirty(true); setReviewing(false); }
  function update(field: 'date' | 'reason' | 'examination' | 'diagnosis', value: string) {
    markDirty(); setForm(previous => ({ ...previous, [field]: value }));
  }
  function updateVital(field: (typeof measurements)[number][0], value: string) {
    markDirty(); setForm(previous => ({ ...previous, vitals: { ...previous.vitals, [field]: value === '' ? undefined : Number(value) } }));
  }
  function review() {
    const parsed = consultationSchema.safeParse({ ...form, status: 'finalized' });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Completá la consulta.'); return; }
    setError(''); setReviewing(true);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewing) { review(); return; }
    if (!id) return;
    setError('');
    const parsed = consultationSchema.safeParse({ ...form, status: 'finalized' });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Revisá los datos.'); return; }
    const target = consultationId ?? createdId.current;
    setSaving(true);
    try {
      await api<{ consultation: Consultation }>(`/api/doctor/patients/${id}/consultations${target ? `/${target}` : ''}`, { method: target ? 'PUT' : 'POST', body: parsed.data });
      unsaved.allowNavigation(); setDirty(false);
      navigate(`/profesional/pacientes/${id}`, { state: { notice: 'Consulta finalizada. No se publicó información en el portal del paciente.' } });
    } catch (error) { setError(messageOf(error)); }
    finally { setSaving(false); }
  }

  // La enmienda se escribe sobre la versión vigente y solo se confirma a mano.
  // El borrador automático nunca corre sobre una consulta finalizada.
  function startAmendment() {
    if (!existing || existing.supersededAt) return;
    setForm(existing);
    setAmendmentReason('');
    setError('');
    setReviewing(false);
    setDirty(false);
    setAmending(true);
  }
  function cancelAmendment() {
    if (dirty && !window.confirm('Hay cambios sin confirmar en la enmienda. ¿Querés descartarlos?')) return;
    if (existing) setForm(existing);
    setAmendmentReason('');
    setError('');
    setReviewing(false);
    setDirty(false);
    setAmending(false);
  }
  function reviewAmendment() {
    const parsed = amendmentRequestSchema.safeParse({ ...form, status: 'finalized', amendmentReason });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Revisá la enmienda.'); return; }
    setError(''); setReviewing(true);
  }
  async function submitAmendment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewing) { reviewAmendment(); return; }
    if (!existing || !id) return;
    setError('');
    const parsed = amendmentRequestSchema.safeParse({ ...form, status: 'finalized', amendmentReason });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Revisá la enmienda.'); return; }
    setSaving(true);
    try {
      // La dirección identifica la versión revisada: el servidor rechaza la
      // enmienda si esa versión ya fue reemplazada.
      await api(`/api/doctor/patients/${id}/consultations/${existing.id}/amendments`, { method: 'POST', body: parsed.data });
      unsaved.allowNavigation(); setDirty(false);
      navigate(`/profesional/pacientes/${id}`, { state: { notice: 'Enmienda registrada. La versión anterior se conserva en el historial de la consulta.' } });
    } catch (reason) { setError(messageOf(reason)); }
    finally { setSaving(false); }
  }

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!detail) return <Loading />;
  if (consultationId && !existing) return <>
    <Link className="back-link" to={`/profesional/pacientes/${id}`}><ArrowLeft size={18} /> Volver a la ficha</Link>
    <Alert>No se encontró esa consulta en la ficha. Puede haber sido reemplazada por otra versión.</Alert>
  </>;
  const patient = detail.patient;
  const notice = autosaveMessage(autosave);
  // Cadena de versiones de la consulta: la vigente es la última y cada enmienda
  // reemplazó a la versión anterior de la cadena.
  const chain = existing ? consultationChain(detail.consultations, existing) : [];
  const currentVersion = chain.at(-1);
  const amendmentHistory = chain.slice(1).map((amendment, position) => ({ amendment, replaced: chain[position] }));
  const superseded = Boolean(existing?.supersededAt);
  const editable = !finalized || amending;
  const labels = amending
    ? { review: 'Revisar y confirmar', confirm: 'Confirmar enmienda', busy: 'Registrando…' }
    : { review: 'Revisar y finalizar', confirm: 'Confirmar finalización', busy: 'Finalizando…' };

  return <>
    <Link className="back-link" to={`/profesional/pacientes/${id}`}><ArrowLeft size={18} /> Volver a la ficha</Link>
    <PageHeader
      eyebrow={`${patient.firstName} ${patient.lastName} · DNI ${displayDni(patient.dni)}`}
      title={amending ? 'Enmendar consulta' : finalized ? 'Consulta finalizada' : consultationId ? 'Continuar consulta' : 'Nueva consulta'}
      description={amending ? 'La versión anterior se conserva en el historial.' : finalized ? displayDate(form.date) : 'Registrá la atención. Nada se publica automáticamente.'}
    />
    <div className="editor-status">{amending ? <Badge tone="amber"><PencilLine size={14} /> Enmienda sin confirmar</Badge> : finalized ? <Badge tone="green">Registro finalizado</Badge> : <AutosaveBadge autosave={autosave} resume={Boolean(consultationId)} />}<span><LockKeyhole size={16} /> Solo para uso profesional</span></div>
    {notice && <Alert>{notice}</Alert>}
    {editable ? <form className="card form-card" onSubmit={amending ? submitAmendment : save}>
      <label className="date-field">Fecha de consulta <span className="required">*</span><input type="date" required value={form.date} readOnly={reviewing} onChange={event => update('date', event.target.value)} /></label>
      <div className="form-divider" /><div className="form-section-title"><span className="step-number">1</span><div><h2>Signos vitales</h2><p>Dejá vacías las mediciones que no se realizaron.</p></div></div>
      <div className="vitals-grid">{measurements.map(([field, label, unit]) => <label key={field}>{label}<div className="input-unit"><input type="number" min="0.01" max={field === 'oxygen' ? 100 : 1000} step="any" inputMode="decimal" aria-label={label} placeholder="Sin medir" readOnly={reviewing} value={form.vitals[field] ?? ''} onChange={event => updateVital(field, event.target.value)} /><span>{unit}</span></div></label>)}</div>
      <div className="form-divider" /><div className="form-section-title"><span className="step-number">2</span><div><h2>Registro clínico</h2><p>Estos campos son necesarios para finalizar; un borrador puede quedar incompleto.</p></div></div>
      <div className="form-field"><label htmlFor="consultation-reason">Motivo de consulta</label><textarea id="consultation-reason" maxLength={5000} rows={3} readOnly={reviewing} value={form.reason} onChange={event => update('reason', event.target.value)} placeholder="¿Qué refiere el paciente?" /></div>
      <div className="form-field"><label htmlFor="consultation-examination">Examen físico</label><textarea id="consultation-examination" maxLength={10000} rows={4} readOnly={reviewing} value={form.examination} onChange={event => update('examination', event.target.value)} placeholder="Hallazgos de la evaluación" /></div>
      <div className="form-field"><label htmlFor="consultation-diagnosis">Diagnóstico</label><textarea id="consultation-diagnosis" maxLength={5000} rows={3} readOnly={reviewing} value={form.diagnosis} onChange={event => update('diagnosis', event.target.value)} placeholder="Diagnóstico registrado en esta consulta" /></div>
      {amending && <>
        <div className="form-divider" /><div className="form-section-title"><span className="step-number">3</span><div><h2>Motivo de la enmienda</h2><p>Queda guardado junto a la versión que se reemplaza.</p></div></div>
        <div className="form-field"><label htmlFor="amendment-reason">Motivo de la enmienda <span className="required">*</span></label><textarea id="amendment-reason" maxLength={500} rows={2} readOnly={reviewing} value={amendmentReason} onChange={event => { markDirty(); setAmendmentReason(event.target.value); }} placeholder="Por qué se corrige esta consulta finalizada" /></div>
      </>}
      {error && <Alert>{error}</Alert>}
      {reviewing && <div className="review-notice">
        <h3>{amending ? '¿Registrar esta enmienda?' : '¿Finalizar esta consulta?'}</h3>
        <p>{amending ? 'La versión anterior se guarda con su texto original y el motivo declarado. Esta acción no publica nada para el paciente.' : 'Revisá el contenido. Después no se podrá sobrescribir. Esta acción no publica nada para el paciente.'}</p>
        <button className="text-button" type="button" onClick={() => setReviewing(false)}>Volver a editar</button>
      </div>}
      <div className="form-actions">
        {amending && <button className="button secondary" type="button" disabled={saving} onClick={cancelAmendment}>Cancelar enmienda</button>}
        {reviewing
          ? <button key="confirm" className="button primary" disabled={saving} type="submit"><Check size={19} /> {saving ? labels.busy : labels.confirm}</button>
          : <button key="review" className="button primary" disabled={saving} type="button" onClick={event => { event.preventDefault(); if (amending) reviewAmendment(); else review(); }}>{labels.review}</button>}
      </div>
      <p className="helper-text">{amending ? 'La enmienda conserva la versión anterior en el historial y no publica nada en el portal del paciente.' : 'El borrador se guarda solo mientras escribís. Finalizar no publica nada en el portal del paciente.'}</p>
    </form> : <section className="card form-card">
      {superseded
        ? <Alert>Esta versión fue reemplazada el {displayMoment(existing!.supersededAt!)}. <Link to={`/profesional/pacientes/${id}/consultas/${currentVersion?.id}`}>Ver la versión vigente</Link></Alert>
        : <Alert success>Registro finalizado. No se sobrescribe: si hay que corregirlo, se registra una enmienda con su motivo y la versión anterior queda en el historial.</Alert>}
      <h2>Signos vitales</h2>
      <div className="readings-grid">{measurements.map(([field, label, unit]) => <div key={field}><span>{label}</span><strong>{form.vitals[field] === undefined ? 'No registrado' : `${form.vitals[field]} ${unit}`}</strong></div>)}</div>
      {([['reason', 'Motivo de consulta'], ['examination', 'Examen físico'], ['diagnosis', 'Diagnóstico']] as const).map(([field, label]) => <div className="clinical-section" key={field}><h2>{label}</h2><p className="preserve-lines">{form[field]}</p></div>)}
      {!superseded && amendmentHistory.length > 0 && <section className="clinical-section">
        <h2>Historial de enmiendas</h2>
        <p>Nada se borra. Cada enmienda conserva el texto original de la versión que reemplazó y el motivo declarado.</p>
        {[...amendmentHistory].reverse().map(({ amendment, replaced }) => <article className="amendment-entry" key={amendment.id}>
          <div className="inline-heading"><h3>Enmienda del {displayMoment(amendment.updatedAt)}</h3>{amendment.id === existing?.id && <Badge tone="green">Versión vigente</Badge>}</div>
          <p><strong>Motivo:</strong> {amendment.amendmentReason}</p>
          {replaced && <Link className="text-link" to={`/profesional/pacientes/${id}/consultas/${replaced.id}`}>Ver la versión reemplazada del {displayDate(replaced.date)}</Link>}
        </article>)}
      </section>}
      {!superseded && <div className="form-actions"><button className="button primary" type="button" onClick={startAmendment}><PencilLine size={19} /> Enmendar esta consulta</button></div>}
    </section>}
  </>;
}
