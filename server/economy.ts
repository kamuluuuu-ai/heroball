// Servicio de economía sobre PostgreSQL. Toda operación que cambia saldos:
// - bloquea la billetera del usuario (SELECT … FOR UPDATE), lo que serializa
//   pestañas, doble clic y reintentos del mismo usuario;
// - es idempotente por clave (la misma clave devuelve la misma respuesta);
// - deja un movimiento en el libro mayor con el saldo resultante.
import { randomInt } from 'node:crypto';
import { HERO_CATALOG, HERO_IDS, STARTER_IDS, type HeroId } from '../shared/config';
import {
  ECONOMY, ODDS_SCALE, effectiveOdds, periods, positiveInt, resolveChest,
  type ChestType, type PityState,
} from '../shared/economy';
import { tx, type Db, type Tx } from './db';
import { evaluateMatch, matchCoins, type MatchSummary, type OfficialAdapter, type SettleResult } from './official';

export class EconomyError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

export type Role = 'moderator' | 'economy_admin';

interface WalletRow {
  user_id: string;
  coins: number;
  fragments: number;
  standard_chests: number;
  elite_chests: number;
  pity_epic: number;
  pity_legendary: number;
  equipped_hero: HeroId;
  last_seen_opening: number;
}

export interface Deltas {
  coins?: number;
  fragments?: number;
  standard?: number;
  elite?: number;
}

export interface Limits {
  adminCoins: number;
  adminChests: number;
}

const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;

function checkKey(key: unknown): string {
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw new EconomyError('bad_key', 'Falta una clave de operación válida.');
  return key;
}

function isHero(h: unknown): h is HeroId {
  return typeof h === 'string' && (HERO_IDS as string[]).includes(h);
}

function isChest(t: unknown): t is ChestType {
  return t === 'standard' || t === 'elite';
}

/** Traduce violaciones de restricciones de saldo a un error comprensible. */
function balanceError(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === '23514') throw new EconomyError('insufficient', 'Saldo insuficiente para esta operación.', 409);
  throw e;
}

export class Economy {
  constructor(readonly db: Db, readonly limits: Limits = { adminCoins: ECONOMY.adminLimits.coins, adminChests: ECONOMY.adminLimits.chests }, private readonly now: () => Date = () => new Date()) {}

  // ------------------------------------------------------------ primitivas

  private async lock(c: Tx, userId: string): Promise<WalletRow> {
    const r = await c.query<WalletRow>('SELECT * FROM wallet WHERE user_id = $1 FOR UPDATE', [userId]);
    if (!r.rowCount) throw new EconomyError('no_account', 'La cuenta no tiene billetera.', 404);
    return r.rows[0];
  }

  /** Aplica cambios de saldo y los registra en el libro mayor. */
  private async apply(c: Tx, userId: string, kind: string, d: Deltas, o: { ref?: string; reason?: string; actor?: string; detail?: unknown } = {}): Promise<WalletRow> {
    let w: WalletRow;
    try {
      const r = await c.query<WalletRow>(
        `UPDATE wallet SET coins = coins + $2, fragments = fragments + $3, standard_chests = standard_chests + $4, elite_chests = elite_chests + $5
         WHERE user_id = $1 RETURNING *`,
        [userId, d.coins ?? 0, d.fragments ?? 0, d.standard ?? 0, d.elite ?? 0],
      );
      w = r.rows[0];
    } catch (e) {
      balanceError(e);
    }
    await c.query(
      `INSERT INTO ledger (user_id, kind, coins_delta, fragments_delta, standard_delta, elite_delta,
         coins_after, fragments_after, standard_after, elite_after, ref, reason, actor_id, detail, economy_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [userId, kind, d.coins ?? 0, d.fragments ?? 0, d.standard ?? 0, d.elite ?? 0,
        w.coins, w.fragments, w.standard_chests, w.elite_chests,
        o.ref ?? null, o.reason ?? null, o.actor ?? null, JSON.stringify(o.detail ?? {}), ECONOMY.version],
    );
    return w;
  }

  /**
   * Operación idempotente: bloquea la billetera de `owner`, y si la clave ya
   * se usó devuelve la respuesta guardada (con `replayed: true`).
   */
  private async idempotent<T extends object>(owner: string, key: string, op: string, fn: (c: Tx, w: WalletRow) => Promise<T>): Promise<T & { replayed: boolean }> {
    return tx(this.db, async (c) => {
      const w = await this.lock(c, owner);
      const prev = await c.query('SELECT op, response FROM idempotency WHERE user_id = $1 AND key = $2', [owner, key]);
      if (prev.rowCount) {
        if (prev.rows[0].op !== op) throw new EconomyError('key_reused', 'Esa clave de operación ya se usó para otra acción.', 409);
        return { ...(prev.rows[0].response as T), replayed: true };
      }
      const out = await fn(c, w);
      await c.query('INSERT INTO idempotency (user_id, key, op, response) VALUES ($1, $2, $3, $4)', [owner, key, op, JSON.stringify(out)]);
      return { ...out, replayed: false };
    });
  }

  // ------------------------------------------------------------ cuentas

  /** Crea la billetera la primera vez y entrega la bienvenida una sola vez. */
  async ensureAccount(userId: string): Promise<void> {
    await tx(this.db, async (c) => {
      const ins = await c.query('INSERT INTO wallet (user_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING user_id', [userId]);
      if (!ins.rowCount) return;
      const W = ECONOMY.welcome;
      await this.apply(c, userId, 'welcome', { coins: W.coins, standard: W.standard, elite: W.elite }, { ref: 'welcome', reason: 'Bienvenida' });
    });
  }

  async roles(userId: string): Promise<Role[]> {
    const r = await this.db.query('SELECT role FROM user_role WHERE user_id = $1 ORDER BY role', [userId]);
    return r.rows.map((x) => x.role as Role);
  }

  async hasRole(userId: string, role: Role): Promise<boolean> {
    return (await this.db.query('SELECT 1 FROM user_role WHERE user_id = $1 AND role = $2', [userId, role])).rowCount! > 0;
  }

  async ownedHeroes(userId: string, c: Tx | Db = this.db): Promise<Set<HeroId>> {
    const r = await c.query('SELECT hero FROM hero_unlock WHERE user_id = $1', [userId]);
    return new Set<HeroId>([...STARTER_IDS, ...r.rows.map((x) => x.hero as HeroId)]);
  }

  // ------------------------------------------------------------ cofres y héroes

  async buyChest(userId: string, type: unknown, key: unknown) {
    if (!isChest(type)) throw new EconomyError('bad_chest', 'Tipo de cofre inválido.');
    const k = checkKey(key);
    return this.idempotent(userId, k, `buy:${type}`, async (c, w) => {
      const price = ECONOMY.chests[type].price;
      if (w.coins < price) throw new EconomyError('insufficient', `Te faltan ${price - w.coins} HeroCoins para este cofre.`, 409);
      const after = await this.apply(c, userId, 'buy_chest', { coins: -price, [type]: 1 }, { detail: { chest: type, price } });
      return { chest: type, price, coins: after.coins, standard: after.standard_chests, elite: after.elite_chests };
    });
  }

  /**
   * Apertura atómica: consume el cofre, aplica garantías, sortea con
   * crypto.randomInt, entrega héroe o Fragmentos, actualiza contadores y
   * guarda el resultado. Todo o nada.
   */
  async openChest(userId: string, type: unknown, key: unknown, rng: (n: number) => number = randomInt) {
    if (!isChest(type)) throw new EconomyError('bad_chest', 'Tipo de cofre inválido.');
    const k = checkKey(key);
    return this.idempotent(userId, k, `open:${type}`, async (c, w) => {
      const have = type === 'standard' ? w.standard_chests : w.elite_chests;
      if (have < 1) throw new EconomyError('no_chest', 'No tenés cofres de ese tipo.', 409);
      const pity: PityState = { sinceEpic: w.pity_epic, sinceLegendary: w.pity_legendary };
      const owned = await this.ownedHeroes(userId, c);
      const out = resolveChest(type, pity, owned, rng(ODDS_SCALE), (n) => rng(n));
      if (!out.duplicate) await c.query("INSERT INTO hero_unlock (user_id, hero, source) VALUES ($1, $2, 'chest')", [userId, out.hero]);
      await c.query('UPDATE wallet SET pity_epic = $2, pity_legendary = $3 WHERE user_id = $1', [userId, out.pityAfter.sinceEpic, out.pityAfter.sinceLegendary]);
      const op = await c.query(
        `INSERT INTO chest_opening (user_id, chest_type, rarity, hero, duplicate, fragments, guarantee, pity_before, pity_after, economy_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, created_at`,
        [userId, type, out.rarity, out.hero, out.duplicate, out.fragments, out.guarantee, JSON.stringify(pity), JSON.stringify(out.pityAfter), ECONOMY.version],
      );
      const openingId = Number(op.rows[0].id);
      const after = await this.apply(c, userId, 'open_chest', { [type]: -1, fragments: out.fragments }, {
        detail: { opening: openingId, hero: out.hero, rarity: out.rarity, duplicate: out.duplicate, guarantee: out.guarantee },
      });
      return {
        openingId, chest: type, hero: out.hero, rarity: out.rarity, duplicate: out.duplicate, fragments: out.fragments,
        guarantee: out.guarantee, pity: out.pityAfter,
        balance: { coins: after.coins, fragments: after.fragments, standard: after.standard_chests, elite: after.elite_chests },
      };
    });
  }

  async markOpeningSeen(userId: string, openingId: unknown): Promise<void> {
    if (!Number.isSafeInteger(openingId)) throw new EconomyError('bad_id', 'Apertura inválida.');
    await this.db.query('UPDATE wallet SET last_seen_opening = GREATEST(last_seen_opening, $2) WHERE user_id = $1', [userId, openingId]);
  }

  /** Desbloqueo directo con Fragmentos. */
  async unlockHero(userId: string, hero: unknown, key: unknown) {
    if (!isHero(hero)) throw new EconomyError('bad_hero', 'Héroe inválido.');
    const k = checkKey(key);
    return this.idempotent(userId, k, `unlock:${hero}`, async (c, w) => {
      if (HERO_CATALOG[hero].starter) throw new EconomyError('starter', 'Los héroes iniciales ya son gratis.', 409);
      const owned = await this.ownedHeroes(userId, c);
      if (owned.has(hero)) throw new EconomyError('owned', 'Ya tenés ese héroe.', 409);
      const cost = ECONOMY.unlockCost[HERO_CATALOG[hero].rarity];
      if (w.fragments < cost) throw new EconomyError('insufficient', `Te faltan ${cost - w.fragments} Fragmentos.`, 409);
      await c.query("INSERT INTO hero_unlock (user_id, hero, source) VALUES ($1, $2, 'fragments')", [userId, hero]);
      const after = await this.apply(c, userId, 'unlock', { fragments: -cost }, { detail: { hero, cost } });
      return { hero, cost, fragments: after.fragments };
    });
  }

  async equipHero(userId: string, hero: unknown): Promise<HeroId> {
    if (!isHero(hero)) throw new EconomyError('bad_hero', 'Héroe inválido.');
    if (!(await this.ownedHeroes(userId)).has(hero)) throw new EconomyError('locked', 'Ese héroe todavía está bloqueado.', 403);
    await this.db.query('UPDATE wallet SET equipped_hero = $2 WHERE user_id = $1', [userId, hero]);
    return hero;
  }

  // ------------------------------------------------------------ perfil

  async profile(userId: string) {
    await this.ensureAccount(userId);
    const now = this.now();
    const per = periods(now);
    const [w, user, heroes, ledger, openings, objectives, stats, notes, roles] = await Promise.all([
      this.db.query<WalletRow>('SELECT * FROM wallet WHERE user_id = $1', [userId]),
      this.db.query('SELECT id, name, email, "createdAt" FROM "user" WHERE id = $1', [userId]),
      this.db.query('SELECT hero, source, created_at FROM hero_unlock WHERE user_id = $1 ORDER BY created_at', [userId]),
      this.db.query('SELECT id, kind, coins_delta, fragments_delta, standard_delta, elite_delta, coins_after, fragments_after, standard_after, elite_after, reason, detail, created_at FROM ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 40', [userId]),
      this.db.query('SELECT id, chest_type, rarity, hero, duplicate, fragments, guarantee, created_at FROM chest_opening WHERE user_id = $1 ORDER BY id DESC LIMIT 20', [userId]),
      this.db.query('SELECT period_kind, matches, match_coins, completed FROM objective_progress WHERE user_id = $1 AND ((period_kind = $2 AND period = $3) OR (period_kind = $4 AND period = $5))', [userId, 'daily', per.day, 'weekly', per.week]),
      this.db.query('SELECT count(*)::int AS played, count(*) FILTER (WHERE eligible)::int AS eligible, count(*) FILTER (WHERE won)::int AS won FROM match_participant WHERE user_id = $1', [userId]),
      this.db.query('SELECT id, kind, payload, created_at FROM notification WHERE user_id = $1 AND seen_at IS NULL ORDER BY id', [userId]),
      this.roles(userId),
    ]);
    const wallet = w.rows[0];
    const pity: PityState = { sinceEpic: wallet.pity_epic, sinceLegendary: wallet.pity_legendary };
    const obj = (k: string) => objectives.rows.find((r) => r.period_kind === k) ?? { matches: 0, match_coins: 0, completed: false };
    const daily = obj('daily');
    const weekly = obj('weekly');
    return {
      user: { id: user.rows[0].id, name: user.rows[0].name, email: user.rows[0].email, createdAt: user.rows[0].createdAt },
      roles,
      wallet: { coins: wallet.coins, fragments: wallet.fragments, standard: wallet.standard_chests, elite: wallet.elite_chests, equipped: wallet.equipped_hero },
      heroes: [...STARTER_IDS.map((h) => ({ hero: h, source: 'starter' })), ...heroes.rows.map((r) => ({ hero: r.hero, source: r.source }))],
      pity: {
        ...pity,
        epicAfter: ECONOMY.pity.epicAfter,
        legendaryAfter: ECONOMY.pity.legendaryAfter,
        next: { standard: effectiveOdds('standard', pity), elite: effectiveOdds('elite', pity) },
      },
      objectives: {
        timeZone: ECONOMY.objectives.timeZone,
        daily: { matches: daily.matches, goal: ECONOMY.objectives.daily.matches, reward: ECONOMY.objectives.daily.coins, completed: daily.completed, resetAt: per.dailyResetAt.toISOString() },
        weekly: { matches: weekly.matches, goal: ECONOMY.objectives.weekly.matches, rewardElite: ECONOMY.objectives.weekly.elite, completed: weekly.completed, resetAt: per.weeklyResetAt.toISOString() },
        matchCoinsToday: daily.match_coins,
        matchCoinsCap: ECONOMY.match.dailyCap,
      },
      stats: stats.rows[0],
      history: ledger.rows,
      openings: openings.rows,
      unseenOpenings: openings.rows.filter((o) => Number(o.id) > wallet.last_seen_opening).map((o) => Number(o.id)),
      notifications: notes.rows,
      economyVersion: ECONOMY.version,
      serverTime: now.toISOString(),
    };
  }

  async markNotificationsSeen(userId: string, ids: unknown): Promise<void> {
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every((i) => Number.isSafeInteger(i))) throw new EconomyError('bad_id', 'Avisos inválidos.');
    await this.db.query('UPDATE notification SET seen_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[]) AND seen_at IS NULL', [userId, ids]);
  }

  // ------------------------------------------------------------ partidas oficiales

  /**
   * Resuelve las recompensas de una partida oficial. Idempotente por id de
   * partida: si ya se registró, no entrega nada de nuevo.
   */
  async settleMatch(m: MatchSummary): Promise<SettleResult[]> {
    const day = periods(m.endedAt);
    return tx(this.db, async (c) => {
      const ins = await c.query(
        `INSERT INTO official_match (id, mode, started_at, ended_at, duration_s, score_red, score_blue, winner, kicks_red, kicks_blue)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id`,
        [m.id, m.mode, m.startedAt, m.endedAt, Math.round(m.matchTicks / 60), m.score.red, m.score.blue, m.winner, m.kicks.red, m.kicks.blue],
      );
      if (!ins.rowCount) return [];
      // bloquear billeteras en orden estable (evita interbloqueos entre partidas)
      const users = [...new Set(m.participants.map((p) => p.userId))].sort();
      for (const u of users) await this.ensureWalletIn(c, u);
      for (const u of users) await this.lock(c, u);
      const repeats = new Map<string, number>();
      for (const u of users) {
        const r = await c.query('SELECT opponents, count(*)::int AS n FROM match_participant WHERE user_id = $1 AND local_day = $2 AND eligible GROUP BY opponents', [u, day.day]);
        for (const row of r.rows) repeats.set(`${u}|${row.opponents}`, row.n);
      }
      const verdicts = evaluateMatch(m, (u, opp) => repeats.get(`${u}|${opp}`) ?? 0);
      const results: SettleResult[] = [];
      for (const v of verdicts) {
        const p = m.participants.find((x) => x.userId === v.userId)!;
        let coins = 0;
        let dailyBonus = 0;
        let weeklyElite = 0;
        if (v.eligible) {
          const d = await this.bumpObjective(c, v.userId, 'daily', day.day);
          const wk = await this.bumpObjective(c, v.userId, 'weekly', day.week);
          coins = matchCoins(v.won, d.match_coins);
          if (coins > 0) {
            await c.query("UPDATE objective_progress SET match_coins = match_coins + $4 WHERE user_id = $1 AND period_kind = $2 AND period = $3", [v.userId, 'daily', day.day, coins]);
          }
          await this.apply(c, v.userId, 'match', { coins }, { ref: `match:${m.id}`, detail: { match: m.id, won: v.won, capped: coins < ECONOMY.match.completeCoins + (v.won ? ECONOMY.match.winBonus : 0) } });
          const O = ECONOMY.objectives;
          if (d.matches >= O.daily.matches && !d.completed) {
            await c.query("UPDATE objective_progress SET completed = true WHERE user_id = $1 AND period_kind = 'daily' AND period = $2", [v.userId, day.day]);
            await this.apply(c, v.userId, 'daily', { coins: O.daily.coins }, { ref: `daily:${day.day}`, reason: 'Objetivo diario' });
            dailyBonus = O.daily.coins;
          }
          if (wk.matches >= O.weekly.matches && !wk.completed) {
            await c.query("UPDATE objective_progress SET completed = true WHERE user_id = $1 AND period_kind = 'weekly' AND period = $2", [v.userId, day.week]);
            await this.apply(c, v.userId, 'weekly', { elite: O.weekly.elite }, { ref: `weekly:${day.week}`, reason: 'Objetivo semanal' });
            weeklyElite = O.weekly.elite;
          }
        }
        await c.query(
          `INSERT INTO match_participant (match_id, user_id, team, hero, active_ratio, eligible, reason, won, coins, opponents, local_day)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [m.id, v.userId, p.team, p.hero, v.activeRatio, v.eligible, v.reason, v.won, coins, v.opponents, day.day],
        );
        const res = { userId: v.userId, eligible: v.eligible, reason: v.reason, coins, dailyBonus, weeklyElite };
        await c.query('INSERT INTO notification (user_id, kind, payload) VALUES ($1, $2, $3)', [v.userId, 'match', JSON.stringify({ match: m.id, ...res })]);
        results.push(res);
      }
      return results;
    });
  }

  private async ensureWalletIn(c: Tx, userId: string): Promise<void> {
    const ins = await c.query('INSERT INTO wallet (user_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING user_id', [userId]);
    if (ins.rowCount) {
      const W = ECONOMY.welcome;
      await this.apply(c, userId, 'welcome', { coins: W.coins, standard: W.standard, elite: W.elite }, { ref: 'welcome', reason: 'Bienvenida' });
    }
  }

  private async bumpObjective(c: Tx, userId: string, kind: 'daily' | 'weekly', period: string) {
    const r = await c.query(
      `INSERT INTO objective_progress (user_id, period_kind, period, matches) VALUES ($1, $2, $3, 1)
       ON CONFLICT (user_id, period_kind, period) DO UPDATE SET matches = objective_progress.matches + 1
       RETURNING matches, match_coins, completed`,
      [userId, kind, period],
    );
    return r.rows[0] as { matches: number; match_coins: number; completed: boolean };
  }

  adapter(): OfficialAdapter {
    return {
      ownedHeroes: (u) => this.ownedHeroes(u),
      settle: (m) => this.settleMatch(m),
    };
  }

  // ------------------------------------------------------------ administración

  async requireRole(userId: string, role: Role): Promise<void> {
    if (!(await this.hasRole(userId, role))) throw new EconomyError('forbidden', 'No tenés permiso para esta acción.', 403);
  }

  async searchUsers(actor: string, q: unknown) {
    await this.requireRole(actor, 'economy_admin');
    if (typeof q !== 'string' || q.trim().length < 2 || q.length > 64) throw new EconomyError('bad_query', 'Escribí al menos 2 caracteres.');
    const term = q.trim();
    const like = '%' + term.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
    const r = await this.db.query(
      `SELECT u.id, u.name, u.email, w.coins, w.fragments, w.standard_chests, w.elite_chests
       FROM "user" u LEFT JOIN wallet w ON w.user_id = u.id
       WHERE u.id = $1 OR u.name ILIKE $2 OR u.email ILIKE $2 ORDER BY u.name LIMIT 20`,
      [term, like],
    );
    return r.rows;
  }

  async userDetail(actor: string, userId: unknown) {
    await this.requireRole(actor, 'economy_admin');
    if (typeof userId !== 'string' || userId.length > 64) throw new EconomyError('bad_user', 'Usuario inválido.');
    const u = await this.db.query('SELECT id, name, email, "createdAt" FROM "user" WHERE id = $1', [userId]);
    if (!u.rowCount) throw new EconomyError('no_user', 'No existe ese usuario.', 404);
    await this.ensureAccount(userId);
    const [w, heroes, ledger, openings, roles] = await Promise.all([
      this.db.query('SELECT coins, fragments, standard_chests, elite_chests, pity_epic, pity_legendary, equipped_hero FROM wallet WHERE user_id = $1', [userId]),
      this.db.query('SELECT hero, source, created_at FROM hero_unlock WHERE user_id = $1 ORDER BY created_at', [userId]),
      this.db.query('SELECT l.id, l.kind, l.coins_delta, l.fragments_delta, l.standard_delta, l.elite_delta, l.coins_after, l.fragments_after, l.standard_after, l.elite_after, l.reason, l.actor_id, a.name AS actor_name, l.detail, l.created_at FROM ledger l LEFT JOIN "user" a ON a.id = l.actor_id WHERE l.user_id = $1 ORDER BY l.id DESC LIMIT 100', [userId]),
      this.db.query('SELECT id, chest_type, rarity, hero, duplicate, fragments, guarantee, created_at FROM chest_opening WHERE user_id = $1 ORDER BY id DESC LIMIT 50', [userId]),
      this.roles(userId),
    ]);
    return { user: u.rows[0], roles, wallet: w.rows[0], heroes: heroes.rows, ledger: ledger.rows, openings: openings.rows };
  }

  /** Valida una entrega o corrección y devuelve lo que se aplicaría (sin aplicarlo). */
  private async validateGrant(actor: string, body: Record<string, unknown>, correction: boolean) {
    await this.requireRole(actor, 'economy_admin');
    const userId = body.userId;
    if (typeof userId !== 'string' || userId.length > 64) throw new EconomyError('bad_user', 'Usuario inválido.');
    if (userId === actor) throw new EconomyError('self', 'No podés entregarte recursos a vos mismo.', 403);
    const reason = typeof body.reason === 'string' ? body.reason.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
    if (reason.length < 5 || reason.length > 200) throw new EconomyError('bad_reason', 'El motivo es obligatorio (5 a 200 caracteres).');
    const amount = (v: unknown, max: number, label: string): number => {
      if (v === undefined || v === null || v === 0) return 0;
      const n = positiveInt(v, max);
      if (n === null) throw new EconomyError('bad_amount', `${label}: debe ser un entero positivo de hasta ${max}.`);
      return n;
    };
    const coins = amount(body.coins, this.limits.adminCoins, 'Monedas');
    const standard = amount(body.standard, this.limits.adminChests, 'Cofres estándar');
    const elite = amount(body.elite, this.limits.adminChests, 'Cofres élite');
    if (!coins && !standard && !elite) throw new EconomyError('empty', 'Indicá al menos una cantidad.');
    let corrects: number | null = null;
    if (correction) {
      if (!Number.isSafeInteger(body.corrects)) throw new EconomyError('bad_ref', 'Indicá el movimiento que se corrige.');
      corrects = body.corrects as number;
      const ref = await this.db.query('SELECT 1 FROM ledger WHERE id = $1 AND user_id = $2', [corrects, userId]);
      if (!ref.rowCount) throw new EconomyError('bad_ref', 'Ese movimiento no existe para este usuario.');
    }
    const u = await this.db.query('SELECT name FROM "user" WHERE id = $1', [userId]);
    if (!u.rowCount) throw new EconomyError('no_user', 'No existe ese usuario.', 404);
    const sign = correction ? -1 : 1;
    return { userId, name: u.rows[0].name as string, reason, coins: sign * coins, standard: sign * standard, elite: sign * elite, corrects };
  }

  async previewGrant(actor: string, body: Record<string, unknown>, correction = false) {
    const g = await this.validateGrant(actor, body, correction);
    await this.ensureAccount(g.userId);
    const w = (await this.db.query('SELECT coins, standard_chests, elite_chests FROM wallet WHERE user_id = $1', [g.userId])).rows[0];
    const after = { coins: w.coins + g.coins, standard: w.standard_chests + g.standard, elite: w.elite_chests + g.elite };
    return { ...g, before: { coins: w.coins, standard: w.standard_chests, elite: w.elite_chests }, after, valid: after.coins >= 0 && after.standard >= 0 && after.elite >= 0 };
  }

  /** Entrega (o corrección compensatoria) idempotente por clave del administrador. */
  async grant(actor: string, body: Record<string, unknown>, correction = false) {
    const g = await this.validateGrant(actor, body, correction);
    const key = checkKey(body.key);
    await this.ensureAccount(g.userId);
    // la clave de idempotencia se guarda bajo el administrador (su billetera hace de candado)
    await this.ensureAccount(actor);
    // la clave es del administrador: un reintento no entrega dos veces
    return this.idempotent(actor, key, `${correction ? 'correct' : 'grant'}:${g.userId}`, async (c) => {
      await this.lock(c, g.userId);
      const w = await this.apply(c, g.userId, correction ? 'admin_correction' : 'admin_grant', { coins: g.coins, standard: g.standard, elite: g.elite }, {
        reason: g.reason, actor, detail: correction ? { corrects: g.corrects } : {},
      });
      await c.query('INSERT INTO notification (user_id, kind, payload) VALUES ($1, $2, $3)', [g.userId, correction ? 'correction' : 'grant', JSON.stringify({ coins: g.coins, standard: g.standard, elite: g.elite, reason: g.reason })]);
      return { userId: g.userId, name: g.name, coins: g.coins, standard: g.standard, elite: g.elite, reason: g.reason, after: { coins: w.coins, standard: w.standard_chests, elite: w.elite_chests } };
    });
  }
}

/** Procedimiento de servidor (CLI): asignar o quitar un rol. Nunca expuesto por HTTP. */
export async function setRole(db: Db, email: string, role: Role, on: boolean, by: string): Promise<{ userId: string; name: string }> {
  const u = await db.query('SELECT id, name FROM "user" WHERE lower(email) = lower($1)', [email]);
  if (!u.rowCount) throw new Error(`No existe una cuenta con el correo ${email}. Registrala primero desde el juego.`);
  const userId = u.rows[0].id as string;
  if (on) await db.query('INSERT INTO user_role (user_id, role, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, role, by]);
  else await db.query('DELETE FROM user_role WHERE user_id = $1 AND role = $2', [userId, role]);
  return { userId, name: u.rows[0].name };
}
