// Contacto y patada con la pelota: límites exactos, casos extremos y red.
import { describe, expect, it } from 'vitest';
import { LocalSession } from '../client/src/game/sessions';
import { BALL, KICK, LIMITS, PLAYER, STADIUM, TICK_MS } from '../shared/config';
import { createGame, setInput, step } from '../shared/game';
import { collideDiscs, makeDisc } from '../shared/physics';
import { GameState, IN } from '../shared/types';
import { edgeGap, netSim } from './netsim';

const RR = PLAYER.radius + BALL.radius;

function game(n = 1): GameState {
  const players: { id: string; team: 'red' | 'blue'; hero: 'spider' }[] = [{ id: 'a', team: 'red', hero: 'spider' }];
  if (n > 1) players.push({ id: 'b', team: 'blue', hero: 'spider' });
  const s = createGame({ mode: 'classic', timeLimitMin: 0, scoreLimit: 0, players });
  s.phase = 'playing';
  if (n === 1) s.players[0].d.x = -200;
  return s;
}

function put(s: GameState, id: string, x: number, y: number) {
  const p = s.players.find((o) => o.id === id)!;
  p.d.x = x; p.d.y = y; p.d.vx = 0; p.d.vy = 0;
  return p;
}

function tick(s: GameState, bits: Record<string, number>) {
  for (const [id, b] of Object.entries(bits)) setInput(s, id, b);
  s.events = [];
  step(s);
  return s.events;
}

describe('radios y límites de contacto', () => {
  it('una sola configuración: radios físicos de jugador y pelota', () => {
    expect(PLAYER.radius).toBe(15);
    expect(BALL.radius).toBe(10);
    expect(KICK.range).toBe(4);
  });

  it('justo fuera del contacto no hay choque; justo dentro sí', () => {
    const p = makeDisc(0, 0, 'player');
    const out = makeDisc(RR + 0.01, 0, 'ball');
    expect(collideDiscs(p, out)).toBe(false);
    const inside = makeDisc(RR - 0.01, 0, 'ball');
    expect(collideDiscs(p, inside)).toBe(true);
    expect(Math.hypot(inside.x - p.x, inside.y - p.y)).toBeCloseTo(RR, 9);
  });

  it('el choque empuja por la línea de centros (frontal, diagonal y tangencial)', () => {
    for (const ang of [0, Math.PI / 4, 1.2]) {
      const p = makeDisc(0, 0, 'player');
      p.vx = 2; // se mueve en +x
      const b = makeDisc(Math.cos(ang) * (RR - 0.5), Math.sin(ang) * (RR - 0.5), 'ball');
      collideDiscs(p, b);
      const len = Math.hypot(b.vx, b.vy);
      expect(len).toBeGreaterThan(0);
      expect(Math.atan2(b.vy, b.vx)).toBeCloseTo(ang, 6);
    }
  });

  it('patada: justo dentro del alcance patea, justo fuera no', () => {
    for (const [extra, expected] of [[KICK.range - 0.01, true], [KICK.range + 0.01, false]] as const) {
      const s = game();
      put(s, 'a', 0, 0);
      s.ball.x = RR + extra; s.ball.y = 0;
      const ev = tick(s, { a: IN.KICK });
      expect(ev.some((e) => e.type === 'kick')).toBe(expected);
    }
  });

  it('empujar sin patear mueve la pelota sin evento de patada', () => {
    const s = game();
    put(s, 'a', 0, 0);
    s.ball.x = RR + 3; s.ball.y = 0;
    let kicked = false;
    for (let i = 0; i < 30; i++) kicked ||= tick(s, { a: IN.RIGHT }).some((e) => e.type === 'kick');
    expect(kicked).toBe(false);
    expect(s.ball.vx).toBeGreaterThan(0.5);
  });

  it('patear detenido y en movimiento: la dirección es la línea de centros', () => {
    const s = game();
    put(s, 'a', 0, 0);
    s.ball.x = RR + 1; s.ball.y = 6;
    tick(s, { a: IN.KICK });
    expect(Math.atan2(s.ball.vy, s.ball.vx)).toBeCloseTo(Math.atan2(6, RR + 1), 1);
    const m = game();
    const p = put(m, 'a', 0, 0);
    p.d.vx = 2.4;
    m.ball.x = RR + 3; m.ball.y = 0;
    tick(m, { a: IN.RIGHT | IN.KICK });
    expect(m.ball.vx).toBeGreaterThan(PLAYER.kickStrength * 0.9);
  });

  it('mantener patada: arma una vez y patea al llegar a la pelota, sin repetir', () => {
    const s = game();
    put(s, 'a', 0, 0);
    s.ball.x = 80; s.ball.y = 0;
    let kicks = 0;
    for (let i = 0; i < 120; i++) kicks += tick(s, { a: IN.RIGHT | IN.KICK }).filter((e) => e.type === 'kick').length;
    expect(kicks).toBe(1);
  });

  it('centros coincidentes: se separan en un tick, sin NaN', () => {
    const s = game();
    put(s, 'a', 30, 40);
    s.ball.x = 30; s.ball.y = 40; s.ball.vx = 0; s.ball.vy = 0;
    tick(s, { a: 0 });
    const p = s.players[0];
    expect(Number.isFinite(s.ball.x) && Number.isFinite(p.d.x)).toBe(true);
    expect(edgeGap(p.d, s.ball)).toBeGreaterThan(-1e-6);
    // y dos jugadores superpuestos exactamente
    const t = game(2);
    put(t, 'a', 0, 100); put(t, 'b', 0, 100);
    tick(t, { a: 0, b: 0 });
    expect(edgeGap(t.players[0].d, t.players[1].d)).toBeGreaterThan(-1e-6);
  });

  it('pelota a velocidad máxima contra un jugador quieto: no lo atraviesa', () => {
    for (const v of [LIMITS.ballMaxSpeed, LIMITS.ballMaxSpeed * 0.7]) {
      const s = game();
      put(s, 'a', 0, 0);
      s.ball.x = -60; s.ball.y = 0; s.ball.vx = v; s.ball.vy = 0;
      for (let i = 0; i < 10; i++) tick(s, { a: 0 });
      expect(s.ball.x).toBeLessThan(0);
    }
  });

  it('pelota entre jugador y pared: sin solapamiento apreciable ni salida del campo', () => {
    const s = game();
    const p = put(s, 'a', 0, -STADIUM.fieldH + BALL.radius + 26);
    s.ball.x = 0; s.ball.y = -STADIUM.fieldH + BALL.radius + 1;
    let worst = 0;
    for (let i = 0; i < 180; i++) {
      tick(s, { a: IN.UP });
      worst = Math.min(worst, edgeGap(p.d, s.ball));
      expect(s.ball.y).toBeGreaterThanOrEqual(-STADIUM.fieldH + BALL.radius - 0.2);
    }
    expect(worst).toBeGreaterThan(-0.16);
  });

  it('dos jugadores disputando la pelota: sin solapamiento apreciable', () => {
    const s = game(2);
    put(s, 'a', -RR - 1, 0); put(s, 'b', RR + 1, 0);
    s.ball.x = 0; s.ball.y = 0;
    let worst = 0;
    for (let i = 0; i < 180; i++) {
      tick(s, { a: IN.RIGHT, b: IN.LEFT });
      worst = Math.min(worst, edgeGap(s.players[0].d, s.ball), edgeGap(s.players[1].d, s.ball));
    }
    expect(worst).toBeGreaterThan(-0.12);
  });
});

describe('simulación fija con distintas tasas de dibujo', () => {
  it('30, 60 y 144 fps producen exactamente el mismo partido', () => {
    // las entradas se mantienen fijas en tramos de 0,5 s (múltiplos de los tres
    // intervalos de fotograma), así cada tasa entrega los mismos bits por tick
    const plan = [IN.RIGHT, IN.RIGHT | IN.DOWN, IN.RIGHT | IN.KICK, IN.UP, 0, IN.LEFT | IN.KICK];
    const run = (fps: number) => {
      const ls = new LocalSession({ kind: 'training', mode: 'classic', hero: 'spider', teamSize: 1, botSkill: 0.5, timeLimitMin: 0, scoreLimit: 0 });
      for (const bits of plan) {
        const frames = fps / 2;
        for (let f = 0; f < frames; f++) ls.update(500 / frames, bits);
      }
      return ls.state;
    };
    const ref = run(60);
    for (const fps of [30, 144]) {
      const s = run(fps);
      expect(Math.abs(s.tick - ref.tick)).toBeLessThanOrEqual(1);
      expect(s.tick).toBe(ref.tick);
      {
        expect(s.players[0].d).toEqual(ref.players[0].d);
        expect(s.ball).toEqual(ref.ball);
      }
    }
  });
});

describe('dos clientes con latencia (50, 100 y 150 ms)', () => {
  for (const ms of [50, 100, 150]) {
    it(`${ms} ms: lo que se ve en contacto coincide con lo que choca (≤ 2 px)`, () => {
      const lag = Math.round(ms / TICK_MS);
      const sim = netSim({ lagTicks: { a: lag, b: lag }, teams: { a: 'red', b: 'blue' } });
      let worst = 0;
      let samples = 0;
      let t = 0;
      sim.advance(8000, (c) => {
        t++;
        const v = c.view;
        const s = c.session as unknown as { predicted: GameState | null; predPrev: Map<string, { x: number; y: number }>; acc: number };
        if (!v || !s.predicted) return;
        const me = v.players.find((p) => p.id === c.id)!;
        let bits = 0;
        if (v.ball.x - me.d.x > 2) bits |= IN.RIGHT; else if (v.ball.x - me.d.x < -2) bits |= IN.LEFT;
        if (v.ball.y - me.d.y > 2) bits |= IN.DOWN; else if (v.ball.y - me.d.y < -2) bits |= IN.UP;
        if ((t >> 5) % 3 === 0) bits ^= IN.UP;
        const vg = edgeGap(me.d, v.ball);
        if (vg < 1.5 && !(c.bits & IN.KICK)) bits |= IN.KICK;
        c.bits = bits;
        const k = s.acc / TICK_MS;
        const at = (id: string, d: { x: number; y: number; r: number }) => {
          const a = s.predPrev.get(id);
          return a ? { x: a.x + (d.x - a.x) * k, y: a.y + (d.y - a.y) * k, r: d.r } : d;
        };
        const pm = s.predicted.players.find((p) => p.id === c.id)!;
        const pg = edgeGap(at(c.id, pm.d), at('ball', s.predicted.ball));
        if (pg < 6) {
          samples++;
          worst = Math.max(worst, Math.abs(vg - pg));
        }
      });
      expect(samples).toBeGreaterThan(10);
      expect(worst).toBeLessThan(2);
    });

    it(`${ms} ms: un jugador solo ve confirmadas por el servidor todas sus patadas predichas`, () => {
      const lag = Math.round(ms / TICK_MS);
      const sim = netSim({ lagTicks: { a: lag }, teams: { a: 'red' } });
      let server = 0;
      let predicted = 0;
      const t0 = sim.room.tick.bind(sim.room);
      sim.room.tick = () => { t0(); server += (sim.room.game?.events ?? []).filter((e) => e.type === 'kick').length; };
      sim.client('a').session.onEvents = (ev) => { predicted += ev.filter((e) => e.type === 'kick').length; };
      let t = 0;
      sim.advance(8000, (c) => {
        t++;
        const v = c.view;
        if (!v) return;
        const me = v.players.find((p) => p.id === 'a')!;
        let bits = v.ball.x > me.d.x ? IN.RIGHT : IN.LEFT;
        bits |= v.ball.y > me.d.y + 2 ? IN.DOWN : v.ball.y < me.d.y - 2 ? IN.UP : 0;
        if (edgeGap(me.d, v.ball) < 2 && !(c.bits & IN.KICK) && t % 3 === 0) bits |= IN.KICK;
        c.bits = bits;
      });
      sim.advance(500); // que lleguen las últimas confirmaciones
      expect(predicted).toBeGreaterThan(2);
      expect(server).toBe(predicted);
    });
  }
});
