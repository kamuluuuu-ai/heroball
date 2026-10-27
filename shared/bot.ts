// IA sencilla para bots. Sólo produce bits de entrada, igual que un humano:
// no toca la física directamente.
import { R, STADIUM, powersFor } from './config';
import { hasPowers, teamDir } from './game';
import { ballGuarded, boltTarget, gloveTarget, quizTarget } from './powers';
import { GameState, IN, IN_NUM_SHIFT, inNum, PlayerState } from './types';

export interface BotBrain {
  id: string;
  /** 0..1: cuanto más alto, mejor reacciona. */
  skill: number;
  lastBits: number;
  wander: number;
}

export function makeBrain(id: string, skill = 0.7): BotBrain {
  return { id, skill, lastBits: 0, wander: 0 };
}

function dirBits(dx: number, dy: number, dead = 4): number {
  let b = 0;
  const ang = Math.atan2(dy, dx);
  const len = Math.hypot(dx, dy);
  if (len < dead) return 0;
  // 8 direcciones
  const oct = Math.round(ang / (Math.PI / 4));
  const vx = Math.round(Math.cos(oct * (Math.PI / 4)));
  const vy = Math.round(Math.sin(oct * (Math.PI / 4)));
  if (vx > 0) b |= IN.RIGHT;
  if (vx < 0) b |= IN.LEFT;
  if (vy > 0) b |= IN.DOWN;
  if (vy < 0) b |= IN.UP;
  return b;
}

/** Rival más cercano: distancia entre bordes y alineación con la dirección apuntada. */
function nearestRival(s: GameState, me: PlayerState): { d: number; align: number } | null {
  let best: { d: number; align: number } | null = null;
  for (const o of s.players) {
    if (o.team === me.team) continue;
    const dx = o.d.x - me.d.x;
    const dy = o.d.y - me.d.y;
    const dist = Math.hypot(dx, dy) || 1;
    const d = dist - me.d.r - o.d.r;
    if (!best || d < best.d) best = { d, align: (dx * me.ax + dy * me.ay) / dist };
  }
  return best;
}

/**
 * Quiz de Baldi: el bot responde tras una demora razonable según su
 * habilidad y acierta con más probabilidad cuanto mejor es. Cada respuesta es
 * una pulsación nueva (suelta entre intentos).
 */
function quizBits(me: PlayerState, brain: BotBrain, rnd: () => number): number {
  const q = me.quiz!;
  const elapsed = q.max - q.ticks;
  const react = Math.round(60 * (1.5 - brain.skill) + q.wrong * 20);
  if (elapsed < react || inNum(brain.lastBits) !== 0) return 0;
  const right = rnd() < 0.55 + brain.skill * 0.4;
  const idx = right ? q.answer : (q.answer + 1 + Math.floor(rnd() * 2)) % 3;
  return (idx + 1) << IN_NUM_SHIFT;
}

export function botInput(s: GameState, brain: BotBrain, rnd: () => number = Math.random): number {
  const me = s.players.find((p) => p.id === brain.id);
  if (!me) return 0;
  if (me.quiz) {
    brain.lastBits = quizBits(me, brain, rnd);
    return brain.lastBits;
  }
  // Gema de la Realidad: los rivales de Thanos persiguen la pelota falsa (misma percepción que un humano)
  const il = s.illusion;
  const b = il && il.team === me.team ? { ...s.ball, x: il.x, y: il.y, vx: 0, vy: 0 } : s.ball;
  const dir = teamDir(me.team);
  const goalX = dir * STADIUM.fieldW;
  const ownX = -goalX;

  // rol: el más cercano a la pelota ataca; el resto cubre
  const mates = s.players.filter((p) => p.team === me.team);
  const dist = (p: PlayerState) => Math.hypot(p.d.x - b.x, p.d.y - b.y);
  const attacker = mates.reduce((a, p) => (dist(p) < dist(a) ? p : a), mates[0]);
  const isAttacker = attacker === me;

  let tx: number;
  let ty: number;
  let bits = 0;
  if (s.phase === 'kickoff' && s.kickoffTeam !== me.team) {
    tx = ownX * 0.55;
    ty = 0;
  } else if (isAttacker || s.phase === 'kickoff') {
    // ponerse detrás de la pelota mirando al arco rival
    const gx = goalX - b.x;
    const gy = -b.y * 0.8;
    const gl = Math.hypot(gx, gy) || 1;
    const behind = me.d.r + b.r + 2;
    tx = b.x - (gx / gl) * behind;
    ty = b.y - (gy / gl) * behind;
    const toBallX = b.x - me.d.x;
    const toBallY = b.y - me.d.y;
    const tl = Math.hypot(toBallX, toBallY) || 1;
    const align = (toBallX * gx + toBallY * gy) / (tl * gl);
    // si está mal ubicado (pelota entre él y su arco), rodear
    if (align < 0.3 && tl < 60) {
      const side = me.d.y < b.y ? -1 : 1;
      tx = b.x - (gx / gl) * 40;
      ty = b.y + side * 35;
    } else {
      tx = b.x;
      ty = b.y;
      if (tl > 50) {
        tx = b.x - (gx / gl) * (behind - 6);
        ty = b.y - (gy / gl) * (behind - 6);
      }
    }
    const gap = tl - me.d.r - b.r;
    const wantKick = gap < 3.5 && align > 0.35 && rnd() < 0.35 + brain.skill * 0.6;
    if (wantKick && !(brain.lastBits & IN.KICK)) bits |= IN.KICK;
  } else {
    // defensor: entre la pelota y su arco
    tx = ownX * 0.7 + (b.x - ownX) * 0.25;
    ty = b.y * 0.5;
  }

  brain.wander = brain.wander * 0.9 + (rnd() - 0.5) * (1 - brain.skill) * 20;
  bits |= dirBits(tx - me.d.x, ty - me.d.y + brain.wander);

  // poderes
  if (hasPowers(s) && s.phase === 'playing') {
    const P = powersFor(s.mode);
    const d = Math.hypot(b.x - me.d.x, b.y - me.d.y);
    const facing = d > 0 ? ((b.x - me.d.x) * me.ax + (b.y - me.d.y) * me.ay) / d : 0;
    const roll = rnd();
    const chance = 0.02 + brain.skill * 0.04;
    const useQ = (cond: boolean) => cond && me.cdQ === 0 && roll < chance && !(brain.lastBits & IN.Q);
    const useE = (cond: boolean) => cond && me.cdE === 0 && roll < chance && !(brain.lastBits & IN.E);
    const towardGoal = (b.x - me.d.x) * dir > 0;
    // pelota en campo propio y cerca del arco propio: momento de despejar o defender
    const ballOwnSide = (b.x - ownX) * dir < STADIUM.fieldW * 0.6;
    const guarded = ballGuarded(s);
    switch (me.hero) {
      case 'spider':
        if (useQ(d < Math.min(P.spider.web.range * 0.9, 24 * R) && d > 4 * R)) bits |= IN.Q;
        else if (useE(isAttacker && d > 6 * R && facing > 0.9)) bits |= IN.E;
        break;
      case 'batman':
        if (useQ(d < P.batman.batarang.range * 0.8 && facing > 0.3 && towardGoal)) bits |= IN.Q;
        // gancho: alcanzar la pelota cuando está lejos y del lado propio o libre
        else if (useE(d > 6 * R && d < Math.min(P.batman.grapple.range * 0.9, 24 * R))) bits |= IN.E;
        break;
      case 'hulk':
        if (useQ(d < 3.5 * R && towardGoal)) bits |= IN.Q;
        else if (useE(d < 4 * R)) bits |= IN.E;
        break;
      case 'superman':
        // láser autoapuntado: basta con tener la pelota adelante y hacia el arco rival
        if (useQ(!guarded && d < P.superman.laser.range * 0.85 && facing > 0.6 && towardGoal)) bits |= IN.Q;
        else if (useE(isAttacker && d > 8 * R)) bits |= IN.E;
        break;
      // héroes desbloqueables: tiros rectos sólo bien alineados y hacia el arco rival
      case 'hawkeye':
        if (useQ(!guarded && d < P.hawkeye.arrow.range * 0.85 && facing > 0.97 && towardGoal)) bits |= IN.Q;
        else if (useE(isAttacker && d > 3 * R && d < 7 * R && facing > 0.9)) bits |= IN.E;
        break;
      case 'widow': {
        const near = nearestRival(s, me);
        if (useQ(near !== null && near.d < P.widow.shock.range * 0.8 && near.align > 0.9)) bits |= IN.Q;
        else if (useE(isAttacker && d > 4 * R && facing > 0.9)) bits |= IN.E; // dash hacia la pelota
        break;
      }
      case 'cap':
        if (useQ(!guarded && d < P.cap.shield.range * 0.8 && facing > 0.9 && towardGoal)) bits |= IN.Q;
        // protege la pelota cuando está cerca del arco propio
        else if (useE(!guarded && ballOwnSide && d < P.cap.protect.range * 0.8)) bits |= IN.E;
        break;
      case 'panther': {
        const near = nearestRival(s, me);
        if (useQ(isAttacker && d > 4 * R && d < 9 * R && facing > 0.95)) bits |= IN.Q;
        else if (useE(near !== null && near.d < 2.5 * R)) bits |= IN.E;
        break;
      }
      case 'ironman':
        if (useQ(!guarded && d < P.ironman.repulsor.range * 0.8 && facing > 0.97 && towardGoal)) bits |= IN.Q;
        // misil: desordena una pelota peligrosa cerca del arco propio
        else if (useE(!guarded && ballOwnSide && d > 4 * R && d < P.ironman.missile.range * 0.85)) bits |= IN.E;
        break;
      case 'flash':
        if (useQ(isAttacker && d > 6 * R && facing > 0.9)) bits |= IN.Q;
        else if (useE(!isAttacker && d < 6 * R)) bits |= IN.E;
        break;
      case 'thor': {
        const near = nearestRival(s, me);
        if (useQ(!guarded && d < P.thor.hammer.range * 0.8 && facing > 0.95 && towardGoal)) bits |= IN.Q;
        else if (useE(near !== null && near.d > 3 * R && boltTarget(s, me) !== null)) bits |= IN.E;
        break;
      }
      case 'strange':
        // retroceso: devuelve una pelota que se acerca al arco propio
        if (useQ(!guarded && ballOwnSide && d < P.strange.rewind.range * 0.85 && (b.vx * dir) < -2)) bits |= IN.Q;
        // portal al arco de su mitad: volver a defender si está lejos de la pelota en campo propio
        else if (useE(!isAttacker && me.half === -dir && ballOwnSide && d > 10 * R)) bits |= IN.E;
        break;
      case 'homer': {
        const near = nearestRival(s, me);
        // rosquilla: frena una pelota peligrosa o atrapa al rival que la lleva
        if (useQ(!guarded && d < P.homer.donut.range * 0.85 && facing > 0.7 && ballOwnSide)) bits |= IN.Q;
        else if (useE(near !== null && near.d < 4 * R && !isAttacker)) bits |= IN.E;
        break;
      }
      case 'cj':
        // una bala por pulsación (el flanco lo asegura lastBits)
        if (useQ(!guarded && me.ammo > 0 && me.shotGap === 0 && d < P.cj.gun.range * 0.8 && facing > 0.85 && towardGoal)) bits |= IN.Q;
        else if (useE(isAttacker && d > 6 * R)) bits |= IN.E;
        break;
      case 'baldi':
        // regla: detiene una pelota que viene hacia el arco propio
        if (useQ(!guarded && ballOwnSide && d < P.baldi.ruler.range * 0.85 && facing > 0.7 && b.vx * dir < -2)) bits |= IN.Q;
        else if (useE(quizTarget(s, me) !== null)) bits |= IN.E;
        break;
      case 'ibai':
        if (useQ(gloveTarget(s, me) !== null)) bits |= IN.Q;
        else if (useE(!isAttacker && ballOwnSide && d < 6 * R)) bits |= IN.E;
        break;
      case 'verity': {
        const near = nearestRival(s, me);
        if (useQ(isAttacker && d < 6 * R)) bits |= IN.Q;
        else if (useE(near !== null && near.d < P.verity.tnt.range * 0.8 && near.align > 0.6)) bits |= IN.E;
        break;
      }
    }
  }
  brain.lastBits = bits;
  return bits;
}
