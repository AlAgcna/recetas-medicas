import { pdfPolicy, type PdfMetadata } from '../shared/contracts';

export type StoredPdf = { bytes: Uint8Array<ArrayBuffer>; metadata: Readonly<PdfMetadata> };
export class PdfInputError extends Error {
  constructor(message: string, public status: 400 | 413 = 400) { super(message); }
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function preservePdf(bytes: Uint8Array<ArrayBuffer>, origin: PdfMetadata['origin']): Promise<StoredPdf> {
  if (bytes.length > pdfPolicy.maxFileBytes) throw new PdfInputError('El PDF supera el máximo de 5 MB.', 413);
  const header = new TextDecoder().decode(bytes.subarray(0, 12));
  const tail = new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 1024)));
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(header) || !/%%EOF\s*$/.test(tail)) {
    throw new PdfInputError('El archivo no tiene una estructura básica de PDF reconocible. Adjuntá el PDF original.');
  }
  // No parsear, imprimir, reconstruir, sellar ni agregar contraseñas al documento:
  // cualquier transformación podría invalidar una firma digital ya existente.
  const copy = bytes.slice();
  return { bytes: copy, metadata: Object.freeze({ sha256: await sha256(copy), size: copy.length, origin }) };
}

export async function pdfFromFile(file: File) {
  if (!/\.pdf$/i.test(file.name) || !['application/pdf', 'application/octet-stream', ''].includes(file.type.toLowerCase())) {
    throw new PdfInputError('Adjuntá un archivo PDF. Cambiar la extensión de otro archivo no lo convierte en PDF.');
  }
  if (file.size > pdfPolicy.maxFileBytes) throw new PdfInputError('El PDF supera el máximo de 5 MB.', 413);
  return preservePdf(new Uint8Array(await file.arrayBuffer()), 'uploaded');
}

export async function prescriptionForm(request: Request): Promise<FormData> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) throw new PdfInputError('Adjuntá el PDF mediante el formulario de recetas.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      // Medir los bytes reales, incluso si Content-Length es incorrecto o no existe.
      if (total > pdfPolicy.maxFormBytes) {
        await reader.cancel();
        throw new PdfInputError('La carga supera el tamaño permitido.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try { return await new Response(data, { headers: { 'Content-Type': contentType } }).formData(); }
  catch { throw new PdfInputError('No se pudo leer el formulario del PDF. Volvé a adjuntarlo.'); }
}
