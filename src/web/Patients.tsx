import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronRight, ClipboardList, FileText, LockKeyhole, Plus, Search, ShieldCheck, Users } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { displayDate, displayDni, patientSchema, type Patient, type PatientDetail, type PatientInput } from '../shared/contracts';
import { insuranceKey, insuranceLabel, insuranceOptions } from '../shared/insurance';
import { InsuranceSelect } from './InsuranceSelect';
import { PdfIntegrity } from './PdfIntegrity';
import { api, messageOf } from './api';
import { Alert, Badge, IndicationSignature, initials, Loading, PageHeader, useUnsavedChanges } from './ui';

export function usePatientDetail(id: string | undefined) {
  const [detail, setDetail] = useState<PatientDetail>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setDetail(undefined); setError('');
    void api<PatientDetail>(`/api/doctor/patients/${id}`, { signal: controller.signal }).then(setDetail).catch(error => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setError(messageOf(error));
    });
    return () => controller.abort();
  }, [id]);
  return { detail, error };
}

type PatientList = { patients: Patient[]; stats: { patients: number; consultations: number; publications: number } };

export function PatientsPage() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<PatientList>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void api<PatientList>(`/api/doctor/patients?q=${encodeURIComponent(search)}`, { signal: controller.signal }).then(setData).catch(error => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setError(messageOf(error));
    });
    return () => controller.abort();
  }, [search]);
  return <>
    <PageHeader eyebrow="TU ESPACIO DE TRABAJO" title="Pacientes" description="Encontrá una ficha y continuá con la atención." action={<Link className="button primary" to="/profesional/pacientes/nuevo"><Plus size={21} /> Nuevo paciente</Link>} />
    <div className="stats-grid">
      <div className="stat-card"><span className="stat-icon"><Users /></span><div><strong>{data?.stats.patients ?? '—'}</strong><span>Pacientes registrados</span></div></div>
      <div className="stat-card"><span className="stat-icon blue"><ClipboardList /></span><div><strong>{data?.stats.consultations ?? '—'}</strong><span>Consultas registradas</span></div></div>
      <div className="stat-card"><span className="stat-icon sand"><FileText /></span><div><strong>{data?.stats.publications ?? '—'}</strong><span>Documentos publicados</span></div></div>
    </div>
    <section className="card search-card" aria-labelledby="search-title">
      <h2 id="search-title">¿A quién vas a atender?</h2><p>Buscá por DNI, nombre o apellido.</p>
      <form className="search-form" onSubmit={(event: FormEvent) => { event.preventDefault(); setSearch(query.trim()); }}>
        <div className="search-input"><Search size={22} aria-hidden="true" /><label className="sr-only" htmlFor="patient-search">Buscar paciente</label><input id="patient-search" placeholder="Escribí un DNI, nombre o apellido" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <button className="button primary" type="submit">Buscar</button>
      </form>
    </section>
    {error && <Alert>{error}</Alert>}
    <div className="section-heading"><h2>{search ? 'Resultados de búsqueda' : 'Fichas del consultorio'}</h2>{data && <span>{data.patients.length} {data.patients.length === 1 ? 'paciente' : 'pacientes'}</span>}</div>
    {!data && !error && <Loading />}
    {data && <section className="patient-list" aria-label="Pacientes registrados">{data.patients.map(patient => <Link className="patient-row" key={patient.id} to={`/profesional/pacientes/${patient.id}`}>
      <span className="avatar">{initials(patient.firstName, patient.lastName)}</span><div className="patient-name"><h3>{patient.firstName || patient.lastName ? `${patient.lastName}${patient.lastName && patient.firstName ? ', ' : ''}${patient.firstName}` : 'Ficha por completar'}</h3><span>DNI {displayDni(patient.dni)}</span></div>
      <div className="patient-insurance"><span className="field-caption">COBERTURA</span><span>{insuranceLabel(patient.insurance)}</span></div>
      <Badge tone={patient.contactVerified ? 'green' : 'amber'}>{patient.contactVerified ? <><Check size={14} /> Contacto verificado</> : 'Contacto por verificar'}</Badge><ChevronRight size={22} className="row-arrow" />
    </Link>)}{!data.patients.length && <div className="empty-state"><Search size={32} /><h3>No encontramos esa ficha</h3><p>Revisá el DNI o creá un paciente nuevo.</p><Link to="/profesional/pacientes/nuevo" className="button secondary">Nuevo paciente</Link></div>}</section>}
    <div className="quiet-note"><ShieldCheck size={20} /><p>La historia clínica es interna. Solo las indicaciones y recetas que publiques aparecen en el portal del paciente.</p></div>
  </>;
}

const emptyPatient: PatientInput = { dni: '', whatsapp: '+54', firstName: '', lastName: '', insurance: 'Particular', memberNumber: '', contactVerified: false };

export function PatientForm() {
  const { id } = useParams();
  const { detail, error: loadError } = usePatientDetail(id);
  const [form, setForm] = useState<PatientInput>(emptyPatient);
  const [insuranceChoice, setInsuranceChoice] = useState<string>('Particular');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const navigate = useNavigate();
  const unsaved = useUnsavedChanges(dirty);
  useEffect(() => {
    if (!detail) return;
    setForm(detail.patient);
    const known = insuranceOptions.find(option => insuranceKey(option) === insuranceKey(insuranceLabel(detail.patient.insurance)));
    setInsuranceChoice(known ?? '__other__');
  }, [detail]);
  const update = (field: keyof PatientInput, value: string | boolean) => { setDirty(true); setForm(previous => ({ ...previous, [field]: value })); };
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (insuranceChoice === '__other__' && !form.insurance?.trim()) { setError('Escribí el nombre de la obra social.'); return; }
    const parsed = patientSchema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Revisá los campos.'); return; }
    setSaving(true);
    try {
      const body = id ? { firstName: parsed.data.firstName, lastName: parsed.data.lastName, insurance: parsed.data.insurance, memberNumber: parsed.data.memberNumber } : parsed.data;
      const { patient } = await api<{ patient: Patient }>(id ? `/api/doctor/patients/${id}` : '/api/doctor/patients', { method: id ? 'PATCH' : 'POST', body });
      unsaved.allowNavigation(); setDirty(false);
      navigate(`/profesional/pacientes/${patient.id}`, { state: { notice: 'Datos guardados en la memoria del prototipo.' } });
    } catch (error) { setError(messageOf(error)); }
    finally { setSaving(false); }
  }
  if (loadError) return <Alert>{loadError}</Alert>;
  if (id && !detail) return <Loading />;
  return <>
    <Link className="back-link" to={id ? `/profesional/pacientes/${id}` : '/profesional'}><ArrowLeft size={18} /> {id ? 'Volver a la ficha' : 'Volver a pacientes'}</Link>
    <PageHeader eyebrow="FICHA DEL PACIENTE" title={id ? 'Completar datos' : 'Nuevo paciente'} description="El DNI y el WhatsApp son el punto de partida. Usá únicamente datos ficticios." />
    <form className="card form-card" onSubmit={submit}>
      <div className="form-section-title"><span className="step-number">1</span><div><h2>Identificación y contacto</h2><p>El código de acceso se destinará al número asociado.</p></div></div>
      <div className="form-grid">
        <label>DNI <span className="required">*</span><input required inputMode="numeric" autoComplete="off" value={form.dni} disabled={Boolean(id)} onChange={event => update('dni', event.target.value)} placeholder="Por ejemplo, 00000003" /></label>
        <label>WhatsApp <span className="required">*</span><input required type="tel" autoComplete="off" value={form.whatsapp} disabled={Boolean(id)} onChange={event => update('whatsapp', event.target.value)} placeholder="+5493800000003" /><small>Con código de país, sin espacios ni guiones.</small></label>
      </div>
      {!id ? <label className="checkbox-label"><input type="checkbox" checked={form.contactVerified} onChange={event => update('contactVerified', event.target.checked)} /><span>Simular que el contacto fue verificado<small>Solo para el prototipo. No realiza una verificación real.</small></span></label> : <p className="helper-text">DNI y WhatsApp no se modifican aquí. La verificación y el cambio seguro de contacto se implementarán en otra etapa.</p>}
      <div className="form-divider" />
      <div className="form-section-title"><span className="step-number">2</span><div><h2>Datos de la ficha</h2><p>Completá nombre y apellido antes de finalizar una consulta.</p></div></div>
      <div className="form-grid">
        <label>Nombre<input autoComplete="off" maxLength={100} value={form.firstName} onChange={event => update('firstName', event.target.value)} placeholder="Nombre de ejemplo" /></label>
        <label>Apellido<input autoComplete="off" maxLength={100} value={form.lastName} onChange={event => update('lastName', event.target.value)} placeholder="Apellido de ejemplo" /></label>
        <InsuranceSelect value={insuranceChoice} onChange={value => {
          setInsuranceChoice(value);
          update('insurance', value === '__other__' ? '' : value);
        }} />
        <label>Número de afiliado<input maxLength={100} value={form.memberNumber} onChange={event => update('memberNumber', event.target.value)} placeholder="Si corresponde" /></label>
        {insuranceChoice === '__other__' && <label>Nombre de la obra social<input required maxLength={150} value={form.insurance} onChange={event => update('insurance', event.target.value)} placeholder="Escribí la cobertura que no figura en la lista" /></label>}
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="form-actions"><Link className="button secondary" to={id ? `/profesional/pacientes/${id}` : '/profesional'}>Cancelar</Link><button className="button primary" disabled={saving} type="submit"><Check size={20} />{saving ? 'Guardando…' : 'Guardar paciente'}</button></div>
      <p className="helper-text">Guardado temporal: estos datos se pierden al reiniciar el servidor.</p>
    </form>
  </>;
}

export function PatientDetailPage() {
  const { id } = useParams();
  const { detail, error } = usePatientDetail(id);
  const [tab, setTab] = useState<'consultations' | 'documents' | 'publications'>('consultations');
  const location = useLocation();
  if (error) return <Alert>{error}</Alert>;
  if (!detail) return <Loading />;
  const { patient, documents, publications, generalIndication } = detail;
  // El registro muestra solo la versión vigente de cada consulta. Las versiones
  // reemplazadas por una enmienda viven en el historial de la consulta.
  const consultations = detail.consultations.filter(item => !item.supersededAt);
  const currentPublications = publications.filter(item => item.active);
  const archivedIndications = publications.filter(item => item.kind === 'indication' && !item.active);
  return <>
    <Link className="back-link" to="/profesional"><ArrowLeft size={18} /> Volver a pacientes</Link>
    <PageHeader eyebrow="FICHA DEL PACIENTE" title={`${patient.firstName} ${patient.lastName}`.trim() || 'Ficha por completar'} description={`DNI ${displayDni(patient.dni)}`} action={<Link className="button primary" to={`/profesional/pacientes/${id}/consultas/nueva`}><Plus size={21} /> Nueva consulta</Link>} />
    {location.state?.notice && <Alert success>{location.state.notice}</Alert>}
    <section className="card patient-summary"><div><span className="field-caption">WHATSAPP</span><strong>{patient.whatsapp}</strong><Badge tone={patient.contactVerified ? 'green' : 'amber'}>{patient.contactVerified ? 'Contacto verificado (simulado)' : 'Pendiente de verificación'}</Badge></div><div><span className="field-caption">OBRA SOCIAL</span><strong>{insuranceLabel(patient.insurance)}</strong><span>Afiliado: {patient.memberNumber || 'No corresponde / sin registrar'}</span></div><Link className="text-link" to={`/profesional/pacientes/${id}/datos`}>Completar datos <ChevronRight size={18} /></Link></section>
    {(!patient.firstName || !patient.lastName) && <Alert>La ficha está incompleta. Completá nombre y apellido antes de finalizar una consulta.</Alert>}
    <div className="tabs" role="tablist" aria-label="Secciones de la ficha">
      {([['consultations', 'Consultas', consultations.length], ['documents', 'Documentos internos', documents.length], ['publications', 'Indicaciones y Recetas', currentPublications.length + (generalIndication ? 1 : 0)]] as const).map(([value, label, count]) => <button key={value} role="tab" id={`tab-${value}`} tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} aria-controls={`panel-${value}`} onClick={() => setTab(value)} onKeyDown={event => {
        const options = ['consultations', 'documents', 'publications'] as const;
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const position = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (options.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
        const selected = options[position];
        setTab(selected);
        document.getElementById(`tab-${selected}`)?.focus();
      }} className={tab === value ? 'selected' : ''}>{label}<span>{count}</span></button>)}
    </div>
    <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {tab === 'consultations' && <><div className="section-heading"><h2>Registro de consultas</h2><Badge><LockKeyhole size={14} /> Uso profesional</Badge></div>{consultations.length ? <div className="consultation-list">{consultations.map(consultation => <Link className="card consultation-row" key={consultation.id} to={`/profesional/pacientes/${id}/consultas/${consultation.id}`}><span className="document-symbol"><ClipboardList /></span><div><div className="inline-heading"><h3>{displayDate(consultation.date)}</h3><Badge tone={consultation.status === 'finalized' ? 'green' : 'amber'}>{consultation.status === 'finalized' ? 'Finalizada' : 'Borrador'}</Badge>{consultation.supersedesId && <Badge tone="amber">Enmendada</Badge>}</div><p>{consultation.reason || 'Consulta sin motivo registrado todavía.'}</p></div><ChevronRight size={22} /></Link>)}</div> : <div className="empty-state"><ClipboardList size={32} /><h3>Todavía no hay consultas</h3><p>Empezá el registro de atención de este paciente.</p><Link className="button primary" to={`/profesional/pacientes/${id}/consultas/nueva`}>Nueva consulta</Link></div>}</>}
      {tab === 'documents' && <><div className="section-heading"><h2>Antecedentes y estudios</h2><Badge><LockKeyhole size={14} /> No visibles en el portal</Badge></div>{documents.map(document => <article className="card document-card" key={document.id}><FileText size={27} /><div><h3>{document.name}</h3><p>{document.description}</p><span className="helper-text">Ejemplo visual, sin descarga ni carga de archivos reales en esta etapa.</span></div></article>)}{!documents.length && <div className="empty-state"><FileText size={32} /><h3>Sin documentos de ejemplo</h3><p>La importación de Word y estudios se incorporará después del prototipo.</p></div>}</>}
      {tab === 'publications' && <>
        <div className="section-heading"><h2>Disponible en su portal</h2><Link className="button primary" to={`/profesional/pacientes/${id}/entrega`}><Plus size={19} /> Añadir Indicación/Receta</Link></div>
        <div className="quiet-note"><ShieldCheck size={20} /><p>Como máximo, una indicación general y una específica activas. Las recetas van por separado. Las indicaciones reemplazadas se conservan en el historial.</p></div>
        <article className="card publication-card general-indication-summary"><Badge tone="green">Indicación general · Para todos</Badge><h3>{generalIndication?.title ?? 'Todavía no hay una indicación general'}</h3>{generalIndication && <><p className="preserve-lines">{generalIndication.content}</p><IndicationSignature /></>}<Link className="text-link" to="/profesional/indicacion-general">Gestionar indicación general <ChevronRight size={18} /></Link></article>
        {currentPublications.map(publication => <article className="card publication-card" key={publication.id}><div className="inline-heading"><h3>{publication.title}</h3><Badge tone="green">{publication.kind === 'indication' ? 'Específica · Activa' : 'Receta publicada'}</Badge></div><p className="preserve-lines">{publication.content}</p>{publication.kind === 'indication' && <IndicationSignature />}<span className="helper-text">{publication.kind === 'prescription' ? 'Archivo PDF conservado sin modificaciones por el portal' : 'Solo para este paciente'}</span>{publication.kind === 'prescription' && <a className="button secondary indication-download" href={`/api/doctor/patients/${id}/prescriptions/${publication.id}/download`}>Descargar PDF original</a>}{publication.pdf && <PdfIntegrity pdf={publication.pdf} />}</article>)}
        {!currentPublications.length && <div className="empty-state"><FileText size={32} /><h3>No hay publicaciones específicas para este paciente</h3><p>Las consultas internas no se comparten automáticamente.</p></div>}
        {archivedIndications.length > 0 && <details className="card indication-history"><summary>Historial de indicaciones específicas</summary>{archivedIndications.map(publication => <article className="historical-indication" key={publication.id}><Badge>Histórica · No visible en el portal</Badge><h3>{publication.title}</h3><p className="preserve-lines">{publication.content}</p></article>)}</details>}
        <div className="quiet-note"><ShieldCheck size={20} /><p>Solo lo activo aparece en el portal. El paciente no necesita autorización para cada ingreso.</p></div>
      </>}
    </section>
    {tab !== 'publications' && <Link className="delivery-link" to={`/profesional/pacientes/${id}/entrega`}><FileText size={22} /><div><strong>Añadir Indicación/Receta</strong><span>Revisá el contenido antes de publicarlo para el paciente.</span></div><ArrowRight size={21} /></Link>}
  </>;
}
