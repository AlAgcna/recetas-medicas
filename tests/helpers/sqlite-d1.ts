import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FileBucket, SqlDatabase, SqlResult, SqlStatement, SqlValue } from '../../src/server/d1/database';
import { createD1Storage } from '../../src/server/d1/storage';
import type { Storage } from '../../src/server/storage/port';

// Doble de D1 sobre SQLite real (node:sqlite), exclusivo de las pruebas.
// Aplica las mismas migraciones que se revisan a mano para D1 y expone sólo la
// parte de la interfaz que usa el portal. No hay conexión con Cloudflare.

function statementsOf(sql: string) {
  return sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
    .split(';').map(part => part.trim()).filter(Boolean);
}

export function migratedDatabase() {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  const directory = join(process.cwd(), 'db', 'migrations');
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of statementsOf(readFileSync(join(directory, file), 'utf8'))) database.exec(statement);
  }
  return database;
}

export function sqliteD1(database: DatabaseSync): SqlDatabase {
  return {
    prepare(query) {
      const values: SqlValue[] = [];
      const statement: SqlStatement = {
        bind(...bound) { values.push(...bound); return statement; },
        async first<T = Record<string, unknown>>() {
          return (database.prepare(query).get(...values) ?? null) as T | null;
        },
        async all<T = Record<string, unknown>>() {
          const results = database.prepare(query).all(...values) as T[];
          return { results, success: true, meta: { changes: 0 } } satisfies SqlResult<T>;
        },
        async run() {
          const result = database.prepare(query).run(...values);
          return { results: [], success: true, meta: { changes: Number(result.changes) } } satisfies SqlResult<never>;
        },
      };
      return statement;
    },
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results: SqlResult<unknown>[] = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export type MemoryBucket = FileBucket & { objects: Map<string, Uint8Array<ArrayBuffer>> };

export function memoryBucket(): MemoryBucket {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    objects,
    async put(key, value) { objects.set(key, value.slice()); },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return { async arrayBuffer() { return bytes.slice().buffer as ArrayBuffer; } };
    },
    async delete(key) { objects.delete(key); },
  };
}

export function d1Storage() {
  const database = migratedDatabase();
  const bucket = memoryBucket();
  return { database, bucket, storage: createD1Storage(sqliteD1(database), bucket) satisfies Storage };
}
