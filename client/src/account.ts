// Cuenta y economía: cliente de la API del servidor. El servidor es la única
// fuente de verdad de monedas, cofres, héroes y roles; aquí sólo se guarda el
// token de sesión y, si una operación quedó sin respuesta, su clave de
// idempotencia para poder confirmarla sin repetirla.
import type { HeroId, Rarity } from '../../shared/config';
import type { ChestType } from '../../shared/economy';
import { P2P } from './game/transport';

/** Base de la API: VITE_API_URL (backend separado) o el mismo origen en el build con servidor. */
export const API_BASE: string | null = (() => {
  const v = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (v) return v.replace(/\/+$/, '');
  return P2P ? null : '';
})();

const TOKEN_KEY = 'heroball.session.v1';
const PENDING_KEY = 'heroball.pending.v1';

export type Odds = Record<Rarity, number>;
export interface Opening {
  id: number;
  chest_type: ChestType;
  rarity: Rarity;
  hero: HeroId;
  duplicate: boolean;
  fragments: number;
  guarantee: Rarity | null;
  created_at: string;
}
export interface LedgerRow {
  id: number;
  kind: string;
  coins_delta: number;
  fragments_delta: number;
  standard_delta: number;
  elite_delta: number;
  coins_after: number;
  fragments_after: number;
  standard_after: number;
  elite_after: number;
  reason: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  actor_id?: string | null;
  actor_name?: string | null;
}
export interface Notice {
  id: number;
  kind: 'match' | 'grant' | 'correction' | string;
  payload: Record<string, unknown>;
  created_at: string;
}
export interface Profile {
  user: { id: string; name: string; email: string; createdAt: string };
  roles: string[];
  wallet: { coins: number; fragments: number; standard: number; elite: number; equipped: HeroId };
  heroes: { hero: HeroId; source: string }[];
  pity: {
    sinceEpic: number;
    sinceLegendary: number;
    epicAfter: number;
    legendaryAfter: number;
    next: Record<ChestType, { odds: Odds; guarantee: Rarity | null }>;
  };
  objectives: {
    timeZone: string;
    daily: { matches: number; goal: number; reward: number; completed: boolean; resetAt: string };
    weekly: { matches: number; goal: number; rewardElite: number; completed: boolean; resetAt: string };
    matchCoinsToday: number;
    matchCoinsCap: number;
  };
  stats: { played: number; eligible: number; won: number };
  history: LedgerRow[];
  openings: Opening[];
  unseenOpenings: number[];
  notifications: Notice[];
  serverTime: string;
}
export interface OpenResult {
  openingId: number;
  chest: ChestType;
  hero: HeroId;
  rarity: Rarity;
  duplicate: boolean;
  fragments: number;
  guarantee: Rarity | null;
  replayed?: boolean;
}

/** Operación enviada cuyo resultado no llegó (red caída, pestaña cerrada). */
export interface PendingOp {
  key: string;
  path: string;
  body: Record<string, unknown>;
  label: string;
  at: number;
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

/** Error de red: no sabemos si el servidor procesó la solicitud. */
export class UnknownOutcome extends Error {}

function read<T>(k: string): T | null {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function write(k: string, v: unknown): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: la sesión dura lo que la pestaña */
  }
}

export function newKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export type AccountStatus = 'unavailable' | 'checking' | 'offline' | 'guest' | 'signed';

class AccountStore {
  status: AccountStatus = API_BASE === null ? 'unavailable' : 'checking';
  token: string | null = read<string>(TOKEN_KEY);
  profile: Profile | null = null;
  /** Último error al cargar el perfil (red o servidor). */
  error: string | null = null;
  pending: PendingOp | null = read<PendingOp>(PENDING_KEY);
  /** Clave de la operación que se está enviando ahora (aún no es "sin respuesta"). */
  inFlight: string | null = null;

  /** Operación sin confirmar que no está en curso: hay que comprobarla. */
  get unresolved(): PendingOp | null {
    return this.pending && this.pending.key !== this.inFlight ? this.pending : null;
  }
  private listeners = new Set<() => void>();
  version = 0;

  get enabled(): boolean {
    return API_BASE !== null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  hasRole(r: string): boolean {
    return !!this.profile?.roles.includes(r);
  }

  owned(): Set<HeroId> {
    return new Set(this.profile?.heroes.map((h) => h.hero) ?? []);
  }

  /** Solicitud HTTP. Lanza ApiError (respuesta del servidor) o UnknownOutcome (sin respuesta). */
  async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (API_BASE === null) throw new ApiError('no_api', 'Esta versión no tiene servidor de cuentas configurado.', 0);
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new UnknownOutcome('No se pudo contactar el servidor.');
    }
    const tok = res.headers.get('set-auth-token');
    if (tok) this.setToken(tok);
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* respuesta sin JSON */
    }
    if (!res.ok) {
      const d = (data ?? {}) as { error?: string; code?: string; message?: string };
      if (res.status === 401 && !path.startsWith('/api/auth/')) {
        this.setToken(null);
        this.profile = null;
        this.status = 'guest';
        this.emit();
      }
      if (res.status >= 500 && res.status !== 503) throw new UnknownOutcome(d.message ?? 'El servidor falló al responder.');
      throw new ApiError(d.error ?? d.code ?? 'error', authMessage(d.code) ?? d.message ?? `Error ${res.status}.`, res.status);
    }
    return data as T;
  }

  private setToken(t: string | null): void {
    this.token = t;
    write(TOKEN_KEY, t);
  }

  /** Carga (o recarga) el perfil desde el servidor. */
  async refresh(): Promise<void> {
    if (API_BASE === null) return;
    if (!this.token) {
      this.status = 'guest';
      this.profile = null;
      this.emit();
      return;
    }
    if (!this.profile) {
      this.status = 'checking';
      this.emit();
    }
    try {
      this.profile = await this.call<Profile>('GET', '/api/me');
      this.status = 'signed';
      this.error = null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.status = 'guest';
      } else if (e instanceof ApiError && e.code === 'no_economy') {
        this.status = 'unavailable';
        this.error = e.message;
      } else {
        // sin conexión con la API: el juego sigue, las funciones de cuenta esperan
        this.status = 'offline';
        this.error = e instanceof Error ? e.message : 'Sin conexión.';
      }
    }
    this.emit();
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.call('POST', '/api/auth/sign-in/email', { email, password });
    await this.refresh();
  }

  async signUp(name: string, email: string, password: string): Promise<void> {
    await this.call('POST', '/api/auth/sign-up/email', { name, email, password });
    await this.refresh();
  }

  async signOut(): Promise<void> {
    try {
      await this.call('POST', '/api/auth/sign-out', {});
    } catch {
      /* la sesión se olvida igual en este navegador */
    }
    this.setToken(null);
    this.profile = null;
    this.status = 'guest';
    this.emit();
  }

  async requestReset(email: string): Promise<void> {
    const redirectTo = location.origin + location.pathname;
    await this.call('POST', '/api/auth/request-password-reset', { email, redirectTo });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.call('POST', '/api/auth/reset-password', { token, newPassword });
  }

  async rename(name: string): Promise<void> {
    await this.call('POST', '/api/auth/update-user', { name });
    await this.refresh();
  }

  /**
   * Operación con efecto económico. La clave se guarda ANTES de enviar: si la
   * respuesta se pierde, la operación queda pendiente y se confirma reenviando
   * la misma clave (el servidor devuelve el resultado original, no repite).
   */
  async mutate<T>(path: string, body: Record<string, unknown>, label: string, key = newKey()): Promise<T> {
    const op: PendingOp = { key, path, body, label, at: Date.now() };
    this.pending = op;
    this.inFlight = key;
    write(PENDING_KEY, op);
    this.emit();
    try {
      const r = await this.call<T>('POST', path, { ...body, key });
      this.clearPending(key);
      return r;
    } catch (e) {
      // con respuesta del servidor sabemos que no se aplicó: no queda pendiente
      if (e instanceof ApiError) this.clearPending(key);
      throw e;
    } finally {
      if (this.inFlight === key) this.inFlight = null;
      void this.refresh();
    }
  }

  /** Confirma la operación pendiente reenviando su misma clave. */
  async resolvePending<T>(): Promise<T | null> {
    const p = this.pending;
    if (!p) return null;
    return this.mutate<T>(p.path, p.body, p.label, p.key);
  }

  discardPending(): void {
    this.clearPending(this.pending?.key ?? '');
  }

  private clearPending(key: string): void {
    if (this.pending?.key !== key) return;
    this.pending = null;
    write(PENDING_KEY, null);
    this.emit();
  }

  async markSeen(body: { opening?: number; notifications?: number[] }): Promise<void> {
    try {
      await this.call('POST', '/api/me/seen', body);
    } catch {
      /* se volverá a mostrar la próxima vez: inocuo */
    }
    await this.refresh();
  }

  /** Firma de moderación para salas P2P (la clave privada vive sólo en el servidor). */
  async moderationTicket(nonce: string, clientId: string): Promise<string> {
    const r = await this.call<{ sig: string }>('POST', '/api/moderation/ticket', { nonce, clientId });
    return r.sig;
  }
}

function authMessage(code?: string): string | null {
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD': return 'Correo o contraseña incorrectos.';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL': return 'Ya existe una cuenta con ese correo.';
    case 'PASSWORD_TOO_SHORT': return 'La contraseña debe tener al menos 8 caracteres.';
    case 'INVALID_EMAIL': return 'Correo inválido.';
    case 'INVALID_TOKEN': return 'El enlace de recuperación venció o ya se usó.';
    default: return null;
  }
}

export const account = new AccountStore();
