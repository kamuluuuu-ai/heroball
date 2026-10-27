import { describe, expect, it } from 'vitest';
import { BALL, HeroId, PLAYER, POWERS, R, SUPER_POWERS } from '../shared/config';
import { sanitizeSettings } from '../shared/protocol';
import { createGame, requestHero, setInput, step } from '../shared/game';
import { GameState, IN, Team } from '../shared/types';

type P = { id: string; team: Team; hero: HeroId };

function game(players: P[], mode: 'heroes' | 'super' = 'heroes'): GameState {
  const s = createGame({ mode, timeLimitMin: 3, scoreLimit: 3, players });
  s.phase = 'playing';
  return s;
}

function tick(s: GameState, bits: Record<string, number> = {}) {
  for (const [id, b] of Object.entries(bits)) setInput(s, id, b);
  s.events = [];
  step(s);
  return s.events;
}

function place(s: GameState, id: string, x: number, y: number) {
  const p = s.players.find((o) => o.id === id)!;
  p.d.x = x; p.d.y = y; p.d.vx = 0; p.d.vy = 0;
  return p;
}

function aim(s: GameState, id: string, ax: number, ay: number) {
  const p = s.players.find((o) => o.id === id)!;
  p.ax = ax; p.ay = ay;
}

describe('reglas comunes', () => {
  it('mantener Q no reactiva; el cooldown bloquea y luego libera', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'superman' }]);
    place(s, 'a', -200, 100);
    let activations = 0;
    for (let i = 0; i < 30; i++) activations += tick(s, { a: IN.Q }).filter((e) => e.type === 'power').length;
    expect(activations).toBe(1);
    const p = s.players[0];
    expect(p.cdQ).toBe(POWERS.superman.superShot.cooldown - 30);
    // soltar y apretar durante cooldown: nada
    tick(s, { a: 0 });
    expect(tick(s, { a: IN.Q }).some((e) => e.type === 'power')).toBe(false);
    for (let i = 0; i < POWERS.superman.superShot.cooldown; i++) tick(s, { a: 0 });
    expect(p.cdQ).toBe(0);
    expect(tick(s, { a: IN.Q }).some((e) => e.type === 'power')).toBe(true);
  });

  it('sin poderes en modo clásico, en el saque y en pausa', () => {
    const c = createGame({ mode: 'classic', timeLimitMin: 3, scoreLimit: 3, players: [{ id: 'a', team: 'red', hero: 'hulk' }] });
    c.phase = 'playing';
    expect(tick(c, { a: IN.E }).some((e) => e.type === 'power')).toBe(false);

    const k = createGame({ mode: 'heroes', timeLimitMin: 3, scoreLimit: 3, players: [{ id: 'a', team: 'red', hero: 'hulk' }] });
    expect(k.phase).toBe('kickoff');
    expect(tick(k, { a: IN.E }).some((e) => e.type === 'power')).toBe(false);

    const s = game([{ id: 'a', team: 'red', hero: 'hulk' }]);
    s.paused = true;
    tick(s, { a: IN.E });
    s.paused = false;
    // seguía apretado al reanudar: no hay flanco nuevo
    expect(tick(s, { a: IN.E }).some((e) => e.type === 'power')).toBe(false);
  });

  it('al aparecer apunta al arco rival', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'spider' }, { id: 'b', team: 'blue', hero: 'spider' }]);
    expect(s.players[0].ax).toBe(1);
    expect(s.players[1].ax).toBe(-1);
  });

  it('un gol limpia proyectiles y efectos, y el saque devuelve los poderes', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'batman' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
    place(s, 'a', -100, 150);
    place(s, 'b', 100, -150);
    tick(s, { a: IN.E, b: IN.E });
    tick(s, { a: IN.Q, b: 0 });
    expect(s.projectiles.length).toBe(2); // gancho + batarang
    expect(s.players[1].fury).toBeGreaterThan(0);
    s.ball.x = 360; s.ball.y = 0; s.ball.vx = 8;
    for (let i = 0; i < 5 && s.phase === 'playing'; i++) tick(s, { a: 0, b: 0 });
    expect(s.phase).toBe('goal');
    expect(s.projectiles.length).toBe(0);
    expect(s.tethers.length).toBe(0);
    expect(s.players[1].fury).toBe(0);
    for (let i = 0; i < 200 && s.phase !== 'kickoff'; i++) tick(s);
    expect(s.phase).toBe('kickoff');
    expect(s.players.every((p) => p.cdQ === 0 && p.cdE === 0)).toBe(true);
  });

  it('cambio de héroe en partido: se aplica en el próximo saque', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'spider' }]);
    requestHero(s, 'a', 'hulk');
    tick(s);
    expect(s.players[0].hero).toBe('spider');
    s.ball.x = 360; s.ball.vx = 8;
    for (let i = 0; i < 300 && s.phase !== 'kickoff'; i++) tick(s);
    expect(s.players[0].hero).toBe('hulk');
  });

  it('las ralentizaciones no se suman: prevalece la más fuerte', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'batman' }, { id: 'b', team: 'blue', hero: 'spider' }]);
    place(s, 'a', 0, 100);
    place(s, 'b', 40, 100);
    // ralentización previa más débil (25 %) que la del batarang (30 %)
    s.players[1].slowPct = 0.25;
    s.players[1].slowTicks = 200;
    aim(s, 'a', 1, 0);
    tick(s, { a: IN.Q }); // batarang al rival
    for (let i = 0; i < 4; i++) tick(s, { a: 0, b: IN.RIGHT });
    const b = s.players[1];
    expect(b.slowTicks).toBeGreaterThan(0);
    expect(b.slowNow).toBeCloseTo(POWERS.batman.batarang.slowPct, 5);
  });
});

describe('Spider-Man', () => {
  it('la telaraña atrae la pelota sin teletransportarla', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'spider' }]);
    place(s, 'a', -100, 0);
    s.ball.x = -100 + 6 * R;
    aim(s, 'a', 1, 0);
    tick(s, { a: IN.Q });
    let maxStep = 0;
    let prev = s.ball.x;
    let tethered = false;
    for (let i = 0; i < 40; i++) {
      tick(s, { a: 0 });
      tethered ||= s.tethers.length > 0;
      maxStep = Math.max(maxStep, Math.abs(s.ball.x - prev));
      prev = s.ball.x;
    }
    expect(tethered).toBe(true);
    expect(s.ball.x).toBeLessThan(-100 + 6 * R - 30);
    expect(maxStep).toBeLessThanOrEqual(POWERS.spider.web.pullMaxSpeed + 0.01);
  });

  it('la telaraña no llega más allá de 8R', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'spider' }]);
    place(s, 'a', -200, 0);
    s.ball.x = -200 + 10 * R;
    aim(s, 'a', 1, 0);
    tick(s, { a: IN.Q });
    for (let i = 0; i < 30; i++) tick(s, { a: 0 });
    expect(s.ball.vx).toBe(0);
    expect(s.projectiles.length).toBe(0);
  });

  it('la telaraña se corta con un poste en el medio', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'spider' }]);
    place(s, 'a', 300, 64);
    s.ball.x = 300 + 7 * R + 10; s.ball.y = 64; // detrás del poste (370,64)
    aim(s, 'a', 1, 0);
    tick(s, { a: IN.Q });
    for (let i = 0; i < 20; i++) tick(s, { a: 0 });
    expect(s.tethers.length).toBe(0);
    expect(s.ball.vx).toBe(0);
  });

  it('el impulso dura 0,25 s a ~2x y no atraviesa paredes', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'spider' }]);
    place(s, 'a', -380, 0);
    aim(s, 'a', -1, 0);
    tick(s, { a: IN.E });
    let maxV = 0;
    for (let i = 0; i < 15; i++) { tick(s, { a: 0 }); maxV = Math.max(maxV, Math.abs(s.players[0].d.vx)); }
    const terminal = (PLAYER.acceleration * PLAYER.damping) / (1 - PLAYER.damping);
    expect(maxV).toBeGreaterThan(terminal * 1.6);
    expect(maxV).toBeLessThan(terminal * 2.1);
    expect(s.players[0].d.x).toBeGreaterThanOrEqual(-420 + 15 - 1e-9);
    expect(s.players[0].dash).toBe(0);
  });
});

describe('autoapuntado de Q', () => {
  it('la telaraña apunta sola a la pelota aunque mires a otro lado', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'spider' }]);
    place(s, 'a', -100, 0);
    s.ball.x = -100 + 4 * R; s.ball.y = 4 * R; // diagonal abajo-derecha
    aim(s, 'a', -1, 0); // mirando hacia atrás
    tick(s, { a: IN.Q });
    let tethered = false;
    for (let i = 0; i < 20; i++) { tick(s, { a: 0 }); tethered ||= s.tethers.length > 0; }
    expect(tethered).toBe(true);
  });

  it('la telaraña anticipa una pelota en movimiento', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'spider' }]);
    place(s, 'a', -150, 0);
    s.ball.x = -150 + 5 * R; s.ball.y = -40; s.ball.vy = 2.5;
    aim(s, 'a', 1, 0);
    tick(s, { a: IN.Q });
    let tethered = false;
    for (let i = 0; i < 20; i++) { tick(s, { a: 0 }); tethered ||= s.tethers.length > 0; }
    expect(tethered).toBe(true);
  });

  it('sin pelota en alcance usa la dirección apuntada', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'spider' }]);
    place(s, 'a', -200, 100);
    aim(s, 'a', 0, -1);
    tick(s, { a: IN.Q });
    const pr = s.projectiles[0];
    expect(pr.vx).toBeCloseTo(0, 6);
    expect(pr.vy).toBeLessThan(0);
  });

  it('el batarang elige el objetivo más alineado (rival) y lo alcanza fuera de línea', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'batman' }, { id: 'b', team: 'blue', hero: 'spider' }]);
    place(s, 'a', 0, 120);
    place(s, 'b', 5 * R, 120 - 3 * R); // arriba a la derecha
    s.ball.x = -6 * R; s.ball.y = 120; // detrás: fuera del cono
    aim(s, 'a', 1, 0);
    tick(s, { a: IN.Q });
    for (let i = 0; i < 15; i++) tick(s, { a: 0 });
    expect(s.players.find((p) => p.id === 'b')!.slowPct).toBeCloseTo(0.3, 5);
    expect(s.ball.vx).toBe(0);
  });

  it('el batarang ignora objetivos detrás de un poste', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'batman' }]);
    place(s, 'a', 300, 64);
    s.ball.x = 300 + 7 * R + 10; s.ball.y = 64;
    aim(s, 'a', 0, -1);
    tick(s, { a: IN.Q });
    expect(s.projectiles[0].vy).toBeLessThan(0);
    expect(s.projectiles[0].vx).toBeCloseTo(0, 6);
  });
});

describe('Batman', () => {
  it('el batarang empuja la pelota con impulso moderado', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'batman' }]);
    place(s, 'a', -100, 0);
    s.ball.x = -100 + 6 * R;
    aim(s, 'a', 1, 0);
    tick(s, { a: IN.Q });
    for (let i = 0; i < 15; i++) tick(s, { a: 0 });
    expect(s.ball.vx).toBeGreaterThan(1);
    expect(s.ball.vx).toBeLessThan(POWERS.batman.batarang.ballImpulse + 0.01);
  });

  it('el batarang frena a un rival 30 % y atraviesa aliados', () => {
    const s = game([
      { id: 'a', team: 'red', hero: 'batman' },
      { id: 'm', team: 'red', hero: 'hulk' },
      { id: 'b', team: 'blue', hero: 'spider' },
    ]);
    place(s, 'a', -100, 120);
    place(s, 'm', -60, 120);
    place(s, 'b', 0, 120);
    aim(s, 'a', 1, 0);
    tick(s, { a: IN.Q });
    for (let i = 0; i < 12; i++) tick(s, { a: 0 });
    const b = s.players.find((p) => p.id === 'b')!;
    const m = s.players.find((p) => p.id === 'm')!;
    expect(b.slowPct).toBeCloseTo(0.3, 5);
    expect(m.slowPct).toBe(0);
    expect(s.projectiles.length).toBe(0);
  });

  it('el gancho lleva a Batman hasta la pelota (y atraviesa jugadores)', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'batman' }, { id: 'b', team: 'blue', hero: 'spider' }]);
    place(s, 'a', -120, 40);
    place(s, 'b', -60, 40); // en medio del camino
    aim(s, 'a', 0, -1); // apunta hacia otro lado: el gancho busca la pelota igual
    s.ball.x = 0; s.ball.y = 40;
    tick(s, { a: IN.E });
    expect(s.projectiles[0].kind).toBe('hook');
    expect(s.projectiles[0].vx).toBeGreaterThan(0.99 * POWERS.batman.grapple.speed);
    let hooked = false;
    let minGap = Infinity;
    const a = s.players[0];
    for (let i = 0; i < 90; i++) {
      tick(s, { a: 0, b: 0 });
      // el gancho pasó a través del rival; después lo apartamos (los cuerpos sí chocan)
      if (!hooked && s.tethers.some((t) => t.kind === 'grapple')) place(s, 'b', -60, -150);
      hooked ||= s.tethers.some((t) => t.kind === 'grapple');
      minGap = Math.min(minGap, Math.hypot(a.d.x - s.ball.x, a.d.y - s.ball.y) - a.d.r - s.ball.r);
    }
    expect(hooked).toBe(true);
    expect(minGap).toBeLessThan(3);
    expect(a.cdE).toBeGreaterThan(0);
  });

  it('el gancho falla si la pelota está fuera de alcance', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'batman' }]);
    place(s, 'a', -300, 0);
    s.ball.x = 200; s.ball.y = 0;
    tick(s, { a: IN.E });
    for (let i = 0; i < 60; i++) {
      tick(s, { a: 0 });
      expect(s.tethers.length).toBe(0);
    }
    expect(s.players[0].d.x).toBeLessThan(-290);
  });

  it('el gancho se corta si un poste se interpone', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'batman' }]);
    place(s, 'a', 330, 64 + 40);
    s.ball.x = 300; s.ball.y = 64 - 20;
    tick(s, { a: IN.E });
    for (let i = 0; i < 10; i++) tick(s, { a: 0 });
    s.ball.x = 400; s.ball.y = 20; // la pelota queda detrás del poste
    s.ball.vx = 0; s.ball.vy = 0;
    tick(s, { a: 0 });
    tick(s, { a: 0 });
    expect(s.tethers.length).toBe(0);
  });
});

describe('Hulk', () => {
  it('el golpe empuja pelota y rivales con fuerza decreciente, no aliados', () => {
    const s = game([
      { id: 'h', team: 'red', hero: 'hulk' },
      { id: 'm', team: 'red', hero: 'spider' },
      { id: 'n', team: 'blue', hero: 'spider' },
      { id: 'f', team: 'blue', hero: 'spider' },
    ]);
    place(s, 'h', 0, 100);
    place(s, 'm', -35, 100);
    place(s, 'n', 35, 100);
    place(s, 'f', 0, 100 - 2 * R - 50);
    s.ball.x = 0; s.ball.y = 100 + 30;
    tick(s, { h: IN.Q });
    const n = s.players.find((p) => p.id === 'n')!;
    const f = s.players.find((p) => p.id === 'f')!;
    const m = s.players.find((p) => p.id === 'm')!;
    expect(s.ball.vy).toBeGreaterThan(3);
    expect(n.d.vx).toBeGreaterThan(Math.abs(f.d.vy));
    expect(Math.abs(f.d.vy)).toBeGreaterThan(0);
    expect(m.d.vx).toBeGreaterThan(-0.5);
  });

  it('la furia aumenta masa y patada, reduce aceleración, sin cambiar el radio', () => {
    const s = game([{ id: 'h', team: 'red', hero: 'hulk' }]);
    const p = place(s, 'h', -200, 100);
    tick(s, { h: IN.E });
    expect(p.fury).toBeGreaterThan(0);
    expect(p.d.r).toBe(PLAYER.radius);
    expect(p.d.invMass).toBeCloseTo(PLAYER.invMass / POWERS.hulk.fury.massMult, 6);
    // patada potenciada
    place(s, 'h', -200, 0);
    s.ball.x = -200 + 26; s.ball.y = 0;
    tick(s, { h: IN.KICK });
    expect(s.ball.vx).toBeCloseTo(PLAYER.kickStrength * 1.35 * BALL.damping, 3);
  });
});

describe('Superman', () => {
  it('el súper disparo potencia sólo la siguiente patada y vence a los 2 s', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'superman' }]);
    place(s, 'a', -200, 0);
    tick(s, { a: IN.Q });
    s.ball.x = -200 + 26; s.ball.y = 0;
    tick(s, { a: IN.KICK });
    expect(s.ball.vx).toBeCloseTo(PLAYER.kickStrength * 1.5 * BALL.damping, 3);
    expect(s.players[0].superShot).toBe(0);

    const s2 = game([{ id: 'a', team: 'red', hero: 'superman' }]);
    place(s2, 'a', -200, 0);
    tick(s2, { a: IN.Q });
    for (let i = 0; i < 125; i++) tick(s2, { a: 0 });
    s2.ball.x = -200 + 26; s2.ball.y = 0; s2.ball.vx = 0;
    place(s2, 'a', -200, 0);
    tick(s2, { a: IN.KICK });
    expect(s2.ball.vx).toBeCloseTo(PLAYER.kickStrength * BALL.damping, 3);
  });

  it('la súper velocidad sube 40 % la velocidad máxima', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'superman' }]);
    place(s, 'a', -400, 150);
    for (let i = 0; i < 150; i++) tick(s, { a: IN.RIGHT });
    const normal = s.players[0].d.vx;
    place(s, 'a', -400, 150);
    for (let i = 0; i < 55; i++) tick(s, { a: IN.RIGHT });
    tick(s, { a: IN.RIGHT | IN.E });
    let maxV = 0;
    for (let i = 0; i < 70; i++) { tick(s, { a: IN.RIGHT }); maxV = Math.max(maxV, s.players[0].d.vx); }
    expect(maxV / normal).toBeGreaterThan(1.3);
    expect(maxV / normal).toBeLessThan(1.45);
  });
});

describe('modo Súper', () => {
  it('el protocolo acepta el modo y usa sus recargas', () => {
    expect(sanitizeSettings({ mode: 'super' })).toEqual({ mode: 'super' });
    const s = game([{ id: 'a', team: 'red', hero: 'spider' }], 'super');
    tick(s, { a: IN.Q });
    expect(s.players[0].cdQ).toBe(SUPER_POWERS.spider.web.cooldown - 1);
    expect(SUPER_POWERS.spider.web.cooldown).toBeLessThan(POWERS.spider.web.cooldown);
  });

  it('la telaraña agarra la pelota desde la otra punta de la cancha', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'spider' }], 'super');
    place(s, 'a', -340, -120);
    aim(s, 'a', 1, 0);
    s.ball.x = 330; s.ball.y = 140;
    const d0 = Math.hypot(330 + 340, 140 + 120);
    tick(s, { a: IN.Q });
    let tethered = false;
    for (let i = 0; i < 90; i++) {
      tick(s, { a: 0 });
      tethered ||= s.tethers.some((t) => t.kind === 'web');
    }
    expect(tethered).toBe(true);
    const p = s.players[0];
    expect(Math.hypot(p.d.x - s.ball.x, p.d.y - s.ball.y)).toBeLessThan(d0 * 0.6);
    // en Héroes, la misma situación no alcanza
    const h = game([{ id: 'a', team: 'red', hero: 'spider' }]);
    place(h, 'a', -340, -120);
    aim(h, 'a', 1, 0);
    h.ball.x = 330; h.ball.y = 140;
    tick(h, { a: IN.Q });
    for (let i = 0; i < 90; i++) {
      tick(h, { a: 0 });
      expect(h.tethers.length).toBe(0);
    }
  });

  it('la telaraña atrapa a un rival y lo arrastra hacia Spider-Man', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'spider' }, { id: 'b', team: 'blue', hero: 'hulk' }], 'super');
    place(s, 'a', -150, 0);
    const b = place(s, 'b', 0, 0);
    aim(s, 'a', 1, 0);
    s.ball.x = 0; s.ball.y = 160; // fuera de la línea apuntada
    tick(s, { a: IN.Q });
    let grabbed = false;
    for (let i = 0; i < 12; i++) {
      tick(s, { a: 0, b: 0 });
      grabbed ||= s.tethers.some((t) => t.kind === 'rival' && t.target === 'b');
    }
    expect(grabbed).toBe(true);
    expect(b.d.vx).toBeLessThan(-2);
    expect(b.d.x).toBeLessThan(-10);
  });

  it('en Héroes la telaraña no atrapa rivales: se corta', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'spider' }, { id: 'b', team: 'blue', hero: 'hulk' }]);
    place(s, 'a', -100, 0);
    place(s, 'b', 0, 0);
    aim(s, 'a', 1, 0);
    s.ball.x = 0; s.ball.y = 160;
    tick(s, { a: IN.Q });
    for (let i = 0; i < 20; i++) tick(s, { a: 0, b: 0 });
    expect(s.tethers.length).toBe(0);
  });

  it('triple batarang en abanico que frena 50 %', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'batman' }, { id: 'b', team: 'blue', hero: 'spider' }], 'super');
    place(s, 'a', -100, 0);
    place(s, 'b', 0, 0);
    aim(s, 'a', 1, 0);
    s.ball.x = 0; s.ball.y = 170;
    tick(s, { a: IN.Q });
    expect(s.projectiles.filter((p) => p.kind === 'batarang').length).toBe(3);
    const ys = s.projectiles.map((p) => p.vy).sort((x, y) => x - y);
    expect(ys[0]).toBeLessThan(0);
    expect(ys[2]).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) tick(s, { a: 0, b: 0 });
    expect(s.players[1].slowPct).toBeCloseTo(SUPER_POWERS.batman.batarang.slowPct, 5);
  });

  it('el súper gancho alcanza la pelota lejos y al llegar la empuja', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'batman' }], 'super');
    place(s, 'a', -300, 0);
    s.ball.x = 100; s.ball.y = 0;
    tick(s, { a: IN.E });
    let maxBall = 0;
    let hooked = false;
    for (let i = 0; i < 120; i++) {
      tick(s, { a: 0 });
      hooked ||= s.tethers.length > 0;
      maxBall = Math.max(maxBall, s.ball.vx);
    }
    expect(hooked).toBe(true);
    expect(maxBall).toBeGreaterThan(SUPER_POWERS.batman.grapple.arriveImpulse);
  });

  it('el terremoto de Hulk aturde a los rivales y empuja más que en Héroes', () => {
    const push = (mode: 'heroes' | 'super') => {
      const s = game([{ id: 'h', team: 'red', hero: 'hulk' }, { id: 'n', team: 'blue', hero: 'spider' }], mode);
      place(s, 'h', 0, 0);
      place(s, 'n', 45, 0);
      s.ball.x = 0; s.ball.y = 150;
      tick(s, { h: IN.Q });
      return s.players[1];
    };
    const hn = push('heroes');
    const sn = push('super');
    expect(sn.d.vx).toBeGreaterThan(hn.d.vx);
    expect(hn.slowPct).toBe(0);
    expect(sn.slowPct).toBeCloseTo(SUPER_POWERS.hulk.slam.stunPct, 5);
  });

  it('el disparo de acero de Superman patea ×2,2', () => {
    const kick = (mode: 'heroes' | 'super') => {
      const s = game([{ id: 'a', team: 'red', hero: 'superman' }], mode);
      place(s, 'a', -100, 0);
      s.ball.x = -100 + PLAYER.radius + BALL.radius + 1; s.ball.y = 0;
      tick(s, { a: IN.Q });
      tick(s, { a: IN.KICK });
      return s.ball.vx;
    };
    expect(kick('super') / kick('heroes')).toBeCloseTo(SUPER_POWERS.superman.superShot.kickMult / POWERS.superman.superShot.kickMult, 1);
  });
});
