import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const assets = await readdir('dist/assets');
const scripts = await Promise.all(assets.filter(file => file.endsWith('.js')).map(file => readFile(join('dist/assets', file), 'utf8')));
const forbidden = ['/api/demo/', 'Antecedentes de ejemplo.docx', 'Entrar a la demostración', 'Simulación de WhatsApp'];
for (const marker of forbidden) {
  if (scripts.some(script => script.includes(marker))) throw new Error('El build contiene módulos del prototipo. No publicar.');
}
if (!scripts.some(script => script.includes('Servicio todavía no habilitado'))) throw new Error('Falta la pantalla de bloqueo de producción.');
console.info('Build verificado: sin endpoints ni pantallas de simulación; producción permanece bloqueada.');
