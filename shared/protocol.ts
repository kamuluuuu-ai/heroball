// Protocolo cliente-servidor (JSON sobre WebSocket) y validación de mensajes.
import { HERO_IDS, HeroId } from './config';
import type { GameEvent, GameMode, GameState, Side, Team } from './types';

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 2048;
export const MAX_NICK = 20;
export const MAX_CHAT = 140;
export const MAX_ROOM_NAME = 32;

export interface RoomSettings {
  mode: GameMode;
  timeLimitMin: number;
  scoreLimit: number;
  /** Jugadores por equipo (1v1, 2v2, 3v3). */
  teamSize: 1 | 2 | 3;
  /** Capacidad total incluyendo espectadores. */
  maxPlayers: number;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  mode: 'heroes',
  timeLimitMin: 3,
  scoreLimit: 3,
  teamSize: 3,
  maxPlayers: 10,
};

export interface RoomSummary {
  id: string;
  name: string;
  players: number;
  maxPlayers: number;
  mode: GameMode;
  teamSize: number;
  playing: boolean;
}

export interface RoomMember {
  id: string;
  nick: string;
  side: Side;
  hero: HeroId;
  bot: boolean;
  host: boolean;
  /** Administrador verificado con clave firmada. */
  admin: boolean;
  ping: number;
}

export interface RoomInfo {
  id: string;
  name: string;
  settings: RoomSettings;
  members: RoomMember[];
  hostId: string;
  playing: boolean;
}

/** Estado detallado de la sala, sólo para administradores. */
export interface AdminState {
  /** Segundos desde que se creó la sala. */
  uptime: number;
  game: null | {
    phase: string;
    paused: boolean;
    score: { red: number; blue: number };
    /** Segundos jugados y límite (0 = sin límite). */
    time: number;
    timeLimit: number;
    overtime: boolean;
    tick: number;
  };
  /** Tamaño del último snapshot enviado (bytes). */
  snapBytes: number;
  members: {
    id: string;
    nick: string;
    side: Side;
    bot: boolean;
    admin: boolean;
    ping: number;
    /** Entradas en cola y ticks sin recibir entradas. */
    queue: number;
    starved: number;
    ack: number;
  }[];
}

export type ClientMsg =
  | { t: 'hello'; nick: string; v: number }
  | { t: 'list' }
  | { t: 'create'; name: string; settings: Partial<RoomSettings> }
  | { t: 'join'; room: string }
  | { t: 'leave' }
  | { t: 'chat'; text: string }
  | { t: 'side'; side: Side; target?: string }
  | { t: 'hero'; hero: HeroId }
  | { t: 'settings'; settings: Partial<RoomSettings> }
  | { t: 'start' }
  | { t: 'stop' }
  | { t: 'pause' }
  | { t: 'restart' }
  | { t: 'addbot'; side: Team }
  | { t: 'kick'; target: string }
  | { t: 'admin'; sig: string }
  | { t: 'makehost'; target: string }
  | { t: 'in'; s: number; b: number }
  | { t: 'ping'; c: number; r?: number };

export type ServerMsg =
  | { t: 'welcome'; id: string; v: number; nonce: string }
  | { t: 'admin'; ok: boolean }
  | { t: 'adminstate'; s: AdminState }
  | { t: 'rooms'; rooms: RoomSummary[] }
  | { t: 'room'; room: RoomInfo }
  | { t: 'left'; reason?: string }
  | { t: 'chat'; from: string | null; nick: string; text: string; team?: Side }
  | { t: 'snap'; ack: number; state: GameState; ev: GameEvent[] }
  | { t: 'nogame' }
  | { t: 'pong'; c: number }
  | { t: 'error'; msg: string };

const SIDES: Side[] = ['red', 'blue', 'spec'];
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

export function cleanText(s: string, max: number): string {
  // sin caracteres de control; el cliente nunca inserta esto como HTML
  return s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

export function sanitizeSettings(raw: unknown): Partial<RoomSettings> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const out: Partial<RoomSettings> = {};
  if ('mode' in r) {
    if (r.mode !== 'classic' && r.mode !== 'heroes' && r.mode !== 'super') return null;
    out.mode = r.mode;
  }
  if ('timeLimitMin' in r) {
    if (!isInt(r.timeLimitMin, 0, 20)) return null;
    out.timeLimitMin = r.timeLimitMin;
  }
  if ('scoreLimit' in r) {
    if (!isInt(r.scoreLimit, 0, 20)) return null;
    out.scoreLimit = r.scoreLimit;
  }
  if ('teamSize' in r) {
    if (r.teamSize !== 1 && r.teamSize !== 2 && r.teamSize !== 3) return null;
    out.teamSize = r.teamSize;
  }
  if ('maxPlayers' in r) {
    if (!isInt(r.maxPlayers, 2, 16)) return null;
    out.maxPlayers = r.maxPlayers;
  }
  return out;
}

/** Valida forma, tipos y tamaños. Devuelve null si el mensaje no es aceptable. */
export function parseClientMessage(raw: string): ClientMsg | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null) return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'hello':
      if (!isStr(o.nick, 64) || typeof o.v !== 'number') return null;
      return { t: 'hello', nick: o.nick, v: o.v };
    case 'list':
    case 'leave':
    case 'start':
    case 'stop':
    case 'pause':
    case 'restart':
      return { t: o.t };
    case 'create': {
      if (!isStr(o.name, 64)) return null;
      const settings = sanitizeSettings(o.settings ?? {});
      if (!settings) return null;
      return { t: 'create', name: o.name, settings };
    }
    case 'join':
      if (!isStr(o.room, 16)) return null;
      return { t: 'join', room: o.room };
    case 'chat':
      if (!isStr(o.text, 400)) return null;
      return { t: 'chat', text: o.text };
    case 'side':
      if (!SIDES.includes(o.side as Side)) return null;
      if (o.target !== undefined && !isStr(o.target, 16)) return null;
      return { t: 'side', side: o.side as Side, target: o.target as string | undefined };
    case 'hero':
      if (!HERO_IDS.includes(o.hero as HeroId)) return null;
      return { t: 'hero', hero: o.hero as HeroId };
    case 'settings': {
      const settings = sanitizeSettings(o.settings);
      if (!settings) return null;
      return { t: 'settings', settings };
    }
    case 'addbot':
      if (o.side !== 'red' && o.side !== 'blue') return null;
      return { t: 'addbot', side: o.side };
    case 'kick':
    case 'makehost':
      if (!isStr(o.target, 16)) return null;
      return { t: o.t, target: o.target };
    case 'admin':
      if (!isStr(o.sig, 200)) return null;
      return { t: 'admin', sig: o.sig };
    case 'in':
      if (!isInt(o.s, 0, 2 ** 31) || !isInt(o.b, 0, 127)) return null;
      return { t: 'in', s: o.s, b: o.b };
    case 'ping':
      if (typeof o.c !== 'number' || !Number.isFinite(o.c)) return null;
      return { t: 'ping', c: o.c, r: isInt(o.r, 0, 10000) ? o.r : undefined };
    default:
      return null;
  }
}
