# Portal clínico — línea base

Aplicación web para una médica que atiende pacientes adultos en La Rioja,
Argentina. Centraliza el registro clínico y permite que cada paciente consulte
sus indicaciones y recetas publicadas mediante DNI y un código de un solo uso
enviado automáticamente a su WhatsApp verificado.

## Estado

Línea base v0.3 y prototipo local con datos ficticios. Permite recorrer
el panel profesional, fichas, consultas, publicaciones y estadísticas mensuales.
El portal usa códigos simulados, indicaciones legibles en pantalla con descarga
opcional y recetas PDF. Hay una general activa para todos y una específica por
paciente; los reemplazos conservan historial. Obra social permite buscar en el
catálogo solicitado o elegir «Otra».
Los datos del prototipo se mantienen solo en memoria y se pierden al
reiniciar. Existen la base D1 `dranallim` y el bucket R2 `recetas` con sus
bindings declarados, pero todavía vacíos y sin migración remota, porque la
entrada desplegada sigue cerrada. El ingreso de la médica por enlace de un solo
uso ya existe en el servidor y en sus pruebas, pero todavía no está montado en
producción; no hay integración con WhatsApp. **No usar con historias reales.**

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
- Códigos al paciente: WhatsApp Business Platform / Cloud API.
- Recetas: PDF original emitido en Digidoc; el portal no emite recetas propias.
- Repositorio previsto: GitHub privado, administrado manualmente por el usuario.

## Próximos pasos

1. Revisar el prototipo navegable con la médica y resolver los pendientes prioritarios.
2. Ajustar formularios y experiencia según esa prueba.
3. Validar el envío automático con el entorno de pruebas oficial de Meta, sin
   alterar el número que utiliza actualmente el consultorio. Las URLs que pide
   Meta en la revisión se publican en el portal: política de privacidad en
   `/privacidad`, condiciones del servicio en `/condiciones` e instrucciones de
   eliminación de datos en `/eliminacion-de-datos` (ver
   [Desarrollo local](docs/DESARROLLO.md)).
4. Implementar y probar el núcleo funcional y de seguridad.
5. Validar requisitos legales, respaldos, recuperación y operación antes de
   incorporar historias reales o habilitar pacientes.

## Restricción expresa del usuario

**No ejecutar `git add`, `git commit` ni `git push`, ni operaciones equivalentes
por herramientas, scripts o APIs.** El usuario realizará esas acciones a mano.
Crear esta documentación no autoriza a inicializar Git, crear un repositorio
remoto, desplegar servicios ni contratar recursos.
