// Salas en memoria, permisos y bucle autoritativo de cada partido.
import { HeroId, POWER_LIMITS, POWERS, PUBLIC_HERO_IDS, SNAPSHOT_EVERY_TICKS, STARTER_IDS, TICK_RATE, isSecret } from '../shared/config';
import { BotBrain, botInput, makeBrain } from '../shared/bot';
import { ECONOMY } from '../shared/economy';
import { addPlayer, createGame, removePlayer, requestHero, setInput, step } from '../shared/game';
import {
  AdminState, DEFAULT_SETTINGS, MAX_CHAT, MAX_ROOM_NAME, RoomInfo, RoomSettings, RoomSummary, ServerMsg, cleanText,
} from '../shared/protocol';
import { GameEvent, GameState, IN, Side, Team } from '../shared/types';
import { OFFICIAL_MODES, type MatchSummary, type OfficialAdapter } from './official';

export interface Client {
  id: string;
  nick: string;
  room: Room | null;
  ping: number;
  /** Moderador verificado: rol de la cuenta o firma emitida por el servidor (shared/admin.ts). */
  admin?: boolean;
  /** Cuenta verificada por el servidor a partir de la sesión (nunca un id enviado por el cliente). */
  userId?: string;
  /** Héroes de la colección de la cuenta (validados en el servidor). */
  owned?: Set<HeroId>;
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
  /** Último tick de sala en que cambió su entrada (para detectar AFK). */
  lastActive: number;
}

/** Seguimiento de una partida oficial, por cuenta (sobrevive a reconexiones). */
interface OfficialMatch {
  id: string;
  startedAt: Date;
  matchTicks: number;
  kicks: { red: number; blue: number };
  part: Map<string, { team: Team; teams: Set<Team>; hero: HeroId; active: number }>;
}

const POWER_BITS = IN.KICK | IN.Q | IN.E;

/** Recursos que no se recuperan saliendo y volviendo durante el mismo partido (cargador de CJ, recargas). */
interface Kept { ammo: number; cdQ: number; cdE: number; gemCd: number[] }
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
  private readonly createdAt = Date.now();
  private ticks = 0;
  private snapBytes = 0;
  private events: GameEvent[] = [];
  private onEmpty: (r: Room) => void;
  /** Sólo en el servidor con base de datos; el anfitrión P2P nunca lo tiene. */
  readonly officialAdapter: OfficialAdapter | null;
  private match: OfficialMatch | null = null;
  /** Por cuenta (o id de miembro): lo que tenía al salir del partido en curso. */
  private kept = new Map<string, Kept>();

  constructor(name: string, settings: Partial<RoomSettings>, onEmpty: (r: Room) => void, id?: string, official: OfficialAdapter | null = null) {
    this.id = id ?? (++roomCounter).toString(36) + Math.random().toString(36).slice(2, 6);
    this.name = cleanText(name, MAX_ROOM_NAME) || 'Sala HeroBall';
    this.officialAdapter = official;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    if (this.settings.official && (!this.officialCapable(this.settings.mode) || this.settings.cooldowns === 'none')) this.settings.official = false;
    this.onEmpty = onEmpty;
  }

  private officialCapable(mode: RoomSettings['mode']): boolean {
    return this.officialAdapter !== null && OFFICIAL_MODES.includes(mode);
  }

  get official(): boolean {
    // sin cooldowns nunca es oficial, aunque alguien intente declararlo
    return this.settings.official && this.officialAdapter !== null && this.settings.cooldowns !== 'none';
  }

  /**
   * ¿Puede este cliente usar el héroe en esta sala? Colección en salas
   * oficiales; los secretos, en cualquier sala, sólo si la colección los tiene:
   * leída de la base de datos en el servidor, o firmada por el servidor para
   * esta conexión en una sala P2P (el navegador no puede inventarla).
   */
  heroAllowed(c: Client | undefined, hero: HeroId): boolean {
    if (isSecret(hero)) return !!c?.owned?.has(hero);
    if (!this.official) return true;
    return STARTER_IDS.includes(hero) || !!c?.owned?.has(hero);
  }

  humans(): Member[] {
    return [...this.members.values()].filter((m) => !m.bot);
  }

  summary(): RoomSummary {
    return {
      id: this.id, name: this.name, players: this.members.size, maxPlayers: this.settings.maxPlayers,
      mode: this.settings.mode, teamSize: this.settings.teamSize, playing: this.game !== null, official: this.official,
      cooldowns: this.settings.cooldowns,
    };
  }

  info(): RoomInfo {
    return {
      id: this.id, name: this.name, settings: { ...this.settings, official: this.official }, hostId: this.hostId, playing: this.game !== null,
      members: [...this.members.values()].map((m) => ({
        id: m.id, nick: m.nick, side: m.side, hero: m.hero, bot: m.bot,
        host: m.id === this.hostId, admin: !!m.client?.admin, verified: !!m.client?.userId, ping: m.client?.ping ?? 0,
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
    // un administrador entra aunque la sala esté llena
    if (this.members.size >= this.settings.maxPlayers && !c.admin) return 'La sala está llena.';
    // una cuenta, una conexión por sala (no puede jugar en ambos equipos)
    if (c.userId && [...this.members.values()].some((o) => o.client?.userId === c.userId)) return 'Tu cuenta ya está en esta sala desde otra conexión.';
    const m: Member = {
      id: c.id, nick: c.nick, side: 'spec', hero: 'spider', bot: false, joinedAt: ++joinCounter,
      client: c, queue: [], lastBits: 0, ack: 0, starved: 0, lastActive: 0,
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
    if (this.game) this.keep(m);
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

  isAdmin(id: string): boolean {
    return !!this.members.get(id)?.client?.admin;
  }

  /** Permisos de anfitrión: el anfitrión o un administrador verificado. */
  can(id: string): boolean {
    return this.isHost(id) || this.isAdmin(id);
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
    if (target !== actor && !this.can(actor)) return 'Sólo el anfitrión puede mover a otros.';
    const m = this.members.get(target);
    if (!m) return 'Jugador inexistente.';
    if (m.side === side) return null;
    if (side !== 'spec' && this.teamCount(side) >= this.settings.teamSize) return 'Ese equipo está completo.';
    if (side !== 'spec' && this.official && !m.client?.userId) return 'En partidas oficiales sólo juegan cuentas registradas (los invitados pueden mirar).';
    m.side = side;
    m.queue = [];
    m.lastBits = 0;
    if (this.game) {
      if (side === 'spec') this.keep(m);
      else this.restore(m, addPlayer(this.game, m.id, side, m.hero));
    }
    this.sendRoom();
    return null;
  }

  /** Guarda el cargador y las recargas de quien sale del partido y lo quita de la simulación. */
  private keep(m: Member): void {
    const g = this.game!;
    const p = g.players.find((o) => o.id === m.id);
    if (p) this.kept.set(m.client?.userId ?? m.id, { ammo: p.ammo, cdQ: p.cdQ, cdE: p.cdE, gemCd: [...p.gemCd] });
    removePlayer(g, m.id);
  }

  /** Al volver al mismo partido (reconexión o cambio de lado) no se recupera nada gratis. */
  private restore(m: Member, p: GameState['players'][number]): void {
    const k = this.kept.get(m.client?.userId ?? m.id);
    if (!k) return;
    p.ammo = Math.min(k.ammo, POWERS.cj.gun.shots);
    p.cdQ = k.cdQ;
    p.cdE = k.cdE;
    p.gemCd = [...k.gemCd];
  }

  /** La colección de una cuenta cambió: si su personaje especial ya no vale, pasa a Spider-Man en el próximo saque. */
  ownedChanged(userId: string, owned: Set<HeroId>): void {
    for (const m of this.members.values()) {
      if (m.client?.userId !== userId) continue;
      m.client.owned = owned;
      if (isSecret(m.hero) && !this.heroAllowed(m.client, m.hero)) {
        m.hero = 'spider';
        if (this.game) requestHero(this.game, m.id, 'spider');
        this.sendRoom();
      }
    }
  }

  setHero(id: string, hero: HeroId): string | null {
    const m = this.members.get(id);
    if (!m) return null;
    if (isSecret(hero) && !this.heroAllowed(m.client, hero)) {
      return 'Ese personaje especial no está en tu colección (lo asigna un administrador).';
    }
    if (!this.heroAllowed(m.client, hero)) return 'Ese héroe está bloqueado en tu colección: en partidas oficiales sólo podés usar los que tenés.';
    m.hero = hero;
    // durante el partido: se aplica en el próximo saque, sin reiniciar recargas
    if (this.game) requestHero(this.game, id, hero);
    this.sendRoom();
    return null;
  }

  setSettings(actor: string, s: Partial<RoomSettings>): string | null {
    if (!this.can(actor)) return 'Sólo el anfitrión puede cambiar la configuración.';
    if (this.game) {
      // con el partido en curso sólo se puede cambiar Cooldowns: se aplica al próximo reinicio
      const keys = Object.keys(s);
      if (keys.length !== 1 || keys[0] !== 'cooldowns') return 'Detené el partido para cambiar la configuración.';
      if (s.cooldowns === 'none' && this.official) return 'Sin cooldowns es siempre casual: no se puede en una partida oficial.';
      if (s.cooldowns === this.settings.cooldowns) return null;
      this.settings = { ...this.settings, cooldowns: s.cooldowns! };
      this.sys(`Cooldowns: ${s.cooldowns === 'none' ? 'Sin cooldowns' : 'Normales'}. Se aplica al reiniciar el partido.`);
      this.sendRoom();
      return null;
    }
    if (s.maxPlayers !== undefined && s.maxPlayers < this.members.size) return 'Hay más jugadores que esa capacidad.';
    const next = { ...this.settings, ...s };
    if (next.official && !this.officialAdapter) return 'Las partidas oficiales sólo existen en el servidor de HeroBall (no en salas del navegador).';
    if (next.official && !OFFICIAL_MODES.includes(next.mode)) return 'El modo Súper es casual: elegí Héroes o Clásico para una partida oficial.';
    if (next.official && next.cooldowns === 'none') return 'Sin cooldowns es siempre casual: no puede ser una partida oficial.';
    this.settings = next;
    if (this.official) {
      // oficial: sin bots, invitados a espectadores y héroes de la colección
      for (const m of [...this.members.values()]) {
        if (m.bot) this.members.delete(m.id);
        else if (!m.client?.userId) m.side = 'spec';
        else if (!this.heroAllowed(m.client, m.hero)) m.hero = 'spider';
      }
    }
    // si bajó el tamaño de equipo, los sobrantes pasan a espectadores
    for (const t of ['red', 'blue'] as Team[]) {
      const ms = [...this.members.values()].filter((m) => m.side === t);
      for (const extra of ms.slice(this.settings.teamSize)) extra.side = 'spec';
    }
    this.sendRoom();
    return null;
  }

  start(actor: string): string | null {
    if (!this.can(actor)) return 'Sólo el anfitrión puede iniciar.';
    if (this.game) return null;
    const players = [...this.members.values()]
      .filter((m) => m.side !== 'spec')
      .map((m) => ({ id: m.id, team: m.side as Team, hero: m.hero }));
    if (players.length === 0) return 'No hay jugadores en los equipos.';
    this.game = createGame({
      mode: this.settings.mode, timeLimitMin: this.settings.timeLimitMin, scoreLimit: this.settings.scoreLimit, players,
      noCooldowns: this.settings.cooldowns === 'none',
    });
    this.kept.clear();
    for (const m of this.members.values()) {
      m.queue = [];
      m.lastBits = 0;
      m.lastActive = this.ticks;
    }
    this.events = [];
    this.match = this.official
      ? { id: crypto.randomUUID(), startedAt: new Date(), matchTicks: 0, kicks: { red: 0, blue: 0 }, part: new Map() }
      : null;
    this.sys(this.official ? 'Partido oficial iniciado: el servidor registra la participación.' : this.game.noCd ? 'Partido iniciado sin cooldowns (casual, sin recompensas).' : 'Partido iniciado.');
    this.sendRoom();
    return null;
  }

  stop(actor: string | null): string | null {
    if (actor !== null && !this.can(actor)) return 'Sólo el anfitrión puede detener.';
    if (!this.game) return null;
    if (this.match && this.game.phase !== 'ended') this.sys('Partido oficial detenido antes del final: no entrega recompensas.');
    this.game = null;
    this.match = null;
    this.broadcast({ t: 'nogame' });
    this.sendRoom();
    return null;
  }

  pause(actor: string): string | null {
    if (!this.can(actor)) return 'Sólo el anfitrión puede pausar.';
    if (!this.game || this.game.phase === 'ended') return null;
    this.game.paused = !this.game.paused;
    this.sys(this.game.paused ? 'Partido en pausa.' : 'Partido reanudado.');
    return null;
  }

  restart(actor: string): string | null {
    if (!this.can(actor)) return 'Sólo el anfitrión puede reiniciar.';
    if (this.match && this.game?.phase !== 'ended') this.sys('Partido oficial reiniciado: el anterior no entrega recompensas.');
    this.game = null;
    this.match = null;
    return this.start(actor);
  }

  addBot(actor: string, side: Team): string | null {
    if (!this.can(actor)) return 'Sólo el anfitrión puede agregar bots.';
    if (this.official) return 'Las partidas oficiales no admiten bots.';
    if (this.members.size >= this.settings.maxPlayers) return 'La sala está llena.';
    if (this.teamCount(side) >= this.settings.teamSize) return 'Ese equipo está completo.';
    const id = 'b' + (++botCounter).toString(36);
    // los bots nunca usan personajes secretos
    const hero = PUBLIC_HERO_IDS[botCounter % PUBLIC_HERO_IDS.length];
    const m: Member = {
      id, nick: `Bot ${botCounter}`, side, hero, bot: true, joinedAt: ++joinCounter,
      brain: makeBrain(id, 0.75), queue: [], lastBits: 0, ack: 0, starved: 0, lastActive: 0,
    };
    this.members.set(id, m);
    if (this.game) addPlayer(this.game, id, side, hero);
    this.sendRoom();
    return null;
  }

  kickMember(actor: string, target: string): string | null {
    if (!this.can(actor)) return 'Sólo el anfitrión puede expulsar.';
    if (target === actor) return null;
    const m = this.members.get(target);
    if (!m) return null;
    if (m.client?.admin && !this.isAdmin(actor)) return 'No se puede expulsar a un administrador.';
    if (m.client) {
      m.client.send({ t: 'left', reason: this.isAdmin(actor) ? 'Fuiste expulsado por un administrador.' : 'Fuiste expulsado por el anfitrión.' });
    }
    this.leave(target);
    return null;
  }

  /** Sólo administradores: pasar el rol de anfitrión a otro humano. */
  makeHost(actor: string, target: string): string | null {
    if (!this.isAdmin(actor)) return 'Sólo un administrador puede cambiar el anfitrión.';
    const m = this.members.get(target);
    if (!m || m.bot) return 'Jugador inexistente.';
    if (this.hostId === target) return null;
    this.hostId = target;
    this.sys(`${m.nick} ahora es anfitrión.`);
    this.sendRoom();
    return null;
  }

  adminState(): AdminState {
    const g = this.game;
    return {
      uptime: Math.round((Date.now() - this.createdAt) / 1000),
      game: g && {
        phase: g.phase, paused: g.paused, score: { ...g.score },
        time: Math.floor(g.time / 60), timeLimit: Math.floor(g.timeLimit / 60), overtime: g.overtime, tick: g.tick,
      },
      snapBytes: g ? this.snapBytes : 0,
      members: [...this.members.values()].map((m) => ({
        id: m.id, nick: m.nick, side: m.side, bot: m.bot, admin: !!m.client?.admin,
        ping: m.client?.ping ?? 0, queue: m.queue.length, starved: m.starved, ack: m.ack,
      })),
    };
  }

  private sendAdminState(): void {
    const admins = [...this.members.values()].filter((m) => m.client?.admin);
    if (!admins.length) return;
    const raw = JSON.stringify({ t: 'adminstate', s: this.adminState() });
    for (const m of admins) m.client!.send(raw);
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
    const bits = next.b | carry;
    if (bits !== m.lastBits) m.lastActive = this.ticks;
    m.lastBits = bits;
    return m.lastBits;
  }

  /** Participación de cada cuenta en la partida oficial (sin contar pausas ni festejos). */
  private trackOfficial(g: GameState): void {
    const match = this.match;
    if (!match || g.paused || g.phase === 'ended') return;
    match.matchTicks++;
    const afk = ECONOMY.match.afkSeconds * TICK_RATE;
    for (const m of this.members.values()) {
      const uid = m.client?.userId;
      if (!uid || m.side === 'spec') continue;
      let p = match.part.get(uid);
      if (!p) match.part.set(uid, (p = { team: m.side, teams: new Set(), hero: m.hero, active: 0 }));
      p.team = m.side;
      p.teams.add(m.side);
      p.hero = m.hero;
      if (this.ticks - m.lastActive < afk) p.active++;
    }
    for (const e of g.events) {
      if (e.type !== 'kick') continue;
      const side = this.members.get(e.id)?.side;
      if (side === 'red' || side === 'blue') match.kicks[side]++;
    }
  }

  /** Arma el resumen con lo que simuló el servidor y pide resolver recompensas. */
  private finishOfficial(g: GameState): void {
    const match = this.match;
    const adapter = this.officialAdapter;
    this.match = null;
    if (!match || !adapter) return;
    const atEnd = new Map<string, Team>();
    for (const m of this.members.values()) {
      if (m.client?.userId && m.side !== 'spec') atEnd.set(m.client.userId, m.side);
    }
    const summary: MatchSummary = {
      id: match.id, mode: g.mode, startedAt: match.startedAt, endedAt: new Date(), matchTicks: match.matchTicks,
      score: { ...g.score }, winner: g.winner, kicks: { ...match.kicks }, finished: true, noCooldowns: g.noCd,
      participants: [...match.part.entries()].map(([userId, p]) => ({
        userId, team: p.team, hero: p.hero, activeTicks: p.active,
        // abandonó, pasó a espectador o cambió de equipo durante el partido
        present: atEnd.get(userId) === p.team && p.teams.size === 1,
      })),
    };
    adapter.settle(summary).then((results) => {
      for (const r of results) {
        for (const m of this.members.values()) {
          if (m.client?.userId === r.userId) m.client.send({ t: 'reward', r: { eligible: r.eligible, reason: r.reason, coins: r.coins, dailyBonus: r.dailyBonus, weeklyElite: r.weeklyElite } });
        }
      }
    }, (err) => {
      console.error('No se pudo resolver la partida oficial', match.id, err);
      this.sys('Error del servidor al registrar la partida oficial: no se entregaron recompensas.');
    });
  }

  tick(): void {
    // panel de administración: dos veces por segundo
    if (++this.ticks % 30 === 0) this.sendAdminState();
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
    // cola acotada: si un cliente no recibe snapshots a tiempo, se descartan los eventos más viejos
    if (this.events.length > POWER_LIMITS.maxQueuedEvents) this.events.splice(0, this.events.length - POWER_LIMITS.maxQueuedEvents);
    this.trackOfficial(g);
    if (g.events.some((e) => e.type === 'end')) this.finishOfficial(g);
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
    // el historial de la pelota (rebobinar) sólo lo usa la autoridad: no viaja
    const saved = g.events;
    const hist = g.ballHist;
    const plHist = g.plHist;
    g.events = [];
    g.ballHist = [];
    g.plHist = {};
    const stateJson = JSON.stringify(g);
    g.events = saved;
    g.ballHist = hist;
    g.plHist = plHist;
    const evJson = JSON.stringify(this.events);
    this.snapBytes = stateJson.length + evJson.length + 40;
    this.events = [];
    for (const m of this.members.values()) {
      if (!m.client) continue;
      m.client.send(`{"t":"snap","ack":${m.ack},"ev":${evJson},"state":${stateJson}}`);
    }
  }
}

export class Lobby {
  rooms = new Map<string, Room>();

  /** `official`: servicio de economía (sólo el servidor Node con base de datos). */
  constructor(readonly official: OfficialAdapter | null = null) {}

  create(name: string, settings: Partial<RoomSettings>, id?: string): Room {
    const r = new Room(name, settings, (room) => this.rooms.delete(room.id), id, this.official);
    this.rooms.set(r.id, r);
    return r;
  }

  list(): RoomSummary[] {
    return [...this.rooms.values()].map((r) => r.summary());
  }

  tickAll(): void {
    for (const r of this.rooms.values()) r.tick();
  }

  /** Relee la colección de una cuenta conectada (p. ej. tras retirarle un secreto) y aplica el cambio en sus salas. */
  async refreshOwned(userId: string): Promise<void> {
    if (!this.official) return;
    const owned = await this.official.ownedHeroes(userId);
    for (const r of this.rooms.values()) r.ownedChanged(userId, owned);
  }
}
