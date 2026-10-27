// Economía de HeroBall: configuración versionada y reglas puras (sin E/S).
// La usa el servidor para resolver operaciones y el cliente para MOSTRAR
// probabilidades y progreso; el cliente nunca decide resultados.
//
// Cambiar cualquier valor exige subir ECONOMY.version: cada apertura y cada
// movimiento del libro mayor guardan la versión con la que se resolvieron.
import { HERO_CATALOG, type HeroId, type Rarity } from './config';

export const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export type ChestType = 'standard' | 'elite';

export const ECONOMY = {
  version: 1,
  currency: 'HeroCoins',
  /** Probabilidades base en partes por millón (suman 1 000 000). */
  chests: {
    standard: { price: 200, odds: { common: 600_000, rare: 280_000, epic: 100_000, legendary: 20_000 } },
    elite: { price: 600, odds: { common: 0, rare: 700_000, epic: 250_000, legendary: 50_000 } },
  } satisfies Record<ChestType, { price: number; odds: Record<Rarity, number> }>,
  /** Garantías compartidas entre ambos cofres. */
  pity: {
    /** Tras 9 aperturas seguidas sin épico ni legendario, la siguiente es épica o mejor. */
    epicAfter: 9,
    /** Tras 29 aperturas seguidas sin legendario, la siguiente es legendaria. */
    legendaryAfter: 29,
  },
  duplicateFragments: { common: 10, rare: 25, epic: 60, legendary: 150 } satisfies Record<Rarity, number>,
  unlockCost: { common: 100, rare: 250, epic: 600, legendary: 1500 } satisfies Record<Rarity, number>,
  welcome: { coins: 400, standard: 2, elite: 0 },
  match: {
    completeCoins: 40,
    winBonus: 20,
    dailyCap: 400,
    minSeconds: 60,
    /** Fracción mínima del partido con participación activa. */
    minParticipation: 0.6,
    /** Sin entradas durante este tiempo se considera inactivo (AFK). */
    afkSeconds: 8,
    /** Partidas elegibles por día con los mismos rivales antes de dejar de pagar. */
    sameOpponentsDaily: 3,
    /** Menos patadas que esto en todo el partido: se considera pactada. */
    minKicksPerTeam: 2,
  },
  objectives: {
    daily: { matches: 3, coins: 80 },
    weekly: { matches: 15, elite: 1 },
    timeZone: 'America/Montevideo',
  },
  /** Límites de cada operación administrativa. */
  adminLimits: { coins: 100_000, chests: 100 },
} as const;

export const ODDS_SCALE = 1_000_000;

export interface PityState {
  /** Aperturas consecutivas sin épico ni legendario. */
  sinceEpic: number;
  /** Aperturas consecutivas sin legendario. */
  sinceLegendary: number;
}

export type Guarantee = 'legendary' | 'epic' | null;

/** Probabilidades efectivas de la próxima apertura, según garantías. */
export function effectiveOdds(type: ChestType, pity: PityState): { odds: Record<Rarity, number>; guarantee: Guarantee } {
  const base = ECONOMY.chests[type].odds;
  if (pity.sinceLegendary >= ECONOMY.pity.legendaryAfter) {
    return { odds: { common: 0, rare: 0, epic: 0, legendary: ODDS_SCALE }, guarantee: 'legendary' };
  }
  if (pity.sinceEpic >= ECONOMY.pity.epicAfter) {
    // épico o mejor, normalizado desde las probabilidades base del cofre
    const sum = base.epic + base.legendary;
    const legendary = Math.round((base.legendary * ODDS_SCALE) / sum);
    return { odds: { common: 0, rare: 0, epic: ODDS_SCALE - legendary, legendary }, guarantee: 'epic' };
  }
  return { odds: { ...base }, guarantee: null };
}

/** Rareza a partir de un número uniforme en [0, ODDS_SCALE). */
export function pickRarity(odds: Record<Rarity, number>, roll: number): Rarity {
  let acc = 0;
  for (const r of RARITIES) {
    acc += odds[r];
    if (roll < acc) return r;
  }
  // sólo por redondeo: la última rareza con probabilidad
  return [...RARITIES].reverse().find((r) => odds[r] > 0)!;
}

/** Contadores después de obtener una rareza (los duplicados cuentan igual). */
export function nextPity(p: PityState, r: Rarity): PityState {
  if (r === 'legendary') return { sinceEpic: 0, sinceLegendary: 0 };
  if (r === 'epic') return { sinceEpic: 0, sinceLegendary: p.sinceLegendary + 1 };
  return { sinceEpic: p.sinceEpic + 1, sinceLegendary: p.sinceLegendary + 1 };
}

export function heroesOfRarity(r: Rarity): HeroId[] {
  return (Object.keys(HERO_CATALOG) as HeroId[]).filter((h) => HERO_CATALOG[h].rarity === r && !HERO_CATALOG[h].starter);
}

export interface ChestOutcome {
  rarity: Rarity;
  hero: HeroId;
  guarantee: Guarantee;
  duplicate: boolean;
  fragments: number;
  pityAfter: PityState;
}

/**
 * Resuelve una apertura con dos números aleatorios ya sorteados (el servidor
 * usa crypto.randomInt): `rarityRoll` en [0, ODDS_SCALE) y `heroRoll` en
 * [0, cantidad de héroes de esa rareza). Pura y determinista para probarla.
 */
export function resolveChest(type: ChestType, pity: PityState, owned: ReadonlySet<HeroId>, rarityRoll: number, heroRoll: (n: number) => number): ChestOutcome {
  const { odds, guarantee } = effectiveOdds(type, pity);
  const rarity = pickRarity(odds, rarityRoll);
  const pool = heroesOfRarity(rarity);
  const hero = pool[heroRoll(pool.length)];
  const duplicate = owned.has(hero);
  return {
    rarity, hero, guarantee, duplicate,
    fragments: duplicate ? ECONOMY.duplicateFragments[rarity] : 0,
    pityAfter: nextPity(pity, rarity),
  };
}

// ---------------------------------------------------------------- calendario

/** Fecha (AAAA-MM-DD) en la zona horaria de la economía. */
export function localDate(at: Date, timeZone: string = ECONOMY.objectives.timeZone): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Desfase (minutos) de la zona horaria respecto de UTC en ese instante. */
function tzOffsetMinutes(at: Date, timeZone: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(at);
  const v = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const asUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Instante UTC de la medianoche local de una fecha AAAA-MM-DD. */
function localMidnight(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const off = tzOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - off * 60000);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export interface Periods {
  day: string;
  /** Lunes (fecha local) que inicia la semana. */
  week: string;
  dailyResetAt: Date;
  weeklyResetAt: Date;
}

/** Períodos diario y semanal (semana de lunes a domingo) calculados en el servidor. */
export function periods(at: Date, timeZone: string = ECONOMY.objectives.timeZone): Periods {
  const day = localDate(at, timeZone);
  const [y, m, d] = day.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = lunes
  const week = addDays(day, -dow);
  return {
    day,
    week,
    dailyResetAt: localMidnight(addDays(day, 1), timeZone),
    weeklyResetAt: localMidnight(addDays(week, 7), timeZone),
  };
}

// ---------------------------------------------------------------- validación

/** Entero positivo dentro de un límite (rechaza decimales, negativos, NaN y desbordes). */
export function positiveInt(v: unknown, max: number): number | null {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0 || v > max) return null;
  return v;
}
