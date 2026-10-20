import { createRoot } from 'react-dom/client';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

if (import.meta.env.DEV) {
  // Vite elimina esta rama y todos sus módulos del bundle de producción.
  void import('./DemoApp').then(({ DemoApp }) => root.render(<DemoApp />));
} else {
  // Producción: mismas pantallas que la demostración, pero con el ingreso real
  // (enlace por correo para la médica y código por SMS para el paciente) y sin
  // los atajos simulados. El enrutador y las rutas viven en `ProductionApp`.
  void import('./ProductionApp').then(({ ProductionApp }) => root.render(<ProductionApp />));
}
