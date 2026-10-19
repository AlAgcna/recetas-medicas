import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Eye, FileText, Send, ShieldCheck } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { displayDni, pdfPolicy, publicationSchema, type GeneralIndications, type Patient, type Publication, type PublicationInput } from '../shared/contracts';
import { api, messageOf } from './api';
import { usePatientDetail } from './Patients';
import { Alert, Badge, IndicationSignature, Loading, PageHeader, useUnsavedChanges } from './ui';

export function PublicationPage() {
  const { id } = useParams();
  const { detail, error: loadError } = usePatientDetail(id);
  const navigate = useNavigate();
  if (loadError) return <Alert>{loadError}</Alert>;
  if (!detail) return <Loading />;
  return <PublicationEditor scope="patient" patient={detail.patient}
    active={detail.publications.find(item => item.active && item.kind === 'indication') ?? null}
    onPublished={() => navigate(`/profesional/pacientes/${id}`, { state: { notice: 'Documento publicado. El paciente puede acceder sin autorización adicional.' } })} />;
}

export function GeneralIndicationPage() {
  const [data, setData] = useState<GeneralIndications>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined); setError('');
    void api<GeneralIndications>('/api/doctor/general-indications', { signal: controller.signal }).then(setData).catch(error => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setError(messageOf(error));
    });
    return () => controller.abort();
  }, [revision]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  return <>
    {notice && <Alert success>{notice}</Alert>}
    <PublicationEditor key={data.active?.id ?? 'new-general'} scope="general" active={data.active} onPublished={() => {
      setNotice('Indicación general publicada. Está disponible para todos los pacientes al ingresar a su portal.');
      setRevision(value => value + 1);
    }} />
    {data.history.some(item => !item.active) && <details className="card indication-history"><summary>Historial de indicaciones generales</summary>{data.history.filter(item => !item.active).map(item => <article className="historical-indication" key={item.id}><Badge>Histórica · No visible en el portal</Badge><h3>{item.title}</h3><p className="preserve-lines">{item.content}</p></article>)}</details>}
  </>;
}

type EditorProps = { active: Publication | null; onPublished: () => void } & (
  { scope: 'general' } | { scope: 'patient'; patient: Patient }
);

function PublicationEditor(props: EditorProps) {
  const general = props.scope === 'general';
  const patient = props.scope === 'patient' ? props.patient : undefined;
  const backTo = patient ? `/profesional/pacientes/${patient.id}` : '/profesional';
  const [form, setForm] = useState<PublicationInput>({
    kind: 'indication', title: general ? props.active?.title ?? '' : '', content: general ? props.active?.content ?? '' : '',
  });
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [approved, setApproved] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfConfirmed, setPdfConfirmed] = useState(false);
  const [reviewedActiveId, setReviewedActiveId] = useState<string | null>(null);
  const unsaved = useUnsavedChanges(dirty);
  const replacing = form.kind === 'indication' && props.active !== null;
  const needsApproval = general || replacing;
  function review(event: FormEvent) {
    event.preventDefault();
    const parsed = publicationSchema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Revisá los campos.'); return; }
    if (form.kind === 'prescription') {
      if (!pdfFile) { setError('Adjuntá el PDF original de la receta.'); return; }
      if (!/\.pdf$/i.test(pdfFile.name) || pdfFile.size === 0) { setError('Seleccioná un archivo PDF válido.'); return; }
      if (pdfFile.size > pdfPolicy.maxFileBytes) { setError('El PDF supera el máximo de 5 MB.'); return; }
    }
    setPdfConfirmed(false);
    setReviewedActiveId(props.active?.id ?? null); setApproved(false); setError(''); setPreview(true);
  }
  async function publish() {
    if ((needsApproval && !approved) || (form.kind === 'prescription' && !pdfConfirmed)) return;
    setSaving(true); setError('');
    try {
      if (form.kind === 'prescription') {
        if (!pdfFile) throw new Error('Adjuntá el PDF original de la receta.');
        const multipart = new FormData();
        multipart.set('title', form.title); multipart.set('content', form.content); multipart.set('pdf', pdfFile);
        await api(`/api/doctor/patients/${patient!.id}/prescriptions`, { method: 'POST', body: multipart });
      } else {
        await api(general ? '/api/doctor/general-indications' : `/api/doctor/patients/${patient!.id}/publications`, {
          method: 'POST', body: { ...form, expectedActiveId: reviewedActiveId },
        });
      }
      unsaved.allowNavigation(); setDirty(false);
      props.onPublished();
    } catch (error) { setError(messageOf(error)); }
    finally { setSaving(false); }
  }
  return <>
    <Link className="back-link" to={backTo}><ArrowLeft size={18} /> {general ? 'Volver a pacientes' : 'Volver a la ficha'}</Link>
    <PageHeader eyebrow="INDICACIONES Y RECETAS" title={preview ? 'Revisar antes de publicar' : general ? 'Indicación general' : 'Añadir Indicación/Receta'} description={patient ? `${patient.firstName} ${patient.lastName} · DNI ${displayDni(patient.dni)}` : 'Una única indicación general activa para todos los pacientes.'} />
    {error && <Alert>{error}</Alert>}
    {!preview ? <form className="card form-card" onSubmit={review}>
      {general ? <Alert>Esta indicación se mostrará a todos los pacientes, también a quienes se incorporen después. No incluyas nombres, DNI, diagnósticos ni datos personales.</Alert> : <fieldset className="kind-selector"><legend>¿Qué vas a entregar?</legend><label className={form.kind === 'indication' ? 'chosen' : ''}><input type="radio" name="kind" value="indication" checked={form.kind === 'indication'} onChange={() => { setForm({ kind: 'indication', title: '', content: '' }); setDirty(true); }} /><FileText size={22} /><span><strong>Indicación específica</strong><small>Solo una activa para este paciente</small></span></label><label className={form.kind === 'prescription' ? 'chosen' : ''}><input type="radio" name="kind" value="prescription" checked={form.kind === 'prescription'} onChange={() => { setForm({ kind: 'prescription', title: 'Receta en PDF', content: 'Archivo PDF adjunto, conservado sin modificaciones por el portal.' }); setDirty(true); }} /><FileText size={22} /><span><strong>Receta en PDF</strong><small>Adjuntar el documento original</small></span></label></fieldset>}
      {replacing && <div className="review-notice"><h3>Hay una indicación {general ? 'general' : 'específica'} activa</h3><p>«{props.active!.title}» seguirá activa hasta que confirmes la nueva publicación. Después quedará en el historial, sin borrarse.</p></div>}
      {form.kind === 'prescription' && <>
        <Alert>En esta demostración usá solo PDF ficticios. El portal no emite recetas ni verifica firmas digitales.</Alert>
        <div className="form-field"><label htmlFor="prescription-pdf">PDF original de la receta</label><input id="prescription-pdf" type="file" accept=".pdf,application/pdf" required={!pdfFile} onChange={event => { setPdfFile(event.target.files?.[0] ?? null); setDirty(true); }} />
          <p className="helper-text">Máximo 5 MB. Adjuntá el archivo original descargado de Digidoc, sin reimprimirlo, convertirlo ni agregarle contraseñas: eso podría eliminar o invalidar una firma existente. No se muestra una vista previa del archivo.</p>
          <a className="text-link" href="/api/doctor/sample-prescription">Descargar PDF ficticio para probar</a>
          {pdfFile && <p className="helper-text">Archivo seleccionado: {pdfFile.name} · {pdfFile.size.toLocaleString('es-AR')} bytes</p>}
        </div>
      </>}
      <label>Título<input required maxLength={150} value={form.title} onChange={event => { setDirty(true); setForm(previous => ({ ...previous, title: event.target.value })); }} placeholder="Por ejemplo, indicaciones de la consulta" /></label>
      <div className="form-field"><label htmlFor="publication-content">{general ? 'Indicaciones generales para todos los pacientes' : form.kind === 'indication' ? 'Indicaciones para el paciente' : 'Descripción de la receta'}</label><textarea id="publication-content" required maxLength={5000} rows={7} value={form.content} onChange={event => { setDirty(true); setForm(previous => ({ ...previous, content: event.target.value })); }} placeholder="Usá un texto ficticio para probar la entrega." /></div>
      <div className="quiet-note"><ShieldCheck size={20} /><p>La historia clínica, el diagnóstico interno y los estudios no se agregan a esta entrega.</p></div>
      <div className="form-actions"><Link className="button secondary" to={backTo}>Cancelar</Link><button className="button primary" type="submit"><Eye size={20} /> Vista previa</button></div>
    </form> : <section className="card form-card preview-card">
      <Badge tone="amber">Vista previa · Todavía no publicado</Badge><h2>Lo que verá el paciente</h2><div className="recipient"><span>DESTINATARIO</span><strong>{patient ? `${patient.firstName} ${patient.lastName}` : 'Todos los pacientes'}</strong><small>{patient ? `DNI ${displayDni(patient.dni)}` : 'Indicación general compartida en todos los portales'}</small></div>
      <article className="preview-document"><FileText size={28} /><h3>{form.title}</h3><p className="preserve-lines">{form.content}</p>{form.kind === 'indication' && <IndicationSignature />}{form.kind === 'prescription' && <><Badge>PDF original adjunto · Sin edición en el portal</Badge><p className="helper-text">{pdfFile?.name} · {pdfFile?.size.toLocaleString('es-AR')} bytes. Se calculará una huella SHA-256 al publicar.</p></>}</article>
      <p className="helper-text">Confirmá que el destinatario y el contenido son correctos. Publicar no envía un mensaje por WhatsApp.</p>
      {replacing && <Alert>La indicación {general ? 'general' : 'específica'} «{props.active!.title}» dejará de estar activa y quedará en el historial. No se reemplazan recetas ni la indicación {general ? 'específica' : 'general'}.</Alert>}
      {needsApproval && <label className="checkbox-label"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} /><span>{general ? 'Confirmo que esta indicación general no contiene datos personales y se publicará para todos los pacientes.' : 'Confirmo el reemplazo de la indicación específica activa y su conservación en el historial.'}</span></label>}
      {form.kind === 'prescription' && <label className="checkbox-label"><input type="checkbox" checked={pdfConfirmed} onChange={event => setPdfConfirmed(event.target.checked)} /><span>Confirmo que revisé el paciente y el PDF seleccionado. En esta demo el documento es ficticio.</span></label>}
      <div className="form-actions"><button className="button secondary" disabled={saving} onClick={() => setPreview(false)}>Volver a editar</button><button className="button primary" disabled={saving || (needsApproval && !approved) || (form.kind === 'prescription' && !pdfConfirmed)} onClick={publish}><Send size={19} />{saving ? 'Publicando…' : 'Confirmar publicación'}</button></div>
    </section>}
  </>;
}
