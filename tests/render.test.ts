// Humo del renderer: dibuja estados con todos los efectos de los personajes
// nuevos sobre un canvas simulado (sin navegador) para detectar errores en las
// rutas de dibujo que una partida real recorre pocas veces.
import { beforeAll, describe, expect, it } from 'vitest';
import { HERO_IDS } from '../shared/config';
import { createGame, setInput, step } from '../shared/game';
import { IN, IN_NUM_SHIFT, type GameState } from '../shared/types';

/** Contexto 2D que acepta cualquier llamada y cuenta las de dibujo. */
function fakeCtx() {
  let calls = 0;
  const grad = { addColorStop() {} };
  const target: Record<string, unknown> = {};
  return {
    calls: () => calls,
    ctx: new Proxy(target, {
      get(t, k) {
        if (k in t) return t[k as string];
        if (k === 'createPattern') return () => ({});
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
        if (k === 'measureText') return () => ({ width: 10 });
        if (k === 'getLineDash') return () => [];
        return () => { calls++; };
      },
      set(t, k, v) { t[k as string] = v; return true; },
    }),
  };
}

function fakeCanvas(c: unknown) {
  return { width: 800, height: 450, clientWidth: 800, clientHeight: 450, getContext: () => c };
}

let Renderer: typeof import('../client/src/game/renderer').Renderer;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
  g.document ??= { createElement: () => fakeCanvas(fakeCtx().ctx) };
  g.Image ??= class { onload: (() => void) | null = null; onerror: (() => void) | null = null; src = ''; complete = false; naturalWidth = 0; };
  ({ Renderer } = await import('../client/src/game/renderer'));
});

const num = (n: number) => n << IN_NUM_SHIFT;

function busyGame(mode: 'heroes' | 'super'): GameState {
  const s = createGame({
    mode, timeLimitMin: 3, scoreLimit: 3, players: [
      { id: 'me', team: 'red', hero: 'baldi' }, { id: 'b', team: 'blue', hero: 'thanos' },
      { id: 'c', team: 'red', hero: 'homer' }, { id: 'd', team: 'blue', hero: 'verity' },
      { id: 'e', team: 'red', hero: 'cj' }, { id: 'f', team: 'blue', hero: 'ibai' },
    ],
  });
  s.phase = 'playing';
  // todos juntos cerca del centro para que los poderes encuentren objetivo
  s.players.forEach((p, i) => { p.d.x = (p.team === 'red' ? -40 : 40) + (i % 2) * 6; p.d.y = (i - 2.5) * 34; p.ax = p.team === 'red' ? 1 : -1; p.ay = 0; });
  return s;
}

describe('renderer con los personajes nuevos', () => {
  for (const mode of ['heroes', 'super'] as const) {
    it(`dibuja todos los efectos sin errores (${mode})`, () => {
      const s = busyGame(mode);
      const { ctx, calls } = fakeCtx();
      const r = new Renderer(fakeCanvas(ctx) as unknown as HTMLCanvasElement);
      const names = new Map(s.players.map((p) => [p.id, p.id]));
      const opts = { names, zoom: 1, showNames: true, debug: false, reducedFx: false };
      const seq = [IN.Q, 0, IN.E, 0, num(1), IN.Q, 0, num(2), IN.Q, 0, num(3), IN.Q, 0, num(4), IN.Q, 0, num(5), IN.Q, IN.KICK, 0];
      const seen = new Set<string>();
      for (let i = 0; i < 400; i++) {
        for (const p of s.players) setInput(s, p.id, seq[(i + p.id.charCodeAt(0)) % seq.length]);
        s.events = [];
        step(s);
        for (const z of s.zones) seen.add(z.kind);
        for (const pr of s.projectiles) seen.add(pr.kind);
        if (s.illusion) seen.add('illusion');
        if (s.players.some((p) => p.quiz)) seen.add('quizOpen');
        r.addEvents(s.events, s, names);
        r.draw(s, i % 2 ? 'me' : 'b', { ...opts, reducedFx: i % 3 === 0 });
      }
      expect(calls()).toBeGreaterThan(1000);
      // se recorrieron las rutas nuevas
      for (const k of ['donut', 'bullet', 'beer', 'tnt', 'quiz']) expect(seen.has(k)).toBe(true);
    });
  }

  it('cada héroe se dibuja (con retrato o su reemplazo)', () => {
    const { ctx } = fakeCtx();
    const r = new Renderer(fakeCanvas(ctx) as unknown as HTMLCanvasElement);
    const s = createGame({ mode: 'heroes', timeLimitMin: 3, scoreLimit: 3, players: HERO_IDS.map((h, i) => ({ id: `p${i}`, team: i % 2 ? 'blue' : 'red', hero: h })) });
    s.players.forEach((p) => { p.anger = 10; p.jet = 10; p.trap = 5; p.mind = 5; p.slip = 1; p.powerKick = 10; });
    s.ballDonut = 30;
    expect(() => r.draw(s, 'p0', { names: new Map(), zoom: 1.3, showNames: true, debug: true, reducedFx: false })).not.toThrow();
  });
});
