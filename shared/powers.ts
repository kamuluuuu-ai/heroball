// Poderes de los héroes. Todo corre dentro de la simulación (servidor
// autoritativo); el cliente sólo predice su propio jugador con el mismo código.
// Los valores dependen del modo: Héroes (POWERS) o Súper (SUPER_POWERS).
import { LIMITS, PLAYER, STADIUM, powersFor, type PowerConfig } from './config';
import { clampSpeed, collideSeg, lineBlocked, stadium } from './physics';
import type { GameState, PlayerState, Projectile } from './types';

const cfg = (s: GameState): PowerConfig => powersFor(s.mode);

function findPlayer(s: GameState, id: string): PlayerState | undefined {
  return s.players.find((p) => p.id === id);
}

/** Multiplicador de aceleración por efectos. Las ralentizaciones no se suman: prevalece la más fuerte. */
export function accelMult(s: GameState, p: PlayerState): number {
  const c = cfg(s);
  const slow = p.slowTicks > 0 ? p.slowPct : 0;
  p.slowNow = slow;
  let m = 1 - slow;
  if (p.fury > 0) m *= c.hulk.fury.accelMult;
  if (p.superSpeed > 0) m *= c.superman.superSpeed.mult;
  return m;
}

export function speedLimitMult(s: GameState, p: PlayerState): number {
  return p.superSpeed > 0 ? cfg(s).superman.superSpeed.mult : 1;
}

export function kickMult(s: GameState, p: PlayerState): number {
  const c = cfg(s);
  let m = 1;
  if (p.fury > 0) m *= c.hulk.fury.kickMult;
  if (p.superShot > 0) m *= c.superman.superShot.kickMult;
  return m;
}

export interface AimTarget {
  kind: 'ball' | 'player';
  id: string | null;
  x: number;
  y: number;
}

/** Posición anticipada de un objetivo para un proyectil de cierta velocidad (dos iteraciones). */
function lead(p: PlayerState, x: number, y: number, vx: number, vy: number, speed: number): [number, number] {
  let tx = x;
  let ty = y;
  for (let i = 0; i < 2; i++) {
    const time = Math.hypot(tx - p.d.x, ty - p.d.y) / speed;
    tx = x + vx * time;
    ty = y + vy * time;
  }
  return [tx, ty];
}

/**
 * Autoapuntado de la Q de Spider-Man (pelota; en Súper también rivales) y
 * Batman (pelota o rival). Devuelve el objetivo y la dirección de lanzamiento,
 * anticipando el movimiento del objetivo; null si no hay objetivo válido (se
 * usa la dirección apuntada).
 */
export function autoAim(s: GameState, p: PlayerState): { target: AimTarget; dx: number; dy: number } | null {
  const P = cfg(s);
  let range: number;
  let speed: number;
  let cone: number;
  let rivals: boolean;
  if (p.hero === 'spider' && P.spider.web.autoAim) {
    range = P.spider.web.range;
    speed = P.spider.web.speed;
    cone = 180;
    rivals = P.spider.web.grabsRivals;
  } else if (p.hero === 'batman' && P.batman.batarang.autoAim) {
    range = P.batman.batarang.range;
    speed = P.batman.batarang.speed;
    cone = P.batman.batarang.autoAimCone;
    rivals = true;
  } else return null;

  const cands: { t: AimTarget; vx: number; vy: number; r: number }[] = [
    { t: { kind: 'ball', id: null, x: s.ball.x, y: s.ball.y }, vx: s.ball.vx, vy: s.ball.vy, r: s.ball.r },
  ];
  if (rivals) {
    for (const o of s.players) {
      if (o.team !== p.team) cands.push({ t: { kind: 'player', id: o.id, x: o.d.x, y: o.d.y }, vx: o.d.vx, vy: o.d.vy, r: o.d.r });
    }
  }
  const cosCone = Math.cos((cone * Math.PI) / 180);
  let best: { target: AimTarget; dx: number; dy: number } | null = null;
  let bestScore = -Infinity;
  for (const c of cands) {
    const [tx, ty] = lead(p, c.t.x, c.t.y, c.vx, c.vy, speed);
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

/**
 * Dirección del gancho de Batman: siempre hacia la pelota (anticipada).
 * `inRange` indica si llegaría (alcance y línea de visión).
 */
export function grappleAim(s: GameState, p: PlayerState): { dx: number; dy: number; inRange: boolean } | null {
  const c = cfg(s).batman.grapple;
  const b = s.ball;
  const [tx, ty] = lead(p, b.x, b.y, b.vx, b.vy, c.speed);
  const dx = tx - p.d.x;
  const dy = ty - p.d.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return null;
  const inRange = dist - p.d.r - b.r <= c.range && !lineBlocked(p.d.x, p.d.y, b.x, b.y);
  return { dx: dx / dist, dy: dy / dist, inRange };
}

function shoot(s: GameState, p: PlayerState, kind: Projectile['kind'], ax: number, ay: number, c: { speed: number; radius: number; range: number }): void {
  s.projectiles.push({
    id: s.nextId++, kind, owner: p.id, team: p.team,
    x: p.d.x + ax * p.d.r, y: p.d.y + ay * p.d.r, vx: ax * c.speed, vy: ay * c.speed,
    r: c.radius, dist: 0, max: c.range,
  });
}

/** Intenta activar Q o E. Devuelve true si se activó. */
export function activate(s: GameState, p: PlayerState, slot: 'q' | 'e'): boolean {
  if (slot === 'q' ? p.cdQ > 0 : p.cdE > 0) return false;
  const P = cfg(s);
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
        s.tethers = s.tethers.filter((t) => !(t.owner === p.id && t.kind !== 'grapple'));
        shoot(s, p, 'web', ax, ay, c);
        cd = c.cooldown;
      } else {
        p.dash = P.spider.dash.ticks;
        cd = P.spider.dash.cooldown;
      }
      break;
    case 'batman':
      if (slot === 'q') {
        const c = P.batman.batarang;
        // abanico centrado en la dirección elegida
        for (let i = 0; i < c.count; i++) {
          const a = ((i - (c.count - 1) / 2) * c.spread * Math.PI) / 180;
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          shoot(s, p, 'batarang', ax * cos - ay * sin, ax * sin + ay * cos, c);
        }
        cd = c.cooldown;
      } else {
        const c = P.batman.grapple;
        const g = grappleAim(s, p);
        if (!g) return false;
        s.projectiles = s.projectiles.filter((pr) => !(pr.owner === p.id && pr.kind === 'hook'));
        s.tethers = s.tethers.filter((t) => !(t.owner === p.id && t.kind === 'grapple'));
        shoot(s, p, 'hook', g.dx, g.dy, c);
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

/** Ralentiza a un jugador. Prevalece el efecto más fuerte: no se suman. */
function applySlow(o: PlayerState, pct: number, ticks: number): void {
  if (pct <= 0 || ticks <= 0) return;
  if (pct >= o.slowPct) {
    o.slowPct = pct;
    o.slowTicks = Math.max(o.slowTicks, ticks);
  }
}

function slam(s: GameState, p: PlayerState): void {
  const c = cfg(s).hulk.slam;
  const push = (d: { x: number; y: number; vx: number; vy: number; r: number }, base: number, max: number): boolean => {
    const dx = d.x - p.d.x;
    const dy = d.y - p.d.y;
    const dist = Math.hypot(dx, dy);
    const gap = dist - p.d.r - d.r;
    if (gap > c.range || dist === 0) return false;
    if (lineBlocked(p.d.x, p.d.y, d.x, d.y)) return false;
    const f = base * (1 - Math.max(0, gap) / c.range);
    d.vx += (dx / dist) * f;
    d.vy += (dy / dist) * f;
    clampSpeed(d, max);
    return true;
  };
  push(s.ball, c.ballImpulse, LIMITS.ballMaxSpeed - 1);
  for (const o of s.players) {
    if (o.team === p.team) continue;
    if (push(o.d, c.playerImpulse, LIMITS.playerMaxSpeed)) applySlow(o, c.stunPct, c.stunTicks);
  }
  s.events.push({ type: 'slam', x: p.d.x, y: p.d.y, r: c.range + p.d.r });
}

/** Temporizadores, proyectiles e hilos. Se llama una vez por tick tras la física. */
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
}

function updateProjectiles(s: GameState): void {
  const keep = [];
  for (const pr of s.projectiles) {
    if (stepProjectile(s, pr)) keep.push(pr);
  }
  s.projectiles = keep;
}

/** Devuelve false si el proyectil desaparece. */
function stepProjectile(s: GameState, pr: Projectile): boolean {
  const P = cfg(s);
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
        s.tethers = s.tethers.filter((t) => !(t.owner === pr.owner && t.kind !== 'grapple'));
        s.tethers.push({ owner: pr.owner, kind: 'web', target: null, ticks: P.spider.web.pullTicks });
        s.events.push({ type: 'tether', id: pr.owner });
      } else if (pr.kind === 'hook') {
        s.tethers = s.tethers.filter((t) => !(t.owner === pr.owner && t.kind === 'grapple'));
        s.tethers.push({ owner: pr.owner, kind: 'grapple', target: null, ticks: P.batman.grapple.pullTicks });
        s.events.push({ type: 'tether', id: pr.owner });
      } else {
        const k = P.batman.batarang.ballImpulse / sp;
        b.vx += pr.vx * k;
        b.vy += pr.vy * k;
        clampSpeed(b, LIMITS.ballMaxSpeed - 1);
        s.lastTouch = pr.owner;
      }
      s.events.push({ type: 'hit', x: pr.x, y: pr.y, target: 'ball' });
      return false;
    }
    // el gancho sólo busca la pelota: atraviesa a los jugadores
    if (pr.kind === 'hook') continue;
    // jugadores: la telaraña se corta con cualquiera (en Súper se pega a los
    // rivales); el batarang atraviesa aliados
    for (const o of s.players) {
      if (o.id === pr.owner) continue;
      if (Math.hypot(o.d.x - pr.x, o.d.y - pr.y) >= o.d.r + pr.r) continue;
      if (pr.kind === 'batarang') {
        if (o.team === pr.team) continue;
        const c = P.batman.batarang;
        applySlow(o, c.slowPct, c.slowTicks);
      } else if (o.team !== pr.team && P.spider.web.grabsRivals) {
        s.tethers = s.tethers.filter((t) => !(t.owner === pr.owner && t.kind !== 'grapple'));
        s.tethers.push({ owner: pr.owner, kind: 'rival', target: o.id, ticks: P.spider.web.rivalPullTicks });
        s.events.push({ type: 'tether', id: pr.owner });
      }
      s.events.push({ type: 'hit', x: pr.x, y: pr.y, target: 'player' });
      return false;
    }
  }
  return true;
}

/** Acelera `d` hacia (tx, ty) limitando sólo la componente en esa dirección. */
function pullToward(d: { x: number; y: number; vx: number; vy: number }, tx: number, ty: number, accel: number, max: number): void {
  const dx = tx - d.x;
  const dy = ty - d.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return;
  const nx = dx / dist;
  const ny = dy / dist;
  d.vx += nx * accel;
  d.vy += ny * accel;
  const toward = d.vx * nx + d.vy * ny;
  if (toward > max) {
    d.vx -= nx * (toward - max);
    d.vy -= ny * (toward - max);
  }
}

function updateTethers(s: GameState): void {
  const P = cfg(s);
  const b = s.ball;
  s.tethers = s.tethers.filter((t) => {
    const p = findPlayer(s, t.owner);
    if (!p) return false;
    if (t.ticks-- <= 0) return false;
    // extremo del hilo: la pelota o el rival atrapado
    const o = t.target ? findPlayer(s, t.target) : undefined;
    if (t.target && !o) return false;
    const end = o ? o.d : b;
    const dist = Math.hypot(p.d.x - end.x, p.d.y - end.y);
    if (lineBlocked(p.d.x, p.d.y, end.x, end.y)) return false;
    const gap = dist - p.d.r - end.r;
    switch (t.kind) {
      case 'web': {
        const c = P.spider.web;
        if (dist > c.range * c.breakFactor) return false;
        // ya llegó: deja de tirar (no se pega al jugador)
        if (gap < 2) return false;
        pullToward(b, p.d.x, p.d.y, c.pullAccel, c.pullMaxSpeed);
        return true;
      }
      case 'rival': {
        const c = P.spider.web;
        if (dist > c.range * c.breakFactor || gap < 2) return false;
        pullToward(end, p.d.x, p.d.y, c.rivalPullAccel, c.rivalPullMaxSpeed);
        return true;
      }
      case 'grapple': {
        const c = P.batman.grapple;
        if (dist > c.range * c.breakFactor) return false;
        if (gap < 3) {
          // llegó: en Súper empuja la pelota en la dirección del viaje
          if (c.arriveImpulse > 0 && dist > 0) {
            b.vx += ((b.x - p.d.x) / dist) * c.arriveImpulse;
            b.vy += ((b.y - p.d.y) / dist) * c.arriveImpulse;
            clampSpeed(b, LIMITS.ballMaxSpeed - 1);
            s.lastTouch = p.id;
            s.events.push({ type: 'hit', x: b.x, y: b.y, target: 'ball' });
          }
          return false;
        }
        pullToward(p.d, b.x, b.y, c.pullAccel, c.pullMaxSpeed);
        return true;
      }
    }
  });
}

/** Dash de Spider-Man: velocidad objetivo en la dirección apuntada. */
export function applyDash(s: GameState, p: PlayerState): void {
  const terminal = (PLAYER.acceleration * PLAYER.damping) / (1 - PLAYER.damping);
  const target = terminal * cfg(s).spider.dash.speedMult;
  p.d.vx += (p.ax * target - p.d.vx) * 0.5;
  p.d.vy += (p.ay * target - p.d.vy) * 0.5;
}

/** Limpia proyectiles y efectos (gol, reinicio). */
export function clearEffects(s: GameState): void {
  s.projectiles = [];
  s.tethers = [];
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
