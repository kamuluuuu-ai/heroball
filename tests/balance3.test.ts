// Ajustes de balance (Ibai, Homero, Verity, Thor, Baldi) y personajes Bendy, Jeff y Goku.
import { describe, expect, it } from 'vitest';
import { HeroId, INK, K, PLAYER, POWERS, R, STADIUM, SUPER_POWERS, TICK_RATE } from '../shared/config';
import { botInput, makeBrain } from '../shared/bot';
import { createGame, removePlayer, resetKickoff, setInput, step } from '../shared/game';
import { blinkSpot, kameMaxCharge, swallowLocked, tntCount } from '../shared/powers';
import { GameState, IN, Team } from '../shared/types';

type P = { id: string; team: Team; hero: HeroId };
const sec = (t: number) => t / TICK_RATE;

function game(players: P[], mode: 'heroes' | 'super' = 'heroes', live = 10 * TICK_RATE): GameState {
  const s = createGame({ mode, timeLimitMin: 3, scoreLimit: 3, players });
  s.phase = 'playing';
  // ya pasó el saque (Tragar de Jeff se bloquea los primeros 3 s)
  s.liveTicks = live;
  return s;
}

function tick(s: GameState, bits: Record<string, number> = {}) {
  for (const [id, b] of Object.entries(bits)) setInput(s, id, b);
  s.events = [];
  step(s);
  return s.events;
}

function run(s: GameState, n: number, bits: Record<string, number> = {}) {
  const ev: GameState['events'] = [];
  for (let i = 0; i < n; i++) ev.push(...tick(s, bits));
  return ev;
}

function place(s: GameState, id: string, x: number, y: number) {
  const p = pl(s, id);
  p.d.x = x; p.d.y = y; p.d.vx = 0; p.d.vy = 0;
  return p;
}

const pl = (s: GameState, id: string) => s.players.find((o) => o.id === id)!;
const powerEv = (ev: GameState['events'], slot: 'q' | 'e') => ev.some((e) => e.type === 'power' && e.slot === slot);

/** Héroe mirando a la derecha, rival delante a `gap` px de borde a borde y pelota lejos. */
function duel(hero: HeroId, gap = R, mode: 'heroes' | 'super' = 'heroes', foe: HeroId = 'spider') {
  const s = game([{ id: 'a', team: 'red', hero }, { id: 'b', team: 'blue', hero: foe }], mode);
  const a = place(s, 'a', -150, 0);
  a.ax = 1; a.ay = 0;
  place(s, 'b', -150 + 2 * PLAYER.radius + gap, 0);
  s.ball.x = 0; s.ball.y = 170; s.ball.vx = 0; s.ball.vy = 0;
  return s;
}

describe('valores finales', () => {
  it('Héroes y Súper', () => {
    const P = POWERS;
    expect([P.baldi.ruler.range / R, sec(P.baldi.quiz.ticks), sec(P.baldi.quiz.wrongStun), sec(P.baldi.quiz.cooldown)]).toEqual([19.2, 6, 1.5, 35]);
    expect(P.baldi.ruler.range / R).toBeCloseTo(12 * 1.6);
    expect([sec(P.ibai.glove.stunTicks), P.ibai.giant.kickImpulse / K, sec(P.ibai.giant.kickGap)]).toEqual([1, 1.5, 0.6]);
    expect(sec(P.homer.donut.protectTicks)).toBe(2);
    expect([sec(P.verity.tnt.flightTicks + P.verity.tnt.fuse), sec(P.verity.tnt.stunTicks), P.verity.tnt.maxActive, sec(P.verity.tnt.cooldown)]).toEqual([2, 1, 6, 1]);
    expect([sec(SUPER_POWERS.verity.tnt.flightTicks + SUPER_POWERS.verity.tnt.fuse), sec(SUPER_POWERS.verity.tnt.cooldown)]).toEqual([2, 1]);
    expect(P.thor.bolt.radius / R).toBeCloseTo(1.3 * 1.5);
    expect([sec(P.bendy.puddle.ticks), sec(P.bendy.puddle.inkTicks), sec(P.bendy.puddle.cooldown)]).toEqual([4, 1.5, 7]);
    expect([sec(P.bendy.form.ticks), P.bendy.form.speedMult, sec(P.bendy.form.segTicks), sec(P.bendy.form.inkTicks), sec(P.bendy.form.cooldown)]).toEqual([3, 1.6, 2, 1, 12]);
    expect(SUPER_POWERS.bendy.puddle.radius / P.bendy.puddle.radius).toBeCloseTo(1.3);
    expect([sec(SUPER_POWERS.bendy.puddle.ticks), sec(SUPER_POWERS.bendy.form.ticks), SUPER_POWERS.bendy.form.speedMult]).toEqual([5, 4, 1.8]);
    expect([sec(INK.maxRun), sec(INK.immuneTicks)]).toEqual([2.5, 1]);
    expect([sec(P.jeff.water.ticks), P.jeff.water.moveMult, sec(P.jeff.water.cooldown)]).toEqual([2, 0.65, 8]);
    expect([sec(P.jeff.swallow.holdTicks), P.jeff.swallow.carrySlow, sec(P.jeff.swallow.stunTicks), sec(P.jeff.swallow.cooldown), sec(P.jeff.swallow.missCooldown), sec(P.jeff.swallow.kickoffLock)]).toEqual([3, 0.2, 0.5, 24, 2, 3]);
    expect(SUPER_POWERS.jeff.water.halfWidth / P.jeff.water.halfWidth).toBeCloseTo(1.25);
    expect(SUPER_POWERS.jeff.water.ballAccel / P.jeff.water.ballAccel).toBeCloseTo(1.3);
    expect(SUPER_POWERS.jeff.swallow.carrySlow).toBe(0);
    expect(SUPER_POWERS.jeff.swallow.spitImpulse / P.jeff.swallow.spitImpulse).toBeCloseTo(1.3);
    expect([sec(P.goku.kame.maxCharge), P.goku.kame.ballImpulse / K, sec(P.goku.kame.energyTicks), sec(P.goku.kame.energyStun), P.goku.kame.moveMult, sec(P.goku.kame.cooldown)]).toEqual([1.2, 2.2, 1.5, 0.6, 0.5, 9]);
    // media cancha = de un arco al centro
    expect([P.goku.blink.range, P.goku.blink.kickMult, sec(P.goku.blink.kickTicks), sec(P.goku.blink.cooldown)]).toEqual([STADIUM.fieldW, 1.75, 1.2, 12]);
    expect([P.goku.ki.max, sec(P.goku.ki.gap), sec(P.goku.ki.freeTicks), P.goku.ki.chargeMult, P.goku.ki.pushMult]).toEqual([5, 1, 3, 0.5, 1.3]);
    const G = SUPER_POWERS.goku;
    expect([G.speedMult, sec(G.kame.maxCharge), sec(G.kame.cooldown), G.blink.kickMult, sec(G.blink.cooldown), G.ki.max]).toEqual([1.2, 0.7, 7, 2, 9, 3]);
    expect(G.kame.halfWidth / P.goku.kame.halfWidth).toBeCloseTo(1.3);
    expect(G.kame.ballImpulse / P.goku.kame.ballImpulse).toBeCloseTo(1.4);
  });
});

describe('Ibai', () => {
  it('guante: empuja y aturde 1 s al rival alcanzado (una sola vez)', () => {
    const s = duel('ibai', 0.5 * R);
    const ev = tick(s, { a: IN.Q });
    expect(powerEv(ev, 'q')).toBe(true);
    let stunned = 0;
    for (let i = 0; i < 30; i++) {
      tick(s, { a: 0 });
      stunned = Math.max(stunned, pl(s, 'b').stun);
    }
    expect(stunned).toBeGreaterThan(POWERS.ibai.glove.stunTicks - 31);
    expect(pl(s, 'b').d.x).toBeGreaterThan(-150 + 2 * PLAYER.radius + 0.5 * R + 5);
  });

  it('gigante: la patada empuja a los rivales cercanos con 0,6 s entre impactos; al terminar vuelve a su tamaño', () => {
    const s = duel('ibai', 3 * R);
    const a = pl(s, 'a');
    tick(s, { a: IN.E });
    run(s, 40, { a: 0 });
    expect(a.giant).toBeGreaterThan(0);
    expect(a.d.r).toBeGreaterThan(PLAYER.radius * 1.3);
    // rival pegado al gigante
    place(s, 'b', a.d.x + a.d.r + PLAYER.radius + 2, a.d.y);
    let hits = 0;
    const b = pl(s, 'b');
    const x0 = b.d.x;
    for (let i = 0; i < 30; i++) {
      // patear cada 2 ticks (soltar/apretar): sólo el primer impacto cuenta antes de 0,6 s
      const ev = tick(s, { a: i % 2 === 0 ? IN.KICK : 0 });
      hits += ev.filter((e) => e.type === 'hit' && e.target === 'player').length;
      place(s, 'b', a.d.x + a.d.r + PLAYER.radius + 2, a.d.y);
    }
    expect(hits).toBe(1);
    expect(x0).toBeGreaterThan(a.d.x);
    run(s, POWERS.ibai.giant.ticks + 60, { a: 0 });
    expect(a.giant).toBe(0);
    expect(a.d.r).toBe(PLAYER.radius);
  });
});

describe('Homero', () => {
  it('la rosquilla que atrapa la pelota la protege 2 s como máximo; nadie la mueve con poderes', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'homer' }, { id: 'b', team: 'blue', hero: 'superman' }]);
    const a = place(s, 'a', -150, 0);
    a.ax = 1; a.ay = 0;
    place(s, 'b', 100, 0);
    pl(s, 'b').ax = -1; pl(s, 'b').ay = 0;
    s.ball.x = -60; s.ball.y = 0; s.ball.vx = 0; s.ball.vy = 0;
    tick(s, { a: IN.Q });
    let n = 0;
    while (s.ballShield === 0 && n++ < 60) tick(s, { a: 0 });
    expect(s.ballShield).toBeGreaterThan(0);
    expect(s.ballShield).toBeLessThanOrEqual(POWERS.homer.donut.protectTicks);
    // láser rival sobre la pelota protegida: no la mueve
    s.ball.vx = 0; s.ball.vy = 0;
    const bx = s.ball.x;
    run(s, 30, { b: IN.Q, a: 0 });
    expect(Math.abs(s.ball.x - bx)).toBeLessThan(1.5);
    run(s, POWERS.homer.donut.protectTicks, { a: 0, b: 0 });
    expect(s.ballShield).toBe(0);
  });
});

describe('Verity', () => {
  it('TNT: recarga 1 s, explota 2 s después, aturde 1 s y como máximo 6 activas (la rechazada no gasta)', () => {
    const s = duel('verity', 7 * R);
    const a = pl(s, 'a');
    s.noCd = false;
    let launched = 0;
    for (let i = 0; i < 8 * TICK_RATE && launched < 6; i++) {
      const ev = tick(s, { a: a.cdE === 0 && i % 2 === 0 ? IN.E : 0 });
      if (powerEv(ev, 'e')) {
        launched++;
        expect(a.cdE).toBeGreaterThanOrEqual(POWERS.verity.tnt.cooldown - 1);
      }
      // el rival se queda lejos (para no explotar las primeras)
      place(s, 'b', 150, 150);
    }
    expect(launched).toBeGreaterThan(1);
  });

  it('el límite de 6 rechaza sin gastar la recarga', () => {
    const s = duel('verity', 7 * R);
    const a = pl(s, 'a');
    s.noCd = true;
    let launched = 0;
    for (let i = 0; i < 20; i++) {
      const ev = tick(s, { a: i % 2 === 0 ? IN.E : 0 });
      if (powerEv(ev, 'e')) launched++;
    }
    expect(launched).toBe(6);
    expect(tntCount(s, a)).toBe(6);
    s.noCd = false;
    tick(s, { a: 0 });
    tick(s, { a: IN.E });
    expect(a.cdE).toBe(0);
  });

  it('cada explosión aturde 1 s al rival una sola vez, a los 2 s del lanzamiento', () => {
    const s = duel('verity', 5 * R);
    tick(s, { a: IN.E });
    const total = POWERS.verity.tnt.flightTicks + POWERS.verity.tnt.fuse;
    let boomAt = -1;
    let maxStun = 0;
    for (let i = 1; i < total + 30; i++) {
      tick(s, { a: 0, b: 0 });
      const b = pl(s, 'b');
      if (b.stun > 0 && boomAt < 0) boomAt = i;
      maxStun = Math.max(maxStun, b.stun);
    }
    expect(Math.abs(boomAt - total)).toBeLessThanOrEqual(2);
    expect(maxStun).toBeLessThanOrEqual(POWERS.verity.tnt.stunTicks);
    expect(maxStun).toBeGreaterThan(POWERS.verity.tnt.stunTicks - 3);
  });
});

describe('Baldi', () => {
  it('quiz: si se acaba el tiempo cuenta como error (aturde una sola vez)', () => {
    const s = duel('baldi', 3 * R);
    place(s, 'b', -40, 0);
    tick(s, { a: IN.E });
    run(s, POWERS.baldi.quiz.windup + 1, { a: 0 });
    const b = pl(s, 'b');
    expect(b.quiz).not.toBeNull();
    let stuns = 0;
    let prev = 0;
    for (let i = 0; i < POWERS.baldi.quiz.ticks + 4 * TICK_RATE; i++) {
      tick(s, { a: 0, b: 0 });
      if (b.stun > prev) stuns++;
      prev = b.stun;
    }
    expect(b.quiz).toBeNull();
    expect(stuns).toBe(1);
  });
});

describe('Bendy', () => {
  it('mancha: cae sobre el rival, tinta 1,5 s una vez por charco; sólo a rivales', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'bendy' }, { id: 'm', team: 'red', hero: 'spider' }, { id: 'b', team: 'blue', hero: 'spider' }]);
    const a = place(s, 'a', -150, 0);
    a.ax = 1; a.ay = 0;
    place(s, 'b', -40, 0);
    place(s, 'm', -40, 60);
    s.ball.x = 0; s.ball.y = 170;
    expect(powerEv(tick(s, { a: IN.Q }), 'q')).toBe(true);
    let inked = 0;
    let max = 0;
    for (let i = 0; i < POWERS.bendy.puddle.ticks + 20; i++) {
      const ev = tick(s, { a: 0 });
      inked += ev.filter((e) => e.type === 'ink' && e.id === 'b').length;
      max = Math.max(max, pl(s, 'b').ink);
      place(s, 'b', -40, 0);
    }
    expect(inked).toBe(1);
    expect(max).toBeLessThanOrEqual(POWERS.bendy.puddle.inkTicks);
    expect(max).toBeGreaterThan(POWERS.bendy.puddle.inkTicks - 3);
    expect(pl(s, 'm').ink).toBe(0);
    expect(pl(s, 'a').cdQ).toBeGreaterThan(0);
  });

  it('forma de tinta: más rápido, sin patear ni Q, deja rastro que entinta; la secuencia no pasa de 2,5 s y luego hay 1 s de inmunidad', () => {
    const s = duel('bendy', 6 * R);
    const a = pl(s, 'a');
    tick(s, { a: IN.E });
    expect(a.inkForm).toBeGreaterThan(0);
    // no puede usar Q
    tick(s, { a: 0 });
    expect(powerEv(tick(s, { a: IN.Q }), 'q')).toBe(false);
    // el rival va pegado al rastro todo el tiempo
    const b = pl(s, 'b');
    let run_ = 0;
    let longest = 0;
    let immuneSeen = false;
    for (let i = 0; i < POWERS.bendy.form.ticks; i++) {
      tick(s, { a: IN.RIGHT });
      place(s, 'b', a.d.x - 8, a.d.y);
      if (b.ink > 0) run_++;
      else {
        longest = Math.max(longest, run_);
        run_ = 0;
      }
      if (b.inkImmune > 0) immuneSeen = true;
    }
    longest = Math.max(longest, run_);
    expect(longest).toBeLessThanOrEqual(INK.maxRun + 1);
    expect(longest).toBeGreaterThan(TICK_RATE);
    expect(immuneSeen).toBe(true);
    const trail = s.zones.find((z) => z.kind === 'inkTrail');
    expect(trail!.pts.length).toBeLessThanOrEqual(POWERS.bendy.form.maxSegs);
    // al terminar el rastro se limpia solo
    run(s, POWERS.bendy.form.segTicks + 10, { a: 0 });
    expect(s.zones.some((z) => z.kind === 'inkTrail')).toBe(false);
  });

  it('forma de tinta: no patea la pelota', () => {
    const s = duel('bendy', 6 * R);
    const a = pl(s, 'a');
    tick(s, { a: IN.E });
    s.ball.x = a.d.x + a.d.r + s.ball.r + 1; s.ball.y = a.d.y;
    run(s, 4, { a: IN.KICK });
    expect(Math.hypot(s.ball.vx, s.ball.vy)).toBeLessThan(1);
  });
});

describe('Jeff', () => {
  it('tragar: captura al rival pegado, lo lleva hasta 3 s, no patea ni usa Q y lo escupe solo con aturdimiento', () => {
    const s = duel('jeff', 0.3 * R);
    const a = pl(s, 'a');
    const b = pl(s, 'b');
    expect(powerEv(tick(s, { a: IN.E }), 'e')).toBe(true);
    expect(a.holding).toBe('b');
    expect(b.eatenBy).toBe('a');
    expect(a.cdE).toBeGreaterThanOrEqual(POWERS.jeff.swallow.cooldown - 1);
    tick(s, { a: 0 });
    expect(powerEv(tick(s, { a: IN.Q }), 'q')).toBe(false);
    // el tragado no se mueve por su cuenta
    run(s, 20, { a: 0, b: IN.UP });
    expect(b.d.x).toBeCloseTo(a.d.x, 5);
    let out = false;
    for (let i = 0; i < POWERS.jeff.swallow.holdTicks + 5 && !out; i++) out = tick(s, { a: 0, b: 0 }).some((e) => e.type === 'swallow' && e.result === 'out');
    expect(out).toBe(true);
    expect(b.eatenBy).toBeNull();
    expect(a.holding).toBeNull();
    expect(b.stun).toBeGreaterThan(0);
  });

  it('E de nuevo escupe al instante aunque corra la recarga; fallar cuesta 2 s', () => {
    const s = duel('jeff', 0.3 * R);
    const a = pl(s, 'a');
    const b = pl(s, 'b');
    tick(s, { a: IN.E });
    run(s, 10, { a: 0 });
    const ev = tick(s, { a: IN.E });
    expect(ev.some((e) => e.type === 'swallow' && e.result === 'out')).toBe(true);
    expect(b.eatenBy).toBeNull();
    run(s, 10, { a: 0 });
    expect(b.d.x - a.d.x).toBeGreaterThan(a.d.r + b.d.r);
    const miss = duel('jeff', 6 * R);
    tick(miss, { a: IN.E });
    expect(pl(miss, 'a').holding).toBeNull();
    expect(pl(miss, 'a').cdE).toBeGreaterThanOrEqual(POWERS.jeff.swallow.missCooldown - 1);
  });

  it('bloqueado en el saque y los primeros 3 s (también sin recargas)', () => {
    const s = duel('jeff', 0.3 * R);
    s.noCd = true;
    s.liveTicks = 0;
    expect(swallowLocked(s)).toBe(true);
    tick(s, { a: IN.E });
    expect(pl(s, 'a').holding).toBeNull();
    s.phase = 'kickoff';
    expect(swallowLocked(s)).toBe(true);
    s.phase = 'playing';
    s.liveTicks = POWERS.jeff.swallow.kickoffLock;
    expect(swallowLocked(s)).toBe(false);
  });

  it('libera al tragado en gol/reinicio, si Jeff se va o si se va el tragado', () => {
    for (const how of ['kickoff', 'removeJeff', 'removeVictim'] as const) {
      const s = duel('jeff', 0.3 * R);
      tick(s, { a: IN.E });
      expect(pl(s, 'b').eatenBy).toBe('a');
      if (how === 'kickoff') {
        resetKickoff(s, 'red');
        expect(pl(s, 'b').eatenBy).toBeNull();
        expect(pl(s, 'a').holding).toBeNull();
      } else if (how === 'removeJeff') {
        removePlayer(s, 'a');
        const b = pl(s, 'b');
        expect(b.eatenBy).toBeNull();
        expect(Math.abs(b.d.x)).toBeLessThanOrEqual(STADIUM.width);
      } else {
        removePlayer(s, 'b');
        expect(pl(s, 'a').holding).toBeNull();
      }
    }
  });

  it('no se tragan Jeffs en cadena', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'jeff' }, { id: 'b', team: 'blue', hero: 'jeff' }, { id: 'c', team: 'red', hero: 'spider' }]);
    const a = place(s, 'a', -150, 0);
    a.ax = 1; a.ay = 0;
    const b = place(s, 'b', -150 + 2 * PLAYER.radius + 3, 0);
    b.ax = -1; b.ay = 0;
    place(s, 'c', 100, 100);
    s.ball.x = 0; s.ball.y = 170;
    tick(s, { a: IN.E });
    expect(b.eatenBy).toBe('a');
    tick(s, { a: 0, b: IN.E });
    expect(b.holding).toBeNull();
  });

  it('chorro: dirección fija, empuja la pelota y frena a Jeff; no mueve la pelota protegida', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'jeff' }]);
    const a = place(s, 'a', -150, 0);
    a.ax = 1; a.ay = 0;
    s.ball.x = -100; s.ball.y = 0; s.ball.vx = 0; s.ball.vy = 0;
    tick(s, { a: IN.Q });
    expect(a.spray).toBeGreaterThan(0);
    run(s, 20, { a: IN.UP });
    expect(s.ball.vx).toBeGreaterThan(1);
    const g = game([{ id: 'a', team: 'red', hero: 'jeff' }]);
    const ga = place(g, 'a', -150, 0);
    ga.ax = 1; ga.ay = 0;
    g.ball.x = -100; g.ball.y = 0;
    g.ballShield = 60;
    tick(g, { a: IN.Q });
    run(g, 20, { a: 0 });
    expect(Math.abs(g.ball.vx)).toBeLessThan(0.2);
  });
});

describe('Goku', () => {
  it('Kamehameha: mantener carga (se mueve al 50 %), soltar dispara; a carga máxima la pelota queda con energía', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'goku' }, { id: 'b', team: 'blue', hero: 'spider' }]);
    const a = place(s, 'a', -150, 0);
    a.ax = 1; a.ay = 0;
    place(s, 'b', 150, 150);
    s.ball.x = -60; s.ball.y = 0;
    tick(s, { a: IN.Q });
    expect(a.charge).toBeGreaterThan(0);
    expect(a.cdQ).toBe(0);
    run(s, POWERS.goku.kame.maxCharge, { a: IN.Q });
    expect(a.charge).toBe(kameMaxCharge(s, a));
    const ev = tick(s, { a: 0 });
    expect(powerEv(ev, 'q')).toBe(true);
    expect(a.cdQ).toBeGreaterThanOrEqual(POWERS.goku.kame.cooldown - 1);
    expect(s.ball.vx).toBeGreaterThan(K * 1.5);
    expect(s.ballKi).toBeGreaterThan(0);
  });

  it('la energía aturde y empuja al primer rival que toca la pelota y se consume', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'goku' }, { id: 'b', team: 'blue', hero: 'spider' }]);
    place(s, 'a', -150, -150);
    s.ballKi = POWERS.goku.kame.energyTicks;
    s.ballKiBy = 'a';
    s.ball.x = 0; s.ball.y = 0; s.ball.vx = 0; s.ball.vy = 0;
    place(s, 'b', s.ball.r + PLAYER.radius - 1, 0);
    tick(s);
    expect(pl(s, 'b').stun).toBeGreaterThan(0);
    expect(s.ballKi).toBe(0);
  });

  it('pelota protegida: el Kamehameha no la mueve ni le da energía', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'goku' }]);
    const a = place(s, 'a', -150, 0);
    a.ax = 1; a.ay = 0;
    s.ball.x = -60; s.ball.y = 0;
    s.ballShield = 200;
    tick(s, { a: IN.Q });
    run(s, POWERS.goku.kame.maxCharge + 2, { a: IN.Q });
    tick(s, { a: 0 });
    expect(Math.abs(s.ball.vx)).toBeLessThan(0.1);
    expect(s.ballKi).toBe(0);
  });

  it('Transmisión: aparece detrás de la pelota, patada +75 % y onda que no mueve la pelota; sin lugar no gasta', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'goku' }, { id: 'b', team: 'blue', hero: 'spider' }]);
    const a = place(s, 'a', -300, 0);
    place(s, 'b', 60, 30);
    s.ball.x = 40; s.ball.y = 0; s.ball.vx = 0; s.ball.vy = 0;
    expect(powerEv(tick(s, { a: IN.E }), 'e')).toBe(true);
    expect(a.d.x).toBeLessThan(s.ball.x);
    expect(Math.hypot(a.d.x - s.ball.x, a.d.y - s.ball.y)).toBeLessThan(a.d.r + s.ball.r + 6);
    expect(Math.hypot(s.ball.vx, s.ball.vy)).toBeLessThan(0.01);
    expect(a.blinkKick).toBeGreaterThan(0);
    expect(a.cdE).toBeGreaterThanOrEqual(POWERS.goku.blink.cooldown - 1);
    // lejos de la pelota (más de media cancha): no hay lugar, no gasta
    const f = game([{ id: 'a', team: 'red', hero: 'goku' }]);
    place(f, 'a', -380, 0);
    f.ball.x = 380; f.ball.y = 0;
    expect(blinkSpot(f, pl(f, 'a'))).toBeNull();
    tick(f, { a: IN.E });
    expect(pl(f, 'a').cdE).toBe(0);
  });

  it('ki: una carga por patada (como máximo una por segundo); con 5 la transmisión deja una gratis; se reinicia con el gol', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'goku' }]);
    const a = place(s, 'a', -150, 0);
    a.ax = 1; a.ay = 0;
    let kicks = 0;
    for (let i = 0; i < 6 * TICK_RATE; i++) {
      s.ball.x = a.d.x + a.d.r + s.ball.r + 1; s.ball.y = a.d.y; s.ball.vx = 0; s.ball.vy = 0;
      if (tick(s, { a: i % 6 === 0 ? IN.KICK : 0 }).some((e) => e.type === 'kick')) kicks++;
      a.d.x = -150; a.d.y = 0;
    }
    expect(kicks).toBeGreaterThan(10);
    expect(a.ki).toBe(5);
    s.ball.x = 0; s.ball.y = 0; s.ball.vx = 0; s.ball.vy = 0;
    tick(s, { a: IN.E });
    expect(a.ki).toBe(0);
    expect(a.freeBlink).toBeGreaterThan(0);
    s.ball.x = 100; s.ball.y = 50;
    tick(s, { a: 0 });
    expect(powerEv(tick(s, { a: IN.E }), 'e')).toBe(true);
    expect(a.freeBlink).toBe(0);
    a.ki = 3;
    resetKickoff(s, 'red');
    expect(a.ki).toBe(0);
  });

  it('ki lleno: la Q carga en la mitad del tiempo', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'goku' }]);
    const a = place(s, 'a', -150, 0);
    a.ki = POWERS.goku.ki.max;
    tick(s, { a: IN.Q });
    expect(a.ki).toBe(0);
    expect(kameMaxCharge(s, a)).toBe(Math.round(POWERS.goku.kame.maxCharge * 0.5));
  });

  it('Súper: necesita 3 cargas de ki y es más rápido', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'goku' }], 'super');
    const a = place(s, 'a', -150, 0);
    a.ki = 3;
    tick(s, { a: IN.Q });
    expect(a.ki).toBe(0);
    expect(kameMaxCharge(s, a)).toBe(Math.round(SUPER_POWERS.goku.kame.maxCharge * 0.5));
  });
});

describe('modo clásico y bots', () => {
  it('clásico: los héroes nuevos no tienen poderes ni pasiva', () => {
    const s = createGame({ mode: 'classic', timeLimitMin: 3, scoreLimit: 3, players: [{ id: 'a', team: 'red', hero: 'goku' }, { id: 'b', team: 'blue', hero: 'jeff' }] });
    s.phase = 'playing';
    s.liveTicks = 600;
    const a = place(s, 'a', -150, 0);
    a.ax = 1; a.ay = 0;
    tick(s, { a: IN.Q, b: IN.E });
    expect(a.charge).toBe(0);
    expect(pl(s, 'b').holding).toBeNull();
    s.ball.x = a.d.x + a.d.r + s.ball.r + 1; s.ball.y = 0;
    tick(s, { a: IN.KICK });
    expect(a.ki).toBe(0);
  });

  it('bots con los héroes nuevos juegan sin romper nada', () => {
    for (const mode of ['heroes', 'super'] as const) {
      const s = game([
        { id: 'a', team: 'red', hero: 'bendy' }, { id: 'b', team: 'red', hero: 'jeff' }, { id: 'c', team: 'red', hero: 'goku' },
        { id: 'd', team: 'blue', hero: 'goku' }, { id: 'e', team: 'blue', hero: 'jeff' }, { id: 'f', team: 'blue', hero: 'bendy' },
      ], mode, 0);
      const brains = s.players.map((p) => makeBrain(p.id, 0.9));
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const used = new Set<string>();
      for (let i = 0; i < 90 * TICK_RATE; i++) {
        const bits: Record<string, number> = {};
        for (const br of brains) bits[br.id] = botInput(s, br, rnd);
        for (const e of tick(s, bits)) if (e.type === 'power') used.add(`${e.hero}-${e.slot}`);
        for (const p of s.players) {
          expect(Number.isFinite(p.d.x) && Number.isFinite(p.d.y)).toBe(true);
          if (p.eatenBy) expect(pl(s, p.eatenBy).holding).toBe(p.id);
        }
        if (s.phase === 'ended') break;
      }
      expect(used.size).toBeGreaterThan(2);
    }
  });
});
