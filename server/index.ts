// Servidor de HeroBall: sirve la app compilada (dist/) y las conexiones WebSocket.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { TICK_MS } from '../shared/config';
import { MAX_MESSAGE_BYTES, MAX_NICK, PROTOCOL_VERSION, ServerMsg, cleanText, parseClientMessage } from '../shared/protocol';
import { Client, Lobby } from './room';
import { RateLimiter } from './rate';

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
  // límites de frecuencia por tipo de mensaje
  const inputRate = new RateLimiter(90, 40);
  const chatRate = new RateLimiter(1.5, 4);
  const ctrlRate = new RateLimiter(8, 16);
  let strikes = 0;
  const reject = (msg?: string) => {
    if (msg) client.send({ t: 'error', msg });
    if (++strikes > 200) ws.close(1008, 'demasiados mensajes inválidos');
  };

  ws.on('message', (data, isBinary) => {
    if (isBinary) return reject();
    const m = parseClientMessage(data.toString());
    if (!m) return reject();
    if (m.t === 'in') {
      if (!inputRate.take()) return;
      client.room?.pushInput(client.id, m.s, m.b);
      return;
    }
    if (m.t === 'ping') {
      if (m.r !== undefined) client.ping = m.r;
      client.send({ t: 'pong', c: m.c });
      return;
    }
    if (m.t === 'chat') {
      if (!chatRate.take()) return reject('Estás enviando mensajes muy rápido.');
      client.room?.chat(client.id, m.text);
      return;
    }
    if (!ctrlRate.take()) return reject('Demasiadas acciones seguidas.');
    if (m.t === 'hello') {
      const nick = cleanText(m.nick, MAX_NICK);
      if (!nick) return reject('Apodo inválido.');
      client.nick = nick;
      client.send({ t: 'welcome', id: client.id, v: PROTOCOL_VERSION });
      return;
    }
    if (!client.nick) return reject('Primero elegí un apodo.');
    const room = client.room;
    let err: string | null = null;
    switch (m.t) {
      case 'list':
        client.send({ t: 'rooms', rooms: lobby.list() });
        return;
      case 'create': {
        room?.leave(client.id);
        const r = lobby.create(m.name, m.settings);
        err = r.join(client);
        break;
      }
      case 'join': {
        const r = lobby.rooms.get(m.room);
        if (!r) return reject('La sala no existe o ya se cerró.');
        if (r === room) return;
        room?.leave(client.id);
        err = r.join(client);
        break;
      }
      case 'leave':
        room?.leave(client.id);
        client.send({ t: 'left' });
        return;
    }
    if (!room) {
      if (err) reject(err);
      return;
    }
    switch (m.t) {
      case 'side': err = room.setSide(client.id, m.side, m.target); break;
      case 'hero': room.setHero(client.id, m.hero); break;
      case 'settings': err = room.setSettings(client.id, m.settings); break;
      case 'start': err = room.start(client.id); break;
      case 'stop': err = room.stop(client.id); break;
      case 'pause': err = room.pause(client.id); break;
      case 'restart': err = room.restart(client.id); break;
      case 'addbot': err = room.addBot(client.id, m.side); break;
      case 'kick': err = room.kickMember(client.id, m.target); break;
    }
    if (err) reject(err);
  });

  ws.on('close', () => {
    client.room?.leave(client.id);
  });
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
