// Sesiones de juego: local (entrenamiento / bots) y en red (predicción del
// jugador local, reconciliación e interpolación de los demás).
import { HERO_IDS, HeroId, TICK_MS } from '../../../shared/config';
import { BotBrain, botInput, makeBrain } from '../../../shared/bot';
import { cloneState, createGame, requestHero, resetKickoff, setInput, step } from '../../../shared/game';
import type { Disc } from '../../../shared/physics';
import type { GameEvent, GameMode, GameState, Team } from '../../../shared/types';
import type { NetClient, SnapshotSink } from './net';
/** Tolerancia del acumulador: evita que el error de coma flotante postergue un tick a otro fotograma. */
const ACC_EPS = 1e-6;


export interface Session {
  localId: string;
  /** Avanza con el reloj real; `bits` es la entrada actual del jugador local. */
  update(dtMs: number, bits: number): void;
  /** Estado a dibujar (interpolado). */
  view(): GameState | null;
  /** Capas de depuración: estado físico predicho (sin interpolar ni suavizar) y último estado autoritativo. */
  debugLayers(): { pred: GameState | null; auth: GameState | null };
  onEvents: (ev: GameEvent[]) => void;
  dispose(): void;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpDisc(out: Disc, a: Disc, b: Disc, t: number, jumped = false): void {
  // sin interpolar saltos: saque, portal o rebobinado (eventos de discontinuidad)
  if (jumped || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 80) return;
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
}

/** Crea una vista con posiciones interpoladas entre dos estados. */
function blend(a: GameState, b: GameState, t: number): GameState {
  const v: GameState = { ...b, ball: { ...b.ball }, players: b.players.map((p) => ({ ...p, d: { ...p.d } })) };
  lerpDisc(v.ball, a.ball, b.ball, t, a.ballWarp !== b.ballWarp);
  for (const p of v.players) {
    const pa = a.players.find((o) => o.id === p.id);
    if (pa) lerpDisc(p.d, pa.d, p.d, t, pa.warp !== p.warp);
  }
  v.projectiles = b.projectiles.map((pr) => {
    const pa = a.projectiles.find((o) => o.id === pr.id);
    return pa ? { ...pr, x: lerp(pa.x, pr.x, t), y: lerp(pa.y, pr.y, t) } : pr;
  });
  return v;
}

// ---------------------------------------------------------------- local

export interface LocalOptions {
  kind: 'training' | 'bots';
  mode: GameMode;
  hero: HeroId;
  teamSize: 1 | 2 | 3;
  timeLimitMin: number;
  scoreLimit: number;
  botSkill: number;
  /** «Sin cooldowns» (Héroes y Súper). */
  noCooldowns?: boolean;
}

export class LocalSession implements Session {
  localId = 'me';
  state: GameState;
  prev: GameState;
  brains: BotBrain[] = [];
  acc = 0;
  onEvents: (ev: GameEvent[]) => void = () => {};

  constructor(public opts: LocalOptions) {
    this.state = this.build();
    this.prev = cloneState(this.state);
  }

  private build(): GameState {
    const o = this.opts;
    const players: { id: string; team: Team; hero: HeroId }[] = [{ id: 'me', team: 'red', hero: o.hero }];
    this.brains = [];
    if (o.kind === 'bots') {
      const heroes = HERO_IDS.filter((h) => h !== o.hero).sort(() => Math.random() - 0.5);
      let n = 0;
      for (let i = 1; i < o.teamSize; i++) {
        const id = `bot-r${i}`;
        players.push({ id, team: 'red', hero: heroes[n++ % heroes.length] });
        this.brains.push(makeBrain(id, o.botSkill));
      }
      for (let i = 0; i < o.teamSize; i++) {
        const id = `bot-b${i}`;
        players.push({ id, team: 'blue', hero: heroes[n++ % heroes.length] });
        this.brains.push(makeBrain(id, o.botSkill));
      }
    }
    const s = createGame({
      mode: o.mode,
      timeLimitMin: o.kind === 'training' ? 0 : o.timeLimitMin,
      scoreLimit: o.kind === 'training' ? 0 : o.scoreLimit,
      players,
      noCooldowns: o.noCooldowns,
    });
    if (o.kind === 'training') s.phase = 'playing';
    return s;
  }

  restart(): void {
    this.state = this.build();
    this.prev = cloneState(this.state);
  }

  /** Entrenamiento: pelota y jugador al centro, efectos limpios. */
  resetPositions(): void {
    const s = this.state;
    resetKickoff(s, 'red');
    s.phase = 'playing';
    this.prev = cloneState(s);
  }

  setHero(hero: HeroId): void {
    this.opts.hero = hero;
    if (this.opts.kind === 'training') {
      // en entrenamiento se aplica al instante (sin rivales a quienes perjudicar)
      const me = this.state.players.find((p) => p.id === 'me');
      if (me) me.hero = hero;
    } else requestHero(this.state, 'me', hero);
  }

  togglePause(): void {
    if (this.state.phase !== 'ended') this.state.paused = !this.state.paused;
  }

  update(dtMs: number, bits: number): void {
    this.acc += Math.min(dtMs, 250);
    while (this.acc >= TICK_MS - ACC_EPS) {
      this.acc -= TICK_MS;
      this.prev = { ...this.state, ball: { ...this.state.ball }, players: this.state.players.map((p) => ({ ...p, d: { ...p.d } })), projectiles: this.state.projectiles.map((p) => ({ ...p })) };
      const s = this.state;
      setInput(s, 'me', bits);
      for (const b of this.brains) setInput(s, b.id, botInput(s, b));
      s.events = [];
      step(s);
      if (this.opts.kind === 'training' && s.phase === 'kickoff') s.phase = 'playing';
      if (s.events.length) this.onEvents(s.events);
    }
  }

  view(): GameState {
    return blend(this.prev, this.state, this.acc / TICK_MS);
  }

  debugLayers() {
    // sin red: el estado local es a la vez el físico y el autoritativo
    return { pred: this.state, auth: null };
  }

  dispose(): void {}
}

// ---------------------------------------------------------------- red

interface Snap {
  tick: number;
  state: GameState;
}

const INTERP_TICKS = 6; // 100 ms de colchón para interpolar
const MAX_PENDING = 120;

/** Posiciones de todos los discos (pelota + jugadores) por id, con su contador de saltos. */
type PosMap = Map<string, { x: number; y: number; w: number }>;

function positions(s: GameState): PosMap {
  const m: PosMap = new Map([['ball', { x: s.ball.x, y: s.ball.y, w: s.ballWarp }]]);
  for (const p of s.players) m.set(p.id, { x: p.d.x, y: p.d.y, w: p.warp });
  return m;
}

export class NetSession implements Session, SnapshotSink {
  localId: string;
  snaps: Snap[] = [];
  /**
   * Mundo predicho: último snapshot + entradas locales aún no confirmadas.
   * Mientras jugás, la pelota y todos los jugadores se dibujan desde aquí, así
   * tu jugador y la pelota están en el mismo instante (lo que ves es lo que
   * choca y lo que se patea). Los rivales se extrapolan con su última entrada.
   */
  predicted: GameState | null = null;
  /** Posiciones predichas del tick anterior, para interpolar entre ticks. */
  private predPrev: PosMap = new Map();
  pending: { s: number; b: number }[] = [];
  seq = 0;
  acc = 0;
  clockTick = 0;
  /** Suavizado visual de correcciones de la predicción, por disco. */
  off = new Map<string, { x: number; y: number }>();
  onEvents: (ev: GameEvent[]) => void = () => {};
  active = false;

  constructor(private net: NetClient) {
    this.localId = net.id;
    net.sink = this;
  }

  onNoGame(): void {
    this.snaps = [];
    this.predicted = null;
    this.pending = [];
    this.off.clear();
    this.active = false;
  }

  private inGame(): boolean {
    return !!this.predicted?.players.some((p) => p.id === this.localId);
  }

  onSnapshot(state: GameState, ack: number, events: GameEvent[]): void {
    this.localId = this.net.id;
    if (!this.active || state.tick < (this.snaps.at(-1)?.tick ?? 0) - 120) {
      this.snaps = [];
      this.clockTick = state.tick;
    }
    this.active = true;
    this.snaps.push({ tick: state.tick, state });
    while (this.snaps.length > 40) this.snaps.shift();
    // reloj de render: avanza con el tiempo real y se corrige suavemente
    const diff = state.tick - this.clockTick;
    if (Math.abs(diff) > 30) this.clockTick = state.tick;
    else this.clockTick += diff * 0.1;
    // las patadas propias ya sonaron al predecirlas
    const ev = events.filter((e) => !(e.type === 'kick' && e.id === this.localId));
    if (ev.length) this.onEvents(ev);
    this.reconcile(state, ack);
  }

  private reconcile(state: GameState, ack: number): void {
    const me = this.localId;
    const old = this.predicted ? positions(this.predicted) : null;
    this.pending = this.pending.filter((p) => p.s > ack);
    const pred = cloneState(state);
    pred.events = [];
    // reproducir sólo las entradas aún no confirmadas: las ya procesadas por
    // el servidor (incluidas sus activaciones de poderes) vienen en el estado
    let prev = positions(pred);
    for (const p of this.pending) {
      prev = positions(pred);
      setInput(pred, me, p.b);
      step(pred);
    }
    pred.events = [];
    this.predicted = pred;
    this.predPrev = prev;
    if (!old) return;
    // la corrección se reparte en unos fotogramas en vez de un salto
    for (const [id, now] of positions(pred)) {
      const o = old.get(id);
      if (!o) continue;
      const dx = o.x - now.x;
      const dy = o.y - now.y;
      const cur = this.off.get(id) ?? { x: 0, y: 0 };
      if (Math.hypot(dx, dy) < 60 && o.w === now.w) this.off.set(id, { x: cur.x + dx, y: cur.y + dy });
      else this.off.delete(id); // saque o teletransporte: sin suavizar
    }
  }

  update(dtMs: number, bits: number): void {
    const dt = Math.min(dtMs, 250);
    this.clockTick += dt / TICK_MS;
    const decay = Math.pow(0.8, dt / TICK_MS);
    for (const o of this.off.values()) {
      o.x *= decay;
      o.y *= decay;
    }
    if (!this.active) {
      this.acc = 0;
      return;
    }
    this.acc += dt;
    while (this.acc >= TICK_MS - ACC_EPS) {
      this.acc -= TICK_MS;
      if (!this.inGame()) continue;
      this.seq++;
      this.net.send({ t: 'in', s: this.seq, b: bits });
      this.pending.push({ s: this.seq, b: bits });
      if (this.pending.length > MAX_PENDING) this.pending.shift();
      const pred = this.predicted!;
      this.predPrev = positions(pred);
      setInput(pred, this.localId, bits);
      pred.events = [];
      step(pred);
      const mine = pred.events.filter((e) => e.type === 'kick' && e.id === this.localId);
      if (mine.length) this.onEvents(mine);
      pred.events = [];
    }
  }

  /**
   * Limita el suavizado de cada disco a la mitad de su separación física con
   * el disco más cercano. Sin esto, una corrección de la pelota (por ejemplo,
   * porque un rival la tocó) la dibujaba hasta ~40 px lejos de donde realmente
   * choca: en contacto se veía un hueco o un solapamiento falso. Lejos de todo,
   * las correcciones se siguen repartiendo en varios fotogramas.
   */
  private clampOffsets(s: GameState): void {
    const discs: [string, Disc][] = [['ball', s.ball], ...s.players.map((p) => [p.id, p.d] as [string, Disc])];
    for (const [id, d] of discs) {
      const o = this.off.get(id);
      if (!o) continue;
      let near = Infinity;
      for (const [id2, e] of discs) {
        if (id2 !== id) near = Math.min(near, Math.hypot(d.x - e.x, d.y - e.y) - d.r - e.r);
      }
      const max = Math.max(0, near) / 2;
      const len = Math.hypot(o.x, o.y);
      if (len > max) {
        const k = len > 0 ? max / len : 0;
        o.x *= k;
        o.y *= k;
      }
    }
  }

  /** Vista del mundo predicho, interpolada entre ticks y con correcciones suavizadas. */
  private predictedView(): GameState {
    const s = this.predicted!;
    const t = this.acc / TICK_MS;
    this.clampOffsets(s);
    const place = (id: string, d: { x: number; y: number }, w: number) => {
      const a = this.predPrev.get(id);
      const o = this.off.get(id);
      let x = d.x;
      let y = d.y;
      if (a && a.w === w && Math.abs(a.x - d.x) + Math.abs(a.y - d.y) < 80) {
        x = lerp(a.x, d.x, t);
        y = lerp(a.y, d.y, t);
      }
      if (o) {
        x += o.x;
        y += o.y;
      }
      return { ...d, x, y } as Disc;
    };
    return {
      ...s,
      ball: place('ball', s.ball, s.ballWarp),
      players: s.players.map((p) => ({ ...p, d: place(p.id, p.d, p.warp) })),
    };
  }

  debugLayers() {
    return { pred: this.inGame() ? this.predicted : null, auth: this.snaps.at(-1)?.state ?? null };
  }

  view(): GameState | null {
    if (this.snaps.length === 0) return null;
    const latest = this.snaps[this.snaps.length - 1].state;
    let v: GameState;
    if (this.inGame()) {
      v = this.predictedView();
    } else {
      // espectador: interpolación con colchón (más suave, sin predicción)
      const target = this.clockTick - INTERP_TICKS;
      let a = this.snaps[0];
      let b = this.snaps[this.snaps.length - 1];
      for (let i = this.snaps.length - 1; i > 0; i--) {
        if (this.snaps[i - 1].tick <= target) {
          a = this.snaps[i - 1];
          b = this.snaps[i];
          break;
        }
      }
      if (target >= b.tick || a === b) v = blend(b.state, b.state, 1);
      else if (target <= a.tick) v = blend(a.state, a.state, 1);
      else v = blend(a.state, b.state, (target - a.tick) / (b.tick - a.tick));
    }
    // marcador, tiempo y fase: siempre los del servidor
    v.score = latest.score;
    v.time = latest.time;
    v.phase = latest.phase;
    v.paused = latest.paused;
    v.overtime = latest.overtime;
    v.winner = latest.winner;
    v.kickoffTeam = latest.kickoffTeam;
    return v;
  }

  dispose(): void {
    if (this.net.sink === this) this.net.sink = null;
  }
}
