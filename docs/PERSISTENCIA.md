# Persistencia real: D1 y R2

Estado: 19 de octubre de 2026. **Diseño y esquema inicial**, verificados contra
SQLite local. No hay adaptadores, `wrangler.toml`, bindings ni recursos de
Cloudflare creados, y **no hay ningún despliegue**. La aplicación sigue guardando
todo en memoria (`src/server/demo/`). Ver `DESARROLLO.md` para el prototipo y
`ARQUITECTURA.md` para el modelo conceptual.

Este documento fija las decisiones de persistencia ya tomadas y separa lo que
sigue pendiente. No convierte propuestas en requisitos confirmados.

## 1. Alcance de esta etapa

Existe y está probado:

- `db/migrations/0001_persistencia_inicial.sql`: esquema D1 (SQLite) revisado a
  mano, con restricciones e índices que sostienen los invariantes del producto.
- `tests/persistence.test.ts`: carga esa migración en un SQLite real en memoria
  (módulo `node:sqlite` de Node 24), con datos ficticios, y comprueba que cada
  invariante rechaza lo que debe rechazar, además de los patrones atómicos de D1.

Todavía no existe:

- Adaptadores de acceso a datos ni sustitución del almacén en memoria.
- `wrangler.toml`, bindings D1/R2, entrada de Worker, ni recurso alguno creado.
- Prueba contra D1/miniflare, copias de respaldo ni migración de datos reales.

Drizzle se adopta para la capa de acceso (tipos y consultas) y se instala junto
con los adaptadores. Las **migraciones quedan como SQL revisado a mano**, que es
lo que aplica D1 y lo que se puede auditar antes de tocar datos.

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

Patrones verificados para cada operación crítica:

- **Reemplazar una indicación.** Se compara `expectedActiveId` con la activa
  vigente y, en un `batch`, se ejecuta `UPDATE publications SET active = 0,
  superseded_at = ? WHERE id = ? AND active = 1` más el `INSERT` de la nueva. Si
  el `UPDATE` no cambia exactamente una fila, se responde 409 sin escribir. Aun
  con dos pestañas simultáneas, los índices únicos parciales impiden dos activas.
- **Enmendar una consulta.** `UPDATE consultations SET superseded_at = ? WHERE
  id = ? AND superseded_at IS NULL` y el `INSERT` de la versión vigente con su
  motivo, en un `batch`. Si no hay fila, otra solicitud ya la reemplazó: 409.
  `consultations_current` y `consultations_single_successor` son la red de
  seguridad.
- **Reservar un código.** Una sola sentencia: `INSERT INTO code_request_control
  ... ON CONFLICT(patient_id) DO UPDATE SET next_request_at = excluded.next_request_at
  WHERE code_request_control.next_request_at <= ? RETURNING next_request_at`.
  Devuelve fila si la solicitud se permite y ninguna si todavía no corresponde.
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
  cliente. Criterio propuesto: `patients/<patientId>/<documentId>.pdf`.
- Se guarda el original sin modificarlo: no se reescribe, recomprime, sella ni
  agrega contraseñas, para no invalidar una firma digital existente. Sin OCR ni
  conversión en el núcleo.
- En la base quedan `mime_type`, `size_bytes`, `sha256` y `provenance`; al
  descargar se vuelve a leer el objeto y se verifican tamaño y SHA-256 antes de
  entregarlo. Si no coinciden, no se entrega.
- Límite vigente del prototipo: 5 MB por archivo. El tope productivo, la
  retención y el borrado necesitan decisión, incluidas obligaciones legales.

## 5. Sustitución del almacén en memoria

- `src/server/demo/` (memoria, sesiones y mensajería simuladas) sigue siendo el
  almacén del prototipo local y de las pruebas de API. No se importa desde la
  entrada de producción.
- Los adaptadores reales exponen operaciones asíncronas por agregado (pacientes,
  consultas y enmiendas, publicaciones, documentos, sesiones, desafíos,
  auditoría). Los contratos de `src/shared/contracts.ts` no cambian: siguen
  siendo el formato de la API.
- El buzón simulado con el código en claro es exclusivo de la demo y **no se
  persiste**: en producción el código sale por WhatsApp Cloud API y en la base
  queda sólo el verificador HMAC.
- `rateLimits` (contador en memoria) no se migra a D1: los límites distribuidos
  corresponden a la plataforma.

## 6. Migraciones y verificación

- Archivos `db/migrations/NNNN_*.sql`, revisados antes de aplicar. En desarrollo:
  `npx wrangler d1 migrations apply <base> --local`. En la base remota sólo
  después de revisar, respaldar y con autorización explícita del usuario.
- `npm test` ejecuta `tests/persistence.test.ts`, que aplica la migración en
  SQLite real y prueba los invariantes y los patrones condicionales. Eso valida
  el SQL y las reglas, **no** la compatibilidad con D1, el rendimiento ni la
  disponibilidad.
- D1 y R2 se respaldan por separado; GitHub sólo guarda código. El
  procedimiento de respaldo y restauración sigue pendiente.

## 7. Decisiones abiertas

1. Instalar y adoptar Drizzle en la capa de acceso (con los adaptadores).
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

1. Adaptadores y sustitución del almacén, con Drizzle y pruebas de reglas.
2. Entrada de Worker y `wrangler.toml` con bindings D1/R2 locales (sin desplegar).
3. Autenticación profesional real.
4. Integración oficial de WhatsApp Cloud API.
