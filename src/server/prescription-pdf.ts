import { pdfPolicy, type PdfMetadata } from '../shared/contracts';
import { FileInputError, readFileForm, sha256 } from './file-input';
export { sha256 } from './file-input';

export type StoredPdf = { bytes: Uint8Array<ArrayBuffer>; metadata: Readonly<PdfMetadata> };
export class PdfInputError extends FileInputError {}

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
  try {
    return await readFileForm(request, pdfPolicy.maxFormBytes);
  } catch (error) {
    if (error instanceof FileInputError) throw new PdfInputError(error.message, error.status);
    throw error;
  }
}
