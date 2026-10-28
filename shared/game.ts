// Reglas del partido: saque, goles, tiempo, gol de oro, patadas y entradas.
import { HeroId, KICK, LIMITS, PLAYER, RULES, STADIUM, TICK_RATE, powersFor } from './config';
import { clampSpeed, makeDisc, Seg, stadium, stepWorld } from './physics';
import { GEM_IDS, POWERS } from './config';
import { accelMult, activate, applyDash, applyRush, ballImpulseFactor, clearEffects, controlling, incapacitated, kickMult, playerInvMass, powerKickMult, quizInput, speedLimitMult, updatePowers } from './powers';
import { GameMode, GameState, IN, INPUT_MASK, inNum, PlayerState, Team } from './types';

export interface GameOptions {
  mode: GameMode;
  timeLimitMin: number;
  scoreLimit: number;
  players: { id: string; team: Team; hero: HeroId }[];
  /** «Sin cooldowns» (sólo Héroes y Súper; en Clásico no hay poderes). */
  noCooldowns?: boolean;
  /** Semilla del generador de la autoridad (por defecto, al azar). */
  seed?: number;
}

export function teamDir(t: Team): 1 | -1 {
  return t === 'red' ? 1 : -1;
}

export function createGame(o: GameOptions): GameState {
  const s: GameState = {
    tick: 0,
    mode: o.mode,
    phase: 'kickoff',
    phaseTicks: 0,
    kickoffTeam: 'red',
    score: { red: 0, blue: 0 },
    time: 0,
    timeLimit: Math.round(o.timeLimitMin * 60 * TICK_RATE),
    scoreLimit: o.scoreLimit,
    overtime: false,
    winner: null,
    paused: false,
    ball: makeDisc(0, 0, 'ball'),
    players: [],
    projectiles: [],
    tethers: [],
    zones: [],
    nextId: 1,
    lastTouch: null,
    events: [],
    noCd: !!o.noCooldowns && o.mode !== 'classic',
    rng: (o.seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0,
    ballShield: 0,
    ballShieldMax: 0,
    ballShieldBy: null,
    ballElec: 0,
    ballElecStun: 0,
    ballElecHit: [],
    ballHist: [],
    ballWarp: 0,
    ballDonut: 0,
    plHist: {},
    illusion: null,
    illusionGap: 0,
  };
  for (const p of o.players) addPlayer(s, p.id, p.team, p.hero);
  resetKickoff(s, 'red');
  return s;
}

function newPlayer(id: string, team: Team, hero: HeroId): PlayerState {
  return {
    id, team, hero, pendingHero: null,
    d: makeDisc(0, 0, 'player'),
    input: 0, prevInput: 0,
    kickArmed: false, kickCd: 0, kickHeldTicks: 0, kickGrace: 0,
    ax: teamDir(team), ay: 0,
    cdQ: 0, cdE: 0,
    dash: 0, fury: 0, superSpeed: 0,
    slowPct: 0, slowTicks: 0, capSlow: 0, capSlowTicks: 0, slowNow: 0,
    stun: 0, stunImmune: 0,
    trap: 0, mind: 0, mindBy: null, incapRun: 0,
    slip: 0, jet: 0, ammo: POWERS.cj.gun.shots, shotGap: 0, giant: 0, anger: 0,
    quiz: null, quizImmune: 0,
    gem: 0, gemCd: GEM_IDS.map(() => 0), gemGap: 0, powerKick: 0,
    rush: 0, rushSpeed: 0, rushDx: 0, rushDy: 0,
    evade: 0, evadeResist: 0, sprint: 0, trailBoost: 0,
    half: team === 'red' ? -1 : 1,
    warp: 0,
  };
}

/** Posición de aparición: columna en x=±spawnDistance, alternando arriba/abajo. */
function spawnPos(team: Team, index: number): [number, number] {
  let k = (index + 1) >> 1;
  if ((index & 1) === 0) k = -k;
  return [-teamDir(team) * STADIUM.spawnDistance, STADIUM.spawnSpacing * k];
}

export function addPlayer(s: GameState, id: string, team: Team, hero: HeroId): PlayerState {
  removePlayer(s, id);
  const p = newPlayer(id, team, hero);
  const idx = s.players.filter((o) => o.team === team).length;
  const [x, y] = spawnPos(team, idx);
  p.d.x = x;
  p.d.y = y;
  p.half = x < 0 ? -1 : 1;
  s.players.push(p);
  return p;
}

export function removePlayer(s: GameState, id: string): void {
  s.players = s.players.filter((p) => p.id !== id);
  s.projectiles = s.projectiles.filter((p) => p.owner !== id);
  s.tethers = s.tethers.filter((t) => t.owner !== id && t.target !== id);
  s.zones = s.zones.filter((z) => z.owner !== id && z.target !== id);
  // quien controlaba deja de hacerlo; su ilusión termina; su historial se descarta
  for (const o of s.players) {
    if (o.mindBy === id) o.mind = 0;
  }
  if (s.illusion?.by === id) {
    s.illusion = null;
    s.illusionGap = powersFor(s.mode).thanos.reality.between;
  }
  delete s.plHist[id];
  // su protección de la pelota termina con él; la electricidad ya aplicada sigue
  if (s.ballShieldBy === id) {
    s.ballShield = 0;
    s.ballShieldMax = 0;
    s.ballShieldBy = null;
  }
  s.ballElecHit = s.ballElecHit.filter((h) => h !== id);
  if (s.lastTouch === id) s.lastTouch = null;
}

/**
 * Pide un cambio de héroe. Fuera de partido se aplica ya; durante el partido,
 * en el próximo saque. Los tiempos de recarga se conservan por ranura.
 */
export function requestHero(s: GameState, id: string, hero: HeroId): void {
  const p = s.players.find((o) => o.id === id);
  if (!p) return;
  p.pendingHero = hero === p.hero ? null : hero;
}

export function resetKickoff(s: GameState, team: Team): void {
  s.phase = 'kickoff';
  s.phaseTicks = 0;
  s.kickoffTeam = team;
  s.ball = makeDisc(0, 0, 'ball');
  s.ballWarp++;
  clearEffects(s);
  const counts = { red: 0, blue: 0 };
  for (const p of s.players) {
    if (p.pendingHero) {
      p.hero = p.pendingHero;
      p.pendingHero = null;
    }
    const [x, y] = spawnPos(p.team, counts[p.team]++);
    p.d = makeDisc(x, y, 'player');
    p.half = x < 0 ? -1 : 1;
    p.warp++;
    p.ax = teamDir(p.team);
    p.ay = 0;
    p.kickArmed = false;
    p.kickGrace = 0;
    p.kickCd = 0;
    // las recargas siguen corriendo (también durante el festejo): un gol no
    // devuelve todos los poderes, así el saque no es una ráfaga de habilidades
  }
  s.events.push({ type: 'kickoff' });
}

export function setInput(s: GameState, id: string, bits: number): void {
  const p = s.players.find((o) => o.id === id);
  if (p) p.input = bits & INPUT_MASK;
}

/** Héroes y Súper usan poderes; Clásico no. */
export function hasPowers(s: GameState): boolean {
  return s.mode !== 'classic';
}

export function powersEnabled(s: GameState): boolean {
  return hasPowers(s) && s.phase === 'playing' && !s.paused;
}

function kickoffBarriers(s: GameState): Seg[] {
  if (s.phase !== 'kickoff') return [];
  // Se bloquea el semicírculo del lado del equipo que NO saca: el que saca
  // puede entrar al círculo completo, el otro no puede entrar.
  const other: Team = s.kickoffTeam === 'red' ? 'blue' : 'red';
  return [...stadium.kickoffLines, ...stadium.kickoffArc[other]];
}

function updatePlayer(s: GameState, p: PlayerState): void {
  // quiz abierto: el número de la entrada es la respuesta
  if (p.quiz && powersEnabled(s)) quizInput(s, p);
  // aturdido, controlado o con quiz: sin movimiento voluntario, patada ni
  // poderes (las entradas se siguen registrando, así una tecla mantenida no se
  // dispara al terminar)
  const stunned = incapacitated(p);
  const bits = stunned ? 0 : p.input;
  const pressed = stunned ? 0 : bits & ~p.prevInput;
  const held = (bits & IN.KICK) !== 0;
  if (p.d.x !== 0) p.half = p.d.x < 0 ? -1 : 1;
  // Thanos: 1–5 eligen gema
  const num = inNum(bits);
  if (p.hero === 'thanos' && num >= 1 && num <= GEM_IDS.length) p.gem = num - 1;

  // patada: se arma al apretar; mantener no repite salvo holdRepeatTicks > 0
  if (held) {
    p.kickHeldTicks++;
    p.kickGrace = KICK.graceTicks;
    if (pressed & IN.KICK) p.kickArmed = true;
    else if (KICK.holdRepeatTicks > 0 && p.kickHeldTicks % KICK.holdRepeatTicks === 0) p.kickArmed = true;
  } else {
    // un toque corto sigue armado unos ticks (no se pierde por llegar justo tarde)
    if (p.kickGrace > 0) p.kickGrace--;
    else p.kickArmed = false;
    p.kickHeldTicks = 0;
  }
  if (p.kickCd > 0) p.kickCd--;

  // movimiento: atrapado por la rosquilla no se mueve; controlado, lo mueven las
  // direcciones de quien controla; quien controla se queda quieto
  let mv = bits;
  if (p.trap > 0 || controlling(s, p)) mv = 0;
  if (p.mind > 0) mv = s.players.find((o) => o.id === p.mindBy)?.input ?? 0;
  let dx = 0;
  let dy = 0;
  if (mv & IN.UP) dy -= 1;
  if (mv & IN.DOWN) dy += 1;
  if (mv & IN.LEFT) dx -= 1;
  if (mv & IN.RIGHT) dx += 1;
  if (dx !== 0 && dy !== 0) {
    dx *= Math.SQRT1_2;
    dy *= Math.SQRT1_2;
  }
  if (dx !== 0 || dy !== 0) {
    p.ax = dx;
    p.ay = dy;
  }

  // poderes (flanco de subida: mantener apretado no reactiva)
  if (powersEnabled(s)) {
    if (pressed & IN.Q) activate(s, p, 'q');
    if (pressed & IN.E) activate(s, p, 'e');
  }

  p.d.invMass = playerInvMass(s, p);
  p.d.damping = held ? PLAYER.kickingDamping : PLAYER.damping;
  // charco de cerveza: menos rozamiento (se resbala), con vuelta gradual
  if (p.slip > 0) p.d.damping += (powersFor(s.mode).homer.beer.damping - p.d.damping) * p.slip;

  if (p.rush > 0) {
    applyRush(s, p);
  } else if (p.dash > 0) {
    applyDash(s, p);
  } else {
    const a = (held ? PLAYER.kickingAcceleration : PLAYER.acceleration) * accelMult(s, p);
    const before = Math.hypot(p.d.vx, p.d.vy);
    p.d.vx += dx * a;
    p.d.vy += dy * a;
    // la propia aceleración no supera el límite configurado (los empujes externos sí)
    const lim = Math.max(before, LIMITS.playerInputSpeed * speedLimitMult(s, p));
    clampSpeed(p.d, lim);
  }
  p.prevInput = p.input;
}

function tryKick(s: GameState, p: PlayerState): void {
  if (!p.kickArmed || p.kickCd > 0) return;
  const b = s.ball;
  const dx = b.x - p.d.x;
  const dy = b.y - p.d.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || dist - b.r - p.d.r >= KICK.range) return;
  const nx = dx / dist;
  const ny = dy / dist;
  // Gema del Poder: la próxima patada (la protección del Capitán anula el extra);
  // la rosquilla en la pelota reduce el impulso
  const m = hasPowers(s) ? kickMult(s, p) * powerKickMult(s, p) * ballImpulseFactor(s) : 1;
  if (p.powerKick > 0) p.powerKick = 0;
  const k = PLAYER.kickStrength * m;
  b.vx += nx * k * b.invMass;
  b.vy += ny * k * b.invMass;
  clampSpeed(b, LIMITS.ballMaxSpeed);
  p.d.vx -= nx * PLAYER.kickback * p.d.invMass;
  p.d.vy -= ny * PLAYER.kickback * p.d.invMass;
  p.kickArmed = false;
  p.kickCd = KICK.rateTicks;
  s.lastTouch = p.id;
  s.events.push({ type: 'kick', id: p.id, power: m });
}

/** ¿Cruzó la pelota una línea de gol entre prev y la posición actual? */
function goalCrossed(px: number, py: number, x: number, y: number): Team | null {
  const W = STADIUM.fieldW;
  const G = STADIUM.goalHalf;
  const cross = (lineX: number): boolean => {
    if ((px - lineX) * (x - lineX) > 0 && x !== lineX) return false;
    if (px === x) return false;
    const t = (lineX - px) / (x - px);
    const yc = py + (y - py) * t;
    return Math.abs(yc) < G;
  };
  // pelota hacia +x entra en el arco azul: gol rojo
  if (x > W && px <= W && cross(W)) return 'red';
  if (x < -W && px >= -W && cross(-W)) return 'blue';
  return null;
}

function gameOver(s: GameState): boolean {
  const { red, blue } = s.score;
  if (s.scoreLimit > 0 && (red >= s.scoreLimit || blue >= s.scoreLimit)) return true;
  if (s.timeLimit > 0 && s.time >= s.timeLimit && red !== blue) return true;
  return false;
}

function endGame(s: GameState): void {
  s.phase = 'ended';
  s.phaseTicks = RULES.endPauseTicks;
  const { red, blue } = s.score;
  s.winner = red > blue ? 'red' : blue > red ? 'blue' : null;
  clearEffects(s);
  s.events.push({ type: 'end', winner: s.winner });
}

/** Avanza la simulación un tick (1/60 s). */
export function step(s: GameState): void {
  s.tick++;
  if (s.paused) {
    for (const p of s.players) p.prevInput = p.input;
    return;
  }

  for (const p of s.players) updatePlayer(s, p);
  if (s.phase !== 'ended') for (const p of s.players) tryKick(s, p);

  const bx = s.ball.x;
  const by = s.ball.y;
  stepWorld({ ball: s.ball, players: s.players.map((p) => p.d), playerBarriers: kickoffBarriers(s) });
  clampSpeed(s.ball, LIMITS.ballMaxSpeed);
  for (const p of s.players) clampSpeed(p.d, LIMITS.playerMaxSpeed);
  if (hasPowers(s)) updatePowers(s);

  switch (s.phase) {
    case 'kickoff':
      if (s.ball.vx !== 0 || s.ball.vy !== 0) s.phase = 'playing';
      break;
    case 'playing': {
      s.time++;
      const scorer = goalCrossed(bx, by, s.ball.x, s.ball.y);
      if (scorer) {
        s.score[scorer]++;
        s.phase = 'goal';
        s.phaseTicks = RULES.goalPauseTicks;
        s.events.push({ type: 'goal', team: scorer, scorer: s.lastTouch });
        // saca el equipo que recibió el gol
        s.kickoffTeam = scorer === 'red' ? 'blue' : 'red';
        clearEffects(s);
      } else if (s.timeLimit > 0 && s.time >= s.timeLimit) {
        if (s.score.red !== s.score.blue) endGame(s);
        else if (!s.overtime) {
          s.overtime = true;
          s.events.push({ type: 'overtime' });
        }
      }
      break;
    }
    case 'goal':
      if (--s.phaseTicks <= 0) {
        if (gameOver(s)) endGame(s);
        else resetKickoff(s, s.kickoffTeam);
      }
      break;
    case 'ended':
      if (s.phaseTicks > 0) s.phaseTicks--;
      break;
  }
}

/** Estado del reloj para la interfaz. */
export function clockText(s: GameState): string {
  const secs = Math.floor(s.time / TICK_RATE);
  const m = Math.floor(secs / 60);
  const ss = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function cloneState(s: GameState): GameState {
  return structuredClone(s);
}
