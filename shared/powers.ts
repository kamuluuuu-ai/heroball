// Poderes de los héroes. Todo corre dentro de la simulación (servidor
// autoritativo); el cliente sólo predice su propio jugador con el mismo código.
// Los valores dependen del modo: Héroes (POWERS) o Súper (SUPER_POWERS).
import { LIMITS, PLAYER, STADIUM, powersFor, type PowerConfig } from './config';
import { clampSpeed, collideSeg, lineBlocked, stadium } from './physics';
import type { GameState, PlayerState, Projectile, Zone } from './types';

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
  if (p.guard > 0) m *= c.cap.guard.accelMult;
  if (p.thrusters > 0) m *= c.ironman.thrusters.mult;
  if (p.sprint > 0) m *= c.flash.sprint.accelMult;
  return m;
}

export function speedLimitMult(s: GameState, p: PlayerState): number {
  const c = cfg(s);
  let m = 1;
  if (p.superSpeed > 0) m *= c.superman.superSpeed.mult;
  if (p.thrusters > 0) m *= c.ironman.thrusters.mult;
  if (p.sprint > 0) m *= c.flash.sprint.speedMult;
  return m;
}

/** Fracción de control lateral (perpendicular a la velocidad) que conserva el jugador. */
export function turnMult(s: GameState, p: PlayerState): number {
  return p.thrusters > 0 ? cfg(s).ironman.thrusters.turn : 1;
}

/**
 * Factor de los empujes de poderes que recibe un jugador (Guardia, Evasión).
 * No se suman: prevalece la resistencia mayor. Las colisiones no cambian.
 */
export function pushFactor(s: GameState, o: PlayerState): number {
  const c = cfg(s);
  let r = 0;
  if (o.guard > 0) r = Math.max(r, c.cap.guard.resist);
  if (o.evade > 0) r = Math.max(r, c.widow.evade.resist);
  return 1 - r;
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
    case 'hawkeye':
      if (slot === 'q') {
        shoot(s, p, 'arrow', ax, ay, P.hawkeye.arrow);
        cd = P.hawkeye.arrow.cooldown;
      } else {
        startRush(p, P.hawkeye.sidestep);
        cd = P.hawkeye.sidestep.cooldown;
      }
      break;
    case 'widow':
      if (slot === 'q') {
        shoot(s, p, 'shock', ax, ay, P.widow.shock);
        cd = P.widow.shock.cooldown;
      } else {
        p.evade = P.widow.evade.ticks;
        cd = P.widow.evade.cooldown;
      }
      break;
    case 'cap':
      if (slot === 'q') {
        // un solo escudo en vuelo
        if (s.projectiles.some((pr) => pr.owner === p.id && pr.kind === 'shield')) return false;
        shoot(s, p, 'shield', ax, ay, P.cap.shield);
        cd = P.cap.shield.cooldown;
      } else {
        p.guard = P.cap.guard.ticks;
        cd = P.cap.guard.cooldown;
      }
      break;
    case 'panther':
      if (slot === 'q') {
        startRush(p, P.panther.leap);
        cd = P.panther.leap.cooldown;
      } else {
        const c = P.panther.pulse;
        addZone(s, p, 'pulse', p.d.x, p.d.y, c.range + p.d.r, c.delay, c.delay);
        cd = c.cooldown;
      }
      break;
    case 'ironman':
      if (slot === 'q') {
        shoot(s, p, 'repulsor', ax, ay, P.ironman.repulsor);
        cd = P.ironman.repulsor.cooldown;
      } else {
        p.thrusters = P.ironman.thrusters.ticks;
        cd = P.ironman.thrusters.cooldown;
      }
      break;
    case 'flash':
      if (slot === 'q') {
        p.sprint = P.flash.sprint.ticks;
        cd = P.flash.sprint.cooldown;
      } else {
        const c = P.flash.trail;
        const z = addZone(s, p, 'trail', p.d.x, p.d.y, c.radius, 0, c.ticks);
        z.pts.push({ x: p.d.x, y: p.d.y });
        cd = c.cooldown;
      }
      break;
    case 'thor':
      if (slot === 'q') {
        shoot(s, p, 'hammer', ax, ay, P.thor.hammer);
        cd = P.thor.hammer.cooldown;
      } else {
        const c = P.thor.thunder;
        const [x, y] = inField(p.d.x + ax * (p.d.r + c.ahead), p.d.y + ay * (p.d.r + c.ahead));
        addZone(s, p, 'thunder', x, y, c.range, c.delay, c.delay);
        cd = c.cooldown;
      }
      break;
    case 'strange':
      if (slot === 'q') {
        const c = P.strange.deflect;
        s.zones = s.zones.filter((z) => !(z.owner === p.id && z.kind === 'deflect'));
        const [x, y] = inField(p.d.x + ax * c.ahead, p.d.y + ay * c.ahead);
        const z = addZone(s, p, 'deflect', x, y, c.radius, 0, c.ticks);
        z.dx = ax;
        z.dy = ay;
        cd = c.cooldown;
      } else {
        // sin destino legal no se gasta la recarga
        if (!blink(s, p)) return false;
        cd = P.strange.blink.cooldown;
      }
      break;
  }
  if (slot === 'q') p.cdQ = cd;
  else p.cdE = cd;
  s.events.push({ type: 'power', id: p.id, slot, hero: p.hero });
  return true;
}

function addZone(s: GameState, p: PlayerState, kind: Zone['kind'], x: number, y: number, r: number, delay: number, ticks: number): Zone {
  const z: Zone = { id: s.nextId++, kind, owner: p.id, team: p.team, x, y, r, delay, ticks, dx: 0, dy: 0, pts: [] };
  s.zones.push(z);
  return z;
}

/** Punto dentro del campo de juego (las zonas no se colocan fuera). */
function inField(x: number, y: number): [number, number] {
  const W = STADIUM.fieldW;
  const H = STADIUM.fieldH;
  return [Math.max(-W, Math.min(W, x)), Math.max(-H, Math.min(H, y))];
}

/** Desplazamiento corto a velocidad fija en la dirección apuntada; choca normalmente. */
function startRush(p: PlayerState, c: { distance: number; speed: number }): void {
  p.rush = Math.ceil(c.distance / c.speed);
  p.rushSpeed = c.distance / p.rush;
  p.rushDx = p.ax;
  p.rushDy = p.ay;
}

/** Discos (jugadores, pelota y postes) que un jugador no puede atravesar. */
function obstacles(s: GameState, p: PlayerState): { x: number; y: number; r: number }[] {
  return [...s.players.filter((o) => o !== p).map((o) => o.d), s.ball, ...stadium.posts];
}

/**
 * Distancia libre recorriendo desde (x, y) en (dx, dy) antes de tocar un disco
 * (barrido de círculo de radio r). Infinity si no toca nada.
 */
function freeDistance(s: GameState, p: PlayerState, dx: number, dy: number): number {
  let best = Infinity;
  for (const o of obstacles(s, p)) {
    const ox = o.x - p.d.x;
    const oy = o.y - p.d.y;
    const along = ox * dx + oy * dy;
    if (along <= 0) continue;
    const perp2 = ox * ox + oy * oy - along * along;
    const R2 = (o.r + p.d.r) ** 2;
    if (perp2 >= R2) continue;
    best = Math.min(best, along - Math.sqrt(R2 - perp2));
  }
  return best;
}

/** Desplazamiento (Hawkeye, Black Panther): se corta al quedar en contacto con algo. */
export function applyRush(s: GameState, p: PlayerState): void {
  const free = freeDistance(s, p, p.rushDx, p.rushDy);
  if (free < 0.5) {
    p.rush = 0;
    const terminal = LIMITS.playerInputSpeed;
    clampSpeed(p.d, terminal);
    return;
  }
  // velocidad fija: nunca más de lo que queda libre (no se clava en el obstáculo)
  const v = Math.min(p.rushSpeed, free);
  p.d.vx = p.rushDx * v;
  p.d.vy = p.rushDy * v;
}

/** Paso místico: teletransporte a la posición legal más lejana con recorrido libre. */
function blink(s: GameState, p: PlayerState): boolean {
  const c = cfg(s).strange.blink;
  let dist = Math.min(c.distance, freeDistance(s, p, p.ax, p.ay) - 0.5);
  // límites del jugador (no atraviesa las paredes exteriores)
  const W = STADIUM.width - p.d.r;
  const H = STADIUM.height - p.d.r;
  if (p.ax > 0) dist = Math.min(dist, (W - p.d.x) / p.ax);
  if (p.ax < 0) dist = Math.min(dist, (-W - p.d.x) / p.ax);
  if (p.ay > 0) dist = Math.min(dist, (H - p.d.y) / p.ay);
  if (p.ay < 0) dist = Math.min(dist, (-H - p.d.y) / p.ay);
  if (!(dist >= c.minDistance)) return false;
  const x0 = p.d.x;
  const y0 = p.d.y;
  p.d.x += p.ax * dist;
  p.d.y += p.ay * dist;
  s.events.push({ type: 'blink', id: p.id, x0, y0, x1: p.d.x, y1: p.d.y });
  return true;
}

/** Empuja un disco desde (cx, cy) con caída lineal hasta el borde del alcance. */
function radialPush(cx: number, cy: number, d: { x: number; y: number; vx: number; vy: number; r: number }, range: number, base: number, max: number, centerR = 0): boolean {
  const dx = d.x - cx;
  const dy = d.y - cy;
  const dist = Math.hypot(dx, dy);
  const gap = dist - centerR - d.r;
  if (gap > range || dist === 0 || base <= 0) return false;
  if (lineBlocked(cx, cy, d.x, d.y)) return false;
  const f = base * (1 - Math.max(0, gap) / range);
  d.vx += (dx / dist) * f;
  d.vy += (dy / dist) * f;
  clampSpeed(d, max);
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
  radialPush(p.d.x, p.d.y, s.ball, c.range, c.ballImpulse, LIMITS.ballMaxSpeed - 1, p.d.r);
  for (const o of s.players) {
    if (o.team === p.team) continue;
    if (radialPush(p.d.x, p.d.y, o.d, c.range, c.playerImpulse * pushFactor(s, o), LIMITS.playerMaxSpeed, p.d.r)) applySlow(o, c.stunPct, c.stunTicks);
  }
  s.events.push({ type: 'slam', x: p.d.x, y: p.d.y, r: c.range + p.d.r });
}

/** Zonas: anticipación, explosión, estela y desvío. */
function updateZones(s: GameState): void {
  const P = cfg(s);
  const b = s.ball;
  s.zones = s.zones.filter((z) => {
    const owner = findPlayer(s, z.owner);
    if (!owner) return false;
    switch (z.kind) {
      case 'pulse':
      case 'thunder': {
        if (z.kind === 'pulse') {
          z.x = owner.d.x;
          z.y = owner.d.y;
        }
        if (--z.delay > 0) return true;
        const c = z.kind === 'pulse' ? P.panther.pulse : P.thor.thunder;
        // el pulso nace del borde de Black Panther; el trueno, del centro de la zona
        const cr = z.kind === 'pulse' ? owner.d.r : 0;
        const reach = z.r - cr;
        if (radialPush(z.x, z.y, b, reach, c.ballImpulse, LIMITS.ballMaxSpeed - 1, cr)) s.lastTouch = z.owner;
        for (const o of s.players) {
          if (o.team === z.team) continue;
          radialPush(z.x, z.y, o.d, reach, c.playerImpulse * pushFactor(s, o), LIMITS.playerMaxSpeed, cr);
        }
        s.events.push({ type: 'slam', x: z.x, y: z.y, r: z.r });
        return false;
      }
      case 'trail': {
        const c = P.flash.trail;
        const age = c.ticks - z.ticks;
        if (age < c.dropTicks && age % c.dropEvery === 0 && age > 0) z.pts.push({ x: owner.d.x, y: owner.d.y });
        for (const o of s.players) {
          if (o.team === z.team) continue;
          if (z.pts.some((q) => Math.hypot(o.d.x - q.x, o.d.y - q.y) < z.r + o.d.r)) applySlow(o, c.slowPct, c.lingerTicks);
        }
        return --z.ticks > 0;
      }
      case 'deflect': {
        const c = P.strange.deflect;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 0.05 && Math.hypot(b.x - z.x, b.y - z.y) < z.r + b.r) {
          // gira la velocidad hacia la dirección fijada, como máximo maxAngle; misma rapidez
          const cur = Math.atan2(b.vy, b.vx);
          let diff = Math.atan2(z.dy, z.dx) - cur;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          const max = (c.maxAngle * Math.PI) / 180;
          const a = cur + Math.max(-max, Math.min(max, diff));
          b.vx = Math.cos(a) * sp;
          b.vy = Math.sin(a) * sp;
          s.lastTouch = z.owner;
          s.events.push({ type: 'hit', x: b.x, y: b.y, target: 'ball' });
          return false;
        }
        return --z.ticks > 0;
      }
    }
  });
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
    // al terminar el desplazamiento queda la velocidad normal de carrera, no la del poder
    if (p.rush > 0 && --p.rush === 0) clampSpeed(p.d, LIMITS.playerInputSpeed);
    if (p.evade > 0) p.evade--;
    if (p.guard > 0) p.guard--;
    if (p.thrusters > 0) p.thrusters--;
    if (p.sprint > 0) p.sprint--;
    if (p.slowTicks > 0) p.slowTicks--;
    if (p.slowTicks === 0) p.slowPct = 0;
  }
  updateProjectiles(s);
  updateTethers(s);
  updateZones(s);
}

function updateProjectiles(s: GameState): void {
  const keep = [];
  for (const pr of s.projectiles) {
    if (stepProjectile(s, pr)) keep.push(pr);
  }
  s.projectiles = keep;
}

/** Escudo que vuelve: sólo visual, va hacia el capitán y desaparece al llegar. */
function stepReturning(s: GameState, pr: Projectile): boolean {
  const o = findPlayer(s, pr.owner);
  if (!o) return false;
  const dx = o.d.x - pr.x;
  const dy = o.d.y - pr.y;
  const d = Math.hypot(dx, dy);
  const v = cfg(s).cap.shield.returnSpeed;
  if (d <= v + o.d.r) return false;
  pr.vx = (dx / d) * v;
  pr.vy = (dy / d) * v;
  pr.x += pr.vx;
  pr.y += pr.vy;
  return true;
}

/** Primer impacto del escudo (o fin del recorrido): empieza a volver. */
function shieldBack(pr: Projectile): boolean {
  pr.returning = true;
  return true;
}

/** Devuelve false si el proyectil desaparece. */
function stepProjectile(s: GameState, pr: Projectile): boolean {
  const P = cfg(s);
  if (pr.returning) return stepReturning(s, pr);
  const sp = Math.hypot(pr.vx, pr.vy);
  const n = Math.max(1, Math.ceil(sp / 3));
  // fin del recorrido u obstáculo: el escudo vuelve, el resto desaparece
  const stop = (): boolean => (pr.kind === 'shield' ? shieldBack(pr) : false);
  for (let i = 0; i < n; i++) {
    pr.x += pr.vx / n;
    pr.y += pr.vy / n;
    pr.dist += sp / n;
    if (pr.dist > pr.max) return stop();
    // paredes, redes y postes
    const probe = { x: pr.x, y: pr.y, vx: 0, vy: 0, r: pr.r, invMass: 1, bCoef: 0, damping: 1 };
    for (const w of stadium.ballWalls) {
      if (collideSeg(probe, w)) {
        s.events.push({ type: 'hit', x: pr.x, y: pr.y, target: 'wall' });
        return stop();
      }
    }
    for (const post of stadium.posts) {
      if (Math.hypot(post.x - pr.x, post.y - pr.y) < post.r + pr.r) {
        s.events.push({ type: 'hit', x: pr.x, y: pr.y, target: 'wall' });
        return stop();
      }
    }
    if (Math.abs(pr.x) > STADIUM.width || Math.abs(pr.y) > STADIUM.height) return stop();
    // pelota (la descarga de Black Widow la atraviesa)
    const b = s.ball;
    if (pr.kind !== 'shock' && Math.hypot(b.x - pr.x, b.y - pr.y) < b.r + pr.r) {
      if (pr.kind === 'web') {
        s.tethers = s.tethers.filter((t) => !(t.owner === pr.owner && t.kind !== 'grapple'));
        s.tethers.push({ owner: pr.owner, kind: 'web', target: null, ticks: P.spider.web.pullTicks });
        s.events.push({ type: 'tether', id: pr.owner });
      } else if (pr.kind === 'hook') {
        s.tethers = s.tethers.filter((t) => !(t.owner === pr.owner && t.kind === 'grapple'));
        s.tethers.push({ owner: pr.owner, kind: 'grapple', target: null, ticks: P.batman.grapple.pullTicks });
        s.events.push({ type: 'tether', id: pr.owner });
      } else {
        // impulso en la dirección del disparo (un solo impacto)
        const impulse = {
          batarang: P.batman.batarang.ballImpulse,
          arrow: P.hawkeye.arrow.ballImpulse,
          repulsor: P.ironman.repulsor.ballImpulse,
          shield: P.cap.shield.ballImpulse,
          hammer: P.thor.hammer.ballImpulse,
        }[pr.kind];
        const k = impulse / sp;
        b.vx += pr.vx * k;
        b.vy += pr.vy * k;
        clampSpeed(b, LIMITS.ballMaxSpeed - 1);
        s.lastTouch = pr.owner;
      }
      s.events.push({ type: 'hit', x: pr.x, y: pr.y, target: 'ball' });
      return pr.kind === 'shield' ? shieldBack(pr) : false;
    }
    // el gancho sólo busca la pelota: atraviesa a los jugadores
    if (pr.kind === 'hook') continue;
    for (const o of s.players) {
      if (o.id === pr.owner) continue;
      if (Math.hypot(o.d.x - pr.x, o.d.y - pr.y) >= o.d.r + pr.r) continue;
      const rival = o.team !== pr.team;
      switch (pr.kind) {
        case 'arrow':
        case 'repulsor':
          // cualquier jugador frena la flecha y el repulsor, sin efecto
          break;
        case 'batarang':
          if (!rival) continue;
          applySlow(o, P.batman.batarang.slowPct, P.batman.batarang.slowTicks);
          break;
        case 'shock':
          if (!rival) continue;
          applySlow(o, P.widow.shock.slowPct, P.widow.shock.slowTicks);
          break;
        case 'shield':
          if (!rival) continue;
          s.events.push({ type: 'hit', x: pr.x, y: pr.y, target: 'player' });
          return shieldBack(pr);
        case 'hammer': {
          if (!rival) continue;
          const k = (P.thor.hammer.playerImpulse * pushFactor(s, o)) / sp;
          o.d.vx += pr.vx * k;
          o.d.vy += pr.vy * k;
          clampSpeed(o.d, LIMITS.playerMaxSpeed);
          break;
        }
        case 'web':
          // la telaraña se corta con cualquiera; en Súper se pega a los rivales
          if (rival && P.spider.web.grabsRivals) {
            s.tethers = s.tethers.filter((t) => !(t.owner === pr.owner && t.kind !== 'grapple'));
            s.tethers.push({ owner: pr.owner, kind: 'rival', target: o.id, ticks: P.spider.web.rivalPullTicks });
            s.events.push({ type: 'tether', id: pr.owner });
          }
          break;
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
        pullToward(end, p.d.x, p.d.y, c.rivalPullAccel * pushFactor(s, o!), c.rivalPullMaxSpeed);
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
  s.zones = [];
  for (const p of s.players) {
    p.dash = 0;
    p.fury = 0;
    p.superShot = 0;
    p.superSpeed = 0;
    p.rush = 0;
    p.evade = 0;
    p.guard = 0;
    p.thrusters = 0;
    p.sprint = 0;
    p.slowPct = 0;
    p.slowTicks = 0;
    p.slowNow = 0;
  }
}
