// IA sencilla para bots. Sólo produce bits de entrada, igual que un humano:
// no toca la física directamente.
import { POWERS, R, STADIUM } from './config';
import { teamDir } from './game';
import { GameState, IN, PlayerState } from './types';

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

export function botInput(s: GameState, brain: BotBrain, rnd: () => number = Math.random): number {
  const me = s.players.find((p) => p.id === brain.id);
  if (!me) return 0;
  const b = s.ball;
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
  if (s.mode === 'heroes' && s.phase === 'playing') {
    const d = Math.hypot(b.x - me.d.x, b.y - me.d.y);
    const facing = d > 0 ? ((b.x - me.d.x) * me.ax + (b.y - me.d.y) * me.ay) / d : 0;
    const roll = rnd();
    const chance = 0.02 + brain.skill * 0.04;
    const useQ = (cond: boolean) => cond && me.cdQ === 0 && roll < chance && !(brain.lastBits & IN.Q);
    const useE = (cond: boolean) => cond && me.cdE === 0 && roll < chance && !(brain.lastBits & IN.E);
    const towardGoal = (b.x - me.d.x) * dir > 0;
    switch (me.hero) {
      case 'spider':
        if (useQ(d < POWERS.spider.web.range * 0.9 && d > 4 * R)) bits |= IN.Q;
        else if (useE(isAttacker && d > 6 * R && facing > 0.9)) bits |= IN.E;
        break;
      case 'batman':
        if (useQ(d < POWERS.batman.batarang.range * 0.8 && facing > 0.3 && towardGoal)) bits |= IN.Q;
        else if (useE(!isAttacker && d < 5 * R)) bits |= IN.E;
        break;
      case 'hulk':
        if (useQ(d < 3.5 * R && towardGoal)) bits |= IN.Q;
        else if (useE(d < 4 * R)) bits |= IN.E;
        break;
      case 'superman':
        if (useQ(d < 3 * R && towardGoal)) bits |= IN.Q;
        else if (useE(isAttacker && d > 8 * R)) bits |= IN.E;
        break;
    }
  }
  brain.lastBits = bits;
  return bits;
}
