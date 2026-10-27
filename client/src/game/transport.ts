// Transportes de red. En modo servidor: WebSocket contra el servidor Node.
// En modo web (GitHub Pages, sin servidor): el navegador que crea la sala corre
// la misma lógica autoritativa (Lobby/Room/handler) y los demás se conectan por
// WebRTC con PeerJS (señalización pública de peerjs.com).
import Peer, { type DataConnection } from 'peerjs';
import { TICK_MS } from '../../../shared/config';
import { createHandler } from '../../../server/handler';
import { Lobby, type Client } from '../../../server/room';

export interface Transport {
  send(raw: string): void;
  close(): void;
  onopen: () => void;
  onclose: (reason?: string) => void;
  onmessage: (raw: string) => void;
}

/** ¿Build para hosting estático (sin servidor)? */
export const P2P = import.meta.env.VITE_P2P === '1';

export function wsTransport(): Transport {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const t: Transport = {
    send: (raw) => ws.readyState === WebSocket.OPEN && ws.send(raw),
    close: () => ws.close(),
    onopen: () => {},
    onclose: () => {},
    onmessage: () => {},
  };
  ws.onopen = () => t.onopen();
  ws.onclose = () => t.onclose();
  ws.onmessage = (e) => t.onmessage(e.data as string);
  return t;
}

const PEER_PREFIX = 'heroball-';

function peerError(e: { type?: string }): string {
  switch (e.type) {
    case 'peer-unavailable': return 'La sala no existe o el anfitrión cerró la pestaña.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'No se pudo contactar el servicio de conexión (peerjs.com).';
    case 'browser-incompatible': return 'Este navegador no soporta WebRTC.';
    default: return 'Error de conexión.';
  }
}

/** Invitado: conexión WebRTC con el navegador anfitrión. */
export function peerGuestTransport(roomId: string): Transport {
  const peer = new Peer({ debug: 0 });
  let conn: DataConnection | null = null;
  let closed = false;
  const t: Transport = {
    send: (raw) => { if (conn?.open) void conn.send(raw); },
    close: () => { closed = true; peer.destroy(); },
    onopen: () => {},
    onclose: () => {},
    onmessage: () => {},
  };
  const fail = (reason: string) => {
    if (closed) return;
    closed = true;
    t.onclose(reason);
    peer.destroy();
  };
  peer.on('open', () => {
    conn = peer.connect(PEER_PREFIX + roomId, { reliable: true, serialization: 'raw' });
    conn.on('open', () => t.onopen());
    conn.on('data', (d) => t.onmessage(String(d)));
    conn.on('close', () => fail('El anfitrión cerró la sala o se desconectó.'));
    conn.on('error', () => fail('Se perdió la conexión con el anfitrión.'));
  });
  peer.on('error', (e) => fail(peerError(e)));
  return t;
}

/** Temporizador en un Worker: los navegadores lo estrangulan menos que setInterval en pestañas ocultas. */
function workerTimer(ms: number, fn: () => void): () => void {
  try {
    const src = `setInterval(() => postMessage(0), ${ms});`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = fn;
    return () => { w.terminate(); URL.revokeObjectURL(url); };
  } catch {
    const id = window.setInterval(fn, ms);
    return () => window.clearInterval(id);
  }
}

/**
 * Anfitrión en el navegador: corre una sala autoritativa y acepta invitados por
 * WebRTC. El propio anfitrión se conecta por un transporte en memoria.
 */
export class BrowserHost {
  readonly roomId: string;
  private peer: Peer;
  private lobby = new Lobby();
  private stopTimer: () => void = () => {};
  private counter = 0;
  private conns = new Set<DataConnection>();
  onfatal: (reason: string) => void = () => {};

  private constructor(roomId: string, peer: Peer) {
    this.roomId = roomId;
    this.peer = peer;
  }

  static start(): Promise<BrowserHost> {
    const roomId = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 5);
    const peer = new Peer(PEER_PREFIX + roomId, { debug: 0 });
    return new Promise((resolve, reject) => {
      peer.once('open', () => {
        const h = new BrowserHost(roomId, peer);
        h.listen();
        resolve(h);
      });
      peer.once('error', (e) => {
        peer.destroy();
        reject(new Error(peerError(e)));
      });
    });
  }

  private listen(): void {
    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.conns.add(conn);
        const client: Client = {
          id: 'p' + (++this.counter).toString(36),
          nick: '',
          room: null,
          ping: 0,
          send: (m) => { if (conn.open) void conn.send(typeof m === 'string' ? m : JSON.stringify(m)); },
        };
        const h = createHandler(this.lobby, client, { singleRoomId: this.roomId, onAbuse: () => conn.close() });
        conn.on('data', (d) => { if (typeof d === 'string') h.onMessage(d); });
        conn.on('close', () => { this.conns.delete(conn); h.onClose(); });
        conn.on('error', () => conn.close());
      });
    });
    // si se pierde el servicio de señalización, los invitados ya conectados siguen jugando
    this.peer.on('disconnected', () => { if (!this.peer.destroyed) this.peer.reconnect(); });
    this.peer.on('error', (e) => { if (e.type !== 'peer-unavailable') console.warn('peer', e.type); });
    // bucle de simulación de paso fijo, igual que el servidor Node
    let last = performance.now();
    let acc = 0;
    this.stopTimer = workerTimer(4, () => {
      const now = performance.now();
      acc = Math.min(250, acc + now - last);
      last = now;
      while (acc >= TICK_MS) {
        this.lobby.tickAll();
        acc -= TICK_MS;
      }
    });
  }

  /** Transporte en memoria para el propio anfitrión. */
  localTransport(): Transport {
    const client: Client = {
      id: 'p0',
      nick: '',
      room: null,
      ping: 0,
      send: (m) => {
        const raw = typeof m === 'string' ? m : JSON.stringify(m);
        queueMicrotask(() => t.onmessage(raw));
      },
    };
    const h = createHandler(this.lobby, client, { singleRoomId: this.roomId });
    const t: Transport = {
      send: (raw) => queueMicrotask(() => h.onMessage(raw)),
      close: () => { h.onClose(); this.destroy(); },
      onopen: () => {},
      onclose: () => {},
      onmessage: () => {},
    };
    queueMicrotask(() => t.onopen());
    return t;
  }

  destroy(): void {
    this.stopTimer();
    // aviso explícito: WebRTC no siempre notifica el cierre al otro lado
    const bye = JSON.stringify({ t: 'left', reason: 'El anfitrión cerró la sala.' });
    for (const c of this.conns) if (c.open) void c.send(bye);
    setTimeout(() => {
      for (const c of this.conns) c.close();
      this.peer.destroy();
    }, 300);
  }
}
