import { describe, expect, it } from 'vitest';
import { botInput, makeBrain } from '../shared/bot';
import { createGame, setInput, step } from '../shared/game';
import { HERO_IDS } from '../shared/config';
import { IN } from '../shared/types';

describe('estabilidad con bots', () => {
  it.each(['heroes', 'super'] as const)('3v3 en modo %s durante un partido completo: sin NaN ni explosiones, termina', (mode) => {
    const ids = ['r0', 'r1', 'r2', 'b0', 'b1', 'b2'];
    const s = createGame({
      mode, timeLimitMin: 3, scoreLimit: 0,
      players: ids.map((id, i) => ({ id, team: id[0] === 'r' ? 'red' : 'blue', hero: HERO_IDS[i % 4] })),
    });
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const brains = ids.map((id) => makeBrain(id, 0.8));
    let powers = 0;
    let kicks = 0;
    for (let i = 0; i < 60 * 60 * 5 && s.phase !== 'ended'; i++) {
      for (const b of brains) setInput(s, b.id, botInput(s, b, rnd));
      s.events = [];
      step(s);
      powers += s.events.filter((e) => e.type === 'power').length;
      kicks += s.events.filter((e) => e.type === 'kick').length;
      for (const d of [s.ball, ...s.players.map((p) => p.d)]) {
        expect(Number.isFinite(d.x) && Number.isFinite(d.y)).toBe(true);
        expect(Math.abs(d.x)).toBeLessThanOrEqual(430);
        expect(Math.abs(d.y)).toBeLessThanOrEqual(210);
      }
    }
    expect(kicks).toBeGreaterThan(20);
    expect(powers).toBeGreaterThan(10);
    // tras 3 min: o terminó o está en gol de oro
    expect(s.phase === 'ended' || s.overtime).toBe(true);
  });

  it('los bots sólo producen bits de entrada válidos', () => {
    const s = createGame({ mode: 'heroes', timeLimitMin: 1, scoreLimit: 1, players: [{ id: 'x', team: 'red', hero: 'hulk' }] });
    const b = makeBrain('x');
    for (let i = 0; i < 500; i++) {
      const bits = botInput(s, b);
      expect(bits & ~1023).toBe(0);
      expect((bits & IN.LEFT) && (bits & IN.RIGHT)).toBeFalsy();
      setInput(s, 'x', bits);
      step(s);
    }
  });
});
