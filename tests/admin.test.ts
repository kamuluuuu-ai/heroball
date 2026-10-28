import { beforeAll, describe, expect, it } from 'vitest';
import { createHandler } from '../server/handler';
import { Client, Lobby } from '../server/room';
import { ADMIN_PUBLIC_KEY, signAdmin, signHeroes, verifyAdmin } from '../shared/admin';

// par de claves sólo para las pruebas (la clave real no está en el repositorio)
let pub: JsonWebKey;
let priv: string;
let otherPriv: string;

async function keyPair(): Promise<{ pub: JsonWebKey; priv: string }> {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const p = await crypto.subtle.exportKey('pkcs8', k.privateKey);
  return { pub: await crypto.subtle.exportKey('jwk', k.publicKey), priv: Buffer.from(p).toString('base64') };
}

beforeAll(async () => {
  ({ pub, priv } = await keyPair());
  otherPriv = (await keyPair()).priv;
});

type Fake = Client & { msgs: any[]; h: ReturnType<typeof createHandler>; say(m: object): void };

function connect(lobby: Lobby, id: string): Fake {
  const msgs: any[] = [];
  const c = {
    id, nick: '', room: null, ping: 0, msgs,
    send(m: unknown) { msgs.push(typeof m === 'string' ? JSON.parse(m) : m); },
  } as unknown as Fake;
  c.h = createHandler(lobby, c, { adminPublicKey: pub });
  c.say = (m) => c.h.onMessage(JSON.stringify(m));
  c.say({ t: 'hello', nick: id, v: 1 });
  return c;
}

const nonceOf = (c: Fake) => c.msgs.find((m) => m.t === 'welcome').nonce as string;
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
};

async function becomeAdmin(c: Fake, key = priv): Promise<boolean> {
  c.say({ t: 'admin', sig: await signAdmin(key, nonceOf(c), c.id) });
  await until(() => c.msgs.some((m) => m.t === 'admin'));
  return c.msgs.find((m) => m.t === 'admin')?.ok === true;
}

function hostRoom(lobby: Lobby, settings = {}) {
  const host = connect(lobby, 'h');
  host.say({ t: 'create', name: 'Sala', settings });
  return { host, r: [...lobby.rooms.values()][0] };
}

describe('administrador con clave firmada', () => {
  it('la firma sólo vale para ese desafío, ese id y esa clave', async () => {
    const sig = await signAdmin(priv, 'n1', 'p1');
    expect(await verifyAdmin(sig, 'n1', 'p1', pub)).toBe(true);
    expect(await verifyAdmin(sig, 'n2', 'p1', pub)).toBe(false);
    expect(await verifyAdmin(sig, 'n1', 'p2', pub)).toBe(false);
    expect(await verifyAdmin(await signAdmin(otherPriv, 'n1', 'p1'), 'n1', 'p1', pub)).toBe(false);
    expect(await verifyAdmin('basura', 'n1', 'p1', pub)).toBe(false);
    // la clave de prueba no sirve contra la clave real del juego
    expect(await verifyAdmin(sig, 'n1', 'p1', ADMIN_PUBLIC_KEY)).toBe(false);
  });

  it('cada conexión recibe un desafío distinto', () => {
    const lobby = new Lobby();
    expect(nonceOf(connect(lobby, 'a'))).not.toBe(nonceOf(connect(lobby, 'b')));
  });

  it('una firma copiada de otra conexión no sirve', async () => {
    const lobby = new Lobby();
    const a = connect(lobby, 'a');
    const b = connect(lobby, 'b');
    b.say({ t: 'admin', sig: await signAdmin(priv, nonceOf(a), 'a') });
    await until(() => b.msgs.some((m) => m.t === 'admin'));
    expect(b.msgs.find((m) => m.t === 'admin').ok).toBe(false);
    expect(b.admin).toBeFalsy();
  });

  it('el administrador entra a una sala llena y tiene permisos de anfitrión', async () => {
    const lobby = new Lobby();
    const { host, r } = hostRoom(lobby, { maxPlayers: 2 });
    const p = connect(lobby, 'p');
    p.say({ t: 'join', room: r.id });
    const adm = connect(lobby, 'z');
    adm.say({ t: 'join', room: r.id });
    expect(r.members.has('z')).toBe(false); // llena para un usuario común
    expect(await becomeAdmin(adm)).toBe(true);
    adm.say({ t: 'join', room: r.id });
    expect(r.members.has('z')).toBe(true);
    expect(r.info().members.find((m) => m.id === 'z')!.admin).toBe(true);
    expect(r.hostId).toBe('h');

    adm.say({ t: 'side', side: 'red', target: 'p' });
    expect(r.members.get('p')!.side).toBe('red');
    adm.say({ t: 'settings', settings: { mode: 'super', maxPlayers: 4 } });
    expect(r.settings.mode).toBe('super');
    adm.say({ t: 'start' });
    expect(r.game).not.toBeNull();
    adm.say({ t: 'pause' });
    expect(r.game!.paused).toBe(true);
    adm.say({ t: 'makehost', target: 'p' });
    expect(r.hostId).toBe('p');
    adm.say({ t: 'kick', target: 'h' });
    expect(r.members.has('h')).toBe(false);
    expect(host.msgs.some((m) => m.t === 'left' && /administrador/.test(m.reason))).toBe(true);
  });

  it('el anfitrión no puede expulsar al administrador ni usar makehost', async () => {
    const lobby = new Lobby();
    const { host, r } = hostRoom(lobby);
    const adm = connect(lobby, 'z');
    expect(await becomeAdmin(adm)).toBe(true);
    adm.say({ t: 'join', room: r.id });
    const p = connect(lobby, 'p');
    p.say({ t: 'join', room: r.id });
    host.say({ t: 'kick', target: 'z' });
    expect(r.members.has('z')).toBe(true);
    host.say({ t: 'makehost', target: 'p' });
    expect(r.hostId).toBe('h');
    // un jugador común tampoco tiene permisos
    p.say({ t: 'kick', target: 'h' });
    expect(r.members.has('h')).toBe(true);
  });

  it('una clave equivocada no da permisos y los intentos son limitados', async () => {
    const lobby = new Lobby();
    const { r } = hostRoom(lobby);
    const x = connect(lobby, 'x');
    x.say({ t: 'join', room: r.id });
    expect(await becomeAdmin(x, otherPriv)).toBe(false);
    x.say({ t: 'kick', target: 'h' });
    expect(r.members.has('h')).toBe(true);
    for (let i = 0; i < 2; i++) x.say({ t: 'admin', sig: 'AAAA' });
    await new Promise((res) => setTimeout(res, 30));
    // el 4.º intento ni se verifica, aunque la firma sea buena
    x.say({ t: 'admin', sig: await signAdmin(priv, nonceOf(x), 'x') });
    await new Promise((res) => setTimeout(res, 30));
    expect(x.admin).toBeFalsy();
    expect(x.msgs.some((m) => m.t === 'error' && /intentos/.test(m.msg))).toBe(true);
  });

  it('sólo los administradores reciben el estado detallado de la sala', async () => {
    const lobby = new Lobby();
    const { host, r } = hostRoom(lobby);
    const adm = connect(lobby, 'z');
    expect(await becomeAdmin(adm)).toBe(true);
    adm.say({ t: 'join', room: r.id });
    host.say({ t: 'side', side: 'red' });
    host.say({ t: 'start' });
    for (let i = 0; i < 60; i++) lobby.tickAll();
    const st = adm.msgs.filter((m) => m.t === 'adminstate').pop().s;
    expect(st.game.tick).toBeGreaterThan(0);
    expect(st.snapBytes).toBeGreaterThan(100);
    expect(st.members.map((m: { id: string }) => m.id).sort()).toEqual(['h', 'z']);
    expect(host.msgs.some((m) => m.t === 'adminstate')).toBe(false);
  });
});

describe('personajes secretos en salas P2P (firma del servidor)', () => {
  const heroOf = (r: { members: Map<string, { hero: string }> }, id: string) => r.members.get(id)!.hero;
  const reply = async (c: Fake) => {
    await until(() => c.msgs.some((m) => m.t === 'heroes'));
    return c.msgs.filter((m) => m.t === 'heroes').pop()?.ok as boolean | undefined;
  };

  it('sin firma Thanos se rechaza; con la firma de esta conexión se acepta', async () => {
    const lobby = new Lobby();
    const { r } = hostRoom(lobby);
    const g = connect(lobby, 'g');
    g.say({ t: 'join', room: r.id });
    g.say({ t: 'hero', hero: 'thanos' });
    expect(heroOf(r, 'g')).not.toBe('thanos');
    expect(g.msgs.some((m) => m.t === 'error' && /colección/.test(m.msg))).toBe(true);
    g.say({ t: 'heroes', heroes: ['thanos'], sig: await signHeroes(priv, nonceOf(g), 'g', ['thanos']) });
    expect(await reply(g)).toBe(true);
    g.say({ t: 'hero', hero: 'thanos' });
    expect(heroOf(r, 'g')).toBe('thanos');
  });

  it('firmas inválidas: otra clave, otra conexión, otra lista o una firma de moderador', async () => {
    const lobby = new Lobby();
    const { r } = hostRoom(lobby);
    const g = connect(lobby, 'g');
    g.say({ t: 'join', room: r.id });
    const n = nonceOf(g);
    const bad = [
      { heroes: ['thanos'], sig: await signHeroes(otherPriv, n, 'g', ['thanos']) },
      { heroes: ['thanos'], sig: await signHeroes(priv, n, 'otro', ['thanos']) },
      { heroes: ['thanos'], sig: await signHeroes(priv, n, 'g', []) },
      { heroes: ['thanos'], sig: await signAdmin(priv, n, 'g') },
    ];
    for (const b of bad) {
      g.msgs.length = 0;
      g.say({ t: 'heroes', ...b });
      expect(await reply(g)).toBe(false);
    }
    g.say({ t: 'hero', hero: 'thanos' });
    expect(heroOf(r, 'g')).not.toBe('thanos');
    // y la firma de héroes nunca da permisos de moderador
    expect(g.admin).toBeFalsy();
  });

  it('una firma copiada de otra conexión no sirve', async () => {
    const lobby = new Lobby();
    const { r } = hostRoom(lobby);
    const a = connect(lobby, 'a');
    const b = connect(lobby, 'b');
    a.say({ t: 'join', room: r.id });
    b.say({ t: 'join', room: r.id });
    const sig = await signHeroes(priv, nonceOf(a), 'a', ['thanos']);
    b.say({ t: 'heroes', heroes: ['thanos'], sig });
    expect(await reply(b)).toBe(false);
    b.say({ t: 'hero', hero: 'thanos' });
    expect(heroOf(r, 'b')).not.toBe('thanos');
  });
});

it('P2P: una lista firmada nueva sin Thanos (retiro) lo saca de la sala', async () => {
  const lobby = new Lobby();
  const { r } = hostRoom(lobby);
  const g = connect(lobby, 'g');
  const n = nonceOf(g);
  g.say({ t: 'join', room: r.id });
  g.say({ t: 'heroes', heroes: ['thanos'], sig: await signHeroes(priv, n, 'g', ['thanos']) });
  await until(() => g.msgs.some((m) => m.t === 'heroes'));
  g.say({ t: 'hero', hero: 'thanos' });
  expect(r.members.get('g')!.hero).toBe('thanos');
  g.msgs.length = 0;
  g.say({ t: 'heroes', heroes: [], sig: await signHeroes(priv, n, 'g', []) });
  await until(() => g.msgs.some((m) => m.t === 'heroes'));
  expect(r.members.get('g')!.hero).toBe('spider');
  g.say({ t: 'hero', hero: 'thanos' });
  expect(r.members.get('g')!.hero).toBe('spider');
});
