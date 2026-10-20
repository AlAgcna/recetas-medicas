# Seguridad y condiciones de operación

Versión: 0.1 — 17 de octubre de 2026.

Estos son requisitos de diseño y verificación **para el sistema definitivo**.
El prototipo prueba algunos controles con almacenamiento en memoria y acceso
profesional simulado; no satisface esta lista para producción. Ver
`DESARROLLO.md` para sus límites. Las decisiones técnicas no sustituyen revisión
legal ni certifican cumplimiento.

## 1. Riesgos principales

- Conocer un DNI, incluso uno real, no acredita identidad.
- Un número de WhatsApp mal asociado, compartido, reasignado o comprometido puede
  entregar acceso a otra persona.
- Manipular identificadores puede exponer documentos de otro paciente si falta
  autorización por recurso.
- Una PC encendida con sesión abierta puede exponer datos a terceros.
- Errores de publicación o importación pueden vincular datos al paciente equivocado.
- Solicitudes automatizadas pueden enumerar pacientes, bloquear accesos o
  generar gastos de mensajería.
- Pérdida de D1, R2 o claves, registros excesivos y previews con datos reales
  pueden comprometer confidencialidad o disponibilidad.
- Comprometer la casilla de correo de la médica equivale a robar su credencial
  de ingreso: con enlace de acceso por correo (§2), esa casilla es el factor
  único de autenticación profesional.

## 2. Autenticación profesional

**Decisión adoptada con el usuario, 19 de octubre de 2026:** ingreso de la médica
**sólo con enlace de un solo uso por correo** («magic link»), sin contraseña y sin
segundo factor dentro del portal.

Reglas que lo sostienen:

- El enlace lo pide la médica; el servidor lo envía a una única casilla
  configurada como secreto y nunca responde con el token.
- 15 minutos de vigencia, un solo uso, un pedido de enlace por minuto; emitir
  uno nuevo invalida el anterior. El consumo es atómico: dos usos simultáneos no
  abren dos sesiones.
- En la base queda sólo el hash SHA-256 del token; el token no aparece en
  respuestas, en la auditoría ni en registros del servidor. El token viaja en el
  fragmento de la URL (`/acceso#…`), que no llega al servidor con el `GET`.
- Respuestas idénticas para «correo configurado», «correo no configurado»,
  «enlace vencido» y «enlace inventado»: no revelan si existe la casilla.
- Cookie de sesión `HttpOnly`, `Secure`, `SameSite=Strict` y con nombre sin el
  prefijo `demo_` en producción, más los controles de origen de cada pedido.
- La sesión profesional conserva la política de §4 (2 horas de inactividad; el
  máximo absoluto sigue pendiente).

**Riesgo aceptado explícitamente: la casilla de correo es la credencial
principal.** Quien controle esa casilla entra al portal. Por eso son
condiciones del modo elegido:

- MFA en el proveedor de correo y en las cuentas de GitHub, Cloudflare y Meta,
  con recuperación bajo titularidad acordada con el usuario.
- Ante pérdida o compromiso de la casilla: revocación de sesiones y rotación de
  secretos. El producto no tiene contraseña maestra ni código de recuperación.
- Si el riesgo no le resulta aceptable a la médica, corresponde revisar esta
  decisión antes de abrir producción y evaluar un segundo factor (autenticador
  o passkey) con una biblioteca mantenida, tal como exigía este documento antes
  de la decisión.

Resto de la política profesional en vigor:

- Cuenta personal de la única médica, sin credenciales compartidas.
- Usar una biblioteca mantenida y compatible con Workers; no implementar
  algoritmos criptográficos propios ni simplificar el almacenamiento de claves
  para ajustarse a límites gratuitos.
- Recuperación segura documentada, con revocación de sesiones cuando corresponda.
- Las cuentas de GitHub, Cloudflare y Meta también necesitan MFA, acceso mínimo
  y recuperación bajo titularidad acordada con el usuario.

## 3. Códigos de acceso del paciente

### Identidad y destino

- Normalizar el DNI y buscar internamente el paciente y su contacto verificado.
- Nunca permitir que el formulario público seleccione un número nuevo.
- Aplicar un procedimiento de verificación inicial y de cambio de contacto.
- Cambios de número auditados; invalidar desafíos pendientes del contacto previo
  y revocar sesiones de paciente como política inicial de protección.
- Definir tratamiento de teléfonos compartidos, perdidos o reasignados antes
  de habilitar acceso real. WhatsApp OTP acredita control del contacto registrado,
  no una identidad civil verificada independientemente en cada ingreso.

### Emisión y verificación

- Generación criptográficamente segura, sin código maestro, fijo o predecible.
- Propuesta de formato: 6 dígitos, sujeto a la política de intentos definida.
- No guardar el valor en claro. Un hash simple de un código corto no es
  protección suficiente ante acceso a la base: utilizar un verificador protegido
  con secreto del servidor, por ejemplo HMAC, y comparación segura.
- Vencimiento a los 10 minutos desde generación; un solo uso y hasta 5 intentos.
- Al emitir un reemplazo válido, invalidar el desafío previo. Una solicitud
  bloqueada por límites no debe alterar códigos ni sesiones existentes.
- Consumo y actualización de intentos mediante operaciones atómicas verificadas
  en D1. Dos solicitudes simultáneas no pueden consumir el mismo código.
- Reservar atómicamente el cupo de emisión: máximo una solicitud procesable cada
  5 minutos por paciente, incluso desde navegadores o instancias distintas.
- Definir estado de envío e idempotencia. Ante fallo de entrega, no abrir
  sesión ni permitir reintentos ilimitados o mensajes duplicados. Los reintentos
  técnicos limitados de un mismo envío no son desafíos nuevos.
- Si un mensaje llega después del vencimiento, el código no funciona; la entrega
  o lectura reportada por Meta no concede acceso.

### Protección de abuso y privacidad

- Límites adicionales por origen y volumen total, además del límite por paciente.
- Definir umbrales globales, presupuesto y escalamiento de protección al
  implementar; no fijar bloqueo permanente de pacientes por solicitudes anónimas.
- Respuestas genéricas y comparables para DNI existente/inexistente, contacto
  no habilitado y solicitudes limitadas. No exponer teléfono, identidad, tiempos
  personales de cooldown ni contenido del registro.
- Respuestas y comportamiento temporal no deben facilitar enumeración trivial.
- No enviar DNI, diagnósticos, medicamentos o historia en el mensaje de acceso.
- Nunca incluir códigos o credenciales en URLs del portal, logs ni analítica.

## 4. Sesiones del lado del servidor

### Mecanismo

- Token de sesión opaco, aleatorio y de alta entropía; almacenar un verificador
  protegido en el servidor, no una copia utilizable del token.
- Cookie `HttpOnly`, `Secure`, `SameSite` con alcance mínimo apropiado.
- Preferir mismo origen para web/API. Evitar CORS amplio con credenciales.
- Proteger acciones con efecto frente a CSRF mediante controles de origen y/o
  token según la biblioteca; `SameSite` no es la única defensa.
- Renovar el identificador al autenticar y controlar fijación de sesión.
- No almacenar tokens de sesión, OTP ni información clínica en `localStorage`.
- Separar el contexto y políticas de sesión profesional y paciente.
- Validar la sesión y su vencimiento en el servidor en **cada** operación
  protegida, incluidas descargas y señales de actividad.
- Cerrar sesión revoca el registro del servidor y limpia la cookie. La limpieza
  periódica de sesiones vencidas no reemplaza verificar su vencimiento.

### Duraciones

| Rol | Regla |
| --- | --- |
| Paciente | Vencimiento absoluto a los 20 minutos de autenticación, sin renovación por navegación |
| Médica | Vencimiento por inactividad a las 2 horas de la última actividad válida |
| Médica: máximo absoluto | Pendiente; 12 horas fue una recomendación, no un acuerdo cerrado |

El servidor es la autoridad temporal. La cookie y la interfaz no pueden
extender el vencimiento permitido. Una solicitud llegada después de vencer no
resucita la sesión por traer una marca de actividad del cliente.

### Actividad profesional y computadora desatendida

- Registrar interacciones de trabajo: búsqueda, navegación de fichas, escritura,
  guardado y consulta de documentos con interacción reciente.
- Para escritura local o lectura con interacción reciente, usar una señal de
  actividad acotada y autenticada, con frecuencia limitada.
- No renovar por polling, cron, sincronización, auto-refresh ni autosave que no
  corresponda a cambios e interacción nuevos. Una pestaña visible no basta.
- Una señal del navegador es una aproximación de interacción, no prueba de
  presencia física ni defensa frente a una sesión robada o XSS.
- Avisar antes del vencimiento y permitir continuar mientras la sesión siga
  válida. Al vencer, ocultar datos, limpiar estado sensible de la interfaz y
  requerir autenticación.
- Guardar borradores en el servidor, bajo sesión válida. No dejar borradores
  médicos en almacenamiento persistente del navegador por conveniencia.
- Definir recuperación de cambios aún no enviados si hay fallo de red, sin
  prometer recuperación de texto que nunca llegó al servidor.
- Recomendar bloqueo automático del sistema operativo y cierre manual al alejarse:
  una ventana de 2 horas no protege una PC físicamente accesible.

### JWT

No es la estrategia inicial. JWT firmado no implica contenido cifrado ni
revocación automática. Si una integración futura lo necesita, justificarlo y
definir expiración, validación estricta y revocación sin incluir datos clínicos.

## 5. Autorización y publicaciones

- Denegar por defecto. Validar rol, paciente asociado y recurso concreto.
- No aceptar un DNI o `patientId` del cliente como prueba de propiedad.
- La API del paciente devuelve una proyección limitada de sus publicaciones;
  no envía la historia completa para ocultarla después con React.
- Verificar también propiedad de adjuntos y versiones al publicar y descargar.
- No permitir que metadatos de archivos internos se filtren por listados,
  nombres, errores, buscadores o URLs.
- Una retirada de publicación impide nuevos accesos en el servidor; no puede
  borrar las copias que el paciente ya descargó. Evitar enlaces duraderos que
  eludan revocación.
- Nunca reemplazar silenciosamente una receta publicada por otro archivo.
- Solo una general y una específica por paciente pueden estar activas. El ámbito
  lo fija la ruta del servidor, no campos enviados por el navegador. La general
  solo puede ser una indicación y solo se entrega bajo sesión de paciente válida.
- Publicar la general requiere una vista previa separada y confirmación de que
  no contiene datos personales. Nunca extraer automáticamente datos de una ficha
  para completar una indicación compartida con todos.
- La sustitución de indicaciones verifica la versión revisada, conserva la
  anterior inactiva y revoca su listado y descarga. Una publicación concurrente
  o desactualizada no debe sobrescribir la nueva ni acumular activas.
- El historial es exclusivamente profesional. Listado y descarga del paciente
  comparten la misma comprobación de ámbito, propiedad y estado activo.
- Auditar publicación, retiro y correcciones. La historia finalizada conserva
  registro original, autor, fecha y enmiendas.
- Las estadísticas de atención también son información privada: solo sesión
  profesional, agregación en el servidor y sin respuesta con identidades o datos
  clínicos. No exponerlas al portal del paciente ni a analítica externa.

## 6. Archivos, interfaz y cifrado

- HTTPS obligatorio. Almacenamiento y respaldos cifrados según configuración
  y garantías verificadas del proveedor.
- Evaluar cifrado adicional de campos/documentos según amenazas y obligaciones;
  no imponer una solución criptográfica propia sin plan de claves y recuperación.
- R2 privado, sin bucket público ni URLs permanentes accesibles sin permisos.
- La estrategia inicial de descarga pasa por el servidor autenticado. Si se
  evalúan URLs firmadas, su vigencia no puede superar la sesión y debe resolverse
  el efecto sobre revocación antes de adoptarlas.
- Respuestas con datos clínicos, portal privado y descargas con política de
  no almacenamiento en caché (`Cache-Control: no-store` donde corresponda).
  No guardarlas en cachés compartidas ni service workers.
- Validar entradas del servidor y usar consultas parametrizadas.
- Evitar renderizado de HTML no confiable. Aplicar CSP y cabeceras de seguridad
  acordes a la interfaz; probar defensas XSS y protección frente a framing.
- Validar archivos por tamaño, extensión y contenido; no confiar solo en MIME
  declarado por el navegador. Definir cuarentena/análisis y política de macros
  antes de aceptar documentos reales.
- No ejecutar archivos Word, macros o scripts. Tratar PDF y adjuntos como
  contenido no confiable al decidir vista previa o descarga.
- Usar nombres y claves de almacenamiento opacos sin DNI o diagnósticos en URLs.
- Secretos únicamente en el gestor de secretos/configuración del servidor,
  nunca en variables públicas de Vite, capturas o archivos versionados.

## 7. Auditoría, monitoreo y respaldo

- Eventos de autenticación, fallos, cambios de contacto, acceso/descarga,
  creación/finalización/enmienda y publicación/retiro.
- Registrar actor o contexto técnico, acción, recurso opaco, resultado y fecha;
  minimizar IP y datos de contexto con política de conservación definida.
- No registrar cuerpos clínicos, documentos, contraseñas, OTP, tokens o cookies.
- Restringir modificación y acceso a auditoría; no confundir logs temporales
  del proveedor con el registro de trazabilidad de la aplicación.
- Monitorear errores, cuota de plataforma, gasto de mensajes y entregas fallidas
  sin capturar contenido sensible.
- Copias de D1 **y** R2 fuera del único punto de fallo operativo. Destino,
  frecuencia, conservación, cifrado y responsables pendientes de aprobación.
- Probar restauración conjunta, coherencia entre metadatos y archivos, y
  recuperación de claves. GitHub no es respaldo de datos clínicos.
- Definir RPO/RTO, incidentes, contactos y contingencia antes de producción.

## 8. Pruebas mínimas obligatorias

- Código vencido, incorrecto, consumido, reemplazado y quinto intento fallido.
- Dos validaciones concurrentes: como máximo una crea acceso con el mismo OTP.
- Emisiones concurrentes y cambio de navegador no eluden los 5 minutos.
- Fallos/reintentos/webhooks duplicados de Meta no abren sesiones ni multiplican
  mensajes o códigos de forma no controlada.
- DNI desconocido y límites no revelan existencia, teléfono ni datos clínicos.
- Paciente A no lista, ve, descarga ni modifica recursos del paciente B.
- Pacientes y visitantes no obtienen estadísticas profesionales. La respuesta
  estadística contiene solo agregados y mantiene `Cache-Control: no-store`.
- Documentos internos y borradores no se exponen, tampoco como metadatos.
- General visible a pacientes actuales y nuevos, pero no a visitantes anónimos.
  La específica sigue privada; pacientes no gestionan la general ni consultan historial.
- Máximo dos indicaciones activas, con recetas independientes; reemplazos
  concurrentes, versión esperada incorrecta y enlaces de versiones inactivas.
- Acceso por URL directa sin sesión y después de cerrar, vencer o revocar.
- Sesión del paciente a los 20 minutos exactos, aun con actividad.
- Sesión profesional antes y después de 2 horas, con actividad legítima,
  señales de escritura limitadas, múltiples pestañas y polling de fondo.
- Renovación no revive una sesión vencida y no altera la política del paciente.
- CSRF, entradas maliciosas, HTML no confiable, cargas inválidas y secretos en
  bundle/logs/URLs/cachés.
- Borradores ante desconexión y vencimiento, sin publicación involuntaria.
- Enmienda de consulta finalizada: exige motivo, conserva el texto original,
  rechaza una versión ya reemplazada o de otra ficha y no duplica el registro
  profesional ni la estadística.
- Enlace de ingreso de la médica: vencido, ya usado, reemplazado por uno nuevo,
  emitido dentro del enfriamiento y con respuesta genérica sin existir casilla.
- El enlace de la médica no aparece en la respuesta, en la auditoría ni en la
  base: sólo su hash SHA-256.
- Sesión profesional con cookie `Secure`, `HttpOnly` y sin prefijo de
  demostración en la configuración de producción.
- Restauración de datos y archivos en un entorno aislado autorizado.
- Configuración de producción rechaza adaptadores simulados y bypass.

## 9. Revisión legal y sanitaria

- Argentina: considerar Ley 25.326 de protección de datos y Ley 26.529 de
  derechos del paciente, además de normativa sanitaria vigente y aplicable en
  La Rioja. Validar con asesoramiento especializado.
- Definir titular/responsable, encargados/proveedores, avisos al paciente,
  bases legales aplicables, conservación, acceso y respuesta a incidentes.
- Revisar ubicación y tratamiento de datos, contratos y transferencias
  internacionales; una región cercana o cifrado por sí solos no resuelven
  estas obligaciones.
- El paciente es titular de su historia. Prever entrega de copia completa
  autenticada ante pedido y los plazos aplicables; la referencia general de la
  Ley 26.529 es 48 horas, con tratamiento de urgencias según corresponda.
- El portal entrega recetas de Digidoc y no se presenta como recetario propio
  autorizado. Emitir PDF, agregar firma o QR no demuestra validez de receta.
- No utilizar «aceptar términos» como sustituto de todos los requisitos legales.
- La URL pública de privacidad (`public/privacidad.html`, servida como
  `/privacidad`) publica un aviso preliminar: identifica al responsable sin
  nombre propio, enumera datos, finalidades, encargados (Cloudflare, WhatsApp de
  Meta y proveedor de correo), conservación, seguridad y derechos, y no declara
  cumplimiento ni certificación. Falta la revisión legal completa antes de
  operar con datos reales.

Referencias iniciales a revalidar:

- [Historia clínica: derechos del paciente](https://www.argentina.gob.ar/justicia/derechofacil/aplicalaley/mi-historia-clinica)
- [Ley 25.326](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790)
- [Ley 26.529](https://www.argentina.gob.ar/normativa/nacional/ley-26529-160432)
- [Receta electrónica y ReNaPDiS](https://www.argentina.gob.ar/salud/digital/renapdis/receta-electronica)

## 10. Lista de salida a producción

- [ ] Responsable y titularidad de cuentas, dominio, claves y operación definidos.
- [ ] Política de privacidad revisada y publicada con el responsable identificado.
- [ ] Revisión legal aplicable, contratos y transferencias documentados.
- [ ] Contactos verificados, recuperación y teléfonos compartidos resueltos.
- [ ] Ingreso de la médica probado de punta a punta, con la casilla de correo
  protegida por MFA y sesiones revocables. El factor único del portal (§2) debe
  quedar aceptado explícitamente por la médica antes de abrir.
- [ ] API y plantilla de autenticación habilitadas para uso real y costos aprobados.
- [ ] Permisos, tiempos, concurrencia y límites comprobados con pruebas.
- [ ] Archivos privados, cargas seguras y política de publicación verificadas.
- [ ] Datos y secretos separados entre desarrollo, pruebas y producción.
- [ ] Simulación y credenciales de prueba imposibilitadas en producción.
- [ ] Auditoría, monitoreo, límites de consumo y contingencia operativos.
- [ ] Respaldo independiente y restauración probados; RPO/RTO acordados.
- [ ] Conservación y entrega de historia clínica completa definidas.
- [ ] Importación piloto revisada y prueba de usabilidad con la médica realizadas.
- [ ] Autorización explícita del usuario para desplegar y cargar datos reales.
