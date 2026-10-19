import { Hono } from 'hono';

// Entrada de producción cerrada: nunca importa el servidor ni los datos demo.
// La autenticación real, D1, R2 y Meta se implementarán en una etapa posterior.
const app = new Hono();
app.all('*', c => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  return c.json({ message: 'Servicio no habilitado. El prototipo es exclusivamente local.' }, 503);
});

export default app;
