// PostgreSQL embebido para desarrollo y pruebas sin Docker (paquete
// embedded-postgres: binarios oficiales de PostgreSQL 17). En producción o con
// Docker se usa DATABASE_URL y este módulo no interviene.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { createPool, type Db } from '../server/db';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '.data');

export interface EmbeddedDb {
  url: string;
  pool: Db;
  stop: () => Promise<void>;
}

/**
 * Arranca (o reutiliza) un clúster en .data/<dir>. `fresh` borra los datos
 * antes de arrancar (pruebas). Crea la base "heroball".
 */
export async function startEmbedded(o: { port: number; dir: string; fresh?: boolean }): Promise<EmbeddedDb> {
  const dir = join(ROOT, o.dir);
  if (o.fresh && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  const isNew = !existsSync(join(dir, 'PG_VERSION'));
  if (isNew) mkdirSync(dir, { recursive: true });
  const server = new EmbeddedPostgres({ databaseDir: dir, user: 'heroball', password: 'heroball-local', port: o.port, persistent: true, onLog: () => {}, onError: () => {} });
  if (isNew) await server.initialise();
  await server.start();
  const admin = new pg.Client({ host: 'localhost', port: o.port, user: 'heroball', password: 'heroball-local', database: 'postgres' });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'heroball'");
  if (!exists.rowCount) await admin.query('CREATE DATABASE heroball');
  await admin.end();
  const url = `postgres://heroball:heroball-local@localhost:${o.port}/heroball`;
  const pool = createPool(url);
  return {
    url,
    pool,
    stop: async () => {
      await pool.end().catch(() => {});
      await server.stop();
    },
  };
}
