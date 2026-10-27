// Héroes desbloqueables: cada habilidad y sus límites, Súper y bots.
import { describe, expect, it } from 'vitest';
import { botInput, makeBrain } from '../shared/bot';
import { HERO_CATALOG, HERO_IDS, HEROES, HeroId, PLAYER, PUBLIC_HERO_IDS, R, SECRET_IDS, STADIUM, SUPER_HEROES } from '../shared/config';
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
  it('18 héroes: 4 iniciales gratis, 13 desbloqueables con la rareza pedida y 1 secreto', () => {
    expect(HERO_IDS).toHaveLength(18);
    expect(SECRET_IDS).toEqual(['thanos']);
    expect(PUBLIC_HERO_IDS).toHaveLength(17);
    expect(PUBLIC_HERO_IDS).not.toContain('thanos');
    const starters = HERO_IDS.filter((h) => HERO_CATALOG[h].starter);
    expect(starters).toEqual(['spider', 'batman', 'hulk', 'superman']);
    const r = (h: HeroId) => HERO_CATALOG[h].rarity;
    expect([r('hawkeye'), r('widow')]).toEqual(['common', 'common']);
    expect([r('cap'), r('panther')]).toEqual(['rare', 'rare']);
    expect([r('ironman'), r('flash')]).toEqual(['epic', 'epic']);
    expect([r('thor'), r('strange')]).toEqual(['legendary', 'legendary']);
    expect([r('ibai'), r('homer'), r('cj'), r('verity'), r('baldi')]).toEqual(['rare', 'epic', 'epic', 'epic', 'legendary']);
    expect(HEROES.thanos.gems).toHaveLength(5);
    for (const h of HERO_IDS) {
      expect(HEROES[h].q.desc.length).toBeGreaterThan(10);
      expect(SUPER_HEROES[h].e.desc.length).toBeGreaterThan(10);
    }
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

  it.each(['heroes', 'super'] as const)('bots con los héroes públicos en %s: estable y usan sus poderes', (mode) => {
    const heroes = PUBLIC_HERO_IDS.slice(4);
    const used = new Set<string>();
    for (let k = 0; k < heroes.length; k += 2) {
      const ids = ['r0', 'r1', 'b0', 'b1'];
      const hs = [heroes[k], heroes[(k + 1) % heroes.length], HERO_IDS[k % 4], HERO_IDS[(k + 1) % 4]];
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
