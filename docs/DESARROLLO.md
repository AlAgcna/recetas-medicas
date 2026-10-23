# Desarrollo local del prototipo

## Estado y límites

Se implementó la primera etapa de experiencia con React/TypeScript, Vite y una
API local Hono. **No es un sistema habilitado para atención clínica.**

- Todos los pacientes y documentos iniciales son ficticios.
- `npm run dev` guarda datos y sesiones **solo en la memoria de un proceso local**.
- Reiniciar el servidor demo restaura los ejemplos y elimina todos los cambios.
- No se usa `localStorage` para sesiones o registros clínicos.
- Existen D1 (`dranallim`) y el bucket privado R2 (`recetas`), creados por la
  médica, y `wrangler.toml` ya declara sus bindings. La entrada de producción ya
  arma la aplicación real sobre esos recursos; falta que el usuario migre la D1
  remota y cargue los secretos (ver [Despliegue](DESPLIEGUE.md)). No hay cuenta
  Meta ni WhatsApp habilitado. El código del paciente se entrega por SMS con
  Twilio; la cuenta de prueba sólo llega a números verificados por el titular.
- Para probar la aplicación real sobre D1 y R2 hay una entrada local aparte
  (ver «Persistencia local con D1 y R2»), que usa emuladores y el buzón simulado.
- No hay contraseñas: el ingreso real de la médica usa un código de seis dígitos
  enviado por correo, con pantalla productiva. Reemplaza el magic link desde el
  23/10/2026. No hay MFA dentro del portal, recuperación ni verificación real de
  contactos. Los pendientes de antiabuso están en `SEGURIDAD.md` §2.
- La entrada profesional demo y el buzón simulado son herramientas de prueba,
  no mecanismos de autenticación utilizables en producción.
- No se adjuntan archivos reales. El Word es una referencia visual; el PDF se
  genera como ejemplo sintético con la leyenda «Sin validez médica».
- Las indicaciones admiten reemplazos versionados con historial y las consultas
  finalizadas no se sobrescriben: se corrigen con enmiendas trazables que
  conservan la versión anterior. Retiro manual de publicaciones, auditoría de
  producción, adaptadores de persistencia y respaldos siguen pendientes.

Usar únicamente información inventada, incluso al crear fichas o consultas.

## Requisitos y arranque

- Node.js 24.x y npm.
- Instalar dependencias con el lockfile:

```sh
npm ci
```

- Iniciar la aplicación:

```sh
npm run dev
```

Abrir **http://127.0.0.1:5173**. Usar esa dirección, no una dirección LAN ni un
nombre alternativo: las mutaciones comprueban el origen exacto de la demo.

El script inicia Vite en `127.0.0.1:5173` y Hono en `127.0.0.1:8790`; la API pasa
por el proxy del mismo origen. Ambos escuchan solo en loopback. No ejecutar con
`--host 0.0.0.0`, no exponer con túneles ni usar para datos reales.

Los cambios del servidor requieren reiniciar `npm run dev`; Vite actualiza solo
la interfaz en caliente. Recordá que reiniciar descarta los datos temporales.

## Persistencia local con D1 y R2

`npm run dev` es el prototipo en memoria. Para ejercitar la aplicación real
sobre los bindings D1/R2 sin tocar los recursos remotos hay una entrada de
Worker local:

```sh
npx wrangler d1 migrations apply dranallim --local --config wrangler.local.toml
npx wrangler dev --config wrangler.local.toml --port 8791
```

- Usa `wrangler.local.toml`, que no se despliega. `--local` guarda todo en
  `.wrangler/state` y nunca alcanza la base ni el bucket remotos.
- El puerto debe coincidir con `PORTAL_ORIGIN` de ese archivo: la aplicación
  sólo acepta escrituras con su propio origen.
- Conserva el ingreso profesional directo (`POST /api/demo/doctor-login`) y el
  buzón simulado (`POST /api/demo/inbox`) para recorrer el flujo completo sin
  proveedor de SMS. Ninguna de esas rutas se despliega.
- El ingreso de la médica por correo también funciona sin proveedor: `GET
  /api/demo/mailbox` devuelve el último mensaje con el enlace, que sirve para
  probar `POST /api/doctor/request-link` y `POST /api/doctor/session`. En ese
  entorno no se envía correo real.
- Los datos sobreviven al reinicio de `wrangler dev`. Para empezar de cero,
  borrar `.wrangler/state/v3`.
- La interfaz de `npm run dev` sigue usando la API en memoria, no esta entrada.

## Recorridos disponibles

### Médica

1. Elegir «Soy la médica» y «Entrar a la demostración».
2. Buscar por DNI, nombre o apellido; abrir una ficha.
3. Crear un paciente con DNI + WhatsApp ficticios y completar sus datos.
4. Abrir «Nueva consulta»: el borrador se guarda solo y muestra su estado.
   Salir, continuarlo desde la ficha y finalizarlo tras revisión.
5. Corregir una consulta finalizada con «Enmendar esta consulta»: exige un motivo
   y conserva la versión anterior en el historial de la consulta.
6. Preparar indicaciones o un PDF sintético, ver la vista previa y publicar.
7. Revisar por separado consultas, documentos internos y entregas al paciente.
8. Abrir «Estadísticas» y elegir un mes para ver pacientes atendidos, consultas,
   recetas publicadas y desglose por cobertura.

La ficha usa los textos «Indicaciones y Recetas» y «Añadir Indicación/Receta».
Obra social es un desplegable con búsqueda por texto, selección con flechas/Enter
y cancelación con Escape. Incluye las 24 coberturas solicitadas en
`src/shared/insurance.ts` y «Otra» para nombres personalizados. Busca sin distinguir
tildes o mayúsculas y conserva coberturas anteriores al volver a editar la ficha.
«Sin obra social» se presenta y agrupa como «Particular» sin reescribir el histórico.

### General y específica

- Desde «Indicación general» se prepara una sola indicación para todos los
  pacientes autenticados, incluidos los que se incorporen después. No debe llevar
  datos personales ni puede ser una receta. Requiere confirmación de alcance.
- Desde cada ficha se crea una indicación específica privada para ese paciente.
- Como máximo se muestran dos indicaciones activas: una general y una específica.
  Las recetas PDF se mantienen aparte y no consumen ese límite.
- Si hay una activa del mismo ámbito, la vista previa advierte qué versión será
  reemplazada y exige confirmación. La anterior se conserva en el historial de
  la médica y deja de estar disponible en el listado y la descarga del paciente.
- Si otra pestaña cambió la activa mientras se revisaba, el servidor devuelve
  conflicto. No sobrescribe la nueva ni descarta el contenido del formulario.
- La sección de ficha muestra la general vigente, la específica activa, recetas
  y un historial desplegable de específicas. El apartado general conserva su
  propio historial. No hay eliminación ni retiro manual implementados.
- La comparación de versión y sustitución son atómicas dentro de un proceso en
  memoria. En D1 se necesitarán garantías distribuidas y de unicidad equivalentes.

El formulario de consulta guarda el borrador solo, tras una pausa de escritura,
con la hora visible y reintentos ante fallos de red; avisa antes de salir si queda
un guardado pendiente y no finaliza ni publica nada. Una consulta finalizada no
se edita: se corrige con «Enmendar esta consulta», que exige el motivo, conserva
la versión anterior en el historial de la consulta y no cambia la cobertura
registrada en la visita ni la cuenta de las estadísticas. Los datos de nombre y
cobertura se pueden completar; cambiar el contacto o el DNI no está habilitado
para no improvisar la recuperación/verificación de identidad.

### Paciente

1. Abrir «Soy paciente» e ingresar `00000001` (Ana Ejemplo) o `00000002`
   (Luis Demostración). Son identificadores de prueba, no personas reales.
2. Solicitar código y abrir «Ver mensaje simulado».
3. Copiar el código ficticio en «Código de acceso» y entrar.
4. Leer las indicaciones completas en pantalla; descargar PDF de recetas si corresponde.
5. Cerrar sesión. No interviene la médica en el acceso.

Para un paciente nuevo de prueba, marcar «Simular que el contacto fue verificado»
si se quiere ensayar su acceso. La marca no verifica un teléfono real.

Las indicaciones se muestran expandidas con identificación de «General · Para
todos» y «Específica · Para vos». Cada una ofrece una descarga **opcional** en
texto UTF-8, con el mismo título y contenido que se lee en pantalla. Las recetas
siguen siendo PDF sintéticos descargables. La descarga verifica sesión y
visibilidad; un enlace de una indicación reemplazada devuelve 404. No hay envío
automático por SMS ni recetas emitidas por el sistema.

### Estadísticas

- Se cuentan pacientes únicos con consultas finalizadas y fecha clínica dentro
  del mes, además de la cantidad total de esas consultas. No se cuentan borradores.
- «Recetas publicadas» cuenta PDF publicados según la fecha local de La Rioja,
  no todas las recetas emitidas externamente en Digidoc.
- El liderazgo de obras sociales se calcula por consultas y muestra empates.
  Particular y Sin registrar permanecen en el desglose, pero no son líderes.
- Cada consulta conserva la cobertura conocida al finalizarla. Editar después
  la ficha no cambia el histórico; un registro sin snapshot figura Sin registrar.
- Los resultados son agregados, no contienen identidades y solo se entregan
  bajo sesión profesional. No se envían datos a servicios de analítica externos.
- Las estadísticas usan únicamente registros en memoria; no agregan persistencia.

## Tiempos de la demo

- Solicitud procesable cada 5 minutos por paciente, entre navegadores distintos
  mientras se use el mismo proceso local.
- OTP de 6 dígitos, 10 minutos de vigencia, 5 intentos y un solo consumo.
- Sesión de paciente de 20 minutos absolutos.
- Sesión profesional de 2 horas de inactividad. Las interacciones recientes
  envían señales limitadas; el sondeo de sesión no la extiende.
- Enlace de ingreso de la médica: un pedido procesable cada minuto, 15 minutos
  de vigencia, un solo uso, y un enlace nuevo invalida el anterior.
- El máximo absoluto profesional continúa pendiente.

El servidor controla los vencimientos; el contador del navegador es orientativo.
El verificador OTP usa HMAC, los identificadores de sesión se guardan como hash
y las operaciones críticas en memoria se revalidan tras las operaciones
asíncronas. **Esto no implementa atomicidad distribuida en D1.**

Las cookies demo son `HttpOnly` y `SameSite=Strict`, pero sin `Secure` porque se
usa HTTP en loopback y su nombre lleva el prefijo `demo_`. La política es un
parámetro de `createApp` (`cookie`): producción pasa nombre sin prefijo y
`Secure`, y esa condición está probada en `tests/d1-api.test.ts`.

## Verificaciones

Regresión del login del 23/10/2026: `tests/e2e/doctor-login.spec.ts` monta la
interfaz productiva en Vite de pruebas y la conecta al servidor Hono real sobre
SQLite aislado. No envía correos, no lee códigos reales y no toca Cloudflare.
Comprueba el JSON enviado por el formulario, error de tipeo sin consumo,
validación correcta, cookie, recarga y cierre de sesión. Las pruebas D1 incluyen
JSON doble, expiración, concurrencia, intentos agotados y el caso de `sessions`
faltante con su reparación local (`DESPLIEGUE.md` §2).

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

- Vitest prueba las rutas Hono sin servicios externos: tiempos, consumo
  concurrente en memoria, permisos, validación, CSRF, borradores/publicación y
  cierre de la entrada de producción.
- Playwright inicia sus propios servidores en `127.0.0.1:5183` y
  `127.0.0.1:8788`, sin reutilizar ni detener la demo habitual. Requiere los
  binarios y dependencias de Chromium. Esos puertos de prueba deben estar libres.
  El arranque permite `PORTAL_DEV_PORT` y `PORTAL_API_PORT` para aislamiento local,
  pero no permite configurar una interfaz de red pública.
- Las capturas de referencia con datos ficticios se escriben en
  `/tmp/opencode/portal-clinico-pacientes.png` y
  `/tmp/opencode/portal-clinico-movil.png`, y el resumen mensual en
  `/tmp/opencode/portal-clinico-estadisticas.png`, no en el repositorio.
  También se generan `portal-clinico-coberturas.png` y
  `portal-clinico-indicaciones.png` en `/tmp/opencode`.
- `npm run build` comprueba tipos, construye la pantalla cerrada y verifica que
  los endpoints/pantallas de simulación no aparezcan en el JavaScript generado.

### Verificación del prototipo actualizado

- 98 pruebas aprobadas con Vitest: 41 de la API y las reglas sobre el almacén en
  memoria, 7 de estadísticas, 3 del catálogo de coberturas, 17 que cargan la
  migración D1 en SQLite local para comprobar invariantes y operaciones
  condicionales, 18 del adaptador D1/R2, 10 de la aplicación real montada sobre
  D1 y 2 del adaptador de correo (ver `PERSISTENCIA.md`). Dos de ellas comprueban
  que la aplicación armada por pedido sólo valida un código emitido en otro pedido
  cuando comparte el secreto del servidor.
- 12 recorridos aprobados con Chromium: los flujos previos más búsqueda de
  coberturas con teclado, publicación/reemplazo/descarga de general y específica,
  la enmienda de una consulta finalizada con su historial, y tres recorridos del
  borrador: guardado automático con hora visible, reintento tras un fallo de red y
  conservación del texto cuando la sesión venció.
- Comprobación de tipos, build y exclusión de módulos demo de producción aprobados.
- Verificación manual contra D1 y R2 emulados por miniflare, incluida la
  persistencia después de reiniciar el proceso y el ingreso completo de la médica
  (pedido de enlace, buzón simulado, apertura de sesión, rechazo de un segundo
  uso y de un token inventado). Ver `PERSISTENCIA.md`.
- Smoke HTTP de interfaz, proxy y cookies aprobado.
- Auditoría npm sin vulnerabilidades reportadas al realizar esta entrega.

Durante las pruebas se ajustaron las etiquetas explícitas de campos multilínea
y se corrigió la transición entre revisar y confirmar una consulta. El test de
navegador verifica que abrir la revisión **no envía una finalización**: hace falta
confirmar en una segunda acción. Estos resultados validan el prototipo, no la
seguridad, disponibilidad o cumplimiento legal de un sistema productivo.

## Separación de producción

- `scripts/dev.ts` es la única entrada del servidor demo y rechaza
  `NODE_ENV=production`.
- `src/server/demo/` no se importa desde la entrada de producción. Su
  `worker.ts` es una entrada **sólo local** (D1/R2 emulados) que se levanta con
  `wrangler.local.toml` y nunca se despliega.
- `src/server/index.ts` devuelve 503 para todas las rutas, incluidas las de demo.
- `src/web/main.tsx` solo importa las pantallas de demostración cuando Vite está
  en desarrollo. El build muestra «Servicio todavía no habilitado».
- `npm run preview` sirve esa pantalla cerrada, no el prototipo interactivo.
- Las páginas públicas de `public/` se publican sin JavaScript como
  `/privacidad`, `/condiciones` y `/eliminacion-de-datos`. Son las tres URLs que
  exige la revisión de la app de Meta: política de privacidad, condiciones del
  servicio e instrucciones de eliminación de datos. No habilitan el portal ni la
  API; en `/` sigue viéndose la pantalla cerrada. Los textos son preliminares
  (responsable sin nombre propio y `dranallim@gmail.com` como contacto, sin
  promesa de disponibilidad permanente ni declaración de cumplimiento) y todavía
  necesitan revisión legal. La eliminación que enuncia `/eliminacion-de-datos` es
  hoy un procedimiento manual del consultorio: la herramienta de borrado todavía
  no existe en el producto y queda como pendiente (ver `SEGURIDAD.md` §10).
- `wrangler.toml` configura el Worker `recetas-medicas` con la entrada cerrada,
  los estáticos de `dist` y los bindings D1/R2. Las rutas `/api` y `/api/*` pasan
  siempre por el Worker (503); el resto sirve la pantalla «Servicio todavía no
  habilitado».
- La entrada cerrada todavía no usa los bindings ni monta el ingreso de la
  médica, aunque las rutas, el adaptador de correo y el esquema ya existen:
  faltan secretos, la política de cookies de producción y la pantalla de ingreso.

### Configuración de Cloudflare Workers Builds

El error `The detected framework ("Hono") cannot be automatically configured`
aparece cuando Wrangler intenta detectar el proyecto sin configuración explícita.
El archivo `wrangler.toml` de la raíz fija la entrada y los estáticos; Wrangler
queda fijado en `package.json` y `package-lock.json`.

En el proyecto `recetas-medicas`, usar la raíz del repositorio, comando de build
`npm run build` y comando de despliegue `npx wrangler deploy`. Esto publica la
aplicación real: el ingreso de la médica por enlace de correo y el del paciente
por código SMS. La publicación, la carga de secretos y las migraciones remotas
quedan a cargo del usuario; ver [Despliegue](DESPLIEGUE.md).

Para comprobar el empaquetado sin publicar ni crear recursos:

```bash
npm run build
npx wrangler deploy --dry-run
```

Mantener los controles de `SEGURIDAD.md` como puertas de producción. Antes de
incorporar historias reales o habilitar pacientes falta, entre otros pendientes,
la entrega real de SMS con una cuenta de Twilio con upgrade.

## Organización actual

```text
db/migrations/        esquema D1 revisado (SQL) y verificado con SQLite local
public/               páginas públicas de Meta (privacidad, condiciones, eliminación de datos)
scripts/              arranque local y comprobación del build
src/shared/           contratos Zod y reglas temporales
src/server/d1/        adaptador de D1 y R2
src/server/demo/      almacén y servidor ficticios, más la entrada local con D1/R2
src/server/email/     adaptador de correo (Resend) y su puerto
src/server/index.ts   entrada de producción sobre D1/R2, correo y SMS
src/web/              pantallas y estilos del prototipo
tests/                pruebas de API, recorridos de navegador y de persistencia
wrangler.toml         entrada desplegada (cerrada) y bindings D1/R2
wrangler.local.toml   entrada de desarrollo con D1 y R2 emulados
```

### Recursos de marca

En `src/web/assets/`:

- `Logo_morado.jpg`: logo original, con el fondo morado del degradé.
- `Logo_morado_inverso.png`: versión inversa, con fondo transparente y el
  símbolo y las letras en lila. Es la que usa la cabecera (`Brand`) en todas las
  pantallas; en el menú lateral de la médica ocupa todo el ancho del panel. Se
  generó recortando el contenido del original sobre fondo transparente, sin
  redibujar las letras.
- `firma-logo.jpg`: firma de la médica al pie de las indicaciones, en la vista
  previa y en el portal del paciente. Es una imagen, no una firma digital.

El logo original morado se conserva para el ícono de pestaña (`favicon`).

No hay permisos para hacer `git add`, `git commit` o `git push`: esas acciones
siguen a cargo del usuario.
