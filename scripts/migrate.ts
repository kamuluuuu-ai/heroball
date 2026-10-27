// Aplica las migraciones pendientes de migrations/ sobre DATABASE_URL.
//   npm run db:migrate
import { createPool, migrate } from '../server/db';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}
const db = createPool(process.env.DATABASE_URL);
try {
  const applied = await migrate(db, undefined, console.log);
  console.log(applied.length ? `${applied.length} migraciones aplicadas.` : 'La base ya estaba al día.');
} finally {
  await db.end();
}
