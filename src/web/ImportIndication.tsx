import { useState, type FormEvent } from 'react';
import { ArrowLeft, FileUp } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { displayDate, displayDni, indicationImportPolicy, indicationImportSchema, today, type IndicationImportPreview } from '../shared/contracts';
import { api, messageOf } from './api';
import { usePatientDetail } from './Patients';
import { Alert, Badge, Loading, PageHeader, useUnsavedChanges } from './ui';

export function ImportIndicationPage() {
  const { id } = useParams();
  const { detail, error } = usePatientDetail(id);
  if (error) return <Alert>{error}</Alert>;
  if (!detail) return <Loading />;
  return <ImportEditor key={detail.patient.id} patientId={detail.patient.id}
    patientLabel={`${detail.patient.firstName} ${detail.patient.lastName} · DNI ${displayDni(detail.patient.dni)}`} />;
}

function ImportEditor({ patientId, patientLabel }: { patientId: string; patientLabel: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<IndicationImportPreview | null>(null);
  const [title, setTitle] = useState('Indicación histórica');
  const [content, setContent] = useState('');
  const [date, setDate] = useState('');
  const [unknownDate, setUnknownDate] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const unsaved = useUnsavedChanges(dirty);
  const navigate = useNavigate();
  const backTo = `/profesional/pacientes/${patientId}`;
  const endpoint = `/api/doctor/patients/${patientId}/indication-imports`;
  const input = { title, content, documentDate: unknownDate ? null : date, sourceSha256: preview?.sha256, reviewed: true };

  async function readWord(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!file) { setError('Elegí el Word de la indicación.'); return; }
    if (!/\.docx$/i.test(file.name) || !file.size || file.size > indicationImportPolicy.maxFileBytes) { setError('Elegí un Word .docx con contenido, de hasta 5 MB.'); return; }
    setBusy(true);
    try {
      const form = new FormData(); form.set('word', file);
      const extracted = await api<IndicationImportPreview>(`${endpoint}/preview`, { method: 'POST', body: form });
      setPreview(extracted); setContent(extracted.content);
    } catch (error) { setError(messageOf(error)); }
    finally { setBusy(false); }
  }
  function change(action: () => void) {
    action(); setDirty(true); setError('');
  }
  function review(event: FormEvent) {
    event.preventDefault(); setError('');
    const parsed = indicationImportSchema.safeParse(input);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Revisá el texto y la fecha.'); return; }
    if (parsed.data.documentDate && parsed.data.documentDate > today()) { setError('La fecha histórica no puede ser futura.'); return; }
    setApproved(false); setReviewing(true);
  }
  async function confirm() {
    if (!approved || !file || !preview) return;
    setBusy(true); setError('');
    try {
      const form = new FormData(); form.set('word', file); form.set('metadata', JSON.stringify(input));
      await api(endpoint, { method: 'POST', body: form });
      unsaved.allowNavigation(); setDirty(false);
      navigate(backTo, { state: { tab: 'publications', notice: 'Indicación importada al historial. No se publicó ni se modificó la indicación vigente.' } });
    } catch (error) { setError(messageOf(error)); }
    finally { setBusy(false); }
  }
  function chooseAnother() {
    if (!window.confirm('¿Querés descartar esta revisión y elegir otro Word?')) return;
    setFile(null); setPreview(null); setTitle('Indicación histórica'); setContent(''); setDate(''); setUnknownDate(false); setDirty(false); setError('');
  }
  return <>
    <Link className="back-link" to={backTo}><ArrowLeft size={18} /> Volver a la ficha</Link>
    <PageHeader eyebrow="HISTORIAL DE INDICACIONES" title={reviewing ? 'Revisar importación histórica' : preview ? 'Revisar el Word importado' : 'Importar indicación desde Word'} description={patientLabel} />
    <Alert>Se agregará únicamente al historial profesional. No se publica al paciente ni reemplaza su indicación vigente.</Alert>
    {error && <Alert>{error}</Alert>}
    {!preview ? <form className="card form-card" onSubmit={readWord}>
      <label>Word original de la indicación<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setDirty(Boolean(event.target.files?.[0])); setError(''); }} /></label>
      <p className="helper-text">Un archivo .docx por vez, hasta 5 MB. Conservamos el original. No se admiten PDF, .doc, accesos directos, macros ni vínculos externos. No se ejecuta Word ni se realiza OCR.</p>
      <div className="form-actions"><button type="submit" className="button primary" disabled={busy}><FileUp size={20} />{busy ? 'Leyendo Word…' : 'Leer Word y revisar'}</button></div>
    </form> : !reviewing ? <form className="card form-card" onSubmit={review}>
      <p className="preserve-lines">Archivo original: {preview.originalName}</p>
      <p>Revisá todo el texto: no se interpreta el tratamiento ni se decide el paciente automáticamente. Las imágenes y firmas quedan en el original, no se convierten a texto.</p>
      {preview.hasImages && <p className="helper-text">El archivo contiene imágenes. Revisá también el Word original antes de confirmar.</p>}
      <label>Título de la indicación histórica<input required maxLength={150} value={title} onChange={event => change(() => setTitle(event.target.value))} /></label>
      <div className="form-field"><label htmlFor="import-content">Texto de la indicación histórica</label><textarea id="import-content" required maxLength={5000} rows={12} value={content} onChange={event => change(() => setContent(event.target.value))} /></div>
      <div className="form-field"><label htmlFor="import-date">Fecha de la indicación</label><input id="import-date" type="date" aria-describedby="import-date-help" required={!unknownDate} disabled={unknownDate} max={today()} value={date} onChange={event => change(() => setDate(event.target.value))} /><p id="import-date-help" className="helper-text">La fecha del documento, no la fecha de carga. No la completamos automáticamente.</p></div>
      <label className="checkbox-label"><input type="checkbox" checked={unknownDate} onChange={event => change(() => setUnknownDate(event.target.checked))} /><span>Se desconoce la fecha del documento</span></label>
      <div className="form-actions"><button type="button" className="button secondary" onClick={chooseAnother}>Elegir otro Word</button><button type="submit" className="button primary">Revisar importación</button></div>
    </form> : <section className="card form-card preview-card">
      <Badge>Histórica importada · No visible en el portal</Badge>
      <h2>{title}</h2><p>{unknownDate ? 'Fecha del documento desconocida' : displayDate(date)}</p>
      <p className="preserve-lines">{content}</p>
      <p className="preserve-lines">Paciente: {patientLabel}<br />Original: {preview.originalName}</p>
      <label className="checkbox-label"><input type="checkbox" checked={approved} disabled={busy} onChange={event => setApproved(event.target.checked)} /><span>Confirmo que revisé el paciente, el texto y la fecha del documento.</span></label>
      <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => { setReviewing(false); setError(''); }}>Volver a revisar</button><button type="button" className="button primary" disabled={busy || !approved} onClick={confirm}>{busy ? 'Importando…' : 'Confirmar importación al historial'}</button></div>
    </section>}
  </>;
}
