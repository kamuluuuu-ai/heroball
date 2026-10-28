// Remodelación de habilidades: cada poder en Héroes y Súper, protección de la
// pelota, aturdimientos, sorteo del misil, rebobinar, portal y «Sin cooldowns».
import { describe, expect, it } from 'vitest';
import { BALL, HeroId, K, LIMITS, PLAYER, POWER_LIMITS, POWERS, R, STADIUM, STUN, SUPER_POWERS } from '../shared/config';
import { createGame, removePlayer, setInput, step } from '../shared/game';
import { activate, powerActive } from '../shared/powers';
import { GameEvent, GameState, IN, Team } from '../shared/types';
import { Client, Lobby } from '../server/room';
import { evaluateMatch } from '../server/official';
import { netSim } from './netsim';

type P = { id: string; team: Team; hero: HeroId };
type Mode = 'heroes' | 'super';
const MODES: Mode[] = ['heroes', 'super'];
const cfgOf = (m: Mode) => (m === 'super' ? SUPER_POWERS : POWERS);

function game(players: P[], mode: Mode = 'heroes', extra: { noCooldowns?: boolean; seed?: number } = {}): GameState {
  const s = createGame({ mode, timeLimitMin: 3, scoreLimit: 3, players, ...extra });
  s.phase = 'playing';
  ball(s, 0, 160);
  // sin historial previo al test
  s.ballHist = [];
  return s;
}

function tick(s: GameState, bits: Record<string, number> = {}): GameEvent[] {
  for (const [id, b] of Object.entries(bits)) setInput(s, id, b);
  s.events = [];
  step(s);
  return s.events;
}

/** Avanza n ticks sin entradas y junta los eventos. */
function run(s: GameState, n: number, each?: () => void): GameEvent[] {
  const ev: GameEvent[] = [];
  const idle = Object.fromEntries(s.players.map((p) => [p.id, 0]));
  for (let i = 0; i < n; i++) {
    ev.push(...tick(s, idle));
    each?.();
  }
  return ev;
}

function pl(s: GameState, id: string) {
  return s.players.find((o) => o.id === id)!;
}

function place(s: GameState, id: string, x: number, y: number, ax = 1, ay = 0) {
  const p = pl(s, id);
  p.d.x = x; p.d.y = y; p.d.vx = 0; p.d.vy = 0;
  p.ax = ax; p.ay = ay;
  return p;
}

function ball(s: GameState, x: number, y: number, vx = 0, vy = 0) {
  s.ball.x = x; s.ball.y = y; s.ball.vx = vx; s.ball.vy = vy;
}

/** Flanco de Q o E y n-1 ticks sin entradas. */
function cast(s: GameState, id: string, slot: 'q' | 'e', n = 1): GameEvent[] {
  const ev = tick(s, { [id]: slot === 'q' ? IN.Q : IN.E });
  if (n > 1) ev.push(...run(s, n - 1));
  return ev;
}

/** Máxima rapidez que alcanza la pelota mientras corre `n` ticks (el impulso se ve completo al final del tick del impacto). */
function peakBall(s: GameState, n: number): number {
  let m = Math.hypot(s.ball.vx, s.ball.vy);
  run(s, n, () => { m = Math.max(m, Math.hypot(s.ball.vx, s.ball.vy)); });
  return m;
}

const speed = (d: { vx: number; vy: number }) => Math.hypot(d.vx, d.vy);
const edge = (a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }) => Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
const powers = (ev: GameEvent[], slot?: 'q' | 'e') => ev.filter((e) => e.type === 'power' && (!slot || e.slot === slot)).length;

describe('Superman Q: visión láser', () => {
  it.each(MODES)('%s: anticipación, impulso exacto a la pelota, recarga y ancho real', (mode) => {
    const c = cfgOf(mode).superman.laser;
    const s = game([{ id: 'a', team: 'red', hero: 'superman' }], mode);
    place(s, 'a', -200, 0);
    ball(s, -200 + R + 6 * R, 0);
    cast(s, 'a', 'q');
    const p = pl(s, 'a');
    expect(p.cdQ).toBe(c.cooldown - 1);
    const z = s.zones.find((q) => q.kind === 'laser')!;
    // el dibujo usa 2·z.r: el ancho de impacto
    expect(z.r).toBe(c.halfWidth);
    run(s, c.windup - 2);
    expect(s.ball.vx).toBe(0);
    expect(peakBall(s, 3)).toBeCloseTo(c.ballImpulse, 6);
    expect(c.ballImpulse).toBeCloseTo((mode === 'super' ? 1.8 : 1.3) * K, 9);
    expect(c.range).toBe((mode === 'super' ? 18 : 12) * R);
  });

  it('se autoapunta a la pelota o a un rival; sin objetivo va hacia donde se movió', () => {
    const c = POWERS.superman.laser;
    // pelota fuera de la línea: el haz la busca
    const s = game([{ id: 'a', team: 'red', hero: 'superman' }]);
    place(s, 'a', -200, 0);
    ball(s, -100, 45);
    cast(s, 'a', 'q', c.windup + 5);
    expect(s.ball.vx).toBeGreaterThan(1);
    expect(s.ball.vy).toBeGreaterThan(0.3);
    // rival fuera de la línea (sin pelota cerca): también
    const r = game([{ id: 'a', team: 'red', hero: 'superman' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
    place(r, 'a', -200, 0);
    const b = place(r, 'b', -100, -50);
    cast(r, 'a', 'q', c.windup + 5);
    expect(b.d.vy).toBeLessThan(0);
    // detrás no apunta; sin objetivo, dirección de movimiento
    const t = game([{ id: 'a', team: 'red', hero: 'superman' }]);
    place(t, 'a', -100, 0, 0, -1);
    ball(t, -100, 100);
    cast(t, 'a', 'q');
    const z = t.zones.find((q) => q.kind === 'laser')!;
    expect([z.dx, z.dy]).toEqual([0, -1]);
    run(t, c.windup + 5);
    expect(speed(t.ball)).toBe(0);
    // fuera de alcance: nada
    const u = game([{ id: 'a', team: 'red', hero: 'superman' }]);
    place(u, 'a', -300, 0);
    ball(u, -300 + R + c.range + BALL.radius + 2, 0);
    cast(u, 'a', 'q', c.windup + 5);
    expect(speed(u.ball)).toBe(0);
  });

  it('ancho de impacto = ancho dibujado (Súper atraviesa al rival apuntado)', () => {
    const c = SUPER_POWERS.superman.laser;
    for (const [off, hit] of [[c.halfWidth + BALL.radius - 0.5, true], [c.halfWidth + BALL.radius + 0.5, false]] as [number, boolean][]) {
      const s = game([{ id: 'a', team: 'red', hero: 'superman' }, { id: 'b', team: 'blue', hero: 'hulk' }], 'super');
      place(s, 'a', -300, 0);
      place(s, 'b', -200, 0);
      ball(s, -70, off);
      cast(s, 'a', 'q', c.windup + 5);
      expect(speed(s.ball) > 0).toBe(hit);
    }
  });

  it('Héroes: sólo el primer objetivo; Súper atraviesa jugadores y llega a la pelota (un impacto cada uno)', () => {
    for (const mode of MODES) {
      const c = cfgOf(mode).superman.laser;
      const s = game([{ id: 'a', team: 'red', hero: 'superman' }, { id: 'b', team: 'blue', hero: 'hulk' }], mode);
      place(s, 'a', -250, 0);
      const b = place(s, 'b', -170, 0);
      ball(s, -100, 0);
      const ev = cast(s, 'a', 'q', c.windup + 12);
      const hits = ev.filter((e) => e.type === 'hit');
      expect(b.d.vx).toBeGreaterThan(0);
      if (mode === 'heroes') {
        expect(speed(s.ball)).toBe(0);
        expect(hits).toHaveLength(1);
      } else {
        expect(s.ball.vx).toBeGreaterThan(1);
        expect(hits).toHaveLength(2);
      }
    }
  });

  it('las paredes cortan el haz (largo del dibujo = largo real)', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'superman' }]);
    place(s, 'a', 300, 120);
    cast(s, 'a', 'q', POWERS.superman.laser.windup + 1);
    const z = s.zones.find((q) => q.kind === 'laser')!;
    expect(z.len).toBeLessThan(STADIUM.fieldW - 300);
    expect(z.len).toBeGreaterThan(0);
  });
});

describe('Hawkeye Q: flecha explosiva', () => {
  it.each(MODES)('%s: explota en la pelota con impulso ≤ máximo y empuja a todos dentro del radio real', (mode) => {
    const c = cfgOf(mode).hawkeye.arrow;
    const s = game([
      { id: 'a', team: 'red', hero: 'hawkeye' },
      { id: 'm', team: 'red', hero: 'hulk' },
      { id: 'b', team: 'blue', hero: 'hulk' },
      { id: 'far', team: 'blue', hero: 'hulk' },
    ], mode);
    place(s, 'a', -250, 0);
    ball(s, -100, 0);
    const mate = place(s, 'm', -100, -BALL.radius - R - 6);
    const riv = place(s, 'b', -100, BALL.radius + R + 6);
    const far = place(s, 'far', -100, c.blastRadius + R + 30);
    const ev = cast(s, 'a', 'q');
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      ev.push(...run(s, 1));
      peak = Math.max(peak, speed(s.ball));
    }
    const boom = ev.find((e) => e.type === 'boom')!;
    expect(boom).toMatchObject({ kind: 'arrow', r: c.blastRadius });
    expect(peak).toBeLessThanOrEqual(c.ballImpulse + 1e-9);
    expect(peak).toBeGreaterThan(c.ballImpulse * 0.8);
    // aliado y rival: ambos empujados hacia afuera
    expect(mate.d.vy).toBeLessThan(0);
    expect(riv.d.vy).toBeGreaterThan(0);
    // fuera del radio: nada
    expect(speed(far.d)).toBe(0);
  });

  it('empuja también a Hawkeye si está dentro de la explosión', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'hawkeye' }]);
    const a = place(s, 'a', -200, 0);
    ball(s, -200 + R + BALL.radius + 8, 0);
    cast(s, 'a', 'q', 3);
    expect(a.d.vx).toBeLessThan(0);
    expect(s.ball.vx).toBeGreaterThan(0);
  });

  it('sin objetivo explota al final del alcance (12R Héroes, 16R Súper)', () => {
    for (const mode of MODES) {
      const c = cfgOf(mode).hawkeye.arrow;
      const s = game([{ id: 'a', team: 'red', hero: 'hawkeye' }], mode);
      place(s, 'a', -250, -100);
      ball(s, 300, 160);
      const ev = cast(s, 'a', 'q', 80);
      const boom = ev.find((e) => e.type === 'boom') as Extract<GameEvent, { type: 'boom' }>;
      expect(boom).toBeDefined();
      expect(boom.x + 250 - R).toBeGreaterThan(c.range - 5);
      expect(boom.x + 250 - R).toBeLessThanOrEqual(c.range + 4); // subpasos de 3 unidades
      expect(pl(s, 'a').cdQ).toBe(c.cooldown - 80);
    }
  });

  it('explota contra el primer rival y atraviesa aliados', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'hawkeye' }, { id: 'm', team: 'red', hero: 'hulk' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
    place(s, 'a', -300, 0);
    place(s, 'm', -230, 0);
    const b = place(s, 'b', -100, 0);
    ball(s, 200, 160);
    const ev = cast(s, 'a', 'q', 30);
    const boom = ev.find((e) => e.type === 'boom') as Extract<GameEvent, { type: 'boom' }>;
    expect(Math.abs(boom.x - (-100 - R))).toBeLessThan(6);
    expect(b.d.vx).toBeGreaterThan(0);
  });
});

describe('Black Widow E: dash', () => {
  it.each(MODES)('%s: duración y velocidad pedidas, recarga, colisiones y sin atravesar', (mode) => {
    const c = cfgOf(mode).widow.dash;
    const s = game([{ id: 'a', team: 'red', hero: 'widow' }], mode);
    const a = place(s, 'a', -300, -100);
    cast(s, 'a', 'e', 3);
    // recorrido por tick = speedMult × la velocidad normal máxima
    const x0 = a.d.x;
    run(s, 1);
    expect(a.d.x - x0).toBeCloseTo(LIMITS.playerInputSpeed * c.speedMult, 6);
    expect(a.rush).toBeGreaterThan(0);
    run(s, c.ticks);
    expect(a.rush).toBe(0);
    expect(a.d.x + 300).toBeGreaterThan(LIMITS.playerInputSpeed * c.speedMult * c.ticks * 0.95);
    expect(pl(s, 'a').cdE).toBe(c.cooldown - 4 - c.ticks);
    // un rival adelante: lo empuja por choque, nunca lo atraviesa
    const t = game([{ id: 'a', team: 'red', hero: 'widow' }, { id: 'b', team: 'blue', hero: 'hulk' }], mode);
    const w = place(t, 'a', -300, -100);
    const b = place(t, 'b', -300 + 2 * R + 20, -100);
    cast(t, 'a', 'e');
    for (let i = 0; i < c.ticks + 5; i++) {
      run(t, 1);
      expect(w.d.x).toBeLessThan(b.d.x);
      expect(edge(w.d, b.d)).toBeGreaterThan(-1.5);
    }
  });

  it('Súper: −40 % de empuje de poderes durante el dash', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'widow' }], 'super');
    const a = place(s, 'a', -300, -100);
    cast(s, 'a', 'e');
    expect(a.evadeResist).toBeCloseTo(0.4, 9);
    const h = game([{ id: 'a', team: 'red', hero: 'widow' }]);
    const b = place(h, 'a', -300, -100);
    cast(h, 'a', 'e');
    expect(b.evadeResist).toBe(0);
  });
});

describe('Capitán América Q: escudo encadenado', () => {
  it.each(MODES)('%s: pelota y rivales una vez cada uno, nunca aliados, hasta maxHits', (mode) => {
    const c = cfgOf(mode).cap.shield;
    const players: P[] = [{ id: 'a', team: 'red', hero: 'cap' }, { id: 'm', team: 'red', hero: 'hulk' }];
    for (let i = 0; i < 6; i++) players.push({ id: `b${i}`, team: 'blue', hero: 'hulk' });
    const s = game(players, mode);
    place(s, 'a', -300, 0);
    ball(s, -220, 0);
    const mate = place(s, 'm', -200, -45);
    // rivales en cadena, cada uno a menos de `search` del anterior
    for (let i = 0; i < 6; i++) place(s, `b${i}`, -195 + i * 30, 35 * (i % 2 ? -1 : 1));
    const ev = cast(s, 'a', 'q', c.maxTicks + 200);
    const hits = ev.filter((e) => e.type === 'hit' && e.target !== 'wall');
    expect(hits.filter((e) => e.type === 'hit' && e.target === 'ball')).toHaveLength(1);
    expect(hits.length).toBe(c.maxHits);
    expect(speed(mate.d)).toBeLessThan(0.5);
    // termina: no queda en bucle
    expect(s.projectiles).toHaveLength(0);
  });

  it('impulso a la pelota exacto y vida máxima', () => {
    for (const mode of MODES) {
      const c = cfgOf(mode).cap.shield;
      const s = game([{ id: 'a', team: 'red', hero: 'cap' }], mode);
      place(s, 'a', -300, 0);
      ball(s, -200, 0);
      cast(s, 'a', 'q');
      expect(peakBall(s, 20)).toBeCloseTo(c.ballImpulse, 6);
      expect(c.radius).toBeCloseTo((mode === 'super' ? 0.9 : 0.65) * R, 9);
    }
  });

  it('elección determinista: a igual distancia, el id estable menor', () => {
    for (const flip of [1, -1]) {
      const s = game([{ id: 'a', team: 'red', hero: 'cap' }, { id: 'b1', team: 'blue', hero: 'hulk' }, { id: 'b2', team: 'blue', hero: 'hulk' }]);
      place(s, 'a', -300, 0);
      ball(s, -200, 0);
      place(s, 'b1', -215, 40 * flip);
      place(s, 'b2', -215, -40 * flip);
      tick(s, { a: IN.Q });
      let target: string | null | undefined;
      for (let i = 0; i < 20 && !target; i++) {
        run(s, 1);
        const pr = s.projectiles.find((q) => q.kind === 'shield');
        if (pr?.target && pr.target !== 'ball') target = pr.target;
      }
      expect(target).toBe('b1');
    }
  });
});

describe('Capitán América E: protección de la pelota', () => {
  it.each(MODES)('%s: duración y alcance; fuera de alcance no gasta recarga', (mode) => {
    const c = cfgOf(mode).cap.protect;
    const s = game([{ id: 'a', team: 'red', hero: 'cap' }], mode);
    place(s, 'a', -300, 0);
    ball(s, -300 + R + c.range + BALL.radius - 2, 0);
    cast(s, 'a', 'e');
    expect(s.ballShield).toBe(c.ticks - 1);
    expect(pl(s, 'a').cdE).toBe(c.cooldown - 1);
    run(s, c.ticks);
    expect(s.ballShield).toBe(0);
    const t = game([{ id: 'a', team: 'red', hero: 'cap' }], mode);
    place(t, 'a', -300, 0);
    ball(t, -300 + R + c.range + BALL.radius + 5, 0);
    const ev = cast(t, 'a', 'e');
    expect(t.ballShield).toBe(0);
    expect(pl(t, 'a').cdE).toBe(0);
    expect(ev.some((e) => e.type === 'fizzle')).toBe(true);
  });

  /** Protege la pelota quieta en (0, 0) y prueba un poder. */
  function guarded(hero: HeroId, slot: 'q' | 'e', x: number, y: number, mode: Mode = 'heroes') {
    const s = game([{ id: 'c', team: 'blue', hero: 'cap' }, { id: 'a', team: 'red', hero }], mode);
    place(s, 'c', 0, -120);
    ball(s, 0, 0);
    cast(s, 'c', 'e');
    expect(s.ballShield).toBeGreaterThan(0);
    // el capitán se aparta del cono de autoapuntado (si no, sería el objetivo: la pelota protegida no lo es)
    place(s, 'c', 0, -185);
    place(s, 'a', x, y);
    s.ballHist = [];
    run(s, 30); // historial para Strange
    ball(s, 0, 0);
    const ev = cast(s, 'a', slot, 80);
    return { s, ev };
  }

  it.each([
    ['spider', 'q', -120, 0], ['batman', 'q', -120, 0], ['batman', 'e', -120, 0], ['hulk', 'q', -40, 0],
    ['superman', 'q', -120, 0], ['hawkeye', 'q', -150, 0], ['cap', 'q', -150, 0], ['panther', 'e', -40, 0],
    ['ironman', 'q', -150, 0], ['ironman', 'e', -150, 0], ['thor', 'q', -150, 0], ['strange', 'q', -150, 0],
  ] as [HeroId, 'q' | 'e', number, number][])('ningún poder mueve la pelota protegida: %s %s', (hero, slot, x, y) => {
    for (const mode of MODES) {
      const { s } = guarded(hero, slot, x, y, mode);
      // sólo cuenta lo que hizo el poder (no hubo choques con la pelota)
      expect(Math.abs(s.ball.x)).toBeLessThan(0.01);
      expect(Math.abs(s.ball.y)).toBeLessThan(0.01);
      expect(s.ballElec).toBe(0);
    }
  });

  it('los proyectiles bloqueados se consumen; los efectos radiales siguen empujando jugadores', () => {
    const { s, ev } = guarded('ironman', 'q', -150, 0);
    expect(ev.some((e) => e.type === 'blocked')).toBe(true);
    expect(s.projectiles).toHaveLength(0);
    // flecha: la pelota no se mueve pero el rival junto a ella sí
    const t = game([{ id: 'c', team: 'blue', hero: 'cap' }, { id: 'a', team: 'red', hero: 'hawkeye' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
    place(t, 'c', 0, -150);
    ball(t, 0, 0);
    cast(t, 'c', 'e');
    place(t, 'a', -150, 0);
    const b = place(t, 'b', 0, BALL.radius + R + 4);
    ball(t, 0, 0);
    cast(t, 'a', 'q', 30);
    expect(speed(t.ball)).toBe(0);
    expect(b.d.vy).toBeGreaterThan(0);
  });

  it('se puede patear y empujar por contacto; quita la electricidad sin cambiar posición ni velocidad', () => {
    const s = game([{ id: 'c', team: 'blue', hero: 'cap' }, { id: 'a', team: 'red', hero: 'hulk' }]);
    place(s, 'c', 0, -120);
    ball(s, 0, 0, 1.5, 0);
    s.ballElec = 50;
    s.ballElecStun = 20;
    s.ballElecHit = ['x'];
    // la activación ocurre antes de mover la pelota: posición y velocidad intactas en ese instante
    setInput(s, 'c', IN.E);
    s.events = [];
    const p = pl(s, 'c');
    p.prevInput = 0;
    expect(activate(s, p, 'e')).toBe(true);
    expect(s.ball.x).toBe(0);
    expect(s.ball.vx).toBe(1.5);
    expect(s.ballElec).toBe(0);
    // patada
    place(s, 'a', -BALL.radius - R - 2, 0);
    ball(s, 0, 0);
    tick(s, { a: IN.KICK, c: 0 });
    expect(s.ball.vx).toBeGreaterThan(3);
  });

  it('no se suma: otra protección no extiende más allá de la mayor duración', () => {
    const s = game([{ id: 'c', team: 'blue', hero: 'cap' }, { id: 'd', team: 'red', hero: 'cap' }]);
    place(s, 'c', 0, -120);
    place(s, 'd', 0, 120);
    ball(s, 0, 0);
    cast(s, 'c', 'e', 30);
    const left = s.ballShield;
    cast(s, 'd', 'e');
    expect(s.ballShield).toBe(POWERS.cap.protect.ticks - 1);
    expect(s.ballShield).toBeGreaterThan(left - 1);
    expect(s.ballShieldMax).toBe(POWERS.cap.protect.ticks);
  });
});

describe('Iron Man', () => {
  it.each(MODES)('%s Q: carga, impulso exacto a la pelota y empuje al rival', (mode) => {
    const c = cfgOf(mode).ironman.repulsor;
    const s = game([{ id: 'a', team: 'red', hero: 'ironman' }], mode);
    place(s, 'a', -300, 0);
    ball(s, -150, 0);
    cast(s, 'a', 'q', c.windup - 1);
    expect(s.projectiles[0].delay).toBeGreaterThan(0);
    expect(speed(s.ball)).toBe(0);
    expect(peakBall(s, 40)).toBeCloseTo(c.ballImpulse, 6);
    const t = game([{ id: 'a', team: 'red', hero: 'ironman' }, { id: 'b', team: 'blue', hero: 'hulk' }], mode);
    place(t, 'a', -300, 0);
    const b = place(t, 'b', -150, 0);
    cast(t, 'a', 'q', 40);
    expect(b.d.vx).toBeGreaterThan(0);
  });

  it.each(MODES)('%s E: misil a punto fijo, impulso exacto en dirección sorteada, sin tocar jugadores', (mode) => {
    const c = cfgOf(mode).ironman.missile;
    const s = game([{ id: 'a', team: 'red', hero: 'ironman' }, { id: 'b', team: 'blue', hero: 'hulk' }], mode, { seed: 1234 });
    place(s, 'a', -300, 0);
    ball(s, -300 + R + c.range - 5, 0);
    const b = place(s, 'b', s.ball.x, s.ball.y + BALL.radius + R + 2);
    cast(s, 'a', 'e');
    const z = s.zones.find((q) => q.kind === 'missile')!;
    expect(z.r).toBe(c.radius);
    expect([z.x, z.y]).toEqual([s.ball.x, s.ball.y]);
    run(s, c.delay - 2);
    expect(speed(s.ball)).toBe(0);
    const rng0 = s.rng;
    tick(s);
    expect(z.ang).not.toBeNull();
    expect(s.rng).not.toBe(rng0);
    expect(speed(s.ball)).toBeCloseTo(c.ballImpulse, 6);
    expect(Math.atan2(s.ball.vy, s.ball.vx)).toBeCloseTo(Math.atan2(Math.sin(z.ang!), Math.cos(z.ang!)), 6);
    // el jugador de al lado no recibió nada del misil
    expect(speed(b.d)).toBeLessThan(0.2);
  });

  it('E: si la pelota salió de la zona no pasa nada ni se sortea; fuera de alcance no gasta recarga', () => {
    const c = POWERS.ironman.missile;
    const s = game([{ id: 'a', team: 'red', hero: 'ironman' }]);
    place(s, 'a', -300, 0);
    ball(s, -150, 0);
    cast(s, 'a', 'e');
    ball(s, -150 + c.radius + 5, 0);
    const rng0 = s.rng;
    run(s, c.delay + 2);
    expect(speed(s.ball)).toBe(0);
    expect(s.rng).toBe(rng0);
    const t = game([{ id: 'a', team: 'red', hero: 'ironman' }]);
    place(t, 'a', -300, 0);
    ball(t, -300 + R + c.range + BALL.radius + 5, 0);
    cast(t, 'a', 'e');
    expect(t.zones).toHaveLength(0);
    expect(pl(t, 'a').cdE).toBe(0);
  });

  it('E: mismo estado, misma dirección; el sorteo se hace una vez', () => {
    const angle = (seed: number) => {
      const s = game([{ id: 'a', team: 'red', hero: 'ironman' }], 'heroes', { seed });
      place(s, 'a', -300, 0);
      ball(s, -150, 0);
      cast(s, 'a', 'e', POWERS.ironman.missile.delay + 5);
      return s.zones.find((q) => q.kind === 'missile')!.ang;
    };
    expect(angle(77)).toBe(angle(77));
    const set = new Set([1, 2, 3, 4, 5, 6].map(angle));
    expect(set.size).toBeGreaterThan(3);
  });

  it('dos clientes en red ven la misma dirección sorteada que el servidor', () => {
    const sim = netSim({ lagTicks: { a: 3, b: 7 }, teams: { a: 'red', b: 'blue' }, mode: 'heroes' });
    const g = sim.room.game!;
    g.players.find((p) => p.id === 'a')!.hero = 'ironman';
    g.phase = 'playing';
    place(g, 'a', -300, 0);
    place(g, 'b', 300, 100);
    ball(g, -150, 0);
    sim.advance(200);
    const seen: Record<string, number> = {};
    let server: number | null = null;
    sim.client('a').bits = IN.E;
    sim.advance(50);
    sim.client('a').bits = 0;
    sim.advance(1500, (c) => {
      const z = g.zones.find((q) => q.kind === 'missile');
      if (z && z.ang !== null) server = z.ang;
      for (const st of [c.view, c.session.debugLayers().pred]) {
        const cz = st?.zones.find((q) => q.kind === 'missile');
        if (cz && cz.ang !== null) seen[c.id] = cz.ang;
      }
    });
    expect(server).not.toBeNull();
    expect(seen.a).toBe(server);
    expect(seen.b).toBe(server);
  });
});

describe('Flash', () => {
  /** Rapidez máxima corriendo a la derecha durante n ticks tras activar. */
  function topSpeed(mode: Mode, slot: 'q' | 'e' | 'qe' | null, n = 100) {
    const s = game([{ id: 'a', team: 'red', hero: 'flash' }], mode);
    const a = place(s, 'a', -380, -150);
    if (slot === 'q' || slot === 'qe') tick(s, { a: IN.Q | IN.RIGHT });
    if (slot === 'e' || slot === 'qe') tick(s, { a: IN.E | IN.RIGHT });
    let m = 0;
    for (let i = 0; i < n; i++) {
      tick(s, { a: IN.RIGHT });
      m = Math.max(m, speed(a.d));
    }
    return m;
  }

  it.each(MODES)('%s: Q y E suben la velocidad máxima; juntas no se multiplican', (mode) => {
    const c = cfgOf(mode).flash;
    const base = LIMITS.playerInputSpeed;
    expect(topSpeed(mode, null)).toBeLessThanOrEqual(base + 1e-9);
    const q = topSpeed(mode, 'q');
    // la velocidad leída al final del tick ya pasó por el rozamiento
    expect(q).toBeGreaterThan(base * c.sprint.speedMult * PLAYER.damping - 1e-6);
    expect(q).toBeLessThanOrEqual(base * c.sprint.speedMult + 1e-9);
    const e = topSpeed(mode, 'e', 85);
    expect(e).toBeGreaterThan(base * c.trail.speedMult * PLAYER.damping - 1e-6);
    expect(e).toBeLessThanOrEqual(base * c.trail.speedMult + 1e-9);
    expect(topSpeed(mode, 'qe')).toBeLessThanOrEqual(base * Math.max(c.sprint.speedMult, c.trail.speedMult) + 1e-9);
    expect(c.sprint.ticks).toBe((mode === 'super' ? 3 : 2) * 60);
  });

  it('la carrera no atraviesa a un rival', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'flash' }, { id: 'b', team: 'blue', hero: 'hulk' }], 'super');
    const a = place(s, 'a', -380, -150);
    const b = place(s, 'b', -200, -150);
    tick(s, { a: IN.Q | IN.RIGHT });
    for (let i = 0; i < 120; i++) {
      tick(s, { a: IN.RIGHT, b: 0 });
      expect(a.d.x).toBeLessThan(b.d.x);
      expect(edge(a.d, b.d)).toBeGreaterThan(-2);
    }
  });

  it.each(MODES)('%s E: la estela frena de verdad (aceleración y tope), suave, y dura el «linger» al salir', (mode) => {
    const c = cfgOf(mode).flash.trail;
    const s = game([{ id: 'a', team: 'red', hero: 'flash' }, { id: 'b', team: 'blue', hero: 'hulk' }], mode);
    place(s, 'a', -300, 0, 0, 1);
    const b = place(s, 'b', -300 + 2.5 * R, 60);
    // Flash corre hacia abajo; la estela queda entre ambos, el rival la cruza hacia la izquierda
    tick(s, { a: IN.E | IN.DOWN });
    for (let i = 0; i < 30; i++) tick(s, { a: IN.DOWN, b: 0 });
    place(s, 'a', 300, 150);
    b.d.vx = -LIMITS.playerInputSpeed;
    let last = speed(b.d);
    let slowed = false;
    let felt = false;
    for (let i = 0; i < 30; i++) {
      tick(s, { a: 0, b: IN.LEFT });
      // nunca un salto brusco de velocidad
      expect(Math.abs(speed(b.d) - last)).toBeLessThan(0.5);
      last = speed(b.d);
      if (b.capSlowTicks > 0) {
        slowed = true;
        expect(b.capSlow).toBeCloseTo(c.slowPct, 9);
      }
      // la aceleración del tick siguiente ya usa la ralentización
      if (Math.abs(b.slowNow - c.slowPct) < 1e-9) felt = true;
    }
    expect(slowed).toBe(true);
    expect(felt).toBe(true);
    // lejos de la estela: termina a lo sumo `lingerTicks` después
    place(s, 'b', 200, -150);
    run(s, c.lingerTicks + 1);
    expect(b.capSlowTicks).toBe(0);
    // y su velocidad máxima en estela queda por debajo de la normal
    const t = game([{ id: 'a', team: 'red', hero: 'flash' }, { id: 'b', team: 'blue', hero: 'hulk' }], mode);
    const r = place(t, 'b', 0, 0);
    r.capSlow = c.slowPct;
    r.capSlowTicks = 1000;
    let top = 0;
    for (let i = 0; i < 200; i++) {
      tick(t, { b: IN.RIGHT });
      top = Math.max(top, speed(r.d));
    }
    expect(top).toBeLessThanOrEqual(LIMITS.playerInputSpeed * (1 - c.slowPct) + 1e-9);
  });
});

describe('Thor', () => {
  it.each(MODES)('%s Q: impulso exacto, electrifica y aturde una vez por jugador (también a Thor)', (mode) => {
    const c = cfgOf(mode).thor.hammer;
    const s = game([{ id: 'a', team: 'red', hero: 'thor' }, { id: 'b', team: 'blue', hero: 'hulk' }], mode);
    place(s, 'a', -300, 0);
    place(s, 'b', 300, 150);
    ball(s, -200, 0);
    cast(s, 'a', 'q');
    expect(peakBall(s, 15)).toBeCloseTo(c.ballImpulse, 6);
    expect(s.ballElec).toBeGreaterThan(0);
    // el rival queda pegado a la pelota durante toda la electricidad: un solo stun
    const b = pl(s, 'b');
    let stuns = 0;
    for (let i = 0; i < c.elecTicks; i++) {
      s.ball.vx = 0; s.ball.vy = 0;
      place(s, 'b', s.ball.x, s.ball.y + BALL.radius + R);
      stuns += run(s, 1).filter((e) => e.type === 'stun' && e.id === 'b').length;
    }
    // aunque stun + inmunidad terminen antes que la electricidad, la aplicación recuerda a quién ya aturdió
    expect(stuns).toBe(1);
    expect(b.stun).toBe(0);
    // Thor también se aturde al tocarla
    const t = game([{ id: 'a', team: 'red', hero: 'thor' }], mode);
    place(t, 'a', -300, 0);
    ball(t, -200, 0);
    cast(t, 'a', 'q', 10);
    ball(t, -200, 0);
    place(t, 'a', -200 - BALL.radius - R, 0);
    const ev = run(t, 2);
    expect(ev.some((e) => e.type === 'stun' && e.id === 'a' && e.ticks === c.stunTicks)).toBe(true);
  });

  it('Q: empuja al primer rival y desaparece', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'thor' }, { id: 'b', team: 'blue', hero: 'hulk' }, { id: 'c', team: 'blue', hero: 'hulk' }]);
    place(s, 'a', -300, 0);
    const b = place(s, 'b', -220, 0);
    const c = place(s, 'c', -120, 0);
    cast(s, 'a', 'q', 20);
    expect(b.d.vx).toBeGreaterThan(0);
    expect(c.d.vx).toBe(0);
    expect(s.projectiles).toHaveLength(0);
  });

  it.each(MODES)('%s E: zona fija sobre el rival del cono; aturde tras el aviso; se puede esquivar', (mode) => {
    const c = cfgOf(mode).thor.bolt;
    const s = game([{ id: 'a', team: 'red', hero: 'thor' }, { id: 'b', team: 'blue', hero: 'hulk' }], mode);
    place(s, 'a', -300, 0);
    const b = place(s, 'b', -300 + c.range - R, 30);
    cast(s, 'a', 'e');
    const z = s.zones.find((q) => q.kind === 'bolt')!;
    expect([z.x, z.y, z.r]).toEqual([b.d.x, b.d.y, c.radius]);
    const ev = run(s, c.delay);
    const st = ev.find((e) => e.type === 'stun') as Extract<GameEvent, { type: 'stun' }>;
    expect(st).toMatchObject({ id: 'b', ticks: c.stunTicks });
    // esquivar: sale de la zona antes de que caiga
    const t = game([{ id: 'a', team: 'red', hero: 'thor' }, { id: 'b', team: 'blue', hero: 'hulk' }], mode);
    place(t, 'a', -300, 0);
    place(t, 'b', -200, 0);
    cast(t, 'a', 'e');
    place(t, 'b', -200, c.radius + R + 5);
    expect(run(t, c.delay + 2).some((e) => e.type === 'stun')).toBe(false);
  });

  it('E: sin rival en el cono no gasta recarga (aviso discreto)', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'thor' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
    place(s, 'a', -200, 0);
    place(s, 'b', -300, 0); // detrás
    const ev = cast(s, 'a', 'e');
    expect(ev.some((e) => e.type === 'fizzle')).toBe(true);
    expect(pl(s, 'a').cdE).toBe(0);
    // al costado, fuera del cono de 60°
    const t = game([{ id: 'a', team: 'red', hero: 'thor' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
    place(t, 'a', -200, 0);
    place(t, 'b', -100, 80);
    cast(t, 'a', 'e');
    expect(pl(t, 'a').cdE).toBe(0);
  });
});

describe('aturdimiento', () => {
  it('bloquea moverse, patear y poderes; choques y empujes siguen; tecla mantenida no dispara al terminar; inmunidad', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'superman' }, { id: 'h', team: 'blue', hero: 'hulk' }]);
    const a = place(s, 'a', 0, 0);
    place(s, 'h', 200, 150);
    ball(s, BALL.radius + R + 2, 0);
    a.stun = 30;
    for (let i = 0; i < 10; i++) {
      const ev = tick(s, { a: IN.RIGHT | IN.KICK | IN.Q, h: 0 });
      expect(ev.some((e) => e.type === 'power' || e.type === 'kick')).toBe(false);
    }
    expect(speed(a.d)).toBe(0);
    expect(speed(s.ball)).toBe(0);
    // un empuje externo sí lo mueve
    a.d.vx = 2;
    tick(s, { a: IN.Q });
    expect(a.d.vx).toBeGreaterThan(0);
    // termina con Q mantenida: no se dispara sola
    let fired = 0;
    for (let i = 0; i < 40; i++) fired += powers(tick(s, { a: IN.Q, h: 0 }));
    expect(a.stun).toBe(0);
    expect(fired).toBe(0);
    // al soltar y volver a apretar, sí
    tick(s, { a: 0 });
    expect(powers(tick(s, { a: IN.Q }))).toBe(1);
  });

  it('no se apilan y respetan la inmunidad posterior', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'thor' }, { id: 'b', team: 'blue', hero: 'hulk' }], 'heroes', { noCooldowns: true });
    place(s, 'a', -300, 0);
    const b = place(s, 'b', -200, 0);
    const c = POWERS.thor.bolt;
    cast(s, 'a', 'e', c.delay + 1);
    expect(b.stun).toBeGreaterThan(0);
    const len = b.stun;
    // otro rayo mientras está aturdido: no suma
    tick(s, { a: IN.E });
    run(s, c.delay + 2);
    expect(b.stun).toBeLessThan(len);
    run(s, b.stun);
    expect(b.stunImmune).toBeGreaterThan(STUN.immuneTicks - 5);
    place(s, 'b', -200, 0);
    tick(s, { a: 0 });
    tick(s, { a: IN.E });
    run(s, c.delay + 1);
    expect(b.stun).toBe(0);
  });
});

describe('Doctor Strange Q: rebobinar', () => {
  it.each(MODES)('%s: vuelve a posición y velocidad de hace el tiempo pedido (discontinuidad marcada)', (mode) => {
    const c = cfgOf(mode).strange.rewind;
    const s = game([{ id: 'a', team: 'red', hero: 'strange' }], mode);
    place(s, 'a', -50, -150);
    ball(s, -150, 0, 2, 0.5);
    const hist: { x: number; y: number; vx: number; vy: number }[] = [];
    for (let i = 0; i < c.ticks + 20; i++) {
      run(s, 1);
      hist.push({ x: s.ball.x, y: s.ball.y, vx: s.ball.vx, vy: s.ball.vy });
    }
    const warp = s.ballWarp;
    const ev = cast(s, 'a', 'q');
    // el cast corre un tick más después de rebobinar: comparamos con el evento
    const rw = ev.find((e) => e.type === 'rewind') as Extract<GameEvent, { type: 'rewind' }>;
    const want = hist[hist.length - c.ticks];
    expect(rw.x1).toBeCloseTo(want.x, 9);
    expect(rw.y1).toBeCloseTo(want.y, 9);
    expect(s.ballWarp).toBe(warp + 1);
    expect(pl(s, 'a').cdQ).toBe(c.cooldown - 1);
  });

  it('al inicio (sin historial) se rechaza sin recarga; con poco historial usa lo más viejo', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'strange' }]);
    place(s, 'a', -50, 0);
    ball(s, -100, 100, 1, 0);
    const ev = cast(s, 'a', 'q');
    expect(ev.some((e) => e.type === 'fizzle')).toBe(true);
    expect(pl(s, 'a').cdQ).toBe(0);
    run(s, 10);
    const oldest = { x: s.ballHist[0], y: s.ballHist[1] };
    const ev2 = cast(s, 'a', 'q');
    const rw = ev2.find((e) => e.type === 'rewind') as Extract<GameEvent, { type: 'rewind' }>;
    expect(rw.x1).toBeCloseTo(oldest.x, 9);
    expect(rw.y1).toBeCloseTo(oldest.y, 9);
  });

  it('después de un gol no vuelve a la jugada anterior (sin duplicar goles)', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'strange' }]);
    place(s, 'a', 200, -150);
    ball(s, STADIUM.fieldW - 40, 0, 6, 0);
    let goals = 0;
    for (let i = 0; i < 20 && goals === 0; i++) goals += run(s, 1).filter((e) => e.type === 'goal').length;
    expect(goals).toBe(1);
    expect(s.ballHist).toHaveLength(0);
    // durante la pausa de gol no hay poderes
    expect(powers(tick(s, { a: IN.Q }))).toBe(0);
    // ya en el saque siguiente: la jugada nueva no tiene la anterior
    for (let i = 0; i < 400 && s.phase !== 'kickoff'; i++) run(s, 1);
    expect(s.phase).toBe('kickoff');
    expect(s.ballHist.length / 4).toBeLessThanOrEqual(2);
    expect(Math.abs(s.ballHist[0] ?? 0)).toBeLessThan(1);
  });

  it('cerca de un arco nunca la deja dentro; lugar ocupado → lugar legal libre; protegida → rechazo', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'strange' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
    place(s, 'a', 250, -100);
    place(s, 'b', 0, 160);
    ball(s, 200, 0);
    // historial artificial: dentro del arco
    s.ballHist = [STADIUM.fieldW + 15, 0, 0, 0];
    cast(s, 'a', 'q');
    expect(Math.abs(s.ball.x)).toBeLessThanOrEqual(STADIUM.fieldW);
    // ocupado por un jugador
    const t = game([{ id: 'a', team: 'red', hero: 'strange' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
    place(t, 'a', 0, -150);
    const b = place(t, 'b', -100, 0);
    ball(t, 0, 0);
    t.ballHist = [-100, 0, 0, 0];
    const ev = cast(t, 'a', 'q');
    expect(ev.some((e) => e.type === 'rewind')).toBe(true);
    expect(edge(t.ball, b.d)).toBeGreaterThanOrEqual(-0.5);
    // protegida
    const u = game([{ id: 'a', team: 'red', hero: 'strange' }]);
    place(u, 'a', 0, -150);
    ball(u, 0, 0);
    u.ballHist = [-100, 0, 0, 0];
    u.ballShield = 60;
    const ev2 = cast(u, 'a', 'q');
    expect(ev2.some((e) => e.type === 'rewind')).toBe(false);
    expect(pl(u, 'a').cdQ).toBe(0);
  });
});

describe('Doctor Strange E: portal', () => {
  const dest = (half: -1 | 1, mode: Mode = 'heroes') => half * (STADIUM.fieldW - cfgOf(mode).strange.portal.goalOffset);

  it.each(MODES)('%s: al arco de su mitad, tras la canalización; sin llevarse la pelota', (mode) => {
    const c = cfgOf(mode).strange.portal;
    for (const x of [-120, 120]) {
      const s = game([{ id: 'a', team: 'red', hero: 'strange' }], mode);
      const a = place(s, 'a', x, 50);
      run(s, 1);
      ball(s, x + R + BALL.radius + 1, 50);
      const w = a.warp;
      cast(s, 'a', 'e', c.channel - 1);
      expect(a.d.x).toBeCloseTo(x, 0);
      const ev = run(s, 2);
      expect(ev.some((e) => e.type === 'blink')).toBe(true);
      expect(a.d.x).toBeCloseTo(dest(x < 0 ? -1 : 1, mode), 0);
      expect(Math.abs(a.d.y)).toBeLessThan(1);
      expect(a.warp).toBe(w + 1);
      expect(Math.abs(s.ball.x - x)).toBeLessThan(40);
      expect(pl(s, 'a').cdE).toBe(c.cooldown - c.channel - 1);
      if (mode === 'super') expect(a.evadeResist).toBeCloseTo(0.4, 9);
    }
  });

  it('en la línea central usa la última mitad (al inicio, la de su saque)', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'strange' }]);
    const a = pl(s, 'a');
    expect(a.half).toBe(-1); // rojo saca en x<0
    place(s, 'a', 0, 120);
    cast(s, 'a', 'e', POWERS.strange.portal.channel + 2);
    expect(a.d.x).toBeCloseTo(dest(-1), 0);
    const t = game([{ id: 'a', team: 'red', hero: 'strange' }]);
    place(t, 'a', 50, 120);
    run(t, 1);
    place(t, 'a', 0, 120);
    cast(t, 'a', 'e', POWERS.strange.portal.channel + 2);
    expect(pl(t, 'a').d.x).toBeCloseTo(dest(1), 0);
  });

  it('destino ocupado: lugar legal libre; sin lugar: se cancela sin recarga', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'strange' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
    place(s, 'a', -100, 0);
    const b = place(s, 'b', dest(-1), 0);
    cast(s, 'a', 'e', POWERS.strange.portal.channel + 2);
    const a = pl(s, 'a');
    expect(Math.abs(a.d.x - dest(-1))).toBeLessThan(80);
    expect(edge(a.d, b.d)).toBeGreaterThanOrEqual(-0.5);
    // rodeado: una grilla de jugadores tapa todo lugar posible
    const grid: P[] = [{ id: 'a', team: 'red', hero: 'strange' }];
    const spots: [number, number][] = [];
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 6; col++) {
        spots.push([-405 + col * 38 + (row % 2) * 19, -140 + row * 33]);
      }
    }
    spots.forEach((_, i) => grid.push({ id: `g${i}`, team: 'blue', hero: 'hulk' }));
    const t = game(grid);
    spots.forEach(([x, y], i) => place(t, `g${i}`, x, y));
    place(t, 'a', -100, 0);
    const ev = cast(t, 'a', 'e');
    expect(ev.some((e) => e.type === 'fizzle')).toBe(true);
    expect(pl(t, 'a').cdE).toBe(0);
  });

  it('un stun interrumpe la canalización; no se usa en el saque', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'strange' }]);
    const a = place(s, 'a', -100, 0);
    cast(s, 'a', 'e', 3);
    a.stun = 0;
    // aturdido por un rayo/electricidad
    const z = s.zones.length;
    expect(z).toBe(1);
    a.stunImmune = 0;
    // aplicar stun como lo hace la simulación
    s.ballElec = 10; s.ballElecStun = 20; s.ballElecHit = [];
    ball(s, a.d.x + R + BALL.radius, a.d.y);
    run(s, 1);
    expect(a.stun).toBeGreaterThan(0);
    expect(s.zones.filter((q) => q.kind === 'portal')).toHaveLength(0);
    run(s, 40);
    expect(a.d.x).toBeGreaterThan(-200);
    const k = createGame({ mode: 'heroes', timeLimitMin: 3, scoreLimit: 3, players: [{ id: 'a', team: 'red', hero: 'strange' }] });
    expect(k.phase).toBe('kickoff');
    expect(powers(tick(k, { a: IN.E }))).toBe(0);
  });
});

describe('Sin cooldowns', () => {
  it('pulsaciones rápidas: sin espera, pero no se reactiva mientras dura su propio efecto; mantener no repite', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'superman' }], 'heroes', { noCooldowns: true });
    const a = place(s, 'a', -300, -150);
    const ss = POWERS.superman.superSpeed.ticks;
    let n = 0;
    for (let i = 0; i < ss + 10; i++) n += powers(tick(s, { a: i % 2 ? 0 : IN.E }), 'e');
    expect(n).toBe(2);
    expect(a.cdE).toBe(0);
    // mantener apretado: una sola activación
    const t = game([{ id: 'a', team: 'red', hero: 'flash' }], 'super', { noCooldowns: true });
    let m = 0;
    for (let i = 0; i < 600; i++) m += powers(tick(t, { a: IN.Q }), 'q');
    expect(m).toBe(1);
    // duraciones intactas
    const u = game([{ id: 'a', team: 'red', hero: 'flash' }], 'heroes', { noCooldowns: true });
    cast(u, 'a', 'q');
    expect(pl(u, 'a').sprint).toBe(POWERS.flash.sprint.ticks - 1);
    expect(powerActive(u, pl(u, 'a'), 'q')).toBe(true);
  });

  it('en Clásico no aplica; topes técnicos de proyectiles con spam', () => {
    const c = createGame({ mode: 'classic', timeLimitMin: 3, scoreLimit: 3, players: [{ id: 'a', team: 'red', hero: 'hulk' }], noCooldowns: true });
    expect(c.noCd).toBe(false);
    const players: P[] = [];
    for (let i = 0; i < 24; i++) players.push({ id: `p${i}`, team: i % 2 ? 'blue' : 'red', hero: 'batman' });
    const s = game(players, 'super', { noCooldowns: true });
    players.forEach((p, i) => place(s, p.id, -350 + (i % 8) * 90, -150 + Math.floor(i / 8) * 150));
    let max = 0;
    for (let i = 0; i < 120; i++) {
      tick(s, Object.fromEntries(players.map((p) => [p.id, i % 2 ? 0 : IN.Q])));
      max = Math.max(max, s.projectiles.length);
    }
    expect(max).toBeLessThanOrEqual(POWER_LIMITS.maxProjectiles);
    expect(max).toBeGreaterThan(30);
  });

  it('nunca entrega recompensas: evaluateMatch las rechaza', () => {
    const v = evaluateMatch({
      mode: 'heroes', finished: true, matchTicks: 60 * 180, winner: 'red', kicks: { red: 30, blue: 30 }, noCooldowns: true,
      participants: [
        { userId: 'u1', team: 'red', present: true, activeTicks: 60 * 180 },
        { userId: 'u2', team: 'blue', present: true, activeTicks: 60 * 180 },
      ],
    } as Parameters<typeof evaluateMatch>[0], () => 0);
    expect(v.every((x) => !x.eligible && /sin cooldowns/i.test(x.reason ?? ''))).toBe(true);
  });

  it('sala: no puede ser oficial; durante el partido se cambia, se avisa a todos y se aplica al reiniciar; espectadores no juegan', () => {
    const msgs: Record<string, any[]> = { a: [], b: [], s: [] };
    const fake = (id: string): Client => ({ id, nick: id, room: null, ping: 0, send(m) { msgs[id].push(typeof m === 'string' ? JSON.parse(m) : m); } });
    const lobby = new Lobby();
    const r = lobby.create('Sala', { mode: 'heroes' });
    r.join(fake('a')); r.join(fake('b')); r.join(fake('s'));
    r.setSide('a', 'red'); r.setSide('b', 'blue'); r.setSide('s', 'spec');
    expect(r.setSettings('a', { cooldowns: 'none', official: true })).toMatch(/casual|oficial/i);
    expect(r.start('a')).toBeNull();
    expect(r.game!.noCd).toBe(false);
    expect(r.setSettings('a', { mode: 'super' })).toMatch(/Deten/);
    expect(r.setSettings('b', { cooldowns: 'none' })).toMatch(/anfitrión/);
    expect(r.setSettings('a', { cooldowns: 'none' })).toBeNull();
    expect(r.game!.noCd).toBe(false);
    for (const id of ['a', 'b', 's']) expect(msgs[id].some((m) => m.t === 'chat' && /Sin cooldowns/.test(m.text))).toBe(true);
    expect(r.summary().cooldowns).toBe('none');
    r.restart('a');
    expect(r.game!.noCd).toBe(true);
    // el espectador no está en la simulación y sus entradas se ignoran
    r.game!.phase = 'playing';
    r.pushInput('s', 1, IN.Q);
    r.tick();
    expect(r.game!.players.some((p) => p.id === 's')).toBe(false);
  });
});

describe('limpieza', () => {
  it('un gol limpia proyectiles, zonas, stuns, electricidad, protección, portales e historial', () => {
    const s = game([
      { id: 'a', team: 'red', hero: 'strange' }, { id: 'b', team: 'blue', hero: 'thor' },
      { id: 'c', team: 'red', hero: 'hawkeye' }, { id: 'd', team: 'blue', hero: 'cap' },
    ]);
    place(s, 'a', -100, 0);
    place(s, 'b', 100, 100, -1, 0);
    place(s, 'c', -200, -150);
    place(s, 'd', 300, 0);
    ball(s, 300, 60);
    run(s, 10);
    tick(s, { a: IN.E, c: IN.Q, d: IN.E });
    pl(s, 'c').stun = 50;
    s.ballElec = 40;
    expect(s.zones.length).toBeGreaterThan(0);
    expect(s.projectiles.length).toBeGreaterThan(0);
    expect(s.ballShield).toBeGreaterThan(0);
    s.ballShield = 0;
    ball(s, STADIUM.fieldW - 2, 0, 6, 0);
    let goal = false;
    for (let i = 0; i < 4 && !goal; i++) goal = run(s, 1).some((e) => e.type === 'goal');
    expect(goal).toBe(true);
    expect(s.zones).toHaveLength(0);
    expect(s.projectiles).toHaveLength(0);
    expect(s.ballElec + s.ballShield).toBe(0);
    expect(s.ballHist).toHaveLength(0);
    expect(s.players.every((p) => p.stun === 0 && p.stunImmune === 0)).toBe(true);
  });

  it('al irse un jugador se quitan sus efectos (proyectiles, zonas, protección)', () => {
    const s = game([{ id: 'c', team: 'blue', hero: 'cap' }, { id: 'i', team: 'red', hero: 'ironman' }]);
    place(s, 'c', 0, -100);
    place(s, 'i', -200, 0);
    ball(s, -100, 0);
    tick(s, { c: IN.E, i: IN.E });
    tick(s, { c: 0, i: IN.Q });
    removePlayer(s, 'c');
    removePlayer(s, 'i');
    expect(s.ballShield).toBe(0);
    expect(s.zones).toHaveLength(0);
    expect(s.projectiles).toHaveLength(0);
  });
});

describe('valores pedidos (unidades R, K y segundos)', () => {
  // segundos con 2 decimales (los ticks se redondean a 1/60 s)
  const sec = (t: number) => Math.round((t / 60) * 100) / 100;
  it('Héroes', () => {
    const P = POWERS;
    expect([P.superman.laser.range / R, sec(P.superman.laser.windup), sec(P.superman.laser.beamTicks), P.superman.laser.ballImpulse / K, sec(P.superman.laser.cooldown)]).toEqual([12, 0.15, 0.25, 1.3, 8]);
    expect([P.hawkeye.arrow.range / R, P.hawkeye.arrow.blastRadius / R, P.hawkeye.arrow.ballImpulse / K, sec(P.hawkeye.arrow.cooldown)]).toEqual([12, 3, 1.2, 8]);
    expect([sec(P.widow.dash.ticks), P.widow.dash.speedMult, sec(P.widow.dash.cooldown)]).toEqual([0.22, 2.2, 6]);
    expect([P.cap.shield.radius / R, P.cap.shield.maxHits, P.cap.shield.search / R, sec(P.cap.shield.maxTicks), P.cap.shield.ballImpulse / K, sec(P.cap.shield.cooldown)]).toEqual([0.65, 3, 5, 1.5, 0.9, 9]);
    expect([sec(P.cap.protect.ticks), P.cap.protect.range / R, sec(P.cap.protect.cooldown)]).toEqual([2, 10, 12]);
    expect([P.ironman.repulsor.range / R, P.ironman.repulsor.radius / R, sec(P.ironman.repulsor.windup), P.ironman.repulsor.ballImpulse / K, sec(P.ironman.repulsor.cooldown)]).toEqual([12, 0.4, 0.12, 1.3, 7]);
    expect([P.ironman.missile.range / R, sec(P.ironman.missile.delay), P.ironman.missile.radius / R, P.ironman.missile.ballImpulse / K, sec(P.ironman.missile.cooldown)]).toEqual([14, 0.65, 2.5, 1.25, 11]);
    expect([sec(P.flash.sprint.ticks), P.flash.sprint.accelMult, P.flash.sprint.speedMult, sec(P.flash.sprint.cooldown)]).toEqual([2, 2, 1.9, 10]);
    expect([sec(P.flash.trail.ticks), P.flash.trail.accelMult, P.flash.trail.speedMult, sec(P.flash.trail.segTicks), P.flash.trail.slowPct, sec(P.flash.trail.lingerTicks), sec(P.flash.trail.cooldown)]).toEqual([1.5, 1.5, 1.45, 1.2, 0.3, 0.25, 11]);
    expect([P.thor.hammer.radius / R, P.thor.hammer.range / R, P.thor.hammer.ballImpulse / K, sec(P.thor.hammer.elecTicks), sec(P.thor.hammer.stunTicks), sec(P.thor.hammer.cooldown)]).toEqual([0.7, 10, 1.4, 1.5, 0.35, 10]);
    expect([P.thor.bolt.cone * 2, P.thor.bolt.range / R, sec(P.thor.bolt.delay), P.thor.bolt.radius / R, sec(P.thor.bolt.stunTicks), sec(P.thor.bolt.cooldown)]).toEqual([60, 10, 0.4, 1.95, 0.55, 12]);
    expect([P.strange.rewind.range / R, sec(P.strange.rewind.ticks), sec(P.strange.rewind.cooldown)]).toEqual([12, 1.5, 12]);
    expect([sec(P.strange.portal.channel), P.strange.portal.goalOffset / R, sec(P.strange.portal.cooldown)]).toEqual([0.35, 3, 14]);
  });

  it('Súper', () => {
    const P = SUPER_POWERS;
    expect([P.superman.laser.range / R, P.superman.laser.ballImpulse / K, P.superman.laser.pierce, sec(P.superman.laser.cooldown)]).toEqual([18, 1.8, true, 6]);
    expect(P.superman.laser.halfWidth).toBeGreaterThan(POWERS.superman.laser.halfWidth);
    expect([P.hawkeye.arrow.range / R, P.hawkeye.arrow.blastRadius / R, P.hawkeye.arrow.ballImpulse / K, sec(P.hawkeye.arrow.cooldown)]).toEqual([16, 4.5, 1.7, 6]);
    expect(P.hawkeye.arrow.playerImpulse).toBeGreaterThan(POWERS.hawkeye.arrow.playerImpulse);
    expect([sec(P.widow.dash.ticks), P.widow.dash.speedMult, P.widow.dash.resist, sec(P.widow.dash.cooldown)]).toEqual([0.32, 2.8, 0.4, 4]);
    expect([P.cap.shield.radius / R, P.cap.shield.maxHits, P.cap.shield.search / R, P.cap.shield.ballImpulse / K, sec(P.cap.shield.maxTicks), sec(P.cap.shield.cooldown)]).toEqual([0.9, 5, 7, 1.2, 2, 7]);
    expect([sec(P.cap.protect.ticks), P.cap.protect.range / R, sec(P.cap.protect.cooldown)]).toEqual([3, 14, 10]);
    expect([P.ironman.repulsor.range / R, P.ironman.repulsor.radius / R, P.ironman.repulsor.ballImpulse / K, sec(P.ironman.repulsor.cooldown)]).toEqual([16, 0.6, 1.8, 5]);
    expect([P.ironman.missile.range / R, sec(P.ironman.missile.delay), P.ironman.missile.radius / R, P.ironman.missile.ballImpulse / K, sec(P.ironman.missile.cooldown)]).toEqual([20, 0.45, 4, 1.8, 8]);
    expect([sec(P.flash.sprint.ticks), P.flash.sprint.accelMult, P.flash.sprint.speedMult, sec(P.flash.sprint.cooldown)]).toEqual([3, 2.8, 2.5, 8]);
    expect([sec(P.flash.trail.ticks), P.flash.trail.accelMult, P.flash.trail.speedMult, sec(P.flash.trail.segTicks), P.flash.trail.slowPct, sec(P.flash.trail.cooldown)]).toEqual([2, 1.9, 1.75, 1.6, 0.4, 9]);
    expect([P.thor.hammer.radius / R, P.thor.hammer.range / R, P.thor.hammer.ballImpulse / K, sec(P.thor.hammer.elecTicks), sec(P.thor.hammer.stunTicks), sec(P.thor.hammer.cooldown)]).toEqual([0.95, 14, 1.9, 1.5, 0.55, 8]);
    expect([P.thor.bolt.range / R, P.thor.bolt.radius / R, sec(P.thor.bolt.delay), sec(P.thor.bolt.stunTicks), sec(P.thor.bolt.cooldown)]).toEqual([14, 3, 0.35, 0.75, 10]);
    expect([P.strange.rewind.range / R, sec(P.strange.rewind.ticks), sec(P.strange.rewind.cooldown)]).toEqual([18, 2.5, 10]);
    expect([sec(P.strange.portal.channel), sec(P.strange.portal.resistTicks), P.strange.portal.resist, sec(P.strange.portal.cooldown)]).toEqual([0.2, 0.75, 0.4, 10]);
  });
});

// los jugadores no superan el tope duro ni con todo combinado
it('ningún poder deja a un jugador por encima del tope duro de velocidad', () => {
  const s = game([{ id: 'a', team: 'red', hero: 'flash' }], 'super');
  const a = place(s, 'a', -380, 0);
  tick(s, { a: IN.Q | IN.RIGHT });
  for (let i = 0; i < 100; i++) {
    tick(s, { a: IN.RIGHT });
    expect(speed(a.d)).toBeLessThanOrEqual(LIMITS.playerMaxSpeed + 1e-9);
  }
  expect(PLAYER.radius).toBe(R);
});
