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
// - Lo sorteado (dirección del misil, cuentas del quiz) sale del generador del
//   estado y sólo avanza al resolverse: reenviar mensajes o reconciliar no lo vuelve a sortear.
// - Incapacidades (stun, rosquilla, mente): no se suman (prevalece el mayor
//   tiempo restante), tope STUN.maxTicks seguidos y luego inmunidad. El quiz de
//   Baldi tiene reglas propias (duración máxima e inmunidad BALDI_QUIZ).
// - La rosquilla sobre la pelota reduce patadas e impulsos de poderes y además
//   la protege (misma protección que el Capitán, sin prolongarse con otra rosquilla).
// - Un jugador tragado por Jeff está fuera de la física y de todo objetivo
//   hasta que lo escupe o se interrumpe (gol, reinicio, salida de cualquiera).
// - La tinta de Bendy sólo afecta a rivales y nunca deja la pantalla negra:
//   secuencia continua máxima INK.maxRun y luego inmunidad.
import { AIM, BALDI_QUIZ, INK, KICK, LIMITS, PLAYER, POWER_LIMITS, STADIUM, STUN, powersFor, type PowerConfig } from './config';
import { clampSpeed, collideSeg, lineBlocked, stadium } from './physics';
import { inNum, type GameState, type PlayerState, type Projectile, type Zone } from './types';

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
  if (p.jet > 0) m *= c.cj.jetpack.accelMult;
  if (p.anger > 0) m *= c.verity.anger.accelMult;
  if (p.giant > 0) m *= c.ibai.giant.accelMult;
  if (p.inkForm > 0) m *= c.bendy.form.speedMult;
  if (p.hero === 'goku') m *= c.goku.speedMult;
  // charco de cerveza: menos agarre (cuesta frenar y girar)
  if (p.slip > 0) m *= 1 - (1 - c.homer.beer.grip) * p.slip;
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
  if (p.jet > 0) m *= c.cj.jetpack.speedMult;
  if (p.anger > 0) m *= c.verity.anger.speedMult;
  if (p.inkForm > 0) m *= c.bendy.form.speedMult;
  if (p.hero === 'goku') m *= c.goku.speedMult;
  // cargar el Kamehameha, disparar el chorro o llevar a alguien adentro frenan
  if (p.charge > 0) m *= c.goku.kame.moveMult;
  if (p.spray > 0) m *= c.jeff.water.moveMult;
  if (p.holding) m *= 1 - c.jeff.swallow.carrySlow;
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
  const c = cfg(s);
  let m = p.fury > 0 ? c.hulk.fury.kickMult : 1;
  if (p.anger > 0) m *= c.verity.anger.kickMult;
  return m;
}

/** Gema del Poder o Transmisión instantánea pendientes: multiplicador de la próxima patada (la protección lo anula). */
export function powerKickMult(s: GameState, p: PlayerState): number {
  if (ballGuarded(s)) return 1;
  if (p.powerKick > 0) return cfg(s).thanos.power.kickMult;
  if (p.blinkKick > 0) return cfg(s).goku.blink.kickMult;
  return 1;
}

/** ¿Puede patear? (forma de tinta de Bendy y Jeff con alguien adentro: no). */
export function canKick(p: PlayerState): boolean {
  return p.inkForm === 0 && p.holding === null && p.eatenBy === null;
}

/** ¿Está en juego? Un jugador tragado no choca ni es objetivo de nada. */
export function inPlay(p: PlayerState): boolean {
  return p.eatenBy === null;
}

/** Factor de los impulsos extra (patadas y poderes) que recibe la pelota: la rosquilla los reduce. */
export function ballImpulseFactor(s: GameState): number {
  return s.ballDonut > 0 ? 1 - cfg(s).homer.donut.impulseCut : 1;
}

/** Masa inversa del jugador: la mayor masa activa (Furia, Cuerpo gigante); no se multiplican. */
export function playerInvMass(s: GameState, p: PlayerState): number {
  const c = cfg(s);
  let mult = 1;
  if (p.fury > 0) mult = Math.max(mult, c.hulk.fury.massMult);
  if (p.giant > 0) mult = Math.max(mult, c.ibai.giant.massMult);
  return PLAYER.invMass / mult;
}

/** ¿El jugador no puede actuar (stun, control mental, quiz o tragado)? La rosquilla sólo impide moverse. */
export function incapacitated(p: PlayerState): boolean {
  return p.stun > 0 || p.mind > 0 || p.quiz !== null || p.eatenBy !== null;
}

/** ¿Algún rival está bajo el control mental de este jugador? */
export function controlling(s: GameState, p: PlayerState): PlayerState | undefined {
  return s.players.find((o) => o.mind > 0 && o.mindBy === p.id);
}

/** ¿La pelota tiene la protección del Capitán? */
export function ballGuarded(s: GameState): boolean {
  return s.ballShield > 0;
}

/** Impulso a la pelota (en unidades de velocidad × masa). No hace nada si está protegida. */
function pushBall(s: GameState, ux: number, uy: number, impulse: number, owner: string): boolean {
  if (ballGuarded(s)) return false;
  const b = s.ball;
  const k = impulse * b.invMass * ballImpulseFactor(s);
  b.vx += ux * k;
  b.vy += uy * k;
  clampSpeed(b, LIMITS.ballMaxSpeed - 1);
  s.lastTouch = owner;
  return true;
}

/** Impulso a un jugador según su masa y su resistencia a poderes, con tope de velocidad. */
export function pushPlayer(s: GameState, o: PlayerState, ux: number, uy: number, impulse: number): void {
  if (!inPlay(o)) return;
  const k = impulse * o.d.invMass * pushFactor(s, o);
  o.d.vx += ux * k;
  o.d.vy += uy * k;
  clampSpeed(o.d, LIMITS.playerMaxSpeed);
}

/**
 * Incapacidad (stun, rosquilla o control mental). No se suman: sólo queda la
 * de mayor tiempo restante. Como máximo STUN.maxTicks seguidos y, al terminar,
 * STUN.immuneTicks de inmunidad a todas.
 */
export function applyIncap(s: GameState, o: PlayerState, kind: 'stun' | 'trap' | 'mind', ticks: number, by: string | null = null): boolean {
  if (ticks <= 0 || o.stunImmune > 0 || !inPlay(o)) return false;
  const t = Math.min(ticks, Math.max(STUN.maxTicks, o.incapCap) - o.incapRun);
  if (t <= Math.max(o.stun, o.trap, o.mind)) return false;
  o.stun = kind === 'stun' ? t : 0;
  o.trap = kind === 'trap' ? t : 0;
  o.mind = kind === 'mind' ? t : 0;
  o.mindBy = kind === 'mind' ? by : null;
  if (kind !== 'trap') o.kickArmed = false;
  o.rush = 0;
  o.dash = 0;
  // interrumpe teletransportes en canalización y su propio gancho
  s.zones = s.zones.filter((z) => !(z.owner === o.id && (z.kind === 'portal' || z.kind === 'space')));
  s.tethers = s.tethers.filter((tt) => !(tt.owner === o.id && tt.kind === 'grapple'));
  if (kind === 'stun') s.events.push({ type: 'stun', id: o.id, ticks: t });
  return true;
}

/** Aturde a un jugador (ver applyIncap). */
export function applyStun(s: GameState, o: PlayerState, ticks: number): boolean {
  return applyIncap(s, o, 'stun', ticks);
}

/**
 * Penalización del quiz de Baldi: un aturdimiento propio (puede superar
 * STUN.maxTicks e ignora la inmunidad), una sola vez por quiz. Después corre la
 * inmunidad normal.
 */
function penaltyStun(s: GameState, o: PlayerState, ticks: number): void {
  if (ticks <= 0 || !inPlay(o)) return;
  o.stun = Math.max(o.stun, ticks);
  o.trap = 0;
  o.mind = 0;
  o.mindBy = null;
  o.stunImmune = 0;
  o.incapCap = Math.max(o.incapCap, o.incapRun + ticks);
  o.kickArmed = false;
  o.rush = 0;
  o.dash = 0;
  s.events.push({ type: 'stun', id: o.id, ticks });
}

/**
 * Tinta de Bendy en la pantalla de un rival: no se suma (vale el tiempo
 * restante mayor), una secuencia continua no pasa de INK.maxRun y después hay
 * INK.immuneTicks de inmunidad.
 */
function applyInk(s: GameState, o: PlayerState, ticks: number): boolean {
  if (ticks <= 0 || o.inkImmune > 0 || !inPlay(o)) return false;
  const t = Math.min(ticks, INK.maxRun - o.inkRun);
  if (t <= o.ink) return false;
  if (o.ink === 0) {
    o.inkSeed = s.tick;
    s.events.push({ type: 'ink', id: o.id });
  }
  o.ink = t;
  return true;
}

export interface AimTarget {
  kind: 'ball' | 'player';
  id: string | null;
  x: number;
  y: number;
}

/** Posición anticipada de un objetivo para un proyectil de cierta velocidad (dos iteraciones), escalada por `k`. */
function lead(p: PlayerState, x: number, y: number, vx: number, vy: number, speed: number, k = 1): [number, number] {
  let tx = x;
  let ty = y;
  for (let i = 0; i < 2; i++) {
    const time = (Math.hypot(tx - p.d.x, ty - p.d.y) / speed) * k;
    tx = x + vx * time;
    ty = y + vy * time;
  }
  return [tx, ty];
}

/**
 * Qué busca el autoapuntado de cada poder que se lanza: sólo los objetivos a
 * los que les hace algo. `speed` sirve para anticipar; `area` (ticks de vuelo)
 * marca los poderes de área, que apuntan al punto de caída. null: el poder no
 * se autoapunta.
 */
export interface AimSpec { range: number; speed: number; ball: boolean; rivals: boolean; area?: number }
export function aimSpec(P: PowerConfig, hero: PlayerState['hero'], slot: 'q' | 'e'): AimSpec | null {
  if (slot === 'e') {
    if (hero === 'verity') return { range: P.verity.tnt.range, speed: 1, ball: true, rivals: true, area: P.verity.tnt.flightTicks };
    return null;
  }
  switch (hero) {
    case 'spider':
      return P.spider.web.autoAim ? { range: P.spider.web.range, speed: P.spider.web.speed, ball: true, rivals: P.spider.web.grabsRivals } : null;
    case 'batman':
      return P.batman.batarang.autoAim ? { range: P.batman.batarang.range, speed: P.batman.batarang.speed, ball: true, rivals: true } : null;
    case 'superman':
      return { range: P.superman.laser.range, speed: P.superman.laser.range / Math.max(1, P.superman.laser.windup), ball: true, rivals: true };
    case 'hawkeye':
      return { range: P.hawkeye.arrow.range, speed: P.hawkeye.arrow.speed, ball: true, rivals: false };
    case 'widow':
      return { range: P.widow.shock.range, speed: P.widow.shock.speed, ball: false, rivals: true };
    case 'cap':
      return { range: P.cap.shield.range, speed: P.cap.shield.speed, ball: true, rivals: true };
    case 'ironman':
      return { range: P.ironman.repulsor.range, speed: P.ironman.repulsor.speed, ball: true, rivals: true };
    case 'thor':
      return { range: P.thor.hammer.range, speed: P.thor.hammer.speed, ball: true, rivals: true };
    case 'homer':
      return { range: P.homer.donut.range, speed: P.homer.donut.speed, ball: true, rivals: true };
    case 'cj':
      return { range: P.cj.gun.range, speed: P.cj.gun.speed, ball: true, rivals: true };
    case 'baldi':
      return { range: P.baldi.ruler.range, speed: P.baldi.ruler.speed, ball: true, rivals: false };
    default:
      return null;
  }
}

/**
 * Elección de objetivo compartida: dentro del alcance (borde a borde), a la
 * vista y dentro del cono de ±coneHalf grados alrededor de la dirección
 * apuntada. Gana la menor desviación angular, luego la menor distancia y luego
 * el id estable (la pelota primero). Nunca aliados ni la pelota protegida
 * (ningún poder la afecta).
 */
export function pickTarget(s: GameState, p: PlayerState, o: { range: number; ball: boolean; rivals: boolean; coneHalf?: number; filter?: (q: PlayerState) => boolean }): AimTarget | null {
  const cos = Math.cos(((o.coneHalf ?? AIM.coneHalf) * Math.PI) / 180);
  const cands: { t: AimTarget; r: number }[] = [];
  if (o.ball && !ballGuarded(s)) cands.push({ t: { kind: 'ball', id: null, x: s.ball.x, y: s.ball.y }, r: s.ball.r });
  if (o.rivals) {
    for (const q of s.players) {
      if (q.team !== p.team && inPlay(q) && (!o.filter || o.filter(q))) cands.push({ t: { kind: 'player', id: q.id, x: q.d.x, y: q.d.y }, r: q.d.r });
    }
  }
  let best: AimTarget | null = null;
  let bestAng = Infinity;
  let bestDist = Infinity;
  let bestId = '';
  for (const c of cands) {
    const dx = c.t.x - p.d.x;
    const dy = c.t.y - p.d.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist - p.d.r - c.r > o.range) continue;
    const align = (dx * p.ax + dy * p.ay) / dist;
    if (align < cos - 1e-9) continue;
    if (lineBlocked(p.d.x, p.d.y, c.t.x, c.t.y)) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, align)));
    const id = c.t.id ?? '';
    const better = ang < bestAng - 1e-6 || (Math.abs(ang - bestAng) <= 1e-6 && (dist < bestDist - 1e-6 || (Math.abs(dist - bestDist) <= 1e-6 && id < bestId)));
    if (better) {
      best = c.t;
      bestAng = ang;
      bestDist = dist;
      bestId = id;
    }
  }
  return best;
}

/**
 * Autoapuntado de los poderes que se lanzan (proyectiles, láser, TNT). Elige el
 * objetivo con pickTarget y devuelve la dirección de lanzamiento con una
 * anticipación moderada (AIM.lead); la trayectoria queda fija al lanzar. En los
 * de área, (x, y) es el punto de caída. null: sin objetivo (se usa la dirección apuntada).
 */
export function autoAim(s: GameState, p: PlayerState, slot: 'q' | 'e' = 'q'): { target: AimTarget; dx: number; dy: number; x: number; y: number } | null {
  const spec = aimSpec(cfg(s), p.hero, slot);
  if (!spec) return null;
  const t = pickTarget(s, p, spec);
  if (!t) return null;
  const d = t.kind === 'ball' ? s.ball : findPlayer(s, t.id!)!.d;
  let tx: number;
  let ty: number;
  if (spec.area !== undefined) {
    tx = t.x + d.vx * spec.area * AIM.areaLead;
    ty = t.y + d.vy * spec.area * AIM.areaLead;
  } else [tx, ty] = lead(p, t.x, t.y, d.vx, d.vy, spec.speed, AIM.lead);
  const dx = tx - p.d.x;
  const dy = ty - p.d.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return null;
  return { target: t, dx: dx / dist, dy: dy / dist, x: tx, y: ty };
}

/**
 * Dirección del gancho de Batman: siempre hacia la pelota (anticipada).
 * `inRange` indica si llegaría (alcance y línea de visión).
 */
export function grappleAim(s: GameState, p: PlayerState): { dx: number; dy: number; inRange: boolean } | null {
  const c = cfg(s).batman.grapple;
  const b = s.ball;
  const [tx, ty] = lead(p, b.x, b.y, b.vx, b.vy, c.speed, AIM.lead);
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
    if (o.team === p.team || !inPlay(o)) continue;
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
    case 'homer': return q ? proj('donut') : zone('beer');
    // las balas las limita el intervalo mínimo, no un bloqueo
    case 'cj': return q ? false : p.jet > 0;
    case 'baldi': return q ? proj('ruler') : zone('quiz') || s.players.some((o) => o.quiz?.by === p.id);
    case 'ibai': return q ? zone('punch') : p.giant > 0;
    // varias TNT a la vez: sólo bloquea el tope de TNT activas
    case 'verity': return q ? p.anger > 0 : tntCount(s, p) >= cfg(s).verity.tnt.maxActive;
    case 'thanos': return q ? gemActive(s, p, p.gem) : false;
    case 'bendy': return q ? zone('ink') : p.inkForm > 0;
    case 'jeff': return q ? p.spray > 0 : p.holding !== null;
    case 'goku': return q ? p.charge > 0 || zone('kame') : false;
  }
}

/** TNT de esta Verity todavía sin explotar. */
export function tntCount(s: GameState, p: PlayerState): number {
  return s.zones.filter((z) => z.owner === p.id && z.kind === 'tnt' && z.delay > 0).length;
}

const GEMS = ['time', 'mind', 'reality', 'space', 'power'] as const;

/** ¿Sigue activo el efecto de esa gema de Thanos? (sin cooldowns no se puede reactivar hasta que termine) */
export function gemActive(s: GameState, p: PlayerState, gem: number): boolean {
  switch (GEMS[gem]) {
    case 'mind': return !!controlling(s, p);
    case 'reality': return s.illusion?.by === p.id;
    case 'space': return s.zones.some((z) => z.owner === p.id && z.kind === 'space');
    case 'power': return p.powerKick > 0;
    default: return false;
  }
}

/** Poderes que desplazan al propio jugador: la rosquilla los impide. */
function movesSelf(p: PlayerState, slot: 'q' | 'e'): boolean {
  switch (p.hero) {
    case 'spider': case 'batman': case 'hawkeye': case 'widow': case 'strange': return slot === 'e';
    case 'panther': return slot === 'q';
    case 'thanos': return slot === 'q' && GEMS[p.gem] === 'space';
    case 'goku': return slot === 'e';
    default: return false;
  }
}

/** ¿El saque todavía bloquea Tragar? (preparación del saque y los primeros segundos de juego, también sin cooldowns). */
export function swallowLocked(s: GameState): boolean {
  return s.phase !== 'playing' || s.liveTicks < cfg(s).jeff.swallow.kickoffLock;
}

/** ¿Goku tiene el ki lleno (próxima Q o E potenciada)? */
export function kiReady(s: GameState, p: PlayerState): boolean {
  return p.hero === 'goku' && p.ki >= cfg(s).goku.ki.max;
}

/** Intenta activar Q o E. Devuelve true si se activó (y entonces corre la recarga). */
export function activate(s: GameState, p: PlayerState, slot: 'q' | 'e'): boolean {
  if (incapacitated(p)) return false;
  if (p.trap > 0 && movesSelf(p, slot)) return false;
  if (p.hero === 'thanos') return slot === 'q' ? activateGem(s, p) : nextGem(s, p);
  // escupir funciona aunque la recarga ya esté corriendo; la segunda transmisión gratis también
  if (p.hero === 'jeff' && slot === 'e' && p.holding) {
    const v = findPlayer(s, p.holding);
    if (v) releaseVictim(s, v, p, true);
    return true;
  }
  if (p.hero === 'goku' && slot === 'e' && p.freeBlink > 0) return gokuBlink(s, p, true);
  // forma de tinta o alguien adentro: sin Q
  if (slot === 'q' && (p.inkForm > 0 || p.holding)) return false;
  if (slot === 'q' ? p.cdQ > 0 : p.cdE > 0) return false;
  if (s.noCd && powerActive(s, p, slot)) return false;
  // topes técnicos: sin lugar para más objetos, no se activa (ni gasta recarga)
  if (s.projectiles.length >= POWER_LIMITS.maxProjectiles - 3 || s.zones.length >= POWER_LIMITS.maxZones) return false;
  const P = cfg(s);
  let ax = p.ax;
  let ay = p.ay;
  const aim = autoAim(s, p, slot);
  if (aim) {
    ax = aim.dx;
    ay = aim.dy;
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
        protectBall(s, p.id, c.ticks);
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
        // el punto de impacto queda fijo (con una anticipación moderada que se puede esquivar): no persigue a la pelota
        const mx = s.ball.x + s.ball.vx * c.delay * AIM.areaLead;
        const my = s.ball.y + s.ball.vy * c.delay * AIM.areaLead;
        addZone(s, p, 'missile', mx, my, c.radius, c.delay, c.delay + MISSILE_AFTER);
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
    case 'homer':
      if (slot === 'q') {
        shoot(s, p, 'donut', ax, ay, P.homer.donut);
        cd = P.homer.donut.cooldown;
      } else {
        const c = P.homer.beer;
        // cae adelante, dentro del estadio
        const [bx, by] = clampToStadium(p.d.x + p.ax * c.ahead, p.d.y + p.ay * c.ahead, 0);
        const z = addZone(s, p, 'beer', bx, by, c.radius, c.throwTicks, c.throwTicks + c.ticks);
        z.pts.push({ x: p.d.x, y: p.d.y, t: s.tick });
        cd = c.cooldown;
      }
      break;
    case 'cj':
      if (slot === 'q') {
        const c = P.cj.gun;
        // una bala por pulsación, con intervalo mínimo; la recarga empieza tras la última
        if (p.ammo <= 0 || p.shotGap > 0) return false;
        shoot(s, p, 'bullet', ax, ay, c);
        p.ammo--;
        p.shotGap = c.gap;
        s.events.push({ type: 'shot', id: p.id, x: p.d.x + ax * p.d.r, y: p.d.y + ay * p.d.r, dx: ax, dy: ay });
        cd = p.ammo === 0 ? c.reload : 0;
      } else {
        p.jet = P.cj.jetpack.ticks;
        cd = P.cj.jetpack.cooldown;
      }
      break;
    case 'baldi':
      if (slot === 'q') {
        shoot(s, p, 'ruler', ax, ay, P.baldi.ruler);
        cd = P.baldi.ruler.cooldown;
      } else {
        const c = P.baldi.quiz;
        const t = quizTarget(s, p);
        // sin objetivo válido no se gasta la recarga
        if (!t) {
          s.events.push({ type: 'fizzle', id: p.id, slot });
          return false;
        }
        const z = addZone(s, p, 'quiz', t.d.x, t.d.y, t.d.r, c.windup, c.windup);
        z.target = t.id;
        cd = c.cooldown;
      }
      break;
    case 'ibai':
      if (slot === 'q') {
        const c = P.ibai.glove;
        const t = gloveTarget(s, p);
        if (!t) {
          s.events.push({ type: 'fizzle', id: p.id, slot });
          return false;
        }
        const z = addZone(s, p, 'punch', p.d.x, p.d.y, p.d.r, c.windup, c.windup + PUNCH_AFTER);
        // una sola vez: al conectar se aturde (lo marca `hits`)
        z.hits = [];
        z.target = t.id;
        const d = Math.hypot(t.d.x - p.d.x, t.d.y - p.d.y) || 1;
        z.dx = (t.d.x - p.d.x) / d;
        z.dy = (t.d.y - p.d.y) / d;
        cd = c.cooldown;
      } else {
        p.giant = P.ibai.giant.ticks;
        cd = P.ibai.giant.cooldown;
      }
      break;
    case 'verity':
      if (slot === 'q') {
        p.anger = P.verity.anger.ticks;
        cd = P.verity.anger.cooldown;
      } else {
        const c = P.verity.tnt;
        // tope de TNT activas: se rechaza sin gastar la recarga (el HUD lo indica)
        if (tntCount(s, p) >= c.maxActive) {
          s.events.push({ type: 'fizzle', id: p.id, slot });
          return false;
        }
        // punto de caída fijo al lanzar: el objetivo autoapuntado (anticipado) o el alcance máximo
        let tx = aim ? aim.x : p.d.x + p.ax * c.range;
        let ty = aim ? aim.y : p.d.y + p.ay * c.range;
        const dist = Math.hypot(tx - p.d.x, ty - p.d.y);
        if (dist > c.range + p.d.r) {
          tx = p.d.x + ((tx - p.d.x) / dist) * (c.range + p.d.r);
          ty = p.d.y + ((ty - p.d.y) / dist) * (c.range + p.d.r);
        }
        [tx, ty] = clampToStadium(tx, ty, 8);
        const z = addZone(s, p, 'tnt', tx, ty, c.radius, c.flightTicks + c.fuse, c.flightTicks + c.fuse + BOOM_AFTER);
        z.len = c.flightTicks;
        z.dx = ax;
        z.dy = ay;
        z.pts.push({ x: p.d.x, y: p.d.y, t: s.tick });
        cd = c.cooldown;
      }
      break;
    case 'bendy':
      if (slot === 'q') {
        const c = P.bendy.puddle;
        const [tx, ty] = puddleSpot(s, p);
        const z = addZone(s, p, 'ink', tx, ty, c.radius, c.flightTicks, c.flightTicks + c.ticks);
        z.hits = [];
        z.pts.push({ x: p.d.x, y: p.d.y, t: s.tick });
        cd = c.cooldown;
      } else {
        const c = P.bendy.form;
        p.inkForm = c.ticks;
        // un solo rastro por Bendy: el anterior se termina de desvanecer solo
        const z = addZone(s, p, 'inkTrail', p.d.x, p.d.y, c.radius, 0, c.ticks + c.segTicks);
        z.pts.push({ x: p.d.x, y: p.d.y, t: s.tick });
        cd = c.cooldown;
      }
      break;
    case 'jeff':
      if (slot === 'q') {
        const c = P.jeff.water;
        // dirección fija: hacia donde miraba al activarlo (no persigue)
        p.spray = c.ticks;
        p.sprayDx = p.ax;
        p.sprayDy = p.ay;
        const z = addZone(s, p, 'water', p.d.x, p.d.y, c.halfWidth, 0, c.ticks);
        z.dx = p.ax;
        z.dy = p.ay;
        z.len = rayFree(p.d.x + p.ax * p.d.r, p.d.y + p.ay * p.d.r, p.ax, p.ay, c.range);
        cd = c.cooldown;
      } else {
        const c = P.jeff.swallow;
        // tras el saque no se puede (tampoco sin cooldowns): se rechaza sin gastar nada
        if (swallowLocked(s)) {
          s.events.push({ type: 'fizzle', id: p.id, slot });
          return false;
        }
        const v = swallowTarget(s, p);
        if (!v) {
          s.events.push({ type: 'fizzle', id: p.id, slot });
          cd = c.missCooldown;
          break;
        }
        swallow(s, p, v);
        cd = c.cooldown;
      }
      break;
    case 'goku':
      if (slot === 'q') {
        // empieza la carga; sale al soltar Q (chargeInput). Con el ki lleno, carga potenciada.
        p.charge = 1;
        p.chargeKi = kiReady(s, p);
        if (p.chargeKi) p.ki = 0;
        s.events.push({ type: 'power', id: p.id, slot, hero: p.hero });
        return true;
      }
      return gokuBlink(s, p, false);
  }
  if (s.noCd) cd = 0;
  if (slot === 'q') p.cdQ = cd;
  else p.cdE = cd;
  s.events.push({ type: 'power', id: p.id, slot, hero: p.hero });
  return true;
}

/** Ticks que el misil queda dibujado después de caer (muestra la dirección sorteada). */
const MISSILE_AFTER = 30;
/** Ticks que se ven el golpe del guante y la explosión de la TNT. */
const PUNCH_AFTER = 10;
const BOOM_AFTER = 24;

/** Punto dentro del estadio (con margen). */
function clampToStadium(x: number, y: number, margin: number): [number, number] {
  const W = STADIUM.width - margin;
  const H = STADIUM.height - margin;
  return [Math.max(-W, Math.min(W, x)), Math.max(-H, Math.min(H, y))];
}

/** Quiz de Baldi: rival más alineado delante (cono propio), al alcance, a la vista, sin quiz ni inmunidad. */
export function quizTarget(s: GameState, p: PlayerState): PlayerState | null {
  const c = cfg(s).baldi.quiz;
  const t = pickTarget(s, p, { range: c.range, ball: false, rivals: true, coneHalf: c.cone, filter: (o) => o.quiz === null && o.quizImmune === 0 && !s.zones.some((z) => z.kind === 'quiz' && z.target === o.id) });
  return t ? findPlayer(s, t.id!) ?? null : null;
}

/** Guante de Ibai: rival más cercano (borde a borde) dentro del cono frontal y del alcance, a la vista. */
export function gloveTarget(s: GameState, p: PlayerState): PlayerState | null {
  const c = cfg(s).ibai.glove;
  const cos = Math.cos((c.cone * Math.PI) / 180);
  let best: PlayerState | null = null;
  let bestGap = Infinity;
  for (const o of s.players) {
    if (o.team === p.team) continue;
    const dx = o.d.x - p.d.x;
    const dy = o.d.y - p.d.y;
    const dist = Math.hypot(dx, dy);
    const gap = dist - p.d.r - o.d.r;
    if (dist === 0 || gap > c.range) continue;
    if ((dx * p.ax + dy * p.ay) / dist < cos - 1e-9) continue;
    if (lineBlocked(p.d.x, p.d.y, o.d.x, o.d.y)) continue;
    if (gap < bestGap - 1e-6 || (Math.abs(gap - bestGap) <= 1e-6 && best && o.id < best.id)) {
      best = o;
      bestGap = gap;
    }
  }
  return best;
}

/** Rival para las gemas del Tiempo y la Mente: el del cono compartido o, si no hay, el más cercano al alcance. */
function gemTarget(s: GameState, p: PlayerState, range: number, filter?: (o: PlayerState) => boolean): PlayerState | null {
  const t = pickTarget(s, p, { range, ball: false, rivals: true, filter }) ?? pickTarget(s, p, { range, ball: false, rivals: true, coneHalf: 180, filter });
  return t ? findPlayer(s, t.id!) ?? null : null;
}

/** E de Thanos: pasa a la siguiente gema (sin recarga). */
function nextGem(s: GameState, p: PlayerState): boolean {
  p.gem = (p.gem + 1) % GEMS.length;
  s.events.push({ type: 'gem', id: p.id, gem: p.gem });
  return true;
}

/**
 * Q de Thanos: activa la gema elegida. Recargas independientes por gema y un
 * intervalo compartido entre activaciones (también sin cooldowns). Sin
 * objetivo o destino válido se rechaza sin gastar la recarga.
 */
function activateGem(s: GameState, p: PlayerState): boolean {
  const P = cfg(s).thanos;
  const g = p.gem;
  if (p.gemGap > 0 || p.gemCd[g] > 0) return false;
  if (gemActive(s, p, g)) return false;
  if (s.zones.length >= POWER_LIMITS.maxZones) return false;
  const fizzle = (): boolean => {
    s.events.push({ type: 'fizzle', id: p.id, slot: 'q' });
    return false;
  };
  let cd = 0;
  switch (GEMS[g]) {
    case 'time': {
      const c = P.time;
      const o = gemTarget(s, p, c.range, (q) => (s.plHist[q.id]?.length ?? 0) >= 8);
      if (!o || !timeRewind(s, p, o, c.ticks)) return fizzle();
      cd = c.cooldown;
      break;
    }
    case 'mind': {
      const c = P.mind;
      const o = gemTarget(s, p, c.range, (q) => q.stunImmune === 0 && q.quiz === null);
      if (!o || !applyIncap(s, o, 'mind', c.ticks, p.id)) return fizzle();
      const z = addZone(s, p, 'mind', o.d.x, o.d.y, o.d.r, 0, o.mind);
      z.target = o.id;
      cd = c.cooldown;
      break;
    }
    case 'reality': {
      const c = P.reality;
      if (s.illusion || s.illusionGap > 0) return fizzle();
      const [x, y] = illusionSpot(s, p);
      s.illusion = { by: p.id, team: p.team === 'red' ? 'blue' : 'red', x, y, ticks: c.ticks };
      s.events.push({ type: 'illusion', by: p.id, team: s.illusion.team, result: 'start' });
      cd = c.cooldown;
      break;
    }
    case 'space': {
      const c = P.space;
      if (!ballInReach(s, p, c.range)) return fizzle();
      const z = addZone(s, p, 'space', s.ball.x, s.ball.y, p.d.r, c.windup, c.windup);
      z.pts.push({ x: p.d.x, y: p.d.y, t: s.tick });
      cd = c.cooldown;
      break;
    }
    case 'power': {
      p.powerKick = P.power.ticks;
      cd = P.power.cooldown;
      break;
    }
  }
  p.gemCd[g] = s.noCd ? 0 : cd;
  p.gemGap = P.gap;
  s.events.push({ type: 'power', id: p.id, slot: 'q', hero: p.hero, gem: g });
  return true;
}

/** Pelota falsa de la ilusión: pegada a Thanos, del lado al que mira. */
function illusionSpot(s: GameState, p: PlayerState): [number, number] {
  const d = p.d.r + s.ball.r + 3;
  return clampToStadium(p.d.x + p.ax * d, p.d.y + p.ay * d, s.ball.r);
}

/**
 * Gema del Tiempo: el rival vuelve a su posición y velocidad de hace `ticks`
 * (o lo más viejo de esta jugada), al lugar legal más cercano. No toca goles,
 * poderes ni recargas.
 */
function timeRewind(s: GameState, p: PlayerState, o: PlayerState, ticks: number): boolean {
  const h = s.plHist[o.id];
  if (!h || h.length < 8) return false;
  const count = h.length / 4;
  const i = Math.max(0, count - ticks) * 4;
  const spot = freeSpot(s, h[i], h[i + 1], o.d.r, 'player', o);
  if (!spot) return false;
  const z = addZone(s, p, 'timeGhost', spot[0], spot[1], o.d.r, 0, TIME_GHOST);
  z.target = o.id;
  for (let k = i; k < h.length; k += 16) z.pts.push({ x: h[k], y: h[k + 1], t: 0 });
  z.pts.push({ x: o.d.x, y: o.d.y, t: 0 });
  o.d.x = spot[0];
  o.d.y = spot[1];
  o.d.vx = h[i + 2];
  o.d.vy = h[i + 3];
  clampSpeed(o.d, LIMITS.playerMaxSpeed);
  o.rush = 0;
  o.dash = 0;
  o.warp++;
  s.tethers = s.tethers.filter((t) => !(t.owner === o.id && t.kind === 'grapple'));
  s.plHist[o.id] = h.slice(0, i);
  s.events.push({ type: 'rewind', id: o.id, x0: z.pts[z.pts.length - 1].x, y0: z.pts[z.pts.length - 1].y, x1: o.d.x, y1: o.d.y });
  return true;
}

/** Ticks que se ve el recorrido fantasma de la Gema del Tiempo. */
const TIME_GHOST = 40;

/**
 * Abre el quiz de Baldi: una cuenta simple (sumas y restas de 1 a 20 sin
 * resultados negativos; en Súper también multiplicaciones de 2 a 5) con tres
 * respuestas. Todo sale del generador de la autoridad.
 */
function openQuiz(s: GameState, o: PlayerState, by: string): void {
  const c = cfg(s).baldi.quiz;
  const int = (a: number, b: number) => a + Math.floor(nextRandom(s) * (b - a + 1));
  const roll = nextRandom(s);
  const op = c.multiply && roll < 1 / 3 ? '×' : roll < (c.multiply ? 2 / 3 : 0.5) ? '+' : '−';
  let a: number;
  let b: number;
  let ans: number;
  if (op === '×') {
    a = int(2, 5);
    b = int(2, 5);
    ans = a * b;
  } else {
    a = int(1, 20);
    b = int(1, 20);
    if (op === '−' && a < b) [a, b] = [b, a];
    ans = op === '+' ? a + b : a - b;
  }
  const offs = [-3, -2, -1, 1, 2, 3].filter((d) => ans + d >= 0);
  const i1 = int(0, offs.length - 1);
  const d1 = offs.splice(i1, 1)[0];
  const d2 = offs[int(0, offs.length - 1)];
  const answer = int(0, 2);
  const wrong = [ans + d1, ans + d2];
  const opts = [0, 1, 2].map((k) => (k === answer ? ans : wrong.shift()!)) as [number, number, number];
  o.quiz = { by, text: `${a} ${op} ${b}`, opts, answer, ticks: c.ticks, max: c.ticks, wrong: 0 };
  o.kickArmed = false;
  o.rush = 0;
  o.dash = 0;
  s.zones = s.zones.filter((z) => !(z.owner === o.id && (z.kind === 'portal' || z.kind === 'space')));
  s.tethers = s.tethers.filter((t) => !(t.owner === o.id && t.kind === 'grapple'));
  s.events.push({ type: 'quiz', id: o.id, by, result: 'open' });
}

/**
 * Cierra el quiz. Bien: vuelve a jugar al instante. Mal o sin responder a
 * tiempo: un aturdimiento propio (una sola vez, porque el quiz se cierra).
 */
function closeQuiz(s: GameState, o: PlayerState, result: 'ok' | 'wrong' | 'timeout'): void {
  const by = o.quiz?.by ?? '';
  o.quiz = null;
  o.quizImmune = BALDI_QUIZ.immuneTicks;
  o.kickArmed = false;
  s.events.push({ type: 'quiz', id: o.id, by, result });
  if (result !== 'ok') penaltyStun(s, o, cfg(s).baldi.quiz.wrongStun);
}

/**
 * Respuesta al quiz (número 1–3 de la entrada, al apretarlo). La correcta lo
 * cierra; una incorrecta también, con penalización. Lo valida la autoridad:
 * el cliente sólo manda el número que tocó.
 */
export function quizInput(s: GameState, p: PlayerState): void {
  const q = p.quiz;
  if (!q) return;
  const n = inNum(p.input);
  if (n < 1 || n > 3 || n === inNum(p.prevInput)) return;
  if (n - 1 === q.answer) closeQuiz(s, p, 'ok');
  else {
    q.wrong++;
    closeQuiz(s, p, 'wrong');
  }
}

function addZone(s: GameState, p: PlayerState, kind: Zone['kind'], x: number, y: number, r: number, delay: number, ticks: number): Zone {
  const z: Zone = { id: s.nextId++, kind, owner: p.id, team: p.team, x, y, r, delay, ticks, dx: 0, dy: 0, len: 0, ang: null, pts: [] };
  s.zones.push(z);
  return z;
}

/** Protección de la pelota: no se suma (vale la mayor duración restante) y quita efectos de poder activos sobre ella. */
function protectBall(s: GameState, by: string, ticks: number): void {
  if (ticks >= s.ballShield) {
    s.ballShield = ticks;
    s.ballShieldMax = ticks;
    s.ballShieldBy = by;
  }
  // sin cambiar posición ni velocidad: sólo se cortan atracción, electricidad y energía
  s.tethers = s.tethers.filter((t) => !(t.kind === 'web' && t.target === null));
  s.ballElec = 0;
  s.ballElecHit = [];
  s.ballDonut = 0;
  s.ballKi = 0;
  s.ballKiBy = null;
  s.events.push({ type: 'protect', id: by });
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
      if (o !== self && inPlay(o) && Math.hypot(o.d.x - cx, o.d.y - cy) < o.d.r + r + 0.5) return false;
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
  return [...s.players.filter((o) => o !== p && inPlay(o)).map((o) => o.d), s.ball, ...stadium.posts];
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
  if (!ballGuarded(s) && radialPush(p.d.x, p.d.y, s.ball, c.range, c.ballImpulse * ballImpulseFactor(s), LIMITS.ballMaxSpeed - 1, p.d.r)) s.lastTouch = p.id;
  for (const o of s.players) {
    if (o.team === p.team || !inPlay(o)) continue;
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
function blast(s: GameState, x: number, y: number, radius: number, ballImp: number, playerImp: number, owner: string, fx: number, fy: number, kind: 'arrow' | 'tnt' = 'arrow', stun?: { team: PlayerState['team']; ticks: number }): void {
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
    if (!inPlay(o)) continue;
    const g = Math.hypot(o.d.x - x, o.d.y - y) - o.d.r;
    if (g > radius || lineBlocked(x, y, o.d.x, o.d.y)) continue;
    const [ux, uy] = dir(o.d.x - x, o.d.y - y);
    pushPlayer(s, o, ux, uy, playerImp * (1 - Math.max(0, g) / radius));
    // TNT: además aturde a los rivales (un impacto por explosión; no se suma, se refresca)
    if (stun && o.team !== stun.team) applyStun(s, o, stun.ticks);
  }
  if (gb <= radius && ballGuarded(s)) s.events.push({ type: 'blocked', x: b.x, y: b.y });
  s.events.push({ type: 'boom', x, y, r: radius, kind });
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
    if (o.team === owner.team || !inPlay(o)) continue;
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
        if (!ballGuarded(s) && radialPush(z.x, z.y, b, reach, c.ballImpulse * ballImpulseFactor(s), LIMITS.ballMaxSpeed - 1, cr)) s.lastTouch = z.owner;
        for (const o of s.players) {
          if (o.team === z.team || !inPlay(o)) continue;
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
            if (o.team !== z.team && inPlay(o) && Math.hypot(o.d.x - z.x, o.d.y - z.y) < z.r + o.d.r) applyStun(s, o, P.thor.bolt.stunTicks);
          }
        }
        return --z.ticks > 0;
      case 'trail': {
        const c = P.flash.trail;
        if (owner.trailBoost > 0 && s.tick % c.dropEvery === 0) z.pts.push({ x: owner.d.x, y: owner.d.y, t: s.tick });
        z.pts = z.pts.filter((q) => s.tick - q.t < c.segTicks);
        for (const o of s.players) {
          if (o.team === z.team || !inPlay(o)) continue;
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
      case 'beer':
        if (z.delay > 0) z.delay--;
        return --z.ticks > 0;
      case 'tnt':
        if (z.delay > 0 && --z.delay === 0) {
          const c = P.verity.tnt;
          blast(s, z.x, z.y, z.r, c.ballImpulse, c.playerImpulse, z.owner, z.dx, z.dy, 'tnt', { team: z.team, ticks: c.stunTicks });
        }
        return --z.ticks > 0;
      case 'ink': {
        if (z.delay > 0) {
          z.delay--;
          return --z.ticks > 0;
        }
        // pisar el charco: el borde del rival entra en el círculo; una vez por charco y rival
        const c = P.bendy.puddle;
        for (const o of s.players) {
          if (o.team === z.team || !inPlay(o) || z.hits!.includes(o.id)) continue;
          if (Math.hypot(o.d.x - z.x, o.d.y - z.y) < z.r + o.d.r * 0.5 && applyInk(s, o, c.inkTicks)) z.hits!.push(o.id);
        }
        return --z.ticks > 0;
      }
      case 'inkTrail': {
        const c = P.bendy.form;
        if (owner.inkForm > 0 && s.tick % c.dropEvery === 0) {
          z.pts.push({ x: owner.d.x, y: owner.d.y, t: s.tick });
          // límite de segmentos: el más viejo se descarta
          if (z.pts.length > c.maxSegs) z.pts.splice(0, z.pts.length - c.maxSegs);
        }
        z.pts = z.pts.filter((q) => s.tick - q.t < c.segTicks);
        for (const o of s.players) {
          if (o.team === z.team || !inPlay(o)) continue;
          if (z.pts.some((q) => Math.hypot(o.d.x - q.x, o.d.y - q.y) < z.r + o.d.r)) applyInk(s, o, c.inkTicks);
        }
        return --z.ticks > 0 || z.pts.length > 0;
      }
      case 'water': {
        if (owner.spray <= 0 || !inPlay(owner)) return false;
        sprayWater(s, z, owner);
        return --z.ticks > 0;
      }
      case 'kame':
        return --z.ticks > 0;
      case 'quiz': {
        const t = z.target ? findPlayer(s, z.target) : undefined;
        if (!t) return false;
        z.x = t.d.x;
        z.y = t.d.y;
        z.r = t.d.r;
        if (--z.delay > 0) return true;
        // sigue siendo válido al resolverse; si no, no gasta la recarga
        if (t.team !== z.team && t.quiz === null && t.quizImmune === 0) openQuiz(s, t, z.owner);
        else {
          owner.cdE = 0;
          s.events.push({ type: 'fizzle', id: owner.id, slot: 'e' });
        }
        return false;
      }
      case 'punch': {
        z.x = owner.d.x;
        z.y = owner.d.y;
        if (z.delay > 0 && --z.delay === 0) {
          const c = P.ibai.glove;
          const t = z.target ? findPlayer(s, z.target) : undefined;
          // sólo pega si el rival sigue al alcance y a la vista (no golpea a distancia)
          if (t && inPlay(t) && !z.hits!.includes(t.id)) {
            const dx = t.d.x - owner.d.x;
            const dy = t.d.y - owner.d.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0 && dist - owner.d.r - t.d.r <= c.range + 2 && !lineBlocked(owner.d.x, owner.d.y, t.d.x, t.d.y)) {
              z.dx = dx / dist;
              z.dy = dy / dist;
              pushPlayer(s, t, z.dx, z.dy, c.playerImpulse);
              applyStun(s, t, c.stunTicks);
              z.hits!.push(t.id);
              s.events.push({ type: 'hit', x: t.d.x, y: t.d.y, target: 'player' });
            }
          }
        }
        return --z.ticks > 0;
      }
      case 'space': {
        if (--z.delay > 0) return true;
        // junto a la pelota (sin moverla), del lado que mira hacia donde estaba Thanos
        const o = z.pts[0];
        let ux = o.x - b.x;
        let uy = o.y - b.y;
        const d = Math.hypot(ux, uy);
        if (d > 1e-6) {
          ux /= d;
          uy /= d;
        } else {
          ux = -owner.ax;
          uy = -owner.ay;
        }
        const gap = b.r + owner.d.r + 2;
        const spot = freeSpot(s, b.x + ux * gap, b.y + uy * gap, owner.d.r, 'player', owner);
        if (!spot) {
          owner.gemCd[GEMS.indexOf('space')] = 0;
          s.events.push({ type: 'fizzle', id: owner.id, slot: 'q' });
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
        s.events.push({ type: 'blink', id: owner.id, x0, y0, x1: owner.d.x, y1: owner.d.y });
        return false;
      }
      case 'mind': {
        const t = z.target ? findPlayer(s, z.target) : undefined;
        if (!t || t.mind <= 0 || t.mindBy !== owner.id) return false;
        z.x = t.d.x;
        z.y = t.d.y;
        return true;
      }
      case 'timeGhost':
        return --z.ticks > 0;
    }
  });
}

/** Temporizadores, proyectiles, hilos, zonas y pelota. Se llama una vez por tick tras la física. */
export function updatePowers(s: GameState): void {
  const P = cfg(s);
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
    updateIncap(s, p);
    if (p.quiz && --p.quiz.ticks <= 0) closeQuiz(s, p, 'timeout');
    else if (!p.quiz && p.quizImmune > 0) p.quizImmune--;
    if (p.jet > 0) p.jet--;
    if (p.anger > 0) p.anger--;
    if (p.giant > 0) p.giant--;
    if (p.shotGap > 0) p.shotGap--;
    // CJ: la recarga empieza tras la última bala; al terminar se llena el cargador
    if (p.ammo <= 0 && p.cdQ === 0) p.ammo = P.cj.gun.shots;
    if (p.powerKick > 0) p.powerKick--;
    if (p.gemGap > 0) p.gemGap--;
    for (let g = 0; g < p.gemCd.length; g++) if (p.gemCd[g] > 0) p.gemCd[g]--;
    if (p.inkForm > 0) p.inkForm--;
    if (p.spray > 0) p.spray--;
    if (p.kiGap > 0) p.kiGap--;
    if (p.blinkKick > 0) p.blinkKick--;
    if (p.freeBlink > 0) p.freeBlink--;
    updateInk(p);
    updateSwallow(s, p);
    updateSlip(s, p);
    updateGiant(s, p);
  }
  if (s.ballShield > 0 && --s.ballShield === 0) s.ballShieldBy = null;
  if (s.ballDonut > 0) s.ballDonut--;
  updateIllusion(s);
  updateProjectiles(s);
  updateTethers(s);
  updateZones(s);
  updateBall(s);
  recordPlayers(s);
}

/**
 * Incapacidades: corren juntas como una sola (nunca más de STUN.maxTicks
 * seguidos); el control mental termina si quien controla queda incapacitado o
 * se va. Al terminar, inmunidad.
 */
function updateIncap(s: GameState, p: PlayerState): void {
  if (p.mind > 0) {
    const by = p.mindBy ? findPlayer(s, p.mindBy) : undefined;
    if (!by || by.stun > 0 || by.mind > 0 || by.quiz) p.mind = 0;
  }
  if (p.stun > 0 || p.trap > 0 || p.mind > 0) {
    p.incapRun++;
    if (p.stun > 0) p.stun--;
    if (p.trap > 0) p.trap--;
    if (p.mind > 0) p.mind--;
    if (p.incapRun >= Math.max(STUN.maxTicks, p.incapCap)) p.stun = p.trap = p.mind = 0;
  }
  if (p.stun === 0 && p.trap === 0 && p.mind === 0) {
    p.mindBy = null;
    if (p.incapRun > 0) {
      p.incapRun = 0;
      p.incapCap = STUN.maxTicks;
      p.stunImmune = STUN.immuneTicks;
    } else if (p.stunImmune > 0) p.stunImmune--;
  }
}

/** Tinta en pantalla: corre la secuencia (tope INK.maxRun) y al terminar da inmunidad. */
function updateInk(p: PlayerState): void {
  if (p.ink > 0) {
    p.ink--;
    if (++p.inkRun >= INK.maxRun) p.ink = 0;
  }
  if (p.ink === 0) {
    if (p.inkRun > 0) {
      p.inkRun = 0;
      p.inkImmune = INK.immuneTicks;
    } else if (p.inkImmune > 0) p.inkImmune--;
  }
}

/** Charco de cerveza: dentro, resbala del todo; al salir recupera el agarre en `recoverTicks`. */
function updateSlip(s: GameState, p: PlayerState): void {
  const c = cfg(s).homer.beer;
  const inside = s.zones.some((z) => z.kind === 'beer' && z.delay === 0 && Math.hypot(p.d.x - z.x, p.d.y - z.y) < z.r);
  p.slip = inside ? 1 : Math.max(0, p.slip - 1 / Math.max(1, c.recoverTicks));
}

/**
 * Cuerpo gigante: el radio físico crece y se achica de a poco. Sólo crece en
 * el espacio libre (jugadores, pelota, postes y límites), así nunca aparece
 * solapado ni genera empujes explosivos; al terminar vuelve al tamaño normal.
 */
function updateGiant(s: GameState, p: PlayerState): void {
  if (p.giant === 0 && p.d.r === PLAYER.radius) return;
  const c = cfg(s).ibai.giant;
  const base = PLAYER.radius;
  const target = p.giant > 0 ? base * c.radiusMult : base;
  const rate = (base * (c.radiusMult - 1)) / Math.max(1, c.growTicks);
  if (p.d.r > target) p.d.r = Math.max(target, p.d.r - rate);
  else if (p.d.r < target) {
    let room = Math.min(STADIUM.width - Math.abs(p.d.x), STADIUM.height - Math.abs(p.d.y)) - p.d.r;
    for (const o of s.players) if (o !== p && inPlay(o)) room = Math.min(room, Math.hypot(o.d.x - p.d.x, o.d.y - p.d.y) - o.d.r - p.d.r);
    room = Math.min(room, Math.hypot(s.ball.x - p.d.x, s.ball.y - p.d.y) - s.ball.r - p.d.r);
    for (const q of stadium.posts) room = Math.min(room, Math.hypot(q.x - p.d.x, q.y - p.d.y) - q.r - p.d.r);
    p.d.r = Math.min(target, p.d.r + Math.min(rate, Math.max(0, room - 0.5)));
  }
}

/** Ilusión de la Gema de la Realidad: la pelota falsa acompaña a Thanos; al terminar, intervalo de visibilidad real. */
function updateIllusion(s: GameState): void {
  if (s.illusionGap > 0) s.illusionGap--;
  const il = s.illusion;
  if (!il) return;
  const p = findPlayer(s, il.by);
  if (p) [il.x, il.y] = illusionSpot(s, p);
  if (!p || --il.ticks <= 0) endIllusion(s);
}

function endIllusion(s: GameState): void {
  const il = s.illusion;
  if (!il) return;
  s.illusion = null;
  s.illusionGap = cfg(s).thanos.reality.between;
  s.events.push({ type: 'illusion', by: il.by, team: il.team, result: 'end' });
}

/** Historial de los jugadores de esta jugada (Gema del Tiempo). */
function recordPlayers(s: GameState): void {
  const max = cfg(s).thanos.time.ticks * 4;
  for (const p of s.players) {
    const h = (s.plHist[p.id] ??= []);
    h.push(p.d.x, p.d.y, p.d.vx, p.d.vy);
    if (h.length > max) h.splice(0, h.length - max);
  }
}

/** Electricidad y energía del Kamehameha por contacto físico, e historial para rebobinar. */
function updateBall(s: GameState): void {
  const b = s.ball;
  if (s.ballKi > 0) {
    if (ballGuarded(s)) {
      s.ballKi = 0;
      s.ballKiBy = null;
    } else {
      const by = s.ballKiBy ? findPlayer(s, s.ballKiBy) : undefined;
      const c = cfg(s).goku.kame;
      // el primer rival que la toca: empujón hacia afuera y aturdimiento; después se consume
      const o = by && s.players.find((q) => q.team !== by.team && inPlay(q) && Math.hypot(q.d.x - b.x, q.d.y - b.y) - q.d.r - b.r <= 1);
      if (!by || o) {
        if (o && by) {
          const d = Math.hypot(o.d.x - b.x, o.d.y - b.y) || 1;
          pushPlayer(s, o, (o.d.x - b.x) / d, (o.d.y - b.y) / d, c.energyImpulse);
          applyStun(s, o, c.energyStun);
          s.events.push({ type: 'hit', x: o.d.x, y: o.d.y, target: 'player' });
        }
        s.ballKi = 0;
        s.ballKiBy = null;
      } else if (--s.ballKi === 0) s.ballKiBy = null;
    }
  }
  if (s.ballElec > 0) {
    for (const p of s.players) {
      if (s.ballElecHit.includes(p.id) || !inPlay(p)) continue;
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
      } else if (pr.kind === 'donut') {
        // rosquilla: frena una vez, reduce los impulsos extra y protege la pelota de todo poder
        // (como ya no estaba protegida, la protección nunca se prolonga con otra rosquilla)
        const c = P.homer.donut;
        b.vx *= 1 - c.ballSlow;
        b.vy *= 1 - c.ballSlow;
        protectBall(s, pr.owner, Math.min(c.protectTicks, c.ballTicks));
        s.ballDonut = c.ballTicks;
        s.lastTouch = pr.owner;
      } else if (pr.kind === 'ruler') {
        // regla: la deja quieta una vez (no la congela)
        b.vx = 0;
        b.vy = 0;
        s.lastTouch = pr.owner;
      } else {
        // impulso en la dirección del disparo (un solo impacto)
        const impulse = {
          batarang: P.batman.batarang.ballImpulse,
          repulsor: P.ironman.repulsor.ballImpulse,
          hammer: P.thor.hammer.ballImpulse,
          bullet: P.cj.gun.ballImpulse,
        }[pr.kind as 'batarang' | 'repulsor' | 'hammer' | 'bullet'];
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
    // el gancho y la regla sólo buscan la pelota: atraviesan a los jugadores
    if (pr.kind === 'hook' || pr.kind === 'ruler') continue;
    for (const o of s.players) {
      if (o.id === pr.owner || !inPlay(o)) continue;
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
        case 'bullet':
          if (!rival) continue;
          pushPlayer(s, o, ux, uy, P.cj.gun.playerImpulse);
          break;
        case 'donut':
          if (!rival) continue;
          applyIncap(s, o, 'trap', P.homer.donut.trapTicks);
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
        pullToward(b, p.d.x, p.d.y, c.pullAccel * ballImpulseFactor(s), c.pullMaxSpeed);
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
            const k = c.arriveImpulse * ballImpulseFactor(s);
            b.vx += ((b.x - p.d.x) / dist) * k;
            b.vy += ((b.y - p.d.y) / dist) * k;
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
 * stuns, electricidad, protección, portales, tragados, tinta, ki e historial
 * de la jugada. Las recargas siguen corriendo.
 */
export function clearEffects(s: GameState): void {
  // primero se libera a los tragados en un lugar válido
  for (const p of s.players) if (p.eatenBy) releaseVictim(s, p, findPlayer(s, p.eatenBy) ?? null, false);
  s.ballKi = 0;
  s.ballKiBy = null;
  s.projectiles = [];
  s.tethers = [];
  s.zones = [];
  s.ballShield = 0;
  s.ballShieldMax = 0;
  s.ballShieldBy = null;
  s.ballElec = 0;
  s.ballElecHit = [];
  s.ballHist = [];
  s.ballDonut = 0;
  s.plHist = {};
  s.illusion = null;
  s.illusionGap = 0;
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
    p.trap = 0;
    p.mind = 0;
    p.mindBy = null;
    p.incapRun = 0;
    p.slip = 0;
    p.jet = 0;
    p.anger = 0;
    p.giant = 0;
    p.d.r = PLAYER.radius;
    p.quiz = null;
    p.quizImmune = 0;
    p.shotGap = 0;
    p.powerKick = 0;
    p.gemGap = 0;
    p.incapCap = STUN.maxTicks;
    p.kickHits = {};
    p.ink = 0;
    p.inkRun = 0;
    p.inkImmune = 0;
    p.inkForm = 0;
    p.spray = 0;
    p.holding = null;
    p.holdTicks = 0;
    p.eatenBy = null;
    p.charge = 0;
    p.chargeKi = false;
    // el ki se reinicia con cada gol
    p.ki = 0;
    p.kiGap = 0;
    p.blinkKick = 0;
    p.freeBlink = 0;
  }
}

// ---------------------------------------------------------------- tercera tanda

/** Mancha de tinta: adonde va el rival más cercano al alcance (anticipado a la caída); si no hay, hacia donde mira. */
export function puddleSpot(s: GameState, p: PlayerState): [number, number] {
  const c = cfg(s).bendy.puddle;
  let best: PlayerState | null = null;
  let bestGap = Infinity;
  for (const o of s.players) {
    if (o.team === p.team || !inPlay(o)) continue;
    const gap = Math.hypot(o.d.x - p.d.x, o.d.y - p.d.y) - p.d.r - o.d.r;
    if (gap > c.range || lineBlocked(p.d.x, p.d.y, o.d.x, o.d.y)) continue;
    if (gap < bestGap - 1e-6 || (Math.abs(gap - bestGap) <= 1e-6 && best && o.id < best.id)) {
      best = o;
      bestGap = gap;
    }
  }
  let tx = best ? best.d.x + best.d.vx * c.flightTicks : p.d.x + p.ax * (c.range * 0.6 + p.d.r);
  let ty = best ? best.d.y + best.d.vy * c.flightTicks : p.d.y + p.ay * (c.range * 0.6 + p.d.r);
  const dist = Math.hypot(tx - p.d.x, ty - p.d.y);
  if (dist > c.range + p.d.r) {
    tx = p.d.x + ((tx - p.d.x) / dist) * (c.range + p.d.r);
    ty = p.d.y + ((ty - p.d.y) / dist) * (c.range + p.d.r);
  }
  return clampToStadium(tx, ty, 6);
}

/**
 * Chorro de Jeff: franja recta desde su borde en la dirección fijada, cortada
 * por paredes y postes. Cada tick acelera la pelota y a los rivales dentro de
 * la franja (sin pasar `ballMax`/`playerMax` en esa dirección). La pelota
 * protegida no se mueve.
 */
function sprayWater(s: GameState, z: Zone, owner: PlayerState): void {
  const c = cfg(s).jeff.water;
  const ox = owner.d.x + z.dx * owner.d.r;
  const oy = owner.d.y + z.dy * owner.d.r;
  z.x = ox;
  z.y = oy;
  z.len = rayFree(ox, oy, z.dx, z.dy, c.range);
  const inside = (x: number, y: number, r: number): boolean => {
    const rx = x - ox;
    const ry = y - oy;
    const t = rx * z.dx + ry * z.dy;
    return t >= -r && t <= z.len + r && Math.abs(rx * z.dy - ry * z.dx) <= z.r + r;
  };
  const b = s.ball;
  if (inside(b.x, b.y, b.r) && !lineBlocked(ox, oy, b.x, b.y)) {
    if (ballGuarded(s)) {
      if (z.ticks % 15 === 0) s.events.push({ type: 'blocked', x: b.x, y: b.y });
    } else {
      pullAlong(b, z.dx, z.dy, c.ballAccel * ballImpulseFactor(s), c.ballMax);
      s.lastTouch = owner.id;
    }
  }
  for (const o of s.players) {
    if (o.team === owner.team || !inPlay(o) || !inside(o.d.x, o.d.y, o.d.r)) continue;
    pullAlong(o.d, z.dx, z.dy, c.playerAccel * o.d.invMass * 2 * pushFactor(s, o), c.playerMax);
  }
}

/** Acelera `d` en la dirección (ux, uy) sin pasar `max` en esa componente. */
function pullAlong(d: { vx: number; vy: number }, ux: number, uy: number, accel: number, max: number): void {
  const along = d.vx * ux + d.vy * uy;
  if (along >= max) return;
  const add = Math.min(accel, max - along);
  d.vx += ux * add;
  d.vy += uy * add;
}

/** Rival que Jeff puede tragar: uno solo, pegado delante, a la vista, sin estar tragado ni llevando a alguien. */
export function swallowTarget(s: GameState, p: PlayerState): PlayerState | null {
  const c = cfg(s).jeff.swallow;
  const cos = Math.cos((c.cone * Math.PI) / 180);
  let best: PlayerState | null = null;
  let bestGap = Infinity;
  for (const o of s.players) {
    if (o.team === p.team || !inPlay(o) || o.holding) continue;
    const dx = o.d.x - p.d.x;
    const dy = o.d.y - p.d.y;
    const dist = Math.hypot(dx, dy);
    const gap = dist - p.d.r - o.d.r;
    if (dist === 0 || gap > c.range) continue;
    if ((dx * p.ax + dy * p.ay) / dist < cos - 1e-9) continue;
    if (lineBlocked(p.d.x, p.d.y, o.d.x, o.d.y)) continue;
    if (gap < bestGap - 1e-6 || (Math.abs(gap - bestGap) <= 1e-6 && best && o.id < best.id)) {
      best = o;
      bestGap = gap;
    }
  }
  return best;
}

/** Traga al rival: sale de la física, pierde lo que estaba haciendo y acompaña a Jeff. */
function swallow(s: GameState, p: PlayerState, v: PlayerState): void {
  const c = cfg(s).jeff.swallow;
  p.holding = v.id;
  p.holdTicks = c.holdTicks;
  v.eatenBy = p.id;
  v.kickArmed = false;
  v.rush = 0;
  v.dash = 0;
  v.charge = 0;
  v.spray = 0;
  v.inkForm = 0;
  v.mind = 0;
  v.mindBy = null;
  v.d.x = p.d.x;
  v.d.y = p.d.y;
  v.d.vx = 0;
  v.d.vy = 0;
  v.warp++;
  // lo que dependía de su posición se corta (hilos, canalizaciones, chorro)
  s.tethers = s.tethers.filter((t) => t.owner !== v.id && t.target !== v.id);
  s.zones = s.zones.filter((z) => !(z.owner === v.id && (z.kind === 'portal' || z.kind === 'space' || z.kind === 'water')));
  for (const o of s.players) if (o.mindBy === v.id) o.mind = 0;
  s.events.push({ type: 'swallow', id: v.id, by: p.id, result: 'in' });
}

/**
 * Libera a un tragado en el lugar legal más cercano delante de Jeff (o donde
 * esté). `spit`: escupido con empuje y aturdimiento; si no, sólo se libera
 * (gol, reinicio, salida, cambio de equipo).
 */
export function releaseVictim(s: GameState, v: PlayerState, jeff: PlayerState | null, spit: boolean): void {
  const c = cfg(s).jeff.swallow;
  v.eatenBy = null;
  const ax = jeff ? jeff.ax : 0;
  const ay = jeff ? jeff.ay : 0;
  if (jeff) {
    if (jeff.holding === v.id) jeff.holding = null;
    jeff.holdTicks = 0;
    const gap = jeff.d.r + v.d.r + 2;
    const spot = freeSpot(s, jeff.d.x + ax * gap, jeff.d.y + ay * gap, v.d.r, 'player', v) ?? freeSpot(s, jeff.d.x, jeff.d.y, v.d.r, 'player', v);
    if (spot) {
      v.d.x = spot[0];
      v.d.y = spot[1];
    }
  }
  const [cx, cy] = clampToStadium(v.d.x, v.d.y, v.d.r);
  v.d.x = cx;
  v.d.y = cy;
  v.d.vx = 0;
  v.d.vy = 0;
  v.warp++;
  if (spit && jeff) {
    pushPlayer(s, v, ax, ay, c.spitImpulse);
    applyStun(s, v, c.stunTicks);
  }
  s.events.push({ type: 'swallow', id: v.id, by: jeff?.id ?? '', result: 'out' });
}

/** Tragado: acompaña a Jeff; se escupe solo al agotarse el tiempo; si Jeff ya no está, se libera. */
function updateSwallow(s: GameState, p: PlayerState): void {
  if (p.holding) {
    const v = findPlayer(s, p.holding);
    if (!v || v.eatenBy !== p.id) {
      p.holding = null;
      p.holdTicks = 0;
    } else if (--p.holdTicks <= 0) releaseVictim(s, v, p, true);
  }
  if (p.eatenBy) {
    const j = findPlayer(s, p.eatenBy);
    if (!j || j.holding !== p.id) releaseVictim(s, p, j ?? null, false);
  }
}

/** Dirección del Kamehameha: primero la pelota (a la vista y al alcance), después un rival; si no, hacia donde mira. */
export function kameAim(s: GameState, p: PlayerState): { dx: number; dy: number; target: AimTarget | null } {
  const c = cfg(s).goku.kame;
  const t = pickTarget(s, p, { range: c.range, ball: true, rivals: false }) ?? pickTarget(s, p, { range: c.range, ball: false, rivals: true });
  if (t) {
    const d = Math.hypot(t.x - p.d.x, t.y - p.d.y);
    if (d > 0) return { dx: (t.x - p.d.x) / d, dy: (t.y - p.d.y) / d, target: t };
  }
  return { dx: p.ax, dy: p.ay, target: null };
}

/** Carga máxima efectiva (el ki la reduce a la mitad). */
export function kameMaxCharge(s: GameState, p: PlayerState): number {
  const c = cfg(s).goku;
  return Math.max(1, Math.round(c.kame.maxCharge * (p.chargeKi ? c.ki.chargeMult : 1)));
}

/**
 * Carga del Kamehameha (cada tick, antes de activar poderes): mantener Q
 * carga; soltar dispara. Un aturdimiento, quiz o tragado la cancela sin gastar
 * la recarga.
 */
export function chargeInput(s: GameState, p: PlayerState, held: boolean): void {
  if (p.charge <= 0) return;
  if (incapacitated(p)) {
    p.charge = 0;
    p.chargeKi = false;
    return;
  }
  if (held) {
    p.charge = Math.min(p.charge + 1, kameMaxCharge(s, p));
    return;
  }
  fireKame(s, p);
}

/**
 * Rayo: franja recta desde el borde de Goku hasta la primera pared o poste.
 * Empuja la pelota (si no está protegida) y a cada rival que atraviesa, una
 * vez, con fuerza según la carga. A carga máxima la pelota queda con energía.
 */
function fireKame(s: GameState, p: PlayerState): void {
  const P = cfg(s).goku;
  const c = P.kame;
  const frac = Math.max(c.minFrac, Math.min(1, p.charge / kameMaxCharge(s, p)));
  const full = p.charge >= kameMaxCharge(s, p);
  const boost = p.chargeKi ? P.ki.pushMult : 1;
  p.charge = 0;
  p.chargeKi = false;
  const aim = kameAim(s, p);
  const ox = p.d.x + aim.dx * p.d.r;
  const oy = p.d.y + aim.dy * p.d.r;
  const len = rayFree(ox, oy, aim.dx, aim.dy, c.range);
  const z = addZone(s, p, 'kame', ox, oy, c.halfWidth, 0, c.beamTicks);
  z.dx = aim.dx;
  z.dy = aim.dy;
  z.len = len;
  z.ang = frac;
  const inside = (x: number, y: number, r: number): boolean => {
    const rx = x - ox;
    const ry = y - oy;
    const t = rx * aim.dx + ry * aim.dy;
    return t >= -r && t <= len + r && Math.abs(rx * aim.dy - ry * aim.dx) <= z.r + r;
  };
  const b = s.ball;
  if (inside(b.x, b.y, b.r) && !lineBlocked(ox, oy, b.x, b.y)) {
    if (pushBall(s, aim.dx, aim.dy, c.ballImpulse * frac * boost, p.id)) {
      s.events.push({ type: 'hit', x: b.x, y: b.y, target: 'ball' });
      if (full) {
        s.ballKi = c.energyTicks;
        s.ballKiBy = p.id;
      }
    } else s.events.push({ type: 'blocked', x: b.x, y: b.y });
  }
  for (const o of s.players) {
    if (o.team === p.team || !inPlay(o) || !inside(o.d.x, o.d.y, o.d.r)) continue;
    pushPlayer(s, o, aim.dx, aim.dy, c.playerImpulse * frac * boost);
    s.events.push({ type: 'hit', x: o.d.x, y: o.d.y, target: 'player' });
  }
  p.cdQ = s.noCd ? 0 : c.cooldown;
  s.events.push({ type: 'power', id: p.id, slot: 'q', hero: p.hero });
}

/** Lugar de la Transmisión instantánea: pegado a la pelota, del lado opuesto al arco rival. null si está lejos o no hay lugar. */
export function blinkSpot(s: GameState, p: PlayerState): [number, number] | null {
  const c = cfg(s).goku.blink;
  const b = s.ball;
  if (Math.hypot(b.x - p.d.x, b.y - p.d.y) - p.d.r - b.r > c.range) return null;
  const gx = (p.team === 'red' ? 1 : -1) * STADIUM.fieldW;
  let ux = gx - b.x;
  let uy = -b.y;
  const d = Math.hypot(ux, uy) || 1;
  ux /= d;
  uy /= d;
  const gap = b.r + p.d.r + 2;
  return freeSpot(s, b.x - ux * gap, b.y - uy * gap, p.d.r, 'player', p);
}

/**
 * Transmisión instantánea. Normal: patada potenciada y onda que aparta a los
 * rivales (nunca la pelota); con el ki lleno deja una segunda gratis. Gratis:
 * sólo el teletransporte. Sin lugar válido no gasta nada.
 */
function gokuBlink(s: GameState, p: PlayerState, free: boolean): boolean {
  const P = cfg(s).goku;
  const c = P.blink;
  const spot = blinkSpot(s, p);
  if (!spot) {
    s.events.push({ type: 'fizzle', id: p.id, slot: 'e' });
    return false;
  }
  const x0 = p.d.x;
  const y0 = p.d.y;
  p.d.x = spot[0];
  p.d.y = spot[1];
  p.d.vx = 0;
  p.d.vy = 0;
  p.rush = 0;
  p.dash = 0;
  p.warp++;
  s.events.push({ type: 'blink', id: p.id, x0, y0, x1: p.d.x, y1: p.d.y });
  if (free) p.freeBlink = 0;
  else {
    p.blinkKick = c.kickTicks;
    for (const o of s.players) {
      if (o.team === p.team || !inPlay(o)) continue;
      radialPush(p.d.x, p.d.y, o.d, c.waveRadius, c.waveImpulse * o.d.invMass * pushFactor(s, o), LIMITS.playerMaxSpeed, p.d.r);
    }
    s.events.push({ type: 'slam', x: p.d.x, y: p.d.y, r: c.waveRadius + p.d.r });
    if (kiReady(s, p)) {
      p.ki = 0;
      p.freeBlink = P.ki.freeTicks;
    }
    p.cdE = s.noCd ? 0 : c.cooldown;
  }
  s.events.push({ type: 'power', id: p.id, slot: 'e', hero: p.hero });
  return true;
}

/**
 * Patada de Ibai gigante a los rivales: alcance de patada escalado por su
 * tamaño, empuje hacia afuera, un impacto por rival y patada, y un intervalo
 * mínimo por rival. Devuelve cuántos golpeó.
 */
export function giantKick(s: GameState, p: PlayerState): number {
  const c = cfg(s).ibai.giant;
  const reach = KICK.range * (p.d.r / PLAYER.radius);
  let hits = 0;
  for (const o of s.players) {
    if (o.team === p.team || !inPlay(o)) continue;
    const dx = o.d.x - p.d.x;
    const dy = o.d.y - p.d.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist - p.d.r - o.d.r > reach) continue;
    const last = p.kickHits[o.id];
    if (last !== undefined && s.tick - last < c.kickGap) continue;
    p.kickHits[o.id] = s.tick;
    pushPlayer(s, o, dx / dist, dy / dist, c.kickImpulse);
    s.events.push({ type: 'hit', x: o.d.x, y: o.d.y, target: 'player' });
    hits++;
  }
  return hits;
}

/** Instinto de combate: una carga de ki por patada a la pelota (máximo una cada `gap`). */
export function gainKi(s: GameState, p: PlayerState): void {
  const c = cfg(s).goku.ki;
  if (p.hero !== 'goku' || p.kiGap > 0 || p.ki >= c.max) return;
  p.ki++;
  p.kiGap = c.gap;
  s.events.push({ type: 'ki', id: p.id, ki: p.ki });
}

