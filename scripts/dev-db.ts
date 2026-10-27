// PostgreSQL local sin Docker (binarios embebidos). Persiste en .data/dev.
//   npm run dev:db      → deja la base corriendo hasta Ctrl+C
// Con Docker: docker compose up -d (ver docker-compose.yml).
import { migrate } from '../server/db';
import { startEmbedded } from './embedded-db';

const port = Number(process.env.DEV_DB_PORT ?? 54329);
const pg = await startEmbedded({ port, dir: 'dev' });
await migrate(pg.pool, undefined, console.log);
console.log(`PostgreSQL local listo.\nDATABASE_URL=${pg.url}`);
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
