---
name: portal-clinico
description: Usar al diseñar, implementar, probar o revisar este portal clínico de una médica en La Rioja, su interfaz, historias, documentos, sesiones, WhatsApp, arquitectura Cloudflare o seguridad. Conserva los acuerdos del proyecto y la prohibición de git add, commit y push.
---

# Portal clínico de La Rioja

## Propósito y uso

Esta skill conserva el contexto aprobado del proyecto y guía su desarrollo.
Aplicarla a funcionalidad, arquitectura, interfaz, importación, autenticación,
pruebas, infraestructura y revisión de cambios. No autoriza implementar nuevas
funciones ni desplegar por sí sola.

Al cargarla, leer las instrucciones del proyecto y la documentación relevante.
Las rutas siguientes son relativas al directorio de esta skill:

- `../../../AGENTS.md`: restricciones de trabajo.
- `../../../docs/LINEA_BASE.md`: producto, campos, pantallas y criterios.
- `../../../docs/ARQUITECTURA.md`: componentes y modelo conceptual.
- `../../../docs/SEGURIDAD.md`: controles, pruebas y condiciones de producción.
- `../../../docs/DESARROLLO.md`: arranque, pruebas y límites del prototipo actual.
- `../../../docs/PERSISTENCIA.md`: esquema D1, R2, atomicidad y lo que falta.

Si aparece una instrucción nueva del usuario que modifica el producto,
identificar qué acuerdo reemplaza y actualizar la documentación afectada sin
convertir propuestas pendientes en decisiones definitivas.

## Restricciones no negociables

1. **No ejecutar `git add`, `git commit` ni `git push`.** No hacer staging,
   commits o publicaciones equivalentes con scripts, bibliotecas, GitHub CLI,
   herramientas MCP o APIs. El usuario realizará esas acciones manualmente.
2. No inicializar Git, crear remotos, desplegar, activar facturación ni registrar
   o migrar números por iniciativa propia. Pedir autorización específica.
3. No sobrescribir ni descartar cambios ajenos.
4. Usar datos ficticios para desarrollo, pruebas, ejemplos y capturas. Nunca
   incluir historias, DNI, teléfonos, documentos reales o secretos en GitHub.
5. No usar automatización no oficial de WhatsApp Web ni introducir códigos
   maestros, bypass de autenticación o simulación habilitable en producción.
6. No delegar a subagentes sin autorización o instrucción aplicable explícita.

## Contexto del consultorio

- Una sola médica, aproximadamente 55 años, poca familiaridad con tecnología.
- Atiende adultos en La Rioja, Argentina; trabaja muchas horas con la PC prendida.
- La interfaz profesional se usa principalmente en computadora. El portal del
  paciente debe funcionar bien en celular sin instalar una aplicación.
- Hay historias anteriores en Word, varios archivos según el paciente. Cantidad
  de pacientes, volumen total y formatos concretos aún desconocidos.
- Usa Digidoc para emitir recetas; obtiene PDF y actualmente los envía por WhatsApp.
- Tiene WhatsApp Business en el celular. No está confirmada la habilitación de
  Business Platform / Cloud API ni la elegibilidad del número para coexistencia.
- Se buscan recursos gratuitos o de bajo costo. GitHub privado previsto para
  código; no es base clínica ni respaldo de D1/R2.

## Producto y límites

- Alta mínima de paciente por la médica: DNI y WhatsApp. Completar nombre,
  apellido, obra social y número de afiliado cuando corresponda.
- Obra social es un desplegable buscable por texto, sin distinguir tildes o
  mayúsculas, con flechas/Enter/Escape y opción «Otra» para nombre libre.
- El catálogo solicitado está en `../../../src/shared/insurance.ts`: OSDE, Swiss
  Medical, Federada Salud, Sancor Salud, OSUNLaR, APOS, OSPJN, OSSEG, OSUTHGRA,
  PAMI, Policía Federal, DASUTEN, OSSACRA, Sanatorio Pasteur, Particular, Boreal,
  Nobis, Medicus Fuerzas de Seguridad (una opción), Mutual de Luz y Fuerza, Galeno,
  Jerárquico Salud, OSFATUN, OSSBA y Prevención Salud. No implica convenios confirmados.
- Conservar coberturas previas ajenas al catálogo bajo «Otra». Mostrar y agrupar
  «Sin obra social» como «Particular» sin reescribir consultas históricas.
- Verificar el contacto inicialmente y al cambiarlo, no aprobar cada ingreso.
- La ficha contiene consultas independientes con fecha, signos vitales, motivo,
  examen físico y diagnóstico. No sobrescribir la consulta anterior.
- Propuesta de signos vitales: presión arterial, frecuencias cardíaca y
  respiratoria, temperatura y saturación; peso/talla opcionales a validar.
  Mediciones no tomadas no deben convertirse en ceros ni datos inventados.
- Documentos Word, análisis, resultados e historia son internos por defecto.
- El paciente lee en pantalla **solo indicaciones activas** y puede descargarlas
  opcionalmente (texto UTF-8 en la demo). Las recetas van por separado como PDF.
- Máximo dos indicaciones por paciente: una general única para todo el consultorio
  y una específica privada del paciente. Puede haber menos si no se publicaron.
- La general se administra desde «Indicación general», no desde una ficha, y se
  comparte con pacientes autenticados actuales y futuros, nunca de forma anónima.
- Publicar otra del mismo ámbito reemplaza la activa conservando contenido y
  metadatos de la anterior en el historial profesional; no se borra ni se sobrescribe.
- La vista previa exige confirmar el reemplazo y, para la general, el alcance a
  todos y la ausencia de datos personales. Las recetas no consumen el límite de dos.
- El servidor fija el ámbito mediante rutas separadas, compara `expectedActiveId`
  y rechaza revisiones obsoletas con 409. Dos publicaciones concurrentes no pueden
  dejar múltiples activas. Listado y descarga usan la misma autorización; las
  versiones reemplazadas devuelven 404 al paciente, aunque conserve su sesión.
- La sección profesional se llama **«Indicaciones y Recetas»** y la acción es
  **«Añadir Indicación/Receta»**; reemplazan los textos iniciales de entrega.
- Publicar requiere acción explícita con vista previa y verificación del paciente.
- Conservar el PDF original de Digidoc; no emitir recetas propias ni asumir una
  API de integración o validación de dispensación.
- Consultas finalizadas se corrigen mediante enmiendas trazables. Borrador,
  finalización y publicación son acciones distintas.
- Evolución longitudinal detallada queda para una etapa posterior.
- Estadísticas mensuales solo para la médica: pacientes únicos con consultas
  finalizadas del mes, cantidad de esas consultas, PDF de recetas publicados en
  el mes local y cobertura más atendida según consultas, mostrando empates.
- No confundir pacientes atendidos con fichas creadas, ni recetas publicadas con
  todas las recetas emitidas en Digidoc. Los borradores no cuentan como atención.
- Guardar la cobertura en la consulta al finalizar (`insuranceAtVisit`), sin
  modificarla al editar después la ficha. Sin snapshot histórico, informar «Sin
  registrar», sin completar con cobertura actual. Particular y Sin registrar
  aparecen en el desglose, no como obras sociales líderes.
- Fuera del núcleo inicial: turnos, pagos, videollamadas, múltiples profesionales,
  menores/representantes, IA clínica, OCR y migración inteligente.
- La historia completa no se publica automáticamente, pero debe poder entregarse
  ante un pedido legítimo conforme a las obligaciones aplicables.

## Acceso autónomo y reglas temporales

El diseño final reemplaza la propuesta inicial de envío manual:

1. El paciente ingresa DNI.
2. El servidor busca el contacto previamente verificado y responde genéricamente.
3. Envía un OTP automáticamente mediante la API oficial al WhatsApp asociado.
4. El paciente valida el código y obtiene su sesión sin intervención de la médica.

- Una solicitud procesable cada **5 minutos por paciente**, también entre
  navegadores distintos. Complementar con límites por origen y volumen global.
- Código con **10 minutos** de validez, un solo uso y hasta **5 intentos**.
- Generación segura, verificador protegido con secreto del servidor, nunca texto
  claro en base/logs. Propuesta de formato: 6 dígitos.
- Reserva de envío, intentos y consumo atómicos, con semántica D1 verificada.
- Reemplazar un código invalida el anterior; una solicitud bloqueada no modifica
  desafíos existentes. Reintentos de transporte no generan códigos duplicados.
- Sesión del paciente: **20 minutos absolutos**, sin extensión por actividad.
- Sesión de la médica: **2 horas de inactividad**, renovables por trabajo real.
- Sondeos, auto-refresh y tareas de fondo no mantienen la sesión. Escritura o
  lectura con interacción reciente puede generar una señal autenticada y limitada.
- El servidor es la autoridad temporal; actividad tardía no revive una sesión.
- Avisar antes del cierre, proteger borradores y ocultar datos al vencer.
- Un máximo absoluto profesional de 12 horas fue sugerido, **sigue pendiente**.
- «24 horas» significa acceso autónomo diseñado para cualquier horario, no un
  SLA confirmado de Cloudflare o Meta ni una sesión indefinida.

## Arquitectura de partida

- TypeScript + React + Vite para interfaz.
- TypeScript + Hono sobre Cloudflare Workers para servidor.
- Cloudflare D1 / SQLite para datos. Drizzle quedó sin adoptar: la capa de acceso
  usa SQL parametrizado sobre el puerto de almacenamiento (ver `PERSISTENCIA.md`
  §7.1, decisión abierta).
- Cloudflare R2 privado para documentos.
- Zod propuesto para validar entradas; Tailwind CSS propuesto para estilos.
- Vitest y Playwright propuestos para pruebas de reglas e integración/E2E.
- Una aplicación, preferentemente web y API del mismo origen; no microservicios.
- Sesiones opacas y revocables del lado del servidor. Cookies `HttpOnly`,
  `Secure`, `SameSite` y protección CSRF adecuada. No JWT por defecto.
- Ingreso de la médica por **enlace de un solo uso al correo** (decisión del
  usuario, 19 de octubre de 2026, detalle y riesgos en `SEGURIDAD.md` §2): sin
  contraseña y sin segundo factor dentro del portal. La casilla de correo es la
  credencial principal y necesita MFA en el proveedor; conviene revisarlo con la
  médica antes de abrir producción.
- GitHub administrado manualmente por el usuario. No hay permiso implícito de CI
  con despliegue automático ni creación de recursos externos.

## Reglas de seguridad al implementar

- DNI identifica, no autentica. Nunca aceptar un teléfono nuevo en el acceso público.
- MFA y recuperación segura en las cuentas de proveedores, incluida la casilla de
  correo de la médica (factor principal del ingreso profesional, `SEGURIDAD.md` §2).
- Autorizar cada consulta y archivo por rol, paciente y publicación en el servidor.
- Las estadísticas son privadas: agregación en el servidor, sin datos personales
  en la respuesta y sin acceso para pacientes o visitantes. No usar analítica externa.
- No retornar historia clínica al navegador del paciente para ocultarla con CSS.
- Nunca copiar datos de una ficha en la general ni admitir recetas generales.
  El paciente no ve historial inactivo ni metadatos de otros pacientes.
- R2 privado, descarga autenticada y sin enlaces públicos permanentes.
- No cachear contenido clínico en CDN, service worker o almacenamiento persistente
  del navegador. No guardar sesiones o borradores clínicos en `localStorage`.
- No incluir DNI, contenido clínico, OTP, cookies ni tokens en logs, URLs o analítica.
- Validar entradas y archivos. No ejecutar Word/macros ni renderizar HTML no confiable.
- Cambios de contacto verificados y auditados; invalidar desafíos del anterior
  y revocar sesiones de paciente según la política inicial.
- Auditoría de accesos, descargas, publicación y cambios sin duplicar contenido clínico.
- Respaldar D1 y R2 de forma independiente y probar restauración y recuperación
  de claves. Cuotas gratuitas no equivalen a disponibilidad o respaldo.
- Revisión legal argentina y de La Rioja, contratos, transferencias, conservación
  y procedimiento de entrega de historia antes de incorporar datos reales.
- No afirmar cumplimiento legal porque exista cifrado o aceptación de términos.

## Prototipo e importación

- Existe un prototipo React/Vite y Hono local en memoria. Arranca con
  `npm run dev` en `http://127.0.0.1:5173`, solo loopback. Reiniciar borra cambios.
- Cambios de API requieren reinicio manual. Playwright utiliza servidores
  aislados en 5183/8788; no detener ni reutilizar la demo del usuario para probar.
- El acceso demo (`/api/demo/doctor-login`) no usa credencial real. El ingreso
  real por enlace de correo existe en el servidor, con sus rutas y pruebas, pero
  todavía no se monta en la entrada productiva.
- El build muestra una pantalla cerrada y la entrada productiva devuelve 503.
  No quitar estos bloqueos para desplegar el prototipo.
- Zod, Vitest y Playwright están instalados. El diseño usa CSS propio; Tailwind
  sigue propuesto. Drizzle no se instaló: la capa de acceso usa puertos con SQL
  parametrizado; las migraciones D1 son SQL revisado a mano.
- Guardado de consultas manual; finalizadas no se sobrescriben, se corrigen con
  enmiendas trazables. Hay reemplazos versionados de indicaciones, con historial
  conservado y descargas revocadas.
- Existe el esquema D1 (`db/migrations` 0001 y 0002, ver `PERSISTENCIA.md`) con
  sus adaptadores de D1/R2 y de correo, y sus pruebas locales. Montar la entrada
  productiva, usar archivos reales en R2, retiro manual sin reemplazo y despliegue
  siguen pendientes.
- Validar las pantallas con la médica antes de consolidar experiencia y formularios.
- Códigos simulados solo en pruebas; producción debe rechazar esa configuración.
- Validar Cloud API con recursos oficiales de Meta y destinatarios habilitados.
  Una prueba de mensaje no prueba habilitación de plantillas OTP para pacientes reales.
- Revalidar tarifas de autenticación, presupuesto y requisitos de número/plantilla.
- La política de privacidad es HTML plano sin JS (`public/privacidad.html`, servida
  en `/privacidad`), con responsable sin nombre propio y contacto `dranallim@gmail.com`.
  Es la URL que pide Meta: se publica con el push y el deploy que hace el usuario.
- No alterar el WhatsApp habitual sin comprobar coexistencia y pedir permiso.
- Importar Word conservando originales, fecha conocida, procedencia y paciente
  revisado. No inventar fechas ni habilitar teléfonos antiguos sin verificarlos.
- Propuesta de lectura: PDF adicional, sin asumir conversión automática.

## Criterios de interfaz

- Español claro, fechas argentinas y unidades visibles.
- Tipografía legible, buen contraste, botones grandes y acciones con texto.
- Pocas opciones por pantalla, foco visible y navegación con teclado.
- Inicio con búsqueda y alta; ficha con identidad visible; consulta vertical;
  «Indicaciones y Recetas» con vista previa y apartado «Estadísticas» con selector
  mensual. No incluir bandeja de autorización por ingreso.
- Guardado y errores explícitos, sin confundir autosave con finalización/publicación.
- Probar con la médica: buscar/crear paciente, completar consulta y publicar receta.

## Procedimiento de trabajo

1. Leer documentos y distinguir lo acordado de lo propuesto o pendiente.
2. Para código existente, comenzar por grafo si está disponible y después leer
   fuente y pruebas. No modificar comportamiento basándose solo en el grafo.
3. Elegir el cambio más pequeño dentro del pedido y preservar restricciones.
4. Para cambios no triviales, probar el comportamiento y sus fallos relevantes.
5. En autenticación/documentos, probar acceso cruzado, expiración, revocación,
   consumo concurrente de OTP, cooldown y ausencia de datos en logs/caché.
   En indicaciones, probar máximo de dos, alcance general/específico, reemplazo
   confirmado y concurrente, preservación del historial, enlaces inactivos y
   visibilidad para pacientes nuevos. En D1 no confiar en UNIQUE con NULL para
   garantizar una sola general activa: se requiere unicidad y atomicidad verificadas.
6. En sesiones, probar renovación por actividad y no por sondeos, incluyendo
   múltiples pestañas y límites exactos de tiempo.
   En estadísticas, probar pacientes únicos, borradores, fecha clínica, mes de
   publicación en La Rioja, empates, cambios de cobertura y autorización por rol.
7. Actualizar documentación afectada y reportar verificaciones reales, pendientes
   y bloqueos. Nunca afirmar despliegue o integración no ejecutados.
8. No realizar staging, commit ni push. Entregar archivos para revisión manual.
