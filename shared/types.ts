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
  superSpeed: number;
  /** Ralentización de aceleración (batarang, descarga, Hulk Súper, estela). Prevalece la más fuerte. */
  slowPct: number;
  slowTicks: number;
  /** Ralentización que además baja la velocidad máxima por movimiento (estela de Flash). */
  capSlow: number;
  capSlowTicks: number;
  /** Ralentización efectiva aplicada este tick (para dibujar). */
  slowNow: number;
  /** Stun: sin moverse, patear ni usar poderes (sigue chocando). Luego `stunImmune` ticks de inmunidad. */
  stun: number;
  stunImmune: number;
  /** Desplazamiento con colisiones (Paso lateral, Salto felino): ticks y velocidad. */
  rush: number;
  rushSpeed: number;
  rushDx: number;
  rushDy: number;
  /** Menos empuje de poderes (dash Súper de Black Widow, llegada del portal): ticks y fracción. */
  evade: number;
  evadeResist: number;
  /** Flash: Q (sprint) y E (impulso de la estela), en ticks. No se multiplican: vale el mayor. */
  sprint: number;
  trailBoost: number;
  /** Mitad de la cancha donde estuvo por última vez fuera de la línea central (-1 izquierda, 1 derecha). */
  half: -1 | 1;
  /** Se incrementa en cada teletransporte: la vista no lo interpola como un recorrido. */
  warp: number;
}

export interface Projectile {
  id: number;
  kind: 'web' | 'batarang' | 'hook' | 'arrow' | 'shock' | 'shield' | 'repulsor' | 'hammer';
  /** Escudo de vuelta: sólo visual, no golpea nada. */
  returning?: boolean;
  /** Ticks de carga antes de salir (repulsor): sigue al dueño sin chocar. */
  delay?: number;
  /** Escudo encadenado: ids ya golpeados ('ball' = pelota), objetivo al que va y ticks de vida. */
  hits?: string[];
  target?: string | null;
  life?: number;
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
 * Zona de efecto con anticipación visible (se resuelve cuando `delay` llega a 0;
 * después queda `ticks` sólo para dibujar el resultado):
 * - 'pulse': Black Panther, sigue al dueño y explota.
 * - 'laser': Superman, haz desde el dueño en (dx, dy); `r` = medio ancho, `len` = largo final.
 * - 'missile': Iron Man, punto fijo; `ang` = dirección sorteada del impulso (null si no hubo).
 * - 'bolt': Thor, punto fijo que aturde a los rivales dentro.
 * - 'trail': Flash, segmentos de estela (cada punto con su tick de creación).
 * - 'portal': Doctor Strange, destino fijo del teletransporte; pts[0] = origen.
 */
export interface Zone {
  id: number;
  kind: 'pulse' | 'laser' | 'missile' | 'bolt' | 'trail' | 'portal';
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
  len: number;
  ang: number | null;
  pts: { x: number; y: number; t: number }[];
}

export type GameEvent =
  | { type: 'kick'; id: string; power: number }
  | { type: 'goal'; team: Team; scorer: string | null }
  | { type: 'power'; id: string; slot: 'q' | 'e'; hero: HeroId }
  | { type: 'slam'; x: number; y: number; r: number }
  | { type: 'blink'; id: string; x0: number; y0: number; x1: number; y1: number }
  | { type: 'boom'; x: number; y: number; r: number; kind: 'arrow' | 'missile' }
  | { type: 'stun'; id: string; ticks: number }
  | { type: 'fizzle'; id: string; slot: 'q' | 'e' }
  | { type: 'rewind'; id: string; x0: number; y0: number; x1: number; y1: number }
  | { type: 'protect'; id: string }
  | { type: 'blocked'; x: number; y: number }
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
  /** Partida «Sin cooldowns» (casual): sin espera de recarga, con las demás reglas iguales. */
  noCd: boolean;
  /** Estado del generador pseudoaleatorio de la autoridad (misil). Sólo avanza al resolver. */
  rng: number;
  /** Protección del Capitán: ticks restantes, duración total (para el arco) y quién la puso. */
  ballShield: number;
  ballShieldMax: number;
  ballShieldBy: string | null;
  /** Electricidad de Mjolnir: ticks, stun por contacto y jugadores ya aturdidos en esta aplicación. */
  ballElec: number;
  ballElecStun: number;
  ballElecHit: string[];
  /** Historial de la pelota de esta jugada (x, y, vx, vy por tick). No viaja en los snapshots. */
  ballHist: number[];
  /** Se incrementa cuando la pelota salta (rebobinado): la vista no interpola ese salto. */
  ballWarp: number;
}
