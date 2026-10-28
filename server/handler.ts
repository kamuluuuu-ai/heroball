// Manejo de mensajes de un cliente conectado. Sin dependencias de Node: lo usa
// el servidor WebSocket y también el navegador anfitrión en modo WebRTC.
import { makeNonce, verifyAdmin, verifyHeroes } from '../shared/admin';
import { isSecret } from '../shared/config';
import { MAX_NICK, PROTOCOL_VERSION, cleanText, parseClientMessage, type AccountInfo } from '../shared/protocol';
import { RateLimiter } from './rate';
import type { Client, Lobby } from './room';

export interface HandlerOptions {
  /** Sólo para el modo anfitrión en navegador: una única sala con id fijo. */
  singleRoomId?: string;
  onAbuse?: () => void;
  /**
   * Clave pública que verifica las firmas del servidor. Un anfitrión P2P la pide
   * a la API (función: `refresh` = volver a pedirla si una firma no coincide,
   * p. ej. porque el servidor se reinició con una clave nueva).
   */
  adminPublicKey?: JsonWebKey | ((refresh: boolean) => Promise<JsonWebKey | undefined>);
  /**
   * Sólo el servidor con cuentas: valida el token de sesión y devuelve la
   * cuenta. El anfitrión P2P no lo tiene, así que nunca identifica cuentas.
   */
  identify?: (token: string) => Promise<AccountInfo | null>;
}

/** Verifica con la clave actual y, si falla y la clave viene de la API, con la clave recién pedida. */
async function verifyWith(opts: HandlerOptions, check: (key?: JsonWebKey) => Promise<boolean>): Promise<boolean> {
  const k = opts.adminPublicKey;
  if (typeof k !== 'function') return check(k);
  const first = await k(false).catch(() => undefined);
  if (await check(first)) return true;
  const fresh = await k(true).catch(() => undefined);
  return !!fresh && fresh !== first && check(fresh);
}

export function createHandler(lobby: Lobby, client: Client, opts: HandlerOptions = {}) {
  // límites de frecuencia por tipo de mensaje
  const inputRate = new RateLimiter(90, 40);
  const chatRate = new RateLimiter(1.5, 4);
  const ctrlRate = new RateLimiter(8, 16);
  let strikes = 0;
  // desafío de administrador, distinto en cada conexión
  const nonce = makeNonce();
  let adminTries = 0;
  let heroTries = 0;
  let hello: Promise<void> | null = null;
  const reject = (msg?: string) => {
    if (msg) client.send({ t: 'error', msg });
    if (++strikes > 200) opts.onAbuse?.();
  };

  const onMessage = (raw: string) => {
    const m = parseClientMessage(raw);
    if (!m) return reject();
    if (m.t === 'in') {
      if (!inputRate.take()) return;
      client.room?.pushInput(client.id, m.s, m.b);
      return;
    }
    if (m.t === 'ping') {
      if (m.r !== undefined) client.ping = m.r;
      client.send({ t: 'pong', c: m.c });
      return;
    }
    if (m.t === 'chat') {
      if (!chatRate.take()) return reject('Estás enviando mensajes muy rápido.');
      client.room?.chat(client.id, m.text);
      return;
    }
    if (!ctrlRate.take()) return reject('Demasiadas acciones seguidas.');
    if (m.t === 'hello') {
      if (client.nick || hello) return;
      const nick = cleanText(m.nick, MAX_NICK);
      if (!nick) return reject('Apodo inválido.');
      hello = (async () => {
        let account: AccountInfo | null = null;
        if (m.token && opts.identify) {
          account = await opts.identify(m.token).catch(() => null);
        }
        if (account) {
          // el apodo visible es el de la cuenta: nadie se apropia de otra por usar su nombre
          client.userId = account.userId;
          client.nick = cleanText(account.name, MAX_NICK) || nick;
          if (account.roles.includes('moderator')) client.admin = true;
          if (lobby.official) client.owned = await lobby.official.ownedHeroes(account.userId).catch(() => undefined);
        } else {
          client.nick = nick;
        }
        client.send({ t: 'welcome', id: client.id, v: PROTOCOL_VERSION, nonce, account, official: !!lobby.official });
      })();
      return;
    }
    if (m.t === 'admin') {
      if (client.admin) return;
      if (++adminTries > 3) return reject('Demasiados intentos de administrador.');
      void verifyWith(opts, (key) => verifyAdmin(m.sig, nonce, client.id, key)).then((ok) => {
        if (ok) {
          client.admin = true;
          client.room?.sendRoom();
        }
        client.send({ t: 'admin', ok });
      });
      return;
    }
    if (m.t === 'heroes') {
      // con servidor de cuentas la colección se lee de la base de datos
      if (lobby.official) return;
      if (++heroTries > 5) return reject('Demasiados intentos.');
      void verifyWith(opts, (key) => verifyHeroes(m.sig, nonce, client.id, m.heroes, key)).then((ok) => {
        if (ok) {
          client.owned = new Set(m.heroes.filter(isSecret));
          // lista nueva sin el personaje que estaba usando (retiro): vuelve a Spider-Man
          const r = client.room;
          const me = r?.members.get(client.id);
          if (r && me && isSecret(me.hero) && !r.heroAllowed(client, me.hero)) r.setHero(client.id, 'spider');
        }
        client.send({ t: 'heroes', ok });
      });
      return;
    }
    if (!client.nick) return reject('Primero elegí un apodo.');
    const room = client.room;
    let err: string | null = null;
    switch (m.t) {
      case 'list':
        client.send({ t: 'rooms', rooms: lobby.list() });
        return;
      case 'create': {
        if (opts.singleRoomId && lobby.rooms.size > 0) return reject('Ya hay una sala en este anfitrión.');
        room?.leave(client.id);
        const r = lobby.create(m.name, m.settings, opts.singleRoomId);
        err = r.join(client);
        break;
      }
      case 'join': {
        const r = lobby.rooms.get(m.room);
        if (!r) return reject('La sala no existe o ya se cerró.');
        if (r === room) return;
        room?.leave(client.id);
        err = r.join(client);
        break;
      }
      case 'leave':
        room?.leave(client.id);
        client.send({ t: 'left' });
        return;
    }
    if (!room) {
      if (err) reject(err);
      return;
    }
    switch (m.t) {
      case 'side': err = room.setSide(client.id, m.side, m.target); break;
      case 'hero':
        if ((room.official || isSecret(m.hero)) && client.userId && lobby.official) {
          // colección leída en el servidor en cada cambio (no se confía en el cliente)
          const uid = client.userId;
          void lobby.official.ownedHeroes(uid).then((owned) => {
            client.owned = owned;
            const e = client.room?.setHero(client.id, m.hero);
            if (e) reject(e);
          }, () => reject('No se pudo comprobar tu colección. Probá de nuevo.'));
          return;
        }
        err = room.setHero(client.id, m.hero);
        break;
      case 'settings': err = room.setSettings(client.id, m.settings); break;
      case 'start': err = room.start(client.id); break;
      case 'stop': err = room.stop(client.id); break;
      case 'pause': err = room.pause(client.id); break;
      case 'restart': err = room.restart(client.id); break;
      case 'addbot': err = room.addBot(client.id, m.side); break;
      case 'kick': err = room.kickMember(client.id, m.target); break;
      case 'makehost': err = room.makeHost(client.id, m.target); break;
    }
    if (err) reject(err);
  };

  return {
    onMessage,
    onClose: () => client.room?.leave(client.id),
  };
}
