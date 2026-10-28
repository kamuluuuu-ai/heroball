// Reglas puras de la economía: probabilidades, garantías, duplicados,
// calendario y elegibilidad de partidas oficiales.
import { randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HERO_CATALOG, HERO_IDS, STARTER_IDS, type HeroId } from '../shared/config';
import {
  ECONOMY, ODDS_SCALE, RARITIES, effectiveOdds, heroesOfRarity, localDate, nextPity, periods, pickRarity, positiveInt, resolveChest,
} from '../shared/economy';
import { evaluateMatch, matchCoins, type MatchSummary } from '../server/official';

describe('configuración', () => {
  it('probabilidades base exactas y que suman 100 %', () => {
    expect(ECONOMY.chests.standard).toEqual({ price: 200, odds: { common: 600_000, rare: 280_000, epic: 100_000, legendary: 20_000 } });
    expect(ECONOMY.chests.elite).toEqual({ price: 600, odds: { common: 0, rare: 700_000, epic: 250_000, legendary: 50_000 } });
    for (const t of ['standard', 'elite'] as const) {
      expect(RARITIES.reduce((a, r) => a + ECONOMY.chests[t].odds[r], 0)).toBe(ODDS_SCALE);
    }
    expect(ECONOMY.duplicateFragments).toEqual({ common: 10, rare: 25, epic: 60, legendary: 150 });
    expect(ECONOMY.unlockCost).toEqual({ common: 100, rare: 250, epic: 600, legendary: 1500 });
    expect(ECONOMY.welcome).toEqual({ coins: 400, standard: 2, elite: 0 });
  });

  it('los iniciales y el secreto no salen en cofres; composición versión 3', () => {
    expect(ECONOMY.version).toBe(3);
    expect(heroesOfRarity('common')).toEqual(['hawkeye', 'widow']);
    expect(heroesOfRarity('rare')).toEqual(['cap', 'panther', 'ibai']);
    expect(heroesOfRarity('epic')).toEqual(['ironman', 'flash', 'homer', 'cj', 'verity', 'bendy']);
    expect(heroesOfRarity('legendary')).toEqual(['thor', 'strange', 'baldi', 'jeff', 'goku']);
    for (const r of RARITIES) {
      for (const h of heroesOfRarity(r)) {
        expect(STARTER_IDS).not.toContain(h);
        expect(h).not.toBe('thanos');
      }
    }
  });
});

describe('garantías', () => {
  it('sin garantía: probabilidades base', () => {
    expect(effectiveOdds('standard', { sinceEpic: 8, sinceLegendary: 28 })).toEqual({ odds: ECONOMY.chests.standard.odds, guarantee: null });
  });

  it('garantía épica: épico/legendario normalizados desde la base del cofre', () => {
    const s = effectiveOdds('standard', { sinceEpic: 9, sinceLegendary: 9 });
    expect(s.guarantee).toBe('epic');
    expect(s.odds.common + s.odds.rare).toBe(0);
    expect(s.odds.legendary / ODDS_SCALE).toBeCloseTo(20 / 120, 5);
    expect(s.odds.epic + s.odds.legendary).toBe(ODDS_SCALE);
    const e = effectiveOdds('elite', { sinceEpic: 9, sinceLegendary: 9 });
    expect(e.odds.legendary / ODDS_SCALE).toBeCloseTo(50 / 300, 5);
  });

  it('garantía legendaria y prioridad cuando ambas coinciden', () => {
    for (const sinceEpic of [0, 9, 20]) {
      const g = effectiveOdds('standard', { sinceEpic, sinceLegendary: 29 });
      expect(g.guarantee).toBe('legendary');
      expect(g.odds.legendary).toBe(ODDS_SCALE);
    }
  });

  it('contadores: legendario reinicia ambos; épico sólo el épico; el resto suma; duplicados igual', () => {
    expect(nextPity({ sinceEpic: 5, sinceLegendary: 20 }, 'legendary')).toEqual({ sinceEpic: 0, sinceLegendary: 0 });
    expect(nextPity({ sinceEpic: 5, sinceLegendary: 20 }, 'epic')).toEqual({ sinceEpic: 0, sinceLegendary: 21 });
    expect(nextPity({ sinceEpic: 5, sinceLegendary: 20 }, 'rare')).toEqual({ sinceEpic: 6, sinceLegendary: 21 });
    expect(nextPity({ sinceEpic: 5, sinceLegendary: 20 }, 'common')).toEqual({ sinceEpic: 6, sinceLegendary: 21 });
  });

  it('nunca pasan 10 aperturas sin épico+, ni 30 sin legendario (100 000 aperturas)', () => {
    let pity = { sinceEpic: 0, sinceLegendary: 0 };
    let worstEpic = 0;
    let worstLeg = 0;
    let runE = 0;
    let runL = 0;
    for (let i = 0; i < 100_000; i++) {
      const out = resolveChest(i % 3 ? 'standard' : 'elite', pity, new Set(), randomInt(ODDS_SCALE), (n) => randomInt(n));
      pity = out.pityAfter;
      runE = out.rarity === 'epic' || out.rarity === 'legendary' ? 0 : runE + 1;
      runL = out.rarity === 'legendary' ? 0 : runL + 1;
      worstEpic = Math.max(worstEpic, runE);
      worstLeg = Math.max(worstLeg, runL);
    }
    expect(worstEpic).toBeLessThanOrEqual(9);
    expect(worstLeg).toBeLessThanOrEqual(29);
  });
});

describe('sorteo', () => {
  it('pickRarity respeta los límites exactos de cada tramo', () => {
    const o = ECONOMY.chests.standard.odds;
    expect(pickRarity(o, 0)).toBe('common');
    expect(pickRarity(o, 599_999)).toBe('common');
    expect(pickRarity(o, 600_000)).toBe('rare');
    expect(pickRarity(o, 879_999)).toBe('rare');
    expect(pickRarity(o, 880_000)).toBe('epic');
    expect(pickRarity(o, 979_999)).toBe('epic');
    expect(pickRarity(o, 980_000)).toBe('legendary');
    expect(pickRarity(o, 999_999)).toBe('legendary');
    expect(pickRarity(ECONOMY.chests.elite.odds, 0)).toBe('rare');
  });

  it('frecuencias con crypto.randomInt cercanas a las publicadas (sin garantías)', () => {
    const N = 200_000;
    const count = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const heroes = new Map<HeroId, number>();
    for (let i = 0; i < N; i++) {
      const out = resolveChest('standard', { sinceEpic: 0, sinceLegendary: 0 }, new Set(), randomInt(ODDS_SCALE), (n) => randomInt(n));
      count[out.rarity]++;
      heroes.set(out.hero, (heroes.get(out.hero) ?? 0) + 1);
    }
    expect(count.common / N).toBeCloseTo(0.6, 2);
    expect(count.rare / N).toBeCloseTo(0.28, 2);
    expect(count.epic / N).toBeCloseTo(0.1, 2);
    expect(count.legendary / N).toBeCloseTo(0.02, 2);
    // igual probabilidad dentro de cada rareza
    for (const r of RARITIES) {
      const [a, b] = heroesOfRarity(r).map((h) => heroes.get(h) ?? 0);
      expect(Math.abs(a - b) / (a + b)).toBeLessThan(0.05);
    }
  });

  it('duplicado: Fragmentos según la rareza obtenida', () => {
    const owned = new Set<HeroId>(HERO_IDS);
    for (const [roll, r] of [[0, 'common'], [700_000, 'rare'], [900_000, 'epic'], [990_000, 'legendary']] as const) {
      const out = resolveChest('standard', { sinceEpic: 0, sinceLegendary: 0 }, owned, roll, () => 0);
      expect(out.rarity).toBe(r);
      expect(out.duplicate).toBe(true);
      expect(out.fragments).toBe(ECONOMY.duplicateFragments[r]);
      expect(HERO_CATALOG[out.hero].rarity).toBe(r);
    }
    const fresh = resolveChest('standard', { sinceEpic: 0, sinceLegendary: 0 }, new Set(), 0, () => 1);
    expect(fresh.duplicate).toBe(false);
    expect(fresh.fragments).toBe(0);
  });
});

describe('calendario (America/Montevideo, calculado en el servidor)', () => {
  it('el día cambia a las 00:00 de Montevideo (03:00 UTC)', () => {
    expect(localDate(new Date('2026-10-27T02:59:59Z'))).toBe('2026-10-26');
    expect(localDate(new Date('2026-10-27T03:00:00Z'))).toBe('2026-10-27');
    const p = periods(new Date('2026-10-27T15:00:00Z'));
    expect(p.day).toBe('2026-10-27');
    expect(p.dailyResetAt.toISOString()).toBe('2026-10-28T03:00:00.000Z');
  });

  it('la semana va de lunes a domingo', () => {
    // 2026-10-27 es martes
    const p = periods(new Date('2026-10-27T15:00:00Z'));
    expect(p.week).toBe('2026-10-26');
    expect(p.weeklyResetAt.toISOString()).toBe('2026-11-02T03:00:00.000Z');
    // domingo 23:59 local sigue en la misma semana
    expect(periods(new Date('2026-11-02T02:59:00Z')).week).toBe('2026-10-26');
    expect(periods(new Date('2026-11-02T03:00:00Z')).week).toBe('2026-11-02');
  });
});

describe('validación de cantidades', () => {
  it('sólo enteros positivos dentro del límite', () => {
    expect(positiveInt(5, 10)).toBe(5);
    for (const bad of [0, -1, 1.5, NaN, Infinity, 11, '5', 2 ** 60, null]) expect(positiveInt(bad, 10)).toBeNull();
  });
});

describe('elegibilidad de partidas oficiales', () => {
  const base = (over: Partial<MatchSummary> = {}): MatchSummary => ({
    id: 'm1', mode: 'heroes', startedAt: new Date(), endedAt: new Date(), matchTicks: 60 * 90,
    score: { red: 2, blue: 1 }, winner: 'red', kicks: { red: 10, blue: 8 }, finished: true,
    participants: [
      { userId: 'a', team: 'red', hero: 'spider', activeTicks: 60 * 80, present: true },
      { userId: 'b', team: 'blue', hero: 'hulk', activeTicks: 60 * 80, present: true },
    ],
    ...over,
  });
  const none = () => 0;

  it('partida válida: ambos elegibles y el ganador lo sabe', () => {
    const v = evaluateMatch(base(), none);
    expect(v.map((x) => x.eligible)).toEqual([true, true]);
    expect(v[0].won).toBe(true);
    expect(v[1].won).toBe(false);
    expect(v[0].opponents).toBe('b');
  });

  it('un personaje especial (Thanos) asignado por un administrador juega como cualquier héroe', () => {
    const m = base();
    m.participants[1].hero = 'thanos';
    const v = evaluateMatch(m, none);
    expect(v.map((x) => x.eligible)).toEqual([true, true]);
  });

  it('rechazos: sin terminar, corta, Súper, una sola cuenta, sin juego, AFK, abandono, rivales repetidos', () => {
    expect(evaluateMatch(base({ finished: false }), none)[0].eligible).toBe(false);
    expect(evaluateMatch(base({ matchTicks: 60 * 59 }), none)[0].eligible).toBe(false);
    expect(evaluateMatch(base({ mode: 'super' }), none)[0].eligible).toBe(false);
    const solo = base();
    solo.participants[1].team = 'red';
    expect(evaluateMatch(solo, none)[0].eligible).toBe(false);
    expect(evaluateMatch(base({ kicks: { red: 10, blue: 1 } }), none)[0].eligible).toBe(false);
    const afk = base();
    afk.participants[1].activeTicks = Math.floor(afk.matchTicks * 0.59);
    const va = evaluateMatch(afk, none);
    expect(va[0].eligible).toBe(true);
    expect(va[1].eligible).toBe(false);
    const gone = base();
    gone.participants[0].present = false;
    expect(evaluateMatch(gone, none)[0].eligible).toBe(false);
    const rep = evaluateMatch(base(), (u) => (u === 'a' ? ECONOMY.match.sameOpponentsDaily : 0));
    expect(rep[0].eligible).toBe(false);
    expect(rep[0].reason).toMatch(/mismos rivales/);
  });

  it('monedas: 40 + 20 por victoria, sin pasar el tope diario de 400', () => {
    expect(matchCoins(false, 0)).toBe(40);
    expect(matchCoins(true, 0)).toBe(60);
    expect(matchCoins(true, 380)).toBe(20);
    expect(matchCoins(true, 400)).toBe(0);
  });
});
