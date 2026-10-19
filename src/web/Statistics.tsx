import { useEffect, useState } from 'react';
import { CalendarDays, ClipboardList, FileText, ShieldCheck, Users } from 'lucide-react';
import { monthSchema, today, type MonthlyStatistics } from '../shared/contracts';
import { api, messageOf } from './api';
import { Alert, Badge, Loading, PageHeader } from './ui';

function displayMonth(month: string) {
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}-01T12:00:00Z`));
}

export function StatisticsPage() {
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [data, setData] = useState<MonthlyStatistics>();
  const [error, setError] = useState('');
  const validMonth = monthSchema.safeParse(month).success;

  useEffect(() => {
    setData(undefined); setError('');
    if (!monthSchema.safeParse(month).success) return;
    const controller = new AbortController();
    void api<MonthlyStatistics>(`/api/doctor/statistics?month=${encodeURIComponent(month)}`, { signal: controller.signal })
      .then(setData).catch(error => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setError(messageOf(error));
      });
    return () => controller.abort();
  }, [month]);

  // No mostrar las cifras del período anterior mientras se carga el nuevo.
  const statistics = data?.month === month ? data : undefined;

  return <>
    <PageHeader eyebrow="ACTIVIDAD DEL CONSULTORIO" title="Estadísticas" description="Una mirada a tu atención, mes a mes." />
    <section className="card statistics-filter" aria-label="Período de las estadísticas">
      <div className="statistics-filter-title"><CalendarDays size={25} /><div><h2>Elegí el mes</h2><p>El resumen se actualiza con los registros de ese período.</p></div></div>
      <div className="month-picker"><label htmlFor="statistics-month">Mes de atención</label><input id="statistics-month" type="month" min="1000-01" max="9999-12" value={month} onChange={event => setMonth(event.target.value)} /></div>
      <button className="button secondary" onClick={() => setMonth(today().slice(0, 7))}>Mes actual</button>
    </section>
    {error && <Alert>{error}</Alert>}
    {!validMonth && <Alert>Seleccioná un mes para ver el resumen.</Alert>}
    {validMonth && !statistics && !error && <Loading />}
    {statistics && <>
      <div className="section-heading statistics-month-heading"><h2>{displayMonth(statistics.month)}</h2><Badge tone="green">Solo uso profesional</Badge></div>
      <section className="stats-grid monthly-metrics" aria-label="Resumen mensual">
        <article className="stat-card" aria-labelledby="metric-patients"><span className="stat-icon"><Users /></span><div><h2 id="metric-patients">Pacientes atendidos</h2><strong className="metric-value">{statistics.attendedPatients}</strong><span>Personas únicas en el mes</span></div></article>
        <article className="stat-card" aria-labelledby="metric-consultations"><span className="stat-icon blue"><ClipboardList /></span><div><h2 id="metric-consultations">Consultas finalizadas</h2><strong className="metric-value">{statistics.consultations}</strong><span>Incluye nuevas atenciones del mismo paciente</span></div></article>
        <article className="stat-card" aria-labelledby="metric-prescriptions"><span className="stat-icon sand"><FileText /></span><div><h2 id="metric-prescriptions">Recetas publicadas</h2><strong className="metric-value">{statistics.prescriptions}</strong><span>PDF compartidos en el portal durante el mes</span></div></article>
      </section>
      <section className="card leading-insurance" aria-labelledby="leading-insurance-title">
        <span className="stat-icon"><ShieldCheck size={27} /></span>
        <div><h2 id="leading-insurance-title">Obra social más atendida</h2><strong>{statistics.leadingInsurances.length ? statistics.leadingInsurances.join(' · ') : 'Sin datos de obras sociales'}</strong>
          <p>{statistics.leadingInsurances.length > 1 ? `Empate: ${statistics.leadingInsuranceConsultations} consultas por obra social.` : statistics.leadingInsurances.length === 1 ? `${statistics.leadingInsuranceConsultations} ${statistics.leadingInsuranceConsultations === 1 ? 'consulta finalizada' : 'consultas finalizadas'} en el mes.` : 'Las atenciones particulares o sin cobertura registrada aparecen en el desglose.'}</p>
        </div>
      </section>
      <section className="card insurance-statistics" aria-labelledby="insurance-breakdown-title">
        <h2 id="insurance-breakdown-title">Atenciones por obra social</h2><p className="section-description">Según la cobertura guardada al finalizar cada consulta.</p>
        {statistics.insuranceBreakdown.length ? <div className="statistics-table-scroll"><table className="statistics-table"><caption className="sr-only">Atenciones por cobertura en {displayMonth(statistics.month)}</caption><thead><tr><th scope="col">Cobertura</th><th scope="col">Consultas</th><th scope="col">Pacientes</th><th scope="col">Del total</th></tr></thead><tbody>{statistics.insuranceBreakdown.map(row => <tr key={row.insurance}><th scope="row"><span>{row.insurance}</span><meter min={0} max={statistics.consultations} value={row.consultations} aria-label={`Proporción de consultas de ${row.insurance}`} /></th><td>{row.consultations}</td><td>{row.patients}</td><td>{Math.round(row.consultations / statistics.consultations * 100)} %</td></tr>)}</tbody></table></div> : <div className="empty-state"><CalendarDays size={32} /><h3>No hay consultas finalizadas en este mes</h3><p>Los borradores y las fichas sin atención no suman. Si publicaste recetas, sí aparecen en el resumen.</p></div>}
      </section>
      <details className="card statistics-definitions"><summary>¿Cómo se calculan estos números?</summary><ul>
        <li><strong>Pacientes atendidos:</strong> cada paciente cuenta una sola vez si tiene una consulta finalizada con fecha dentro del mes.</li>
        <li><strong>Consultas:</strong> cada atención finalizada cuenta; los borradores no suman.</li>
        <li><strong>Recetas:</strong> cada PDF publicado cuenta en el mes de publicación, según la hora de La Rioja. No incluye recetas emitidas en Digidoc que no se compartieron en el portal.</li>
        <li><strong>Obras sociales:</strong> se ordenan por cantidad de consultas, no por la cantidad de fichas registradas. Particular y sin registrar se muestran aparte del liderazgo.</li>
        <li>La cobertura queda guardada en la consulta finalizada. Cambiar la ficha después no modifica esos números. Un paciente puede aparecer en más de una cobertura si cambió durante el mes.</li>
      </ul></details>
      <div className="quiet-note"><ShieldCheck size={20} /><p>Resumen calculado con datos ficticios del prototipo. No se utilizan herramientas externas de analítica ni se comparte esta información con pacientes.</p></div>
    </>}
  </>;
}
