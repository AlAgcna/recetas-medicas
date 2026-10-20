# Portal clínico — línea base

Aplicación web para una médica que atiende pacientes adultos en La Rioja,
Argentina. Centraliza el registro clínico y permite que cada paciente consulte
sus indicaciones y recetas publicadas mediante DNI y un código de un solo uso
enviado automáticamente por SMS a su número verificado.

## Estado

Línea base v0.4 y prototipo local con datos ficticios. Permite recorrer
el panel profesional, fichas, consultas, publicaciones y estadísticas mensuales.
El portal usa códigos simulados, indicaciones legibles en pantalla con descarga
opcional y recetas PDF. Hay una general activa para todos y una específica por
paciente; los reemplazos conservan historial. Obra social permite buscar en el
catálogo solicitado o elegir «Otra».
Los datos del prototipo se mantienen solo en memoria y se pierden al
reiniciar. La entrada de producción ya arma la aplicación real sobre D1 y R2, con
el ingreso de la médica por enlace de correo (Resend) y el del paciente por
código SMS (Twilio); existe la base D1 `dranallim` y el bucket R2 `recetas`. Para
quedar operativa faltan pasos que ejecuta el usuario: migrar la D1 remota y
cargar los secretos. Mientras falten secretos, el portal no finge un envío: el
ingreso de la médica responde 503 y el código del paciente, de forma genérica.
La cuenta de Twilio todavía está en modo gratuito, así que **el SMS no sirve para
pacientes reales**. **No usar con historias reales.**

Los pasos exactos de alta están en [Despliegue](docs/DESPLIEGUE.md).

## Probar en la computadora

Con Node.js 24.x:

```sh
npm ci
npm run dev
```

Abrir **http://127.0.0.1:5173**. El ingreso profesional es de demostración. Para
el portal, probar DNI `00000001` o `00000002` y consultar el buzón simulado.
El build de producción permanece bloqueado y no incluye las pantallas demo.
Ver [guía de desarrollo](docs/DESARROLLO.md) para límites y pruebas.

Si ya estaba abierto, reiniciar `npm run dev` para cargar cambios de la API
(el reinicio elimina los datos de prueba). Las estadísticas cuentan consultas
finalizadas y recetas **publicadas**; no recetas externas que no se hayan cargado.

## Documentación

| Archivo | Contenido |
| --- | --- |
| [Especificaciones](docs/LINEA_BASE.md) | Contexto, alcance, datos, pantallas, reglas y criterios de aceptación |
| [Arquitectura](docs/ARQUITECTURA.md) | Tecnologías, componentes, modelo conceptual e integraciones |
| [Seguridad](docs/SEGURIDAD.md) | Autenticación, sesiones, permisos, auditoría y condiciones para producción |
| [Desarrollo local](docs/DESARROLLO.md) | Arranque, recorridos de prueba, limitaciones y comandos de verificación |
| [Persistencia](docs/PERSISTENCIA.md) | Esquema D1, archivos en R2 y atomicidad; qué falta |
| [Instrucciones del proyecto](AGENTS.md) | Reglas de trabajo para asistentes |
| [Skill del proyecto](.opencode/skills/portal-clinico/SKILL.md) | Contexto y procedimiento reutilizable para desarrollar este sistema |

## Arquitectura de partida

- Interfaz: React, TypeScript y Vite.
- Servidor: TypeScript, Hono y Cloudflare Workers.
- Base de datos: Cloudflare D1, compatible con SQLite.
- Archivos: Cloudflare R2 privado.
- Autenticación web: sesiones revocables del lado del servidor y cookies seguras;
  JWT no es la opción inicial. Ingreso de la médica por enlace de un solo uso
  enviado a su correo (Resend), sin contraseña; ese factor único y la casilla
  como credencial principal están registrados en [Seguridad](docs/SEGURIDAD.md).
- Códigos al paciente: SMS con Twilio (`src/server/sms/`), detrás del mismo
  puerto que usaría WhatsApp. Decisión vigente y reversible; WhatsApp/Meta queda
  postergado por sus requisitos de habilitación.
- Recetas: PDF original emitido en Digidoc; el portal no emite recetas propias.
- Repositorio previsto: GitHub privado, administrado manualmente por el usuario.

## Próximos pasos

1. Ejecutar el alta descrita en [Despliegue](docs/DESPLIEGUE.md): migrar la D1
   remota, cargar los secretos, publicar y comprobar en producción.
2. Revisar el prototipo navegable con la médica y resolver los pendientes prioritarios.
3. Ajustar formularios y experiencia según esa prueba.
4. Probar la entrega real del SMS desde una cuenta de Twilio con upgrade a un
   móvil argentino, antes de abrir el acceso de pacientes. La cuenta de prueba
   sólo llega a números verificados por el titular, así que no sirve para
   pacientes reales. Las URLs públicas del portal son política de privacidad en
   `/privacidad`, condiciones del servicio en `/condiciones` e instrucciones de
   eliminación de datos en `/eliminacion-de-datos` (ver
   [Desarrollo local](docs/DESARROLLO.md)).
5. Validar requisitos legales, respaldos, recuperación y operación antes de
   incorporar historias reales o habilitar pacientes.

## Restricción expresa del usuario

**No ejecutar `git add`, `git commit` ni `git push`, ni operaciones equivalentes
por herramientas, scripts o APIs.** El usuario realizará esas acciones a mano.
Crear esta documentación no autoriza a inicializar Git, crear un repositorio
remoto, desplegar servicios ni contratar recursos.
