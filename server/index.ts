// Servidor de HeroBall: sirve la app compilada (dist/) y las conexiones WebSocket.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { TICK_MS } from '../shared/config';
import { MAX_MESSAGE_BYTES, ServerMsg } from '../shared/protocol';
import { Client, Lobby } from './room';
import { createHandler } from './handler';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');

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

const lobby = new Lobby();

const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: lobby.rooms.size }));
    return;
  }
  if (url.pathname === '/api/rooms') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(lobby.list()));
    return;
  }
  if (!existsSync(ROOT)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Falta compilar el cliente: ejecutá "npm run build" (o usá "npm run dev" y abrí http://localhost:5173).');
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
  const h = createHandler(lobby, client, { onAbuse: () => ws.close(1008, 'demasiados mensajes inválidos') });
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
