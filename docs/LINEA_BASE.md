# Especificaciones de desarrollo

Versión: 0.4 — 20 de octubre de 2026. El código de acceso del paciente se entrega
por SMS (Twilio) en lugar de WhatsApp; es una decisión reversible y se motiva en
§4.4. La versión 0.3 incluía búsqueda de coberturas e indicaciones
generales/específicas con descarga opcional y reemplazo versionado.

Este documento consolida la conversación de definición. **Acordado** representa
un requisito del producto; **propuesto** es una opción de implementación;
**pendiente** requiere validación antes de considerarse definitiva. Existe un
primer prototipo local de experiencia; su alcance y limitaciones se describen en
`DESARROLLO.md`. Los requisitos de producción no se consideran implementados.

## 1. Contexto y objetivo

### Acordado

- Una sola médica que atiende en La Rioja, Argentina.
- Pacientes mayores de edad. No se incluye representación de menores.
- La médica tiene aproximadamente 55 años, poca familiaridad con tecnología y
  trabaja muchas horas con la computadora encendida.
- La aplicación debe ser fácil de usar y reducir tareas repetitivas.
- Las historias anteriores están en archivos Word; puede haber varios por
  paciente. No se conoce aún la cantidad total de pacientes, archivos o bytes.
- La médica emite recetas mediante Digidoc, las obtiene en PDF y actualmente
  las envía por WhatsApp. El portal conservará los documentos originales.
- El consultorio ya utiliza la aplicación WhatsApp Business. Esto no demuestra
  que tenga habilitada WhatsApp Business Platform / Cloud API.
- Se prioriza infraestructura gratuita o de bajo costo, con GitHub como
  repositorio privado previsto y Cloudflare como plataforma de partida.

### Objetivo

Centralizar el trabajo clínico de la médica y permitir al paciente acceder de
forma autónoma, a cualquier hora, a sus indicaciones y recetas publicadas.
La disponibilidad 24 horas es un objetivo de diseño, no una garantía de SLA:
depende también del alojamiento, sus cuotas y la entrega de mensajes de Meta.

## 2. Roles y visibilidad

### Médica

- Gestiona pacientes y datos de contacto verificados.
- Consulta y registra información clínica y documentos previos.
- Crea consultas, indicaciones y adjunta recetas de Digidoc.
- Decide explícitamente qué indicaciones y recetas publica en el portal.
- Accede a información de auditoría según el diseño operativo.
- Consulta estadísticas mensuales propias, sin servicios externos de analítica.

### Paciente

- No se autorregistra ni elige el WhatsApp de destino desde el acceso público.
- Se autentica con DNI y un código enviado al contacto previamente verificado.
- Lee directamente en pantalla las indicaciones activas: una general compartida
  y una específica propia, como máximo. Puede descargar una copia opcional.
- Consulta sus recetas publicadas y puede descargar los PDF originales.
- No edita registros clínicos, no accede a otros pacientes y no ve
  automáticamente las notas, resultados, análisis o Word internos.

La visibilidad en el portal no determina la titularidad legal de la historia.
Debe existir un procedimiento para entregar la historia completa al paciente
cuando corresponda; no se promete ocultarla frente a un pedido legítimo.

## 3. Datos de la ficha

### Datos del paciente

| Campo | Regla de partida |
| --- | --- |
| DNI | Requerido para el alta mínima; evitar duplicados y normalizar el formato |
| WhatsApp | Requerido para el alta mínima; normalizar con código de país y verificar asociación. Es el número de contacto: hoy recibe el código de acceso por SMS |
| Nombre y apellido | Requeridos para completar la ficha; puede completarlos la médica después del alta mínima |
| Obra social | Desplegable con búsqueda por texto, catálogo solicitado, Particular y Otra con nombre libre |
| Número de afiliado | Registrar cuando corresponda; texto para preservar letras y ceros iniciales |

El alta mínima solicitada es DNI + WhatsApp. Se propone mostrar una ficha
incompleta como tal y completar nombre y apellido antes de finalizar la primera
consulta. El procedimiento exacto de verificación inicial y el tratamiento de
números compartidos o reasignados están pendientes; no se presume que un número
pertenece al paciente solo porque figure en un Word antiguo.

El listado solicitado incluye: OSDE, Swiss Medical, Federada Salud, Sancor Salud,
OSUNLaR, APOS, OSPJN, OSSEG, OSUTHGRA, PAMI, Policía Federal, DASUTEN, OSSACRA,
Sanatorio Pasteur, Particular, Boreal, Nobis, Medicus Fuerzas de Seguridad, Mutual
de Luz y Fuerza, Galeno, Jerárquico Salud, OSFATUN, OSSBA, Prevención Salud y Otra.
«Medicus Fuerzas de Seguridad» es una sola opción, tal como fue indicada.

La búsqueda ignora tildes y mayúsculas y permite elegir con teclado o puntero.
«Otra» habilita un nombre libre y conserva coberturas anteriores que no estén en
el catálogo. «Sin obra social» se presenta y agrupa como «Particular», sin
reescribir consultas históricas. La lista no confirma convenios del consultorio.

### Datos de cada consulta

- Fecha de consulta.
- Signos vitales.
- Motivo de consulta.
- Examen físico.
- Diagnóstico.

**Propuesta de desglose de signos vitales**, a validar con la médica: presión
arterial, frecuencia cardíaca, frecuencia respiratoria, temperatura y saturación
de oxígeno. Peso y talla pueden agregarse como mediciones complementarias.
Mostrar unidades explícitas y distinguir un dato no medido de un valor cero.
No obligar a inventar mediciones para guardar.

Cada consulta es un registro independiente asociado al paciente. No sobrescribe
la consulta anterior. El diseño específico de evolución longitudinal del
paciente se tratará más adelante.

### Datos complementarios de partida

- Documentos internos y estudios asociados al paciente y, cuando corresponda,
  a una consulta.
- Indicaciones y recetas con estado de publicación explícito.
- Autor, fecha de creación, modificación, finalización y corrección.
- Metadatos de importación y procedencia de archivos.
- Estado del contacto verificado y cambios de número auditados.
- Cobertura registrada al finalizar cada consulta, para mantener estadísticas
  históricas estables cuando después se edita la ficha del paciente.

## 4. Flujos funcionales

### 4.1 Alta y búsqueda

1. La médica busca por DNI o nombre antes de crear un registro.
2. Si no existe, registra DNI y WhatsApp.
3. Verifica la asociación del contacto e incorpora nombre y apellido y cobertura.
4. Completa el resto de la ficha y adjunta antecedentes cuando corresponda.

La validación de contacto ocurre en el alta o cambio de número, **no en cada
acceso del paciente**. No permitir que el acceso público modifique el destino.

### 4.2 Consulta clínica

1. Abrir la ficha y seleccionar «Nueva consulta».
2. Completar los campos de la consulta; el borrador se guarda solo.
3. Finalizar la consulta con una acción explícita.
4. Corregir una consulta finalizada mediante una enmienda trazable, no mediante
   borrado o reemplazo silencioso del registro original.

El borrador se guarda solo, con una pausa después de la última tecla, y muestra
su estado: guardando, guardado con la hora, sin guardar con reintento automático
ante fallos de red, y sesión vencida. Ante una sesión vencida deja de reintentar
y conserva el texto en pantalla. No equivale a finalizar ni a publicar. Está
implementado y probado de extremo a extremo en el prototipo; como toda la demo,
el borrador vive en memoria y se pierde al reiniciar el servidor. Si se pierde
la respuesta de un alta que el servidor ya procesó, el reintento puede dejar un
borrador repetido: el prototipo no usa claves de idempotencia y queda como riesgo
a resolver en la etapa con persistencia real.

La enmienda está implementada y probada de extremo a extremo: crea la versión
vigente y conserva la anterior con su texto original, la fecha del reemplazo y el
motivo declarado por la médica. Cada enmienda exige un motivo y una confirmación
explícita, y solo se enmienda lo finalizado. Si otra pestaña ya reemplazó la
versión revisada, el servidor responde conflicto sin sobrescribirla. La ficha
lista solo la versión vigente y ofrece el historial con enlaces a las versiones
reemplazadas. La corrección no cambia la cobertura registrada en esa visita
(`insuranceAtVisit`) y las versiones reemplazadas no vuelven a contarse en las
estadísticas. El histórico de consultas —incluidas las enmiendas— sigue siendo
interno: no se publica ni se descarga en el portal del paciente.

### 4.3 Publicación

1. Registrar indicaciones y/o adjuntar el PDF original de Digidoc.
2. Ver una vista previa de lo que recibirá el paciente.
3. Publicar explícitamente, confirmando paciente y documentos.
4. Registrar quién publicó, qué versión y cuándo.

No publicar por defecto documentos importados, análisis ni notas clínicas. Un
documento ya publicado no debe cambiar silenciosamente al editar su borrador.

#### Indicaciones activas

- Máximo dos por paciente: **una general** única para todo el consultorio y
  **una específica** propia de ese paciente. Puede haber menos si no se publicaron.
- La médica gestiona la general en un apartado separado «Indicación general».
  Se muestra a todos los pacientes autenticados, incluidos los que se incorporen
  después; no es contenido público anónimo ni una copia por ficha.
- La específica se prepara desde la ficha y nunca se comparte con otros pacientes.
- General y específica se leen completas en pantalla, con descarga opcional en
  texto UTF-8 en el prototipo. Las recetas PDF no consumen estos dos lugares.
- Publicar otra del mismo ámbito requiere vista previa y confirmación del
  reemplazo. La anterior queda inactiva en el historial profesional, con su
  contenido original y fecha de reemplazo; no se borra ni se modifica su texto.
- Solo la activa aparece y se descarga en el portal. Los enlaces de versiones
  reemplazadas dejan de funcionar incluso si la sesión del paciente sigue vigente.
- El servidor verifica la versión revisada (`expectedActiveId`): si cambió en otra
  pestaña, responde conflicto sin sobrescribirla ni crear otra indicación activa.
- La general requiere confirmar expresamente el alcance y que no contiene nombres,
  DNI, diagnósticos ni otros datos personales. No se puede publicar una receta
  como general ni convertir una específica en general enviando campos al servidor.

El retiro manual sin reemplazo y las correcciones de recetas se definirán aparte;
el reemplazo versionado de indicaciones ya forma parte del alcance.

### 4.4 Acceso autónomo del paciente

1. El paciente ingresa su DNI en el portal y solicita el código.
2. El servidor responde de forma genérica sin confirmar si el DNI existe.
3. Si corresponde, genera un código y solicita su envío por SMS al contacto
   verificado.
4. El paciente ingresa el código y el servidor lo valida y consume.
5. Se crea una sesión para ese paciente y se muestran sus publicaciones.
6. Al terminar los 20 minutos, debe autenticarse nuevamente.

No hay bandeja de aprobación, intervención humana ni botón de envío manual
necesario para que el paciente acceda. Esta decisión **reemplaza** el piloto
manual explorado al principio de la conversación.

**Canal del código (actualización del 20/10/2026).** El envío se hace por SMS
con Twilio y **reemplaza** la entrega por WhatsApp que figuraba antes en este
punto. Motivo: los requisitos de Meta (verificación de empresa y habilitación de
plantillas de autenticación, que exigen un volumen de conversaciones que un
consultorio de una sola médica no genera). Es una decisión **reversible**: la
aplicación sólo conoce el puerto `DeliverCode`, así que retomar WhatsApp es
cambiar el adaptador. El código sigue siendo de un solo uso y con vencimiento, y
el mensaje no lleva datos clínicos.

### 4.5 Importación de Word

- Asociar cada archivo al paciente correcto mediante revisión de la médica.
- Conservar el original, nombre de origen, fecha conocida del documento,
  momento de carga y procedencia. No inventar fechas desconocidas.
- Permitir varios documentos por paciente.
- Mantenerlos internos salvo un flujo explícito de entrega autorizado.
- Propuesta inicial: adjuntar una copia PDF para lectura web cómoda; no asumir
  conversión automática ni edición de Word dentro del navegador.
- La transcripción masiva, OCR y extracción automática no forman parte del
  alcance inicial. Cualquier texto extraído en el futuro requerirá revisión.
- La importación no habilita contactos históricos sin verificarlos ni debe
  disparar mensajes automáticamente.

### 4.6 Estadísticas mensuales profesionales

Se agrega «Estadísticas» a la navegación de la médica, con selector de mes y
acceso directo al mes actual. El servidor entrega agregados solo bajo sesión
profesional, sin listados de identidades ni datos clínicos.

- **Pacientes atendidos:** pacientes únicos con al menos una consulta finalizada
  cuya fecha clínica pertenezca al mes. No es el número de fichas creadas.
- **Consultas finalizadas:** todas las atenciones finalizadas del mes; las visitas
  repetidas del mismo paciente suman. Los borradores no se cuentan.
- **Recetas publicadas:** PDF de tipo receta publicados en el mes según la hora
  de La Rioja. No incluye indicaciones de texto ni recetas emitidas en Digidoc
  que no se hayan compartido en el portal; no equivale a prescripciones emitidas.
- **Obra social más atendida:** cobertura con más consultas finalizadas del mes.
  Mostrar todos los empates. Particular/sin obra social y cobertura no registrada
  aparecen en el desglose, pero no se presentan como una obra social líder.
- **Desglose:** consultas, pacientes únicos por cobertura y porcentaje de atenciones.
  Un mismo paciente puede figurar en más de una cobertura si cambió en el mes.

Se guarda la cobertura conocida por el servidor al finalizar la consulta; cambiar
la ficha después no reescribe ese dato. Sin snapshot histórico, informar «Sin
registrar»: no completar automáticamente desde la cobertura actual. La importación
de consultas históricas requerirá revisar la cobertura correspondiente; el
prototipo no reconstruye información que no conoce.

## 5. Reglas de acceso y tiempos

| Control | Línea base |
| --- | --- |
| Solicitud de código | Como máximo una cada 5 minutos por paciente, independientemente del navegador |
| Vencimiento del código | 10 minutos desde su generación |
| Intentos de validación | Hasta 5 por desafío; después queda invalidado |
| Consumo del código | Una sola vez, garantizado en el servidor ante concurrencia |
| Nuevo código | Invalida el anterior cuando se emite el reemplazo; evitar duplicados por reintento técnico |
| Sesión del paciente | 20 minutos absolutos desde autenticación; navegar no la renueva |
| Sesión de la médica | Vence después de 2 horas sin actividad válida |
| Actividad de la médica | Renueva el vencimiento de inactividad a 2 horas desde la última interacción válida |
| Máximo absoluto de la médica | Pendiente; se sugirieron 12 horas, no está fijado como requisito definitivo |

Los valores de código de 10 minutos y 5 intentos provienen de la propuesta de
seguridad utilizada como base; deben quedar explícitos en implementación y
pruebas. Los tiempos se verifican con reloj del servidor.

Buscar, abrir una ficha, leer con interacción reciente, escribir y guardar son
actividad. Los sondeos automáticos, la mera apertura de una pestaña o una tarea
en segundo plano no mantienen una sesión viva. Para escritura no enviada se
puede utilizar una señal limitada de actividad reciente, sin transmitir el
contenido escrito y sin reemplazar los controles del servidor.

## 6. Pantallas de partida

### Panel profesional

1. **Acceso:** autenticación y segundo factor, recuperación segura.
2. **Inicio:** buscador destacado por DNI o nombre, «Nuevo paciente» y pacientes
   recientes si se valida su utilidad. Sin bandeja de aprobaciones de acceso.
3. **Alta / datos del paciente:** DNI y WhatsApp como mínimo, después nombre,
   apellido y cobertura. Advertencias claras de duplicado o contacto no verificado.
4. **Ficha:** nombre y DNI siempre visibles, botón «Nueva consulta», consultas
   por fecha, documentos internos y publicaciones.
5. **Consulta:** formulario vertical, guardado de borrador y finalización.
6. **Indicaciones y Recetas:** sección de la ficha con acción «Añadir
   Indicación/Receta», vista previa y publicación.
7. **Estadísticas:** resumen y desglose mensual de atención, recetas publicadas y
   obras sociales, solo para la médica.
8. **Indicación general:** creación o nueva versión para todos, con confirmación
   de alcance, advertencia de privacidad e historial de versiones reemplazadas.

### Portal del paciente

1. Solicitud de código por DNI.
2. Ingreso de código, vencimiento y reintento sin revelar datos del registro.
3. Indicación general y específica propia expandidas en pantalla, con descarga
   opcional y diferenciación de ámbito. Recetas en una sección separada con acceso
   al PDF publicado.
4. Estados claros de sesión vencida, error de entrega o servicio no disponible,
   sin filtrar información ni prometer entrega garantizada.

### Usabilidad

- Español claro, formatos argentinos y zona horaria local.
- Fuente legible, contraste suficiente, botones grandes y etiquetas visibles.
- No depender solo de colores o íconos. Navegación de teclado y foco perceptible.
- Pocas acciones principales; no esconder funciones frecuentes en menús.
- Mostrar unidades, errores junto al campo y estado real de guardado.
- Advertir antes del vencimiento y antes de abandonar cambios sin guardar.
- Diseñar para computadora como uso profesional principal; portal usable desde
  el celular, sin instalar una aplicación.
- Probar con la médica tres recorridos: buscar/crear paciente, registrar una
  consulta y publicar una indicación o receta.

## 7. Alcance y exclusiones

### Incluido

- Una médica, pacientes adultos y ficha definida en esta línea base.
- Documentos previos, consultas nuevas y trazabilidad de correcciones.
- Indicaciones y PDF originales de Digidoc publicados al paciente.
- Acceso autónomo mediante código de un solo uso por SMS al contacto verificado,
  sesiones y permisos.
- Auditoría, respaldos y recuperación como requisitos de operación.
- Estadísticas mensuales profesionales según las definiciones de la sección 4.6.

### Fuera del alcance inicial

- Turnos, pagos, videollamadas, facturación y aplicación móvil nativa.
- Múltiples profesionales, menores, representantes y acceso de familiares.
- Emisión propia de recetas electrónicas o integración automática con Digidoc;
  no se ha confirmado disponibilidad de una API de Digidoc.
- Evolución longitudinal detallada, OCR, IA clínica y migración inteligente.
- Envío de historias o diagnósticos por WhatsApp.

## 8. Etapas y criterios de aceptación

### Etapa A — Prototipo de experiencia

- Datos completamente ficticios y sin conexiones a historias reales.
- Recorridos de la médica y del paciente navegables y comprensibles.
- Simulación de códigos claramente identificada y aislada de producción.
- Revisión con la médica antes de consolidar los formularios.

### Etapa B — Entrega del código al paciente

- Envío de prueba con el proveedor de SMS a un número de prueba propio.
- Documentar el límite de la cuenta de prueba de Twilio (sólo números
  verificados) y el precio por SMS a Argentina antes de abrir el acceso.
- No afirmar que recibir un SMS de ejemplo demuestra la disponibilidad 24 horas
  en producción.
- No modificar el WhatsApp habitual del consultorio ni introducir automatización
  no oficial (ver Etapa B de WhatsApp si se retoma).
- **Postergado:** viabilidad de WhatsApp (la entrega por Cloud API oficial con
  plantillas de autenticación) queda como etapa futura, no descartada del
  alcance. Si se retoma: envío de prueba con recursos oficiales de Meta a
  destinatarios habilitados, documentar restricciones de prueba y requisitos para
  plantillas de autenticación, sin afirmar que un mensaje de ejemplo demuestra
  habilitación de OTP para todos los pacientes.

### Etapa C — Núcleo funcional y seguridad

- Una solicitud pública no puede cambiar el teléfono ni seleccionar otro paciente.
- El código llega al contacto verificado sin intervención de la médica, en el
  entorno habilitado para esa prueba.
- Solicitudes simultáneas no eluden los 5 minutos ni permiten reutilizar códigos.
- El paciente A no accede a documentos, metadatos ni consultas del paciente B,
  aunque cambie URLs o identificadores.
- Los documentos internos o borradores nunca aparecen en la API del paciente.
- La sesión del paciente vence a los 20 minutos aunque siga navegando.
- La sesión profesional vence tras 2 horas inactiva y se renueva con actividad,
  pero no por sondeos de fondo; probar también límites temporales exactos.
- El cierre de sesión revoca el acceso en el servidor y protege los archivos.
- El vencimiento no publica ni finaliza borradores; el guardado muestra errores
  reales y los reintentos no duplican consultas.
- Las correcciones conservan el registro clínico original y su trazabilidad.
- Las indicaciones se leen completas en el portal sin solicitudes de descarga.
- También pueden descargarse opcionalmente; general y específica se distinguen
  claramente. Nunca se muestran más de dos indicaciones activas por paciente.
- El desplegable conserva coberturas personalizadas al guardar y volver a editar.
- El catálogo incluye todas las opciones solicitadas y búsqueda sin tildes o
  mayúsculas, con selección por teclado sin enviar accidentalmente la ficha.
- Un reemplazo conserva el historial, revoca la descarga previa y no altera la
  otra indicación, las recetas ni las específicas de otros pacientes.
- Dos publicaciones concurrentes o una revisión desactualizada no crean varias
  indicaciones activas del mismo ámbito. La general llega también a nuevos pacientes.
- Las estadísticas excluyen borradores, cuentan pacientes únicos y separan visitas
  repetidas, publicaciones y cambios de mes en la zona horaria de La Rioja.
- Pacientes y visitantes no acceden a las estadísticas profesionales; editar la
  cobertura de una ficha no modifica una consulta ya finalizada.
- Enmendar una consulta finalizada exige un motivo, conserva la versión anterior
  con su texto, rechaza reenviar una versión ya reemplazada y no duplica el
  registro visible ni la estadística del mes.

### Etapa D — Habilitación para datos reales

- Revisar la lista de salida a producción de `SEGURIDAD.md`.
- Definir y probar recuperación de cuenta, cambio de teléfono y entrega de
  historia completa a pedido del paciente.
- Realizar una importación piloto revisada y una restauración comprobada.
- Resolver condiciones legales, contratos, costos y contingencias.

## 9. Decisiones pendientes

1. Nombre del producto, dominio y titularidad de cuentas y facturación.
2. Cantidad de pacientes, volumen de Word/PDF y ritmo de consultas.
3. Mecanismo de verificación de contacto, números compartidos y recuperación.
4. Método concreto de segundo factor y biblioteca de autenticación compatible
   con Workers, sin rebajar controles para entrar en una cuota gratuita.
5. Viabilidad de Cloud API, plantilla de autenticación, elegibilidad de
   coexistencia y costos; pruebas no equivalen a habilitación definitiva.
6. Máximo absoluto profesional, gestión de sesiones simultáneas y políticas
   precisas de publicación/retiro y obligatoriedad de campos clínicos.
7. Formatos Word aceptados (`.doc`, `.docx`), tamaño máximo y tratamiento de
   archivos con macros o contenido activo.
8. Conservación, respaldos independientes, objetivos de recuperación y
   procedimiento de entrega de historia clínica completa.
9. Validación legal aplicable en Argentina y La Rioja, alojamiento y
   transferencias internacionales antes de usar datos reales.
