// Héroes desbloqueables: cada habilidad y sus límites, Súper y bots.
import { describe, expect, it } from 'vitest';
import { botInput, makeBrain } from '../shared/bot';
import { BALL, HERO_CATALOG, HERO_IDS, HEROES, HeroId, LIMITS, PLAYER, POWERS, R, STADIUM, SUPER_HEROES, SUPER_POWERS } from '../shared/config';
import { createGame, setInput, step } from '../shared/game';
import { GameState, IN, Team } from '../shared/types';

type P = { id: string; team: Team; hero: HeroId };

function game(players: P[], mode: 'heroes' | 'super' = 'heroes'): GameState {
  const s = createGame({ mode, timeLimitMin: 3, scoreLimit: 3, players });
  s.phase = 'playing';
  // pelota lejos salvo que la prueba la ubique
  s.ball.x = 0; s.ball.y = 160;
  return s;
}

function tick(s: GameState, bits: Record<string, number> = {}) {
  for (const [id, b] of Object.entries(bits)) setInput(s, id, b);
  s.events = [];
  step(s);
  return s.events;
}

function place(s: GameState, id: string, x: number, y: number, ax = 1, ay = 0) {
  const p = s.players.find((o) => o.id === id)!;
  p.d.x = x; p.d.y = y; p.d.vx = 0; p.d.vy = 0;
  p.ax = ax; p.ay = ay;
  return p;
}

function ball(s: GameState, x: number, y: number) {
  s.ball.x = x; s.ball.y = y; s.ball.vx = 0; s.ball.vy = 0;
}

const gap = (a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }) => Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;

/** Activa una ranura (flanco) y avanza n ticks sin entradas. */
function cast(s: GameState, id: string, slot: 'q' | 'e', n = 1) {
  const ev = tick(s, { [id]: slot === 'q' ? IN.Q : IN.E });
  for (let i = 1; i < n; i++) ev.push(...tick(s, { [id]: 0 }));
  return ev;
}

describe('catálogo', () => {
  it('12 héroes: 4 iniciales gratis y 8 desbloqueables con la rareza pedida', () => {
    expect(HERO_IDS).toHaveLength(12);
    const starters = HERO_IDS.filter((h) => HERO_CATALOG[h].starter);
    expect(starters).toEqual(['spider', 'batman', 'hulk', 'superman']);
    const r = (h: HeroId) => HERO_CATALOG[h].rarity;
    expect([r('hawkeye'), r('widow')]).toEqual(['common', 'common']);
    expect([r('cap'), r('panther')]).toEqual(['rare', 'rare']);
    expect([r('ironman'), r('flash')]).toEqual(['epic', 'epic']);
    expect([r('thor'), r('strange')]).toEqual(['legendary', 'legendary']);
    for (const h of HERO_IDS) {
      expect(HEROES[h].q.desc.length).toBeGreaterThan(10);
      expect(SUPER_HEROES[h].e.desc.length).toBeGreaterThan(10);
    }
  });

  it('valores de partida pedidos (alcances en R y recargas)', () => {
    const sec = (t: number) => t / 60;
    expect(POWERS.hawkeye.arrow.range).toBe(10 * R);
    expect(sec(POWERS.hawkeye.arrow.cooldown)).toBe(7);
    expect(POWERS.hawkeye.sidestep.distance).toBe(2.5 * R);
    expect(POWERS.widow.shock.range).toBe(6 * R);
    expect(POWERS.widow.shock.slowPct).toBe(0.2);
    expect(POWERS.cap.shield.range).toBe(8 * R);
    expect(POWERS.cap.guard.resist).toBe(0.6);
    expect(POWERS.panther.leap.distance).toBe(4 * R);
    expect(POWERS.panther.pulse.range).toBe(3 * R);
    expect(POWERS.ironman.thrusters.mult).toBe(1.3);
    expect(POWERS.flash.sprint.accelMult).toBe(1.5);
    expect(POWERS.flash.sprint.speedMult).toBe(1.35);
    expect(POWERS.flash.trail.slowPct).toBe(0.15);
    expect(POWERS.thor.thunder.ahead).toBe(4 * R);
    expect(POWERS.strange.deflect.maxAngle).toBe(30);
    expect(POWERS.strange.blink.distance).toBe(3 * R);
  });

  it('Súper usa ajustes explícitos y sigue respetando los topes', () => {
    for (const k of Object.keys(SUPER_POWERS) as (keyof typeof SUPER_POWERS)[]) expect(SUPER_POWERS[k]).toBeDefined();
    // anticipaciones conservadas
    expect(SUPER_POWERS.thor.thunder.delay).toBe(POWERS.thor.thunder.delay);
    expect(SUPER_POWERS.panther.pulse.delay).toBe(POWERS.panther.pulse.delay);
    // ralentizaciones moderadas
    expect(SUPER_POWERS.widow.shock.slowPct).toBeLessThanOrEqual(0.3);
    expect(SUPER_POWERS.flash.trail.slowPct).toBeLessThanOrEqual(0.2);
  });
});

describe('Hawkeye', () => {
  it('Flecha: empuja la pelota en la dirección del disparo, sin seguimiento', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'hawkeye' }]);
    place(s, 'a', -200, 0);
    ball(s, -100, 0);
    cast(s, 'a', 'q', 20);
    expect(s.ball.vx).toBeGreaterThan(1);
    expect(Math.abs(s.ball.vy)).toBeLessThan(1e-9);
    // sin seguimiento: con la pelota fuera de la línea no la toca
    const t = game([{ id: 'a', team: 'red', hero: 'hawkeye' }]);
    place(t, 'a', -200, 0);
    ball(t, -100, 40);
    cast(t, 'a', 'q', 20);
    expect(t.ball.vx).toBe(0);
  });

  it('Flecha: alcance 10R y la frena cualquier jugador (también un aliado)', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'hawkeye' }]);
    place(s, 'a', -300, 0);
    ball(s, -300 + PLAYER.radius + 10 * R + BALL.radius + 12, 0);
    cast(s, 'a', 'q', 40);
    expect(s.ball.vx).toBe(0);
    const t = game([{ id: 'a', team: 'red', hero: 'hawkeye' }, { id: 'm', team: 'red', hero: 'hulk' }]);
    place(t, 'a', -200, 0);
    place(t, 'm', -150, 0);
    ball(t, -80, 0);
    cast(t, 'a', 'q', 20);
    expect(t.ball.vx).toBe(0);
  });

  it('Paso lateral: hasta 2,5R y se detiene ante la pelota sin atravesarla', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'hawkeye' }]);
    const p = place(s, 'a', -200, -60, 0, 1);
    cast(s, 'a', 'e', 1);
    while (p.rush > 0) tick(s);
    const moved = Math.hypot(p.d.x + 200, p.d.y + 60);
    expect(moved).toBeGreaterThan(2.4 * R);
    expect(moved).toBeLessThanOrEqual(2.5 * R + 1e-6);
    // termina con velocidad normal de carrera (no se desliza lejos)
    expect(Math.hypot(p.d.vx, p.d.vy)).toBeLessThanOrEqual(LIMITS.playerInputSpeed + 1e-9);
    const t = game([{ id: 'a', team: 'red', hero: 'hawkeye' }]);
    const q = place(t, 'a', -200, 0);
    ball(t, -200 + PLAYER.radius + BALL.radius + 12, 0);
    cast(t, 'a', 'e', 6);
    expect(gap(q.d, t.ball)).toBeGreaterThan(-0.2);
    expect(t.ball.x).toBeGreaterThan(q.d.x);
  });
});

describe('Black Widow', () => {
  it('Descarga: frena 20 % sólo al primer rival, atraviesa aliados y pelota', () => {
    const s = game([
      { id: 'a', team: 'red', hero: 'widow' },
      { id: 'm', team: 'red', hero: 'hulk' },
      { id: 'b', team: 'blue', hero: 'hulk' },
      { id: 'c', team: 'blue', hero: 'hulk' },
    ]);
    place(s, 'a', -200, 0);
    place(s, 'm', -160, 0);
    ball(s, -125, 0);
    const b = place(s, 'b', -100, 0);
    const c = place(s, 'c', -60, 0);
    cast(s, 'a', 'q', 12);
    expect(b.slowPct).toBe(0.2);
    expect(c.slowPct).toBe(0);
    expect(s.players.find((o) => o.id === 'm')!.slowPct).toBe(0);
    expect(s.ball.vx).toBe(0);
    // dura 0,7 s
    for (let i = 0; i < 45; i++) tick(s);
    expect(b.slowPct).toBe(0);
  });

  it('Evasión: reduce a la mitad el empuje de un poder; las colisiones siguen', () => {
    const push = (evade: boolean) => {
      const s = game([{ id: 'h', team: 'red', hero: 'hulk' }, { id: 'w', team: 'blue', hero: 'widow' }]);
      place(s, 'h', 0, 0);
      const w = place(s, 'w', PLAYER.radius * 2 + 10, 0);
      if (evade) cast(s, 'w', 'e', 1);
      w.d.vx = 0;
      tick(s, { h: IN.Q, w: 0 });
      return w.d.vx;
    };
    const normal = push(false);
    const reduced = push(true);
    expect(normal).toBeGreaterThan(1);
    expect(reduced / normal).toBeGreaterThan(0.45);
    expect(reduced / normal).toBeLessThan(0.56);
  });
});

describe('Capitán América', () => {
  it('Escudo: un solo impacto a la pelota; vuelve sin volver a golpear', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'cap' }]);
    place(s, 'a', -200, 0);
    ball(s, -120, 0);
    let ballHits = 0;
    for (let i = 0; i < 120; i++) {
      const ev = tick(s, { a: i === 0 ? IN.Q : 0 });
      ballHits += ev.filter((e) => e.type === 'hit' && e.target === 'ball').length;
      // la pelota rebota contra el capitán al volver: ponerla lejos tras el impacto
      if (ballHits === 1 && s.ball.x < 0) ball(s, 200, 150);
    }
    expect(ballHits).toBe(1);
    expect(s.projectiles).toHaveLength(0);
  });

  it('Guardia: resiste 60 % y acelera 25 % menos', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'cap' }]);
    const p = place(s, 'a', -200, 0);
    cast(s, 'a', 'e', 1);
    p.d.vx = 0;
    tick(s, { a: IN.RIGHT });
    const guarded = p.d.vx;
    const t = game([{ id: 'a', team: 'red', hero: 'cap' }]);
    const q = place(t, 'a', -200, 0);
    tick(t, { a: IN.RIGHT });
    expect(guarded / q.d.vx).toBeCloseTo(0.75, 5);
  });
});

describe('Black Panther', () => {
  it('Salto felino: hasta 4R y se detiene antes de un rival', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'panther' }]);
    const p = place(s, 'a', -200, -40);
    cast(s, 'a', 'q', 1);
    while (p.rush > 0) tick(s);
    const moved = p.d.x + 200;
    expect(moved).toBeGreaterThan(3.9 * R);
    expect(moved).toBeLessThanOrEqual(4 * R + 1e-6);
    const t = game([{ id: 'a', team: 'red', hero: 'panther' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
    const q = place(t, 'a', -200, -40);
    const o = place(t, 'b', -200 + 2 * PLAYER.radius + 20, -40);
    cast(t, 'a', 'q', 3);
    expect(gap(q.d, o.d)).toBeGreaterThan(-0.2);
    expect(o.d.x).toBeGreaterThan(q.d.x);
  });

  it('Pulso: 0,3 s de aviso; empuja rivales dentro de 3R y poco a la pelota', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'panther' }, { id: 'b', team: 'blue', hero: 'hulk' }, { id: 'c', team: 'blue', hero: 'hulk' }]);
    place(s, 'a', 0, 0);
    const b = place(s, 'b', PLAYER.radius * 2 + 2 * R, 0);
    const c = place(s, 'c', -(PLAYER.radius * 2 + 3 * R + 6), 0);
    cast(s, 'a', 'e', 1);
    expect(s.zones).toHaveLength(1);
    for (let i = 0; i < 16; i++) tick(s);
    expect(b.d.vx).toBe(0);
    for (let i = 0; i < 3; i++) tick(s);
    expect(s.zones).toHaveLength(0);
    expect(b.d.vx).toBeGreaterThan(0.5);
    expect(c.d.vx).toBe(0);
  });
});

describe('Iron Man', () => {
  it('Repulsor: impulsa la pelota en la dirección del disparo (sin autoapuntado)', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'ironman' }]);
    place(s, 'a', -200, 0, Math.SQRT1_2, Math.SQRT1_2);
    ball(s, -200 + 70, 70);
    cast(s, 'a', 'q', 20);
    expect(Math.atan2(s.ball.vy, s.ball.vx)).toBeCloseTo(Math.PI / 4, 6);
    const t = game([{ id: 'a', team: 'red', hero: 'ironman' }]);
    place(t, 'a', -200, 0);
    ball(t, -120, 30);
    cast(t, 'a', 'q', 20);
    expect(t.ball.vx).toBe(0);
  });

  it('Propulsores: +30 % de velocidad máxima y gira peor', () => {
    const top = (on: boolean) => {
      const s = game([{ id: 'a', team: 'red', hero: 'ironman' }]);
      const p = place(s, 'a', -300, 0);
      for (let i = 0; i < 60; i++) tick(s, { a: IN.RIGHT });
      if (on) tick(s, { a: IN.RIGHT | IN.E });
      let best = 0;
      for (let i = 0; i < 40; i++) {
        tick(s, { a: IN.RIGHT });
        best = Math.max(best, Math.hypot(p.d.vx, p.d.vy));
      }
      return best;
    };
    expect(top(true) / top(false)).toBeGreaterThan(1.2);
    expect(top(true) / top(false)).toBeLessThan(1.31);
    // giro: misma entrada perpendicular, menos cambio lateral con propulsores
    const lateral = (on: boolean) => {
      const s = game([{ id: 'a', team: 'red', hero: 'ironman' }]);
      const p = place(s, 'a', -300, 0);
      for (let i = 0; i < 60; i++) tick(s, { a: IN.RIGHT });
      if (on) tick(s, { a: IN.RIGHT | IN.E });
      else tick(s, { a: IN.RIGHT });
      const vy0 = p.d.vy;
      for (let i = 0; i < 10; i++) tick(s, { a: IN.DOWN });
      return p.d.vy - vy0;
    };
    expect(lateral(true)).toBeLessThan(lateral(false) * 0.7);
  });
});

describe('Flash', () => {
  it('Carrera relámpago: límite de velocidad +35 % durante 0,7 s', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'flash' }]);
    const p = place(s, 'a', -300, 0);
    for (let i = 0; i < 60; i++) tick(s, { a: IN.RIGHT });
    tick(s, { a: IN.RIGHT | IN.Q });
    let best = 0;
    for (let i = 0; i < 41; i++) {
      tick(s, { a: IN.RIGHT });
      best = Math.max(best, Math.hypot(p.d.vx, p.d.vy));
    }
    expect(best).toBeLessThanOrEqual(LIMITS.playerInputSpeed * 1.35 + 1e-9);
    expect(best).toBeGreaterThan(LIMITS.playerInputSpeed * 1.2);
    expect(p.sprint).toBe(0);
  });

  it('Estela: ralentiza 15 % a rivales, ≤ 0,5 s tras salir, sin sumarse', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'flash' }, { id: 'b', team: 'blue', hero: 'hulk' }, { id: 'm', team: 'red', hero: 'hulk' }]);
    place(s, 'a', -200, 0);
    const b = place(s, 'b', -200, 2 * PLAYER.radius + 4);
    const m = place(s, 'm', -200, -(2 * PLAYER.radius + 4));
    cast(s, 'a', 'e', 2);
    expect(b.slowPct).toBe(0.15);
    expect(m.slowPct).toBe(0);
    // un batarang (30 %) no se suma: prevalece el más fuerte
    b.slowPct = 0.3; b.slowTicks = 5;
    tick(s);
    expect(b.slowPct).toBe(0.3);
    // sale de la zona: el efecto termina como máximo 0,5 s después
    b.d.x = 300; b.d.y = 150;
    b.slowPct = 0.15; b.slowTicks = 0;
    tick(s);
    let t = 0;
    while (b.slowTicks > 0) { tick(s); t++; }
    expect(t).toBeLessThanOrEqual(30);
  });
});

describe('Thor', () => {
  it('Mjolnir: empuja al primer rival alcanzado y desaparece (un impacto)', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'thor' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
    place(s, 'a', -200, 0);
    const b = place(s, 'b', -120, 0);
    ball(s, -60, 0);
    cast(s, 'a', 'q', 8);
    expect(b.d.vx).toBeGreaterThan(1);
    // el martillo se consumió en el rival: la pelota detrás no recibió impacto
    expect(s.projectiles).toHaveLength(0);
    expect(s.ball.vx).toBe(0);
  });

  it('Trueno: zona 4R delante durante 0,5 s; se puede esquivar', () => {
    const run = (dodge: boolean) => {
      const s = game([{ id: 'a', team: 'red', hero: 'thor' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
      place(s, 'a', -200, 0);
      const b = place(s, 'b', -200 + PLAYER.radius + 4 * R, 0);
      cast(s, 'a', 'e', 1);
      const z = s.zones[0];
      expect(z.x).toBeCloseTo(-200 + PLAYER.radius + 4 * R, 6);
      expect(z.r).toBe(3 * R);
      if (dodge) { b.d.y = 120; }
      for (let i = 0; i < 29; i++) tick(s);
      expect(Math.hypot(b.d.vx, b.d.vy)).toBe(0);
      for (let i = 0; i < 2; i++) tick(s);
      return Math.hypot(b.d.vx, b.d.vy);
    };
    expect(run(false)).toBe(0); // en el centro exacto no hay dirección: sin empuje
    expect(run(true)).toBe(0);
    const s = game([{ id: 'a', team: 'red', hero: 'thor' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
    place(s, 'a', -200, 0);
    const b = place(s, 'b', -200 + PLAYER.radius + 4 * R, 20);
    cast(s, 'a', 'e', 32);
    expect(b.d.vy).toBeGreaterThan(0.5);
  });
});

describe('Doctor Strange', () => {
  it('Desvío: una sola vez, como máximo 30°, sin acelerar la pelota', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'strange' }]);
    place(s, 'a', -200, 100, 0, -1);
    const z0 = { x: -200, y: 100 - 6 * R };
    ball(s, z0.x - 60, z0.y);
    s.ball.vx = 4;
    cast(s, 'a', 'q', 1);
    expect(s.zones[0].x).toBeCloseTo(z0.x, 6);
    expect(s.zones[0].y).toBeCloseTo(z0.y, 6);
    let hits = 0;
    let sp0 = 0;
    for (let i = 0; i < 40; i++) {
      sp0 = Math.hypot(s.ball.vx, s.ball.vy);
      const ev = tick(s);
      if (ev.some((e) => e.type === 'hit' && e.target === 'ball')) {
        hits++;
        const ang = (Math.atan2(s.ball.vy, s.ball.vx) * 180) / Math.PI;
        expect(ang).toBeCloseTo(-30, 4);
        // misma rapidez (sólo cambia la dirección; el amortiguamiento ya actuó)
        expect(Math.hypot(s.ball.vx, s.ball.vy)).toBeLessThanOrEqual(sp0 + 1e-9);
      }
    }
    expect(hits).toBe(1);
    expect(s.zones).toHaveLength(0);
  });

  it('Paso místico: hasta 3R, no atraviesa jugadores ni pelota ni paredes', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'strange' }]);
    const p = place(s, 'a', -200, 0);
    cast(s, 'a', 'e', 1);
    expect(p.d.x + 200).toBeCloseTo(3 * R, 0);
    // pelota en el camino: queda antes, sin solaparse
    const t = game([{ id: 'a', team: 'red', hero: 'strange' }]);
    const q = place(t, 'a', -200, 0);
    ball(t, -200 + 30, 0);
    const ev = cast(t, 'a', 'e', 1);
    // 30 - 25 = 5 libres ≥ 0,5R no alcanza: no se teletransporta y no gasta recarga
    expect(ev.some((e) => e.type === 'blink')).toBe(false);
    expect(q.cdE).toBe(0);
    expect(q.d.x).toBe(-200);
    // contra la pared exterior
    const u = game([{ id: 'a', team: 'red', hero: 'strange' }]);
    const w = place(u, 'a', STADIUM.width - PLAYER.radius - 20, 0);
    cast(u, 'a', 'e', 1);
    expect(w.d.x).toBeLessThanOrEqual(STADIUM.width - PLAYER.radius + 1e-9);
  });
});

describe('reglas comunes de los nuevos', () => {
  it('reiniciar (gol) limpia zonas, proyectiles y efectos', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'thor' }, { id: 'b', team: 'blue', hero: 'flash' }]);
    place(s, 'a', -200, 0);
    place(s, 'b', 100, 0);
    tick(s, { a: IN.E, b: IN.Q });
    expect(s.zones.length + s.players[1].sprint).toBeGreaterThan(0);
    ball(s, STADIUM.fieldW - 2, 0);
    s.ball.vx = 6;
    for (let i = 0; i < 3; i++) tick(s, { a: 0, b: 0 });
    expect(s.phase).toBe('goal');
    expect(s.zones).toHaveLength(0);
    expect(s.projectiles).toHaveLength(0);
    expect(s.players[1].sprint).toBe(0);
  });

  it.each(['heroes', 'super'] as const)('bots con los 12 héroes en %s: estable y usan sus poderes', (mode) => {
    const heroes = HERO_IDS.slice(4);
    const used = new Set<string>();
    for (let k = 0; k < heroes.length; k += 2) {
      const ids = ['r0', 'r1', 'b0', 'b1'];
      const hs = [heroes[k], heroes[k + 1], HERO_IDS[k % 4], HERO_IDS[(k + 1) % 4]];
      const s = createGame({ mode, timeLimitMin: 1, scoreLimit: 0, players: ids.map((id, i) => ({ id, team: i < 2 ? 'red' : 'blue', hero: hs[i] })) });
      let seed = 11 + k;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const brains = ids.map((id) => makeBrain(id, 0.8));
      for (let i = 0; i < 60 * 70 && s.phase !== 'ended'; i++) {
        for (const b of brains) setInput(s, b.id, botInput(s, b, rnd));
        s.events = [];
        step(s);
        for (const e of s.events) if (e.type === 'power') used.add(`${e.hero}-${e.slot}`);
        for (const d of [s.ball, ...s.players.map((p) => p.d)]) {
          expect(Number.isFinite(d.x) && Number.isFinite(d.y)).toBe(true);
          expect(Math.abs(d.x)).toBeLessThanOrEqual(430);
          expect(Math.abs(d.y)).toBeLessThanOrEqual(210);
        }
      }
    }
    for (const h of heroes) {
      expect(used.has(`${h}-q`) || used.has(`${h}-e`), h).toBe(true);
    }
  });
});
