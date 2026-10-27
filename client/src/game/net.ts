// Conexión WebSocket con el servidor. Los snapshots van directo a la sesión
// de juego (sin pasar por React); la interfaz sólo escucha sala, chat y estado.
import { PROTOCOL_VERSION, type ClientMsg, type RoomInfo, type RoomSummary, type ServerMsg } from '../../../shared/protocol';
import type { GameEvent, GameState, Side } from '../../../shared/types';

export type ConnStatus = 'connecting' | 'open' | 'closed';

export interface ChatLine {
  id: number;
  from: string | null;
  nick: string;
  text: string;
  team?: Side;
}

type Listener = () => void;

export interface SnapshotSink {
  onSnapshot(state: GameState, ack: number, events: GameEvent[]): void;
  onNoGame(): void;
}

let chatId = 0;

export class NetClient {
  ws: WebSocket | null = null;
  status: ConnStatus = 'closed';
  id = '';
  nick = '';
  room: RoomInfo | null = null;
  rooms: RoomSummary[] | null = null;
  chat: ChatLine[] = [];
  error: string | null = null;
  ping = 0;
  /** Latencia artificial (ms, sólo para pruebas) aplicada a envío y recepción. */
  fakeLag = 0;
  sink: SnapshotSink | null = null;
  private listeners = new Set<Listener>();
  private pingTimer = 0;
  private pendingJoin: string | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  connect(nick: string, joinRoom?: string): void {
    this.nick = nick;
    this.pendingJoin = joinRoom ?? null;
    if (this.ws && this.status !== 'closed') {
      this.send({ t: 'hello', nick, v: PROTOCOL_VERSION });
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.status = 'connecting';
    this.emit();
    ws.onopen = () => {
      this.status = 'open';
      this.error = null;
      this.send({ t: 'hello', nick, v: PROTOCOL_VERSION });
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: performance.now(), r: Math.round(this.ping) }), 2000);
      this.emit();
    };
    ws.onclose = () => {
      this.status = 'closed';
      this.room = null;
      window.clearInterval(this.pingTimer);
      this.sink?.onNoGame();
      this.emit();
    };
    ws.onerror = () => {
      this.error = 'No se pudo conectar con el servidor.';
      this.emit();
    };
    ws.onmessage = (ev) => {
      const data = ev.data as string;
      if (this.fakeLag > 0) setTimeout(() => this.handle(data), this.fakeLag);
      else this.handle(data);
    };
  }

  disconnect(): void {
    this.ws?.close();
  }

  send(m: ClientMsg): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const raw = JSON.stringify(m);
    if (this.fakeLag > 0) setTimeout(() => ws.readyState === WebSocket.OPEN && ws.send(raw), this.fakeLag);
    else ws.send(raw);
  }

  private handle(data: string): void {
    let m: ServerMsg;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        this.send({ t: 'list' });
        if (this.pendingJoin) {
          this.send({ t: 'join', room: this.pendingJoin });
          this.pendingJoin = null;
        }
        break;
      case 'rooms':
        this.rooms = m.rooms;
        break;
      case 'room':
        if (!this.room || this.room.id !== m.room.id) this.chat = [];
        this.room = m.room;
        this.error = null;
        break;
      case 'left':
        this.room = null;
        this.sink?.onNoGame();
        if (m.reason) this.error = m.reason;
        this.send({ t: 'list' });
        break;
      case 'chat':
        this.chat = [...this.chat.slice(-80), { id: ++chatId, from: m.from, nick: m.nick, text: m.text, team: m.team }];
        break;
      case 'snap':
        this.sink?.onSnapshot(m.state, m.ack, m.ev);
        return; // no notificar a React por cada snapshot
      case 'nogame':
        this.sink?.onNoGame();
        return;
      case 'pong': {
        const rtt = performance.now() - m.c;
        this.ping = this.ping === 0 ? rtt : this.ping * 0.7 + rtt * 0.3;
        break;
      }
      case 'error':
        this.error = m.msg;
        break;
    }
    this.emit();
  }
}

export const net = new NetClient();
