# Desarrollo local del prototipo

## Estado y límites

Se implementó la primera etapa de experiencia con React/TypeScript, Vite y una
API local Hono. **No es un sistema habilitado para atención clínica.**

- Todos los pacientes y documentos iniciales son ficticios.
- La API guarda datos y sesiones **solo en la memoria de un proceso local**.
- Reiniciar el servidor restaura los ejemplos y elimina todos los cambios.
- No se usa `localStorage` para sesiones o registros clínicos.
- No hay D1, R2, recursos Cloudflare provisionados ni cuenta Meta. Existe el
  esquema SQL local (`db/migrations`, ver `PERSISTENCIA.md`) con sus pruebas,
  pero la aplicación todavía no lo usa ni hay nada desplegado.
- No hay contraseñas, MFA, recuperación ni verificación real de contactos.
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
por WhatsApp ni recetas emitidas por el sistema.

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
- El máximo absoluto profesional continúa pendiente.

El servidor controla los vencimientos; el contador del navegador es orientativo.
El verificador OTP usa HMAC, los identificadores de sesión se guardan como hash
y las operaciones críticas en memoria se revalidan tras las operaciones
asíncronas. **Esto no implementa atomicidad distribuida en D1.**

Las cookies demo son `HttpOnly` y `SameSite=Strict`, pero sin `Secure` porque se
usa HTTP en loopback. Las cookies reales deberán usar HTTPS y `Secure`.

## Verificaciones

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

- 63 pruebas aprobadas con Vitest: 49 de API y reglas (estadísticas, coberturas,
  sesiones, versión esperada, reemplazos concurrentes, historial, enmiendas de
  consultas finalizadas, general para nuevos pacientes, aislamiento y descargas
  de indicaciones activas) y 14 que cargan la migración D1 en SQLite local para
  comprobar invariantes y operaciones condicionales (ver `PERSISTENCIA.md`).
- 12 recorridos aprobados con Chromium: los flujos previos más búsqueda de
  coberturas con teclado, publicación/reemplazo/descarga de general y específica,
  la enmienda de una consulta finalizada con su historial, y tres recorridos del
  borrador: guardado automático con hora visible, reintento tras un fallo de red y
  conservación del texto cuando la sesión venció.
- Comprobación de tipos, build y exclusión de módulos demo de producción aprobados.
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
- `src/server/demo/` no se importa desde la entrada de Workers.
- `src/server/index.ts` devuelve 503 para todas las rutas, incluidas las de demo.
- `src/web/main.tsx` solo importa las pantallas de demostración cuando Vite está
  en desarrollo. El build muestra «Servicio todavía no habilitado».
- `npm run preview` sirve esa pantalla cerrada, no el prototipo interactivo.
- No hay script de despliegue ni configuración de infraestructura productiva.

No eliminar estos bloqueos para publicar la demo. La siguiente etapa debe
implementar autenticación profesional real, los adaptadores de persistencia (el
esquema ya está escrito), permisos y archivos privados sobre los servicios
acordados, y después validar la integración oficial de WhatsApp. Mantener los
controles de `SEGURIDAD.md` como puertas de producción.

## Organización actual

```text
db/migrations/        esquema D1 revisado (SQL) y verificado con SQLite local
scripts/              arranque local y comprobación del build
src/shared/           contratos Zod y reglas temporales
src/server/demo/      servidor y almacenamiento ficticios, solo local
src/server/index.ts   entrada de producción cerrada
src/web/              pantallas y estilos del prototipo
tests/                pruebas de API, recorridos de navegador y de persistencia
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
