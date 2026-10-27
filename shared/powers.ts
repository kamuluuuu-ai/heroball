// Poderes de los héroes. Todo corre dentro de la simulación (servidor
// autoritativo); el cliente sólo predice su propio jugador con el mismo código.
import { PLAYER, POWERS, STADIUM } from './config';
import { clampSpeed, collideSeg, lineBlocked, stadium } from './physics';
import type { GameState, PlayerState } from './types';

const P = POWERS;

function findPlayer(s: GameState, id: string): PlayerState | undefined {
  return s.players.find((p) => p.id === id);
}

/** Multiplicador de aceleración por efectos. Las ralentizaciones no se suman: prevalece la más fuerte. */
export function accelMult(s: GameState, p: PlayerState): number {
  let slow = p.slowTicks > 0 ? p.slowPct : 0;
  for (const z of s.zones) {
    if (z.team === p.team) continue;
    if (Math.hypot(p.d.x - z.x, p.d.y - z.y) < z.r) slow = Math.max(slow, P.batman.smoke.slowPct);
  }
  p.slowNow = slow;
  let m = 1 - slow;
  if (p.fury > 0) m *= P.hulk.fury.accelMult;
  if (p.superSpeed > 0) m *= P.superman.superSpeed.mult;
  return m;
}

export function speedLimitMult(p: PlayerState): number {
  return p.superSpeed > 0 ? P.superman.superSpeed.mult : 1;
}

export function kickMult(p: PlayerState): number {
  let m = 1;
  if (p.fury > 0) m *= P.hulk.fury.kickMult;
  if (p.superShot > 0) m *= P.superman.superShot.kickMult;
  return m;
}

export interface AimTarget {
  kind: 'ball' | 'player';
  id: string | null;
  x: number;
  y: number;
}

/**
 * Autoapuntado de la Q de Spider-Man (sólo pelota) y Batman (pelota o rival).
 * Devuelve el objetivo y la dirección de lanzamiento, anticipando el
 * movimiento del objetivo; null si no hay objetivo válido (se usa la
 * dirección apuntada).
 */
export function autoAim(s: GameState, p: PlayerState): { target: AimTarget; dx: number; dy: number } | null {
  let range: number;
  let speed: number;
  let cone: number;
  if (p.hero === 'spider' && P.spider.web.autoAim) {
    range = P.spider.web.range;
    speed = P.spider.web.speed;
    cone = 180;
  } else if (p.hero === 'batman' && P.batman.batarang.autoAim) {
    range = P.batman.batarang.range;
    speed = P.batman.batarang.speed;
    cone = P.batman.batarang.autoAimCone;
  } else return null;

  const cands: { t: AimTarget; vx: number; vy: number; r: number }[] = [
    { t: { kind: 'ball', id: null, x: s.ball.x, y: s.ball.y }, vx: s.ball.vx, vy: s.ball.vy, r: s.ball.r },
  ];
  if (p.hero === 'batman') {
    for (const o of s.players) {
      if (o.team !== p.team) cands.push({ t: { kind: 'player', id: o.id, x: o.d.x, y: o.d.y }, vx: o.d.vx, vy: o.d.vy, r: o.d.r });
    }
  }
  const cosCone = Math.cos((cone * Math.PI) / 180);
  let best: { target: AimTarget; dx: number; dy: number } | null = null;
  let bestScore = -Infinity;
  for (const c of cands) {
    // anticipación: dónde estará cuando llegue el proyectil (dos iteraciones)
    let tx = c.t.x;
    let ty = c.t.y;
    for (let i = 0; i < 2; i++) {
      const time = Math.hypot(tx - p.d.x, ty - p.d.y) / speed;
      tx = c.t.x + c.vx * time;
      ty = c.t.y + c.vy * time;
    }
    const dx = tx - p.d.x;
    const dy = ty - p.d.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist - p.d.r - c.r > range) continue;
    const nx = dx / dist;
    const ny = dy / dist;
    const align = nx * p.ax + ny * p.ay;
    if (align < cosCone - 1e-9) continue;
    if (lineBlocked(p.d.x, p.d.y, c.t.x, c.t.y)) continue;
    // el más alineado con la dirección apuntada; a igual alineación, el más cercano
    const score = align * 2 - dist / range;
    if (score > bestScore) {
      bestScore = score;
      best = { target: c.t, dx: nx, dy: ny };
    }
  }
  return best;
}

/** Intenta activar Q o E. Devuelve true si se activó. */
export function activate(s: GameState, p: PlayerState, slot: 'q' | 'e'): boolean {
  if (slot === 'q' ? p.cdQ > 0 : p.cdE > 0) return false;
  let ax = p.ax;
  let ay = p.ay;
  if (slot === 'q') {
    const aim = autoAim(s, p);
    if (aim) {
      ax = aim.dx;
      ay = aim.dy;
    }
  }
  let cd = 0;
  switch (p.hero) {
    case 'spider':
      if (slot === 'q') {
        const c = P.spider.web;
        // un solo hilo a la vez por jugador
        s.projectiles = s.projectiles.filter((pr) => !(pr.owner === p.id && pr.kind === 'web'));
        s.tethers = s.tethers.filter((t) => t.owner !== p.id);
        s.projectiles.push({
          id: s.nextId++, kind: 'web', owner: p.id, team: p.team,
          x: p.d.x + ax * p.d.r, y: p.d.y + ay * p.d.r, vx: ax * c.speed, vy: ay * c.speed,
          r: c.radius, dist: 0, max: c.range,
        });
        cd = c.cooldown;
      } else {
        p.dash = P.spider.dash.ticks;
        cd = P.spider.dash.cooldown;
      }
      break;
    case 'batman':
      if (slot === 'q') {
        const c = P.batman.batarang;
        s.projectiles.push({
          id: s.nextId++, kind: 'batarang', owner: p.id, team: p.team,
          x: p.d.x + ax * p.d.r, y: p.d.y + ay * p.d.r, vx: ax * c.speed, vy: ay * c.speed,
          r: c.radius, dist: 0, max: c.range,
        });
        cd = c.cooldown;
      } else {
        const c = P.batman.smoke;
        s.zones.push({ id: s.nextId++, owner: p.id, team: p.team, x: p.d.x, y: p.d.y, r: c.radius, ticks: c.ticks, total: c.ticks });
        cd = c.cooldown;
      }
      break;
    case 'hulk':
      if (slot === 'q') {
        slam(s, p);
        cd = P.hulk.slam.cooldown;
      } else {
        p.fury = P.hulk.fury.ticks;
        cd = P.hulk.fury.cooldown;
      }
      break;
    case 'superman':
      if (slot === 'q') {
        p.superShot = P.superman.superShot.ticks;
        cd = P.superman.superShot.cooldown;
      } else {
        p.superSpeed = P.superman.superSpeed.ticks;
        cd = P.superman.superSpeed.cooldown;
      }
      break;
  }
  if (slot === 'q') p.cdQ = cd;
  else p.cdE = cd;
  s.events.push({ type: 'power', id: p.id, slot, hero: p.hero });
  return true;
}

function slam(s: GameState, p: PlayerState): void {
  const c = P.hulk.slam;
  const push = (d: { x: number; y: number; vx: number; vy: number; r: number }, base: number, max: number) => {
    const dx = d.x - p.d.x;
    const dy = d.y - p.d.y;
    const dist = Math.hypot(dx, dy);
    const gap = dist - p.d.r - d.r;
    if (gap > c.range || dist === 0) return;
    if (lineBlocked(p.d.x, p.d.y, d.x, d.y)) return;
    const f = base * (1 - Math.max(0, gap) / c.range);
    d.vx += (dx / dist) * f;
    d.vy += (dy / dist) * f;
    clampSpeed(d, max);
  };
  push(s.ball, c.ballImpulse, 14);
  for (const o of s.players) {
    if (o.team === p.team) continue;
    push(o.d, c.playerImpulse, 7);
  }
  s.events.push({ type: 'slam', x: p.d.x, y: p.d.y, r: c.range + p.d.r });
}

/** Temporizadores, proyectiles, hilos y zonas. Se llama una vez por tick tras la física. */
export function updatePowers(s: GameState): void {
  for (const p of s.players) {
    if (p.cdQ > 0) p.cdQ--;
    if (p.cdE > 0) p.cdE--;
    if (p.dash > 0) p.dash--;
    if (p.fury > 0) p.fury--;
    if (p.superShot > 0) p.superShot--;
    if (p.superSpeed > 0) p.superSpeed--;
    if (p.slowTicks > 0) p.slowTicks--;
    if (p.slowTicks === 0) p.slowPct = 0;
  }
  updateProjectiles(s);
  updateTethers(s);
  s.zones = s.zones.filter((z) => --z.ticks > 0);
}

function updateProjectiles(s: GameState): void {
  const keep = [];
  for (const pr of s.projectiles) {
    if (stepProjectile(s, pr)) keep.push(pr);
  }
  s.projectiles = keep;
}

/** Devuelve false si el proyectil desaparece. */
function stepProjectile(s: GameState, pr: GameState['projectiles'][number]): boolean {
  const sp = Math.hypot(pr.vx, pr.vy);
  const n = Math.max(1, Math.ceil(sp / 3));
  for (let i = 0; i < n; i++) {
    pr.x += pr.vx / n;
    pr.y += pr.vy / n;
    pr.dist += sp / n;
    if (pr.dist > pr.max) return false;
    // paredes, redes y postes
    const probe = { x: pr.x, y: pr.y, vx: 0, vy: 0, r: pr.r, invMass: 1, bCoef: 0, damping: 1 };
    for (const w of stadium.ballWalls) {
      if (collideSeg(probe, w)) {
        s.events.push({ type: 'hit', x: pr.x, y: pr.y, target: 'wall' });
        return false;
      }
    }
    for (const post of stadium.posts) {
      if (Math.hypot(post.x - pr.x, post.y - pr.y) < post.r + pr.r) {
        s.events.push({ type: 'hit', x: pr.x, y: pr.y, target: 'wall' });
        return false;
      }
    }
    if (Math.abs(pr.x) > STADIUM.width || Math.abs(pr.y) > STADIUM.height) return false;
    // pelota
    const b = s.ball;
    if (Math.hypot(b.x - pr.x, b.y - pr.y) < b.r + pr.r) {
      if (pr.kind === 'web') {
        s.tethers = s.tethers.filter((t) => t.owner !== pr.owner);
        s.tethers.push({ owner: pr.owner, ticks: P.spider.web.pullTicks });
        s.events.push({ type: 'tether', id: pr.owner });
      } else {
        const k = P.batman.batarang.ballImpulse / sp;
        b.vx += pr.vx * k;
        b.vy += pr.vy * k;
        clampSpeed(b, 14);
        s.lastTouch = pr.owner;
      }
      s.events.push({ type: 'hit', x: pr.x, y: pr.y, target: 'ball' });
      return false;
    }
    // jugadores: la telaraña se corta con cualquiera; el batarang atraviesa aliados
    for (const o of s.players) {
      if (o.id === pr.owner) continue;
      if (Math.hypot(o.d.x - pr.x, o.d.y - pr.y) >= o.d.r + pr.r) continue;
      if (pr.kind === 'batarang') {
        if (o.team === pr.team) continue;
        const c = P.batman.batarang;
        // prevalece el más fuerte: no se suman
        if (c.slowPct >= o.slowPct) {
          o.slowPct = c.slowPct;
          o.slowTicks = Math.max(o.slowTicks, c.slowTicks);
        }
      }
      s.events.push({ type: 'hit', x: pr.x, y: pr.y, target: 'player' });
      return false;
    }
  }
  return true;
}

function updateTethers(s: GameState): void {
  const c = P.spider.web;
  const b = s.ball;
  s.tethers = s.tethers.filter((t) => {
    const p = findPlayer(s, t.owner);
    if (!p) return false;
    if (t.ticks-- <= 0) return false;
    const dx = p.d.x - b.x;
    const dy = p.d.y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist > c.range * c.breakFactor) return false;
    if (lineBlocked(p.d.x, p.d.y, b.x, b.y)) return false;
    // ya llegó: deja de tirar (no se pega al jugador)
    if (dist - p.d.r - b.r < 2) return false;
    b.vx += (dx / dist) * c.pullAccel;
    b.vy += (dy / dist) * c.pullAccel;
    // limita sólo la componente hacia el jugador
    const toward = (b.vx * dx + b.vy * dy) / dist;
    if (toward > c.pullMaxSpeed) {
      const ex = toward - c.pullMaxSpeed;
      b.vx -= (dx / dist) * ex;
      b.vy -= (dy / dist) * ex;
    }
    return true;
  });
}

/** Dash de Spider-Man: velocidad objetivo en la dirección apuntada. */
export function applyDash(p: PlayerState): void {
  const terminal = (PLAYER.acceleration * PLAYER.damping) / (1 - PLAYER.damping);
  const target = terminal * P.spider.dash.speedMult;
  p.d.vx += (p.ax * target - p.d.vx) * 0.5;
  p.d.vy += (p.ay * target - p.d.vy) * 0.5;
}

/** Limpia proyectiles y efectos (gol, reinicio). */
export function clearEffects(s: GameState): void {
  s.projectiles = [];
  s.tethers = [];
  s.zones = [];
  for (const p of s.players) {
    p.dash = 0;
    p.fury = 0;
    p.superShot = 0;
    p.superSpeed = 0;
    p.slowPct = 0;
    p.slowTicks = 0;
    p.slowNow = 0;
  }
}
