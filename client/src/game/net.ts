// Conexión con la sala (servidor Node por WebSocket, o anfitrión en navegador
// por WebRTC). Los snapshots van directo a la sesión de juego (sin pasar por
// React); la interfaz sólo escucha sala, chat y estado.
import { signAdmin } from '../../../shared/admin';
import { PROTOCOL_VERSION, type AdminState, type ClientMsg, type RoomInfo, type RoomSettings, type RoomSummary, type ServerMsg } from '../../../shared/protocol';
import type { GameEvent, GameState, Side } from '../../../shared/types';
import { BrowserHost, P2P, peerGuestTransport, wsTransport, type Transport } from './transport';

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
  /** true en el build web: sin servidor central, salas alojadas en el navegador. */
  readonly p2p = P2P;
  private transport: Transport | null = null;
  private host: BrowserHost | null = null;
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
  /** Clave privada de administrador (base64), si el usuario la cargó. */
  adminKey = '';
  /** Verificado como administrador en esta conexión. */
  isAdmin = false;
  adminError: string | null = null;
  adminState: AdminState | null = null;
  private nonce = '';
  private listeners = new Set<Listener>();
  private pingTimer = 0;
  private lastMsgAt = 0;
  private pendingJoin: string | null = null;
  private pendingCreate: { name: string; settings: Partial<RoomSettings> } | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** ¿Está conectado a una sala o servidor (no sólo en el lobby web)? */
  get linked(): boolean {
    return this.transport !== null;
  }

  connect(nick: string, joinRoom?: string): void {
    this.nick = nick;
    if (this.transport && this.status !== 'closed') {
      this.send({ t: 'hello', nick, v: PROTOCOL_VERSION });
      if (joinRoom) this.send({ t: 'join', room: joinRoom });
      return;
    }
    if (this.p2p) {
      if (joinRoom) {
        this.pendingJoin = joinRoom;
        this.attach(peerGuestTransport(joinRoom));
      } else {
        // lobby web: sin servidor al que conectarse todavía
        this.status = 'open';
        this.rooms = [];
        this.emit();
      }
      return;
    }
    this.pendingJoin = joinRoom ?? null;
    this.attach(wsTransport());
  }

  private attach(t: Transport): void {
    this.transport = t;
    this.status = 'connecting';
    this.emit();
    t.onopen = () => {
      this.status = 'open';
      this.error = null;
      this.ping = 0;
      this.send({ t: 'hello', nick: this.nick, v: PROTOCOL_VERSION });
      window.clearInterval(this.pingTimer);
      this.lastMsgAt = performance.now();
      this.pingTimer = window.setInterval(() => {
        // modo web: si el anfitrión desapareció sin avisar, volver al lobby
        if (this.p2p && !this.host && performance.now() - this.lastMsgAt > 8000) {
          t.onclose('Se perdió la conexión con el anfitrión.');
          t.close();
          return;
        }
        this.send({ t: 'ping', c: performance.now(), r: Math.round(this.ping) });
      }, 2000);
      this.emit();
    };
    t.onclose = (reason) => {
      if (this.transport !== t) return;
      this.detach();
      if (reason) this.error = reason;
      this.emit();
    };
    t.onmessage = (data) => {
      if (this.fakeLag > 0) setTimeout(() => this.handle(data), this.fakeLag);
      else this.handle(data);
    };
  }

  /** Firma el desafío de esta conexión con la clave de administrador. */
  private proveAdmin(): void {
    if (!this.adminKey || !this.nonce || this.isAdmin) return;
    const t = this.transport;
    signAdmin(this.adminKey, this.nonce, this.id)
      .then((sig) => { if (this.transport === t) this.send({ t: 'admin', sig }); })
      .catch(() => {
        this.adminError = 'La clave de administrador no tiene un formato válido.';
        this.emit();
      });
  }

  setAdminKey(key: string): void {
    this.adminKey = key.trim();
    this.adminError = null;
    if (!this.adminKey) {
      this.emit();
      return;
    }
    this.proveAdmin();
  }

  private detach(): void {
    window.clearInterval(this.pingTimer);
    this.isAdmin = false;
    this.adminState = null;
    this.nonce = '';
    this.transport = null;
    this.host = null;
    this.room = null;
    this.sink?.onNoGame();
    // en modo web el lobby sigue disponible sin conexión
    this.status = this.p2p ? 'open' : 'closed';
    if (this.p2p) this.rooms = [];
  }

  /** Crear sala: en el servidor, o alojándola en este navegador (modo web). */
  createRoom(name: string, settings: Partial<RoomSettings>): void {
    if (!this.p2p) {
      this.send({ t: 'create', name, settings });
      return;
    }
    this.status = 'connecting';
    this.error = null;
    this.emit();
    BrowserHost.start()
      .then((host) => {
        this.host = host;
        this.pendingCreate = { name, settings };
        this.attach(host.localTransport());
      })
      .catch((e: Error) => {
        this.status = 'open';
        this.error = e.message;
        this.emit();
      });
  }

  leaveRoom(): void {
    if (!this.p2p) {
      this.send({ t: 'leave' });
      return;
    }
    // modo web: el anfitrión cierra la sala para todos; un invitado sólo se va
    const t = this.transport;
    this.detach();
    t?.close();
    this.emit();
  }

  /** En modo web, la sala termina si se cierra la pestaña del anfitrión. */
  get isBrowserHost(): boolean {
    return this.host !== null;
  }

  disconnect(): void {
    const t = this.transport;
    this.detach();
    t?.close();
    this.status = 'closed';
    this.emit();
  }

  send(m: ClientMsg): void {
    const t = this.transport;
    if (!t || this.status !== 'open') return;
    const raw = JSON.stringify(m);
    if (this.fakeLag > 0) setTimeout(() => this.transport === t && t.send(raw), this.fakeLag);
    else t.send(raw);
  }

  private handle(data: string): void {
    this.lastMsgAt = performance.now();
    let m: ServerMsg;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        this.nonce = m.nonce;
        this.proveAdmin();
        if (!this.p2p) this.send({ t: 'list' });
        if (this.pendingJoin) {
          this.send({ t: 'join', room: this.pendingJoin });
          this.pendingJoin = null;
        }
        if (this.pendingCreate) {
          this.send({ t: 'create', ...this.pendingCreate });
          this.pendingCreate = null;
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
        if (this.p2p) {
          const t = this.transport;
          this.detach();
          t?.close();
        } else {
          this.room = null;
          this.sink?.onNoGame();
          this.send({ t: 'list' });
        }
        if (m.reason) this.error = m.reason;
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
      case 'admin':
        this.isAdmin = m.ok;
        this.adminError = m.ok ? null : 'La clave de administrador no coincide.';
        break;
      case 'adminstate':
        this.adminState = m.s;
        break;
      case 'error':
        this.error = m.msg;
        break;
    }
    this.emit();
  }
}

export const net = new NetClient();
