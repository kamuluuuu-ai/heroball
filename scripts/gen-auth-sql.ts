// Genera migrations/0001_auth.sql con el esquema que exige Better Auth,
// usando una base PostgreSQL vacía (embebida) para calcular las diferencias.
//   npx tsx scripts/gen-auth-sql.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMigrations } from 'better-auth/db/migration';
import { bearer } from 'better-auth/plugins';
import { MIGRATIONS_DIR } from '../server/db';
import { startEmbedded } from './embedded-db';

const pg = await startEmbedded({ port: 54331, dir: 'gen-auth' });
try {
  const { compileMigrations } = await getMigrations({
    database: pg.pool,
    emailAndPassword: { enabled: true },
    plugins: [bearer()],
  });
  const sql = await compileMigrations();
  const header = '-- Esquema de Better Auth 1.7.7 (usuarios, sesiones, cuentas y verificaciones).\n-- Generado con scripts/gen-auth-sql.ts; no editar a mano.\n\n';
  writeFileSync(join(MIGRATIONS_DIR, '0001_auth.sql'), header + sql.trim() + '\n');
  console.log(sql);
} finally {
  await pg.stop();
}
