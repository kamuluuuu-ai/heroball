// Integración con PostgreSQL real (embebido) y la API HTTP completa:
// cuentas, persistencia, concurrencia, idempotencia, permisos y partidas oficiales.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../shared/economy';
import { parseClientMessage, type AccountInfo, type ServerMsg } from '../shared/protocol';
import { IN } from '../shared/types';
import { createApi } from '../server/api';
import { bearerHeaders, createAuth, sessionUser, type Auth } from '../server/auth';
import { migrate, type Db } from '../server/db';
import { Economy, setRole } from '../server/economy';
import { createHandler } from '../server/handler';
import type { MatchSummary, SettleResult } from '../server/official';
import { Lobby, type Client } from '../server/room';
import { startEmbedded, type EmbeddedDb } from '../scripts/embedded-db';

const ORIGIN = 'https://kamuluuuu-ai.github.io';
let pg: EmbeddedDb;
let db: Db;
let auth: Auth;
let eco: Economy;
let server: Server;
let base = '';
const mails: { to: string; url: string }[] = [];

async function startApi(): Promise<void> {
  auth = createAuth({ db, baseURL: base || 'http://localhost', secret: 'x'.repeat(40), trustedOrigins: [ORIGIN], rateLimit: false, sendResetLink: async (to, url) => { mails.push({ to, url }); } });
  eco = new Economy(db, { adminCoins: 5000, adminChests: 10 });
  const api = createApi({ auth, economy: eco, origins: [ORIGIN] });
  server = createServer(async (req, res) => {
    if (!(await api(req, res))) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not_found"}');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function restartApi(): Promise<void> {
  await new Promise<void>((r) => server.close(() => r()));
  await startApi();
}

interface Res { status: number; body: any; token: string | null }
async function call(method: string, path: string, body?: unknown, token?: string): Promise<Res> {
  const r = await fetch(base + path, {
    method,
    headers: { origin: ORIGIN, ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, token: r.headers.get('set-auth-token') };
}

let n = 0;
async function signUp(name = 'Jugador', wallet = true): Promise<{ token: string; id: string; email: string; password: string }> {
  const email = `u${++n}-${Date.now()}@test.local`;
  const password = 'clave-segura-123';
  const r = await call('POST', '/api/auth/sign-up/email', { email, password, name: `${name}${n}` });
  expect(r.status).toBe(200);
  expect(r.token).toBeTruthy();
  // primera visita al perfil: crea la billetera (como hace el cliente al iniciar sesión)
  if (wallet) expect((await call('GET', '/api/me', undefined, r.token!)).status).toBe(200);
  return { token: r.token!, id: r.body.user.id, email, password };
}

const key = () => 'k' + Math.random().toString(36).slice(2) + Date.now().toString(36);

beforeAll(async () => {
  pg = await startEmbedded({ port: 54333, dir: 'test', fresh: true });
  db = pg.pool;
  await migrate(db);
  await startApi();
}, 180_000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await pg?.stop();
}, 60_000);

describe('cuentas', () => {
  it('registro: id estable, bienvenida una sola vez (400 + 2 estándar)', async () => {
    const u = await signUp();
    const a = await call('GET', '/api/me', undefined, u.token);
    expect(a.status).toBe(200);
    expect(a.body.user.id).toBe(u.id);
    expect(a.body.wallet).toMatchObject({ coins: 400, standard: 2, elite: 0 });
    await Promise.all([1, 2, 3].map(() => call('GET', '/api/me', undefined, u.token)));
    const w = await db.query("SELECT count(*)::int AS n FROM ledger WHERE user_id = $1 AND kind = 'welcome'", [u.id]);
    expect(w.rows[0].n).toBe(1);
    expect((await call('GET', '/api/me', undefined, u.token)).body.wallet.coins).toBe(400);
  });

  it('sin sesión válida no hay acceso, aunque el cuerpo diga un userId', async () => {
    expect((await call('GET', '/api/me')).status).toBe(401);
    expect((await call('GET', '/api/me', undefined, 'token-inventado')).status).toBe(401);
    const victim = await signUp();
    const r = await call('POST', '/api/chests/open', { type: 'standard', key: key(), userId: victim.id });
    expect(r.status).toBe(401);
  });

  it('cuenta recuperada en otro navegador: iniciar sesión y restablecer contraseña', async () => {
    const u = await signUp();
    await call('POST', '/api/chests/buy', { type: 'standard', key: key() }, u.token);
    // "otro navegador": sin token previo
    const login = await call('POST', '/api/auth/sign-in/email', { email: u.email, password: u.password });
    expect(login.status).toBe(200);
    const me = await call('GET', '/api/me', undefined, login.token!);
    expect(me.body.user.id).toBe(u.id);
    expect(me.body.wallet).toMatchObject({ coins: 200, standard: 3 });
    // recuperación por correo
    const req = await call('POST', '/api/auth/request-password-reset', { email: u.email, redirectTo: `${ORIGIN}/heroball/` });
    expect(req.status).toBe(200);
    const mail = mails.find((m) => m.to === u.email)!;
    expect(mail).toBeTruthy();
    const token = new URL(mail.url).pathname.split('/').pop()!;
    const reset = await call('POST', '/api/auth/reset-password', { newPassword: 'otra-clave-456', token });
    expect(reset.status).toBe(200);
    expect((await call('POST', '/api/auth/sign-in/email', { email: u.email, password: u.password })).status).toBe(401);
    const again = await call('POST', '/api/auth/sign-in/email', { email: u.email, password: 'otra-clave-456' });
    expect(again.status).toBe(200);
    expect((await call('GET', '/api/me', undefined, again.token!)).body.wallet.standard).toBe(3);
    // las sesiones anteriores quedaron revocadas
    expect((await call('GET', '/api/me', undefined, u.token)).status).toBe(401);
  });

  it('cambiar el apodo no cambia el dueño ni el inventario', async () => {
    const u = await signUp();
    const before = (await call('GET', '/api/me', undefined, u.token)).body;
    const upd = await call('POST', '/api/auth/update-user', { name: 'Otro Nombre' }, u.token);
    expect(upd.status).toBe(200);
    const after = (await call('GET', '/api/me', undefined, u.token)).body;
    expect(after.user.id).toBe(before.user.id);
    expect(after.user.name).toBe('Otro Nombre');
    expect(after.wallet).toEqual(before.wallet);
  });

  it('inventario persistente tras reiniciar el servidor', async () => {
    const u = await signUp();
    const op = await call('POST', '/api/chests/open', { type: 'standard', key: key() }, u.token);
    expect(op.status).toBe(200);
    const before = (await call('GET', '/api/me', undefined, u.token)).body;
    await restartApi();
    const after = (await call('GET', '/api/me', undefined, u.token)).body;
    expect(after.wallet).toEqual(before.wallet);
    expect(after.heroes).toEqual(before.heroes);
    expect(after.openings[0].id).toBe(op.body.openingId);
  });
});

describe('cofres', () => {
  it('compra sin saldo y apertura sin cofres: rechazadas sin tocar el saldo', async () => {
    const u = await signUp();
    expect((await call('POST', '/api/chests/buy', { type: 'elite', key: key() }, u.token)).status).toBe(409);
    expect((await call('POST', '/api/chests/open', { type: 'elite', key: key() }, u.token)).body.error).toBe('no_chest');
    const me = (await call('GET', '/api/me', undefined, u.token)).body;
    expect(me.wallet).toMatchObject({ coins: 400, standard: 2, elite: 0 });
    expect((await call('POST', '/api/chests/buy', { type: 'cofre-raro', key: key() }, u.token)).status).toBe(400);
    expect((await call('POST', '/api/chests/buy', { type: 'standard', key: 'x' }, u.token)).status).toBe(400);
  });

  it('aperturas concurrentes desde varias pestañas: nunca más que los cofres disponibles', async () => {
    const u = await signUp();
    const rs = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/api/chests/open', { type: 'standard', key: key() }, u.token)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(2);
    expect(rs.filter((r) => r.body.error === 'no_chest')).toHaveLength(6);
    const c = await db.query('SELECT count(*)::int AS n FROM chest_opening WHERE user_id = $1', [u.id]);
    expect(c.rows[0].n).toBe(2);
    expect((await call('GET', '/api/me', undefined, u.token)).body.wallet.standard).toBe(0);
  });

  it('compras concurrentes: el saldo nunca queda negativo', async () => {
    const u = await signUp();
    const rs = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/api/chests/buy', { type: 'standard', key: key() }, u.token)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(2);
    expect((await call('GET', '/api/me', undefined, u.token)).body.wallet).toMatchObject({ coins: 0, standard: 4 });
  });

  it('doble clic / reintento con la misma clave: una apertura y la misma respuesta', async () => {
    const u = await signUp();
    const k = key();
    const rs = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/api/chests/open', { type: 'standard', key: k }, u.token)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const ids = new Set(rs.map((r) => r.body.openingId));
    expect(ids.size).toBe(1);
    expect(rs.filter((r) => !r.body.replayed)).toHaveLength(1);
    expect(new Set(rs.map((r) => r.body.hero)).size).toBe(1);
    expect((await call('GET', '/api/me', undefined, u.token)).body.wallet.standard).toBe(1);
    // misma clave para otra operación: rechazada
    expect((await call('POST', '/api/chests/buy', { type: 'standard', key: k }, u.token)).status).toBe(409);
  });

  it('fallo de red después de confirmar: el resultado ya está guardado y se recupera', async () => {
    const u = await signUp();
    const k = key();
    const first = await call('POST', '/api/chests/open', { type: 'standard', key: k }, u.token);
    // el cliente "no recibió" la respuesta: al volver ve la apertura pendiente de mostrar
    const me = (await call('GET', '/api/me', undefined, u.token)).body;
    expect(me.unseenOpenings).toContain(first.body.openingId);
    const retry = await call('POST', '/api/chests/open', { type: 'standard', key: k }, u.token);
    expect(retry.body.openingId).toBe(first.body.openingId);
    expect(retry.body.replayed).toBe(true);
    await call('POST', '/api/me/seen', { opening: first.body.openingId }, u.token);
    expect((await call('GET', '/api/me', undefined, u.token)).body.unseenOpenings).toEqual([]);
  });

  it('garantías en el servidor: épica, legendaria y ambas a la vez', async () => {
    const u = await signUp();
    const setPity = (e: number, l: number) => db.query('UPDATE wallet SET pity_epic = $2, pity_legendary = $3, standard_chests = 5 WHERE user_id = $1', [u.id, e, l]);
    await setPity(9, 9);
    const a = await call('POST', '/api/chests/open', { type: 'standard', key: key() }, u.token);
    expect(a.body.guarantee).toBe('epic');
    expect(['epic', 'legendary']).toContain(a.body.rarity);
    await setPity(3, 29);
    const b = await call('POST', '/api/chests/open', { type: 'standard', key: key() }, u.token);
    expect(b.body).toMatchObject({ guarantee: 'legendary', rarity: 'legendary', pity: { sinceEpic: 0, sinceLegendary: 0 } });
    await setPity(9, 29);
    const c = await call('POST', '/api/chests/open', { type: 'standard', key: key() }, u.token);
    expect(c.body).toMatchObject({ guarantee: 'legendary', rarity: 'legendary' });
    // el perfil muestra probabilidades efectivas de la próxima apertura
    await setPity(9, 12);
    const me = (await call('GET', '/api/me', undefined, u.token)).body;
    expect(me.pity.next.standard.guarantee).toBe('epic');
    expect(me.pity.next.standard.odds.common).toBe(0);
  });

  it('duplicados dan Fragmentos y los Fragmentos desbloquean un héroe elegido', async () => {
    const u = await signUp();
    await db.query("INSERT INTO hero_unlock (user_id, hero, source) VALUES ($1, 'hawkeye', 'admin'), ($1, 'widow', 'admin')", [u.id]);
    // común forzado: siempre duplicado
    const rolls = [0, 0];
    const dup = await eco.openChest(u.id, 'standard', key(), () => rolls.shift() ?? 0);
    expect(dup).toMatchObject({ rarity: 'common', duplicate: true, fragments: 10 });
    expect(dup.balance.fragments).toBe(10);
    const tooPoor = await call('POST', '/api/heroes/unlock', { hero: 'cap', key: key() }, u.token);
    expect(tooPoor.status).toBe(409);
    await db.query('UPDATE wallet SET fragments = 260 WHERE user_id = $1', [u.id]);
    const ok = await call('POST', '/api/heroes/unlock', { hero: 'cap', key: key() }, u.token);
    expect(ok.body).toMatchObject({ hero: 'cap', cost: 250, fragments: 10 });
    expect((await call('POST', '/api/heroes/unlock', { hero: 'cap', key: key() }, u.token)).body.error).toBe('owned');
    expect((await call('POST', '/api/heroes/unlock', { hero: 'spider', key: key() }, u.token)).body.error).toBe('starter');
    expect((await call('POST', '/api/heroes/equip', { hero: 'thor' }, u.token)).status).toBe(403);
    expect((await call('POST', '/api/heroes/equip', { hero: 'cap' }, u.token)).body.equipped).toBe('cap');
  });

  it('el libro mayor y las aperturas no se pueden editar ni borrar', async () => {
    await expect(db.query('UPDATE ledger SET coins_delta = 999999')).rejects.toThrow(/sólo inserción/);
    await expect(db.query('DELETE FROM ledger')).rejects.toThrow(/sólo inserción/);
    await expect(db.query('DELETE FROM chest_opening')).rejects.toThrow(/sólo inserción/);
  });
});

describe('administración', () => {
  it('usuario normal (y anfitrión de sala) no accede a entregas; roles sólo por procedimiento de servidor', async () => {
    const u = await signUp();
    expect((await call('GET', '/api/admin/users?q=Ju', undefined, u.token)).status).toBe(403);
    expect((await call('POST', '/api/admin/grant', { userId: u.id, coins: 10, reason: 'pruebas', key: key() }, u.token)).status).toBe(403);
    // no existe ruta para asignarse roles
    expect((await call('POST', '/api/admin/roles', { role: 'economy_admin' }, u.token)).status).toBe(404);
    expect((await call('POST', '/api/auth/update-user', { role: 'economy_admin' }, u.token)).status).not.toBe(500);
    expect(await eco.roles(u.id)).toEqual([]);
  });

  it('entrega a usuario desconectado: vista previa, idempotencia, auditoría y aviso al conectarse', async () => {
    const admin = await signUp('Admin');
    await setRole(db, admin.email, 'economy_admin', true, 'test');
    const target = await signUp('Destino');
    const found = await call('GET', `/api/admin/users?q=${encodeURIComponent('Destino')}`, undefined, admin.token);
    expect(found.body.some((x: any) => x.id === target.id)).toBe(true);
    const body = { userId: target.id, coins: 300, elite: 1, reason: 'Premio del torneo de octubre' };
    const prev = await call('POST', '/api/admin/preview', body, admin.token);
    expect(prev.body).toMatchObject({ userId: target.id, coins: 300, elite: 1, after: { coins: 700, elite: 1 } });
    const k = key();
    const [g1, g2] = await Promise.all([
      call('POST', '/api/admin/grant', { ...body, key: k }, admin.token),
      call('POST', '/api/admin/grant', { ...body, key: k }, admin.token),
    ]);
    expect(g1.status).toBe(200);
    expect(g2.body.after).toEqual(g1.body.after);
    const led = await db.query("SELECT * FROM ledger WHERE user_id = $1 AND kind = 'admin_grant'", [target.id]);
    expect(led.rowCount).toBe(1);
    expect(led.rows[0]).toMatchObject({ actor_id: admin.id, reason: 'Premio del torneo de octubre', coins_delta: 300, elite_delta: 1, coins_after: 700, elite_after: 1 });
    const me = (await call('GET', '/api/me', undefined, target.token)).body;
    expect(me.wallet).toMatchObject({ coins: 700, elite: 1 });
    expect(me.notifications.some((x: any) => x.kind === 'grant' && x.payload.coins === 300)).toBe(true);
    // corrección compensatoria: nuevo movimiento, el original queda
    const corr = await call('POST', '/api/admin/correct', { userId: target.id, coins: 100, reason: 'Se entregaron 100 de más', corrects: Number(led.rows[0].id), key: key() }, admin.token);
    expect(corr.body.after.coins).toBe(600);
    expect((await db.query('SELECT count(*)::int AS n FROM ledger WHERE user_id = $1', [target.id])).rows[0].n).toBe(3);
    const detail = await call('GET', `/api/admin/users/${target.id}`, undefined, admin.token);
    expect(detail.body.ledger[0]).toMatchObject({ kind: 'admin_correction', coins_delta: -100, actor_name: expect.any(String) });
  });

  it('cantidades inválidas, motivo vacío, límites: rechazados (la autoentrega de un admin sí se permite)', async () => {
    const admin = await signUp('Admin');
    await setRole(db, admin.email, 'economy_admin', true, 'test');
    const t = await signUp();
    const bad = async (b: Record<string, unknown>) => (await call('POST', '/api/admin/grant', { userId: t.id, reason: 'motivo válido', key: key(), ...b }, admin.token)).status;
    expect(await bad({ coins: -5 })).toBe(400);
    expect(await bad({ coins: 1.5 })).toBe(400);
    expect(await bad({ coins: 1e30 })).toBe(400);
    expect(await bad({ coins: '100' })).toBe(400);
    expect(await bad({ coins: 5001 })).toBe(400);
    expect(await bad({ standard: 11 })).toBe(400);
    expect(await bad({})).toBe(400);
    expect(await bad({ coins: 5, reason: '' })).toBe(400);
    expect(await bad({ coins: 5, userId: admin.id })).toBe(200);
    // corregir más de lo que tiene: rechazado por la base, sin cambios
    const led = await db.query('SELECT id FROM ledger WHERE user_id = $1 LIMIT 1', [t.id]);
    const over = await call('POST', '/api/admin/correct', { userId: t.id, coins: 5000, reason: 'corrección excesiva', corrects: Number(led.rows[0].id), key: key() }, admin.token);
    expect(over.status).toBe(409);
    expect((await call('GET', '/api/me', undefined, t.token)).body.wallet.coins).toBe(400);
  });
});

describe('partidas oficiales', () => {
  const summary = (id: string, a: string, b: string, over: Partial<MatchSummary> = {}): MatchSummary => ({
    id, mode: 'heroes', startedAt: new Date(Date.now() - 120_000), endedAt: new Date(), matchTicks: 60 * 100,
    score: { red: 2, blue: 0 }, winner: 'red', kicks: { red: 6, blue: 5 }, finished: true,
    participants: [
      { userId: a, team: 'red', hero: 'spider', activeTicks: 60 * 90, present: true },
      { userId: b, team: 'blue', hero: 'batman', activeTicks: 60 * 90, present: true },
    ],
    ...over,
  });

  it('una partida se recompensa una sola vez (40 + 20 por ganar)', async () => {
    const a = await signUp();
    const b = await signUp();
    const m = summary('match-once', a.id, b.id);
    const [r1, r2] = await Promise.all([eco.settleMatch(m), eco.settleMatch(m)]);
    const all = [...r1, ...r2];
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.userId === a.id)!.coins).toBe(60);
    // la bienvenida no se repite aunque la billetera se haya creado al resolver
    expect(all.find((r) => r.userId === b.id)!.coins).toBe(40);
    expect(await eco.settleMatch(m)).toEqual([]);
    const led = await db.query("SELECT count(*)::int AS n FROM ledger WHERE ref = 'match:match-once'");
    expect(led.rows[0].n).toBe(2);
  });

  it('objetivo diario a las 3 partidas (+80, una vez), tope de 400 diarios y semanal a las 15 (+1 élite)', async () => {
    const a = await signUp();
    const opps = await Promise.all(Array.from({ length: 15 }, () => signUp()));
    const results: SettleResult[] = [];
    for (let i = 0; i < 15; i++) results.push(...(await eco.settleMatch(summary(`obj-${a.id}-${i}`, a.id, opps[i].id))).filter((r) => r.userId === a.id));
    expect(results.every((r) => r.eligible)).toBe(true);
    expect(results.filter((r) => r.dailyBonus > 0)).toHaveLength(1);
    expect(results[2].dailyBonus).toBe(ECONOMY.objectives.daily.coins);
    const coins = results.reduce((s, r) => s + r.coins, 0);
    expect(coins).toBe(ECONOMY.match.dailyCap);
    expect(results.filter((r) => r.weeklyElite > 0)).toHaveLength(1);
    expect(results[14].weeklyElite).toBe(1);
    const me = (await call('GET', '/api/me', undefined, a.token)).body;
    expect(me.wallet.coins).toBe(400 + 400 + 80);
    expect(me.wallet.elite).toBe(1);
    expect(me.objectives.daily).toMatchObject({ matches: 15, completed: true });
    expect(me.objectives.matchCoinsToday).toBe(400);
    expect(new Date(me.objectives.daily.resetAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('rivales repetidos: a partir de la cuarta partida del día contra los mismos, sin recompensa', async () => {
    const a = await signUp();
    const b = await signUp();
    const out: SettleResult[] = [];
    for (let i = 0; i < 4; i++) out.push(...(await eco.settleMatch(summary(`rep-${a.id}-${i}`, a.id, b.id))).filter((r) => r.userId === a.id));
    expect(out.map((r) => r.eligible)).toEqual([true, true, true, false]);
  });

  it('resultados falsificados de P2P: no hay forma de enviarlos', async () => {
    const u = await signUp();
    for (const path of ['/api/match/result', '/api/matches', '/api/rewards']) {
      expect((await call('POST', path, { winner: 'red', goals: 3, userId: u.id }, u.token)).status).toBe(404);
    }
    expect(parseClientMessage('{"t":"result","winner":"red"}')).toBeNull();
    expect(parseClientMessage('{"t":"reward","coins":999}')).toBeNull();
    // una sala sin servicio de economía (como el anfitrión P2P) no puede ser oficial
    const p2p = new Lobby(null);
    const room = p2p.create('p2p', { official: true });
    expect(room.official).toBe(false);
    expect(room.setSettings(room.hostId, { official: true })).not.toBeNull();
    expect((await call('GET', '/api/me', undefined, u.token)).body.wallet.coins).toBe(400);
  });
});

describe('sala oficial en el servidor', () => {
  function fakeClient(id: string, inbox: ServerMsg[]): Client {
    return { id, nick: '', room: null, ping: 0, send: (m) => inbox.push(typeof m === 'string' ? JSON.parse(m) : m) };
  }
  const identify = async (token: string): Promise<AccountInfo | null> => {
    const u = await sessionUser(auth, bearerHeaders(token));
    if (!u) return null;
    await eco.ensureAccount(u.id);
    return { userId: u.id, name: u.name, roles: await eco.roles(u.id) };
  };
  const flush = () => new Promise((r) => setTimeout(r, 120));

  it('héroe bloqueado rechazado por el servidor; desbloqueado aceptado; invitados sólo miran', async () => {
    const settled: MatchSummary[] = [];
    const adapter = eco.adapter();
    const lobby = new Lobby({ ownedHeroes: adapter.ownedHeroes, settle: async (m) => { settled.push(m); return adapter.settle(m); } });
    const u = await signUp();
    const inbox: ServerMsg[] = [];
    const c = fakeClient('c1', inbox);
    const h = createHandler(lobby, c, { identify });
    h.onMessage(JSON.stringify({ t: 'hello', nick: 'Impostor', v: 1, token: u.token }));
    await flush();
    const welcome = inbox.find((m) => m.t === 'welcome') as Extract<ServerMsg, { t: 'welcome' }>;
    expect(welcome.account?.userId).toBe(u.id);
    expect(c.nick).not.toBe('Impostor');
    h.onMessage(JSON.stringify({ t: 'create', name: 'Oficial', settings: { official: true, mode: 'heroes' } }));
    const room = c.room!;
    expect(room.official).toBe(true);
    h.onMessage(JSON.stringify({ t: 'hero', hero: 'thor' }));
    await flush();
    expect(inbox.some((m) => m.t === 'error' && /bloqueado/.test(m.msg))).toBe(true);
    expect(room.members.get('c1')!.hero).toBe('spider');
    await db.query("INSERT INTO hero_unlock (user_id, hero, source) VALUES ($1, 'thor', 'admin')", [u.id]);
    h.onMessage(JSON.stringify({ t: 'hero', hero: 'thor' }));
    await flush();
    expect(room.members.get('c1')!.hero).toBe('thor');
    // invitado (sin token): puede entrar a mirar pero no jugar
    const gInbox: ServerMsg[] = [];
    const g = fakeClient('g1', gInbox);
    const gh = createHandler(lobby, g, { identify });
    gh.onMessage(JSON.stringify({ t: 'hello', nick: 'Invitado', v: 1 }));
    await flush();
    gh.onMessage(JSON.stringify({ t: 'join', room: room.id }));
    gh.onMessage(JSON.stringify({ t: 'side', side: 'red' }));
    expect(gInbox.some((m) => m.t === 'error' && /cuentas registradas/.test(m.msg))).toBe(true);
    expect(room.addBot(room.hostId, 'blue')).toMatch(/bots/);
    // un token falso no da identidad
    const fInbox: ServerMsg[] = [];
    const f = fakeClient('f1', fInbox);
    createHandler(lobby, f, { identify }).onMessage(JSON.stringify({ t: 'hello', nick: 'X', v: 1, token: 'falso' }));
    await flush();
    expect(f.userId).toBeUndefined();
  });

  it('partido oficial completo simulado por el servidor: recompensa a ambos y avisa por WebSocket', async () => {
    const settled: SettleResult[][] = [];
    const adapter = eco.adapter();
    const lobby = new Lobby({ ownedHeroes: adapter.ownedHeroes, settle: async (m) => { const r = await adapter.settle(m); settled.push(r); return r; } });
    const [ua, ub] = [await signUp(), await signUp()];
    const ia: ServerMsg[] = [];
    const ib: ServerMsg[] = [];
    const ca = fakeClient('a', ia);
    const cb = fakeClient('b', ib);
    const ha = createHandler(lobby, ca, { identify });
    const hb = createHandler(lobby, cb, { identify });
    ha.onMessage(JSON.stringify({ t: 'hello', nick: 'A', v: 1, token: ua.token }));
    hb.onMessage(JSON.stringify({ t: 'hello', nick: 'B', v: 1, token: ub.token }));
    await flush();
    ha.onMessage(JSON.stringify({ t: 'create', name: 'Final', settings: { official: true, mode: 'classic', timeLimitMin: 1, scoreLimit: 0, teamSize: 1 } }));
    const room = ca.room!;
    hb.onMessage(JSON.stringify({ t: 'join', room: room.id }));
    expect(room.setSide('a', 'red')).toBeNull();
    expect(room.setSide('b', 'blue')).toBeNull();
    expect(room.start('a')).toBeNull();
    const g = room.game!;
    let seq = 0;
    for (let t = 0; t < 60 * 75 && room.game; t++) {
      seq++;
      // ambos se mueven (activos) y patean cada 2 s con la pelota a su lado
      const dir = (t >> 5) & 1 ? IN.UP : IN.DOWN;
      const kick = t % 120 === 1 ? IN.KICK : 0;
      if (t % 120 === 0 && g.phase === 'playing') {
        const who = (t / 120) % 2 === 0 ? 'a' : 'b';
        const p = g.players.find((x) => x.id === who)!;
        g.ball.x = p.d.x + (who === 'a' ? 26 : -26); g.ball.y = p.d.y; g.ball.vx = 0; g.ball.vy = 0;
      }
      // directo a la sala: el limitador de frecuencia descartaría miles de entradas sin tiempo real
      room.pushInput('a', seq, dir | (kick && (t / 120) % 2 < 1 ? kick : 0));
      room.pushInput('b', seq, dir | (kick && (t / 120) % 2 >= 1 ? kick : 0));
      if (g.phase === 'kickoff' && t > 5) { g.ball.vx = 0.01; }
      // un gol para que no termine empatado
      if (t === 60 * 30) g.score.red = 1;
      room.tick();
    }
    await flush();
    expect(settled).toHaveLength(1);
    const res = settled[0];
    expect(res.find((r) => r.userId === ua.id)).toMatchObject({ eligible: true, coins: 60 });
    expect(res.find((r) => r.userId === ub.id)).toMatchObject({ eligible: true, coins: 40 });
    expect(ia.some((m) => m.t === 'reward' && m.r.coins === 60)).toBe(true);
    expect(ib.some((m) => m.t === 'reward' && m.r.coins === 40)).toBe(true);
  }, 60_000);

  it('detener o reiniciar antes del final: no entrega nada', async () => {
    let calls = 0;
    const lobby = new Lobby({ ownedHeroes: eco.adapter().ownedHeroes, settle: async () => { calls++; return []; } });
    const [ua, ub] = [await signUp(), await signUp()];
    const ca = fakeClient('a', []);
    const cb = fakeClient('b', []);
    const ha = createHandler(lobby, ca, { identify });
    const hb = createHandler(lobby, cb, { identify });
    ha.onMessage(JSON.stringify({ t: 'hello', nick: 'A', v: 1, token: ua.token }));
    hb.onMessage(JSON.stringify({ t: 'hello', nick: 'B', v: 1, token: ub.token }));
    await flush();
    ha.onMessage(JSON.stringify({ t: 'create', name: 'X', settings: { official: true, mode: 'heroes', timeLimitMin: 1, scoreLimit: 1, teamSize: 1 } }));
    const room = ca.room!;
    hb.onMessage(JSON.stringify({ t: 'join', room: room.id }));
    room.setSide('a', 'red');
    room.setSide('b', 'blue');
    room.start('a');
    for (let i = 0; i < 600; i++) room.tick();
    room.restart('a');
    for (let i = 0; i < 600; i++) room.tick();
    room.stop('a');
    expect(calls).toBe(0);
  });
});

describe('personaje secreto (Thanos)', () => {
  function fakeClient(id: string, inbox: ServerMsg[]): Client {
    return { id, nick: '', room: null, ping: 0, send: (m) => inbox.push(typeof m === 'string' ? JSON.parse(m) : m) };
  }
  const identify = async (token: string): Promise<AccountInfo | null> => {
    const u = await sessionUser(auth, bearerHeaders(token));
    if (!u) return null;
    await eco.ensureAccount(u.id);
    return { userId: u.id, name: u.name, roles: await eco.roles(u.id) };
  };
  const flush = () => new Promise((r) => setTimeout(r, 120));

  it('sólo un admin lo asigna o retira: motivo, vista previa, sin duplicados, auditoría y aviso', async () => {
    const admin = await signUp('Admin');
    await setRole(db, admin.email, 'economy_admin', true, 'test');
    const u = await signUp('Elegido');
    const body = (o: Record<string, unknown> = {}) => ({ userId: u.id, hero: 'thanos', action: 'grant', reason: 'premio del torneo', key: key(), ...o });
    // sin rol: rechazado (aunque se lo pida a sí mismo)
    expect((await call('POST', '/api/admin/secret', body({ userId: u.id }), u.token)).status).toBe(403);
    // motivo vacío, héroe no secreto, acción inválida
    expect((await call('POST', '/api/admin/secret', body({ reason: '' }), admin.token)).status).toBe(400);
    expect((await call('POST', '/api/admin/secret', body({ hero: 'thor' }), admin.token)).status).toBe(400);
    expect((await call('POST', '/api/admin/secret', body({ action: 'gift' }), admin.token)).status).toBe(400);
    // vista previa: nombra al destinatario y no aplica nada
    const pv = await call('POST', '/api/admin/secret/preview', body(), admin.token);
    expect(pv.status).toBe(200);
    expect(pv.body).toMatchObject({ userId: u.id, name: expect.stringContaining('Elegido'), action: 'grant', valid: true, owned: false });
    expect((await db.query("SELECT 1 FROM hero_unlock WHERE user_id = $1 AND hero = 'thanos'", [u.id])).rowCount).toBe(0);
    // asignar (idempotente por clave), y un segundo pedido distinto: ya lo tiene
    const k = key();
    const [g1, g2] = await Promise.all([call('POST', '/api/admin/secret', body({ key: k }), admin.token), call('POST', '/api/admin/secret', body({ key: k }), admin.token)]);
    expect([g1.status, g2.status]).toEqual([200, 200]);
    expect((await call('POST', '/api/admin/secret', body(), admin.token)).body.error).toBe('owned');
    expect((await db.query("SELECT count(*)::int AS n FROM hero_unlock WHERE user_id = $1 AND hero = 'thanos'", [u.id])).rows[0].n).toBe(1);
    // el usuario lo ve en su colección y lo puede equipar; no lo puede "desbloquear"
    const me = await call('GET', '/api/me', undefined, u.token);
    expect(me.body.heroes.some((h: { hero: string }) => h.hero === 'thanos')).toBe(true);
    expect((await call('POST', '/api/heroes/equip', { hero: 'thanos' }, u.token)).status).toBe(200);
    // retirar: vuelve a Spider-Man, y retirarlo otra vez no tiene efecto
    expect((await call('POST', '/api/admin/secret', body({ action: 'revoke', reason: 'fin del premio' }), admin.token)).status).toBe(200);
    expect((await call('POST', '/api/admin/secret', body({ action: 'revoke', reason: 'fin del premio' }), admin.token)).body.error).toBe('not_owned');
    expect((await db.query('SELECT equipped_hero FROM wallet WHERE user_id = $1', [u.id])).rows[0].equipped_hero).toBe('spider');
    // auditoría (sólo inserción) y avisos
    const audit = await db.query('SELECT action, actor_id, reason FROM hero_grant WHERE user_id = $1 ORDER BY id', [u.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['grant', 'revoke']);
    expect(audit.rows.every((r) => r.actor_id === admin.id)).toBe(true);
    await expect(db.query("UPDATE hero_grant SET reason = 'otro motivo' WHERE user_id = $1", [u.id])).rejects.toThrow();
    const notes = await db.query("SELECT kind FROM notification WHERE user_id = $1 AND kind LIKE 'hero_%' ORDER BY id", [u.id]);
    expect(notes.rows.map((r) => r.kind)).toEqual(['hero_grant', 'hero_revoke']);
    const detail = await call('GET', `/api/admin/users/${u.id}`, undefined, admin.token);
    expect(detail.body.heroGrants.length).toBe(2);
  });

  it('nunca se desbloquea con Fragmentos ni sale en cofres', async () => {
    const u = await signUp();
    await db.query('UPDATE wallet SET fragments = 100000 WHERE user_id = $1', [u.id]);
    const r = await call('POST', '/api/heroes/unlock', { hero: 'thanos', key: key() }, u.token);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('secret');
    await db.query('UPDATE wallet SET standard_chests = 30, elite_chests = 30 WHERE user_id = $1', [u.id]);
    for (let i = 0; i < 30; i++) {
      for (const type of ['standard', 'elite']) {
        const o = await call('POST', '/api/chests/open', { type, key: key() }, u.token);
        expect(o.status).toBe(200);
        expect(o.body.hero).not.toBe('thanos');
      }
    }
  });

  it('sala: sólo con «Personajes especiales», cuenta dueña y servidor; nunca oficial ni P2P', async () => {
    const lobby = new Lobby({ ownedHeroes: eco.adapter().ownedHeroes, settle: async () => [] });
    const owner = await signUp('Dueño');
    const other = await signUp('Otro');
    await db.query("INSERT INTO hero_unlock (user_id, hero, source) VALUES ($1, 'thanos', 'admin')", [owner.id]);
    const io: ServerMsg[] = [];
    const co = fakeClient('o1', io);
    const ho = createHandler(lobby, co, { identify });
    ho.onMessage(JSON.stringify({ t: 'hello', nick: 'Dueño', v: 1, token: owner.token }));
    await flush();
    // sala casual sin especiales: rechazado aunque sea suyo
    ho.onMessage(JSON.stringify({ t: 'create', name: 'Casual', settings: { mode: 'heroes' } }));
    const room = co.room!;
    ho.onMessage(JSON.stringify({ t: 'hero', hero: 'thanos' }));
    await flush();
    expect(room.members.get('o1')!.hero).not.toBe('thanos');
    // con especiales: aceptado; la sala no puede ser oficial
    ho.onMessage(JSON.stringify({ t: 'settings', settings: { specials: true, official: true } }));
    await flush();
    expect(io.some((m) => m.t === 'error' && /no puede ser oficial/.test(m.msg))).toBe(true);
    ho.onMessage(JSON.stringify({ t: 'settings', settings: { specials: true } }));
    await flush();
    expect(room.specials).toBe(true);
    expect(room.setSettings(room.hostId, { official: true })).not.toBeNull();
    expect(room.official).toBe(false);
    ho.onMessage(JSON.stringify({ t: 'hero', hero: 'thanos' }));
    await flush();
    expect(room.members.get('o1')!.hero).toBe('thanos');
    // otra cuenta sin Thanos en la misma sala: rechazado por el servidor
    const xo: ServerMsg[] = [];
    const cx = fakeClient('x1', xo);
    const hx = createHandler(lobby, cx, { identify });
    hx.onMessage(JSON.stringify({ t: 'hello', nick: 'Otro', v: 1, token: other.token }));
    await flush();
    hx.onMessage(JSON.stringify({ t: 'join', room: room.id }));
    hx.onMessage(JSON.stringify({ t: 'hero', hero: 'thanos' }));
    await flush();
    expect(room.members.get('x1')!.hero).not.toBe('thanos');
    expect(xo.some((m) => m.t === 'error')).toBe(true);
    // al retirarlo, deja de valer en la sala
    await db.query("DELETE FROM hero_unlock WHERE user_id = $1 AND hero = 'thanos'", [owner.id]);
    await lobby.refreshOwned(owner.id);
    expect(room.members.get('o1')!.hero).toBe('spider');
    // P2P (sin servidor de cuentas): nunca hay especiales
    const p2p = new Lobby(null);
    const pr = p2p.create('p2p', { specials: true });
    expect(pr.specials).toBe(false);
  });
});
