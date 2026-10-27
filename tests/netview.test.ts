import { describe, expect, it } from 'vitest';
import { NetSession } from '../client/src/game/sessions';
import { Client, Lobby } from '../server/room';
import { TICK_MS } from '../shared/config';
import { IN } from '../shared/types';

/**
 * Cliente y servidor en el mismo proceso, con latencia de ida y de vuelta
 * expresada en ticks. Mide lo que el jugador VE.
 */
function setup(lagTicks: number) {
  const lobby = new Lobby();
  const room = lobby.create('t', { mode: 'classic' });
  const toClient: { at: number; raw: string }[] = [];
  const toServer: { at: number; s: number; b: number }[] = [];
  let now = 0;
  const client: Client = {
    id: 'me', nick: 'me', room: null, ping: 0,
    send(m) { toClient.push({ at: now + lagTicks, raw: typeof m === 'string' ? m : JSON.stringify(m) }); },
  };
  const fakeNet = {
    id: 'me',
    sink: null as unknown,
    send(m: { t: string; s: number; b: number }) { if (m.t === 'in') toServer.push({ at: now + lagTicks, s: m.s, b: m.b }); },
  };
  const session = new NetSession(fakeNet as never);
  room.join(client);
  room.setSide('me', 'red');
  room.start('me');
  const tick = (bits: number) => {
    now++;
    while (toServer.length && toServer[0].at <= now) { const i = toServer.shift()!; room.pushInput('me', i.s, i.b); }
    room.tick();
    while (toClient.length && toClient[0].at <= now) {
      const m = JSON.parse(toClient.shift()!.raw);
      if (m.t === 'snap') session.onSnapshot(m.state, m.ack, m.ev);
    }
    session.update(TICK_MS, bits);
    return session.view();
  };
  return { tick, session, room };
}

describe('vista en red: jugador y pelota en el mismo instante', () => {
  it('con ~200 ms de ida y vuelta, al correr contra la pelota nunca se dibujan encimados', () => {
    const { tick } = setup(6);
    let minGap = Infinity;
    let touched = false;
    for (let i = 0; i < 400; i++) {
      const v = tick(IN.RIGHT);
      if (!v) continue;
      const me = v.players.find((p) => p.id === 'me');
      if (!me) continue;
      const gap = Math.hypot(me.d.x - v.ball.x, me.d.y - v.ball.y) - me.d.r - v.ball.r;
      minGap = Math.min(minGap, gap);
      if (gap < 1) touched = true;
    }
    expect(touched).toBe(true);
    // tolerancia: suavizado de correcciones y un tick de interpolación
    expect(minGap).toBeGreaterThan(-3);
  });

  it('una patada que se ve en rango sale en la predicción y el servidor la confirma', () => {
    const { tick, room } = setup(6);
    for (let i = 0; i < 300; i++) {
      const v = tick(IN.RIGHT);
      const me = v?.players.find((p) => p.id === 'me');
      if (v && me && Math.hypot(me.d.x - v.ball.x, me.d.y - v.ball.y) - me.d.r - v.ball.r < 3) break;
    }
    tick(IN.RIGHT | IN.KICK);
    for (let i = 0; i < 30; i++) tick(0);
    expect(room.game!.ball.vx).toBeGreaterThan(3);
  });
});
