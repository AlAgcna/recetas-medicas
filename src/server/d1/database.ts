// Tipos estructurales mínimos de D1 y R2.
//
// El portal no depende del paquete de tipos de Cloudflare: describe sólo el
// subconjunto que usa, de modo que el mismo código corre contra D1 en un Worker
// y contra SQLite real en las pruebas locales (tests/helpers/sqlite-d1.ts).
// Una firma de estos tipos es satisfecha por la interfaz real de D1/R2.

export type SqlValue = string | number | null;

export type SqlResult<T> = {
  results: T[];
  success: boolean;
  meta: { changes: number };
};

export type SqlStatement = {
  bind(...values: SqlValue[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run(): Promise<SqlResult<never>>;
};

export type SqlDatabase = {
  prepare(query: string): SqlStatement;
  /** Transacción todo o nada: si una sentencia falla, revierte las anteriores. */
  batch(statements: SqlStatement[]): Promise<SqlResult<unknown>[]>;
};

/** Objeto privado en R2. Sólo el servidor lo lee, después de autorizar. */
export type FileBucket = {
  put(key: string, value: Uint8Array<ArrayBuffer>): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<unknown>;
};
