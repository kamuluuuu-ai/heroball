// Poderes de los héroes. Todo corre dentro de la simulación (servidor
// autoritativo); el cliente sólo predice su propio jugador con el mismo código.
// Los valores dependen del modo: Héroes (POWERS) o Súper (SUPER_POWERS).
//
// Reglas de conflicto (orden determinista: jugadores en orden de la lista,
// luego proyectiles, hilos y zonas en orden de creación):
// - La protección del Capitán tiene prioridad: mientras dure, ningún poder
//   modifica la pelota (los proyectiles que la tocan se consumen sin efecto).
//   No deshace un impacto ya resuelto en un tick anterior.
// - Ralentizaciones y resistencias no se suman: prevalece la más fuerte.
// - Los stuns no se apilan; al terminar uno hay inmunidad (STUN.immuneTicks).
// - Q y E de Flash no se multiplican: se usa el mayor modificador activo.
// - Un mismo objetivo recibe a lo sumo un impacto por proyectil (aunque se
//   procese en varios subpasos) y un impulso por explosión o haz.
// - Lo sorteado (dirección del misil) sale del generador del estado y sólo
//   avanza al resolverse: reenviar mensajes o reconciliar no lo vuelve a sortear.
import { LIMITS, PLAYER, POWER_LIMITS, STADIUM, STUN, powersFor, type PowerConfig } from './config';
import { clampSpeed, collideSeg, lineBlocked, stadium } from './physics';
import type { GameState, PlayerState, Projectile, Zone } from './types';

const cfg = (s: GameState): PowerConfig => powersFor(s.mode);

function findPlayer(s: GameState, id: string): PlayerState | undefined {
  return s.players.find((p) => p.id === id);
}

/** Generador pseudoaleatorio del estado (mulberry32): mismo estado, mismo resultado. */
export function nextRandom(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Mayor multiplicador activo de Flash (Q y E no se multiplican entre sí). */
function flashMult(c: PowerConfig, p: PlayerState, k: 'accelMult' | 'speedMult'): number {
  let m = 1;
  if (p.sprint > 0) m = Math.max(m, c.flash.sprint[k]);
  if (p.trailBoost > 0) m = Math.max(m, c.flash.trail[k]);
  return m;
}

/** Multiplicador de aceleración por efectos. Las ralentizaciones no se suman: prevalece la más fuerte. */
export function accelMult(s: GameState, p: PlayerState): number {
  const c = cfg(s);
  const slow = Math.max(p.slowTicks > 0 ? p.slowPct : 0, p.capSlowTicks > 0 ? p.capSlow : 0);
  p.slowNow = slow;
  let m = 1 - slow;
  if (p.fury > 0) m *= c.hulk.fury.accelMult;
  if (p.superSpeed > 0) m *= c.superman.superSpeed.mult;
  m *= flashMult(c, p, 'accelMult');
  return m;
}

/**
 * Multiplicador de la velocidad máxima por movimiento propio. La estela de
 * Flash la reduce: como el tope nunca recorta la velocidad que ya se tiene
 * (sólo impide acelerar por encima), al entrar se desacelera por el
 * rozamiento normal, sin saltos y sin borrar empujes externos.
 */
export function speedLimitMult(s: GameState, p: PlayerState): number {
  const c = cfg(s);
  let m = flashMult(c, p, 'speedMult');
  if (p.superSpeed > 0) m *= c.superman.superSpeed.mult;
  if (p.capSlowTicks > 0) m *= 1 - p.capSlow;
  return m;
}

/**
 * Factor de los empujes de poderes que recibe un jugador (dash Súper de Black
 * Widow, llegada del portal Súper). Las colisiones no cambian.
 */
export function pushFactor(_s: GameState, o: PlayerState): number {
  return 1 - (o.evade > 0 ? o.evadeResist : 0);
}

export function kickMult(s: GameState, p: PlayerState): number {
  return p.fury > 0 ? cfg(s).hulk.fury.kickMult : 1;
}

/** ¿La pelota tiene la protección del Capitán? */
export function ballGuarded(s: GameState): boolean {
  return s.ballShield > 0;
}

/** Impulso a la pelota (en unidades de velocidad × masa). No hace nada si está protegida. */
function pushBall(s: GameState, ux: number, uy: number, impulse: number, owner: string): boolean {
  if (ballGuarded(s)) return false;
  const b = s.ball;
  b.vx += ux * impulse * b.invMass;
  b.vy += uy * impulse * b.invMass;
  clampSpeed(b, LIMITS.ballMaxSpeed - 1);
  s.lastTouch = owner;
  return true;
}

/** Impulso a un jugador según su masa y su resistencia a poderes, con tope de velocidad. */
function pushPlayer(s: GameState, o: PlayerState, ux: number, uy: number, impulse: number): void {
  const k = impulse * o.d.invMass * pushFactor(s, o);
  o.d.vx += ux * k;
  o.d.vy += uy * k;
  clampSpeed(o.d, LIMITS.playerMaxSpeed);
}

/** Aturde a un jugador. No se apila ni se aplica durante la inmunidad posterior. */
export function applyStun(s: GameState, o: PlayerState, ticks: number): boolean {
  if (ticks <= 0 || o.stun > 0 || o.stunImmune > 0) return false;
  o.stun = ticks;
  o.kickArmed = false;
  o.rush = 0;
  o.dash = 0;
  // un stun interrumpe la canalización del portal
  s.zones = s.zones.filter((z) => !(z.owner === o.id && z.kind === 'portal'));
  s.events.push({ type: 'stun', id: o.id, ticks });
  return true;
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

/** Medio ángulo (grados) delante de la dirección apuntada donde los disparos buscan objetivo. */
const AIM_CONE = 90;

/**
 * Qué busca el autoapuntado de cada Q que se dispara: sólo los objetivos a los
 * que el proyectil les hace algo (la flecha busca la pelota; la descarga
 * atraviesa la pelota y frena rivales). null: la Q no se autoapunta. El láser
 * anticipa el objetivo según su aviso (velocidad equivalente alcance/aviso);
 * sin objetivo va en la última dirección de movimiento.
 */
function aimSpec(P: PowerConfig, hero: PlayerState['hero']): { range: number; speed: number; cone: number; ball: boolean; rivals: boolean } | null {
  switch (hero) {
    case 'spider':
      return P.spider.web.autoAim ? { ...P.spider.web, cone: 180, ball: true, rivals: P.spider.web.grabsRivals } : null;
    case 'batman':
      return P.batman.batarang.autoAim ? { ...P.batman.batarang, cone: P.batman.batarang.autoAimCone, ball: true, rivals: true } : null;
    case 'superman':
      return { range: P.superman.laser.range, speed: P.superman.laser.range / Math.max(1, P.superman.laser.windup), cone: AIM_CONE, ball: true, rivals: true };
    case 'hawkeye':
      return { ...P.hawkeye.arrow, cone: AIM_CONE, ball: true, rivals: false };
    case 'widow':
      return { ...P.widow.shock, cone: AIM_CONE, ball: false, rivals: true };
    case 'cap':
      return { ...P.cap.shield, cone: AIM_CONE, ball: true, rivals: true };
    case 'ironman':
      return { ...P.ironman.repulsor, cone: AIM_CONE, ball: true, rivals: true };
    case 'thor':
      return { ...P.thor.hammer, cone: AIM_CONE, ball: true, rivals: true };
    default:
      return null;
  }
}

/**
 * Autoapuntado de las Q que se disparan (Spider-Man, Batman, Hawkeye, Black
 * Widow, Capitán América, Iron Man y Thor). Devuelve el objetivo y la dirección
 * de lanzamiento, anticipando el movimiento del objetivo; null si no hay
 * objetivo válido (se usa la dirección apuntada).
 */
export function autoAim(s: GameState, p: PlayerState): { target: AimTarget; dx: number; dy: number } | null {
  const spec = aimSpec(cfg(s), p.hero);
  if (!spec) return null;
  const { range, speed, cone, rivals } = spec;

  const cands: { t: AimTarget; vx: number; vy: number; r: number }[] = [];
  if (spec.ball) cands.push({ t: { kind: 'ball', id: null, x: s.ball.x, y: s.ball.y }, vx: s.ball.vx, vy: s.ball.vy, r: s.ball.r });
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

/** Rayo paralizante de Thor: rival más cercano dentro del cono frontal, del alcance y a la vista. */
export function boltTarget(s: GameState, p: PlayerState): PlayerState | null {
  const c = cfg(s).thor.bolt;
  const cos = Math.cos((c.cone * Math.PI) / 180);
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const o of s.players) {
    if (o.team === p.team) continue;
    const dx = o.d.x - p.d.x;
    const dy = o.d.y - p.d.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist - p.d.r - o.d.r > c.range) continue;
    if ((dx * p.ax + dy * p.ay) / dist < cos - 1e-9) continue;
    if (lineBlocked(p.d.x, p.d.y, o.d.x, o.d.y)) continue;
    // empate: id estable
    if (dist < bestD || (dist === bestD && best && o.id < best.id)) {
      best = o;
      bestD = dist;
    }
  }
  return best;
}

/** ¿La pelota está al alcance (borde a borde) y a la vista? */
function ballInReach(s: GameState, p: PlayerState, range: number): boolean {
  const b = s.ball;
  return Math.hypot(b.x - p.d.x, b.y - p.d.y) - p.d.r - b.r <= range && !lineBlocked(p.d.x, p.d.y, b.x, b.y);
}

function shoot(s: GameState, p: PlayerState, kind: Projectile['kind'], ax: number, ay: number, c: { speed: number; radius: number; range: number }): Projectile {
  const pr: Projectile = {
    id: s.nextId++, kind, owner: p.id, team: p.team,
    x: p.d.x + ax * p.d.r, y: p.d.y + ay * p.d.r, vx: ax * c.speed, vy: ay * c.speed,
    r: c.radius, dist: 0, max: c.range,
  };
  s.projectiles.push(pr);
  return pr;
}

/**
 * ¿Sigue activo el lanzamiento, la canalización o el efecto propio de esa
 * habilidad? Lo usa el HUD («ACTIVA») y, sin cooldowns, impide reactivarla
 * hasta que termine (no es un cooldown: es un bloqueo de ejecución).
 */
export function powerActive(s: GameState, p: PlayerState, slot: 'q' | 'e'): boolean {
  const proj = (...kinds: Projectile['kind'][]) => s.projectiles.some((pr) => pr.owner === p.id && kinds.includes(pr.kind));
  const zone = (kind: Zone['kind']) => s.zones.some((z) => z.owner === p.id && z.kind === kind);
  const q = slot === 'q';
  switch (p.hero) {
    case 'spider': return q ? proj('web') || s.tethers.some((t) => t.owner === p.id && t.kind !== 'grapple') : p.dash > 0;
    case 'batman': return q ? proj('batarang') : proj('hook') || s.tethers.some((t) => t.owner === p.id && t.kind === 'grapple');
    case 'hulk': return q ? false : p.fury > 0;
    case 'superman': return q ? zone('laser') : p.superSpeed > 0;
    case 'hawkeye': return q ? proj('arrow') : p.rush > 0;
    case 'widow': return q ? proj('shock') : p.rush > 0;
    case 'cap': return q ? proj('shield') : s.ballShield > 0 && s.ballShieldBy === p.id;
    case 'panther': return q ? p.rush > 0 : zone('pulse');
    case 'ironman': return q ? proj('repulsor') : zone('missile');
    case 'flash': return q ? p.sprint > 0 : p.trailBoost > 0;
    case 'thor': return q ? proj('hammer') : zone('bolt');
    case 'strange': return q ? false : zone('portal');
  }
}

/** Intenta activar Q o E. Devuelve true si se activó (y entonces corre la recarga). */
export function activate(s: GameState, p: PlayerState, slot: 'q' | 'e'): boolean {
  if (p.stun > 0) return false;
  if (slot === 'q' ? p.cdQ > 0 : p.cdE > 0) return false;
  if (s.noCd && powerActive(s, p, slot)) return false;
  // topes técnicos: sin lugar para más objetos, no se activa (ni gasta recarga)
  if (s.projectiles.length >= POWER_LIMITS.maxProjectiles - 3 || s.zones.length >= POWER_LIMITS.maxZones) return false;
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
        const c = P.superman.laser;
        // dirección fijada al activar (autoapuntada); el origen sigue a Superman durante el aviso
        const z = addZone(s, p, 'laser', p.d.x, p.d.y, c.halfWidth, c.windup, c.windup + c.beamTicks);
        z.dx = ax;
        z.dy = ay;
        z.len = c.range;
        cd = c.cooldown;
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
        const c = P.widow.dash;
        const speed = LIMITS.playerInputSpeed * c.speedMult;
        startRush(p, { distance: speed * c.ticks, speed });
        if (c.resist > 0) {
          p.evade = Math.max(p.evade, c.ticks);
          p.evadeResist = Math.max(p.evadeResist, c.resist);
        }
        cd = c.cooldown;
      }
      break;
    case 'cap':
      if (slot === 'q') {
        const c = P.cap.shield;
        // un solo escudo en vuelo
        if (s.projectiles.some((pr) => pr.owner === p.id && pr.kind === 'shield')) return false;
        const pr = shoot(s, p, 'shield', ax, ay, c);
        pr.hits = [];
        pr.target = null;
        pr.life = c.maxTicks;
        cd = c.cooldown;
      } else {
        const c = P.cap.protect;
        if (!ballInReach(s, p, c.range)) {
          s.events.push({ type: 'fizzle', id: p.id, slot });
          return false;
        }
        protectBall(s, p, c.ticks);
        cd = c.cooldown;
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
        const c = P.ironman.repulsor;
        const pr = shoot(s, p, 'repulsor', ax, ay, c);
        pr.delay = c.windup;
        cd = c.cooldown;
      } else {
        const c = P.ironman.missile;
        if (!ballInReach(s, p, c.range)) {
          s.events.push({ type: 'fizzle', id: p.id, slot });
          return false;
        }
        // el punto de impacto queda fijo: no persigue a la pelota
        addZone(s, p, 'missile', s.ball.x, s.ball.y, c.radius, c.delay, c.delay + MISSILE_AFTER);
        cd = c.cooldown;
      }
      break;
    case 'flash':
      if (slot === 'q') {
        p.sprint = P.flash.sprint.ticks;
        cd = P.flash.sprint.cooldown;
      } else {
        const c = P.flash.trail;
        p.trailBoost = c.ticks;
        const z = addZone(s, p, 'trail', p.d.x, p.d.y, c.radius, 0, c.ticks + c.segTicks);
        z.pts.push({ x: p.d.x, y: p.d.y, t: s.tick });
        cd = c.cooldown;
      }
      break;
    case 'thor':
      if (slot === 'q') {
        shoot(s, p, 'hammer', ax, ay, P.thor.hammer);
        cd = P.thor.hammer.cooldown;
      } else {
        const c = P.thor.bolt;
        const t = boltTarget(s, p);
        // sin objetivo válido no se gasta la recarga
        if (!t) {
          s.events.push({ type: 'fizzle', id: p.id, slot });
          return false;
        }
        addZone(s, p, 'bolt', t.d.x, t.d.y, c.radius, c.delay, c.delay + c.strikeTicks);
        cd = c.cooldown;
      }
      break;
    case 'strange':
      if (slot === 'q') {
        if (!rewind(s, p)) {
          s.events.push({ type: 'fizzle', id: p.id, slot });
          return false;
        }
        cd = P.strange.rewind.cooldown;
      } else {
        const c = P.strange.portal;
        const goalX = p.half * (STADIUM.fieldW - c.goalOffset);
        const spot = freeSpot(s, goalX, 0, p.d.r, 'player', p);
        if (!spot) {
          s.events.push({ type: 'fizzle', id: p.id, slot });
          return false;
        }
        const z = addZone(s, p, 'portal', spot[0], spot[1], p.d.r, c.channel, c.channel);
        z.pts.push({ x: p.d.x, y: p.d.y, t: s.tick });
        cd = c.cooldown;
      }
      break;
  }
  if (s.noCd) cd = 0;
  if (slot === 'q') p.cdQ = cd;
  else p.cdE = cd;
  s.events.push({ type: 'power', id: p.id, slot, hero: p.hero });
  return true;
}

/** Ticks que el misil queda dibujado después de caer (muestra la dirección sorteada). */
const MISSILE_AFTER = 30;

function addZone(s: GameState, p: PlayerState, kind: Zone['kind'], x: number, y: number, r: number, delay: number, ticks: number): Zone {
  const z: Zone = { id: s.nextId++, kind, owner: p.id, team: p.team, x, y, r, delay, ticks, dx: 0, dy: 0, len: 0, ang: null, pts: [] };
  s.zones.push(z);
  return z;
}

/** Protección de la pelota: no se suma (vale la mayor duración restante) y quita efectos de poder activos sobre ella. */
function protectBall(s: GameState, p: PlayerState, ticks: number): void {
  if (ticks >= s.ballShield) {
    s.ballShield = ticks;
    s.ballShieldMax = ticks;
    s.ballShieldBy = p.id;
  }
  // sin cambiar posición ni velocidad: sólo se cortan atracción y electricidad
  s.tethers = s.tethers.filter((t) => !(t.kind === 'web' && t.target === null));
  s.ballElec = 0;
  s.ballElecHit = [];
  s.events.push({ type: 'protect', id: p.id });
}

/**
 * Posición legal libre más cercana a (x, y) para un disco de radio r: sin
 * solaparse con jugadores (salvo `self`), pelota (para jugadores) ni postes, y
 * dentro de los límites (jugador: estadio; pelota: cancha, nunca dentro de un
 * arco). Búsqueda determinista en anillos alrededor del punto.
 */
function freeSpot(s: GameState, x: number, y: number, r: number, kind: 'player' | 'ball', self?: PlayerState): [number, number] | null {
  const W = (kind === 'player' ? STADIUM.width : STADIUM.fieldW) - r;
  const H = (kind === 'player' ? STADIUM.height : STADIUM.fieldH) - r;
  const ok = (cx: number, cy: number): boolean => {
    if (Math.abs(cx) > W || Math.abs(cy) > H) return false;
    for (const o of s.players) {
      if (o !== self && Math.hypot(o.d.x - cx, o.d.y - cy) < o.d.r + r + 0.5) return false;
    }
    if (kind === 'player' && Math.hypot(s.ball.x - cx, s.ball.y - cy) < s.ball.r + r + 0.5) return false;
    for (const q of stadium.posts) if (Math.hypot(q.x - cx, q.y - cy) < q.r + r + 0.5) return false;
    return true;
  };
  if (ok(x, y)) return [x, y];
  const step = r * 0.6;
  for (let ring = 1; ring <= 8; ring++) {
    const n = 8 + ring * 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const cx = x + Math.cos(a) * step * ring;
      const cy = y + Math.sin(a) * step * ring;
      if (ok(cx, cy)) return [cx, cy];
    }
  }
  return null;
}

/**
 * Rebobinar (Doctor Strange): la pelota vuelve a la posición y velocidad de
 * hace `ticks` (o lo más viejo de esta jugada). Sólo posición y velocidad: no
 * restaura poderes, marcador, reloj ni recargas. Se rechaza sin historial,
 * con la pelota protegida o sin destino legal cercano.
 */
function rewind(s: GameState, p: PlayerState): boolean {
  const c = cfg(s).strange.rewind;
  if (ballGuarded(s) || !ballInReach(s, p, c.range)) return false;
  const count = s.ballHist.length / 4;
  if (count === 0) return false;
  const i = Math.max(0, count - c.ticks) * 4;
  const h = s.ballHist;
  const b = s.ball;
  const spot = freeSpot(s, h[i], h[i + 1], b.r, 'ball');
  if (!spot) return false;
  const x0 = b.x;
  const y0 = b.y;
  b.x = spot[0];
  b.y = spot[1];
  b.vx = h[i + 2];
  b.vy = h[i + 3];
  s.ballWarp++;
  s.lastTouch = p.id;
  // la jugada sigue desde ahí: el historial posterior ya no corresponde
  s.ballHist = h.slice(0, i);
  s.events.push({ type: 'rewind', id: p.id, x0, y0, x1: b.x, y1: b.y });
  return true;
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

/** Desplazamiento (Hawkeye, Black Panther, dash de Black Widow): se corta al quedar en contacto con algo. */
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
  if (!ballGuarded(s) && radialPush(p.d.x, p.d.y, s.ball, c.range, c.ballImpulse, LIMITS.ballMaxSpeed - 1, p.d.r)) s.lastTouch = p.id;
  for (const o of s.players) {
    if (o.team === p.team) continue;
    if (radialPush(p.d.x, p.d.y, o.d, c.range, c.playerImpulse * pushFactor(s, o), LIMITS.playerMaxSpeed, p.d.r)) applySlow(o, c.stunPct, c.stunTicks);
  }
  s.events.push({ type: 'slam', x: p.d.x, y: p.d.y, r: c.range + p.d.r });
}

/**
 * Explosión radial: alcanza a todo disco que se solape con el círculo (lo mismo
 * que se dibuja), con fuerza que cae linealmente desde el centro hasta el borde,
 * un impulso por objetivo y sin atravesar paredes ni postes. Empuja a ambos
 * equipos, incluido quien la provocó.
 */
function blast(s: GameState, x: number, y: number, radius: number, ballImp: number, playerImp: number, owner: string, fx: number, fy: number): void {
  const dir = (dx: number, dy: number): [number, number] => {
    const d = Math.hypot(dx, dy);
    return d > 1e-6 ? [dx / d, dy / d] : [fx, fy];
  };
  const b = s.ball;
  const gb = Math.hypot(b.x - x, b.y - y) - b.r;
  if (gb <= radius && !lineBlocked(x, y, b.x, b.y)) {
    const [ux, uy] = dir(b.x - x, b.y - y);
    pushBall(s, ux, uy, ballImp * (1 - Math.max(0, gb) / radius), owner);
  }
  for (const o of s.players) {
    const g = Math.hypot(o.d.x - x, o.d.y - y) - o.d.r;
    if (g > radius || lineBlocked(x, y, o.d.x, o.d.y)) continue;
    const [ux, uy] = dir(o.d.x - x, o.d.y - y);
    pushPlayer(s, o, ux, uy, playerImp * (1 - Math.max(0, g) / radius));
  }
  s.events.push({ type: 'boom', x, y, r: radius, kind: 'arrow' });
}

/** Distancia libre de un rayo desde (x, y) en (dx, dy) hasta la primera pared, red o poste (máximo `max`). */
function rayFree(x: number, y: number, dx: number, dy: number, max: number): number {
  let best = max;
  for (const w of stadium.ballWalls) {
    const ex = w.bx - w.ax;
    const ey = w.by - w.ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((w.ax - x) * ey - (w.ay - y) * ex) / den;
    const u = ((w.ax - x) * dy - (w.ay - y) * dx) / den;
    if (t >= 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  for (const q of stadium.posts) {
    const ox = q.x - x;
    const oy = q.y - y;
    const along = ox * dx + oy * dy;
    const perp2 = ox * ox + oy * oy - along * along;
    if (along > 0 && perp2 < q.r * q.r) best = Math.min(best, along - Math.sqrt(q.r * q.r - perp2));
  }
  return Math.max(0, best);
}

/**
 * Visión láser: haz recto de medio ancho z.r desde el borde de Superman. Un
 * objetivo cuenta si su disco toca la franja del haz antes del primer
 * obstáculo. Héroes: sólo el primero (pelota o rival). Súper: atraviesa
 * jugadores y sigue (cada objetivo recibe un único impacto). La pelota
 * protegida se golpea sin efecto y detiene el haz.
 */
function fireLaser(s: GameState, z: Zone, owner: PlayerState): void {
  const c = cfg(s).superman.laser;
  const ox = owner.d.x + z.dx * owner.d.r;
  const oy = owner.d.y + z.dy * owner.d.r;
  z.x = ox;
  z.y = oy;
  const free = rayFree(ox, oy, z.dx, z.dy, c.range);
  const along = (x: number, y: number, r: number): number | null => {
    const rx = x - ox;
    const ry = y - oy;
    const t = rx * z.dx + ry * z.dy;
    if (t < -r || t > free + r) return null;
    if (Math.abs(rx * z.dy - ry * z.dx) > z.r + r) return null;
    return Math.max(0, t);
  };
  const hits: { t: number; id: string; o: PlayerState | null }[] = [];
  const tb = along(s.ball.x, s.ball.y, s.ball.r);
  if (tb !== null && !lineBlocked(ox, oy, s.ball.x, s.ball.y)) hits.push({ t: tb, id: '', o: null });
  for (const o of s.players) {
    if (o.team === owner.team) continue;
    const t = along(o.d.x, o.d.y, o.d.r);
    if (t !== null) hits.push({ t, id: o.id, o });
  }
  hits.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  let len = free;
  for (const h of hits) {
    if (h.o) {
      pushPlayer(s, h.o, z.dx, z.dy, c.playerImpulse);
      s.events.push({ type: 'hit', x: h.o.d.x, y: h.o.d.y, target: 'player' });
    } else if (pushBall(s, z.dx, z.dy, c.ballImpulse, owner.id)) {
      s.events.push({ type: 'hit', x: s.ball.x, y: s.ball.y, target: 'ball' });
    } else {
      s.events.push({ type: 'blocked', x: s.ball.x, y: s.ball.y });
    }
    // sin atravesar, o la pelota (protegida o no) siempre termina el haz súper
    if (!c.pierce || !h.o) {
      len = h.t;
      break;
    }
  }
  z.len = len;
}

/** Zonas: anticipación, resolución en un único tick y resto visible del resultado. */
function updateZones(s: GameState): void {
  const P = cfg(s);
  const b = s.ball;
  s.zones = s.zones.filter((z) => {
    const owner = findPlayer(s, z.owner);
    if (!owner) return false;
    switch (z.kind) {
      case 'pulse': {
        z.x = owner.d.x;
        z.y = owner.d.y;
        if (--z.delay > 0) return true;
        const c = P.panther.pulse;
        // el pulso nace del borde de Black Panther
        const cr = owner.d.r;
        const reach = z.r - cr;
        if (!ballGuarded(s) && radialPush(z.x, z.y, b, reach, c.ballImpulse, LIMITS.ballMaxSpeed - 1, cr)) s.lastTouch = z.owner;
        for (const o of s.players) {
          if (o.team === z.team) continue;
          radialPush(z.x, z.y, o.d, reach, c.playerImpulse * pushFactor(s, o), LIMITS.playerMaxSpeed, cr);
        }
        s.events.push({ type: 'slam', x: z.x, y: z.y, r: z.r });
        return false;
      }
      case 'laser':
        if (z.delay > 0) {
          // aviso: el origen acompaña a Superman, la dirección ya está fijada
          z.x = owner.d.x + z.dx * owner.d.r;
          z.y = owner.d.y + z.dy * owner.d.r;
          z.len = rayFree(z.x, z.y, z.dx, z.dy, P.superman.laser.range);
          if (--z.delay === 0) fireLaser(s, z, owner);
        }
        return --z.ticks > 0;
      case 'missile':
        if (z.delay > 0 && --z.delay === 0) {
          const c = P.ironman.missile;
          // sólo la pelota: si su centro sigue dentro de la zona marcada
          if (Math.hypot(b.x - z.x, b.y - z.y) <= z.r) {
            if (ballGuarded(s)) s.events.push({ type: 'blocked', x: b.x, y: b.y });
            else {
              // un único sorteo, en la autoridad, al resolver
              z.ang = nextRandom(s) * Math.PI * 2;
              pushBall(s, Math.cos(z.ang), Math.sin(z.ang), c.ballImpulse, z.owner);
            }
          }
          s.events.push({ type: 'boom', x: z.x, y: z.y, r: z.r, kind: 'missile' });
        }
        return --z.ticks > 0;
      case 'bolt':
        if (z.delay > 0 && --z.delay === 0) {
          for (const o of s.players) {
            if (o.team !== z.team && Math.hypot(o.d.x - z.x, o.d.y - z.y) < z.r + o.d.r) applyStun(s, o, P.thor.bolt.stunTicks);
          }
        }
        return --z.ticks > 0;
      case 'trail': {
        const c = P.flash.trail;
        if (owner.trailBoost > 0 && s.tick % c.dropEvery === 0) z.pts.push({ x: owner.d.x, y: owner.d.y, t: s.tick });
        z.pts = z.pts.filter((q) => s.tick - q.t < c.segTicks);
        for (const o of s.players) {
          if (o.team === z.team) continue;
          if (z.pts.some((q) => Math.hypot(o.d.x - q.x, o.d.y - q.y) < z.r + o.d.r)) {
            // frena aceleración y velocidad máxima; persiste `lingerTicks` al salir
            applySlow(o, c.slowPct, c.lingerTicks);
            o.capSlow = Math.max(o.capSlowTicks > 0 ? o.capSlow : 0, c.slowPct);
            o.capSlowTicks = Math.max(o.capSlowTicks, c.lingerTicks);
          }
        }
        return --z.ticks > 0 || z.pts.length > 0;
      }
      case 'portal': {
        z.pts[0] = { x: owner.d.x, y: owner.d.y, t: z.pts[0]?.t ?? s.tick };
        if (--z.delay > 0) return true;
        const P2 = P.strange.portal;
        // destino fijado al activar; si ahora está ocupado, el lugar legal más cercano
        const spot = freeSpot(s, z.x, z.y, owner.d.r, 'player', owner);
        if (!spot) {
          // sin destino legal: se cancela y no consume la recarga
          owner.cdE = 0;
          s.events.push({ type: 'fizzle', id: owner.id, slot: 'e' });
          return false;
        }
        const x0 = owner.d.x;
        const y0 = owner.d.y;
        owner.d.x = spot[0];
        owner.d.y = spot[1];
        owner.d.vx = 0;
        owner.d.vy = 0;
        owner.rush = 0;
        owner.warp++;
        if (P2.resistTicks > 0) {
          owner.evade = Math.max(owner.evade, P2.resistTicks);
          owner.evadeResist = Math.max(owner.evadeResist, P2.resist);
        }
        s.events.push({ type: 'blink', id: owner.id, x0, y0, x1: owner.d.x, y1: owner.d.y });
        return false;
      }
    }
  });
}

/** Temporizadores, proyectiles, hilos, zonas y pelota. Se llama una vez por tick tras la física. */
export function updatePowers(s: GameState): void {
  for (const p of s.players) {
    if (p.cdQ > 0) p.cdQ--;
    if (p.cdE > 0) p.cdE--;
    if (p.dash > 0) p.dash--;
    if (p.fury > 0) p.fury--;
    if (p.superSpeed > 0) p.superSpeed--;
    // al terminar el desplazamiento queda la velocidad normal de carrera, no la del poder
    if (p.rush > 0 && --p.rush === 0) clampSpeed(p.d, LIMITS.playerInputSpeed);
    if (p.evade > 0 && --p.evade === 0) p.evadeResist = 0;
    if (p.sprint > 0) p.sprint--;
    if (p.trailBoost > 0) p.trailBoost--;
    if (p.slowTicks > 0) p.slowTicks--;
    if (p.slowTicks === 0) p.slowPct = 0;
    if (p.capSlowTicks > 0 && --p.capSlowTicks === 0) p.capSlow = 0;
    if (p.stun > 0) {
      if (--p.stun === 0) p.stunImmune = STUN.immuneTicks;
    } else if (p.stunImmune > 0) p.stunImmune--;
  }
  if (s.ballShield > 0 && --s.ballShield === 0) s.ballShieldBy = null;
  updateProjectiles(s);
  updateTethers(s);
  updateZones(s);
  updateBall(s);
}

/** Electricidad por contacto físico e historial para rebobinar. */
function updateBall(s: GameState): void {
  const b = s.ball;
  if (s.ballElec > 0) {
    for (const p of s.players) {
      if (s.ballElecHit.includes(p.id)) continue;
      // contacto físico real (los rayos dibujados no cuentan)
      if (Math.hypot(p.d.x - b.x, p.d.y - b.y) - p.d.r - b.r <= 1 && applyStun(s, p, s.ballElecStun)) s.ballElecHit.push(p.id);
    }
    if (--s.ballElec === 0) s.ballElecHit = [];
  }
  const max = cfg(s).strange.rewind.ticks * 4;
  s.ballHist.push(b.x, b.y, b.vx, b.vy);
  if (s.ballHist.length > max) s.ballHist.splice(0, s.ballHist.length - max);
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

/** El escudo deja de golpear y vuelve (sólo visual). */
function shieldBack(pr: Projectile): boolean {
  pr.returning = true;
  pr.target = null;
  return true;
}

/**
 * Escudo encadenado: tras un impacto busca el objetivo válido más cercano
 * (pelota o rival no golpeado, a la vista, dentro de `search` desde el punto
 * de impacto; empate por id estable). Sin objetivo o con el máximo de
 * impactos, vuelve. Nunca va hacia aliados.
 */
function shieldNext(s: GameState, pr: Projectile): boolean {
  const c = cfg(s).cap.shield;
  if (pr.hits!.length >= c.maxHits) return shieldBack(pr);
  let best: { id: string; x: number; y: number; d: number } | null = null;
  const consider = (id: string, x: number, y: number, r: number) => {
    if (pr.hits!.includes(id)) return;
    const d = Math.hypot(x - pr.x, y - pr.y);
    if (d - r > c.search || lineBlocked(pr.x, pr.y, x, y)) return;
    if (!best || d < best.d || (d === best.d && id < best.id)) best = { id, x, y, d };
  };
  consider('ball', s.ball.x, s.ball.y, s.ball.r);
  for (const o of s.players) if (o.team !== pr.team) consider(o.id, o.d.x, o.d.y, o.d.r);
  const t = best as { id: string; x: number; y: number; d: number } | null;
  if (!t || t.d === 0) return shieldBack(pr);
  pr.target = t.id;
  pr.vx = ((t.x - pr.x) / t.d) * c.speed;
  pr.vy = ((t.y - pr.y) / t.d) * c.speed;
  return true;
}

/** Devuelve false si el proyectil desaparece. */
function stepProjectile(s: GameState, pr: Projectile): boolean {
  const P = cfg(s);
  if (pr.returning) return stepReturning(s, pr);
  if (pr.delay && pr.delay > 0) {
    // carga del repulsor: delante del dueño, sin chocar
    const o = findPlayer(s, pr.owner);
    if (!o) return false;
    pr.delay--;
    const sp0 = Math.hypot(pr.vx, pr.vy) || 1;
    pr.x = o.d.x + (pr.vx / sp0) * (o.d.r + pr.r);
    pr.y = o.d.y + (pr.vy / sp0) * (o.d.r + pr.r);
    return true;
  }
  if (pr.kind === 'shield') {
    if ((pr.life = (pr.life ?? 0) - 1) <= 0) return shieldBack(pr);
    // va hacia el objetivo elegido en el rebote (si sigue existiendo)
    const t = pr.target === 'ball' ? s.ball : pr.target ? findPlayer(s, pr.target)?.d : undefined;
    if (pr.target && !t) pr.target = null;
    if (t) {
      const d = Math.hypot(t.x - pr.x, t.y - pr.y);
      if (d > 0) {
        pr.vx = ((t.x - pr.x) / d) * P.cap.shield.speed;
        pr.vy = ((t.y - pr.y) / d) * P.cap.shield.speed;
      }
    }
  }
  const sp = Math.hypot(pr.vx, pr.vy);
  const n = Math.max(1, Math.ceil(sp / 3));
  // fin del recorrido u obstáculo: el escudo vuelve, la flecha explota, el resto desaparece
  const stop = (): boolean => {
    if (pr.kind === 'shield') return shieldBack(pr);
    if (pr.kind === 'arrow') explodeArrow(s, pr);
    return false;
  };
  for (let i = 0; i < n; i++) {
    pr.x += pr.vx / n;
    pr.y += pr.vy / n;
    pr.dist += sp / n;
    // el escudo encadenado ya no mide recorrido después del primer impacto (lo limita su vida)
    if (pr.dist > pr.max && !(pr.kind === 'shield' && pr.hits!.length > 0)) return stop();
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
    const onBall = pr.kind !== 'shock' && Math.hypot(b.x - pr.x, b.y - pr.y) < b.r + pr.r && !(pr.hits?.includes('ball'));
    if (onBall) {
      const sx = pr.vx / sp;
      const sy = pr.vy / sp;
      if (pr.kind === 'arrow') {
        explodeArrow(s, pr);
        return false;
      }
      if (pr.kind === 'shield') {
        if (!pushBall(s, sx, sy, P.cap.shield.ballImpulse, pr.owner)) {
          // protegida: el escudo se consume (deja de golpear y vuelve)
          s.events.push({ type: 'blocked', x: b.x, y: b.y });
          return shieldBack(pr);
        }
        s.events.push({ type: 'hit', x: pr.x, y: pr.y, target: 'ball' });
        pr.hits!.push('ball');
        return shieldNext(s, pr);
      }
      if (ballGuarded(s)) {
        // protegida: el proyectil se consume sin efecto (no espera a que termine)
        s.events.push({ type: 'blocked', x: pr.x, y: pr.y });
        return false;
      }
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
          repulsor: P.ironman.repulsor.ballImpulse,
          hammer: P.thor.hammer.ballImpulse,
        }[pr.kind as 'batarang' | 'repulsor' | 'hammer'];
        pushBall(s, sx, sy, impulse, pr.owner);
        if (pr.kind === 'hammer') {
          // Mjolnir electrifica la pelota (no se suma: reinicia la aplicación)
          s.ballElec = P.thor.hammer.elecTicks;
          s.ballElecStun = P.thor.hammer.stunTicks;
          s.ballElecHit = [];
        }
      }
      s.events.push({ type: 'hit', x: pr.x, y: pr.y, target: 'ball' });
      return false;
    }
    // el gancho sólo busca la pelota: atraviesa a los jugadores
    if (pr.kind === 'hook') continue;
    for (const o of s.players) {
      if (o.id === pr.owner) continue;
      if (Math.hypot(o.d.x - pr.x, o.d.y - pr.y) >= o.d.r + pr.r) continue;
      const rival = o.team !== pr.team;
      const ux = pr.vx / sp;
      const uy = pr.vy / sp;
      switch (pr.kind) {
        case 'arrow':
          // atraviesa aliados; explota contra el primer rival
          if (!rival) continue;
          explodeArrow(s, pr);
          return false;
        case 'repulsor':
          if (!rival) continue;
          pushPlayer(s, o, ux, uy, P.ironman.repulsor.playerImpulse);
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
          if (!rival || pr.hits!.includes(o.id)) continue;
          pushPlayer(s, o, ux, uy, P.cap.shield.playerImpulse);
          pr.hits!.push(o.id);
          s.events.push({ type: 'hit', x: pr.x, y: pr.y, target: 'player' });
          return shieldNext(s, pr);
        case 'hammer':
          if (!rival) continue;
          pushPlayer(s, o, ux, uy, P.thor.hammer.playerImpulse);
          break;
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

function explodeArrow(s: GameState, pr: Projectile): void {
  const c = cfg(s).hawkeye.arrow;
  const sp = Math.hypot(pr.vx, pr.vy) || 1;
  blast(s, pr.x, pr.y, c.blastRadius, c.ballImpulse, c.playerImpulse, pr.owner, pr.vx / sp, pr.vy / sp);
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
        if (dist > c.range * c.breakFactor || ballGuarded(s)) return false;
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
          // llegó: en Súper empuja la pelota en la dirección del viaje (salvo protegida)
          if (c.arriveImpulse > 0 && dist > 0 && !ballGuarded(s)) {
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

/**
 * Limpia proyectiles, zonas, hilos y estados (gol, saque, reinicio, fin):
 * stuns, electricidad, protección, portales e historial de la jugada. Las
 * recargas se tratan aparte (el saque las pone en 0).
 */
export function clearEffects(s: GameState): void {
  s.projectiles = [];
  s.tethers = [];
  s.zones = [];
  s.ballShield = 0;
  s.ballShieldMax = 0;
  s.ballShieldBy = null;
  s.ballElec = 0;
  s.ballElecHit = [];
  s.ballHist = [];
  for (const p of s.players) {
    p.dash = 0;
    p.fury = 0;
    p.superSpeed = 0;
    p.rush = 0;
    p.evade = 0;
    p.evadeResist = 0;
    p.sprint = 0;
    p.trailBoost = 0;
    p.slowPct = 0;
    p.slowTicks = 0;
    p.capSlow = 0;
    p.capSlowTicks = 0;
    p.slowNow = 0;
    p.stun = 0;
    p.stunImmune = 0;
  }
}
