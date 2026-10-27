// API HTTP de cuentas y economía. Cada ruta obtiene el usuario de la sesión
// verificada por Better Auth (token Bearer); el cuerpo nunca aporta la
// identidad, los roles ni los saldos.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { signAdmin } from '../shared/admin';
import { ECONOMY } from '../shared/economy';
import { sessionUser, type Auth } from './auth';
import { Economy, EconomyError } from './economy';

const MAX_BODY = 16 * 1024;

export interface ApiOptions {
  auth: Auth;
  economy: Economy;
  /** Orígenes permitidos para CORS (p. ej. https://kamuluuuu-ai.github.io). */
  origins: string[];
  /** Clave privada (PKCS#8 base64) para firmar permisos de moderación en salas P2P. */
  moderatorSigningKey?: string;
  /** Aviso a las salas cuando cambia la colección de una cuenta (asignación o retiro de un secreto). */
  onHeroesChanged?: (userId: string) => void;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const ch of req) {
    size += (ch as Buffer).length;
    if (size > MAX_BODY) throw new EconomyError('too_large', 'Solicitud demasiado grande.', 413);
    chunks.push(ch as Buffer);
  }
  if (!size) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new EconomyError('bad_json', 'Cuerpo JSON inválido.');
  }
}

/** Cabeceras CORS: el frontend estático vive en otro origen y usa token Bearer (sin cookies). */
export function applyCors(req: IncomingMessage, res: ServerResponse, origins: string[]): boolean {
  const origin = req.headers.origin;
  if (origin && origins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-expose-headers', 'set-auth-token');
    res.setHeader('access-control-max-age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(origin && origins.includes(origin) ? 204 : 403);
    res.end();
    return true;
  }
  return false;
}

export function createApi(o: ApiOptions): Handler {
  const authHandler = toNodeHandler(o.auth);
  const eco = o.economy;

  const user = async (req: IncomingMessage) => {
    const u = await sessionUser(o.auth, fromNodeHeaders(req.headers));
    if (!u) throw new EconomyError('unauthorized', 'Iniciá sesión para usar esta función.', 401);
    return u;
  };

  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    if (!path.startsWith('/api/')) return false;
    if (applyCors(req, res, o.origins)) return true;
    if (path.startsWith('/api/auth/')) {
      await authHandler(req, res);
      return true;
    }
    const get = req.method === 'GET';
    const post = req.method === 'POST';
    try {
      if (get && path === '/api/economy/config') {
        json(res, 200, { version: ECONOMY.version, chests: ECONOMY.chests, pity: ECONOMY.pity, duplicateFragments: ECONOMY.duplicateFragments, unlockCost: ECONOMY.unlockCost, welcome: ECONOMY.welcome, match: ECONOMY.match, objectives: ECONOMY.objectives });
        return true;
      }
      if (get && path === '/api/me') {
        const u = await user(req);
        json(res, 200, await eco.profile(u.id));
        return true;
      }
      if (post && path === '/api/me/seen') {
        const u = await user(req);
        const b = await readBody(req);
        if (b.opening !== undefined) await eco.markOpeningSeen(u.id, b.opening);
        if (b.notifications !== undefined) await eco.markNotificationsSeen(u.id, b.notifications);
        json(res, 200, { ok: true });
        return true;
      }
      if (post && path === '/api/chests/buy') {
        const u = await user(req);
        const b = await readBody(req);
        await eco.ensureAccount(u.id);
        json(res, 200, await eco.buyChest(u.id, b.type, b.key));
        return true;
      }
      if (post && path === '/api/chests/open') {
        const u = await user(req);
        const b = await readBody(req);
        await eco.ensureAccount(u.id);
        json(res, 200, await eco.openChest(u.id, b.type, b.key));
        return true;
      }
      if (post && path === '/api/heroes/unlock') {
        const u = await user(req);
        const b = await readBody(req);
        await eco.ensureAccount(u.id);
        json(res, 200, await eco.unlockHero(u.id, b.hero, b.key));
        return true;
      }
      if (post && path === '/api/heroes/equip') {
        const u = await user(req);
        const b = await readBody(req);
        await eco.ensureAccount(u.id);
        json(res, 200, { equipped: await eco.equipHero(u.id, b.hero) });
        return true;
      }
      if (post && path === '/api/moderation/ticket') {
        // firma para que un anfitrión P2P reconozca a un moderador; la clave nunca sale del servidor
        const u = await user(req);
        await eco.requireRole(u.id, 'moderator');
        if (!o.moderatorSigningKey) throw new EconomyError('no_key', 'Este servidor no tiene configurada la firma de moderación.', 503);
        const b = await readBody(req);
        if (typeof b.nonce !== 'string' || b.nonce.length > 64 || typeof b.clientId !== 'string' || b.clientId.length > 32) throw new EconomyError('bad_ticket', 'Desafío inválido.');
        json(res, 200, { sig: await signAdmin(o.moderatorSigningKey, b.nonce, b.clientId) });
        return true;
      }
      if (get && path === '/api/admin/users') {
        const u = await user(req);
        json(res, 200, await eco.searchUsers(u.id, url.searchParams.get('q')));
        return true;
      }
      const detail = /^\/api\/admin\/users\/([A-Za-z0-9_-]{1,64})$/.exec(path);
      if (get && detail) {
        const u = await user(req);
        json(res, 200, await eco.userDetail(u.id, detail[1]));
        return true;
      }
      if (post && (path === '/api/admin/preview' || path === '/api/admin/grant' || path === '/api/admin/correct')) {
        const u = await user(req);
        const b = await readBody(req);
        const correction = path === '/api/admin/correct' || (path === '/api/admin/preview' && b.correction === true);
        json(res, 200, path === '/api/admin/preview' ? await eco.previewGrant(u.id, b, correction) : await eco.grant(u.id, b, correction));
        return true;
      }
      if (post && (path === '/api/admin/secret/preview' || path === '/api/admin/secret')) {
        const u = await user(req);
        const b = await readBody(req);
        if (path === '/api/admin/secret/preview') json(res, 200, await eco.previewSecret(u.id, b));
        else {
          const out = await eco.setSecret(u.id, b);
          o.onHeroesChanged?.(out.userId);
          json(res, 200, out);
        }
        return true;
      }
      return false;
    } catch (e) {
      if (e instanceof EconomyError) {
        json(res, e.status, { error: e.code, message: e.message });
      } else {
        console.error('Error de API', path, e);
        json(res, 500, { error: 'internal', message: 'Error interno: la operación no se completó o no se pudo confirmar. Recargá tu perfil antes de reintentar.' });
      }
      return true;
    }
  };
}
