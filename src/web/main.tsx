import { createRoot } from 'react-dom/client';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

if (import.meta.env.DEV) {
  // Vite elimina esta rama y todos sus módulos del bundle de producción.
  void import('./DemoApp').then(({ DemoApp }) => root.render(<DemoApp />));
} else {
  root.render(
    <main className="locked-page">
      <span className="eyebrow">PORTAL CLÍNICO</span>
      <h1>Servicio todavía no habilitado</h1>
      <p>Este desarrollo está en etapa de prototipo local. No ingreses datos personales o médicos.</p>
    </main>,
  );
}
