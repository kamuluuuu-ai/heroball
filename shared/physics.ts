// Física de discos: integración, colisiones disco-disco, disco-segmento y
// límites planos. Implementación propia de HeroBall.
import { BALL, LIMITS, PLAYER, STADIUM } from './config';

export interface Disc {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  invMass: number;
  bCoef: number;
  damping: number;
}

export interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  bCoef: number;
}

export function makeDisc(x: number, y: number, kind: 'player' | 'ball'): Disc {
  const p = kind === 'player' ? PLAYER : BALL;
  return { x, y, vx: 0, vy: 0, r: p.radius, invMass: p.invMass, bCoef: p.bCoef, damping: p.damping };
}

function seg(ax: number, ay: number, bx: number, by: number, bCoef: number): Seg {
  return { ax, ay, bx, by, bCoef };
}

/** Aproxima un arco con segmentos rectos. Ángulos en radianes. */
export function arcSegs(cx: number, cy: number, r: number, a0: number, a1: number, n: number, bCoef: number): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    out.push(seg(cx + Math.cos(t0) * r, cy + Math.sin(t0) * r, cx + Math.cos(t1) * r, cy + Math.sin(t1) * r, bCoef));
  }
  return out;
}

export interface Stadium {
  /** Paredes que afectan sólo a la pelota (líneas de campo y redes). */
  ballWalls: Seg[];
  /** Postes: discos estáticos que afectan a todos. */
  posts: Disc[];
  /** Barreras de saque comunes (línea central). */
  kickoffLines: Seg[];
  /** Semicírculo del lado rojo (x<0) y del lado azul (x>0). */
  kickoffArc: { red: Seg[]; blue: Seg[] };
  /** Redes por equipo (para dibujar). */
  nets: { red: Seg[]; blue: Seg[] };
}

function buildStadium(): Stadium {
  const { fieldW: W, fieldH: H, goalHalf: G, goalDepth: D, postRadius: PR, wallBCoef, netBCoef, kickoffRadius: KR } = STADIUM;
  const walls: Seg[] = [
    seg(-W, -H, W, -H, wallBCoef),
    seg(-W, H, W, H, wallBCoef),
    seg(-W, -H, -W, -G, wallBCoef),
    seg(-W, G, -W, H, wallBCoef),
    seg(W, -H, W, -G, wallBCoef),
    seg(W, G, W, H, wallBCoef),
  ];
  const net = (s: 1 | -1): Seg[] => {
    const x0 = s * (W + PR); // borde exterior del poste
    const xb = s * (W + D); // fondo de la red
    const cr = Math.abs(xb - x0); // radio de la curva de la esquina
    const out: Seg[] = [];
    // esquina superior: de (x0,-G) a (xb,-G+cr)
    const cyTop = -G + cr;
    const cyBot = G - cr;
    if (s === 1) {
      out.push(...arcSegs(x0, cyTop, cr, -Math.PI / 2, 0, 4, netBCoef));
      out.push(seg(xb, cyTop, xb, cyBot, netBCoef));
      out.push(...arcSegs(x0, cyBot, cr, 0, Math.PI / 2, 4, netBCoef));
    } else {
      out.push(...arcSegs(x0, cyTop, cr, -Math.PI / 2, -Math.PI, 4, netBCoef));
      out.push(seg(xb, cyTop, xb, cyBot, netBCoef));
      out.push(...arcSegs(x0, cyBot, cr, Math.PI, Math.PI / 2, 4, netBCoef));
    }
    return out;
  };
  const netRed = net(-1);
  const netBlue = net(1);
  const post = (x: number, y: number): Disc => ({ x, y, vx: 0, vy: 0, r: PR, invMass: 0, bCoef: 0.5, damping: 1 });
  const SH = STADIUM.height;
  return {
    ballWalls: [...walls, ...netRed, ...netBlue],
    posts: [post(-W, -G), post(-W, G), post(W, -G), post(W, G)],
    kickoffLines: [seg(0, -SH, 0, -KR, 0.1), seg(0, KR, 0, SH, 0.1)],
    kickoffArc: {
      red: arcSegs(0, 0, KR, Math.PI / 2, Math.PI * 1.5, 12, 0.1),
      blue: arcSegs(0, 0, KR, -Math.PI / 2, Math.PI / 2, 12, 0.1),
    },
    nets: { red: netRed, blue: netBlue },
  };
}

export const stadium = buildStadium();

/** Colisión disco-disco con separación por masa inversa y rebote combinado. */
export function collideDiscs(a: Disc, b: Disc): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rr = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 > rr * rr) return false;
  const im = a.invMass + b.invMass;
  if (im === 0) return false;
  const d = Math.sqrt(d2);
  let nx: number;
  let ny: number;
  if (d > 1e-9) {
    nx = dx / d;
    ny = dy / d;
  } else {
    // centros coincidentes: separar en sentido contrario a la velocidad
    // relativa (o en x si están quietos). Determinista en cliente y servidor.
    const rvx = a.vx - b.vx;
    const rvy = a.vy - b.vy;
    const rv = Math.hypot(rvx, rvy);
    nx = rv > 1e-9 ? -rvx / rv : 1;
    ny = rv > 1e-9 ? -rvy / rv : 0;
  }
  const ka = a.invMass / im;
  const pen = rr - d;
  a.x += nx * pen * ka;
  a.y += ny * pen * ka;
  b.x -= nx * pen * (1 - ka);
  b.y -= ny * pen * (1 - ka);
  const vn = nx * (a.vx - b.vx) + ny * (a.vy - b.vy);
  if (vn < 0) {
    const j = vn * (a.bCoef * b.bCoef + 1);
    a.vx -= nx * j * ka;
    a.vy -= ny * j * ka;
    b.vx += nx * j * (1 - ka);
    b.vy += ny * j * (1 - ka);
  }
  return true;
}

/** Punto más cercano de un segmento a (px,py). */
export function closestOnSeg(s: Seg, px: number, py: number): [number, number] {
  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const len2 = ex * ex + ey * ey;
  let t = len2 > 0 ? ((px - s.ax) * ex + (py - s.ay) * ey) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [s.ax + ex * t, s.ay + ey * t];
}

export function collideSeg(d: Disc, s: Seg): boolean {
  const [cx, cy] = closestOnSeg(s, d.x, d.y);
  const dx = d.x - cx;
  const dy = d.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= d.r * d.r) return false;
  const dist = Math.sqrt(d2);
  let nx: number;
  let ny: number;
  if (dist > 1e-9) {
    nx = dx / dist;
    ny = dy / dist;
  } else {
    // centro exactamente sobre el segmento: salir por la normal opuesta a la velocidad
    const ex = s.bx - s.ax;
    const ey = s.by - s.ay;
    const el = Math.hypot(ex, ey) || 1;
    nx = -ey / el;
    ny = ex / el;
    if (nx * d.vx + ny * d.vy > 0) {
      nx = -nx;
      ny = -ny;
    }
  }
  const pen = d.r - dist;
  d.x += nx * pen;
  d.y += ny * pen;
  const vn = d.vx * nx + d.vy * ny;
  if (vn < 0) {
    const j = vn * (d.bCoef * s.bCoef + 1);
    d.vx -= nx * j;
    d.vy -= ny * j;
  }
  return true;
}

/** Límites exteriores del estadio para jugadores (rebote 0, como planos). */
export function collideBounds(d: Disc): void {
  const W = STADIUM.width - d.r;
  const H = STADIUM.height - d.r;
  if (d.x > W) { d.x = W; if (d.vx > 0) d.vx = 0; }
  if (d.x < -W) { d.x = -W; if (d.vx < 0) d.vx = 0; }
  if (d.y > H) { d.y = H; if (d.vy > 0) d.vy = 0; }
  if (d.y < -H) { d.y = -H; if (d.vy < 0) d.vy = 0; }
}

export function speed(d: { vx: number; vy: number }): number {
  return Math.hypot(d.vx, d.vy);
}

export function clampSpeed(d: { vx: number; vy: number }, max: number): void {
  const s2 = d.vx * d.vx + d.vy * d.vy;
  if (s2 > max * max) {
    const k = max / Math.sqrt(s2);
    d.vx *= k;
    d.vy *= k;
  }
}

/** Intersección de dos segmentos (p1-p2 con p3-p4). */
function segsIntersect(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): boolean {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function distPointSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const [cx, cy] = closestOnSeg({ ax: x1, ay: y1, bx: x2, by: y2, bCoef: 0 }, px, py);
  return Math.hypot(px - cx, py - cy);
}

/** ¿Hay una pared, red o poste entre dos puntos? */
export function lineBlocked(x1: number, y1: number, x2: number, y2: number): boolean {
  for (const s of stadium.ballWalls) {
    if (segsIntersect(x1, y1, x2, y2, s.ax, s.ay, s.bx, s.by)) return true;
  }
  for (const p of stadium.posts) {
    if (distPointSeg(p.x, p.y, x1, y1, x2, y2) < p.r) return true;
  }
  return false;
}

const SOLVER_PASSES = 3;

export interface PhysicsWorld {
  ball: Disc;
  players: Disc[];
  /** Segmentos extra que afectan sólo a jugadores (barreras de saque). */
  playerBarriers: Seg[];
}

/**
 * Avanza un tick. Divide el movimiento en subpasos si algo va rápido, para
 * que un tiro potente no atraviese postes ni paredes.
 */
export function stepWorld(w: PhysicsWorld): number {
  const all = [w.ball, ...w.players];
  let maxV = 0;
  for (const d of all) maxV = Math.max(maxV, speed(d));
  const n = Math.min(8, Math.max(1, Math.ceil(maxV / LIMITS.maxStepDistance)));
  for (let s = 0; s < n; s++) {
    for (const d of all) {
      d.x += d.vx / n;
      d.y += d.vy / n;
    }
    // tres pasadas del resolvedor: con la pelota apretada entre un jugador y
    // una pared (o entre dos jugadores) una sola pasada dejaba 0,3-0,5 px de solapamiento
    for (let it = 0; it < SOLVER_PASSES; it++) {
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) collideDiscs(all[i], all[j]);
      }
      for (const p of stadium.posts) collideDiscs(w.ball, p);
      for (const s2 of stadium.ballWalls) collideSeg(w.ball, s2);
      for (const pl of w.players) {
        for (const p of stadium.posts) collideDiscs(pl, p);
        for (const b of w.playerBarriers) collideSeg(pl, b);
        collideBounds(pl);
      }
    }
  }
  for (const d of all) {
    d.vx *= d.damping;
    d.vy *= d.damping;
  }
  return n;
}
