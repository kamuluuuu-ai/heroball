import type { HeroId } from './config';
import type { Disc } from './physics';

export type Team = 'red' | 'blue';
export type Side = Team | 'spec';
export type GameMode = 'classic' | 'heroes' | 'super';
export type Phase = 'kickoff' | 'playing' | 'goal' | 'ended';

/** Bits de entrada. El cliente sólo envía esto: nunca posiciones ni impactos. */
export const IN = {
  UP: 1,
  DOWN: 2,
  LEFT: 4,
  RIGHT: 8,
  KICK: 16,
  Q: 32,
  E: 64,
} as const;
export const INPUT_MASK = 127;

export interface PlayerState {
  id: string;
  team: Team;
  hero: HeroId;
  /** Cambio de héroe pedido durante el partido: se aplica en el próximo saque. */
  pendingHero: HeroId | null;
  d: Disc;
  input: number;
  prevInput: number;
  kickArmed: boolean;
  kickCd: number;
  kickHeldTicks: number;
  /** Dirección apuntada: última dirección de movimiento no nula. */
  ax: number;
  ay: number;
  cdQ: number;
  cdE: number;
  dash: number;
  fury: number;
  superShot: number;
  superSpeed: number;
  /** Ralentización por batarang o aturdimiento de Hulk. */
  slowPct: number;
  slowTicks: number;
  /** Ralentización efectiva aplicada este tick (para dibujar). */
  slowNow: number;
  /** Desplazamiento con colisiones (Paso lateral, Salto felino): ticks y velocidad. */
  rush: number;
  rushSpeed: number;
  rushDx: number;
  rushDy: number;
  /** Efectos temporales de los héroes desbloqueables (ticks restantes). */
  evade: number;
  guard: number;
  thrusters: number;
  sprint: number;
}

export interface Projectile {
  id: number;
  kind: 'web' | 'batarang' | 'hook' | 'arrow' | 'shock' | 'shield' | 'repulsor' | 'hammer';
  /** Escudo de vuelta: sólo visual, no golpea nada. */
  returning?: boolean;
  owner: string;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dist: number;
  max: number;
}

/**
 * Hilo activo: 'web' (Spider-Man atrae la pelota), 'rival' (Spider-Man atrae a
 * un rival, sólo Súper) o 'grapple' (gancho: Batman va hacia la pelota).
 */
export interface Tether {
  owner: string;
  kind: 'web' | 'rival' | 'grapple';
  /** Id del rival en 'rival'; null si el extremo es la pelota. */
  target: string | null;
  ticks: number;
}

/**
 * Zona de efecto con anticipación visible:
 * - 'pulse': Black Panther, sigue al dueño y explota a los `delay` ticks.
 * - 'thunder': Thor, fija; explota a los `delay` ticks.
 * - 'trail': Flash, puntos de estela que ralentizan rivales.
 * - 'deflect': Doctor Strange, desvía una vez la pelota hacia (dx, dy).
 */
export interface Zone {
  id: number;
  kind: 'pulse' | 'thunder' | 'trail' | 'deflect';
  owner: string;
  team: Team;
  x: number;
  y: number;
  r: number;
  /** Ticks hasta que explota (pulse/thunder); 0 para las demás. */
  delay: number;
  /** Ticks de vida restantes. */
  ticks: number;
  dx: number;
  dy: number;
  pts: { x: number; y: number }[];
}

export type GameEvent =
  | { type: 'kick'; id: string; power: number }
  | { type: 'goal'; team: Team; scorer: string | null }
  | { type: 'power'; id: string; slot: 'q' | 'e'; hero: HeroId }
  | { type: 'slam'; x: number; y: number; r: number }
  | { type: 'blink'; id: string; x0: number; y0: number; x1: number; y1: number }
  | { type: 'hit'; x: number; y: number; target: 'ball' | 'player' | 'wall' }
  | { type: 'tether'; id: string }
  | { type: 'kickoff' }
  | { type: 'end'; winner: Team | null }
  | { type: 'overtime' };

export interface GameState {
  tick: number;
  mode: GameMode;
  phase: Phase;
  phaseTicks: number;
  kickoffTeam: Team;
  score: { red: number; blue: number };
  /** Ticks de tiempo de juego transcurridos. */
  time: number;
  /** Límite en ticks (0 = sin límite). */
  timeLimit: number;
  /** Goles para ganar (0 = sin límite). */
  scoreLimit: number;
  overtime: boolean;
  winner: Team | null;
  paused: boolean;
  ball: Disc;
  players: PlayerState[];
  projectiles: Projectile[];
  tethers: Tether[];
  zones: Zone[];
  nextId: number;
  lastTouch: string | null;
  events: GameEvent[];
}
