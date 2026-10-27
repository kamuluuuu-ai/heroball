// Renderizado Canvas 2D. Coordenadas físicas fijas; la cámara sólo escala y
// traslada, así la cancha nunca se deforma.
import { COLORS, KICK, STADIUM, powersFor } from '../../../shared/config';
import { stadium, type Seg } from '../../../shared/physics';
import type { GameEvent, GameState, PlayerState, Projectile, Team } from '../../../shared/types';
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
  /** Capa de depuración de contacto. */
  debug?: boolean;
}

export interface DebugLayers {
  pred: GameState | null;
  auth: GameState | null;
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
        case 'blink':
          // origen y destino del paso místico
          this.fx.push({ kind: 'ring', x: e.x0, y: e.y0, r: 18, color: '#E2A23B', t0: now, dur: 260 });
          this.fx.push({ kind: 'ring', x: e.x1, y: e.y1, r: 18, color: '#E2A23B', t0: now, dur: 260 });
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

  draw(s: GameState | null, localId: string, o: RenderOptions, dbg?: DebugLayers): void {
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
        this.drawShot(c, pr);
      }
    }
    this.drawZones(c, s);

    for (const p of s.players) this.drawPlayer(c, s, p, p.id === localId, o);
    this.drawAimReticle(c, s, localId);
    this.drawPosts(c);
    this.drawBall(c, s);
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

  /** Proyectiles de los héroes nuevos: forma propia y estela corta en la dirección de viaje. */
  private drawShot(c: CanvasRenderingContext2D, pr: Projectile): void {
    const sp = Math.hypot(pr.vx, pr.vy) || 1;
    const ux = pr.vx / sp;
    const uy = pr.vy / sp;
    const color = { arrow: '#E9D9F5', shock: '#7FD6FF', shield: '#F2F2F2', repulsor: '#9FF3FF', hammer: '#C9D2E3' }[pr.kind as 'arrow'] ?? '#fff';
    c.save();
    c.globalAlpha = pr.returning ? 0.45 : 1;
    // estela
    c.strokeStyle = color;
    c.lineWidth = Math.max(1.5, pr.r * 0.6);
    c.globalAlpha *= 0.5;
    c.beginPath();
    c.moveTo(pr.x, pr.y);
    c.lineTo(pr.x - ux * pr.r * 4, pr.y - uy * pr.r * 4);
    c.stroke();
    c.globalAlpha = pr.returning ? 0.45 : 1;
    c.translate(pr.x, pr.y);
    if (pr.kind === 'shield') {
      for (const [k, col] of [[1, '#C8232C'], [0.66, '#F2F2F2'], [0.4, '#1F3F94']] as const) {
        c.beginPath();
        c.arc(0, 0, pr.r * k, 0, Math.PI * 2);
        c.fillStyle = col;
        c.fill();
      }
    } else if (pr.kind === 'hammer') {
      c.rotate(performance.now() / 70);
      c.fillStyle = color;
      c.fillRect(-pr.r, -pr.r * 0.55, pr.r * 2, pr.r * 1.1);
      c.fillStyle = '#7B5A3A';
      c.fillRect(-pr.r * 0.2, pr.r * 0.5, pr.r * 0.4, pr.r * 1.2);
    } else {
      c.beginPath();
      c.arc(0, 0, pr.r + 1, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
      c.lineWidth = 1;
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.stroke();
    }
    c.restore();
  }

  /**
   * Zonas con anticipación visible: el relleno crece hasta el momento del
   * impacto (pulso y trueno), la estela es translúcida y el desvío muestra su
   * dirección fija con una flecha.
   */
  private drawZones(c: CanvasRenderingContext2D, s: GameState): void {
    const P = powersFor(s.mode);
    for (const z of s.zones) {
      c.save();
      if (z.kind === 'pulse' || z.kind === 'thunder') {
        const total = z.kind === 'pulse' ? P.panther.pulse.delay : P.thor.thunder.delay;
        const k = 1 - z.delay / total;
        c.beginPath();
        c.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        c.fillStyle = z.kind === 'thunder' ? 'rgba(160,200,255,0.18)' : 'rgba(170,140,255,0.16)';
        c.fill();
        c.setLineDash([5, 4]);
        c.lineWidth = 2;
        c.strokeStyle = z.kind === 'thunder' ? 'rgba(200,225,255,0.95)' : 'rgba(200,180,255,0.95)';
        c.stroke();
        c.setLineDash([]);
        c.beginPath();
        c.arc(z.x, z.y, z.r * k, 0, Math.PI * 2);
        c.lineWidth = 2;
        c.stroke();
      } else if (z.kind === 'trail') {
        c.fillStyle = 'rgba(255,214,60,0.22)';
        for (const q of z.pts) {
          c.beginPath();
          c.arc(q.x, q.y, z.r, 0, Math.PI * 2);
          c.fill();
        }
      } else {
        c.beginPath();
        c.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        c.fillStyle = 'rgba(226,162,59,0.16)';
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = 'rgba(226,162,59,0.95)';
        c.stroke();
        // flecha con la dirección fija del desvío
        c.translate(z.x, z.y);
        c.rotate(Math.atan2(z.dy, z.dx));
        c.beginPath();
        c.moveTo(-z.r * 0.6, 0);
        c.lineTo(z.r * 0.6, 0);
        c.moveTo(z.r * 0.6, 0);
        c.lineTo(z.r * 0.25, -z.r * 0.3);
        c.moveTo(z.r * 0.6, 0);
        c.lineTo(z.r * 0.25, z.r * 0.3);
        c.stroke();
      }
      c.restore();
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
    if (p.guard > 0 || p.evade > 0) {
      // resistencia a empujes de poderes: anillo doble
      c.beginPath();
      c.arc(x, y, r + 4, 0, Math.PI * 2);
      c.strokeStyle = p.guard > 0 ? 'rgba(120,170,255,0.85)' : 'rgba(220,220,230,0.7)';
      c.lineWidth = 2;
      c.stroke();
    }
    if (p.dash > 0 || p.superSpeed > 0 || p.thrusters > 0 || p.sprint > 0 || p.rush > 0) {
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
      drawHero(c, p.hero, r - 5);
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
