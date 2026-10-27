// Simulador de red en proceso: un servidor autoritativo (Room) y varios
// clientes NetSession, cada uno con su latencia de ida (en ticks) y su propia
// tasa de fotogramas. Sirve para medir lo que cada jugador VE frente a lo que
// físicamente choca en su predicción y en el servidor.
import { NetSession } from '../client/src/game/sessions';
import { Client, Lobby } from '../server/room';
import { TICK_MS } from '../shared/config';
import type { GameState, Team } from '../shared/types';

export interface SimClient {
  id: string;
  session: NetSession;
  /** Bits que manda este cliente en cada fotograma. */
  bits: number;
  view: GameState | null;
}

export function netSim(opts: { lagTicks: Record<string, number>; teams: Record<string, Team>; mode?: 'classic' | 'heroes'; fps?: Record<string, number> }) {
  const lobby = new Lobby();
  const room = lobby.create('sim', { mode: opts.mode ?? 'classic' });
  let now = 0; // ms
  const toClient: { at: number; id: string; raw: string }[] = [];
  const toServer: { at: number; id: string; s: number; b: number }[] = [];
  const clients: SimClient[] = [];
  const nextFrame = new Map<string, number>();
  for (const id of Object.keys(opts.teams)) {
    const lag = (opts.lagTicks[id] ?? 0) * TICK_MS;
    const c: Client = {
      id, nick: id, room: null, ping: 0,
      send(m) { toClient.push({ at: now + lag, id, raw: typeof m === 'string' ? m : JSON.stringify(m) }); },
    };
    const fakeNet = {
      id,
      sink: null as unknown,
      send(m: { t: string; s: number; b: number }) { if (m.t === 'in') toServer.push({ at: now + lag, id, s: m.s, b: m.b }); },
    };
    const session = new NetSession(fakeNet as never);
    room.join(c);
    room.setSide(id, opts.teams[id]);
    clients.push({ id, session, bits: 0, view: null });
    nextFrame.set(id, 0);
  }
  room.start(clients[0].id);

  /** Avanza `ms` de tiempo real: servidor a 60 Hz y cada cliente a su fps. */
  const advance = (ms: number, onFrame?: (c: SimClient) => void) => {
    const end = now + ms;
    let serverNext = Math.ceil(now / TICK_MS) * TICK_MS;
    while (now < end) {
      // próximo evento: tick del servidor o fotograma de algún cliente
      let t = serverNext;
      for (const v of nextFrame.values()) t = Math.min(t, v);
      now = Math.min(t, end);
      while (toServer.length && toServer[0].at <= now) { const i = toServer.shift()!; room.pushInput(i.id, i.s, i.b); }
      if (now >= serverNext) { room.tick(); serverNext += TICK_MS; }
      for (let i = 0; i < toClient.length;) {
        if (toClient[i].at <= now) {
          const m = JSON.parse(toClient[i].raw);
          const c = clients.find((x) => x.id === toClient[i].id)!;
          if (m.t === 'snap') c.session.onSnapshot(m.state, m.ack, m.ev);
          toClient.splice(i, 1);
        } else i++;
      }
      for (const c of clients) {
        if (nextFrame.get(c.id)! > now) continue;
        const dt = 1000 / (opts.fps?.[c.id] ?? 60);
        c.session.update(dt, c.bits);
        c.view = c.session.view();
        nextFrame.set(c.id, nextFrame.get(c.id)! + dt);
        onFrame?.(c);
      }
    }
  };
  return { room, clients, advance, client: (id: string) => clients.find((c) => c.id === id)! };
}

export const edgeGap = (a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
