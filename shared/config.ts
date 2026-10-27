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
/**
 * K = impulso de una patada normal (antes de modificadores). Los impulsos de
 * poderes se expresan en K: a la pelota (masa 1) un impulso de 1K le suma 5
 * unidades/tick; a un jugador se le aplica según su masa (×invMass) y con topes.
 */
export const K = PLAYER.kickStrength;
const sec = (s: number) => Math.round(s * TICK_RATE);

/**
 * Controles incapacitantes (stun, atrapado por la rosquilla, control mental):
 * no acumulan duración (prevalece el tiempo restante mayor), como máximo
 * `maxTicks` de incapacidad continua y luego `immuneTicks` de inmunidad. El
 * quiz de Baldi tiene reglas propias (BALDI_QUIZ).
 */
export const STUN = {
  immuneTicks: sec(1),
  maxTicks: sec(1),
};

/**
 * Autoapuntado compartido de los poderes que lanzan algo: busca objetivos
 * válidos dentro del alcance, a la vista y en un cono de 2×coneHalf grados
 * alrededor de la última dirección de movimiento. Elige la menor desviación
 * angular, luego la menor distancia y, ante empate, el id estable. `lead` es
 * la fracción de la anticipación completa (moderada: se puede esquivar).
 */
export const AIM = {
  coneHalf: 50,
  lead: 0.6,
  /** Anticipación de los poderes de área (TNT, misil) sobre su tiempo de caída. */
  areaLead: 0.5,
  /** El marcador sólo cambia de objetivo si el nuevo se sostiene este tiempo (ms; sólo visual, sin parpadeo). */
  switchMs: 150,
};

/** Topes técnicos por partido (evitan que un abuso de poderes bloquee la simulación). */
export const POWER_LIMITS = {
  maxProjectiles: 48,
  maxZones: 48,
  /** Eventos que una sala acumula entre dos snapshots. */
  maxQueuedEvents: 120,
};

/** Poderes del modo Héroes. Distancias en unidades de cancha (R), tiempos en ticks, impulsos en K. */
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
    /**
     * Visión láser: se fija la dirección al activar (autoapuntado a pelota o rival; si no hay, última dirección de
     * movimiento), y tras `windup` ticks de aviso el haz resuelve un único
     * impacto por objetivo y queda visible `beamTicks`. `halfWidth` es la mitad
     * del ancho real del haz (el dibujo usa exactamente ese ancho).
     */
    laser: { windup: sec(0.15), range: 12 * R, beamTicks: sec(0.25), halfWidth: 0.3 * R, ballImpulse: 1.3 * K, playerImpulse: 0.8 * K, pierce: false, cooldown: sec(8) },
    superSpeed: {
      ticks: sec(1.2),
      mult: 1.4,
      cooldown: sec(10),
    },
  },
  // ---- héroes desbloqueables (mismos radio, velocidad y patada base) ----
  hawkeye: {
    /** Flecha que explota al tocar pelota, rival u obstáculo, o al final de su alcance. Empuja a todos (también al arquero). */
    arrow: { range: 12 * R, speed: 13, radius: 3, blastRadius: 3 * R, ballImpulse: 1.2 * K, playerImpulse: 0.9 * K, cooldown: sec(8) },
    /** Desplazamiento corto con colisiones durante todo el recorrido. */
    sidestep: { distance: 2.5 * R, speed: 6.25, cooldown: sec(8) },
  },
  widow: {
    /** Atraviesa aliados y pelota; ralentiza al primer rival alcanzado. */
    shock: { range: 6 * R, speed: 12, radius: 4, slowPct: 0.2, slowTicks: sec(0.7), cooldown: sec(8) },
    /** Dash: velocidad = speedMult × la velocidad normal máxima; choca durante todo el recorrido. `resist`: menos empuje de poderes durante el dash. */
    dash: { ticks: sec(0.22), speedMult: 2.2, resist: 0, cooldown: sec(6) },
  },
  cap: {
    /** Escudo encadenado: rebota entre pelota y rivales (cada uno una vez), hasta maxHits o maxTicks. */
    shield: { range: 8 * R, speed: 11, radius: 0.65 * R, maxHits: 3, search: 5 * R, ballImpulse: 0.9 * K, playerImpulse: 0.7 * K, maxTicks: sec(1.5), returnSpeed: 12, cooldown: sec(9) },
    /** Protección de la pelota: ningún poder la modifica; patadas y choques sí. */
    protect: { range: 10 * R, ticks: sec(2), cooldown: sec(12) },
  },
  panther: {
    leap: { distance: 4 * R, speed: 6.7, cooldown: sec(8) },
    /** Anticipación visible y luego empuje radial centrado en Black Panther. */
    pulse: { delay: sec(0.3), range: 3 * R, playerImpulse: 4.5, ballImpulse: 2.5, cooldown: sec(10) },
  },
  ironman: {
    /** Carga `windup` ticks delante de Iron Man y sale; un impacto contra pelota o rival. */
    repulsor: { windup: sec(0.12), range: 12 * R, speed: 11, radius: 0.4 * R, ballImpulse: 1.3 * K, playerImpulse: 0.8 * K, cooldown: sec(7) },
    /** Misil: punto fijo donde estaba la pelota; tras `delay`, si sigue dentro la lanza en una dirección al azar. No toca jugadores. */
    missile: { range: 14 * R, delay: sec(0.65), radius: 2.5 * R, ballImpulse: 1.25 * K, cooldown: sec(11) },
  },
  flash: {
    /** Q: multiplicadores de aceleración y velocidad máxima por movimiento. */
    sprint: { ticks: sec(2), accelMult: 2, speedMult: 1.9, cooldown: sec(10) },
    /**
     * E: impulso propio durante `ticks` mientras deja segmentos de estela; cada
     * segmento dura `segTicks`. Rivales dentro: aceleración y velocidad máxima
     * −slowPct, hasta `lingerTicks` después de salir. Q y E no se multiplican: vale el mayor.
     */
    trail: { ticks: sec(1.5), accelMult: 1.5, speedMult: 1.45, segTicks: sec(1.2), dropEvery: 4, radius: 1.3 * R, slowPct: 0.3, lingerTicks: sec(0.25), cooldown: sec(11) },
  },
  thor: {
    /** Un impacto físico; si golpea la pelota la electrifica: quien la toque queda aturdido (una vez por jugador). */
    hammer: { range: 10 * R, speed: 10, radius: 0.7 * R, ballImpulse: 1.4 * K, playerImpulse: 1 * K, elecTicks: sec(1.5), stunTicks: sec(0.35), cooldown: sec(10) },
    /** Rayo paralizante: rival más cercano en un cono de 2×cone grados; zona fija que cae tras `delay`. */
    bolt: { range: 10 * R, cone: 30, delay: sec(0.4), radius: 1.3 * R, strikeTicks: sec(0.25), stunTicks: sec(0.55), cooldown: sec(12) },
  },
  strange: {
    /** Rebobinar: la pelota vuelve a su posición y velocidad de hace `ticks` (misma jugada). */
    rewind: { range: 12 * R, ticks: sec(1.5), cooldown: sec(12) },
    /** Portal al arco de la mitad donde está: canaliza `channel` ticks y aparece a `goalOffset` de la línea de gol. */
    portal: { channel: sec(0.35), goalOffset: 3 * R, resistTicks: 0, resist: 0, cooldown: sec(14) },
  },
  // ---- segunda tanda ----
  homer: {
    /**
     * Rosquilla: rival → sin movimiento voluntario `trapTicks` (patada y poderes
     * sin desplazamiento siguen); pelota → −ballSlow de su velocidad una vez y,
     * durante `ballTicks`, los impulsos extra (patadas y poderes) se reducen `impulseCut`.
     */
    donut: { range: 10 * R, speed: 10, radius: 0.6 * R, trapTicks: sec(0.7), ballTicks: sec(2), ballSlow: 0.25, impulseCut: 0.4, cooldown: sec(10) },
    /**
     * Charco: cae a `ahead` delante tras `throwTicks`; dentro hay menos rozamiento
     * (`damping` en lugar del normal) y menos control (`grip` × aceleración); al
     * salir se recupera en `recoverTicks`. La propia aceleración nunca supera el tope normal.
     */
    beer: { ahead: 4 * R, throwTicks: sec(0.25), radius: 3 * R, ticks: sec(3), damping: 0.985, grip: 0.35, recoverTicks: sec(0.25), cooldown: sec(12) },
  },
  cj: {
    /** Cargador de `shots` balas: una por pulsación, `gap` mínimo entre balas, recarga `reload` tras la última. */
    gun: { range: 12 * R, speed: 16, radius: 3, shots: 3, gap: sec(0.3), ballImpulse: 0.75 * K, playerImpulse: 0.8 * K, reload: sec(10) },
    jetpack: { ticks: sec(2), accelMult: 1.45, speedMult: 1.35, cooldown: sec(12) },
  },
  baldi: {
    /** Regla: sólo la pelota; al tocarla pone su velocidad en cero una vez (no la congela). */
    ruler: { range: 12 * R, speed: 12, radius: 0.4 * R, cooldown: sec(9) },
    /** Quiz: rival en un cono de 2×cone grados, aviso `windup`, duración máxima `ticks`. */
    quiz: { range: 10 * R, cone: 50, windup: sec(0.4), ticks: sec(2.5), multiply: false, cooldown: sec(35) },
  },
  ibai: {
    /** Guante: alcance desde el borde, cono 2×cone grados, un solo rival, aviso corto. */
    glove: { range: 1.5 * R, cone: 40, windup: sec(0.1), playerImpulse: 2 * K, cooldown: sec(8) },
    /** Cuerpo gigante: cambia el radio físico (crece y se achica en `growTicks`, sólo en espacio libre). */
    giant: { ticks: sec(3), radiusMult: 1.35, massMult: 1.8, accelMult: 0.75, growTicks: sec(0.3), cooldown: sec(13) },
  },
  verity: {
    anger: { ticks: sec(5), accelMult: 1.2, speedMult: 1.2, kickMult: 1.3, cooldown: sec(13) },
    /** TNT: punto de caída fijo al lanzar; vuela `flightTicks` y explota `fuse` después de aterrizar. */
    tnt: { range: 8 * R, flightTicks: sec(0.5), fuse: sec(2), radius: 5 * R, ballImpulse: 1.6 * K, playerImpulse: 1.2 * K, cooldown: sec(13) },
  },
  thanos: {
    /** Intervalo compartido entre activaciones de gemas. */
    gap: sec(0.5),
    time: { range: 10 * R, ticks: sec(1.5), cooldown: sec(14) },
    mind: { range: 8 * R, ticks: sec(0.8), cooldown: sec(16) },
    /** `between`: visibilidad real mínima entre dos ilusiones de la partida. */
    reality: { ticks: sec(0.8), between: sec(2), cooldown: sec(15) },
    space: { range: 12 * R, windup: sec(0.25), cooldown: sec(12) },
    power: { kickMult: 1.8, ticks: sec(2), cooldown: sec(10) },
  },
};

export type PowerConfig = typeof POWERS;

/** Quiz de Baldi: inmunidad posterior (también sin cooldowns). */
export const BALDI_QUIZ = { immuneTicks: sec(12) };

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
    // haz más ancho y potente que atraviesa jugadores hasta la pelota (un impacto por objetivo)
    laser: { ...POWERS.superman.laser, range: 18 * R, halfWidth: 0.5 * R, ballImpulse: 1.8 * K, playerImpulse: 1.1 * K, pierce: true, cooldown: sec(6) },
    superSpeed: { ticks: sec(2.5), mult: 1.8, cooldown: sec(6) },
  },
  // Ajustes explícitos (no un multiplicador general): más alcance y recargas
  // más cortas, conservando anticipaciones, topes de ralentización y la
  // prohibición de atravesar paredes o jugadores.
  hawkeye: {
    arrow: { ...POWERS.hawkeye.arrow, range: 16 * R, speed: 15, blastRadius: 4.5 * R, ballImpulse: 1.7 * K, playerImpulse: 1.3 * K, cooldown: sec(6) },
    sidestep: { ...POWERS.hawkeye.sidestep, distance: 3.5 * R, cooldown: sec(6) },
  },
  widow: {
    shock: { ...POWERS.widow.shock, range: 8 * R, slowPct: 0.3, slowTicks: sec(1), cooldown: sec(6) },
    dash: { ticks: sec(0.32), speedMult: 2.8, resist: 0.4, cooldown: sec(4) },
  },
  cap: {
    shield: { ...POWERS.cap.shield, range: 11 * R, radius: 0.9 * R, maxHits: 5, search: 7 * R, ballImpulse: 1.2 * K, playerImpulse: 0.9 * K, maxTicks: sec(2), cooldown: sec(7) },
    protect: { range: 14 * R, ticks: sec(3), cooldown: sec(10) },
  },
  panther: {
    leap: { ...POWERS.panther.leap, distance: 5.5 * R, cooldown: sec(6) },
    pulse: { ...POWERS.panther.pulse, range: 3.5 * R, playerImpulse: 5.5, ballImpulse: 3, cooldown: sec(8) },
  },
  ironman: {
    repulsor: { ...POWERS.ironman.repulsor, range: 16 * R, radius: 0.6 * R, ballImpulse: 1.8 * K, playerImpulse: 1 * K, cooldown: sec(5) },
    missile: { range: 20 * R, delay: sec(0.45), radius: 4 * R, ballImpulse: 1.8 * K, cooldown: sec(8) },
  },
  flash: {
    sprint: { ticks: sec(3), accelMult: 2.8, speedMult: 2.5, cooldown: sec(8) },
    trail: { ...POWERS.flash.trail, ticks: sec(2), accelMult: 1.9, speedMult: 1.75, segTicks: sec(1.6), slowPct: 0.4, cooldown: sec(9) },
  },
  thor: {
    hammer: { ...POWERS.thor.hammer, range: 14 * R, radius: 0.95 * R, ballImpulse: 1.9 * K, playerImpulse: 1.3 * K, stunTicks: sec(0.55), cooldown: sec(8) },
    bolt: { ...POWERS.thor.bolt, range: 14 * R, delay: sec(0.35), radius: 2 * R, stunTicks: sec(0.75), cooldown: sec(10) },
  },
  strange: {
    rewind: { range: 18 * R, ticks: sec(2.5), cooldown: sec(10) },
    portal: { ...POWERS.strange.portal, channel: sec(0.2), resistTicks: sec(0.75), resist: 0.4, cooldown: sec(10) },
  },
  homer: {
    donut: { ...POWERS.homer.donut, range: 13 * R, trapTicks: sec(0.9), ballTicks: sec(3), impulseCut: 0.55, cooldown: sec(8) },
    beer: { ...POWERS.homer.beer, radius: 4.5 * R, ticks: sec(4), damping: 0.99, grip: 0.25, cooldown: sec(10) },
  },
  cj: {
    gun: { ...POWERS.cj.gun, range: 16 * R, speed: 18, gap: sec(0.22), ballImpulse: 1 * K, playerImpulse: 1.1 * K, reload: sec(8) },
    jetpack: { ticks: sec(3), accelMult: 1.65, speedMult: 1.5, cooldown: sec(10) },
  },
  baldi: {
    ruler: { range: 16 * R, speed: 16, radius: 0.55 * R, cooldown: sec(7) },
    quiz: { ...POWERS.baldi.quiz, range: 14 * R, ticks: sec(3), multiply: true },
  },
  ibai: {
    glove: { ...POWERS.ibai.glove, range: 2 * R, playerImpulse: 2.7 * K, cooldown: sec(6) },
    giant: { ...POWERS.ibai.giant, ticks: sec(4), radiusMult: 1.5, massMult: 2.2, accelMult: 0.7, cooldown: sec(11) },
  },
  verity: {
    anger: { ticks: sec(5), accelMult: 1.35, speedMult: 1.35, kickMult: 1.5, cooldown: sec(10) },
    tnt: { ...POWERS.verity.tnt, range: 10 * R, fuse: sec(1.6), radius: 6.5 * R, ballImpulse: 2 * K, playerImpulse: 1.5 * K, cooldown: sec(10) },
  },
  thanos: {
    gap: sec(0.5),
    time: { range: 14 * R, ticks: sec(2.5), cooldown: sec(12) },
    mind: { range: 10 * R, ticks: sec(1), cooldown: sec(14) },
    reality: { ticks: sec(1.1), between: sec(2), cooldown: sec(13) },
    space: { range: 18 * R, windup: sec(0.2), cooldown: sec(10) },
    power: { kickMult: 2.2, ticks: sec(2.5), cooldown: sec(8) },
  },
};

/** Configuración de poderes según el modo (Clásico no usa poderes). */
export function powersFor(mode: string): PowerConfig {
  return mode === 'super' ? SUPER_POWERS : POWERS;
}

export type HeroId =
  | 'spider' | 'batman' | 'hulk' | 'superman'
  | 'hawkeye' | 'widow' | 'cap' | 'panther' | 'ironman' | 'flash' | 'thor' | 'strange'
  | 'homer' | 'cj' | 'baldi' | 'ibai' | 'verity' | 'thanos';
export const STARTER_IDS: HeroId[] = ['spider', 'batman', 'hulk', 'superman'];
/** Todos los héroes que existen (validación de mensajes y del servidor), incluido el secreto. */
export const HERO_IDS: HeroId[] = [...STARTER_IDS, 'hawkeye', 'widow', 'cap', 'panther', 'ironman', 'flash', 'thor', 'strange', 'homer', 'cj', 'baldi', 'ibai', 'verity', 'thanos'];
/** Héroes secretos: sólo por administración; fuera de cofres, catálogos públicos y bots. */
export const SECRET_IDS: HeroId[] = ['thanos'];
export const isSecret = (h: HeroId): boolean => SECRET_IDS.includes(h);
/** Héroes públicos (catálogo, cofres, bots, contador de colección). */
export const PUBLIC_HERO_IDS: HeroId[] = HERO_IDS.filter((h) => !isSecret(h));

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
  homer: { rarity: 'epic', role: 'control', starter: false },
  cj: { rarity: 'epic', role: 'ataque', starter: false },
  baldi: { rarity: 'legendary', role: 'control', starter: false },
  ibai: { rarity: 'rare', role: 'defensa', starter: false },
  verity: { rarity: 'epic', role: 'ataque', starter: false },
  // secreto: esta rareza no se muestra (se ve "Secreto") ni participa de cofres (SECRET_IDS)
  thanos: { rarity: 'legendary', role: 'control', starter: false },
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
  /** Thanos: las cinco gemas (Q activa la seleccionada, E pasa a la siguiente, 1–5 eligen). */
  gems?: PowerInfo[];
}

export const GEM_IDS = ['time', 'mind', 'reality', 'space', 'power'] as const;
export type GemId = (typeof GEM_IDS)[number];
export const GEM_LABEL: Record<GemId, string> = { time: 'Tiempo', mind: 'Mente', reality: 'Realidad', space: 'Espacio', power: 'Poder' };
export const GEM_COLOR: Record<GemId, string> = { time: '#3fd16b', mind: '#f2d03b', reality: '#e8423f', space: '#3f7cf2', power: '#a64ff2' };

const S = SUPER_POWERS;

/** Número en R con coma decimal (2.5 → "2,5R"). */
const inR = (v: number) => `${String(+(v / R).toFixed(1)).replace('.', ',')}R`;
const secs = (t: number) => `${String(+(t / TICK_RATE).toFixed(2)).replace('.', ',')} s`;
const pct = (v: number) => `${Math.round(v * 100)} %`;
const mult = (v: number) => `×${String(+v.toFixed(2)).replace('.', ',')}`;

/** Superman y los desbloqueables: textos generados desde los valores del modo (no quedan desactualizados). */
function generated(P: PowerConfig, superMode: boolean): Record<Exclude<HeroId, 'spider' | 'batman' | 'hulk'>, HeroInfo> {
  return {
    superman: {
      name: 'Superman',
      q: { name: 'Visión láser', desc: `Tras ${secs(P.superman.laser.windup)} de aviso, rayo recto (${inR(P.superman.laser.range)}) que apunta solo a la pelota o a un rival: ${superMode ? 'atraviesa jugadores y empuja a cada uno una vez, y a la pelota' : 'empuja al primer objetivo (pelota o rival)'}. Paredes y postes lo bloquean.`, cooldown: P.superman.laser.cooldown },
      e: { name: superMode ? 'Vuelo supersónico' : 'Súper velocidad', desc: `+${pct(P.superman.superSpeed.mult - 1)} aceleración y velocidad durante ${secs(P.superman.superSpeed.ticks)}.`, cooldown: P.superman.superSpeed.cooldown },
    },
    hawkeye: {
      name: 'Hawkeye',
      q: { name: 'Flecha explosiva', desc: `Flecha (${inR(P.hawkeye.arrow.range)}) que apunta sola a la pelota y explota al tocar algo: onda de ${inR(P.hawkeye.arrow.blastRadius)} que empuja pelota y jugadores de ambos equipos (también a vos), más fuerte cerca del centro.`, cooldown: P.hawkeye.arrow.cooldown },
      e: { name: 'Paso lateral', desc: `Desplazamiento de hasta ${inR(P.hawkeye.sidestep.distance)} hacia donde apuntás, chocando normalmente.`, cooldown: P.hawkeye.sidestep.cooldown },
    },
    widow: {
      name: 'Black Widow',
      q: { name: 'Descarga', desc: `Proyectil (${inR(P.widow.shock.range)}) que apunta solo al rival más alineado: el primer rival alcanzado acelera ${pct(P.widow.shock.slowPct)} menos durante ${secs(P.widow.shock.slowTicks)}.`, cooldown: P.widow.shock.cooldown },
      e: { name: 'Dash evasivo', desc: `Desplazamiento rápido (${mult(P.widow.dash.speedMult)} velocidad, ${secs(P.widow.dash.ticks)}) hacia donde apuntás, chocando con todo.${P.widow.dash.resist > 0 ? ` Durante el dash recibís ${pct(P.widow.dash.resist)} menos de empuje de poderes.` : ''}`, cooldown: P.widow.dash.cooldown },
    },
    cap: {
      name: 'Capitán América',
      q: { name: 'Escudo encadenado', desc: `Escudo grande que apunta solo y rebota entre la pelota y rivales cercanos (${inR(P.cap.shield.search)}): hasta ${P.cap.shield.maxHits} impactos, uno por objetivo. Nunca rebota hacia aliados.`, cooldown: P.cap.shield.cooldown },
      e: { name: 'Protección de la pelota', desc: `Pelota a menos de ${inR(P.cap.protect.range)}: durante ${secs(P.cap.protect.ticks)} ningún poder puede modificarla (sí patadas y choques).`, cooldown: P.cap.protect.cooldown },
    },
    panther: {
      name: 'Black Panther',
      q: { name: 'Salto felino', desc: `Avance de hasta ${inR(P.panther.leap.distance)} hacia donde apuntás; se detiene ante jugadores, pelota u obstáculos.`, cooldown: P.panther.leap.cooldown },
      e: { name: 'Pulso cinético', desc: `Tras ${secs(P.panther.pulse.delay)} de aviso empuja a los rivales a ${inR(P.panther.pulse.range)} y un poco la pelota.`, cooldown: P.panther.pulse.cooldown },
    },
    ironman: {
      name: 'Iron Man',
      q: { name: 'Repulsor', desc: `Carga ${secs(P.ironman.repulsor.windup)} y dispara un pulso (${inR(P.ironman.repulsor.range)}) que apunta solo: un impacto fuerte a la pelota o empuje a un rival.`, cooldown: P.ironman.repulsor.cooldown },
      e: { name: 'Misil', desc: `Pelota a menos de ${inR(P.ironman.missile.range)}: marca dónde está y a los ${secs(P.ironman.missile.delay)} cae un misil (${inR(P.ironman.missile.radius)}). Si la pelota sigue ahí, sale en una dirección al azar. No afecta jugadores.`, cooldown: P.ironman.missile.cooldown },
    },
    flash: {
      name: 'Flash',
      q: { name: 'Velocidad extrema', desc: `Durante ${secs(P.flash.sprint.ticks)}: aceleración ${mult(P.flash.sprint.accelMult)} y velocidad máxima ${mult(P.flash.sprint.speedMult)}.`, cooldown: P.flash.sprint.cooldown },
      e: { name: 'Estela acelerada', desc: `Durante ${secs(P.flash.trail.ticks)} acelerás ${mult(P.flash.trail.accelMult)} y dejás una estela (${secs(P.flash.trail.segTicks)}) que frena ${pct(P.flash.trail.slowPct)} a los rivales que la pisan. No se suma con Q: vale la mejor.`, cooldown: P.flash.trail.cooldown },
    },
    thor: {
      name: 'Thor',
      q: { name: 'Mjolnir electrificado', desc: `Martillo grande (${inR(P.thor.hammer.range)}) que apunta solo: un impacto fuerte. Si golpea la pelota la electrifica ${secs(P.thor.hammer.elecTicks)}: quien la toque queda aturdido ${secs(P.thor.hammer.stunTicks)} (también vos).`, cooldown: P.thor.hammer.cooldown },
      e: { name: 'Rayo paralizante', desc: `Marca al rival más cercano delante tuyo (${inR(P.thor.bolt.range)}); a los ${secs(P.thor.bolt.delay)} cae un rayo (${inR(P.thor.bolt.radius)}) que aturde ${secs(P.thor.bolt.stunTicks)} a los rivales que sigan ahí. Sin objetivo no gasta la recarga.`, cooldown: P.thor.bolt.cooldown },
    },
    homer: {
      name: 'Homero',
      q: { name: 'Rosquilla atrapante', desc: `Rosquilla (${inR(P.homer.donut.range)}) que apunta sola a la pelota o a un rival. Rival: no puede moverse ${secs(P.homer.donut.trapTicks)} (sí patear y usar poderes sin desplazamiento). Pelota: pierde ${pct(P.homer.donut.ballSlow)} de velocidad y durante ${secs(P.homer.donut.ballTicks)} patadas y poderes la impulsan ${pct(P.homer.donut.impulseCut)} menos.`, cooldown: P.homer.donut.cooldown },
      e: { name: 'Charco de cerveza', desc: `Tira una cerveza ${inR(P.homer.beer.ahead)} adelante: charco de ${inR(P.homer.beer.radius)} durante ${secs(P.homer.beer.ticks)} donde todos (también vos) resbalan y cuesta frenar o girar. La pelota no cambia.`, cooldown: P.homer.beer.cooldown },
    },
    cj: {
      name: 'CJ',
      q: { name: 'Cargador de tres balas', desc: `${P.cj.gun.shots} balas (${inR(P.cj.gun.range)}) que apuntan solas, una por pulsación (mínimo ${secs(P.cj.gun.gap)} entre balas). Pelota: impulso ${mult(P.cj.gun.ballImpulse / K)} patada; rival: empujón sin aturdir. Tras la tercera, recarga ${secs(P.cj.gun.reload)}.`, cooldown: P.cj.gun.reload },
      e: { name: 'Jetpack', desc: `Durante ${secs(P.cj.jetpack.ticks)}: aceleración +${pct(P.cj.jetpack.accelMult - 1)} y velocidad máxima +${pct(P.cj.jetpack.speedMult - 1)}. Seguís chocando con todo (el vuelo es visual).`, cooldown: P.cj.jetpack.cooldown },
    },
    baldi: {
      name: 'Baldi',
      q: { name: 'Regla de detención', desc: `Regla (${inR(P.baldi.ruler.range)}) que apunta sola a la pelota: la deja quieta una vez, sin congelarla. No afecta jugadores.`, cooldown: P.baldi.ruler.cooldown },
      e: { name: 'Quiz matemático', desc: `Al rival más alineado delante tuyo (${inR(P.baldi.quiz.range)}): tras ${secs(P.baldi.quiz.windup)} recibe una cuenta${P.baldi.quiz.multiply ? ' (suma, resta o multiplicación)' : ' (suma o resta)'} y no puede jugar hasta responder bien (máximo ${secs(P.baldi.quiz.ticks)}). Sin objetivo no gasta la recarga.`, cooldown: P.baldi.quiz.cooldown },
    },
    ibai: {
      name: 'Ibai',
      q: { name: 'Guante de boxeo', desc: `Golpe corto (${inR(P.ibai.glove.range)} desde tu borde) al rival más cercano delante tuyo: empujón fuerte, sin aturdir. No toca pelota ni aliados.`, cooldown: P.ibai.glove.cooldown },
      e: { name: 'Cuerpo gigante', desc: `Durante ${secs(P.ibai.giant.ticks)}: tamaño ${mult(P.ibai.giant.radiusMult)} (también el choque), masa ${mult(P.ibai.giant.massMult)} y ${pct(1 - P.ibai.giant.accelMult)} menos aceleración. Sólo crece en el espacio libre.`, cooldown: P.ibai.giant.cooldown },
    },
    verity: {
      name: 'Verity',
      q: { name: 'Enfado', desc: `Durante ${secs(P.verity.anger.ticks)}: aceleración y velocidad +${pct(P.verity.anger.accelMult - 1)} y patada +${pct(P.verity.anger.kickMult - 1)}.`, cooldown: P.verity.anger.cooldown },
      e: { name: 'TNT', desc: `Tira una TNT (${inR(P.verity.tnt.range)}) que apunta sola a la pelota o a un rival; el lugar de caída queda fijo y explota ${secs(P.verity.tnt.fuse)} después de caer: ${inR(P.verity.tnt.radius)} que empuja pelota y a todos (también a vos).`, cooldown: P.verity.tnt.cooldown },
    },
    thanos: {
      name: 'Thanos',
      q: { name: 'Activar gema', desc: 'Activa la gema seleccionada (teclas 1–5 para elegir).', cooldown: 0 },
      e: { name: 'Cambiar gema', desc: 'Pasa a la siguiente gema.', cooldown: 0 },
      gems: [
        { name: 'Gema del Tiempo', desc: `Rival a menos de ${inR(P.thanos.time.range)}: vuelve a su posición y velocidad de hace ${secs(P.thanos.time.ticks)} (sólo de esta jugada).`, cooldown: P.thanos.time.cooldown },
        { name: 'Gema de la Mente', desc: `Rival a menos de ${inR(P.thanos.mind.range)} y a la vista: durante ${secs(P.thanos.mind.ticks)} se mueve con tus direcciones (vos quedás quieto). No lo hace patear ni usar poderes.`, cooldown: P.thanos.mind.cooldown },
        { name: 'Gema de la Realidad', desc: `Durante ${secs(P.thanos.reality.ticks)} los rivales ven una pelota falsa junto a vos y no ven la real (la real sigue jugándose).`, cooldown: P.thanos.reality.cooldown },
        { name: 'Gema del Espacio', desc: `Pelota a menos de ${inR(P.thanos.space.range)}: tras ${secs(P.thanos.space.windup)} aparecés junto a ella sin moverla.`, cooldown: P.thanos.space.cooldown },
        { name: 'Gema del Poder', desc: `Tu próxima patada (dentro de ${secs(P.thanos.power.ticks)}) sale +${pct(P.thanos.power.kickMult - 1)} más fuerte.`, cooldown: P.thanos.power.cooldown },
      ],
    },
    strange: {
      name: 'Doctor Strange',
      q: { name: 'Rebobinar', desc: `Pelota a menos de ${inR(P.strange.rewind.range)}: vuelve a la posición y velocidad de hace ${secs(P.strange.rewind.ticks)} (sólo de esta jugada). No cambia jugadores, marcador ni reloj.`, cooldown: P.strange.rewind.cooldown },
      e: { name: 'Portal al arco', desc: `Tras ${secs(P.strange.portal.channel)} de canalización aparecés delante del arco de la mitad donde estás.${P.strange.portal.resistTicks > 0 ? ` Al llegar, ${secs(P.strange.portal.resistTicks)} con ${pct(P.strange.portal.resist)} menos de empuje de poderes.` : ''} Un aturdimiento lo interrumpe.`, cooldown: P.strange.portal.cooldown },
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
  ...generated(POWERS, false),
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
  ...generated(S, true),
};

export function heroInfo(hero: HeroId, mode: string): HeroInfo {
  return (mode === 'super' ? SUPER_HEROES : HEROES)[hero];
}
