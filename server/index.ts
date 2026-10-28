// Servidor de HeroBall: sirve la app compilada (dist/), las conexiones
// WebSocket y, si hay DATABASE_URL, las cuentas, la economía y las partidas
// oficiales. Sin base de datos funciona igual que antes (sólo casual).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { TICK_MS } from '../shared/config';
import { MAX_MESSAGE_BYTES, ServerMsg, type AccountInfo } from '../shared/protocol';
import { applyCors, createApi } from './api';
import { bearerHeaders, createAuth, sessionUser } from './auth';
import { createPool, migrate } from './db';
import { Economy } from './economy';
import { createHandler } from './handler';
import { createMailer } from './mail';
import { Client, Lobby } from './room';

const env = process.env;
const PORT = Number(env.PORT ?? 3001);
const HOST = env.HOST ?? '0.0.0.0';
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
/** Orígenes del frontend (GitHub Pages, Vite en local). */
const ORIGINS = (env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:3001').split(',').map((s) => s.trim()).filter(Boolean);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

// commit desplegado (Render lo define solo); sirve para comprobar que el backend está al día
const VERSION = (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'local').slice(0, 7);

function fail(msg: string): never {
  console.error(`Configuración inválida: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- economía (opcional)
let economy: Economy | null = null;
let api: ReturnType<typeof createApi> | null = null;
let identify: ((token: string) => Promise<AccountInfo | null>) | undefined;

if (env.DATABASE_URL) {
  const secret = env.BETTER_AUTH_SECRET ?? '';
  if (secret.length < 32) fail('BETTER_AUTH_SECRET debe tener al menos 32 caracteres aleatorios.');
  // en Render, RENDER_EXTERNAL_URL trae la URL pública del servicio
  const baseURL = env.PUBLIC_API_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  const db = createPool(env.DATABASE_URL);
  if (env.MIGRATE_ON_START !== '0') await migrate(db, undefined, console.log);
  const mailer = createMailer(env.SMTP_URL, env.MAIL_FROM ?? 'HeroBall <no-reply@localhost>');
  const auth = createAuth({ db, baseURL, secret, trustedOrigins: ORIGINS, sendResetLink: mailer });
  economy = new Economy(db, {
    adminCoins: Number(env.ADMIN_MAX_COINS ?? 100_000),
    adminChests: Number(env.ADMIN_MAX_CHESTS ?? 100),
  });
  api = createApi({
    auth, economy, origins: ORIGINS, moderatorSigningKey: env.MODERATOR_SIGNING_KEY || undefined,
    // tras asignar o retirar un secreto, las salas releen la colección de esa cuenta
    onHeroesChanged: (userId) => void lobby.refreshOwned(userId).catch((e) => console.error('No se pudo releer la colección', userId, e)),
  });
  const eco = economy;
  identify = async (token) => {
    const u = await sessionUser(auth, bearerHeaders(token));
    if (!u) return null;
    await eco.ensureAccount(u.id);
    return { userId: u.id, name: u.name, roles: await eco.roles(u.id) };
  };
  console.log(`Cuentas y economía activas (API pública: ${baseURL}; orígenes: ${ORIGINS.join(', ')}).`);
  if (!env.SMTP_URL) console.log('Aviso: sin SMTP_URL los enlaces de recuperación de contraseña se escriben en esta consola.');
} else {
  console.log('Sin DATABASE_URL: sólo partidas casuales (sin cuentas, economía ni partidas oficiales).');
}

const lobby = new Lobby(economy?.adapter() ?? null);

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/api/health' || url.pathname === '/api/rooms') {
    if (applyCors(req, res, ORIGINS)) return;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(url.pathname === '/api/health' ? { ok: true, rooms: lobby.rooms.size, economy: !!economy, version: VERSION } : lobby.list()));
    return;
  }
  if (api && (await api(req, res))) return;
  if (url.pathname.startsWith('/api/')) {
    if (applyCors(req, res, ORIGINS)) return;
    res.writeHead(economy ? 404 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: economy ? 'not_found' : 'no_economy', message: economy ? 'Ruta inexistente.' : 'Este servidor no tiene cuentas ni economía activas.' }));
    return;
  }
  if (!existsSync(ROOT)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Servidor de HeroBall: API en /api y salas en /ws. Para servir también el juego desde acá, compilá el cliente con "npm run build" (en local: "npm run dev" y abrí http://localhost:5173).');
    return;
  }
  let file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, 'index.html');
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': file.includes('assets') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });
let clientCounter = 0;

wss.on('connection', (ws: WebSocket) => {
  const client: Client = {
    id: 'p' + (++clientCounter).toString(36),
    nick: '',
    room: null,
    ping: 0,
    send(msg: ServerMsg | string) {
      if (ws.readyState === WebSocket.OPEN) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    },
  };
  const h = createHandler(lobby, client, { onAbuse: () => ws.close(1008, 'demasiados mensajes inválidos'), identify });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    h.onMessage(data.toString());
  });
  ws.on('close', h.onClose);
});

// Bucle de simulación de paso fijo con acumulador (independiente de la
// resolución del temporizador del sistema).
let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += now - last;
  last = now;
  if (acc > 250) acc = 250; // evitar espiral tras una pausa larga
  while (acc >= TICK_MS) {
    lobby.tickAll();
    acc -= TICK_MS;
  }
}, 4);

http.listen(PORT, HOST, () => {
  console.log(`HeroBall servidor escuchando en http://localhost:${PORT} (WebSocket en /ws)`);
  if (!existsSync(ROOT)) console.log('Aviso: no existe dist/. En desarrollo abrí http://localhost:5173');
});
