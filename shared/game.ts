// Reglas del partido: saque, goles, tiempo, gol de oro, patadas y entradas.
import { HeroId, KICK, LIMITS, PLAYER, RULES, STADIUM, TICK_RATE, powersFor } from './config';
import { clampSpeed, makeDisc, Seg, stadium, stepWorld } from './physics';
import { accelMult, activate, applyDash, clearEffects, kickMult, speedLimitMult, updatePowers } from './powers';
import { GameMode, GameState, IN, PlayerState, Team } from './types';

export interface GameOptions {
  mode: GameMode;
  timeLimitMin: number;
  scoreLimit: number;
  players: { id: string; team: Team; hero: HeroId }[];
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
    nextId: 1,
    lastTouch: null,
    events: [],
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
    kickArmed: false, kickCd: 0, kickHeldTicks: 0,
    ax: teamDir(team), ay: 0,
    cdQ: 0, cdE: 0,
    dash: 0, fury: 0, superShot: 0, superSpeed: 0,
    slowPct: 0, slowTicks: 0, slowNow: 0,
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
  s.players.push(p);
  return p;
}

export function removePlayer(s: GameState, id: string): void {
  s.players = s.players.filter((p) => p.id !== id);
  s.projectiles = s.projectiles.filter((p) => p.owner !== id);
  s.tethers = s.tethers.filter((t) => t.owner !== id && t.target !== id);
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
  clearEffects(s);
  const counts = { red: 0, blue: 0 };
  for (const p of s.players) {
    if (p.pendingHero) {
      p.hero = p.pendingHero;
      p.pendingHero = null;
    }
    const [x, y] = spawnPos(p.team, counts[p.team]++);
    p.d = makeDisc(x, y, 'player');
    p.ax = teamDir(p.team);
    p.ay = 0;
    p.kickArmed = false;
    p.kickCd = 0;
    // todos empiezan el saque con poderes disponibles
    p.cdQ = 0;
    p.cdE = 0;
  }
  s.events.push({ type: 'kickoff' });
}

export function setInput(s: GameState, id: string, bits: number): void {
  const p = s.players.find((o) => o.id === id);
  if (p) p.input = bits & 127;
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
  const bits = p.input;
  const pressed = bits & ~p.prevInput;
  const held = (bits & IN.KICK) !== 0;

  // patada: se arma al apretar; mantener no repite salvo holdRepeatTicks > 0
  if (held) {
    p.kickHeldTicks++;
    if (pressed & IN.KICK) p.kickArmed = true;
    else if (KICK.holdRepeatTicks > 0 && p.kickHeldTicks % KICK.holdRepeatTicks === 0) p.kickArmed = true;
  } else {
    p.kickArmed = false;
    p.kickHeldTicks = 0;
  }
  if (p.kickCd > 0) p.kickCd--;

  let dx = 0;
  let dy = 0;
  if (bits & IN.UP) dy -= 1;
  if (bits & IN.DOWN) dy += 1;
  if (bits & IN.LEFT) dx -= 1;
  if (bits & IN.RIGHT) dx += 1;
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

  const fury = p.fury > 0;
  p.d.invMass = fury ? PLAYER.invMass / powersFor(s.mode).hulk.fury.massMult : PLAYER.invMass;
  p.d.damping = held ? PLAYER.kickingDamping : PLAYER.damping;

  if (p.dash > 0) {
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
  p.prevInput = bits;
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
  const m = hasPowers(s) ? kickMult(s, p) : 1;
  const k = PLAYER.kickStrength * m;
  b.vx += nx * k * b.invMass;
  b.vy += ny * k * b.invMass;
  clampSpeed(b, LIMITS.ballMaxSpeed);
  p.d.vx -= nx * PLAYER.kickback * p.d.invMass;
  p.d.vy -= ny * PLAYER.kickback * p.d.invMass;
  p.kickArmed = false;
  p.kickCd = KICK.rateTicks;
  p.superShot = 0;
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
