import { describe, expect, it } from 'vitest';
import { KICK, LIMITS, PLAYER, STADIUM } from '../shared/config';
import { createGame, step, setInput } from '../shared/game';
import { collideDiscs, makeDisc, stepWorld, stadium } from '../shared/physics';
import { GameState, IN } from '../shared/types';

function game(mode: 'classic' | 'heroes' = 'classic', players: { id: string; team: 'red' | 'blue'; hero: 'spider' }[] = [{ id: 'a', team: 'red', hero: 'spider' }]): GameState {
  return createGame({ mode, timeLimitMin: 3, scoreLimit: 3, players });
}

function run(s: GameState, n: number, bits?: Record<string, number>) {
  for (let i = 0; i < n; i++) {
    if (bits) for (const [id, b] of Object.entries(bits)) setInput(s, id, b);
    s.events = [];
    step(s);
  }
}

describe('movimiento', () => {
  it('acelera hasta la velocidad terminal y frena al soltar', () => {
    const s = game();
    const p = s.players[0].d;
    s.phase = 'playing';
    p.x = -400;
    p.y = 150;
    run(s, 180, { a: IN.RIGHT });
    const terminal = (PLAYER.acceleration * PLAYER.damping) / (1 - PLAYER.damping);
    expect(p.vx).toBeCloseTo(terminal, 2);
    run(s, 200, { a: 0 });
    expect(Math.abs(p.vx)).toBeLessThan(0.01);
  });

  it('las diagonales no dan ventaja de velocidad', () => {
    const s1 = game();
    run(s1, 150, { a: IN.UP });
    const s2 = game();
    run(s2, 150, { a: IN.UP | IN.LEFT });
    const v1 = Math.hypot(s1.players[0].d.vx, s1.players[0].d.vy);
    const v2 = Math.hypot(s2.players[0].d.vx, s2.players[0].d.vy);
    expect(v2).toBeCloseTo(v1, 5);
  });

  it('mantener patada usa aceleración reducida', () => {
    const s = game();
    run(s, 300, { a: IN.RIGHT | IN.KICK });
    const terminalK = (PLAYER.kickingAcceleration * PLAYER.kickingDamping) / (1 - PLAYER.kickingDamping);
    expect(s.players[0].d.vx).toBeCloseTo(terminalK, 2);
  });

  it('no sale de los límites del estadio', () => {
    const s = game();
    run(s, 800, { a: IN.LEFT | IN.UP });
    const p = s.players[0].d;
    expect(p.x).toBeGreaterThanOrEqual(-STADIUM.width + p.r - 1e-9);
    expect(p.y).toBeGreaterThanOrEqual(-STADIUM.height + p.r - 1e-9);
  });
});

describe('patada', () => {
  function placeNearBall(s: GameState, gap: number) {
    const p = s.players[0];
    s.phase = 'playing';
    p.d.x = s.ball.x - (p.d.r + s.ball.r + gap);
    p.d.y = 0;
    p.d.vx = p.d.vy = 0;
  }

  it('patea dentro del alcance en la dirección jugador→pelota', () => {
    const s = game();
    placeNearBall(s, KICK.range - 1);
    s.players[0].d.y = -3;
    run(s, 1, { a: IN.KICK });
    expect(s.ball.vx).toBeGreaterThan(4);
    expect(s.ball.vy).toBeGreaterThan(0);
  });

  it('no patea fuera del alcance', () => {
    const s = game();
    placeNearBall(s, KICK.range + 3);
    run(s, 1, { a: IN.KICK });
    expect(s.ball.vx).toBe(0);
  });

  it('mantener apretado no repite la patada; re-apretar sí (con intervalo)', () => {
    const s = game();
    placeNearBall(s, 1);
    run(s, 1, { a: IN.KICK });
    let kicks = 1;
    // pelota vuelve a estar cerca: mantener no patea
    s.ball.x = s.players[0].d.x + 26;
    s.ball.y = s.players[0].d.y;
    s.ball.vx = s.ball.vy = 0;
    s.events = [];
    for (let i = 0; i < 20; i++) { setInput(s, 'a', IN.KICK); step(s); kicks += s.events.filter((e) => e.type === 'kick').length; s.events = []; s.ball.vx = s.ball.vy = 0; s.ball.x = s.players[0].d.x + 26; }
    expect(kicks).toBe(1);
    run(s, 1, { a: 0 });
    s.ball.x = s.players[0].d.x + 26;
    s.events = [];
    setInput(s, 'a', IN.KICK);
    step(s);
    expect(s.events.some((e) => e.type === 'kick')).toBe(true);
  });
});

describe('colisiones', () => {
  it('conserva el momento en un choque entre discos libres', () => {
    const a = makeDisc(0, 0, 'player');
    const b = makeDisc(29, 0, 'player');
    a.vx = 2;
    const before = a.vx / a.invMass + b.vx / b.invMass;
    collideDiscs(a, b);
    const after = a.vx / a.invMass + b.vx / b.invMass;
    expect(after).toBeCloseTo(before, 9);
    expect(b.vx).toBeGreaterThan(0);
  });

  it('un tiro a velocidad máxima no atraviesa la pared lateral', () => {
    const ball = makeDisc(STADIUM.fieldW - 30, 120, 'ball');
    ball.vx = LIMITS.ballMaxSpeed;
    for (let i = 0; i < 10; i++) stepWorld({ ball, players: [], playerBarriers: [] });
    expect(ball.x).toBeLessThanOrEqual(STADIUM.fieldW - ball.r + 1e-6);
    expect(ball.vx).toBeLessThan(0);
  });

  it('un tiro rápido contra el poste rebota y no lo atraviesa', () => {
    const post = stadium.posts[3]; // (W, G)
    const ball = makeDisc(post.x - 80, post.y, 'ball');
    ball.vx = LIMITS.ballMaxSpeed;
    let minDist = Infinity;
    for (let i = 0; i < 12; i++) {
      stepWorld({ ball, players: [], playerBarriers: [] });
      minDist = Math.min(minDist, Math.hypot(ball.x - post.x, ball.y - post.y));
    }
    expect(minDist).toBeGreaterThan(post.r + ball.r - 0.5);
    expect(ball.x).toBeLessThan(post.x);
  });

  it('las redes de ambos arcos frenan la pelota y quedan detrás de la línea', () => {
    for (const s of [1, -1]) {
      const ball = makeDisc(s * (STADIUM.fieldW + 5), 0, 'ball');
      ball.vx = s * LIMITS.ballMaxSpeed;
      for (let i = 0; i < 20; i++) stepWorld({ ball, players: [], playerBarriers: [] });
      expect(Math.abs(ball.x)).toBeLessThan(STADIUM.fieldW + STADIUM.goalDepth);
      expect(Math.abs(ball.x)).toBeGreaterThan(STADIUM.fieldW);
    }
    for (const sg of [...stadium.nets.red, ...stadium.nets.blue]) {
      expect(Math.abs(sg.ax)).toBeGreaterThanOrEqual(STADIUM.fieldW);
      expect(Math.abs(sg.bx)).toBeGreaterThanOrEqual(STADIUM.fieldW);
    }
    expect(stadium.nets.red.every((sg) => sg.ax < 0)).toBe(true);
  });
});

describe('goles y partido', () => {
  it('cuenta el gol una sola vez, pausa y saca quien lo recibió', () => {
    const s = game();
    s.phase = 'playing';
    s.ball.x = STADIUM.fieldW - 20;
    s.ball.vx = 8;
    let goals = 0;
    for (let i = 0; i < 200; i++) {
      s.events = [];
      step(s);
      goals += s.events.filter((e) => e.type === 'goal').length;
    }
    expect(goals).toBe(1);
    expect(s.score.red).toBe(1);
    expect(s.phase).toBe('kickoff');
    expect(s.kickoffTeam).toBe('blue');
    expect(s.ball.x).toBe(0);
  });

  it('pelota que pega fuera del arco no es gol', () => {
    const s = game();
    s.phase = 'playing';
    s.ball.x = STADIUM.fieldW - 30;
    s.ball.y = STADIUM.goalHalf + 30;
    s.ball.vx = 10;
    run(s, 60);
    expect(s.score.red).toBe(0);
  });

  it('barrera de saque: el equipo que no saca no entra al círculo ni cruza', () => {
    const s = game('classic', [
      { id: 'a', team: 'red', hero: 'spider' },
      { id: 'b', team: 'blue', hero: 'spider' },
    ]);
    // saca rojo: azul intenta ir al centro
    run(s, 400, { b: IN.LEFT });
    const blue = s.players[1].d;
    expect(Math.hypot(blue.x, blue.y)).toBeGreaterThanOrEqual(STADIUM.kickoffRadius + blue.r - 1);
    expect(s.phase).toBe('kickoff');
    // rojo sí puede llegar a la pelota y sacar
    run(s, 400, { a: IN.RIGHT });
    expect(s.phase).toBe('playing');
  });

  it('victoria por límite de goles', () => {
    const s = game();
    s.score.red = 2;
    s.phase = 'playing';
    s.ball.x = STADIUM.fieldW - 15;
    s.ball.vx = 6;
    run(s, 200);
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe('red');
  });

  it('empate al terminar el tiempo lleva a gol de oro', () => {
    const s = game();
    s.phase = 'playing';
    s.time = s.timeLimit - 1;
    s.events = [];
    step(s);
    expect(s.overtime).toBe(true);
    expect(s.phase).toBe('playing');
    s.ball.x = -STADIUM.fieldW + 15;
    s.ball.vx = -6;
    run(s, 200);
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe('blue');
  });

  it('tiempo cumplido con ventaja termina el partido', () => {
    const s = game();
    s.phase = 'playing';
    s.score.blue = 1;
    s.time = s.timeLimit - 1;
    run(s, 1);
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe('blue');
  });
});
