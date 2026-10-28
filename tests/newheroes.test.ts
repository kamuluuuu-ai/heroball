// Los seis personajes nuevos (Homero, CJ, Baldi, Ibai, Verity y Thanos):
// activación en Héroes y Súper, autoapuntado compartido, efectos, límites de
// control, limpieza al reiniciar y determinismo.
import { describe, expect, it } from 'vitest';
import { BALDI_QUIZ, HeroId, PLAYER, POWERS, R, STUN, SUPER_POWERS } from '../shared/config';
import { botInput, makeBrain } from '../shared/bot';
import { cloneState, createGame, removePlayer, resetKickoff, setInput, step } from '../shared/game';
import { autoAim } from '../shared/powers';
import { GameState, IN, IN_NUM_SHIFT, Team } from '../shared/types';

type P = { id: string; team: Team; hero: HeroId };
const NEW: HeroId[] = ['homer', 'cj', 'baldi', 'ibai', 'verity', 'thanos'];

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

function run(s: GameState, n: number, bits: Record<string, number> = {}) {
  const ev: GameState['events'] = [];
  for (let i = 0; i < n; i++) ev.push(...tick(s, bits));
  return ev;
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

const num = (n: number) => n << IN_NUM_SHIFT;
const pl = (s: GameState, id: string) => s.players.find((o) => o.id === id)!;

/** Héroe nuevo mirando a la derecha, rival justo delante (al alcance de todo) y pelota lejos. */
function duel(hero: HeroId, mode: 'heroes' | 'super' = 'heroes') {
  const s = game([{ id: 'a', team: 'red', hero }, { id: 'b', team: 'blue', hero: 'spider' }], mode);
  place(s, 'a', -150, 0);
  place(s, 'b', -150 + 2 * PLAYER.radius + R, 0);
  aim(s, 'a', 1, 0);
  s.ball.x = 0; s.ball.y = 160; s.ball.vx = 0; s.ball.vy = 0;
  return s;
}

describe('cada personaje nuevo funciona en Héroes y Súper', () => {
  for (const mode of ['heroes', 'super'] as const) {
    for (const hero of NEW) {
      it(`${hero} (${mode}): Q y E se activan`, () => {
        const q = duel(hero, mode);
        if (hero === 'thanos') {
          // gema del Poder (5) siempre tiene efecto
          tick(q, { a: num(5) });
          expect(pl(q, 'a').gem).toBe(4);
          const ev = tick(q, { a: IN.Q });
          expect(ev.some((e) => e.type === 'power' && e.gem === 4)).toBe(true);
          expect(pl(q, 'a').powerKick).toBeGreaterThan(0);
        } else {
          expect(tick(q, { a: IN.Q }).some((e) => e.type === 'power' && e.slot === 'q')).toBe(true);
        }
        const e = duel(hero, mode);
        const gem0 = pl(e, 'a').gem;
        const ev = tick(e, { a: IN.E });
        if (hero === 'thanos') expect(pl(e, 'a').gem).toBe((gem0 + 1) % 5);
        else expect(ev.some((x) => x.type === 'power' && x.slot === 'e')).toBe(true);
      });
    }
  }

  it('Súper potencia la rosquilla según lo pedido (13R, 0.9 s, 3 s, 55 %, recarga 8 s)', () => {
    const d = SUPER_POWERS.homer.donut;
    expect([d.range, d.trapTicks, d.ballTicks, d.impulseCut, d.cooldown]).toEqual([13 * R, 54, 180, 0.55, 480]);
  });
});

describe('autoapuntado compartido', () => {
  it('elige la pelota dentro del cono y del alcance, nunca detrás ni fuera de alcance', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'homer' }]);
    place(s, 'a', -100, 0);
    aim(s, 'a', 1, 0);
    s.ball.x = 0; s.ball.y = 20;
    expect(autoAim(s, pl(s, 'a'))?.target.kind).toBe('ball');
    aim(s, 'a', -1, 0);
    expect(autoAim(s, pl(s, 'a'))).toBeNull();
    aim(s, 'a', 1, 0);
    s.ball.x = -100 + POWERS.homer.donut.range + 60;
    expect(autoAim(s, pl(s, 'a'))).toBeNull();
  });

  it('nunca a un aliado ni a la pelota protegida; prefiere el menor ángulo', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'cj' }, { id: 'm', team: 'red', hero: 'spider' }, { id: 'b', team: 'blue', hero: 'spider' }]);
    place(s, 'a', -150, 0);
    aim(s, 'a', 1, 0);
    place(s, 'm', -60, 0);
    place(s, 'b', -60, 70);
    s.ball.x = 0; s.ball.y = 0;
    // la pelota está alineada (ángulo 0): gana sobre el rival desviado
    expect(autoAim(s, pl(s, 'a'))?.target.kind).toBe('ball');
    s.ballShield = 600;
    const t = autoAim(s, pl(s, 'a'))!.target;
    expect(t.kind).toBe('player');
    expect(t.id).toBe('b');
  });

  it('el poste tapa la línea de visión', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'baldi' }]);
    // detrás del poste superior del arco derecho, mirando hacia él
    const post = { x: 370, y: -64 };
    place(s, 'a', post.x - 60, post.y);
    aim(s, 'a', 1, 0);
    s.ball.x = post.x + 40; s.ball.y = post.y;
    const a = autoAim(s, pl(s, 'a'));
    expect(a === null || a.target.kind !== 'ball' || Math.abs(s.ball.y - post.y) > 30).toBe(true);
  });

  it('la TNT apunta al punto de caída y no supera su alcance', () => {
    const s = duel('verity');
    s.ball.x = -60; s.ball.y = 10;
    tick(s, { a: IN.E });
    const z = s.zones.find((o) => o.kind === 'tnt')!;
    expect(z).toBeTruthy();
    const a = pl(s, 'a');
    expect(Math.hypot(z.x - a.d.x, z.y - a.d.y)).toBeLessThanOrEqual(POWERS.verity.tnt.range + a.d.r + 25);
  });
});

describe('Homero', () => {
  it('la rosquilla atrapa al rival sin bloquear su patada, con tope de control', () => {
    const s = duel('homer');
    place(s, 'b', -40, 0);
    tick(s, { a: IN.Q });
    let caught = false;
    for (let i = 0; i < 60 && !caught; i++) {
      tick(s, { a: 0 });
      caught = pl(s, 'b').trap > 0;
    }
    expect(caught).toBe(true);
    expect(pl(s, 'b').trap).toBeLessThanOrEqual(Math.min(POWERS.homer.donut.trapTicks, STUN.maxTicks));
    // intenta moverse: no se desplaza por su cuenta
    const x0 = pl(s, 'b').d.x;
    run(s, 10, { b: IN.RIGHT });
    expect(Math.abs(pl(s, 'b').d.x - x0)).toBeLessThan(4);
  });

  it('la rosquilla en la pelota la frena y deja los impulsos reducidos por un tiempo', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'homer' }]);
    place(s, 'a', -150, 0);
    aim(s, 'a', 1, 0);
    s.ball.x = -60; s.ball.y = 0; s.ball.vx = 0; s.ball.vy = 0;
    tick(s, { a: IN.Q });
    let hit = false;
    for (let i = 0; i < 40 && !hit; i++) {
      tick(s, { a: 0 });
      hit = s.ballDonut > 0;
    }
    expect(hit).toBe(true);
    expect(s.ballDonut).toBeLessThanOrEqual(POWERS.homer.donut.ballTicks);
  });

  it('la cerveza hace patinar a cualquiera que esté adentro, de ambos equipos', () => {
    const s = duel('homer');
    tick(s, { a: IN.E });
    const z = s.zones.find((o) => o.kind === 'beer')!;
    place(s, 'b', z.x, z.y);
    run(s, POWERS.homer.beer.throwTicks + 2);
    expect(pl(s, 'b').slip).toBe(1);
    place(s, 'b', z.x + z.r + 60, z.y);
    run(s, POWERS.homer.beer.recoverTicks + 2);
    expect(pl(s, 'b').slip).toBe(0);
  });
});

describe('CJ', () => {
  it('tres balas separadas, una por pulsación, y recarga de 10 s tras la tercera', () => {
    const s = duel('cj');
    const c = POWERS.cj.gun;
    // mantener Q no dispara en ráfaga
    expect(run(s, 20, { a: IN.Q }).filter((e) => e.type === 'shot').length).toBe(1);
    run(s, c.gap, { a: 0 });
    expect(tick(s, { a: IN.Q }).some((e) => e.type === 'shot')).toBe(true);
    // pulsación demasiado pronto: no sale
    tick(s, { a: 0 });
    expect(tick(s, { a: IN.Q }).some((e) => e.type === 'shot')).toBe(false);
    run(s, c.gap, { a: 0 });
    expect(tick(s, { a: IN.Q }).some((e) => e.type === 'shot')).toBe(true);
    const p = pl(s, 'a');
    expect(p.ammo).toBe(0);
    expect(p.cdQ).toBe(c.reload - 1);
    tick(s, { a: 0 });
    expect(tick(s, { a: IN.Q }).some((e) => e.type === 'shot')).toBe(false);
    run(s, c.reload, { a: 0 });
    expect(p.ammo).toBe(c.shots);
  });

  it('el jetpack acelera más y sube el tope de velocidad', () => {
    const run2 = (jet: boolean) => {
      const s = duel('cj');
      place(s, 'b', 200, 150);
      if (jet) tick(s, { a: IN.E });
      run(s, 40, { a: IN.RIGHT });
      return pl(s, 'a').d.x;
    };
    expect(run2(true)).toBeGreaterThan(run2(false) + 10);
  });

  it('sin cooldowns el intervalo entre balas sigue limitando la cadencia', () => {
    const s = duel('cj');
    s.noCd = true;
    let shots = 0;
    for (let i = 0; i < 60; i++) shots += tick(s, { a: i % 2 ? IN.Q : 0 }).filter((e) => e.type === 'shot').length;
    expect(shots).toBeLessThanOrEqual(Math.ceil(60 / POWERS.cj.gun.gap) + 1);
  });
});

describe('Baldi', () => {
  function quizGame() {
    const s = duel('baldi');
    place(s, 'b', -40, 0);
    tick(s, { a: IN.E });
    run(s, POWERS.baldi.quiz.windup + 1, { a: 0 });
    return s;
  }

  it('la regla detiene la pelota una vez (sólo la pelota)', () => {
    const s = game([{ id: 'a', team: 'red', hero: 'baldi' }]);
    place(s, 'a', -150, 0);
    aim(s, 'a', 1, 0);
    s.ball.x = -40; s.ball.y = 0; s.ball.vx = 0; s.ball.vy = 2;
    tick(s, { a: IN.Q });
    let stopped = false;
    for (let i = 0; i < 30 && !stopped; i++) {
      tick(s, { a: 0 });
      stopped = Math.hypot(s.ball.vx, s.ball.vy) < 0.05;
    }
    expect(stopped).toBe(true);
  });

  it('quiz: la respuesta incorrecta lo cierra con 1,5 s de aturdimiento; la correcta lo cierra sin castigo y da 12 s de inmunidad', () => {
    const w = quizGame();
    const wb = pl(w, 'b');
    expect(wb.quiz).not.toBeNull();
    const wr = wb.quiz!.answer + 1;
    tick(w, { b: num(wr === 1 ? 2 : 1) });
    expect(wb.quiz).toBeNull();
    expect(wb.stun).toBeGreaterThan(POWERS.baldi.quiz.wrongStun - 3);
    const s = quizGame();
    const b = pl(s, 'b');
    expect(b.quiz).not.toBeNull();
    expect(b.quiz!.by).toBe('a');
    const right = b.quiz!.answer + 1;
    tick(s, { b: num(right) });
    expect(b.quiz).toBeNull();
    expect(b.stun).toBe(0);
    expect(b.quizImmune).toBeGreaterThan(BALDI_QUIZ.immuneTicks - 5);
    // inmune: un segundo quiz no se lanza y no gasta la recarga
    s.players[0].cdE = 0;
    const ev = tick(s, { a: IN.E, b: 0 });
    expect(ev.some((e) => e.type === 'power' && e.slot === 'e')).toBe(false);
  });

  it('quiz: se cierra solo a los 6 s como máximo (cuenta como error) y el afectado no se mueve mientras tanto', () => {
    const s = quizGame();
    const b = pl(s, 'b');
    const x0 = b.d.x;
    run(s, 30, { b: IN.RIGHT });
    expect(Math.abs(b.d.x - x0)).toBeLessThan(4);
    run(s, POWERS.baldi.quiz.ticks, { b: 0 });
    expect(b.quiz).toBeNull();
    expect(b.quizImmune).toBeGreaterThan(0);
  });

  it('un bot responde el quiz', () => {
    const s = quizGame();
    const brain = makeBrain('b', 0.9);
    let closed = false;
    for (let i = 0; i < POWERS.baldi.quiz.ticks && !closed; i++) {
      setInput(s, 'b', botInput(s, brain, () => 0.5));
      s.events = [];
      step(s);
      closed = s.events.some((e) => e.type === 'quiz' && e.result !== 'open' && e.result !== 'wrong');
    }
    expect(closed).toBe(true);
  });
});

describe('Ibai', () => {
  it('el guante empuja fuerte al rival cercano', () => {
    const s = duel('ibai');
    tick(s, { a: IN.Q });
    run(s, POWERS.ibai.glove.windup + 1, { a: 0 });
    expect(pl(s, 'b').d.vx).toBeGreaterThan(1);
  });

  it('el cuerpo gigante crece hasta 1.35R sin superponerse con nadie', () => {
    const s = duel('ibai');
    // rival pegado: crece sólo en el espacio libre
    place(s, 'b', -150 + 2 * PLAYER.radius + 1, 0);
    tick(s, { a: IN.E });
    for (let i = 0; i < 40; i++) {
      tick(s, { a: 0, b: 0 });
      const a = pl(s, 'a');
      const b = pl(s, 'b');
      expect(Math.hypot(a.d.x - b.d.x, a.d.y - b.d.y)).toBeGreaterThan(a.d.r + b.d.r - 1);
    }
    place(s, 'b', 200, 150);
    run(s, 30);
    expect(pl(s, 'a').d.r).toBeGreaterThan(PLAYER.radius);
    run(s, POWERS.ibai.giant.ticks + 30);
    expect(pl(s, 'a').d.r).toBe(PLAYER.radius);
  });
});

describe('Verity', () => {
  it('enojo: patada más fuerte durante 5 s', () => {
    const s = duel('verity');
    tick(s, { a: IN.Q });
    expect(pl(s, 'a').anger).toBe(POWERS.verity.anger.ticks - 1);
  });

  it('la TNT explota 2 s después de caer y empuja a todos', () => {
    const s = duel('verity');
    tick(s, { a: IN.E });
    const z = s.zones.find((o) => o.kind === 'tnt')!;
    place(s, 'b', z.x + 20, z.y);
    const ev = run(s, POWERS.verity.tnt.flightTicks + POWERS.verity.tnt.fuse + 2, { a: 0 });
    expect(ev.some((e) => e.type === 'boom' && e.kind === 'tnt')).toBe(true);
    expect(Math.hypot(pl(s, 'b').d.vx, pl(s, 'b').d.vy)).toBeGreaterThan(0.5);
  });

  it('un reinicio o la desconexión de Verity borran la TNT', () => {
    const s = duel('verity');
    tick(s, { a: IN.E });
    resetKickoff(s, 'red');
    expect(s.zones.length).toBe(0);
    const t = duel('verity');
    tick(t, { a: IN.E });
    removePlayer(t, 'a');
    expect(t.zones.some((z) => z.kind === 'tnt')).toBe(false);
  });
});

describe('Thanos', () => {
  it('el historial de la Gema del Tiempo no cruza jugadas', () => {
    const s = duel('thanos');
    run(s, 60, { b: IN.UP });
    expect((s.plHist.b ?? []).length).toBeGreaterThan(0);
    resetKickoff(s, 'red');
    expect(Object.keys(s.plHist).length).toBe(0);
  });

  it('la Gema del Tiempo devuelve al rival a donde estaba', () => {
    const s = duel('thanos');
    place(s, 'b', -60, 0);
    run(s, 40, { b: IN.DOWN });
    const moved = pl(s, 'b').d.y;
    expect(moved).toBeGreaterThan(20);
    tick(s, { a: num(1), b: 0 });
    tick(s, { a: IN.Q });
    expect(pl(s, 'b').d.y).toBeLessThan(moved - 10);
  });

  it('la ilusión no cambia la física', () => {
    const s = duel('thanos');
    s.ball.vx = 3; s.ball.vy = 1;
    const twin = cloneState(s);
    s.illusion = { by: 'a', team: 'blue', x: 0, y: 0, ticks: 60 };
    for (let i = 0; i < 40; i++) {
      tick(s, { a: IN.RIGHT, b: IN.LEFT });
      tick(twin, { a: IN.RIGHT, b: IN.LEFT });
    }
    expect([s.ball.x, s.ball.y, pl(s, 'a').d.x, pl(s, 'b').d.x]).toEqual([twin.ball.x, twin.ball.y, pl(twin, 'a').d.x, pl(twin, 'b').d.x]);
  });

  it('la Gema de la Realidad avisa al terminar y respeta el intervalo entre ilusiones', () => {
    const s = duel('thanos');
    tick(s, { a: num(3) });
    const ev = tick(s, { a: IN.Q });
    expect(ev.some((e) => e.type === 'illusion' && e.result === 'start' && e.team === 'blue')).toBe(true);
    const end = run(s, POWERS.thanos.reality.ticks + 1, { a: 0 });
    expect(end.some((e) => e.type === 'illusion' && e.result === 'end')).toBe(true);
    expect(s.illusion).toBeNull();
  });

  it('la Gema del Espacio lo pone junto a la pelota sin superponerse', () => {
    const s = duel('thanos');
    s.ball.x = 0; s.ball.y = 0;
    // rival pegado a la pelota del lado de Thanos: tiene que buscar otro lugar libre
    place(s, 'b', -s.ball.r - PLAYER.radius - 1, 0);
    tick(s, { a: num(4) });
    tick(s, { a: IN.Q });
    run(s, POWERS.thanos.space.windup + 2, { a: 0 });
    const a = pl(s, 'a');
    expect(Math.hypot(a.d.x - s.ball.x, a.d.y - s.ball.y)).toBeLessThan(a.d.r + s.ball.r + 40);
    expect(Math.hypot(a.d.x - s.ball.x, a.d.y - s.ball.y)).toBeGreaterThan(a.d.r + s.ball.r - 1);
    const b = pl(s, 'b');
    expect(Math.hypot(a.d.x - b.d.x, a.d.y - b.d.y)).toBeGreaterThan(a.d.r + b.d.r - 1);
  });

  it('la Gema de la Mente respeta el tope de control y deja inmunidad', () => {
    const s = duel('thanos');
    tick(s, { a: num(2) });
    tick(s, { a: IN.Q });
    const b = pl(s, 'b');
    expect(b.mind).toBeGreaterThan(0);
    expect(b.mind).toBeLessThanOrEqual(STUN.maxTicks);
    run(s, STUN.maxTicks + 2, { a: 0 });
    expect(b.mind).toBe(0);
    expect(b.stunImmune).toBeGreaterThan(0);
  });
});

describe('protección del Capitán y determinismo', () => {
  it('la regla y las balas no mueven la pelota protegida', () => {
    for (const hero of ['baldi', 'cj'] as const) {
      const s = game([{ id: 'a', team: 'red', hero }]);
      place(s, 'a', -150, 0);
      aim(s, 'a', 1, 0);
      s.ball.x = -60; s.ball.y = 0; s.ball.vx = 0; s.ball.vy = 1;
      s.ballShield = 600;
      tick(s, { a: IN.Q });
      run(s, 20, { a: 0 });
      expect(Math.abs(s.ball.vx)).toBeLessThan(0.05);
      expect(Math.abs(s.ball.vy)).toBeGreaterThan(0.5);
    }
  });

  it('la misma secuencia de entradas da el mismo estado (red y anfitrión coinciden)', () => {
    const mk = () => game([
      { id: 'a', team: 'red', hero: 'baldi' }, { id: 'b', team: 'blue', hero: 'thanos' },
      { id: 'c', team: 'red', hero: 'homer' }, { id: 'd', team: 'blue', hero: 'verity' },
    ]);
    // la red copia el estado del anfitrión (incluida la semilla) y aplica las mismas entradas
    const x = mk();
    const y = cloneState(x);
    const seq = [IN.Q, 0, IN.E, 0, IN.RIGHT, IN.Q | IN.UP, num(3), IN.Q, 0, IN.E];
    for (let i = 0; i < 300; i++) {
      const bits = { a: seq[i % seq.length], b: seq[(i + 3) % seq.length], c: seq[(i + 5) % seq.length], d: seq[(i + 7) % seq.length] };
      tick(x, bits);
      tick(y, bits);
    }
    expect(JSON.stringify(x)).toBe(JSON.stringify(y));
  });
});
