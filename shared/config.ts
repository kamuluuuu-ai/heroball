// Configuración centralizada de HeroBall.
//
// Unidades: distancia en "unidades de cancha" (px lógicos), tiempo en ticks
// de simulación (60 por segundo), velocidades en unidades/tick.
//
// Procedencia de los valores:
// - PLAYER / BALL / STADIUM: valores por defecto que se leyeron en el cliente
//   público de HaxBall (estadio "Classic" y física por defecto) al inspeccionarlo.
//   Se usan como punto de partida; HeroBall no es HaxBall y su motor es propio,
//   así que la sensación final puede diferir.
// - Todo lo demás (límites de seguridad, poderes, bots) es una decisión de
//   diseño de HeroBall, no un dato de HaxBall.

export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 2; // 30 snapshots/s

export const PLAYER = {
  radius: 15,
  bCoef: 0.5,
  invMass: 0.5,
  damping: 0.96,
  acceleration: 0.1,
  kickingAcceleration: 0.07,
  kickingDamping: 0.96,
  kickStrength: 5,
  kickback: 0,
};

export const BALL = {
  radius: 10,
  bCoef: 0.5,
  invMass: 1,
  damping: 0.99,
};

/** Reglas de patada y límites de seguridad (decisiones de HeroBall). */
export const KICK = {
  /** Distancia extra entre bordes para que una patada sea válida. */
  range: 4,
  /** Ticks mínimos entre dos patadas del mismo jugador. */
  rateTicks: 6,
  /**
   * 0 = como HaxBall: mantener apretado arma una sola patada; hay que soltar
   * y volver a apretar para patear otra vez. >0 = mientras se mantiene,
   * se rearma cada N ticks.
   */
  holdRepeatTicks: 0,
};

export const LIMITS = {
  /**
   * Velocidad máxima alcanzable con la propia aceleración (antes del
   * amortiguamiento). 2.5 coincide con la velocidad terminal natural
   * (a·d/(1-d) + a), así que no altera el modo Clásico.
   */
  playerInputSpeed: 2.5,
  /** Topes duros contra explosiones físicas. */
  playerMaxSpeed: 7,
  ballMaxSpeed: 15,
  /** Desplazamiento máximo por subpaso (evita atravesar postes y paredes). */
  maxStepDistance: 4,
};

export const STADIUM = {
  /** Mitad del ancho/alto total (límite de los jugadores y de la cámara). */
  width: 420,
  height: 200,
  /** Mitad del ancho/alto de la zona de juego de la pelota (líneas blancas). */
  fieldW: 370,
  fieldH: 170,
  goalHalf: 64,
  goalDepth: 30,
  postRadius: 8,
  kickoffRadius: 75,
  spawnDistance: 277.5,
  spawnSpacing: 55,
  wallBCoef: 1,
  netBCoef: 0.1,
};

export const RULES = {
  goalPauseTicks: 150,
  endPauseTicks: 300,
  defaultTimeLimitMin: 3,
  defaultScoreLimit: 3,
};

export const COLORS = {
  red: '#E56E56',
  blue: '#5689E5',
  redPost: '#FFCCCC',
  bluePost: '#CCCCFF',
  grass: '#718C5A',
  grassStripe: '#6A8553',
  lines: '#C7E6BD',
  ball: '#FFFFFF',
};

/** R = radio normal de un jugador. Los alcances de poderes se expresan en R. */
export const R = PLAYER.radius;
const sec = (s: number) => Math.round(s * TICK_RATE);

/** Poderes del modo Héroes. */
export const POWERS = {
  spider: {
    web: {
      range: 8 * R,
      speed: 14,
      radius: 3,
      pullTicks: sec(0.7),
      pullAccel: 0.5,
      pullMaxSpeed: 7,
      /** El hilo se corta si la distancia jugador-pelota supera range × este factor. */
      breakFactor: 1.15,
      /** Autoapuntado a la pelota si está dentro del alcance y a la vista. */
      autoAim: true,
      /** Si el hilo puede pegarse a un rival y atraerlo (en Héroes, un rival lo corta). */
      grabsRivals: false,
      rivalPullTicks: 0,
      rivalPullAccel: 0,
      rivalPullMaxSpeed: 0,
      cooldown: sec(7),
    },
    dash: {
      ticks: sec(0.25),
      speedMult: 2,
      cooldown: sec(6),
    },
  },
  batman: {
    batarang: {
      range: 9 * R,
      speed: 10,
      radius: 5,
      /** Cantidad de batarangs por lanzamiento y separación angular (grados). */
      count: 1,
      spread: 0,
      ballImpulse: 2.6,
      slowPct: 0.3,
      slowTicks: sec(0.8),
      /** Autoapuntado a la pelota o a un rival dentro del alcance. */
      autoAim: true,
      /** Medio ángulo (grados) alrededor de la dirección apuntada donde busca objetivo. */
      autoAimCone: 90,
      cooldown: sec(6),
    },
    grapple: {
      /** Alcance del gancho (siempre se lanza hacia la pelota, anticipando su movimiento). */
      range: 10 * R,
      speed: 18,
      radius: 3,
      /** Duración máxima del tirón una vez enganchado. */
      pullTicks: sec(0.9),
      pullAccel: 0.6,
      pullMaxSpeed: 7,
      breakFactor: 1.3,
      /** Empujón a la pelota al llegar, en la dirección del viaje (0 = nada). */
      arriveImpulse: 0,
      cooldown: sec(7),
    },
  },
  hulk: {
    slam: {
      range: 4 * R,
      ballImpulse: 7,
      playerImpulse: 5,
      /** Aturdimiento a los rivales alcanzados (0 = nada). */
      stunPct: 0,
      stunTicks: 0,
      cooldown: sec(8),
    },
    fury: {
      ticks: sec(2),
      massMult: 2.5,
      kickMult: 1.35,
      accelMult: 0.85,
      cooldown: sec(12),
    },
  },
  superman: {
    superShot: {
      ticks: sec(2),
      kickMult: 1.5,
      cooldown: sec(8),
    },
    superSpeed: {
      ticks: sec(1.2),
      mult: 1.4,
      cooldown: sec(10),
    },
  },
  // ---- héroes desbloqueables (mismos radio, velocidad y patada base) ----
  hawkeye: {
    /** Proyectil recto sin seguimiento; cualquier jugador lo bloquea. */
    arrow: { range: 10 * R, speed: 13, radius: 3, ballImpulse: 2.4, cooldown: sec(7) },
    /** Desplazamiento corto con colisiones durante todo el recorrido. */
    sidestep: { distance: 2.5 * R, speed: 6.25, cooldown: sec(8) },
  },
  widow: {
    /** Atraviesa aliados y pelota; ralentiza al primer rival alcanzado. */
    shock: { range: 6 * R, speed: 12, radius: 4, slowPct: 0.2, slowTicks: sec(0.7), cooldown: sec(8) },
    /** Reduce los empujes recibidos de poderes (no las colisiones). */
    evade: { ticks: sec(0.6), resist: 0.5, cooldown: sec(10) },
  },
  cap: {
    /** Un solo impacto físico; luego vuelve (sólo visual) al capitán. */
    shield: { range: 8 * R, speed: 11, radius: 6, ballImpulse: 3, returnSpeed: 12, cooldown: sec(8) },
    guard: { ticks: sec(1), resist: 0.6, accelMult: 0.75, cooldown: sec(10) },
  },
  panther: {
    leap: { distance: 4 * R, speed: 6.7, cooldown: sec(8) },
    /** Anticipación visible y luego empuje radial centrado en Black Panther. */
    pulse: { delay: sec(0.3), range: 3 * R, playerImpulse: 4.5, ballImpulse: 2.5, cooldown: sec(10) },
  },
  ironman: {
    repulsor: { range: 10 * R, speed: 11, radius: 4, ballImpulse: 3.4, cooldown: sec(8) },
    /** Más aceleración y velocidad, pero gira peor (control lateral reducido). */
    thrusters: { ticks: sec(0.9), mult: 1.3, turn: 0.45, cooldown: sec(10) },
  },
  flash: {
    sprint: { ticks: sec(0.7), accelMult: 1.5, speedMult: 1.35, cooldown: sec(8) },
    /** Estela que ralentiza rivales; el efecto dura como máximo `lingerTicks` tras salir. */
    trail: { ticks: sec(1.2), dropTicks: sec(0.6), dropEvery: 4, radius: 1.3 * R, slowPct: 0.15, lingerTicks: sec(0.5), cooldown: sec(11) },
  },
  thor: {
    hammer: { range: 8 * R, speed: 10, radius: 6, ballImpulse: 3, playerImpulse: 4, cooldown: sec(9) },
    /** Zona marcada `delay` ticks; luego impulso radial (se puede esquivar). */
    thunder: { delay: sec(0.5), ahead: 4 * R, range: 3 * R, playerImpulse: 4, ballImpulse: 4, cooldown: sec(12) },
  },
  strange: {
    /** Desvía la pelota una sola vez hacia la dirección fijada al activar, sin acelerarla. */
    deflect: { ahead: 6 * R, radius: 1.4 * R, ticks: sec(1), maxAngle: 30, cooldown: sec(10) },
    /** Teletransporte sólo a una posición legal con recorrido libre. */
    blink: { distance: 3 * R, minDistance: 0.5 * R, cooldown: sec(12) },
  },
};

export type PowerConfig = typeof POWERS;

/** Poderes del modo Súper: misma forma, todo potenciado y con recargas más cortas. */
export const SUPER_POWERS: PowerConfig = {
  spider: {
    web: {
      ...POWERS.spider.web,
      // alcanza la pelota desde cualquier punto de la cancha
      range: 60 * R,
      speed: 22,
      pullTicks: sec(1.4),
      pullAccel: 0.8,
      pullMaxSpeed: 10,
      breakFactor: 1.05,
      // si el hilo toca a un rival, se le pega y lo arrastra hacia Spider-Man
      grabsRivals: true,
      rivalPullTicks: sec(0.7),
      rivalPullAccel: 0.7,
      rivalPullMaxSpeed: 6.5,
      cooldown: sec(5),
    },
    dash: { ticks: sec(0.4), speedMult: 2.6, cooldown: sec(3.5) },
  },
  batman: {
    batarang: {
      ...POWERS.batman.batarang,
      range: 13 * R,
      speed: 12,
      count: 3,
      spread: 14,
      ballImpulse: 3.5,
      slowPct: 0.5,
      slowTicks: sec(1.3),
      cooldown: sec(4.5),
    },
    grapple: {
      ...POWERS.batman.grapple,
      range: 60 * R,
      speed: 28,
      pullTicks: sec(1.6),
      pullAccel: 1,
      breakFactor: 1.05,
      arriveImpulse: 4,
      cooldown: sec(4),
    },
  },
  hulk: {
    slam: { range: 7 * R, ballImpulse: 11, playerImpulse: 8, stunPct: 0.5, stunTicks: sec(1), cooldown: sec(5) },
    fury: { ticks: sec(4), massMult: 4, kickMult: 1.7, accelMult: 1, cooldown: sec(8) },
  },
  superman: {
    superShot: { ticks: sec(4), kickMult: 2.2, cooldown: sec(5) },
    superSpeed: { ticks: sec(2.5), mult: 1.8, cooldown: sec(6) },
  },
  // Ajustes explícitos (no un multiplicador general): más alcance y recargas
  // más cortas, conservando anticipaciones, topes de ralentización y la
  // prohibición de atravesar paredes o jugadores.
  hawkeye: {
    arrow: { ...POWERS.hawkeye.arrow, range: 14 * R, speed: 15, ballImpulse: 3, cooldown: sec(5) },
    sidestep: { ...POWERS.hawkeye.sidestep, distance: 3.5 * R, cooldown: sec(6) },
  },
  widow: {
    shock: { ...POWERS.widow.shock, range: 8 * R, slowPct: 0.3, slowTicks: sec(1), cooldown: sec(6) },
    evade: { ticks: sec(1), resist: 0.7, cooldown: sec(8) },
  },
  cap: {
    shield: { ...POWERS.cap.shield, range: 11 * R, ballImpulse: 3.8, cooldown: sec(6) },
    guard: { ticks: sec(1.5), resist: 0.75, accelMult: 0.8, cooldown: sec(8) },
  },
  panther: {
    leap: { ...POWERS.panther.leap, distance: 5.5 * R, cooldown: sec(6) },
    pulse: { ...POWERS.panther.pulse, range: 3.5 * R, playerImpulse: 5.5, ballImpulse: 3, cooldown: sec(8) },
  },
  ironman: {
    repulsor: { ...POWERS.ironman.repulsor, range: 13 * R, ballImpulse: 4.2, cooldown: sec(6) },
    thrusters: { ticks: sec(1.3), mult: 1.4, turn: 0.45, cooldown: sec(8) },
  },
  flash: {
    sprint: { ticks: sec(1), accelMult: 1.7, speedMult: 1.5, cooldown: sec(6) },
    trail: { ...POWERS.flash.trail, ticks: sec(1.6), dropTicks: sec(0.8), slowPct: 0.2, cooldown: sec(9) },
  },
  thor: {
    hammer: { ...POWERS.thor.hammer, range: 10 * R, ballImpulse: 3.6, playerImpulse: 5, cooldown: sec(7) },
    thunder: { ...POWERS.thor.thunder, range: 3.5 * R, playerImpulse: 5, ballImpulse: 5, cooldown: sec(9) },
  },
  strange: {
    deflect: { ...POWERS.strange.deflect, ahead: 8 * R, ticks: sec(1.3), maxAngle: 40, cooldown: sec(8) },
    blink: { ...POWERS.strange.blink, distance: 4 * R, cooldown: sec(9) },
  },
};

/** Configuración de poderes según el modo (Clásico no usa poderes). */
export function powersFor(mode: string): PowerConfig {
  return mode === 'super' ? SUPER_POWERS : POWERS;
}

export type HeroId =
  | 'spider' | 'batman' | 'hulk' | 'superman'
  | 'hawkeye' | 'widow' | 'cap' | 'panther' | 'ironman' | 'flash' | 'thor' | 'strange';
export const STARTER_IDS: HeroId[] = ['spider', 'batman', 'hulk', 'superman'];
export const HERO_IDS: HeroId[] = [...STARTER_IDS, 'hawkeye', 'widow', 'cap', 'panther', 'ironman', 'flash', 'thor', 'strange'];

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type HeroRole = 'ataque' | 'defensa' | 'control' | 'movilidad';

/**
 * Catálogo: la rareza indica frecuencia de obtención en cofres, no poder.
 * Los iniciales son gratis para todos y no aparecen en cofres.
 */
export const HERO_CATALOG: Record<HeroId, { rarity: Rarity; role: HeroRole; starter: boolean }> = {
  spider: { rarity: 'common', role: 'control', starter: true },
  batman: { rarity: 'common', role: 'control', starter: true },
  hulk: { rarity: 'common', role: 'defensa', starter: true },
  superman: { rarity: 'common', role: 'ataque', starter: true },
  hawkeye: { rarity: 'common', role: 'ataque', starter: false },
  widow: { rarity: 'common', role: 'control', starter: false },
  cap: { rarity: 'rare', role: 'defensa', starter: false },
  panther: { rarity: 'rare', role: 'movilidad', starter: false },
  ironman: { rarity: 'epic', role: 'ataque', starter: false },
  flash: { rarity: 'epic', role: 'movilidad', starter: false },
  thor: { rarity: 'legendary', role: 'defensa', starter: false },
  strange: { rarity: 'legendary', role: 'control', starter: false },
};

export const RARITY_LABEL: Record<Rarity, string> = { common: 'Común', rare: 'Raro', epic: 'Épico', legendary: 'Legendario' };
export const ROLE_LABEL: Record<HeroRole, string> = { ataque: 'Ataque', defensa: 'Defensa', control: 'Control', movilidad: 'Movilidad' };

export interface PowerInfo {
  name: string;
  desc: string;
  cooldown: number;
}

export interface HeroInfo {
  name: string;
  q: PowerInfo;
  e: PowerInfo;
}

const S = SUPER_POWERS;

/** Número en R con coma decimal (2.5 → "2,5R"). */
const inR = (v: number) => `${String(+(v / R).toFixed(1)).replace('.', ',')}R`;
const secs = (t: number) => `${String(+(t / TICK_RATE).toFixed(2)).replace('.', ',')} s`;
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Textos de los héroes desbloqueables, generados desde los valores del modo. */
function newHeroes(P: PowerConfig): Record<Exclude<HeroId, 'spider' | 'batman' | 'hulk' | 'superman'>, HeroInfo> {
  return {
    hawkeye: {
      name: 'Hawkeye',
      q: { name: 'Flecha de precisión', desc: `Flecha recta (${inR(P.hawkeye.arrow.range)}) que empuja la pelota. Sin seguimiento; la frena cualquier jugador.`, cooldown: P.hawkeye.arrow.cooldown },
      e: { name: 'Paso lateral', desc: `Desplazamiento de hasta ${inR(P.hawkeye.sidestep.distance)} hacia donde apuntás, chocando normalmente.`, cooldown: P.hawkeye.sidestep.cooldown },
    },
    widow: {
      name: 'Black Widow',
      q: { name: 'Descarga', desc: `Proyectil (${inR(P.widow.shock.range)}): el primer rival alcanzado acelera ${pct(P.widow.shock.slowPct)} menos durante ${secs(P.widow.shock.slowTicks)}.`, cooldown: P.widow.shock.cooldown },
      e: { name: 'Evasión', desc: `Durante ${secs(P.widow.evade.ticks)} recibís ${pct(P.widow.evade.resist)} menos de empuje de poderes. Seguís chocando.`, cooldown: P.widow.evade.cooldown },
    },
    cap: {
      name: 'Capitán América',
      q: { name: 'Escudo', desc: `Lanza el escudo (${inR(P.cap.shield.range)}): un solo impacto a la pelota y vuelve sin volver a golpear.`, cooldown: P.cap.shield.cooldown },
      e: { name: 'Guardia', desc: `Durante ${secs(P.cap.guard.ticks)} resistís ${pct(P.cap.guard.resist)} de los empujes de poderes, con ${pct(1 - P.cap.guard.accelMult)} menos aceleración.`, cooldown: P.cap.guard.cooldown },
    },
    panther: {
      name: 'Black Panther',
      q: { name: 'Salto felino', desc: `Avance de hasta ${inR(P.panther.leap.distance)} hacia donde apuntás; se detiene ante jugadores, pelota u obstáculos.`, cooldown: P.panther.leap.cooldown },
      e: { name: 'Pulso cinético', desc: `Tras ${secs(P.panther.pulse.delay)} de aviso empuja a los rivales a ${inR(P.panther.pulse.range)} y un poco la pelota.`, cooldown: P.panther.pulse.cooldown },
    },
    ironman: {
      name: 'Iron Man',
      q: { name: 'Repulsor', desc: `Disparo recto (${inR(P.ironman.repulsor.range)}) que impulsa la pelota en la dirección del disparo. Sin autoapuntado.`, cooldown: P.ironman.repulsor.cooldown },
      e: { name: 'Propulsores', desc: `+${pct(P.ironman.thrusters.mult - 1)} aceleración y velocidad máxima durante ${secs(P.ironman.thrusters.ticks)}, girando peor.`, cooldown: P.ironman.thrusters.cooldown },
    },
    flash: {
      name: 'Flash',
      q: { name: 'Carrera relámpago', desc: `+${pct(P.flash.sprint.accelMult - 1)} aceleración y +${pct(P.flash.sprint.speedMult - 1)} velocidad máxima durante ${secs(P.flash.sprint.ticks)}.`, cooldown: P.flash.sprint.cooldown },
      e: { name: 'Estela', desc: `Deja una estela (${secs(P.flash.trail.ticks)}) que reduce ${pct(P.flash.trail.slowPct)} la aceleración rival; dura hasta ${secs(P.flash.trail.lingerTicks)} tras salir.`, cooldown: P.flash.trail.cooldown },
    },
    thor: {
      name: 'Thor',
      q: { name: 'Mjolnir', desc: `Martillo (${inR(P.thor.hammer.range)}) que empuja la pelota o al primer rival alcanzado.`, cooldown: P.thor.hammer.cooldown },
      e: { name: 'Trueno', desc: `Marca una zona de ${inR(P.thor.thunder.range)} delante durante ${secs(P.thor.thunder.delay)}; luego empuja todo lo que siga dentro.`, cooldown: P.thor.thunder.cooldown },
    },
    strange: {
      name: 'Doctor Strange',
      q: { name: 'Desvío arcano', desc: `Portal hasta ${inR(P.strange.deflect.ahead)} delante: durante ${secs(P.strange.deflect.ticks)} desvía la pelota una vez hasta ${P.strange.deflect.maxAngle}° hacia la flecha, sin acelerarla.`, cooldown: P.strange.deflect.cooldown },
      e: { name: 'Paso místico', desc: `Teletransporte de hasta ${inR(P.strange.blink.distance)} con recorrido libre; no atraviesa paredes, jugadores ni pelota.`, cooldown: P.strange.blink.cooldown },
    },
  };
}

export const HEROES: Record<HeroId, HeroInfo> = {
  spider: {
    name: 'Spider-Man',
    q: { name: 'Telaraña', desc: 'Apunta sola a la pelota y la atrae (8R).', cooldown: POWERS.spider.web.cooldown },
    e: { name: 'Impulso arácnido', desc: 'Desplazamiento rápido 0,25 s.', cooldown: POWERS.spider.dash.cooldown },
  },
  batman: {
    name: 'Batman',
    q: { name: 'Batarang', desc: 'Apunta solo al objetivo más alineado: empuja la pelota o frena a un rival (9R).', cooldown: POWERS.batman.batarang.cooldown },
    e: { name: 'Gancho', desc: 'Se engancha a la pelota y te lleva hacia ella (10R).', cooldown: POWERS.batman.grapple.cooldown },
  },
  hulk: {
    name: 'Hulk',
    q: { name: 'Golpe al suelo', desc: 'Onda 4R que empuja pelota y rivales.', cooldown: POWERS.hulk.slam.cooldown },
    e: { name: 'Furia', desc: 'Más masa y patada +35 % durante 2 s.', cooldown: POWERS.hulk.fury.cooldown },
  },
  superman: {
    name: 'Superman',
    q: { name: 'Súper disparo', desc: 'Próxima patada +50 % (2 s).', cooldown: POWERS.superman.superShot.cooldown },
    e: { name: 'Súper velocidad', desc: '+40 % aceleración y velocidad 1,2 s.', cooldown: POWERS.superman.superSpeed.cooldown },
  },
  ...newHeroes(POWERS),
};

/** Textos del modo Súper. */
export const SUPER_HEROES: Record<HeroId, HeroInfo> = {
  spider: {
    name: 'Spider-Man',
    q: { name: 'Súper telaraña', desc: 'Agarra la pelota desde cualquier lugar de la cancha; si toca a un rival, lo arrastra hacia vos.', cooldown: S.spider.web.cooldown },
    e: { name: 'Impulso arácnido', desc: 'Desplazamiento más largo y rápido (0,4 s).', cooldown: S.spider.dash.cooldown },
  },
  batman: {
    name: 'Batman',
    q: { name: 'Triple batarang', desc: 'Tres batarangs en abanico (13R): frenan 50 % a los rivales 1,3 s.', cooldown: S.batman.batarang.cooldown },
    e: { name: 'Súper gancho', desc: 'Gancho a la pelota desde cualquier lugar; al llegar la empuja en tu dirección.', cooldown: S.batman.grapple.cooldown },
  },
  hulk: {
    name: 'Hulk',
    q: { name: 'Terremoto', desc: 'Onda 7R mucho más fuerte que además aturde a los rivales 1 s.', cooldown: S.hulk.slam.cooldown },
    e: { name: 'Furia total', desc: 'Masa ×4 y patada +70 % durante 4 s, sin perder velocidad.', cooldown: S.hulk.fury.cooldown },
  },
  superman: {
    name: 'Superman',
    q: { name: 'Disparo de acero', desc: 'Próxima patada ×2,2 (4 s).', cooldown: S.superman.superShot.cooldown },
    e: { name: 'Vuelo supersónico', desc: '+80 % aceleración y velocidad durante 2,5 s.', cooldown: S.superman.superSpeed.cooldown },
  },
  ...newHeroes(S),
};

export function heroInfo(hero: HeroId, mode: string): HeroInfo {
  return (mode === 'super' ? SUPER_HEROES : HEROES)[hero];
}
