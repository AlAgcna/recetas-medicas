import { ArrowRight, ShieldCheck, Stethoscope, UserRound } from 'lucide-react';
import { createBrowserRouter, createRoutesFromElements, Link, Navigate, Route, RouterProvider } from 'react-router-dom';
import { DoctorAccess } from './DoctorAccess';
import { DoctorLogin, DoctorShell } from './DoctorShell';
import { PatientDetailPage, PatientForm, PatientsPage } from './Patients';
import { ConsultationPage } from './Consultation';
import { GeneralIndicationPage, PublicationPage } from './Publication';
import { PatientLogin, PatientPortal } from './PatientPortal';
import { StatisticsPage } from './Statistics';
import { Brand } from './ui';

// Rutas de producción: la misma interfaz que la demostración, con el ingreso
// real. No monta `/api/demo/*` ni el buzón simulado; el ingreso de la médica usa
// el enlace por correo y el del paciente, el código por SMS.
function Landing() {
  return <div className="landing">
    <header className="public-header"><Brand /><span className="location-label">La Rioja · Argentina</span></header>
    <main className="landing-main">
      <span className="eyebrow">UN ESPACIO PARA CUIDAR</span>
      <h1>La atención, más simple.<br /><span>La información, a mano.</span></h1>
      <p className="lead">Un lugar para organizar el consultorio y acercar a cada paciente sus indicaciones y recetas.</p>
      <div className="entry-grid">
        <Link to="/profesional/ingreso" className="entry-card"><span className="entry-icon"><Stethoscope /></span><h2>Soy la médica</h2><p>Pacientes, consultas y documentación del consultorio.</p><span className="entry-link">Entrar al consultorio <ArrowRight size={20} /></span></Link>
        <Link to="/pacientes/ingreso" className="entry-card"><span className="entry-icon patient-icon"><UserRound /></span><h2>Soy paciente</h2><p>Consultá tus indicaciones y recetas con un código de acceso.</p><span className="entry-link">Ir a mi portal <ArrowRight size={20} /></span></Link>
      </div>
      <p className="privacy-note"><ShieldCheck size={19} /> Tratamos tus datos según la política de privacidad del consultorio.</p>
    </main>
    <footer className="public-footer">Consultorio de atención médica de adultos · La Rioja, Argentina</footer>
  </div>;
}

const router = createBrowserRouter(createRoutesFromElements(
    <>
      <Route path="/" element={<Landing />} />
      <Route path="/profesional/ingreso" element={<DoctorLogin />} />
      <Route path="/acceso" element={<DoctorAccess />} />
      <Route path="/profesional" element={<DoctorShell />}>
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
      <Route path="/pacientes/ingreso" element={<PatientLogin />} />
      <Route path="/pacientes" element={<PatientPortal />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </>,
));

export function ProductionApp() {
  return <RouterProvider router={router} />;
}
