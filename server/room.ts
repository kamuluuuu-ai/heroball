// Salas en memoria, permisos y bucle autoritativo de cada partido.
import { HeroId, SNAPSHOT_EVERY_TICKS } from '../shared/config';
import { BotBrain, botInput, makeBrain } from '../shared/bot';
import { addPlayer, createGame, removePlayer, requestHero, setInput, step } from '../shared/game';
import {
  DEFAULT_SETTINGS, MAX_CHAT, MAX_ROOM_NAME, RoomInfo, RoomSettings, RoomSummary, ServerMsg, cleanText,
} from '../shared/protocol';
import { GameEvent, GameState, IN, Side, Team } from '../shared/types';

export interface Client {
  id: string;
  nick: string;
  room: Room | null;
  ping: number;
  send(msg: ServerMsg | string): void;
}

interface Member {
  id: string;
  nick: string;
  side: Side;
  hero: HeroId;
  bot: boolean;
  joinedAt: number;
  client?: Client;
  brain?: BotBrain;
  queue: { s: number; b: number }[];
  lastBits: number;
  ack: number;
  starved: number;
}

const POWER_BITS = IN.KICK | IN.Q | IN.E;
const MAX_QUEUE = 6;

let roomCounter = 0;
let botCounter = 0;
let joinCounter = 0;

export class Room {
  readonly id: string;
  name: string;
  settings: RoomSettings;
  members = new Map<string, Member>();
  hostId = '';
  game: GameState | null = null;
  private events: GameEvent[] = [];
  private onEmpty: (r: Room) => void;

  constructor(name: string, settings: Partial<RoomSettings>, onEmpty: (r: Room) => void, id?: string) {
    this.id = id ?? (++roomCounter).toString(36) + Math.random().toString(36).slice(2, 6);
    this.name = cleanText(name, MAX_ROOM_NAME) || 'Sala HeroBall';
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.onEmpty = onEmpty;
  }

  humans(): Member[] {
    return [...this.members.values()].filter((m) => !m.bot);
  }

  summary(): RoomSummary {
    return {
      id: this.id, name: this.name, players: this.members.size, maxPlayers: this.settings.maxPlayers,
      mode: this.settings.mode, teamSize: this.settings.teamSize, playing: this.game !== null,
    };
  }

  info(): RoomInfo {
    return {
      id: this.id, name: this.name, settings: this.settings, hostId: this.hostId, playing: this.game !== null,
      members: [...this.members.values()].map((m) => ({
        id: m.id, nick: m.nick, side: m.side, hero: m.hero, bot: m.bot,
        host: m.id === this.hostId, ping: m.client?.ping ?? 0,
      })),
    };
  }

  broadcast(msg: ServerMsg): void {
    const raw = JSON.stringify(msg);
    for (const m of this.members.values()) m.client?.send(raw);
  }

  sys(text: string): void {
    this.broadcast({ t: 'chat', from: null, nick: '', text });
  }

  sendRoom(): void {
    this.broadcast({ t: 'room', room: this.info() });
  }

  join(c: Client): string | null {
    if (this.members.size >= this.settings.maxPlayers) return 'La sala está llena.';
    const m: Member = {
      id: c.id, nick: c.nick, side: 'spec', hero: 'spider', bot: false, joinedAt: ++joinCounter,
      client: c, queue: [], lastBits: 0, ack: 0, starved: 0,
    };
    this.members.set(c.id, m);
    c.room = this;
    if (!this.hostId || !this.members.has(this.hostId)) this.hostId = c.id;
    this.sendRoom();
    this.sys(`${c.nick} entró a la sala.`);
    if (!this.game) c.send({ t: 'nogame' });
    return null;
  }

  leave(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    if (m.client) m.client.room = null;
    if (this.game) removePlayer(this.game, id);
    if (this.humans().length === 0) {
      this.members.clear();
      this.game = null;
      this.onEmpty(this);
      return;
    }
    if (!m.bot) this.sys(`${m.nick} salió de la sala.`);
    if (this.hostId === id) {
      // transferencia al humano más antiguo
      const next = this.humans().sort((a, b) => a.joinedAt - b.joinedAt)[0];
      this.hostId = next.id;
      this.sys(`${next.nick} ahora es anfitrión.`);
    }
    this.sendRoom();
  }

  isHost(id: string): boolean {
    return this.hostId === id;
  }

  teamCount(side: Team): number {
    let n = 0;
    for (const m of this.members.values()) if (m.side === side) n++;
    return n;
  }

  chat(id: string, text: string): void {
    const m = this.members.get(id);
    const clean = cleanText(text, MAX_CHAT);
    if (!m || !clean) return;
    this.broadcast({ t: 'chat', from: m.id, nick: m.nick, text: clean, team: m.side });
  }

  /** Cambiar de equipo. Uno mismo puede elegir; mover a otros es del anfitrión. */
  setSide(actor: string, side: Side, target = actor): string | null {
    if (target !== actor && !this.isHost(actor)) return 'Sólo el anfitrión puede mover a otros.';
    const m = this.members.get(target);
    if (!m) return 'Jugador inexistente.';
    if (m.side === side) return null;
    if (side !== 'spec' && this.teamCount(side) >= this.settings.teamSize) return 'Ese equipo está completo.';
    m.side = side;
    m.queue = [];
    m.lastBits = 0;
    if (this.game) {
      if (side === 'spec') removePlayer(this.game, m.id);
      else addPlayer(this.game, m.id, side, m.hero);
    }
    this.sendRoom();
    return null;
  }

  setHero(id: string, hero: HeroId): void {
    const m = this.members.get(id);
    if (!m) return;
    m.hero = hero;
    // durante el partido: se aplica en el próximo saque, sin reiniciar recargas
    if (this.game) requestHero(this.game, id, hero);
    this.sendRoom();
  }

  setSettings(actor: string, s: Partial<RoomSettings>): string | null {
    if (!this.isHost(actor)) return 'Sólo el anfitrión puede cambiar la configuración.';
    if (this.game) return 'Detené el partido para cambiar la configuración.';
    if (s.maxPlayers !== undefined && s.maxPlayers < this.members.size) return 'Hay más jugadores que esa capacidad.';
    this.settings = { ...this.settings, ...s };
    // si bajó el tamaño de equipo, los sobrantes pasan a espectadores
    for (const t of ['red', 'blue'] as Team[]) {
      const ms = [...this.members.values()].filter((m) => m.side === t);
      for (const extra of ms.slice(this.settings.teamSize)) extra.side = 'spec';
    }
    this.sendRoom();
    return null;
  }

  start(actor: string): string | null {
    if (!this.isHost(actor)) return 'Sólo el anfitrión puede iniciar.';
    if (this.game) return null;
    const players = [...this.members.values()]
      .filter((m) => m.side !== 'spec')
      .map((m) => ({ id: m.id, team: m.side as Team, hero: m.hero }));
    if (players.length === 0) return 'No hay jugadores en los equipos.';
    this.game = createGame({
      mode: this.settings.mode, timeLimitMin: this.settings.timeLimitMin, scoreLimit: this.settings.scoreLimit, players,
    });
    for (const m of this.members.values()) {
      m.queue = [];
      m.lastBits = 0;
    }
    this.events = [];
    this.sys('Partido iniciado.');
    this.sendRoom();
    return null;
  }

  stop(actor: string | null): string | null {
    if (actor !== null && !this.isHost(actor)) return 'Sólo el anfitrión puede detener.';
    if (!this.game) return null;
    this.game = null;
    this.broadcast({ t: 'nogame' });
    this.sendRoom();
    return null;
  }

  pause(actor: string): string | null {
    if (!this.isHost(actor)) return 'Sólo el anfitrión puede pausar.';
    if (!this.game || this.game.phase === 'ended') return null;
    this.game.paused = !this.game.paused;
    this.sys(this.game.paused ? 'Partido en pausa.' : 'Partido reanudado.');
    return null;
  }

  restart(actor: string): string | null {
    if (!this.isHost(actor)) return 'Sólo el anfitrión puede reiniciar.';
    this.game = null;
    return this.start(actor);
  }

  addBot(actor: string, side: Team): string | null {
    if (!this.isHost(actor)) return 'Sólo el anfitrión puede agregar bots.';
    if (this.members.size >= this.settings.maxPlayers) return 'La sala está llena.';
    if (this.teamCount(side) >= this.settings.teamSize) return 'Ese equipo está completo.';
    const id = 'b' + (++botCounter).toString(36);
    const heroes: HeroId[] = ['spider', 'batman', 'hulk', 'superman'];
    const hero = heroes[botCounter % 4];
    const m: Member = {
      id, nick: `Bot ${botCounter}`, side, hero, bot: true, joinedAt: ++joinCounter,
      brain: makeBrain(id, 0.75), queue: [], lastBits: 0, ack: 0, starved: 0,
    };
    this.members.set(id, m);
    if (this.game) addPlayer(this.game, id, side, hero);
    this.sendRoom();
    return null;
  }

  kickMember(actor: string, target: string): string | null {
    if (!this.isHost(actor)) return 'Sólo el anfitrión puede expulsar.';
    if (target === actor) return null;
    const m = this.members.get(target);
    if (!m) return null;
    if (m.client) {
      m.client.send({ t: 'left', reason: 'Fuiste expulsado por el anfitrión.' });
    }
    this.leave(target);
    return null;
  }

  /** Recibe una entrada de un jugador. El servidor procesa una por tick. */
  pushInput(id: string, seq: number, bits: number): void {
    const m = this.members.get(id);
    if (!m || m.bot || m.side === 'spec' || !this.game) return;
    if (seq <= m.ack || (m.queue.length && seq <= m.queue[m.queue.length - 1].s)) return;
    m.queue.push({ s: seq, b: bits });
    if (m.queue.length > MAX_QUEUE * 2) m.queue.splice(0, m.queue.length - MAX_QUEUE * 2);
  }

  private nextBits(m: Member): number {
    if (m.queue.length === 0) {
      // sin entradas por medio segundo (pestaña oculta, corte): soltar todo
      if (++m.starved > 30) m.lastBits = 0;
      return m.lastBits;
    }
    m.starved = 0;
    // si el cliente va adelantado, descartamos entradas viejas sin perder pulsaciones
    let carry = 0;
    while (m.queue.length > MAX_QUEUE) carry |= m.queue.shift()!.b & POWER_BITS;
    const next = m.queue.shift()!;
    m.ack = next.s;
    m.lastBits = next.b | carry;
    return m.lastBits;
  }

  tick(): void {
    const g = this.game;
    if (!g) return;
    for (const m of this.members.values()) {
      if (m.side === 'spec') continue;
      const bits = m.bot ? botInput(g, m.brain!) : this.nextBits(m);
      setInput(g, m.id, bits);
    }
    g.events = [];
    step(g);
    if (g.events.length) this.events.push(...g.events);
    for (const e of g.events) {
      if (e.type === 'goal') {
        const who = e.scorer ? this.members.get(e.scorer)?.nick : null;
        this.sys(`¡Gol ${e.team === 'red' ? 'rojo' : 'azul'}!${who ? ' (' + who + ')' : ''}`);
      } else if (e.type === 'end') {
        this.sys(e.winner ? `Ganó el equipo ${e.winner === 'red' ? 'rojo' : 'azul'}.` : 'Partido terminado.');
      } else if (e.type === 'overtime') {
        this.sys('Tiempo cumplido con empate: ¡gol de oro!');
      }
    }
    if (g.tick % SNAPSHOT_EVERY_TICKS === 0) this.sendSnapshots();
    if (g.phase === 'ended' && g.phaseTicks <= 0) this.stop(null);
  }

  private sendSnapshots(): void {
    const g = this.game!;
    const saved = g.events;
    g.events = [];
    const stateJson = JSON.stringify(g);
    g.events = saved;
    const evJson = JSON.stringify(this.events);
    this.events = [];
    for (const m of this.members.values()) {
      if (!m.client) continue;
      m.client.send(`{"t":"snap","ack":${m.ack},"ev":${evJson},"state":${stateJson}}`);
    }
  }
}

export class Lobby {
  rooms = new Map<string, Room>();

  create(name: string, settings: Partial<RoomSettings>, id?: string): Room {
    const r = new Room(name, settings, (room) => this.rooms.delete(room.id), id);
    this.rooms.set(r.id, r);
    return r;
  }

  list(): RoomSummary[] {
    return [...this.rooms.values()].map((r) => r.summary());
  }

  tickAll(): void {
    for (const r of this.rooms.values()) r.tick();
  }
}
