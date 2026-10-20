// Entrada de desarrollo local con D1 y R2 reales: miniflare emula los servicios
// dentro del runtime de Workers, así que esto ejercita el adaptador
// (`src/server/d1/`) con la misma API que usa el servicio desplegado.
//
// Se usa sólo desde `wrangler.local.toml`:
//   npx wrangler d1 migrations apply dranallim --local --config wrangler.local.toml
//   npx wrangler dev --config wrangler.local.toml --port 8791
// El puerto debe coincidir con `PORTAL_ORIGIN` de ese archivo.
// Conserva el ingreso profesional directo y el buzón simulado de la
// demostración, por eso nunca se despliega. La entrada productiva, todavía
// cerrada, es `src/server/index.ts`.
import { createApp, demoCookies } from '../app';
import type { FileBucket, SqlDatabase } from '../d1/database';
import { createD1Storage } from '../d1/storage';
import { mountDemoTools, type DemoInbox, type DemoMailbox } from './app';

type LocalEnv = { DB: SqlDatabase; BUCKET: FileBucket; PORTAL_ORIGIN: string };

// El buzón vive en el proceso mientras dura `wrangler dev`.
const inbox: DemoInbox = new Map();
// Correo saliente simulado: acá se lee el enlace de acceso sin proveedor real.
const mailbox: DemoMailbox = [];
// Secreto estable mientras dura el proceso, para poder validar en un pedido el
// código emitido en otro. En el servicio desplegado llegará como secret. Se
// genera en el primer pedido: workerd no permite aleatoriedad en el ámbito
// global del módulo.
let challengeSecret: string | undefined;

export default {
  fetch(request: Request, env: LocalEnv) {
    challengeSecret ??= Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    const now = Date.now;
    // La aplicación se arma por pedido: los bindings son de `env`. El secreto
    // del verificador llega por configuración para que los códigos emitidos en
    // un pedido se puedan validar en el siguiente.
    const storage = createD1Storage(env.DB, env.BUCKET);
    const { app, openSession } = createApp({
      storage, now, origin: env.PORTAL_ORIGIN, challengeSecret,
      health: { mode: 'local-d1-r2', persistent: true, whatsapp: false },
      // Corre por HTTP en loopback: pide las cookies de demostración.
      cookie: demoCookies,
      doctorEmail: 'consultorio@ejemplo.test',
      sendEmail(email) {
        mailbox.push(email);
      },
      deliverCode(patient, code, expiresAt) {
        inbox.set(patient.id, { code, expiresAt });
      },
    });
    mountDemoTools(app, { storage, openSession, inbox, mailbox, now });
    return app.fetch(request);
  },
};
