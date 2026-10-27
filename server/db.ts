// Acceso a PostgreSQL: pool, transacciones y migraciones SQL versionadas.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export const MIGRATIONS_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'migrations');

export function createPool(url: string): Db {
  // BIGINT como número: los saldos están acotados muy por debajo de 2^53
  pg.types.setTypeParser(20, (v) => Number(v));
  return new pg.Pool({ connectionString: url, max: 10 });
}

/** Ejecuta `fn` dentro de una transacción; revierte ante cualquier error. */
export async function tx<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Aplica en orden los archivos migrations/NNNN_*.sql que falten. Todo corre en
 * una transacción con un candado, así dos procesos no migran a la vez.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR, log: (m: string) => void = () => {}): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const applied: string[] = [];
  await tx(db, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(424242)');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
    for (const f of files) {
      if (done.has(f)) continue;
      await c.query(readFileSync(join(dir, f), 'utf8'));
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      applied.push(f);
      log(`migración aplicada: ${f}`);
    }
  });
  return applied;
}
