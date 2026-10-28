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
/**
 * Bits 7–9: un número 1–5 (0 = nada). Thanos elige gema con 1–5; con un quiz
 * abierto, 1–3 es la respuesta. Viaja como entrada: la autoridad lo valida.
 */
export const IN_NUM_SHIFT = 7;
export const IN_NUM_MASK = 7 << IN_NUM_SHIFT;
export const INPUT_MASK = 1023;
export const inNum = (bits: number): number => (bits & IN_NUM_MASK) >> IN_NUM_SHIFT;

/** Quiz de Baldi abierto sobre un jugador. */
export interface Quiz {
  /** Quién lo lanzó. */
  by: string;
  text: string;
  opts: [number, number, number];
  /** Índice de la respuesta correcta en `opts`. */
  answer: number;
  ticks: number;
  max: number;
  /** Respuestas incorrectas dadas (no alargan el quiz). */
  wrong: number;
}

/** Ilusión de la Gema de la Realidad: los rivales de `team` ven una pelota falsa en (x, y). */
export interface Illusion {
  by: string;
  team: Team;
  x: number;
  y: number;
  ticks: number;
}

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
  /** Ticks que la patada sigue armada tras soltar la tecla (KICK.graceTicks). */
  kickGrace: number;
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
  /** Atrapado por la rosquilla: sin movimiento voluntario (patea y usa poderes sin desplazamiento). */
  trap: number;
  /** Control mental (Gema de la Mente): quién lo mueve y ticks restantes. */
  mindBy: string | null;
  mind: number;
  /** Ticks seguidos de incapacidad (stun, rosquilla, mente): tope STUN.maxTicks. */
  incapRun: number;
  /** Charco de cerveza: 0..1 (1 = dentro; al salir baja gradualmente). */
  slip: number;
  /** CJ: jetpack (ticks), balas en el cargador y espera mínima entre balas. */
  jet: number;
  ammo: number;
  shotGap: number;
  /** Ibai: cuerpo gigante (ticks). El radio físico real está en d.r. */
  giant: number;
  /** Verity: enfado (ticks). */
  anger: number;
  /** Quiz de Baldi abierto y la inmunidad posterior. */
  quiz: Quiz | null;
  quizImmune: number;
  /** Thanos: gema elegida (0–4), recargas por gema, intervalo compartido y patada potenciada pendiente. */
  gem: number;
  gemCd: number[];
  gemGap: number;
  powerKick: number;
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
  /** Tope de la incapacidad continua actual (STUN.maxTicks salvo la penalización del quiz). */
  incapCap: number;
  /** Ibai gigante: tick del último golpe de patada a cada rival (intervalo mínimo). */
  kickHits: Record<string, number>;
  /** Tinta de Bendy en la pantalla de este jugador: ticks, secuencia continua, inmunidad y semilla del dibujo. */
  ink: number;
  inkRun: number;
  inkImmune: number;
  inkSeed: number;
  /** Bendy: forma de tinta (ticks). */
  inkForm: number;
  /** Jeff: chorro (ticks) y su dirección fija. */
  spray: number;
  sprayDx: number;
  sprayDy: number;
  /** Jeff: rival tragado y ticks que le quedan dentro. */
  holding: string | null;
  holdTicks: number;
  /** Tragado por este Jeff (fuera de la física; sin moverse ni actuar). */
  eatenBy: string | null;
  /** Goku: ticks de carga del Kamehameha (0 = no carga) y si la carga usa el ki. */
  charge: number;
  chargeKi: boolean;
  /** Goku: cargas de ki, espera hasta la próxima, patada potenciada pendiente y segunda transmisión gratis. */
  ki: number;
  kiGap: number;
  blinkKick: number;
  freeBlink: number;
}

export interface Projectile {
  id: number;
  kind: 'web' | 'batarang' | 'hook' | 'arrow' | 'shock' | 'shield' | 'repulsor' | 'hammer' | 'donut' | 'bullet' | 'ruler';
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
 * - 'beer': Homero, charco (cae tras `delay`, luego dura `ticks`).
 * - 'tnt': Verity, punto de caída fijo; pts[0] = punto de lanzamiento; `len` = ticks de vuelo.
 * - 'quiz': Baldi, aviso sobre `target` antes de abrir el quiz.
 * - 'punch': Ibai, aviso del guante hacia `target`.
 * - 'space': Thanos, aviso de la Gema del Espacio (destino al resolver).
 * - 'mind': Thanos, enlace visual con el rival controlado.
 * - 'timeGhost': Thanos, recorrido fantasma de la Gema del Tiempo (pts = trayecto).
 * - 'ink': Bendy, charco de tinta (cae tras `delay`, luego dura `ticks`); pts[0] = lanzamiento.
 * - 'inkTrail': Bendy, rastro de la forma de tinta (cada punto con su tick de creación).
 * - 'water': Jeff, chorro desde el dueño en (dx, dy); `r` = medio ancho, `len` = largo libre.
 * - 'kame': Goku, rayo ya disparado (sólo para dibujar); `r` = medio ancho, `len` = largo, `ang` = carga 0..1.
 */
export interface Zone {
  id: number;
  kind: 'pulse' | 'laser' | 'missile' | 'bolt' | 'trail' | 'portal' | 'beer' | 'tnt' | 'quiz' | 'punch' | 'space' | 'mind' | 'timeGhost' | 'ink' | 'inkTrail' | 'water' | 'kame';
  /** Rivales ya alcanzados (charco de tinta: una vez por rival). */
  hits?: string[];
  /** Jugador objetivo (quiz, guante, mente). */
  target?: string;
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
  | { type: 'power'; id: string; slot: 'q' | 'e'; hero: HeroId; gem?: number }
  | { type: 'slam'; x: number; y: number; r: number }
  | { type: 'blink'; id: string; x0: number; y0: number; x1: number; y1: number }
  | { type: 'boom'; x: number; y: number; r: number; kind: 'arrow' | 'missile' | 'tnt' }
  | { type: 'stun'; id: string; ticks: number }
  | { type: 'fizzle'; id: string; slot: 'q' | 'e' }
  | { type: 'rewind'; id: string; x0: number; y0: number; x1: number; y1: number }
  | { type: 'protect'; id: string }
  | { type: 'blocked'; x: number; y: number }
  | { type: 'hit'; x: number; y: number; target: 'ball' | 'player' | 'wall' }
  | { type: 'tether'; id: string }
  | { type: 'shot'; id: string; x: number; y: number; dx: number; dy: number }
  | { type: 'quiz'; id: string; by: string; result: 'open' | 'ok' | 'wrong' | 'timeout' }
  | { type: 'illusion'; by: string; team: Team; result: 'start' | 'end' }
  | { type: 'gem'; id: string; gem: number }
  | { type: 'swallow'; id: string; by: string; result: 'in' | 'out' }
  | { type: 'ink'; id: string }
  | { type: 'ki'; id: string; ki: number }
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
  /** Rosquilla en la pelota: ticks con impulsos extra reducidos. */
  ballDonut: number;
  /** Historial de los jugadores de esta jugada (Gema del Tiempo): x, y, vx, vy por tick. No viaja en los snapshots. */
  plHist: Record<string, number[]>;
  /** Ilusión activa de la Gema de la Realidad y ticks hasta que se permita otra. */
  illusion: Illusion | null;
  illusionGap: number;
  /** Ticks de juego desde el último saque (bloqueo de Tragar de Jeff). */
  liveTicks: number;
  /** Energía del Kamehameha en la pelota: ticks y quién la puso. */
  ballKi: number;
  ballKiBy: string | null;
}

