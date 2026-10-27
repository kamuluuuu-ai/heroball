// Renderizado Canvas 2D. Coordenadas físicas fijas; la cámara sólo escala y
// traslada, así la cancha nunca se deforma.
import { COLORS, STADIUM } from '../../../shared/config';
import { stadium, type Seg } from '../../../shared/physics';
import type { GameEvent, GameState, PlayerState, Team } from '../../../shared/types';
import { IN } from '../../../shared/types';
import { drawHero } from './heroArt';
import { autoAim, grappleAim } from '../../../shared/powers';

interface Fx {
  kind: 'ring' | 'spark';
  x: number;
  y: number;
  r: number;
  color: string;
  t0: number;
  dur: number;
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
}

const TEAM_COLOR: Record<Team, string> = { red: COLORS.red, blue: COLORS.blue };

export class Renderer {
  private c: CanvasRenderingContext2D;
  private fx: Fx[] = [];
  private banner: Banner | null = null;
  private grass: CanvasPattern | null = null;
  private camX = 0;
  private camY = 0;

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

  /** Efectos visuales disparados por eventos de la simulación. */
  addEvents(ev: GameEvent[], s: GameState | null, names: Map<string, string>): void {
    const now = performance.now();
    for (const e of ev) {
      switch (e.type) {
        case 'slam':
          this.fx.push({ kind: 'ring', x: e.x, y: e.y, r: e.r, color: '#9BE36B', t0: now, dur: 320 });
          break;
        case 'hit':
          this.fx.push({ kind: 'spark', x: e.x, y: e.y, r: 10, color: e.target === 'player' ? '#9fd1ff' : '#ffffff', t0: now, dur: 200 });
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
            if (p) this.fx.push({ kind: 'ring', x: p.d.x, y: p.d.y, r: p.d.r + 8, color: '#ffffff', t0: now, dur: 180 });
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

  draw(s: GameState | null, localId: string, o: RenderOptions): void {
    const c = this.c;
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
      } else {
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
      }
    }

    for (const p of s.players) this.drawPlayer(c, s, p, p.id === localId, o);
    this.drawAimReticle(c, s, localId);
    this.drawPosts(c);
    this.drawBall(c, s);
    this.drawFx(c);

    // textos de pantalla
    c.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBanner(c, W, H, s);
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

  private drawBall(c: CanvasRenderingContext2D, s: GameState): void {
    const b = s.ball;
    c.beginPath();
    c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    c.fillStyle = COLORS.ball;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = '#000';
    c.stroke();
  }

  private drawPlayer(c: CanvasRenderingContext2D, s: GameState, p: PlayerState, local: boolean, o: RenderOptions): void {
    const { x, y, r } = p.d;
    const team = TEAM_COLOR[p.team];
    const t = performance.now();
    // auras de efectos (breves y legibles)
    if (p.dash > 0 || p.superSpeed > 0) {
      c.strokeStyle = 'rgba(255,255,255,0.45)';
      c.lineWidth = 2;
      const sp = Math.hypot(p.d.vx, p.d.vy) || 1;
      for (const off of [-0.6, 0, 0.6]) {
        const nx = -p.d.vy / sp;
        const ny = p.d.vx / sp;
        c.beginPath();
        c.moveTo(x - (p.d.vx / sp) * r + nx * off * r, y - (p.d.vy / sp) * r + ny * off * r);
        c.lineTo(x - (p.d.vx / sp) * r * 2.4 + nx * off * r, y - (p.d.vy / sp) * r * 2.4 + ny * off * r);
        c.stroke();
      }
    }
    if (p.fury > 0) {
      c.beginPath();
      c.arc(x, y, r + 4 + Math.sin(t / 60) * 1.2, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(120,230,80,0.75)';
      c.lineWidth = 3;
      c.stroke();
    }
    if (p.superShot > 0) {
      c.beginPath();
      c.arc(x, y, r + 4, 0, Math.PI * 2);
      c.strokeStyle = `rgba(255,220,60,${0.6 + 0.3 * Math.sin(t / 80)})`;
      c.lineWidth = 3;
      c.stroke();
    }
    if (p.slowNow > 0 || p.slowTicks > 0) {
      c.beginPath();
      c.arc(x, y, r + 3, 0, Math.PI * 2);
      c.setLineDash([3, 3]);
      c.strokeStyle = 'rgba(30,30,40,0.8)';
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
      drawHero(c, p.hero, r - 3.6);
      c.restore();
    }
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.lineWidth = 2;
    c.strokeStyle = p.input & IN.KICK ? '#fff' : '#000';
    c.stroke();

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

  /** Mira sobre el objetivo que tomaría el autoapuntado de tu Q. */
  private drawAimReticle(c: CanvasRenderingContext2D, s: GameState, localId: string): void {
    if (s.mode === 'classic' || s.phase !== 'playing' || s.paused) return;
    const me = s.players.find((p) => p.id === localId);
    if (!me) return;
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
    if (me.cdQ > 0 || (me.hero !== 'spider' && me.hero !== 'batman')) return;
    const aim = autoAim(s, me);
    if (!aim) return;
    const t = aim.target;
    const r = (t.kind === 'ball' ? s.ball.r : me.d.r) + 5;
    c.save();
    c.translate(t.x, t.y);
    c.rotate(performance.now() / 600);
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
      if (f.kind === 'ring') {
        c.lineWidth = 3;
        c.beginPath();
        c.arc(f.x, f.y, f.r * (0.4 + 0.6 * k), 0, Math.PI * 2);
        c.stroke();
      } else {
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
    const size = Math.max(22, Math.min(W, H) * 0.09);
    c.globalAlpha = alpha;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    lines.forEach((line, i) => {
      const fs = i === 0 ? size : size * 0.45;
      c.font = `900 ${fs}px "Arial Black", Arial, sans-serif`;
      const y = H * 0.42 + (i === 0 ? 0 : size * 0.85);
      c.lineWidth = fs * 0.14;
      c.strokeStyle = '#000';
      c.strokeText(line, W / 2, y);
      c.fillStyle = i === 0 ? color : '#fff';
      c.fillText(line, W / 2, y);
    });
    c.globalAlpha = 1;
  }
}
