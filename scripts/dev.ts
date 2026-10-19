import { serve } from '@hono/node-server';
import { createServer } from 'vite';
import { createDemoApp } from '../src/server/demo/app';

// Única entrada que importa el servidor simulado. No se utiliza en Workers.
if (process.env.NODE_ENV === 'production') {
  throw new Error('El prototipo no puede iniciarse en producción.');
}

function localPort(name: string, fallback: number) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Puerto local inválido: ${name}`);
  return value;
}

const webPort = localPort('PORTAL_DEV_PORT', 5173);
const apiPort = localPort('PORTAL_API_PORT', 8790);
if (webPort === apiPort) throw new Error('La interfaz y la API necesitan puertos diferentes.');
const origin = `http://127.0.0.1:${webPort}`;
const { app } = createDemoApp({ origin });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: apiPort });
const vite = await createServer({ server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } } });
await vite.listen();
console.info(`Prototipo local: ${origin} · Solo datos ficticios · Sin WhatsApp real`);

async function stop() {
  await vite.close();
  server.close();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
