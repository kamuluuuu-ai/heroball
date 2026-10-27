// Renderizado Canvas 2D. Coordenadas físicas fijas; la cámara sólo escala y
// traslada, así la cancha nunca se deforma.
//
// Efectos de poderes: todo área que afecta algo se dibuja con su radio o ancho
// real (lo que se ve es lo que alcanza). Anticipación = contorno discontinuo
// que se llena; activación = trazo sólido; impacto = destello breve;
// finalización = desvanecido. Con efectos reducidos no hay partículas, giros ni
// destellos, pero las zonas, haces y avisos se siguen dibujando.
import { COLORS, KICK, STADIUM, powersFor } from '../../../shared/config';
import { stadium, type Seg } from '../../../shared/physics';
import type { GameEvent, GameState, PlayerState, Projectile, Team, Zone } from '../../../shared/types';
import { IN } from '../../../shared/types';
import { drawHero } from './heroArt';
import { autoAim, boltTarget, grappleAim } from '../../../shared/powers';

interface Fx {
  kind: 'ring' | 'spark' | 'wave' | 'line' | 'mark';
  x: number;
  y: number;
  r: number;
  color: string;
  t0: number;
  dur: number;
  x2?: number;
  y2?: number;
}

interface Banner {
  lines: string[];
  color: string;
  t0: number;
  dur: number;
}

export interface RenderOptions {
  names: Map<string, string>;
  /** 1 = cancha completa; >1 acerca y sigue al jugador. */
  zoom: number;
  showNames: boolean;
  /** Capa de depuración de contacto. */
  debug?: boolean;
  /** Efectos reducidos (preferencia o prefers-reduced-motion). */
  reducedFx?: boolean;
}

export interface DebugLayers {
  pred: GameState | null;
  auth: GameState | null;
}

const TEAM_COLOR: Record<Team, string> = { red: COLORS.red, blue: COLORS.blue };
/** Presupuesto de efectos efímeros simultáneos (se descartan los más viejos). */
const MAX_FX = 60;

const FX_COLOR = {
  slam: '#9BE36B',
  arrow: '#FF9A3C',
  missile: '#FF5A4A',
  portal: '#A979FF',
  gold: '#E2B23B',
  rewind: '#5BE38B',
  shield: '#7FB2FF',
  stun: '#FFE15A',
};

export class Renderer {
  private c: CanvasRenderingContext2D;
  private fx: Fx[] = [];
  private banner: Banner | null = null;
  private grass: CanvasPattern | null = null;
  private camX = 0;
  private camY = 0;
  private reduced = false;
  /** Duración total del último stun de cada jugador (para su arco de tiempo). */
  private stunTotal = new Map<string, number>();

  constructor(public canvas: HTMLCanvasElement) {
    this.c = canvas.getContext('2d', { alpha: false })!;
  }

  private ensureGrass(): CanvasPattern | null {
    if (this.grass) return this.grass;
    const p = document.createElement('canvas');
    p.width = 64;
    p.height = 64;
    const g = p.getContext('2d')!;
    g.fillStyle = COLORS.grass;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = COLORS.grassStripe;
    g.fillRect(0, 0, 32, 64);
    this.grass = this.c.createPattern(p, 'repeat');
    return this.grass;
  }

  private push(f: Omit<Fx, 't0'>, essential = false): void {
    if (this.reduced && !essential) return;
    this.fx.push({ ...f, t0: performance.now() });
    if (this.fx.length > MAX_FX) this.fx.splice(0, this.fx.length - MAX_FX);
  }

  /** Efectos visuales disparados por eventos de la simulación. */
  addEvents(ev: GameEvent[], s: GameState | null, names: Map<string, string>): void {
    const now = performance.now();
    for (const e of ev) {
      switch (e.type) {
        case 'slam':
          // onda con el radio real del golpe (esencial: muestra a quién alcanzó)
          this.push({ kind: 'wave', x: e.x, y: e.y, r: e.r, color: FX_COLOR.slam, dur: 380 }, true);
          break;
        case 'boom':
          this.push({ kind: 'wave', x: e.x, y: e.y, r: e.r, color: e.kind === 'arrow' ? FX_COLOR.arrow : FX_COLOR.missile, dur: 420 }, true);
          this.push({ kind: 'spark', x: e.x, y: e.y, r: e.r * 0.45, color: '#FFE2B0', dur: 260 });
          break;
        case 'hit':
          this.push({ kind: 'spark', x: e.x, y: e.y, r: 10, color: e.target === 'player' ? '#9fd1ff' : '#ffffff', dur: 200 });
          break;
        case 'blocked':
          // la protección del Capitán absorbió un poder
          this.push({ kind: 'ring', x: e.x, y: e.y, r: 18, color: FX_COLOR.shield, dur: 300 }, true);
          break;
        case 'protect':
          if (s) this.push({ kind: 'ring', x: s.ball.x, y: s.ball.y, r: s.ball.r + 14, color: FX_COLOR.shield, dur: 320 });
          break;
        case 'blink':
          // portal: salida, llegada y un trazo (no se interpola como recorrido)
          this.push({ kind: 'ring', x: e.x0, y: e.y0, r: 20, color: FX_COLOR.portal, dur: 320 }, true);
          this.push({ kind: 'ring', x: e.x1, y: e.y1, r: 20, color: FX_COLOR.gold, dur: 320 }, true);
          this.push({ kind: 'line', x: e.x0, y: e.y0, x2: e.x1, y2: e.y1, r: 0, color: FX_COLOR.portal, dur: 260 });
          break;
        case 'rewind':
          // sello verde, trayectoria fantasma breve y aparición en el destino
          this.push({ kind: 'line', x: e.x0, y: e.y0, x2: e.x1, y2: e.y1, r: 0, color: FX_COLOR.rewind, dur: 420 }, true);
          this.push({ kind: 'ring', x: e.x1, y: e.y1, r: 22, color: FX_COLOR.rewind, dur: 380 }, true);
          if (s) {
            const p = s.players.find((o) => o.id === e.id);
            if (p) this.push({ kind: 'ring', x: p.d.x, y: p.d.y, r: p.d.r + 10, color: FX_COLOR.rewind, dur: 360 });
          }
          break;
        case 'stun':
          this.stunTotal.set(e.id, e.ticks);
          break;
        case 'fizzle':
          // sin objetivo o destino válido: indicación discreta, sin gastar recarga
          if (s) {
            const p = s.players.find((o) => o.id === e.id);
            if (p) this.push({ kind: 'mark', x: p.d.x, y: p.d.y - p.d.r - 10, r: 5, color: 'rgba(255,255,255,0.85)', dur: 500 }, true);
          }
          break;
        case 'goal': {
          const who = e.scorer ? names.get(e.scorer) : null;
          this.banner = {
            lines: [e.team === 'red' ? '¡Gol rojo!' : '¡Gol azul!', ...(who ? [who] : [])],
            color: TEAM_COLOR[e.team], t0: now, dur: 2300,
          };
          break;
        }
        case 'end':
          this.banner = {
            lines: e.winner ? [`¡Ganó ${e.winner === 'red' ? 'Rojo' : 'Azul'}!`] : ['Fin del partido'],
            color: e.winner ? TEAM_COLOR[e.winner] : '#fff', t0: now, dur: 4500,
          };
          break;
        case 'overtime':
          this.banner = { lines: ['¡Gol de oro!'], color: '#fff', t0: now, dur: 2000 };
          break;
        case 'power':
          if (s) {
            const p = s.players.find((o) => o.id === e.id);
            if (p) this.push({ kind: 'ring', x: p.d.x, y: p.d.y, r: p.d.r + 8, color: '#ffffff', dur: 180 });
          }
          break;
      }
    }
  }

  clearFx(): void {
    this.fx = [];
    this.banner = null;
  }

  private resize(): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return dpr;
  }

  draw(s: GameState | null, localId: string, o: RenderOptions, dbg?: DebugLayers): void {
    const c = this.c;
    this.reduced = !!o.reducedFx;
    this.resize();
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = COLORS.grass;
    c.fillRect(0, 0, W, H);

    // cámara: escala uniforme para que entre la cancha completa
    const fit = Math.min(W / (STADIUM.width * 2 + 20), H / (STADIUM.height * 2 + 20));
    const scale = fit * o.zoom;
    const me = s?.players.find((p) => p.id === localId);
    let tx = 0;
    let ty = 0;
    if (o.zoom > 1.001 && s) {
      const fx = me ? me.d.x : s.ball.x;
      const fy = me ? me.d.y : s.ball.y;
      const halfW = W / scale / 2;
      const halfH = H / scale / 2;
      const lim = (v: number, half: number, ext: number) => (half >= ext ? 0 : Math.max(-ext + half, Math.min(ext - half, v)));
      tx = lim(fx, halfW, STADIUM.width + 10);
      ty = lim(fy, halfH, STADIUM.height + 10);
    }
    this.camX += (tx - this.camX) * 0.2;
    this.camY += (ty - this.camY) * 0.2;
    c.setTransform(scale, 0, 0, scale, W / 2 - this.camX * scale, H / 2 - this.camY * scale);

    this.drawField(c);
    if (!s) return;

    // zonas en el suelo debajo de todo (estelas, avisos, portales)
    this.drawZones(c, s, 'ground');

    // hilos: telaraña (pelota o rival) y gancho de Batman
    for (const th of s.tethers) {
      const p = s.players.find((o2) => o2.id === th.owner);
      if (!p) continue;
      const end = th.target ? s.players.find((o2) => o2.id === th.target)?.d : s.ball;
      if (!end) continue;
      c.beginPath();
      c.moveTo(p.d.x, p.d.y);
      c.lineTo(end.x, end.y);
      if (th.kind === 'grapple') {
        c.strokeStyle = 'rgba(25,25,30,0.95)';
        c.lineWidth = 2;
      } else {
        c.strokeStyle = 'rgba(255,255,255,0.9)';
        c.lineWidth = 1.5;
      }
      c.stroke();
    }
    for (const pr of s.projectiles) {
      if (pr.kind === 'web' || pr.kind === 'hook') {
        const hook = pr.kind === 'hook';
        const p = s.players.find((o2) => o2.id === pr.owner);
        if (p) {
          c.strokeStyle = hook ? 'rgba(25,25,30,0.85)' : 'rgba(255,255,255,0.7)';
          c.lineWidth = hook ? 1.5 : 1;
          c.beginPath();
          c.moveTo(p.d.x, p.d.y);
          c.lineTo(pr.x, pr.y);
          c.stroke();
        }
        c.fillStyle = hook ? '#F2C230' : '#fff';
        c.beginPath();
        c.arc(pr.x, pr.y, pr.r + 1, 0, Math.PI * 2);
        c.fill();
      } else if (pr.kind === 'batarang') {
        c.save();
        c.translate(pr.x, pr.y);
        c.rotate(performance.now() / 50);
        c.fillStyle = '#1b1b22';
        c.strokeStyle = '#F2C230';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(-pr.r * 1.6, 0);
        c.quadraticCurveTo(0, pr.r, pr.r * 1.6, 0);
        c.quadraticCurveTo(0, -pr.r * 0.4, -pr.r * 1.6, 0);
        c.fill();
        c.stroke();
        c.restore();
      } else {
        this.drawShot(c, s, pr);
      }
    }

    for (const p of s.players) this.drawPlayer(c, s, p, p.id === localId, o);
    this.drawAimReticle(c, s, localId);
    this.drawPosts(c);
    this.drawBall(c, s);
    // haces, rayos y misiles por encima de los discos (la pelota sigue visible: son translúcidos)
    this.drawZones(c, s, 'air');
    this.drawFx(c);
    if (dbg) this.drawDebug(c, s, localId, dbg, scale);

    // textos de pantalla
    c.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBanner(c, W, H, s);
    if (dbg) this.drawDebugLegend(c, s, localId, dbg);
  }

  /**
   * Depuración de contacto: radios físicos (blanco fino), centros, alcance de
   * patada del jugador local (amarillo), posición física predicha sin suavizar
   * (magenta) y última posición autoritativa del servidor (naranja).
   */
  private drawDebug(c: CanvasRenderingContext2D, s: GameState, localId: string, dbg: DebugLayers, scale: number): void {
    const px = 1 / scale;
    const ring = (x: number, y: number, r: number, color: string, dash: number[] = []) => {
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.setLineDash(dash.map((d) => d * px));
      c.strokeStyle = color;
      c.lineWidth = px;
      c.stroke();
      c.setLineDash([]);
    };
    const cross = (x: number, y: number, color: string) => {
      c.strokeStyle = color;
      c.lineWidth = px;
      c.beginPath();
      c.moveTo(x - 3 * px, y);
      c.lineTo(x + 3 * px, y);
      c.moveTo(x, y - 3 * px);
      c.lineTo(x, y + 3 * px);
      c.stroke();
    };
    const discs = (g: GameState) => [g.ball, ...g.players.map((p) => p.d)];
    if (dbg.auth) for (const d of discs(dbg.auth)) ring(d.x, d.y, d.r, 'rgba(255,150,40,0.95)', [4, 3]);
    if (dbg.pred) for (const d of discs(dbg.pred)) ring(d.x, d.y, d.r, 'rgba(255,60,220,0.95)');
    for (const d of discs(s)) {
      ring(d.x, d.y, d.r, '#fff');
      cross(d.x, d.y, '#fff');
    }
    const me = s.players.find((p) => p.id === localId);
    if (me) {
      // la patada vale si el borde de la pelota entra en este anillo
      ring(me.d.x, me.d.y, me.d.r + KICK.range, 'rgba(255,230,60,0.95)', [2, 2]);
      const b = s.ball;
      const dist = Math.hypot(b.x - me.d.x, b.y - me.d.y) || 1;
      const nx = (b.x - me.d.x) / dist;
      const ny = (b.y - me.d.y) / dist;
      c.beginPath();
      c.moveTo(me.d.x + nx * me.d.r, me.d.y + ny * me.d.r);
      c.lineTo(b.x - nx * b.r, b.y - ny * b.r);
      c.strokeStyle = 'rgba(255,230,60,0.95)';
      c.lineWidth = px;
      c.stroke();
    }
  }

  private drawDebugLegend(c: CanvasRenderingContext2D, s: GameState, localId: string, dbg: DebugLayers): void {
    const lines: string[] = ['DEPURACIÓN · blanco: dibujado · amarillo: alcance de patada'];
    if (dbg.pred) lines.push('magenta: física predicha · naranja: servidor');
    const phys = dbg.pred ?? s;
    const me = phys.players.find((p) => p.id === localId);
    if (me) {
      const gap = Math.hypot(phys.ball.x - me.d.x, phys.ball.y - me.d.y) - me.d.r - phys.ball.r;
      lines.push(`borde jugador–pelota: ${gap.toFixed(1)} px · patada ${gap < KICK.range ? 'EN RANGO' : 'fuera'} (< ${KICK.range} px)`);
      const auth = dbg.auth?.players.find((p) => p.id === localId);
      if (auth) lines.push(`desfase predicho–servidor: ${Math.hypot(auth.d.x - me.d.x, auth.d.y - me.d.y).toFixed(1)} px`);
    }
    c.font = '600 11px ui-monospace, Consolas, monospace';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    const w = Math.max(...lines.map((l) => c.measureText(l).width)) + 12;
    c.fillStyle = 'rgba(0,0,0,0.65)';
    c.fillRect(8, 40, w, lines.length * 15 + 8);
    c.fillStyle = '#fff';
    lines.forEach((l, i) => c.fillText(l, 14, 44 + i * 15));
  }

  private drawField(c: CanvasRenderingContext2D): void {
    const { fieldW: FW, fieldH: FH, kickoffRadius: KR } = STADIUM;
    const pat = this.ensureGrass();
    if (pat) {
      c.fillStyle = pat;
      c.fillRect(-FW, -FH, FW * 2, FH * 2);
    }
    c.strokeStyle = COLORS.lines;
    c.lineWidth = 3;
    c.strokeRect(-FW, -FH, FW * 2, FH * 2);
    c.beginPath();
    c.moveTo(0, -FH);
    c.lineTo(0, FH);
    c.stroke();
    c.beginPath();
    c.arc(0, 0, KR, 0, Math.PI * 2);
    c.stroke();
    // redes
    c.strokeStyle = '#000';
    c.lineWidth = 2;
    const drawSegs = (segs: Seg[]) => {
      c.beginPath();
      c.moveTo(segs[0].ax, segs[0].ay);
      for (const sg of segs) c.lineTo(sg.bx, sg.by);
      c.stroke();
    };
    drawSegs(stadium.nets.red);
    drawSegs(stadium.nets.blue);
  }

  private drawPosts(c: CanvasRenderingContext2D): void {
    for (const p of stadium.posts) {
      c.beginPath();
      c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      c.fillStyle = p.x < 0 ? COLORS.redPost : COLORS.bluePost;
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = '#000';
      c.stroke();
    }
  }

  /** Línea quebrada determinista (rayos): misma forma en todos los clientes para una misma semilla. */
  private zigzag(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, amp: number, seed: number, n = 6): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    c.beginPath();
    c.moveTo(x0, y0);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const j = Math.sin(seed * 12.9898 + i * 78.233) * amp;
      c.lineTo(x0 + dx * k + nx * j, y0 + dy * k + ny * j);
    }
    c.lineTo(x1, y1);
  }

  /** Proyectiles de los héroes (salvo Spider-Man y Batman): forma propia, tamaño real y estela corta. */
  private drawShot(c: CanvasRenderingContext2D, s: GameState, pr: Projectile): void {
    const sp = Math.hypot(pr.vx, pr.vy) || 1;
    const ux = pr.vx / sp;
    const uy = pr.vy / sp;
    const t = performance.now();
    const superMode = s.mode === 'super';
    c.save();
    switch (pr.kind) {
      case 'arrow': {
        // flecha con punta encendida y estela corta
        const len = 16;
        c.strokeStyle = 'rgba(255,180,90,0.45)';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(pr.x - ux * len, pr.y - uy * len);
        c.lineTo(pr.x - ux * len * 2, pr.y - uy * len * 2);
        c.stroke();
        c.strokeStyle = '#6B4A2B';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(pr.x - ux * len, pr.y - uy * len);
        c.lineTo(pr.x, pr.y);
        c.stroke();
        // plumas
        c.strokeStyle = '#7E3FB0';
        c.beginPath();
        c.moveTo(pr.x - ux * len, pr.y - uy * len);
        c.lineTo(pr.x - ux * (len + 4) - uy * 3, pr.y - uy * (len + 4) + ux * 3);
        c.moveTo(pr.x - ux * len, pr.y - uy * len);
        c.lineTo(pr.x - ux * (len + 4) + uy * 3, pr.y - uy * (len + 4) - ux * 3);
        c.stroke();
        c.beginPath();
        c.arc(pr.x, pr.y, pr.r + 1.5, 0, Math.PI * 2);
        c.fillStyle = this.reduced ? '#FF9A3C' : `rgba(255,${150 + Math.round(60 * Math.sin(t / 50))},60,1)`;
        c.fill();
        break;
      }
      case 'shock': {
        c.strokeStyle = 'rgba(127,214,255,0.7)';
        c.lineWidth = 1.5;
        this.zigzag(c, pr.x - ux * pr.r * 5, pr.y - uy * pr.r * 5, pr.x, pr.y, 2.5, this.reduced ? pr.id : pr.id + Math.floor(t / 60));
        c.stroke();
        c.beginPath();
        c.arc(pr.x, pr.y, pr.r + 1, 0, Math.PI * 2);
        c.fillStyle = '#BFEAFF';
        c.fill();
        c.lineWidth = 1.5;
        c.strokeStyle = '#2E8FD0';
        c.stroke();
        break;
      }
      case 'shield': {
        c.globalAlpha = pr.returning ? 0.45 : 1;
        if (!pr.returning) {
          c.strokeStyle = 'rgba(255,255,255,0.35)';
          c.lineWidth = pr.r;
          c.beginPath();
          c.moveTo(pr.x, pr.y);
          c.lineTo(pr.x - ux * pr.r * 2.2, pr.y - uy * pr.r * 2.2);
          c.stroke();
        }
        c.translate(pr.x, pr.y);
        if (!this.reduced) c.rotate(t / 90);
        for (const [k, col] of [[1, '#C8232C'], [0.74, '#F2F2F2'], [0.5, '#C8232C'], [0.3, '#1F3F94']] as const) {
          c.beginPath();
          c.arc(0, 0, pr.r * k, 0, Math.PI * 2);
          c.fillStyle = col;
          c.fill();
        }
        this.star(c, pr.r * 0.26, '#F2F2F2');
        c.lineWidth = 1;
        c.strokeStyle = 'rgba(0,0,0,0.55)';
        c.beginPath();
        c.arc(0, 0, pr.r, 0, Math.PI * 2);
        c.stroke();
        break;
      }
      case 'repulsor': {
        if (pr.delay && pr.delay > 0) {
          // carga: el pulso crece delante de Iron Man
          const k = 1 - pr.delay / powersFor(s.mode).ironman.repulsor.windup;
          c.beginPath();
          c.arc(pr.x, pr.y, pr.r * (0.4 + 0.6 * k), 0, Math.PI * 2);
          c.fillStyle = 'rgba(200,250,255,0.9)';
          c.fill();
          c.beginPath();
          c.arc(pr.x, pr.y, pr.r + 3, 0, Math.PI * 2);
          c.strokeStyle = 'rgba(80,220,255,0.8)';
          c.lineWidth = 1.5;
          c.stroke();
          break;
        }
        // pulso: núcleo blanco, anillo cian y estela corta (no un haz continuo como el láser)
        for (let i = 1; i <= 3; i++) {
          c.beginPath();
          c.arc(pr.x - ux * pr.r * 1.3 * i, pr.y - uy * pr.r * 1.3 * i, pr.r * (1 - i * 0.22), 0, Math.PI * 2);
          c.fillStyle = `rgba(90,225,255,${0.35 - i * 0.09})`;
          c.fill();
        }
        c.beginPath();
        c.arc(pr.x, pr.y, pr.r, 0, Math.PI * 2);
        c.fillStyle = '#FFFFFF';
        c.fill();
        c.lineWidth = superMode ? 3 : 2;
        c.strokeStyle = '#3FD8FF';
        c.stroke();
        break;
      }
      case 'hammer': {
        // estela azul y martillo con su tamaño real
        c.strokeStyle = 'rgba(110,170,255,0.45)';
        c.lineWidth = pr.r * 0.9;
        c.beginPath();
        c.moveTo(pr.x, pr.y);
        c.lineTo(pr.x - ux * pr.r * 3, pr.y - uy * pr.r * 3);
        c.stroke();
        c.translate(pr.x, pr.y);
        if (!this.reduced) c.rotate(t / 70);
        c.fillStyle = '#7B5A3A';
        c.fillRect(-pr.r * 0.16, pr.r * 0.35, pr.r * 0.32, pr.r * 0.95);
        c.fillStyle = '#C9D2E3';
        c.strokeStyle = '#4B5568';
        c.lineWidth = 1.5;
        c.beginPath();
        c.rect(-pr.r, -pr.r * 0.55, pr.r * 2, pr.r * 0.95);
        c.fill();
        c.stroke();
        if (!this.reduced) {
          c.strokeStyle = 'rgba(150,210,255,0.9)';
          c.lineWidth = 1;
          this.zigzag(c, -pr.r, -pr.r * 0.8, pr.r, -pr.r * 0.8, 2, pr.id + Math.floor(t / 80), 4);
          c.stroke();
        }
        break;
      }
      default: {
        c.beginPath();
        c.arc(pr.x, pr.y, pr.r + 1, 0, Math.PI * 2);
        c.fillStyle = '#fff';
        c.fill();
      }
    }
    c.restore();
  }

  private star(c: CanvasRenderingContext2D, r: number, color: string): void {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath();
    c.fillStyle = color;
    c.fill();
  }

  /** Arco de progreso (0..1) alrededor de un punto. */
  private progress(c: CanvasRenderingContext2D, x: number, y: number, r: number, k: number, color: string, width = 2.5): void {
    c.beginPath();
    c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, k)));
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
  }

  /**
   * Zonas con anticipación visible. 'ground' = sobre el pasto (estelas, avisos,
   * portales); 'air' = encima de los discos (haces, rayos, misil cayendo).
   */
  private drawZones(c: CanvasRenderingContext2D, s: GameState, layer: 'ground' | 'air'): void {
    const P = powersFor(s.mode);
    const now = performance.now();
    for (const z of s.zones) {
      c.save();
      if (layer === 'ground') this.drawGroundZone(c, s, z, P, now);
      else this.drawAirZone(c, s, z, P, now);
      c.restore();
    }
  }

  private drawGroundZone(c: CanvasRenderingContext2D, s: GameState, z: Zone, P: ReturnType<typeof powersFor>, now: number): void {
    switch (z.kind) {
      case 'pulse': {
        const k = 1 - z.delay / P.panther.pulse.delay;
        c.beginPath();
        c.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        c.fillStyle = 'rgba(170,140,255,0.16)';
        c.fill();
        c.setLineDash([5, 4]);
        c.lineWidth = 2;
        c.strokeStyle = 'rgba(200,180,255,0.95)';
        c.stroke();
        c.setLineDash([]);
        c.beginPath();
        c.arc(z.x, z.y, z.r * k, 0, Math.PI * 2);
        c.stroke();
        break;
      }
      case 'trail': {
        // área que ralentiza: segmentos naranjas con borde (se apagan con su edad)
        const life = P.flash.trail.segTicks;
        for (const q of z.pts) {
          const a = Math.max(0, 1 - (s.tick - q.t) / life);
          c.beginPath();
          c.arc(q.x, q.y, z.r, 0, Math.PI * 2);
          c.fillStyle = `rgba(255,140,40,${0.1 + 0.22 * a})`;
          c.fill();
        }
        c.setLineDash([4, 4]);
        c.lineWidth = 1.5;
        c.strokeStyle = 'rgba(255,170,60,0.75)';
        for (const q of z.pts) {
          c.beginPath();
          c.arc(q.x, q.y, z.r, 0, Math.PI * 2);
          c.stroke();
        }
        c.setLineDash([]);
        break;
      }
      case 'missile': {
        const total = P.ironman.missile.delay;
        if (z.delay > 0) {
          // retícula roja con cuenta atrás circular (lo que importa es dónde está la pelota al caer)
          c.beginPath();
          c.arc(z.x, z.y, z.r, 0, Math.PI * 2);
          c.fillStyle = 'rgba(255,70,60,0.12)';
          c.fill();
          c.setLineDash([6, 4]);
          c.lineWidth = 2;
          c.strokeStyle = 'rgba(255,90,74,0.95)';
          c.stroke();
          c.setLineDash([]);
          c.beginPath();
          c.moveTo(z.x - 8, z.y);
          c.lineTo(z.x + 8, z.y);
          c.moveTo(z.x, z.y - 8);
          c.lineTo(z.x, z.y + 8);
          c.lineWidth = 1.5;
          c.stroke();
          this.progress(c, z.x, z.y, z.r + 5, 1 - z.delay / total, 'rgba(255,90,74,0.95)', 3);
        } else if (z.ang !== null) {
          // resultado ya resuelto: flecha con la dirección sorteada del impulso
          const a = Math.max(0, z.ticks / 30);
          c.globalAlpha = a;
          c.translate(z.x, z.y);
          c.rotate(z.ang);
          c.strokeStyle = '#FFD2C8';
          c.lineWidth = 3;
          c.beginPath();
          c.moveTo(0, 0);
          c.lineTo(z.r * 0.9, 0);
          c.moveTo(z.r * 0.9, 0);
          c.lineTo(z.r * 0.65, -7);
          c.moveTo(z.r * 0.9, 0);
          c.lineTo(z.r * 0.65, 7);
          c.stroke();
        }
        break;
      }
      case 'bolt': {
        if (z.delay > 0) {
          // aviso en el suelo: círculo exacto del rayo que se va llenando
          const k = 1 - z.delay / P.thor.bolt.delay;
          c.beginPath();
          c.arc(z.x, z.y, z.r, 0, Math.PI * 2);
          c.fillStyle = `rgba(255,225,90,${0.08 + 0.2 * k})`;
          c.fill();
          c.setLineDash([5, 4]);
          c.lineWidth = 2;
          c.strokeStyle = 'rgba(255,225,90,0.95)';
          c.stroke();
          c.setLineDash([]);
          c.beginPath();
          c.arc(z.x, z.y, z.r * k, 0, Math.PI * 2);
          c.strokeStyle = 'rgba(140,190,255,0.95)';
          c.stroke();
        }
        break;
      }
      case 'portal': {
        // salida y destino visibles durante la canalización (los rivales lo pueden anticipar)
        const k = 1 - z.delay / P.strange.portal.channel;
        const o = z.pts[0];
        const spin = this.reduced ? 0 : now / 300;
        const ring = (x: number, y: number, col: string) => {
          c.save();
          c.translate(x, y);
          c.rotate(spin);
          c.beginPath();
          c.ellipse(0, 0, z.r + 6, (z.r + 6) * 0.8, 0, 0, Math.PI * 2);
          c.lineWidth = 3;
          c.strokeStyle = col;
          c.setLineDash([7, 4]);
          c.stroke();
          c.setLineDash([]);
          c.restore();
        };
        if (o) ring(o.x, o.y, 'rgba(169,121,255,0.95)');
        c.beginPath();
        c.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        c.fillStyle = 'rgba(226,178,59,0.18)';
        c.fill();
        ring(z.x, z.y, 'rgba(226,178,59,0.95)');
        this.progress(c, z.x, z.y, z.r + 11, k, 'rgba(169,121,255,0.95)');
        break;
      }
      default:
        break;
    }
  }

  private drawAirZone(c: CanvasRenderingContext2D, s: GameState, z: Zone, P: ReturnType<typeof powersFor>, now: number): void {
    switch (z.kind) {
      case 'laser': {
        const ex = z.x + z.dx * z.len;
        const ey = z.y + z.dy * z.len;
        if (z.delay > 0) {
          // anticipación direccional: guía fina y brillo en el origen
          const k = 1 - z.delay / P.superman.laser.windup;
          c.setLineDash([6, 5]);
          c.strokeStyle = `rgba(255,60,50,${0.35 + 0.5 * k})`;
          c.lineWidth = 1.5;
          c.beginPath();
          c.moveTo(z.x, z.y);
          c.lineTo(ex, ey);
          c.stroke();
          c.setLineDash([]);
          c.beginPath();
          c.arc(z.x, z.y, 3 + 5 * k, 0, Math.PI * 2);
          c.fillStyle = 'rgba(255,120,100,0.9)';
          c.fill();
          break;
        }
        // haz: ancho = ancho real de impacto (2 × medio ancho), núcleo claro
        const fade = Math.min(1, z.ticks / 6);
        c.globalAlpha = fade;
        c.lineCap = 'round';
        c.strokeStyle = 'rgba(230,30,30,0.85)';
        c.lineWidth = z.r * 2;
        c.beginPath();
        c.moveTo(z.x, z.y);
        c.lineTo(ex, ey);
        c.stroke();
        c.strokeStyle = 'rgba(255,235,225,0.95)';
        c.lineWidth = Math.max(1.5, z.r * 0.6);
        c.stroke();
        c.lineCap = 'butt';
        // destello de origen e impacto
        c.beginPath();
        c.arc(z.x, z.y, z.r * 1.3, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,200,180,0.8)';
        c.fill();
        c.beginPath();
        c.arc(ex, ey, z.r * 1.6, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,90,60,0.55)';
        c.fill();
        break;
      }
      case 'missile': {
        if (z.delay <= 0) break;
        // misil descendiendo hacia la retícula
        const k = z.delay / P.ironman.missile.delay;
        const y = z.y - 90 * k;
        c.translate(z.x, y);
        c.fillStyle = '#D9DCE3';
        c.strokeStyle = '#3A3F4A';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(0, 9);
        c.lineTo(4, 3);
        c.lineTo(4, -8);
        c.lineTo(-4, -8);
        c.lineTo(-4, 3);
        c.closePath();
        c.fill();
        c.stroke();
        c.fillStyle = '#C8232C';
        c.fillRect(-4, -11, 8, 3);
        if (!this.reduced) {
          c.fillStyle = 'rgba(255,170,60,0.85)';
          c.beginPath();
          c.arc(0, -14 - Math.random() * 3, 3, 0, Math.PI * 2);
          c.fill();
        }
        break;
      }
      case 'bolt': {
        if (z.delay > 0) break;
        // rayo vertical breve sobre la zona (sin destellos de pantalla completa)
        const a = Math.min(1, z.ticks / 8);
        c.globalAlpha = a;
        c.strokeStyle = 'rgba(200,225,255,0.95)';
        c.lineWidth = 3;
        this.zigzag(c, z.x + 6, z.y - 120, z.x, z.y, 7, z.id, 7);
        c.stroke();
        c.strokeStyle = '#ffffff';
        c.lineWidth = 1.2;
        c.stroke();
        c.beginPath();
        c.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(255,225,90,0.9)';
        c.lineWidth = 2;
        c.stroke();
        break;
      }
      default:
        break;
    }
  }

  private drawBall(c: CanvasRenderingContext2D, s: GameState): void {
    const b = s.ball;
    const now = performance.now();
    if (s.ballShield > 0) {
      // burbuja translúcida pegada a la pelota: no cambia su colisión (el borde negro sigue siendo el real)
      c.beginPath();
      c.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2);
      c.fillStyle = 'rgba(110,160,255,0.28)';
      c.fill();
      c.setLineDash([3, 3]);
      c.lineWidth = 1.2;
      c.strokeStyle = 'rgba(160,200,255,0.95)';
      c.stroke();
      c.setLineDash([]);
      // arco de duración restante y símbolo de escudo
      this.progress(c, b.x, b.y, b.r + 7, s.ballShield / Math.max(1, s.ballShieldMax), 'rgba(80,140,255,0.95)', 2);
      c.save();
      c.translate(b.x, b.y - b.r - 13);
      c.beginPath();
      c.arc(0, 0, 5, 0, Math.PI * 2);
      c.fillStyle = '#1F3F94';
      c.fill();
      this.star(c, 3.5, '#F2F2F2');
      c.restore();
    }
    c.beginPath();
    c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    c.fillStyle = COLORS.ball;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = '#000';
    c.stroke();
    if (s.ballElec > 0) {
      // electricidad de Mjolnir: arcos decorativos (sólo el contacto físico aturde)
      c.strokeStyle = 'rgba(120,200,255,0.95)';
      c.lineWidth = 1.5;
      if (this.reduced) {
        c.setLineDash([2, 3]);
        c.beginPath();
        c.arc(b.x, b.y, b.r + 3, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
      } else {
        const seed = Math.floor(now / 70);
        for (let i = 0; i < 3; i++) {
          const a0 = ((seed * 1.7 + i * 2.1) % (Math.PI * 2));
          const a1 = a0 + 1.1;
          this.zigzag(c, b.x + Math.cos(a0) * (b.r + 2), b.y + Math.sin(a0) * (b.r + 2), b.x + Math.cos(a1) * (b.r + 2), b.y + Math.sin(a1) * (b.r + 2), 3, seed + i, 4);
          c.stroke();
        }
      }
    }
  }

  private drawPlayer(c: CanvasRenderingContext2D, s: GameState, p: PlayerState, local: boolean, o: RenderOptions): void {
    const { x, y, r } = p.d;
    const team = TEAM_COLOR[p.team];
    const t = performance.now();
    const sp = Math.hypot(p.d.vx, p.d.vy) || 1;
    const bx = -p.d.vx / sp;
    const by = -p.d.vy / sp;
    // auras de efectos (breves y legibles)
    if (p.evade > 0) {
      // menos empuje de poderes: anillo doble claro
      c.beginPath();
      c.arc(x, y, r + 4, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(220,220,230,0.75)';
      c.lineWidth = 2;
      c.stroke();
    }
    if (p.rush > 0 && p.hero === 'widow') {
      // dash de Black Widow: estela roja que se afina y siluetas residuales sólo
      // de contorno discontinuo (nunca un disco relleno: no parecen jugadores)
      const nx = -by * r * 0.8;
      const ny = bx * r * 0.8;
      c.beginPath();
      c.moveTo(x + nx, y + ny);
      c.lineTo(x + bx * r * 3.6, y + by * r * 3.6);
      c.lineTo(x - nx, y - ny);
      c.closePath();
      c.fillStyle = 'rgba(220,40,50,0.35)';
      c.fill();
      c.setLineDash([3, 3]);
      c.lineWidth = 2;
      for (let i = 1; i <= 3; i++) {
        c.beginPath();
        c.arc(x + bx * r * 1.1 * i, y + by * r * 1.1 * i, r * (1 - i * 0.12), 0, Math.PI * 2);
        c.strokeStyle = `rgba(230,40,50,${0.8 - i * 0.18})`;
        c.stroke();
      }
      c.setLineDash([]);
    } else if (p.sprint > 0 || p.trailBoost > 0) {
      // Flash: rayos amarillos (Q) o estela naranja propia (E)
      const col = p.sprint > 0 ? 'rgba(255,225,60,0.9)' : 'rgba(255,150,50,0.85)';
      c.strokeStyle = col;
      c.lineWidth = 1.6;
      for (const off of [-0.55, 0.55]) {
        const nx = -by * off * r;
        const ny = bx * off * r;
        this.zigzag(c, x + bx * r + nx, y + by * r + ny, x + bx * r * 2.8 + nx, y + by * r * 2.8 + ny, 2.5, (this.reduced ? 0 : Math.floor(t / 70)) + off * 10, 4);
        c.stroke();
      }
    } else if (p.dash > 0 || p.superSpeed > 0 || p.rush > 0) {
      c.strokeStyle = 'rgba(255,255,255,0.45)';
      c.lineWidth = 2;
      for (const off of [-0.6, 0, 0.6]) {
        const nx = -by * off * r;
        const ny = bx * off * r;
        c.beginPath();
        c.moveTo(x + bx * r + nx, y + by * r + ny);
        c.lineTo(x + bx * r * 2.4 + nx, y + by * r * 2.4 + ny);
        c.stroke();
      }
    }
    if (p.fury > 0) {
      // Furia: aura dentada verde (distinta de la onda del golpe al suelo)
      c.beginPath();
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = r + 4 + (i % 2 === 0 ? 3 : 0) + (this.reduced ? 0 : Math.sin(t / 60 + i) * 1);
        c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      c.strokeStyle = 'rgba(120,230,80,0.85)';
      c.lineWidth = 2;
      c.stroke();
    }
    if (p.slowNow > 0 || p.slowTicks > 0 || p.capSlowTicks > 0) {
      c.beginPath();
      c.arc(x, y, r + 3, 0, Math.PI * 2);
      c.setLineDash([3, 3]);
      c.strokeStyle = p.capSlowTicks > 0 ? 'rgba(255,140,40,0.9)' : 'rgba(30,30,40,0.8)';
      c.lineWidth = 2;
      c.stroke();
      c.setLineDash([]);
    }

    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = team;
    c.fill();
    if (s.mode !== 'classic') {
      // emblema dentro de un anillo del color del equipo
      c.save();
      c.translate(x, y);
      drawHero(c, p.hero, r - 5);
      c.restore();
    }
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.lineWidth = 2;
    c.strokeStyle = p.input & IN.KICK && p.stun === 0 ? '#fff' : '#000';
    c.stroke();

    if (p.stun > 0) {
      // aturdido: anillo amarillo con el tiempo que le queda y estrellitas encima
      const total = this.stunTotal.get(p.id) ?? p.stun;
      this.progress(c, x, y, r + 5, p.stun / Math.max(1, total), FX_COLOR.stun, 2.5);
      for (let i = 0; i < 3; i++) {
        const a = (this.reduced ? 0 : t / 250) + (i * Math.PI * 2) / 3;
        c.save();
        c.translate(x + Math.cos(a) * r * 0.7, y - r - 6 + Math.sin(a) * 3);
        this.star(c, 3, FX_COLOR.stun);
        c.restore();
      }
    }

    // indicador de dirección apuntada del jugador local
    if (local && s.mode !== 'classic') {
      const ax = x + p.ax * (r + 6);
      const ay = y + p.ay * (r + 6);
      c.save();
      c.translate(ax, ay);
      c.rotate(Math.atan2(p.ay, p.ax));
      c.beginPath();
      c.moveTo(4, 0);
      c.lineTo(-2, -3.5);
      c.lineTo(-2, 3.5);
      c.closePath();
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.fill();
      c.restore();
    }

    if (o.showNames) {
      const name = o.names.get(p.id) ?? '';
      if (name) {
        c.font = '600 10px "Open Sans", Arial, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'top';
        c.lineWidth = 3;
        c.strokeStyle = 'rgba(0,0,0,0.6)';
        c.strokeText(name, x, y + r + 4);
        c.fillStyle = local ? '#fff' : 'rgba(255,255,255,0.9)';
        c.fillText(name, x, y + r + 4);
      }
    }
  }

  /** Mira sobre el objetivo que tomaría el autoapuntado de tu Q, y ayudas de alcance de otros poderes. */
  private drawAimReticle(c: CanvasRenderingContext2D, s: GameState, localId: string): void {
    if (s.mode === 'classic' || s.phase !== 'playing' || s.paused) return;
    const me = s.players.find((p) => p.id === localId);
    if (!me || me.stun > 0) return;
    const P = powersFor(s.mode);
    // gancho listo y la pelota a su alcance: pequeño rombo sobre la pelota
    if (me.hero === 'batman' && me.cdE === 0 && grappleAim(s, me)?.inRange) {
      c.save();
      c.translate(s.ball.x, s.ball.y - s.ball.r - 7);
      c.beginPath();
      c.moveTo(0, -3.5);
      c.lineTo(3.5, 0);
      c.lineTo(0, 3.5);
      c.lineTo(-3.5, 0);
      c.closePath();
      c.fillStyle = 'rgba(242,194,48,0.9)';
      c.fill();
      c.restore();
    }
    // Hulk: el alcance real del golpe al suelo (anticipación de la Q)
    if (me.hero === 'hulk' && me.cdQ === 0) {
      c.beginPath();
      c.arc(me.d.x, me.d.y, P.hulk.slam.range + me.d.r, 0, Math.PI * 2);
      c.setLineDash([4, 6]);
      c.strokeStyle = 'rgba(155,227,107,0.45)';
      c.lineWidth = 1.5;
      c.stroke();
      c.setLineDash([]);
    }
    // Thor: rival que marcaría el rayo paralizante
    if (me.hero === 'thor' && me.cdE === 0) {
      const t = boltTarget(s, me);
      if (t) {
        c.save();
        c.translate(t.d.x, t.d.y - t.d.r - 9);
        c.beginPath();
        c.moveTo(-4, -4);
        c.lineTo(4, -4);
        c.lineTo(0, 3);
        c.closePath();
        c.fillStyle = 'rgba(255,225,90,0.95)';
        c.fill();
        c.restore();
      }
    }
    if (me.cdQ > 0) return;
    const aim = autoAim(s, me);
    if (!aim) return;
    const t = aim.target;
    const r = (t.kind === 'ball' ? s.ball.r : me.d.r) + 5;
    c.save();
    c.translate(t.x, t.y);
    if (!this.reduced) c.rotate(performance.now() / 600);
    c.strokeStyle = me.hero === 'spider' ? 'rgba(255,255,255,0.85)' : 'rgba(242,194,48,0.9)';
    c.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.arc(0, 0, r, i * (Math.PI / 2) + 0.25, (i + 1) * (Math.PI / 2) - 0.25);
      c.stroke();
    }
    c.restore();
  }

  private drawFx(c: CanvasRenderingContext2D): void {
    const now = performance.now();
    this.fx = this.fx.filter((f) => now - f.t0 < f.dur);
    for (const f of this.fx) {
      const k = (now - f.t0) / f.dur;
      c.globalAlpha = 1 - k;
      c.strokeStyle = f.color;
      c.fillStyle = f.color;
      switch (f.kind) {
        case 'ring':
          c.lineWidth = 3;
          c.beginPath();
          c.arc(f.x, f.y, f.r * (this.reduced ? 1 : 0.4 + 0.6 * k), 0, Math.PI * 2);
          c.stroke();
          break;
        case 'wave':
          // onda expansiva que termina exactamente en el radio real del efecto
          c.globalAlpha = (1 - k) * 0.22;
          c.beginPath();
          c.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          c.fill();
          c.globalAlpha = 1 - k;
          c.lineWidth = 3;
          c.beginPath();
          c.arc(f.x, f.y, f.r * (this.reduced ? 1 : Math.min(1, 0.3 + k * 1.4)), 0, Math.PI * 2);
          c.stroke();
          break;
        case 'line':
          c.setLineDash([5, 5]);
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(f.x, f.y);
          c.lineTo(f.x2!, f.y2!);
          c.stroke();
          c.setLineDash([]);
          break;
        case 'mark':
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(f.x - f.r, f.y - f.r);
          c.lineTo(f.x + f.r, f.y + f.r);
          c.moveTo(f.x + f.r, f.y - f.r);
          c.lineTo(f.x - f.r, f.y + f.r);
          c.stroke();
          break;
        default:
          c.lineWidth = 1.5;
          for (let i = 0; i < 6; i++) {
            const a = (i * Math.PI) / 3;
            c.beginPath();
            c.moveTo(f.x + Math.cos(a) * f.r * k * 0.3, f.y + Math.sin(a) * f.r * k * 0.3);
            c.lineTo(f.x + Math.cos(a) * f.r * k, f.y + Math.sin(a) * f.r * k);
            c.stroke();
          }
      }
    }
    c.globalAlpha = 1;
  }

  private drawBanner(c: CanvasRenderingContext2D, W: number, H: number, s: GameState): void {
    const now = performance.now();
    let lines: string[] | null = null;
    let color = '#fff';
    let alpha = 1;
    if (this.banner && now - this.banner.t0 < this.banner.dur) {
      const k = (now - this.banner.t0) / this.banner.dur;
      lines = this.banner.lines;
      color = this.banner.color;
      alpha = k > 0.8 ? (1 - k) / 0.2 : 1;
    } else if (s.paused) {
      lines = ['Pausa'];
    }
    if (!lines) return;
    const size = Math.max(18, Math.min(W, H) * 0.06);
    c.globalAlpha = alpha;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    lines.forEach((line, i) => {
      const fs = i === 0 ? size : size * 0.45;
      c.font = `900 ${fs}px "Arial Black", Arial, sans-serif`;
      const y = H * 0.16 + (i === 0 ? 0 : size * 0.85);
      c.lineWidth = fs * 0.14;
      c.strokeStyle = '#000';
      c.strokeText(line, W / 2, y);
      c.fillStyle = i === 0 ? color : '#fff';
      c.fillText(line, W / 2, y);
    });
    c.globalAlpha = 1;
  }
}
