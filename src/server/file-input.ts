export class FileInputError extends Error {
  constructor(message: string, public status: 400 | 413 = 400) { super(message); }
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Límite sobre los bytes reales, no sólo sobre Content-Length. Se llama después
// de autenticar y antes de deserializar multipart.
export async function readFileForm(request: Request, maxBytes: number): Promise<FormData> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) throw new FileInputError('Adjuntá el archivo mediante el formulario.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new FileInputError('La carga supera el tamaño permitido.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try { return await new Response(data, { headers: { 'Content-Type': contentType } }).formData(); }
  catch { throw new FileInputError('No se pudo leer el formulario. Volvé a adjuntar el archivo.'); }
}
