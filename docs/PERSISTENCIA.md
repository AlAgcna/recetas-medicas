# Persistencia real: D1 y R2

Estado: 19 de octubre de 2026. **Esquema, adaptadores, bindings locales e
ingreso profesional por correo**. La
aplicación real corre sobre D1 y R2 emulados por miniflare
(`src/server/demo/worker.ts` con `wrangler.local.toml`), además de verificarse
contra SQLite real y un doble de R2 en memoria. Los recursos remotos existen (D1
`dranallim` y el bucket privado `recetas`, creados por la médica) y
`wrangler.toml` ya declara sus bindings, pero la entrada desplegada
(`src/server/index.ts`) sigue cerrada con 503: la autenticación profesional ya
existe como rutas y adaptador de correo, pero no está montada en esa entrada ni
tiene pantalla, y WhatsApp sigue pendiente. **No se aplicó ninguna migración ni
se cargaron datos en la base remota.** La aplicación (`src/server/app.ts`)
consume el puerto `src/server/storage/port.ts`; el prototipo lo implementa en
memoria (`src/server/demo/storage.ts`) y el destino en `src/server/d1/`. Ver
`DESARROLLO.md` y `ARQUITECTURA.md`.

Este documento fija las decisiones de persistencia ya tomadas y separa lo que
sigue pendiente. No convierte propuestas en requisitos confirmados.

## 1. Alcance de esta etapa

Existe y está probado con datos ficticios:

- `db/migrations/0001_persistencia_inicial.sql`: esquema D1 (SQLite) revisado a
  mano, con restricciones e índices que sostienen los invariantes del producto.
- `db/migrations/0002_acceso_profesional.sql`: `access_links` (hash del enlace
  de ingreso de la médica) y `access_link_control` (enfriamiento de pedidos).
- `src/server/storage/port.ts`: el puerto de almacenamiento, expresado en casos
  de uso y no en CRUD. La aplicación no conoce Maps, SQL ni R2.
- `src/server/email/port.ts` y `src/server/email/resend.ts`: el puerto de correo
  saliente y el adaptador de Resend. La aplicación sólo pide entregar un mensaje;
  la clave es un secreto del Worker y no aparece en errores ni registros.
- `src/server/d1/storage.ts` y `src/server/d1/database.ts`: adaptador de D1 y R2
  sobre interfaces estructurales mínimas; no depende de
  `@cloudflare/workers-types` y los bindings reales las satisfacen.
- `src/server/demo/storage.ts`: implementación en memoria de la misma interfaz,
  usada por el prototipo y por las pruebas de API.
- `tests/persistence.test.ts`: carga la migración en SQLite real
  (`node:sqlite` de Node 24), con datos ficticios, y comprueba que cada
  invariante rechaza lo que debe rechazar, además de los patrones atómicos de D1.
- `tests/d1-storage.test.ts`: prueba el adaptador D1 contra ese SQLite real.
- `tests/d1-api.test.ts`: monta la aplicación real sobre el adaptador D1 y
  verifica sesiones, reemplazo de indicaciones, enmiendas, aislamiento en la
  descarga de recetas y el ingreso de la médica (enlace de un solo uso,
  enfriamiento, vencimiento y política de cookies).
- `tests/email-resend.test.ts`: comprueba el contrato del adaptador de correo con
  un `fetch` inyectado, sin red ni credenciales.
- `wrangler.toml`: bindings `DB` (D1 `dranallim`) y `BUCKET` (R2 `recetas`) ya
  declarados. La entrada desplegada no los usa todavía.
- `src/server/demo/worker.ts` con `wrangler.local.toml`: entrada **sólo local**
  que arma la aplicación real por pedido sobre los bindings D1/R2 emulados, con
  el buzón simulado de códigos y de correo. Ejercita el mismo adaptador que
  usará el servicio.

Todavía no existe:

- Migración ni datos cargados en la D1 remota. Sólo se aplicó en la base local
  (0001 y 0002).
- Entrada productiva que use los bindings y monte el ingreso de la médica: requiere
  secretos de correo, política de cookies de producción y pantalla de ingreso.
- Copias de respaldo ni migración de datos reales.

El acceso a datos es **SQL parametrizado revisado a mano**, no un ORM. Drizzle no
está instalado ni adoptado; la biblioteca a usar sigue como decisión abierta (§7),
porque las operaciones críticas dependen de sentencias condicionales y de
`batch()` (§3) más que de un constructor de consultas.

## 2. Qué sostiene la base y qué sostiene el servidor

La base no reemplaza la validación del servidor: la refuerza. Ningún camino
debería poder saltarse un invariante con una consulta directa.

| Invariante | Lo sostiene la base con |
| --- | --- |
| DNI único | `UNIQUE(patients.dni)` |
| Teléfono compartido permitido | columna sin `UNIQUE` |
| Una sola indicación general activa | índice único parcial `publications_active_general` |
| Una sola indicación específica activa por paciente | índice único parcial `publications_active_patient_indication` |
| Varias recetas activas | sin índice de unicidad para `kind = 'prescription'` |
| La receta nunca es general y siempre tiene PDF | `CHECK` sobre `scope`, `kind` y `document_id` |
| El PDF publicado es del paciente de la publicación | clave foránea compuesta `publications(patient_id, document_id)` |
| Una sola versión vigente por cadena de consultas | índice único parcial `consultations_current` |
| Una versión se corrige una sola vez | índice único parcial `consultations_single_successor` |
| Enmienda sólo de lo finalizado y con motivo | `CHECK` sobre `status`, `supersedes_id` y `amendment_reason` |
| Cobertura de la visita obligatoria | `insurance_at_visit NOT NULL` |
| Un solo desafío activo por paciente | índice único parcial `access_challenges_active` |
| Nunca se guarda el código | sólo el verificador HMAC en `access_challenges` |
| Un solo enlace de ingreso vigente para la médica | índice único parcial `access_links_active` |
| Nunca se guarda el enlace de la médica | `access_links.token_hash` (SHA-256), nunca el token |
| Un pedido de enlace por minuto | upsert condicional sobre `access_link_control` |
| Nunca se guarda el token de sesión | `sessions.token_hash` (SHA-256) |
| La sesión de paciente tiene paciente; la profesional no | `CHECK` sobre `role` y `patient_id` |
| Fecha clínica sin hora inventada | `CHECK` de formato `AAAA-MM-DD` |

Queda a cargo del servidor: autorización por rol y recurso, visibilidad de cada
publicación, política temporal de códigos y sesiones, normalización de DNI y
teléfono, y toda la validación de entradas con Zod.

## 3. Atomicidad en D1

D1 opera en auto-commit y no expone `BEGIN`/`COMMIT` al Worker. Se usan dos
recursos:

- `db.batch([...])`: ejecuta la secuencia en una transacción; si una sentencia
  falla, se revierte completa.
- Sentencias condicionales: `UPDATE ... WHERE <condición>` y `meta.changes` (o
  `RETURNING`) para saber si esta ejecución ganó la carrera.

Patrones implementados en `src/server/d1/storage.ts` y verificados por
`tests/d1-storage.test.ts` y `tests/d1-api.test.ts`:

- **Reemplazar una indicación.** En un `batch`: el `INSERT` de la versión nueva
  queda inactiva y sólo ocurre si la activa vigente es la esperada
  (`... WHERE (SELECT id FROM publications WHERE active = 1 AND kind = 'indication'
  AND scope = ? AND patient_id IS ?) IS ?`); luego se desactiva la anterior
  (`UPDATE publications SET active = 0, superseded_at = ? WHERE id = ? AND active = 1`)
  y se activa la nueva. Si la versión esperada ya fue reemplazada, ninguna fila
  cambia y se responde 409. Con dos pestañas simultáneas, los índices únicos
  parciales impiden dos activas.
- **Enmendar una consulta.** `UPDATE consultations SET superseded_at = ? WHERE
  id = ? AND superseded_at IS NULL` y el `INSERT` de la versión vigente con su
  motivo, en un `batch`. Si no hay fila, otra solicitud ya la reemplazó: 409.
  `consultations_current` y `consultations_single_successor` son la red de
  seguridad.
- **Reservar un código.** Una sola sentencia: `INSERT INTO code_request_control
  ... ON CONFLICT(patient_id) DO UPDATE SET next_request_at = excluded.next_request_at
  WHERE code_request_control.next_request_at <= ? RETURNING next_request_at`.
  Devuelve fila si la solicitud se permite y ninguna si todavía no corresponde.
- **Reservar el pedido de enlace de la médica.** El mismo patrón sobre
  `access_link_control`, con ámbito fijo `'doctor'` porque hay una sola médica.
- **Invalidar el enlace anterior.** En un `batch`: `DELETE FROM access_links
  WHERE scope = 'doctor' AND consumed_at IS NULL` y `INSERT` del nuevo. El índice
  `access_links_active` hace fallar el lote entero si quedara un activo.
- **Consumir el enlace.** `UPDATE access_links SET consumed_at = ? WHERE
  token_hash = ? AND scope = 'doctor' AND consumed_at IS NULL AND expires_at > ?`
  y se exige que cambie exactamente una fila: dos usos simultáneos no abren dos
  sesiones.
- **Consumir el desafío.** `UPDATE access_challenges SET consumed_at = ? WHERE
  id = ? AND consumed_at IS NULL AND attempts < ? AND expires_at > ?`. Se
  verifica el HMAC antes y se exige que cambie exactamente una fila.
- **Contar intentos.** `UPDATE ... SET attempts = attempts + 1 WHERE id = ? AND
  consumed_at IS NULL AND attempts < ?`.
- **Extender la sesión profesional.** `UPDATE sessions SET expires_at = ? WHERE
  token_hash = ? AND expires_at > ?`. Si no cambia nada, la sesión ya venció.

Pendiente de decisión: claves de idempotencia para altas (hoy una respuesta
perdida puede crear un borrador duplicado), límites distribuidos de solicitudes
(la cota por proceso del prototipo no alcanza en Workers) y el uso de la API de
sesiones de D1 (`withSession`) si se habilita lectura replicada.

## 4. Archivos en R2

- Depósito privado, sin dominio público ni acceso anónimo. La descarga siempre
  pasa por el endpoint autorizado (sesión y visibilidad de la publicación).
- La clave del objeto se guarda en `documents.r2_key` (única) y **nunca se
  entrega al navegador**; es opaca y no se deriva de un dato que envíe el
  cliente. Criterio aplicado: `patients/<patientId>/<documentId>.pdf`.
- Se guarda el original sin modificarlo: no se reescribe, recomprime, sella ni
  agrega contraseñas, para no invalidar una firma digital existente. Sin OCR ni
  conversión en el núcleo.
- En la base quedan `mime_type`, `size_bytes`, `sha256` y `provenance`; al
  descargar se vuelve a leer el objeto y se verifican tamaño y SHA-256 antes de
  entregarlo. Si no coinciden, no se entrega.
- Límite vigente del prototipo: 5 MB por archivo. El tope productivo, la
  retención y el borrado necesitan decisión, incluidas obligaciones legales.

## 5. Sustitución del almacén en memoria

La aplicación ya no conoce el almacén: consume el puerto
`src/server/storage/port.ts`. Dos implementaciones cumplen la misma interfaz:

- `src/server/demo/storage.ts` (`createMemoryStorage`), sobre el estado en
  memoria de `src/server/demo/store.ts`. Es lo que usan el prototipo y las
  pruebas de API; no se importa desde la entrada de producción.
- `src/server/d1/storage.ts` (`createD1Storage`), sobre D1 y R2.

La sustitución no bifurca la aplicación: `src/server/app.ts` (`createApp`) es la
aplicación real y `src/server/demo/app.ts` (`createDemoApp`) la compone con el
almacén en memoria y agrega el buzón (`/api/demo/*`) y el PDF de ejemplo. La
entrada de producción usará el adaptador de D1.

- El puerto expone operaciones asíncronas por caso de uso (pacientes, consultas y
  enmiendas, publicaciones y su visibilidad, archivos, sesiones, desafíos,
  auditoría y los agregados de la portada), no CRUD por tabla.
- Los códigos y tokens no llegan a la base: se guarda el hash del token de sesión,
  el verificador HMAC del desafío y el hash del enlace de acceso de la médica.
- El buzón simulado con el código en claro es exclusivo de la demo y **no se
  persiste**: en producción el código sale por WhatsApp Cloud API y en la base
  queda sólo el verificador HMAC.
- El buzón de correo simulado (`store.mailbox` y `/api/demo/mailbox`) es el mismo
  caso: sirve para probar el ingreso de la médica sin proveedor. En producción el
  enlace sale por Resend a una única casilla.
- `rateLimits` sigue siendo un contador en memoria dentro de `src/server/app.ts`
  y no se migra a D1: los límites distribuidos corresponden a la plataforma (§7).
- La entrada de un Worker arma la aplicación **por pedido**, porque los bindings
  llegan en `env` (`src/server/demo/worker.ts` ya lo hace). Por eso el verificador
  HMAC de los códigos recibe un secreto estable mediante `challengeSecret` de
  `createApp`: sin él, cada instancia generaría uno distinto y el código emitido
  en un pedido no se podría validar en el siguiente. En el servicio desplegado
  llegará como secret; en las pruebas y el prototipo es aleatorio por proceso.

## 6. Migraciones y verificación

- Archivos `db/migrations/NNNN_*.sql`, revisados antes de aplicar. Hoy hay dos
  (0001 esquema inicial, 0002 acceso profesional). En desarrollo:
  `npx wrangler d1 migrations apply dranallim --local --config wrangler.local.toml`.
  En la base remota sólo después de revisar, respaldar y con autorización
  explícita del usuario.
- `npm test` incluye `tests/persistence.test.ts` (invariantes y patrones del
  SQL), `tests/d1-storage.test.ts` (el adaptador D1), `tests/d1-api.test.ts` (la
  aplicación sobre D1) y `tests/email-resend.test.ts` (el adaptador de correo),
  todos contra SQLite real y un doble de R2. Eso valida el
  SQL, las reglas y la composición, **no** la compatibilidad exacta con D1, el
  rendimiento ni la disponibilidad.
- Verificación manual contra el runtime real (miniflare emula D1 y R2):

  ```sh
  npx wrangler d1 migrations apply dranallim --local --config wrangler.local.toml
  npx wrangler dev --config wrangler.local.toml --port 8791
  ```

  Con el servidor en marcha se comprobó, el 19 de octubre de 2026: alta de ficha,
  consulta finalizada con su cobertura, indicación general, receta con su PDF y
  SHA-256, acceso del paciente con el código del buzón simulado y descarga
  byte a byte. Después de **reiniciar el proceso** siguieron disponibles la ficha,
  la consulta, la publicación, la sesión de paciente guardada en D1 y el objeto
  de R2. Eso prueba el contrato del adaptador y la persistencia entre reinicios;
  no prueba la D1 remota, la latencia ni la concurrencia distribuidas.

  Con la migración 0002 aplicada en local se repitió el ingreso de la médica
  contra ese mismo runtime: pedido de enlace (respuesta genérica, sin token),
  mensaje en el buzón simulado con la URL pública y el token de 64 caracteres,
  apertura de sesión con `POST /api/doctor/session`, llamada autenticada con la
  cookie, 401 en el segundo uso del mismo enlace, 401 con un token inventado y
  segundo pedido dentro del minuto sin envío nuevo. Verificado con el proceso en
  marcha, no después de reiniciarlo.
- D1 y R2 se respaldan por separado; GitHub sólo guarda código. El
  procedimiento de respaldo y restauración sigue pendiente.

## 7. Decisiones abiertas

1. Biblioteca de acceso a datos: hoy el adaptador usa SQL parametrizado a mano.
   Antes de instalar una dependencia, decidir si Drizzle aporta algo a estas
   operaciones o si se deja asentado que el SQL a mano es la decisión.
2. Cuenta profesional real (`professionals`), autor de consultas y actor de
   auditoría: se define con la autenticación profesional.
3. Cambio de contacto verificado: invalidar desafíos y revocar sesiones de
   paciente según la política de `SEGURIDAD.md`.
4. Retiro manual de una publicación sin reemplazo.
5. Carga de documentos internos (Word/PDF): macros, límites y conversión.
6. Retención y exportación de auditoría.
7. Claves de idempotencia para altas.
8. Límites distribuidos por origen y volumen global.
9. Respaldo, restauración y ciclo de vida de R2.
10. Máximo absoluto de sesión profesional (12 horas sugeridas, sin confirmar).

## 8. Próximos pasos sugeridos

1. Montar el ingreso de la médica en la entrada productiva: secretos
   (`RESEND_API_KEY`, `DOCTOR_EMAIL`, `CHALLENGE_SECRET`), política de cookies
   `Secure` sin prefijo, pantalla `/acceso` y arranque sobre D1. Las rutas, el
   adaptador de correo y el esquema ya existen y están probados; lo que falta es
   esa entrada, no el mecanismo.
2. Integración oficial de WhatsApp Cloud API para los códigos del paciente.
3. Decisión de la biblioteca de acceso a datos (§7.1).
4. Migrar la base remota (0001 y 0002), respaldar y probar la restauración.
