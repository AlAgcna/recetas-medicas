# Instrucciones para trabajar en este proyecto

## Contexto y documentación

- Este proyecto es un portal clínico para una sola médica, en La Rioja,
  Argentina, que atiende adultos.
- Antes de trabajar en funcionalidad, arquitectura, interfaz, pruebas,
  infraestructura o seguridad, cargar la skill `portal-clinico` disponible en
  `.opencode/skills/portal-clinico/SKILL.md`.
- Leer `docs/LINEA_BASE.md`, `docs/ARQUITECTURA.md` y `docs/SEGURIDAD.md` según el
  alcance del cambio. Distinguir acuerdos, propuestas y decisiones pendientes.
- Leer `docs/DESARROLLO.md` para ejecutar el prototipo y entender su aislamiento
  respecto de producción. El servidor demo solo escucha en loopback.
- Las instrucciones heredadas sobre el grafo de código siguen vigentes: cuando
  exista código, usar primero el grafo para acotar exploración o impacto y
  verificar siempre la implementación y las pruebas en los archivos. Un grafo
  vacío no demuestra ausencia de comportamiento.

## Restricciones del usuario

- **NO ejecutar `git add`, `git commit` ni `git push`.** Tampoco realizar staging,
  commits o publicaciones equivalentes mediante scripts, bibliotecas, GitHub CLI,
  MCP u otras APIs. El usuario lo hará manualmente.
- No inicializar Git ni crear repositorios remotos por iniciativa propia.
- No desplegar, activar facturación, registrar números, migrar el WhatsApp
  habitual ni crear recursos externos sin autorización explícita.
- No descartar ni sobrescribir trabajo ajeno. No ejecutar operaciones
  destructivas sin autorización específica.

## Límites funcionales y de seguridad

- El acceso del paciente es autónomo: no requiere aprobación ni envío manual
  por parte de la médica. El flujo manual discutido inicialmente quedó
  reemplazado por la integración oficial con WhatsApp Cloud API.
- Un DNI identifica; no autentica. Nunca entregar acceso solo con DNI ni enviar
  códigos a un número proporcionado libremente en la pantalla de acceso.
- El paciente ve únicamente sus indicaciones y recetas publicadas. Los permisos
  se aplican en el servidor; ocultar elementos visuales no los reemplaza.
- Indicaciones: una general para todos los pacientes autenticados y una específica
  propia como máximo, con lectura en pantalla y descarga opcional. Reemplazar
  conserva historial profesional y requiere confirmar la versión revisada.
- No incluir datos de una persona en la indicación general ni permitir recetas
  generales. Las versiones inactivas no se listan ni descargan en el portal.
- Prototipos, ejemplos, pruebas y capturas usan datos ficticios. No incorporar
  documentos clínicos, teléfonos reales, secretos ni bases reales al repositorio.
- Los códigos simulados son exclusivos del entorno de pruebas y deben quedar
  imposibilitados en producción. Nunca incluir un código maestro o bypass.
- No presentar límites de planes gratuitos, disponibilidad 24 horas o
  cumplimiento legal como garantías ya obtenidas.
- Para cambios de autenticación, sesiones, publicación o archivos, exigir
  pruebas de acceso cruzado entre pacientes, vencimiento y revocación.

## Forma de trabajo

- Mantener una sola aplicación y evitar complejidad no justificada.
- No desarrollar nuevas funciones fuera del alcance aprobado por iniciativa
  propia. Hay documentación y un prototipo local con datos en memoria; no hay
  infraestructura ni autenticación profesional productivas.
- No delegar a subagentes salvo pedido explícito del usuario o instrucciones
  aplicables que lo exijan.
- Redactar interfaz y documentación en español claro, adaptado a Argentina.
- Actualizar los documentos afectados si cambia una decisión aprobada. No
  convertir una propuesta o pendiente en requisito confirmado silenciosamente.
- Informar qué se cambió, qué se verificó y qué sigue pendiente; no afirmar
  ejecución de pruebas o integraciones que no se realizaron.
