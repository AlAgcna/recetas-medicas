import { unzipSync } from 'fflate';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { indicationImportPolicy, type IndicationImportPreview } from '../shared/contracts';
import { FileInputError, sha256 } from './file-input';
import type { IndicationOriginal } from './storage/port';

const wordNamespaces = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const mainType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

function parseXml(bytes: Uint8Array, onOpen: (tag: SaxesTagNS) => void, onText = (_text: string) => {}, onClose = (_tag: SaxesTagNS) => {}) {
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  parser.on('doctype', () => { throw new FileInputError('No se admiten declaraciones de entidades XML.'); });
  parser.on('opentag', tag => {
    if (++depth > 64) throw new FileInputError('El Word tiene una estructura demasiado compleja.');
    onOpen(tag);
  });
  parser.on('text', onText);
  parser.on('cdata', onText);
  parser.on('closetag', tag => { onClose(tag); depth--; });
  parser.write(xml).close();
}

export async function readIndicationDocx(file: File): Promise<{ original: IndicationOriginal; preview: IndicationImportPreview }> {
  if (!/\.docx$/i.test(file.name) || !['', docxType, 'application/octet-stream', 'application/zip'].includes(file.type.toLowerCase())) {
    throw new FileInputError('Adjuntá un Word .docx. No se admiten .doc, PDF, accesos directos ni archivos con macros.');
  }
  if (!file.size || file.size > indicationImportPolicy.maxFileBytes) throw new FileInputError('El Word debe tener contenido y no superar los 5 MB.', file.size ? 413 : 400);
  const originalName = file.name.split(/[\\/]/).at(-1)?.trim() ?? '';
  if (!originalName || originalName.length > 255 || /[\x00-\x1f\x7f]/.test(originalName)) throw new FileInputError('El nombre del archivo no es válido.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new FileInputError('El archivo no es un Word .docx reconocible.');
  let hasImages = false;
  try {
    let total = 0;
    const names = new Set<string>();
    const files = unzipSync(bytes, { filter: entry => {
      const name = entry.name.toLowerCase();
      if (names.has(name) || names.size >= 512 || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new FileInputError('El paquete Word tiene entradas inválidas o duplicadas.');
      names.add(name);
      total += entry.originalSize;
      if (total > 24 * 1024 * 1024) throw new FileInputError('El Word descomprimido supera el límite permitido.', 413);
      if (/vbaproject|activex|embeddings\/|\.(?:bin|exe|js|vbs|hta)$/.test(name)) throw new FileInputError('No se admiten macros ni objetos incrustados.');
      if (name.startsWith('word/media/')) hasImages = true;
      const read = name === '[content_types].xml' || name === 'word/document.xml' || name.endsWith('.rels');
      if (read && entry.originalSize > 1024 * 1024) throw new FileInputError('El XML del Word supera el límite permitido.', 413);
      return read;
    } });
    const types = files['[Content_Types].xml'];
    const document = files['word/document.xml'];
    if (!types || !document) throw new FileInputError('Faltan las partes necesarias de un Word .docx.');
    let validType = false;
    parseXml(types, tag => {
      const attrs = Object.values(tag.attributes);
      if (attrs.some(attr => /macroenabled|vba|activex|oleobject/i.test(attr.value))) throw new FileInputError('El documento contiene componentes activos no admitidos.');
      if (tag.local === 'Override' && attrs.some(attr => attr.local === 'PartName' && attr.value === '/word/document.xml')
        && attrs.some(attr => attr.local === 'ContentType' && attr.value === mainType)) validType = true;
    });
    if (!validType) throw new FileInputError('El tipo interno no corresponde a un Word .docx sin macros.');
    for (const [name, part] of Object.entries(files)) {
      if (!name.endsWith('.rels')) continue;
      parseXml(part, tag => {
        if (Object.values(tag.attributes).some(attr => attr.local === 'TargetMode' && attr.value.toLowerCase() === 'external')) {
          throw new FileInputError('El Word contiene vínculos externos. Quitalos del documento antes de importarlo.');
        }
      });
    }
    let inText = false;
    let isDocument = false;
    let text = '';
    parseXml(document, tag => {
      if (!wordNamespaces.has(tag.uri)) return;
      if (tag.local === 'document') isDocument = true;
      if (['ins', 'del', 'altChunk', 'object'].includes(tag.local)) throw new FileInputError('El Word contiene revisiones u objetos no admitidos. Aceptá los cambios y quitá los objetos antes de importarlo.');
      if (tag.local === 't') inText = true;
      if (['tab', 'br', 'cr'].includes(tag.local)) text += tag.local === 'tab' ? '\t' : '\n';
    }, value => { if (inText) text += value; }, tag => {
      if (!wordNamespaces.has(tag.uri)) return;
      if (tag.local === 't') inText = false;
      if (tag.local === 'p') text += '\n';
    });
    const content = text.replace(/\n{3,}/g, '\n\n').trim();
    if (!isDocument || !content) throw new FileInputError('El Word no tiene texto extraíble. No se realiza OCR de imágenes.');
    if (content.length > 5000) throw new FileInputError('El texto supera los 5000 caracteres admitidos. Separá las indicaciones en documentos más cortos.');
    const hash = await sha256(bytes);
    return { original: { bytes, size: bytes.length, sha256: hash, originalName },
      preview: { content, sha256: hash, originalName, hasImages } };
  } catch (error) {
    if (error instanceof FileInputError) throw error;
    throw new FileInputError('No se pudo leer el Word. Verificá que sea un .docx válido, sin contraseña.');
  }
}
