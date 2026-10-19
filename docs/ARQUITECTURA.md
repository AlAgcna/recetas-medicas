# Arquitectura de partida

Versión: 0.1 — 17 de octubre de 2026. Arquitectura objetivo. Existe un prototipo
local con API en memoria; D1, R2, autenticación profesional real y Meta todavía
no están implementados. Ver `DESARROLLO.md` para el estado actual.

## 1. Principios

- Una sola aplicación con áreas profesional y paciente, no microservicios.
- TypeScript de extremo a extremo y SQL para persistencia.
- Preferir servicios administrados y minimizar operación e infraestructura.
- Autorización en el servidor y separación explícita entre registro clínico
  interno y documentos publicados.
- Interfaces simples y probadas con la médica.
- No confundir prototipo gratuito con habilitación para datos reales.

## 2. Componentes

```text
Navegador de la médica                 Navegador del paciente
            \                           /
             \-------- HTTPS ----------/
                         |
          Cloudflare Workers — mismo origen
          | React + TypeScript (archivos estáticos)
          | Hono + TypeScript (API y controles)
          |
          +-- D1: pacientes, consultas, publicaciones,
          |       sesiones, desafíos OTP y auditoría
          |
          +-- R2 privado: Word, PDF y otros adjuntos
          |
          +-- WhatsApp Cloud API: códigos al contacto verificado
                         |
                    WhatsApp del paciente

Digidoc -- PDF original cargado por la médica --> R2 privado

Proceso de respaldo independiente de la aplicación
    --> destino y operación pendientes de aprobación
```

Se propone servir interfaz y API desde el mismo origen para simplificar cookies
y controles de acceso. No significa que los archivos clínicos sean estáticos
públicos: su descarga pasa por autorización.

## 3. Tecnologías

| Capa | Elección de partida | Observaciones |
| --- | --- | --- |
| Lenguaje principal | TypeScript | Tipos no reemplazan validación de entradas ni permisos |
| Interfaz | React + Vite | Panel profesional y portal en una misma aplicación |
| Estilos | Tailwind CSS, propuesto | Confirmar al construir el prototipo; priorizar accesibilidad |
| Servidor | Hono sobre Cloudflare Workers | Validar compatibilidad de dependencias con el runtime |
| Base de datos | Cloudflare D1 / SQLite | Índices, migraciones y operaciones atómicas verificadas |
| Acceso a datos | Drizzle, propuesto | No asumir soporte transaccional idéntico a PostgreSQL |
| Validación | Zod, propuesto | Validación obligatoria en el servidor |
| Archivos | Cloudflare R2 privado | Sin acceso público permanente |
| Autenticación | Biblioteca mantenida por seleccionar | Sesiones en servidor; MFA profesional y OTP al paciente |
| Mensajería | WhatsApp Business Platform / Cloud API | API oficial; plantillas y habilitación según Meta |
| Pruebas | Vitest + Playwright, propuestos | Reglas, integración y recorridos de navegador |
| Versionado | GitHub privado, previsto | Gestión manual de add/commit/push por el usuario |

El prototipo fija sus versiones en `package.json` y `package-lock.json` e
implementa React, Vite, Hono, Zod, Vitest y Playwright. Se eligió CSS propio para
esta primera experiencia; Tailwind y Drizzle siguen siendo propuestas, no
dependencias instaladas. Los comandos actuales están en `DESARROLLO.md`.

## 4. Fronteras de confianza

- El navegador es un cliente no confiable. No decide identidad, propiedad,
  publicación ni vencimiento de permisos.
- El servidor valida sesión, rol, paciente asociado y estado publicado antes
  de leer datos o entregar un documento.
- D1 y R2 no tienen credenciales expuestas en la interfaz; se accede desde
  bindings del servidor o mecanismos restringidos.
- Las claves de Meta, cookies y códigos no se incorporan al repositorio.
- WhatsApp transporta el código, no la historia clínica ni el diagnóstico.
- Los webhooks de Meta son entradas externas: verificar firma, evitar
  duplicados y no confundir confirmación de entrega con autenticación.

## 5. Modelo conceptual de datos

No es un esquema definitivo. Se detallan responsabilidades antes de escribir
migraciones.

| Entidad | Responsabilidad y restricciones |
| --- | --- |
| Profesional | Cuenta de la única médica, credenciales/MFA y estado de acceso |
| Paciente | Identificador interno opaco, DNI normalizado, nombre, apellido y cobertura |
| Contacto verificado | WhatsApp normalizado, verificación y trazabilidad de cambios; puede implementarse en Paciente o por separado |
| Consulta | Paciente, fecha clínica, mediciones, motivo, examen, diagnóstico, cobertura registrada al finalizar, estado y autor |
| Enmienda | Referencia al registro finalizado, corrección, motivo, autor y fecha; conservar original |
| Documento | Propietario, consulta opcional, clave privada R2, formato, tamaño y procedencia |
| Indicación | Contenido para el paciente, asociación clínica y versión |
| Publicación | Versión con ámbito general/paciente, paciente opcional, estado activo y momento de reemplazo; general solo para indicaciones |
| Desafío de acceso | Paciente, contacto o versión de contacto, verificador protegido, creación, vencimiento, intentos y consumo |
| Control de solicitudes | Reserva atómica del próximo envío permitido y límites adicionales |
| Sesión | Verificador de token, identidad, rol, tiempos, revocación y política de expiración |
| Evento de auditoría | Actor, acción, identificador de recurso, resultado y fecha; sin contenido clínico o secretos |

### Relaciones esenciales

- Un paciente tiene múltiples consultas y documentos.
- Cada consulta conserva su contexto temporal; fechas de carga e importación
  no sustituyen a la fecha clínica.
- El portal lista la general activa, la específica propia activa y recetas
  propias. No recibe el historial inactivo ni el registro clínico completo.
- La relación entre publicación y documento debe ser de propiedad coherente;
  nunca permitir publicar un documento de otro paciente mediante un ID recibido.
- Los identificadores internos no deben ser el DNI ni permitir inferir acceso.
- Cada consulta finalizada conserva una fotografía de la cobertura conocida al
  finalizarla (`insuranceAtVisit`). Los agregados históricos usan esa fotografía,
  no la cobertura actual de la ficha. Para registros sin el dato, mostrar «Sin
  registrar» en lugar de reconstruirlo silenciosamente.
- Cambiar el contacto debe invalidar desafíos pendientes asociados al anterior
  y aplicar la política de revocación de sesiones definida en seguridad.

### Versionado y ámbitos de indicaciones

- La general usa `scope: general` y `patientId: null`; la específica y las recetas
  usan `scope: patient` con propietario. Una receta nunca es general.
- `active` determina visibilidad. Reemplazar conserva título, texto y creación de
  la anterior y agrega `supersededAt`; no sobrescribe su contenido ni la elimina.
- `src/server/demo/publications.ts` centraliza selección, proyección al paciente
  y sustitución. Listado y descarga usan la misma regla de visibilidad.
- El paciente recibe solo ID, tipo, título, contenido, ámbito y publicación; no
  recibe IDs de pacientes, banderas internas o el historial profesional.
- El servidor compara `expectedActiveId` y realiza el cambio de estado y la
  creación sin interrupción asíncrona en el proceso local. Una revisión obsoleta
  obtiene 409 sin alterar las versiones.
- En D1 se necesitarán operaciones condicionales/transaccionales verificadas y
  restricciones de unicidad para una general activa y una específica por paciente.
  No confiar en `UNIQUE(patientId)` para la general: SQLite permite varios NULL.
- No hay archivos reales ni migración productiva; los registros de la demo se
  recrean al reiniciar. La persistencia deberá mantener historial y sus invariantes.

### Enmiendas de consultas

- Una consulta finalizada nunca se sobrescribe: la enmienda crea la versión
  vigente y enlaza la anterior con `supersedesId`, mientras que la reemplazada
  conserva su contenido y registra `supersededAt`. La versión vigente es la que
  no tiene `supersededAt`.
- `consultationChain` en `src/shared/contracts.ts` reconstruye la cadena de
  versiones desde cualquier versión consultada. La ficha lista solo la vigente y
  la pantalla de la consulta muestra el historial con enlaces a cada versión
  reemplazada.
- El servidor exige el motivo, verifica que la versión revisada siga vigente y
  responde 409 si otra solicitud ya la reemplazó. El registro anterior se conserva
  íntegro, incluida la cobertura registrada en la visita (`insuranceAtVisit`).
- Las versiones reemplazadas no suman en las estadísticas ni en el contador del
  listado. Siguen siendo información profesional: no se exponen ni se descargan en
  el portal del paciente.

### Fechas y formatos

- Usar reloj del servidor para los controles de seguridad.
- Guardar instantes técnicos en UTC y mostrar en la zona
  `America/Argentina/La_Rioja`, verificando soporte en el runtime elegido.
- Modelar una fecha clínica sin hora como fecha, sin inventar una hora UTC.
- Mostrar formatos argentinos y unidades clínicas explícitas.
- Normalizar DNI y teléfono antes de comparar; preservar ceros significativos
  en identificadores de afiliación. No hacer único el teléfono sin resolver
  primero la política de números compartidos.

## 6. Organización sugerida para el futuro código

```text
src/
  web/             interfaz profesional y portal
  server/
    auth/          autenticación, sesiones y autorización
    patients/      pacientes y contactos
    consultations/ consultas y enmiendas
    documents/     carga y descarga privada
    publications/  indicaciones y recetas visibles
    messaging/     adaptador oficial de WhatsApp y pruebas
    audit/         eventos de seguridad y clínicos
  shared/          contratos y validaciones sin secretos
db/
  migrations/      migraciones D1 revisadas
tests/             integración y recorridos E2E
docs/              documentación de producto y operación
```

La estructura anterior es la propuesta para el núcleo definitivo. El prototipo
usa `src/server/demo/` para aislar almacenamiento, sesiones y mensajería
simulados de la entrada productiva. Evitar compartir módulos de servidor con el
bundle del navegador o retornar entidades clínicas completas desde endpoints
públicos.

## 7. Integraciones

### WhatsApp

- La aplicación Business del celular no es una API de envío programático.
- Integrar mediante Cloud API oficial y plantillas de autenticación, según
  requisitos vigentes de Meta.
- Encapsular la mensajería para sustituir el adaptador por uno de pruebas
  únicamente fuera de producción.
- Configurar cuenta de desarrollador y entorno oficial con destinatarios
  habilitados para validar conectividad. No prometer OTP reales ilimitados en
  sandbox ni usar una plantilla de ejemplo como evidencia de habilitación final.
- Antes de usar el número habitual, revisar elegibilidad para coexistencia de
  Business App y API y pedir autorización. Alternativamente evaluar otro número.
- Considerar estado de entrega, tiempo de vida del código, reintentos limitados
  e idempotencia sin generar múltiples mensajes por una misma solicitud.
- Usar credenciales de servicio adecuadas y su rotación en producción, no un
  token temporal de demostración.
- No usar automatización no oficial de WhatsApp Web ni depender de una PC
  prendida para que el paciente reciba el código.

### Digidoc

- La médica obtiene el PDF y lo carga manualmente como receta.
- El portal guarda y entrega ese documento original al paciente correspondiente.
- No asumir una API, integración automática, validación de dispensación ni
  habilitación propia como recetario electrónico.

### Word

- Conservar el archivo original sin ejecutarlo ni renderizar HTML no confiable.
- El soporte de `.doc`/`.docx`, macros, límites y protección frente a contenido
  malicioso requiere decisión y pruebas antes de importar datos reales.
- No agregar conversión, OCR o extracción automática al núcleo inicial.

### Estadísticas internas

- Endpoint profesional `GET /api/doctor/statistics?month=YYYY-MM`, protegido por
  la misma sesión de la médica y con `Cache-Control: no-store`.
- Agregación en el servidor; la respuesta contiene solo cantidades y coberturas,
  sin nombres, DNI, teléfonos, diagnósticos o listas de pacientes.
- Consultas por fecha clínica, pacientes únicos y coberturas por snapshot de la
  consulta finalizada; PDF de recetas por instante de publicación en La Rioja.
- No se envían eventos a analítica externa ni se introduce un nuevo proveedor.
- El catálogo solicitado reside en `src/shared/insurance.ts`; el selector buscable
  conserva «Otra» y nombres personalizados. «Sin obra social» se agrupa como
  «Particular». No es un padrón oficial ni una lista de convenios.
- El cálculo actual opera en memoria en `src/server/demo/statistics.ts`; en la
  etapa D1 deben conservarse definiciones y pruebas, con índices y migraciones
  revisados antes de importar datos históricos.

## 8. Entornos y publicación

- Desarrollo y prototipos: datos sintéticos, sin credenciales productivas.
- Pruebas: D1/R2 y secretos aislados; receptores de prueba autorizados.
- Producción: solo después de validar requisitos operativos y legales.
- No copiar bases ni documentos reales a previews o ejecuciones de CI.
- No cargar scripts de analítica, grabación de sesiones o servicios que reciban
  contenido clínico sin una evaluación y aprobación específicas.
- El arranque de producción debe rechazar configuración de códigos simulados,
  autenticación deshabilitada o secretos de ejemplo.
- CI futura: comprobación de tipos, pruebas, construcción y revisión de
  dependencias. Crear esta documentación no autoriza a desplegar automáticamente.
- Las acciones Git y la publicación en GitHub quedan a cargo del usuario.

## 9. Costos, límites y continuidad

- Objetivo: usar cuotas gratuitas para el prototipo y evaluar consumo real.
- Workers, D1 y R2 tienen cuotas distintas y comportamientos diferentes ante
  agotamiento o excedentes. No asumir que todo el proyecto es gratuito porque
  la cuenta base lo sea.
- Revisar límites por base D1, CPU de Workers y almacenamiento/operaciones R2;
  verificar especialmente el costo computacional de autenticación y archivos.
- WhatsApp de autenticación puede cobrar por mensaje entregado. Definir
  presupuesto y límites para prevenir abuso económico.
- Dominio, respaldo independiente, monitoreo y soporte pueden agregar costos.
- Las cuotas y tarifas cambian: consultar fuentes oficiales antes de contratar
  o presupuestar; no congelar un precio como garantía del proyecto.
- Definir contingencia cuando Meta no entregue, haya una caída o se agoten
  cuotas. No sustituirla por un bypass de autenticación.
- El versionado de código en GitHub no respalda D1 ni los archivos R2.

## 10. Fuentes para revalidar al implementar

- [Workers: precios y límites](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1: límites](https://developers.cloudflare.com/d1/platform/limits/)
- [D1: precios](https://developers.cloudflare.com/d1/platform/pricing/)
- [R2: precios](https://developers.cloudflare.com/r2/pricing/)
- [Cloud API: inicio](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)
- [WhatsApp: precios](https://business.whatsapp.com/products/platform-pricing)
- [Coexistencia Business App / API](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Plantillas de autenticación](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/authentication-templates)
