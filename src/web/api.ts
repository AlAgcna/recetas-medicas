export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Los objetos se serializan acá, una sola vez. No aceptar JSON ya serializado.
export async function api<T>(path: string, options: { method?: string; body?: Record<string, unknown> | FormData; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    const multipart = options.body instanceof FormData;
    response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: multipart ? { 'X-Portal-Request': '1' } : { 'Content-Type': 'application/json', 'X-Portal-Request': '1' },
      body: multipart ? options.body as FormData : options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('No se pudo conectar. Revisá la conexión y volvé a intentar; no se confirmó el guardado.', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.message ?? 'No se pudo completar la operación.', response.status);
  return data as T;
}

export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'No se pudo completar la operación.';
}
