// Cliente de cuentas: una operación sin respuesta queda pendiente con su clave
// y se confirma reenviando la MISMA clave (nunca un reintento a ciegas).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../client/src/game/transport', () => ({ P2P: false }));

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

type Call = { url: string; body: Record<string, unknown> | null };
const calls: Call[] = [];
let respond: (c: Call) => Promise<Response>;
vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
  const c = { url, body: init.body ? JSON.parse(String(init.body)) : null };
  calls.push(c);
  return respond(c);
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const { account, ApiError, UnknownOutcome } = await import('../client/src/account');

describe('operaciones económicas desde el cliente', () => {
  beforeEach(() => {
    calls.length = 0;
    account.discardPending();
  });

  it('sin respuesta: queda pendiente y «Comprobar» reenvía la misma clave', async () => {
    respond = async (c) => {
      if (c.url.endsWith('/api/me')) return json(401, {});
      throw new TypeError('network down');
    };
    await expect(account.mutate('/api/chests/open', { type: 'standard' }, 'Abrir cofre')).rejects.toBeInstanceOf(UnknownOutcome);
    const first = calls.find((c) => c.url.endsWith('/api/chests/open'))!;
    expect(account.unresolved?.key).toBe(first.body!.key);
    // la clave sobrevive a recargar la página
    expect(JSON.parse(store.get('heroball.pending.v1')!).key).toBe(first.body!.key);

    respond = async (c) => (c.url.endsWith('/api/me') ? json(401, {}) : json(200, { openingId: 7, replayed: true }));
    const r = await account.resolvePending<{ openingId: number }>();
    const second = calls.filter((c) => c.url.endsWith('/api/chests/open'))[1];
    expect(second.body!.key).toBe(first.body!.key);
    expect(r?.openingId).toBe(7);
    expect(account.unresolved).toBeNull();
    expect(store.has('heroball.pending.v1')).toBe(false);
  });

  it('con respuesta de error del servidor: no queda pendiente (se sabe que no se aplicó)', async () => {
    respond = async (c) => (c.url.endsWith('/api/me') ? json(401, {}) : json(409, { error: 'insufficient', message: 'Te faltan 100 HeroCoins para este cofre.' }));
    const err = (await account.mutate('/api/chests/buy', { type: 'elite' }, 'Comprar').catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/Te faltan/);
    expect(account.unresolved).toBeNull();
  });

  it('mientras la solicitud está en curso no se muestra como «sin respuesta»', async () => {
    let release!: () => void;
    respond = (c) => (c.url.endsWith('/api/me') ? Promise.resolve(json(401, {})) : new Promise((ok) => { release = () => ok(json(200, { ok: true })); }));
    const p = account.mutate('/api/chests/buy', { type: 'standard' }, 'Comprar');
    await Promise.resolve();
    expect(account.pending).not.toBeNull();
    expect(account.unresolved).toBeNull();
    release();
    await p;
    expect(account.pending).toBeNull();
  });

  it('cada operación nueva usa una clave distinta', async () => {
    respond = async (c) => (c.url.endsWith('/api/me') ? json(401, {}) : json(200, {}));
    await account.mutate('/api/chests/buy', { type: 'standard' }, 'a');
    await account.mutate('/api/chests/buy', { type: 'standard' }, 'b');
    const keys = calls.filter((c) => c.url.endsWith('/api/chests/buy')).map((c) => c.body!.key);
    expect(new Set(keys).size).toBe(2);
  });
});
