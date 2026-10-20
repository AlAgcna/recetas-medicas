import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const assets = await readdir('dist/assets');
const scripts = await Promise.all(assets.filter(file => file.endsWith('.js')).map(file => readFile(join('dist/assets', file), 'utf8')));
const forbidden = ['/api/demo/', 'Antecedentes de ejemplo.docx', 'Entrar a la demostración', 'Simulación de WhatsApp'];
for (const marker of forbidden) {
  if (scripts.some(script => script.includes(marker))) throw new Error('El build contiene módulos del prototipo. No publicar.');
}
if (!scripts.some(script => script.includes('Servicio todavía no habilitado'))) throw new Error('Falta la pantalla de bloqueo de producción.');

// Páginas públicas que exige la revisión de la app de Meta: HTML plano, sin
// JavaScript, con el contacto del consultorio y enlazadas entre sí.
const publicPages = ['privacidad', 'condiciones', 'eliminacion-de-datos'];
for (const page of publicPages) {
  const html = await readFile(join('dist', `${page}.html`), 'utf8');
  if (html.includes('<script')) throw new Error(`La página /${page} no debe usar JavaScript.`);
  if (!html.includes('dranallim@gmail.com')) throw new Error(`La página /${page} no incluye el contacto del consultorio.`);
  for (const other of publicPages.filter(name => name !== page)) {
    if (!html.includes(`/${other}`)) throw new Error(`La página /${page} no enlaza a /${other}.`);
  }
}

console.info('Build verificado: sin endpoints ni pantallas de simulación; producción permanece bloqueada.');
