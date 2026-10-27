// Partidas oficiales: el resumen lo arma la sala del servidor a partir de su
// propia simulación (nunca de lo que diga un cliente o un anfitrión P2P) y
// estas reglas puras deciden quién es elegible para recompensa.
import { isSecret, type HeroId } from '../shared/config';
import { ECONOMY } from '../shared/economy';
import type { GameMode, Team } from '../shared/types';

/** Modos que pueden ser oficiales. Súper queda como casual. */
export const OFFICIAL_MODES: GameMode[] = ['heroes', 'classic'];

export interface ParticipantSummary {
  userId: string;
  team: Team;
  hero: HeroId;
  /** Ticks de partido en que estuvo en un equipo y activo (con entradas recientes). */
  activeTicks: number;
  /** Seguía en la sala y en su equipo al terminar (no abandonó). */
  present: boolean;
}

export interface MatchSummary {
  id: string;
  mode: GameMode;
  startedAt: Date;
  endedAt: Date;
  /** Ticks de partido sin contar pausas. */
  matchTicks: number;
  score: { red: number; blue: number };
  winner: Team | null;
  kicks: { red: number; blue: number };
  /** Terminó por las reglas (no se detuvo ni reinició). */
  finished: boolean;
  /** Se jugó «Sin cooldowns» (siempre casual). */
  noCooldowns?: boolean;
  participants: ParticipantSummary[];
}

export interface Verdict {
  userId: string;
  eligible: boolean;
  reason: string | null;
  won: boolean;
  activeRatio: number;
  /** Ids de los rivales, ordenados (para detectar rivales repetidos). */
  opponents: string;
}

/**
 * `sameOpponentsToday(userId, opponents)`: partidas elegibles que ese usuario
 * ya jugó hoy (hora local de la economía) contra exactamente esos rivales.
 */
export function evaluateMatch(m: MatchSummary, sameOpponentsToday: (userId: string, opponents: string) => number): Verdict[] {
  const R = ECONOMY.match;
  const seconds = m.matchTicks / 60;
  const present = m.participants.filter((p) => p.present);
  const accounts = (t: Team) => new Set(present.filter((p) => p.team === t).map((p) => p.userId));
  const red = accounts('red');
  const blue = accounts('blue');
  // una misma cuenta no puede contar en ambos equipos
  const both = [...red].some((u) => blue.has(u));

  let common: string | null = null;
  if (!m.finished) common = 'El partido no terminó por reglamento (se detuvo o reinició).';
  else if (!OFFICIAL_MODES.includes(m.mode)) common = 'El modo Súper es casual: no entrega recompensas.';
  else if (m.noCooldowns) common = 'Partida sin cooldowns: es casual y no entrega recompensas.';
  else if (m.participants.some((p) => isSecret(p.hero))) common = 'Participó un personaje especial: la partida es casual y no entrega recompensas.';
  else if (seconds < R.minSeconds) common = `Duró menos de ${R.minSeconds} s.`;
  else if (red.size < 1 || blue.size < 1 || red.size + blue.size < 2 || both) common = 'Hacen falta cuentas distintas en ambos equipos.';
  else if (m.kicks.red < R.minKicksPerTeam || m.kicks.blue < R.minKicksPerTeam) common = 'Un equipo casi no jugó la pelota.';

  return m.participants.map((p) => {
    const ratio = m.matchTicks > 0 ? Math.min(1, p.activeTicks / m.matchTicks) : 0;
    const opponents = [...(p.team === 'red' ? blue : red)].sort().join(',');
    let reason = common;
    if (!reason && !p.present) reason = 'Abandonaste, pasaste a espectador o cambiaste de equipo antes del final.';
    if (!reason && ratio < R.minParticipation) reason = `Participación activa ${Math.round(ratio * 100)} % (mínimo ${Math.round(R.minParticipation * 100)} %).`;
    if (!reason && sameOpponentsToday(p.userId, opponents) >= R.sameOpponentsDaily) reason = 'Ya jugaste hoy varias partidas con exactamente los mismos rivales.';
    return {
      userId: p.userId,
      eligible: reason === null,
      reason,
      won: m.winner !== null && m.winner === p.team,
      activeRatio: ratio,
      opponents,
    };
  });
}

/** Monedas de una partida elegible, respetando el tope diario de partidas. */
export function matchCoins(won: boolean, alreadyToday: number): number {
  const R = ECONOMY.match;
  const base = R.completeCoins + (won ? R.winBonus : 0);
  return Math.max(0, Math.min(base, R.dailyCap - alreadyToday));
}

/** Lo que la sala oficial necesita del servicio de economía. */
export interface OfficialAdapter {
  /** Héroes que el usuario puede usar (iniciales + desbloqueados). */
  ownedHeroes(userId: string): Promise<Set<HeroId>>;
  /** Resuelve recompensas una sola vez por partida. */
  settle(m: MatchSummary): Promise<SettleResult[]>;
}

export interface SettleResult {
  userId: string;
  eligible: boolean;
  reason: string | null;
  coins: number;
  dailyBonus: number;
  weeklyElite: number;
}
