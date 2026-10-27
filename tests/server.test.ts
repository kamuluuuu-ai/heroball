import { describe, expect, it } from 'vitest';
import { Client, Lobby } from '../server/room';
import { parseClientMessage } from '../shared/protocol';
import { IN } from '../shared/types';

function fake(id: string, nick = id): Client & { msgs: any[] } {
  const msgs: any[] = [];
  return {
    id, nick, room: null, ping: 0, msgs,
    send(m) { msgs.push(typeof m === 'string' ? JSON.parse(m) : m); },
  };
}

describe('validación de mensajes', () => {
  it('rechaza JSON inválido, tipos desconocidos y campos fuera de rango', () => {
    expect(parseClientMessage('no json')).toBeNull();
    expect(parseClientMessage('{"t":"hack"}')).toBeNull();
    expect(parseClientMessage('{"t":"in","s":1,"b":999}')).toBeNull();
    expect(parseClientMessage('{"t":"in","s":-1,"b":1}')).toBeNull();
    expect(parseClientMessage('{"t":"hero","hero":"loki"}')).toBeNull();
    expect(parseClientMessage('{"t":"settings","settings":{"teamSize":7}}')).toBeNull();
    expect(parseClientMessage('{"t":"chat","text":"' + 'x'.repeat(3000) + '"}')).toBeNull();
    expect(parseClientMessage('{"t":"in","s":5,"b":17}')).toEqual({ t: 'in', s: 5, b: 17 });
  });

  it('nunca acepta posiciones ni goles del cliente', () => {
    const m = parseClientMessage('{"t":"in","s":3,"b":1,"x":999,"score":5}');
    expect(m).toEqual({ t: 'in', s: 3, b: 1 });
  });
});

describe('salas', () => {
  it('el primero es anfitrión; al irse se transfiere al más antiguo', () => {
    const lobby = new Lobby();
    const a = fake('a'), b = fake('b'), c = fake('c');
    const r = lobby.create('Sala', {});
    r.join(a); r.join(b); r.join(c);
    expect(r.hostId).toBe('a');
    r.leave('a');
    expect(r.hostId).toBe('b');
    expect(c.msgs.some((m) => m.t === 'chat' && /anfitrión/.test(m.text))).toBe(true);
  });

  it('la sala se elimina cuando no quedan humanos (aunque haya bots)', () => {
    const lobby = new Lobby();
    const a = fake('a');
    const r = lobby.create('Sala', {});
    r.join(a);
    r.setSide('a', 'red');
    r.addBot('a', 'blue');
    expect(lobby.rooms.size).toBe(1);
    r.leave('a');
    expect(lobby.rooms.size).toBe(0);
  });

  it('sólo el anfitrión inicia, pausa, cambia límites y mueve a otros', () => {
    const lobby = new Lobby();
    const a = fake('a'), b = fake('b');
    const r = lobby.create('Sala', {});
    r.join(a); r.join(b);
    expect(r.start('b')).toMatch(/anfitrión/);
    expect(r.setSettings('b', { scoreLimit: 5 })).toMatch(/anfitrión/);
    expect(r.setSide('b', 'red', 'a')).toMatch(/anfitrión/);
    expect(r.setSide('b', 'red')).toBeNull();
    expect(r.start('a')).toBeNull();
    expect(r.pause('b')).toMatch(/anfitrión/);
    expect(r.pause('a')).toBeNull();
    expect(r.game!.paused).toBe(true);
  });

  it('respeta el tamaño de equipo (1v1)', () => {
    const lobby = new Lobby();
    const a = fake('a'), b = fake('b');
    const r = lobby.create('Sala', { teamSize: 1 });
    r.join(a); r.join(b);
    expect(r.setSide('a', 'red')).toBeNull();
    expect(r.setSide('b', 'red')).toMatch(/completo/);
  });

  it('las salas están aisladas: entradas y chat no cruzan', () => {
    const lobby = new Lobby();
    const a = fake('a'), b = fake('b');
    const r1 = lobby.create('Uno', {});
    const r2 = lobby.create('Dos', {});
    r1.join(a); r2.join(b);
    r1.setSide('a', 'red'); r2.setSide('b', 'red');
    r1.start('a'); r2.start('b');
    r1.chat('a', 'hola sala uno');
    expect(b.msgs.some((m) => m.t === 'chat' && m.text === 'hola sala uno')).toBe(false);
    // b intenta mover a 'a' a través de su sala: no existe allí
    r2.pushInput('a', 1, IN.RIGHT);
    for (let i = 0; i < 30; i++) { r1.tick(); r2.tick(); }
    expect(r1.game!.players[0].d.vx).toBe(0);
  });

  it('el servidor procesa entradas en orden, confirma la secuencia y no duplica poderes', () => {
    const lobby = new Lobby();
    const a = fake('a');
    const r = lobby.create('Sala', {});
    r.join(a);
    r.setSide('a', 'red');
    r.start('a');
    r.game!.phase = 'playing';
    // la misma pulsación de E reenviada (duplicada) no se procesa dos veces
    r.pushInput('a', 1, IN.E);
    r.pushInput('a', 1, IN.E);
    r.pushInput('a', 2, 0);
    r.pushInput('a', 3, IN.E);
    let powers = 0;
    for (let i = 0; i < 4; i++) {
      r.tick();
      powers += r.game!.events.filter((e) => e.type === 'power').length;
    }
    expect(powers).toBe(1); // la segunda pulsación cae en cooldown
    const snaps = a.msgs.filter((m) => m.t === 'snap');
    expect(snaps.at(-1).ack).toBe(3);
  });

  it('chat: sin HTML interpretado y con longitud acotada', () => {
    const lobby = new Lobby();
    const a = fake('a');
    const r = lobby.create('Sala', {});
    r.join(a);
    r.chat('a', '<img src=x onerror=alert(1)>' + 'y'.repeat(500));
    const msg = a.msgs.filter((m) => m.t === 'chat' && m.from === 'a').at(-1);
    expect(msg.text.length).toBeLessThanOrEqual(140);
    expect(msg.text.startsWith('<img')).toBe(true); // se muestra como texto, no se elimina ni se interpreta
  });

  it('partido completo: termina y vuelve a la sala; revancha reinicia marcador', () => {
    const lobby = new Lobby();
    const a = fake('a');
    const r = lobby.create('Sala', { scoreLimit: 1 });
    r.join(a);
    r.setSide('a', 'red');
    r.start('a');
    const g = r.game!;
    g.phase = 'playing';
    g.ball.x = 360; g.ball.vx = 8;
    for (let i = 0; i < 1000 && r.game; i++) r.tick();
    expect(r.game).toBeNull();
    expect(a.msgs.some((m) => m.t === 'chat' && /Ganó el equipo rojo/.test(m.text))).toBe(true);
    r.start('a');
    expect(r.restart('a')).toBeNull();
    expect(r.game!.score).toEqual({ red: 0, blue: 0 });
  });
});
