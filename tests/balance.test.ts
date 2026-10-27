// Balance aproximado: cada héroe desbloqueable contra los cuatro iniciales
// con bots idénticos (misma habilidad), alternando lados y semillas. No mide
// el juego humano; detecta héroes claramente dominantes o inútiles.
import { describe, expect, it } from 'vitest';
import { botInput, makeBrain } from '../shared/bot';
import { HERO_IDS, HeroId, STARTER_IDS } from '../shared/config';
import { createGame, setInput, step } from '../shared/game';

function match(red: HeroId, blue: HeroId, seed: number): { red: number; blue: number } {
  const s = createGame({ mode: 'heroes', timeLimitMin: 2, scoreLimit: 0, players: [{ id: 'r', team: 'red', hero: red }, { id: 'b', team: 'blue', hero: blue }] });
  let x = seed;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const brains = [makeBrain('r', 0.75), makeBrain('b', 0.75)];
  for (let i = 0; i < 60 * 60 * 3 && s.phase !== 'ended'; i++) {
    for (const b of brains) setInput(s, b.id, botInput(s, b, rnd));
    s.events = [];
    step(s);
  }
  return s.score;
}

describe('balance con bots (1 contra 1, Héroes)', () => {
  it('ningún héroe nuevo gana más del 70 % de los goles contra los iniciales', () => {
    const rows: string[] = [];
    for (const h of HERO_IDS.filter((id) => !STARTER_IDS.includes(id))) {
      let mine = 0;
      let theirs = 0;
      for (const st of STARTER_IDS) {
        for (const seed of [3, 17]) {
          const a = match(h, st, seed);
          const b = match(st, h, seed + 1000);
          mine += a.red + b.blue;
          theirs += a.blue + b.red;
        }
      }
      const share = mine / Math.max(1, mine + theirs);
      rows.push(`${h.padEnd(8)} goles ${String(mine).padStart(3)} - ${String(theirs).padStart(3)}  (${Math.round(share * 100)} %)`);
      expect(share, h).toBeLessThan(0.7);
      expect(share, h).toBeGreaterThan(0.3);
    }
    console.log(rows.join('\n'));
  }, 120_000);
});
