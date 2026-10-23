# Despliegue

Pasos que ejecuta el usuario, en este orden, desde su máquina. Este documento es
la lista de tareas del alta: qué cargar, en qué orden y cómo comprobar que quedó
bien. La publicación y la carga de secretos están a cargo del usuario; el agente
no despliega, no carga secretos, no aplica migraciones a la D1 remota ni hace
`git add`, `git commit` ni `git push`.

Nada de esto habilita pacientes reales por sí solo: ver
[Seguridad](SEGURIDAD.md), en particular el estado de la cuenta de Twilio.

## Antes de empezar

Comprobar que el build y las pruebas están verdes en la máquina:

```bash
npm ci
npm run build      # typecheck, build y verificación de que no haya módulos simulados
npm test           # pruebas de servidor, persistencia y proveedores
npm run test:e2e   # recorridos de navegador sobre el prototipo local
```

`npm run build` falla a propósito si el bundle de producción arrastra módulos o
pantallas de la simulación.

## 1. Autenticar Wrangler

```bash
npx wrangler login
npx wrangler whoami   # debe mostrar la cuenta de Cloudflare correcta
```

Los recursos ya existen (creados por la médica): base D1 `dranallim` y bucket R2
`recetas`. No hay que crearlos de nuevo.

## 2. Aplicar las migraciones a la D1 remota

Para una base vacía, aplicar las migraciones del repositorio. Si se crearon tablas
manualmente, **no asumir que son equivalentes** ni ejecutar este paso a ciegas:
Wrangler no registra automáticamente esas creaciones ni corrige sus columnas.

```bash
npx wrangler d1 migrations apply dranallim --remote
```

Es aditivo y reversible sólo por edición manual del esquema; no borra datos. Al
confirmar, revisar que liste `0001_persistencia_inicial.sql` y
`0002_acceso_profesional.sql` y `0003_acceso_medica_codigo.sql`.

### Incidente de ingreso, 23/10/2026

Se confirmó mediante consultas de metadatos (sin leer datos clínicos) que la base
remota creada manualmente tiene `access_sessions`, pero no `sessions`, que es
la tabla usada por `src/server/d1/storage.ts`. También hay diferencias en
`patients`, `consultations`, `publications` y `access_challenges`, y faltan
`documents` y `code_request_control`. El SQL entregado anteriormente por chat
no correspondía a las migraciones del proyecto. No usarlo como referencia.

La reparación **puntual del login** está en
`db/repairs/sesiones_faltantes.sql`, copiada del esquema canónico. Revisar y
ejecutar por el usuario:

```bash
npx wrangler d1 execute dranallim --remote --file=db/repairs/sesiones_faltantes.sql
```

No borra ni modifica `access_sessions`, desafíos o registros clínicos. No resuelve
el resto del esquema manual: se necesita conciliación revisada, con respaldo y
autorización antes de migrar datos o retirar tablas. No ejecutar `DROP TABLE` ni
marcar migraciones como aplicadas para ocultar discrepancias.

El otro fallo estaba en el formulario: pasaba JSON ya serializado a `api()`,
que volvía a serializarlo. Eso rechazaba el código antes de leer el desafío.
Enviar objetos a `api()`, reconstruir los estáticos con `npm run build` y
desplegar después (a cargo del usuario). Desplegar sólo el Worker sin reconstruir
`dist` deja el formulario viejo.

Si faltaba `sessions`, un código válido se consumía antes de fallar al crear la
sesión (500); reusarlo devolvía 401. Después de reparar, pedir **un nuevo código**,
respetando el cooldown. No borrar desafíos ni límites para diagnosticar.

## 3. Cargar variables y secretos

`PORTAL_ORIGIN` ya está declarado en `wrangler.toml` como variable pública. Los
secretos se cargan uno por uno; Wrangler los pide de forma interactiva, así que
**no quedan en el historial del shell**.

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put DOCTOR_EMAIL
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_FROM_NUMBER
```

Qué es cada uno:

| Secreto | Qué cargar |
| --- | --- |
| `SESSION_SECRET` | Cadena larga al azar. Es la clave del verificador de códigos: **si falta, el Worker falla de forma explícita** en lugar de quedar roto en silencio. Cargarla una vez y no cambiarla; rotarla invalida los códigos vigentes. |
| `DOCTOR_EMAIL` | Casilla de la médica, **único destino** del enlace de acceso. Confirmar antes cuál es, porque la política pública declara una dirección y el enlace apunta a otra (ver «Pendientes»). |
| `RESEND_API_KEY` | Clave de Resend. **Rotarla primero**: la anterior se expuso en el chat. |
| `RESEND_FROM` | Remitente verificado en Resend. Con `onboarding@resend.dev` sólo entrega al correo dueño de la cuenta. |
| `TWILIO_ACCOUNT_SID` | `Account SID` de la consola de Twilio. |
| `TWILIO_AUTH_TOKEN` | `Auth Token` de Twilio. No se registra en logs ni auditoría. |
| `TWILIO_FROM_NUMBER` | Número remitente comprado en Twilio, con código de país (por ejemplo `+1...` o el que corresponda). |

Para generar `SESSION_SECRET` sin dejarlo en el historial:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Si un secreto falta, el comportamiento es seguro pero limitado: sin correo, el
ingreso de la médica responde 503; sin SMS, el pedido de código responde de forma
genérica y **no sale ningún mensaje**.

## 4. Revisar el empaquetado sin publicar

```bash
npm run build
npx wrangler deploy --dry-run
```

Este paso no crea ni modifica nada en Cloudflare. Sirve para ver el bundle final.

## 5. Publicar

Con `git push` del repositorio y el despliegue a cargo del usuario:

```bash
npx wrangler deploy
```

El subdominio queda como `https://<nombre>.workers.dev`. **Debe coincidir con
`PORTAL_ORIGIN` de `wrangler.toml`**: la aplicación sólo acepta escrituras cuyo
origen sea el propio. Si el subdominio real es distinto, corregir
`PORTAL_ORIGIN` antes de publicar y volver a desplegar.

## 6. Comprobar en producción

Con el dominio real:

1. `https://<dominio>/` muestra la portada con los dos accesos.
2. `/profesional/ingreso` ofrece «Enviar código de acceso». Leer los seis dígitos
   en el correo e ingresarlos en la misma pantalla. El código dura 10 minutos,
   sirve una vez y admite hasta 5 intentos. La sesión se guarda en `sessions`.
3. `/pacientes/ingreso` pide el DNI y envía el código por SMS al número de la
   ficha, siempre que la ficha tenga el contacto verificado.
4. Las páginas públicas responden sin JavaScript: `/privacidad`, `/condiciones`,
   `/eliminacion-de-datos`.

Prueba con datos ficticios primero. No cargar historias reales todavía.

## 7. Registros de invocación

`wrangler.toml` deja activada la observabilidad (`[observability.logs]` con
`invocation_logs` y `persist`). Los registros sirven para ver qué peticiones
llegaron y con qué estado se respondieron.

**La aplicación no registra datos sensibles.** No hay `console.log` de códigos de
acceso, DNI, teléfonos, tokens, cookies ni cuerpos de petición: el manejador de
errores los descarta a propósito. La auditoría clínica va a la tabla
`audit_events` de D1, no a los logs.

Como consecuencia, un fallo real de entrega (rechazo de Twilio o de Resend) se ve
en los logs como la petición y su estado, **sin el motivo detallado**. Si alguna
vez hace falta más detalle, hay que decidirlo como un cambio explícito y acotado
—por ejemplo, registrar sólo el estado HTTP del proveedor— y nunca números,
credenciales ni cuerpos completos.

## Pendientes que este despliegue no resuelve

- **Cuenta gratuita de Twilio**: sólo entrega a números verificados por el titular
  y antepone «Sent from your Twilio trial account». No sirve para pacientes
  reales. Se necesita el upgrade y verificar el precio por SMS a Argentina y la
  entrega real a un móvil argentino.
- **Discrepancia de correo**: la política pública declara `dranallim@gmail.com` y
  el enlace de acceso apunta a `dranallim@yahoo.es`. Unificar antes de abrir.
- **Remitente de Resend**: verificar que `DOCTOR_EMAIL` sea la dirección dueña de
  la cuenta, o el enlace no llega.
- **Verificación inicial del contacto**: el acceso del paciente sólo funciona si
  la ficha tiene el contacto verificado (`contactVerified`), que hoy se marca en
  el alta desde la interfaz profesional.
