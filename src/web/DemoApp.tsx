import { ArrowRight, ShieldCheck, Stethoscope, UserRound } from 'lucide-react';
import { createBrowserRouter, createRoutesFromElements, Link, Navigate, Route, RouterProvider } from 'react-router-dom';
import { DoctorShell } from './DoctorShell';
import { DemoDoctorLogin, DemoPatientHint, DemoPatientInbox } from './DemoBits';
import { PatientDetailPage, PatientForm, PatientsPage } from './Patients';
import { ConsultationPage } from './Consultation';
import { GeneralIndicationPage, PublicationPage } from './Publication';
import { PatientLogin, PatientPortal } from './PatientPortal';
import { StatisticsPage } from './Statistics';
import { Brand } from './ui';

function Landing() {
  return <div className="landing">
    <header className="public-header"><Brand /><span className="location-label">La Rioja · Argentina</span></header>
    <main className="landing-main">
      <span className="eyebrow">UN ESPACIO PARA CUIDAR</span>
      <h1>La atención, más simple.<br /><span>La información, a mano.</span></h1>
      <p className="lead">Un lugar para organizar el consultorio y acercar a cada paciente sus indicaciones y recetas.</p>
      <div className="entry-grid">
        <Link to="/profesional" className="entry-card"><span className="entry-icon"><Stethoscope /></span><h2>Soy la médica</h2><p>Pacientes, consultas y documentación del consultorio.</p><span className="entry-link">Entrar al consultorio <ArrowRight size={20} /></span></Link>
        <Link to="/pacientes/ingreso" className="entry-card"><span className="entry-icon patient-icon"><UserRound /></span><h2>Soy paciente</h2><p>Consultá tus indicaciones y recetas con un código de acceso.</p><span className="entry-link">Ir a mi portal <ArrowRight size={20} /></span></Link>
      </div>
      <p className="privacy-note"><ShieldCheck size={19} /> Demostración con datos ficticios. No ingreses información real.</p>
    </main>
    <footer className="public-footer">Prototipo de experiencia · Sin conexión a WhatsApp, Digidoc ni servicios clínicos</footer>
  </div>;
}

const router = createBrowserRouter(createRoutesFromElements(
    <>
      <Route path="/" element={<Landing />} />
      <Route path="/profesional/ingreso" element={<DemoDoctorLogin />} />
      <Route path="/profesional" element={<DoctorShell demo />}>
        <Route index element={<PatientsPage />} />
        <Route path="estadisticas" element={<StatisticsPage />} />
        <Route path="indicacion-general" element={<GeneralIndicationPage />} />
        <Route path="pacientes/nuevo" element={<PatientForm />} />
        <Route path="pacientes/:id" element={<PatientDetailPage />} />
        <Route path="pacientes/:id/datos" element={<PatientForm />} />
        <Route path="pacientes/:id/consultas/nueva" element={<ConsultationPage />} />
        <Route path="pacientes/:id/consultas/:consultationId" element={<ConsultationPage />} />
        <Route path="pacientes/:id/entrega" element={<PublicationPage />} />
      </Route>
      <Route path="/pacientes/ingreso" element={<PatientLogin demoInbox={<DemoPatientInbox />} demoHint={<DemoPatientHint />} />} />
      <Route path="/pacientes" element={<PatientPortal />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </>,
));

export function DemoApp() {
  return <><div className="demo-banner"><strong>PROTOTIPO LOCAL</strong><span>Solo datos ficticios. Los cambios se pierden al reiniciar el servidor. No usar para atención real.</span></div><RouterProvider router={router} /></>;
}
