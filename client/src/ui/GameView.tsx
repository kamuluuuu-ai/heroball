import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GEM_COLOR, GEM_IDS, GEM_LABEL, POWERS, TICK_RATE, heroInfo, powersFor } from '../../../shared/config';
import { clockText } from '../../../shared/game';
import { gemActive, powerActive } from '../../../shared/powers';
import type { GameState, PlayerState } from '../../../shared/types';
import { IN } from '../../../shared/types';
import { drawGemIcon, drawPowerIcon } from '../game/heroArt';
import { InputState, joystickBits, typingInForm } from '../game/input';
import { GameRunner } from '../game/runner';
import type { Session } from '../game/sessions';
import { isTouchDevice, type Prefs } from '../prefs';

const motionQuery = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;
function prefersReducedMotion(): boolean {
  return motionQuery?.matches ?? false;
}
import { Chat, type ChatProps } from './Chat';

interface Props {
  session: Session;
  names: Map<string, string>;
  prefs: Prefs;
  chat?: ChatProps;
  menuOpen: boolean;
  onToggleMenu: () => void;
  /** Contenido del menú (Escape). */
  menu: ReactNode;
  /** Texto a la derecha de la barra superior (ping, modo...). */
  status?: ReactNode;
  /** Mensaje cuando no hay partido en curso. */
  idle?: ReactNode;
  extraKeys?: (e: KeyboardEvent) => void;
}

export function GameView(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const redRef = useRef<HTMLSpanElement>(null);
  const blueRef = useRef<HTMLSpanElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const powersRef = useRef<HTMLDivElement>(null);
  const gemsRef = useRef<HTMLDivElement>(null);
  const quizRef = useRef<HTMLDivElement>(null);
  const idleRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputState | null>(null);
  const runnerRef = useRef<GameRunner | null>(null);
  const propsRef = useRef(p);
  propsRef.current = p;
  const [chatFocus, setChatFocus] = useState(0);
  const touch = p.prefs.touch === 'on' || (p.prefs.touch === 'auto' && isTouchDevice());
  const touchRef = useRef(touch);
  touchRef.current = touch;

  // bucle de juego
  useEffect(() => {
    const input = new InputState();
    inputRef.current = input;
    const hud = new HudWriter(redRef.current!, blueRef.current!, clockRef.current!, powersRef.current!, idleRef.current!, gemsRef.current!, quizRef.current!, input, () => propsRef.current.names);
    const runner = new GameRunner(
      canvasRef.current!,
      p.session,
      input,
      () => ({
        names: propsRef.current.names, zoom: propsRef.current.prefs.zoom, showNames: propsRef.current.prefs.showNames, debug: propsRef.current.prefs.debug,
        reducedFx: propsRef.current.prefs.effects === 'reduced' || prefersReducedMotion(),
        // con teclado la barra de poderes (y la de gemas) va debajo de la cancha; en táctil se oculta
        insetBottom: touchRef.current ? 0 : hudHeight(powersRef.current, gemsRef.current),
      }),
      (view) => hud.update(view, p.session.localId),
    );
    runnerRef.current = runner;
    runner.start();
    // gancho de inspección para pruebas manuales/automatizadas (sólo lectura)
    (window as unknown as { __heroball: unknown }).__heroball = { session: p.session, input };
    return () => {
      runner.stop();
      input.dispose();
    };
  }, [p.session]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.enabled = !p.menuOpen;
      if (p.menuOpen) inputRef.current.clear();
    }
  }, [p.menuOpen]);

  // teclas de interfaz
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        if (typingInForm()) {
          (document.activeElement as HTMLElement).blur();
          return;
        }
        e.preventDefault();
        propsRef.current.onToggleMenu();
        return;
      }
      if (typingInForm()) return;
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && propsRef.current.chat) {
        e.preventDefault();
        inputRef.current?.clear();
        setChatFocus((n) => n + 1);
        return;
      }
      propsRef.current.extraKeys?.(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="game-root" ref={rootRef}>
      <div className="topbar">
        <div className="score">
          <span className="sq red" />
          <span ref={redRef} className="num">0</span>
          <span className="dash">-</span>
          <span ref={blueRef} className="num">0</span>
          <span className="sq blue" />
          <span ref={clockRef} className="clock">00:00</span>
        </div>
        <div className="topbar-right">
          {p.status}
          <button className="tb-btn" onClick={fullscreen} title="Pantalla completa" aria-label="Pantalla completa">⛶</button>
          <button className="tb-btn" onClick={p.onToggleMenu} title="Menú (Esc)">Menú</button>
        </div>
      </div>
      <div className={`stage${touch ? ' touch-mode' : ''}`}>
        <canvas ref={canvasRef} className="field" />
        <div ref={idleRef} className="idle-msg" style={{ display: 'none' }}>{p.idle}</div>
        <div ref={powersRef} className="powerbar" />
        <div ref={gemsRef} className="gembar" style={{ display: 'none' }} />
        <div ref={quizRef} className="quiz" style={{ display: 'none' }} role="dialog" aria-live="assertive" />
        {p.chat && <Chat {...p.chat} focusSignal={chatFocus} onBlurInput={() => inputRef.current?.clear()} />}
        {touch && !p.menuOpen && <TouchControls input={inputRef} />}
        {touch && <div className="rotate-hint">Girá el teléfono para ver la cancha más grande</div>}
        {p.menuOpen && <div className="menu-overlay">{p.menu}</div>}
      </div>
    </div>
  );
}

/** Alto (px) que ocupan las barras visibles de poderes y gemas, más un margen. */
function hudHeight(powers: HTMLElement | null, gems: HTMLElement | null): number {
  let h = 0;
  if (powers && powers.style.display !== 'none' && powers.childElementCount) h += powers.offsetHeight + 12;
  if (gems && gems.style.display !== 'none') h += gems.offsetHeight + 6;
  return h;
}

/** Qué toma cada gema (se muestra en la barra de gemas). */
function gemTarget(i: number): string {
  switch (GEM_IDS[i]) {
    case 'time': return 'rival cercano';
    case 'mind': return 'rival a la vista';
    case 'reality': return 'engaña rivales';
    case 'space': return 'ir a la pelota';
    default: return 'tu patada';
  }
}

type Slot = { root: HTMLDivElement; cd: HTMLSpanElement; fill: HTMLDivElement; icon: HTMLCanvasElement; label: HTMLSpanElement; state: HTMLSpanElement; ammo: HTMLSpanElement };

/** Actualiza el HUD directamente en el DOM, sólo cuando cambia algo. */
class HudWriter {
  private last = { red: -1, blue: -1, clock: '', hero: '', q: '', e: '', idle: true, mode: '', gem: -1, quiz: '' };
  private q: Slot | null = null;
  private e: Slot | null = null;
  private gemItems: { root: HTMLButtonElement; cd: HTMLSpanElement; state: HTMLSpanElement }[] = [];

  constructor(
    private red: HTMLElement,
    private blue: HTMLElement,
    private clock: HTMLElement,
    private powers: HTMLDivElement,
    private idle: HTMLDivElement,
    private gems: HTMLDivElement,
    private quiz: HTMLDivElement,
    private input: InputState,
    private names: () => Map<string, string>,
  ) {}

  private slot(key: 'Q' | 'E'): Slot {
    const root = document.createElement('div');
    root.className = 'pslot';
    const icon = document.createElement('canvas');
    icon.width = icon.height = 56;
    const fill = document.createElement('div');
    fill.className = 'pfill';
    const k = document.createElement('span');
    k.className = 'pkey';
    k.textContent = key;
    const cd = document.createElement('span');
    cd.className = 'pcd';
    // balas de CJ (vacío para los demás)
    const ammo = document.createElement('span');
    ammo.className = 'pammo';
    const box = document.createElement('div');
    box.className = 'pbox';
    box.append(icon, fill, k, cd, ammo);
    // nombre del poder y estado en texto: no depende del color ni de pasar el mouse
    const label = document.createElement('span');
    label.className = 'plabel';
    const state = document.createElement('span');
    state.className = 'pstate';
    root.append(box, label, state);
    root.setAttribute('role', 'status');
    this.powers.append(root);
    return { root, cd, fill, icon, label, state, ammo };
  }

  /** Barra de gemas de Thanos: nombre, tecla, objetivo, estado y recarga; tocar una la elige. */
  private buildGems(): void {
    this.gems.textContent = '';
    this.gemItems = GEM_IDS.map((g, i) => {
      const root = document.createElement('button');
      root.type = 'button';
      root.className = 'gem';
      root.setAttribute('aria-label', `Gema ${GEM_LABEL[g]} (tecla ${i + 1})`);
      const icon = document.createElement('canvas');
      icon.width = icon.height = 40;
      drawGemIcon(icon.getContext('2d')!, GEM_COLOR[g], 40);
      const key = document.createElement('span');
      key.className = 'gkey';
      key.textContent = String(i + 1);
      const name = document.createElement('span');
      name.className = 'gname';
      name.textContent = GEM_LABEL[g];
      const target = document.createElement('span');
      target.className = 'gtarget';
      target.textContent = gemTarget(i);
      const cd = document.createElement('span');
      cd.className = 'gcd';
      const state = document.createElement('span');
      state.className = 'gstate';
      root.append(icon, key, cd, name, target, state);
      root.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.input.pulseNum(i + 1);
      });
      this.gems.append(root);
      return { root, cd, state };
    });
  }

  /** Quiz de Baldi: sólo lo ve el jugador afectado. Teclas 1/2/3 o tocar la respuesta. */
  private paintQuiz(s: GameState, p: PlayerState): void {
    const q = p.quiz;
    const key = q ? `${q.by}|${q.text}|${q.opts.join(',')}` : '';
    if (key !== this.last.quiz) {
      // al abrir y al cerrar se sueltan todas las teclas (nada queda trabado)
      this.input.clear();
      this.last.quiz = key;
      this.quiz.textContent = '';
      this.quiz.style.display = q ? '' : 'none';
      if (q) {
        const who = document.createElement('div');
        who.className = 'quiz-by';
        who.textContent = `Quiz de ${this.names().get(q.by) ?? 'Baldi'}: respondé para volver a jugar`;
        const text = document.createElement('div');
        text.className = 'quiz-q';
        text.textContent = `${q.text} = ?`;
        const opts = document.createElement('div');
        opts.className = 'quiz-opts';
        q.opts.forEach((v, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'quiz-opt';
          b.innerHTML = '';
          const k = document.createElement('span');
          k.className = 'qk';
          k.textContent = String(i + 1);
          const n = document.createElement('span');
          n.textContent = String(v);
          b.append(k, n);
          b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this.input.pulseNum(i + 1);
          });
          opts.append(b);
        });
        const bar = document.createElement('div');
        bar.className = 'quiz-bar';
        bar.append(document.createElement('div'));
        const wrong = document.createElement('div');
        wrong.className = 'quiz-wrong';
        this.quiz.append(who, text, opts, bar, wrong);
      }
    }
    if (q) {
      const fill = this.quiz.querySelector('.quiz-bar > div') as HTMLDivElement | null;
      const w = `${Math.round((q.ticks / Math.max(1, q.max)) * 100)}%`;
      if (fill && fill.style.width !== w) fill.style.width = w;
      const wrong = this.quiz.querySelector('.quiz-wrong') as HTMLDivElement | null;
      const t = q.wrong > 0 ? `Incorrecto (${q.wrong}). Probá otra.` : '';
      if (wrong && wrong.textContent !== t) wrong.textContent = t;
    }
    void s;
  }

  update(s: GameState | null, me: string): void {
    const L = this.last;
    const idle = !s;
    if (idle !== L.idle) {
      this.idle.style.display = idle ? '' : 'none';
      L.idle = idle;
    }
    if (!s) {
      this.powers.style.display = 'none';
      this.gems.style.display = 'none';
      this.quiz.style.display = 'none';
      L.quiz = '';
      return;
    }
    if (s.score.red !== L.red) this.red.textContent = String((L.red = s.score.red));
    if (s.score.blue !== L.blue) this.blue.textContent = String((L.blue = s.score.blue));
    const clock = clockText(s) + (s.overtime ? ' +' : '');
    if (clock !== L.clock) {
      this.clock.textContent = L.clock = clock;
      this.clock.classList.toggle('over', s.overtime || (s.timeLimit > 0 && s.timeLimit - s.time < 10 * TICK_RATE));
    }
    const p = s.mode !== 'classic' ? s.players.find((o) => o.id === me) : undefined;
    this.powers.style.display = p ? '' : 'none';
    const thanos = p?.hero === 'thanos';
    this.gems.style.display = thanos ? '' : 'none';
    if (!p) {
      this.quiz.style.display = 'none';
      L.quiz = '';
      return;
    }
    this.paintQuiz(s, p);
    if (!this.q) {
      this.q = this.slot('Q');
      this.e = this.slot('E');
    }
    const info = heroInfo(p.hero, s.mode);
    const heroKey = p.hero + s.mode + (thanos ? p.gem : '');
    if (heroKey !== L.hero) {
      L.hero = heroKey;
      for (const [sl, key] of [[this.q, 'q'], [this.e!, 'e']] as const) {
        const c = sl.icon.getContext('2d')!;
        c.clearRect(0, 0, 56, 56);
        if (thanos && key === 'q') drawGemIcon(c, GEM_COLOR[GEM_IDS[p.gem]], 56);
        else drawPowerIcon(c, p.hero, key, 56);
        const pw = thanos && key === 'q' ? info.gems![p.gem] : info[key];
        sl.root.title = `${pw.name}: ${pw.desc}`;
        sl.label.textContent = pw.name;
      }
      if (thanos) this.buildGems();
      this.q.ammo.textContent = '';
    }
    // aturdido, atrapado, controlado o con quiz: el texto dice por qué
    const why = p.stun > 0 ? 'Aturdido' : p.mind > 0 ? 'Controlado' : p.quiz ? 'Quiz' : null;
    const blocked = s.phase !== 'playing' || s.paused || why !== null;
    if (thanos) {
      const P = powersFor(s.mode).thanos;
      const cds = [P.time, P.mind, P.reality, P.space, P.power].map((g) => g.cooldown);
      const g = p.gem;
      const cd = Math.max(p.gemCd[g], p.gemGap);
      this.paint(this.q, cd, Math.max(cds[g], 1), blocked, gemActive(s, p, g), s.noCd && p.gemGap === 0, why);
      this.paint(this.e!, 0, 1, s.phase !== 'playing' || s.paused, false, s.noCd, why);
      this.gemItems.forEach((it, i) => {
        it.root.classList.toggle('sel', i === g);
        const active = gemActive(s, p, i);
        const c = p.gemCd[i];
        const txt = !s.noCd && c > 0 ? (c / TICK_RATE).toFixed(c < TICK_RATE * 3 ? 1 : 0) : '';
        if (it.cd.textContent !== txt) it.cd.textContent = txt;
        const st = active ? 'ACTIVA' : c > 0 && !s.noCd ? 'Recarga' : 'Lista';
        if (it.state.textContent !== st) it.state.textContent = st;
        it.root.classList.toggle('ready', !active && (c === 0 || s.noCd));
      });
      return;
    }
    if (p.hero === 'cj') {
      // tres balas: llenas/vacías; durante la recarga, el tiempo restante
      const shots = POWERS.cj.gun.shots;
      const t = '●'.repeat(Math.max(0, p.ammo)) + '○'.repeat(Math.max(0, shots - p.ammo));
      if (this.q.ammo.textContent !== t) this.q.ammo.textContent = t;
    }
    // misma regla que la simulación: activo mientras dura su lanzamiento, canalización o efecto propio
    const qCd = p.hero === 'cj' && p.ammo > 0 ? p.shotGap : p.cdQ;
    const qTotal = p.hero === 'cj' && p.ammo > 0 ? powersFor(s.mode).cj.gun.gap : info.q.cooldown;
    const trapped = p.trap > 0 ? 'Atrapado' : null;
    this.paint(this.q, qCd, qTotal, blocked, powerActive(s, p, 'q'), s.noCd && !(p.hero === 'cj' && p.shotGap > 0), why);
    this.paint(this.e!, p.cdE, info.e.cooldown, blocked, powerActive(s, p, 'e'), s.noCd, why ?? trapped);
  }

  private paint(sl: Slot, cd: number, total: number, blocked: boolean, active: boolean, noCd: boolean, why: string | null) {
    // sin cooldowns no hay números de recarga ficticios: sólo LISTO o ACTIVA
    const txt = !noCd && cd > 0 ? (cd / TICK_RATE).toFixed(cd < TICK_RATE * 3 ? 1 : 0) : '';
    if (sl.cd.textContent !== txt) sl.cd.textContent = txt;
    const h = noCd ? '0%' : `${Math.round(Math.min(1, cd / total) * 100)}%`;
    if (sl.fill.style.height !== h) sl.fill.style.height = h;
    sl.root.classList.toggle('ready', (noCd || cd === 0) && !blocked && !active);
    sl.root.classList.toggle('blocked', blocked);
    sl.root.classList.toggle('active', active);
    const state = noCd
      ? (active ? 'ACTIVA' : why ?? (blocked ? 'En pausa' : 'LISTO'))
      : (active ? 'Activo' : why ?? (blocked ? 'En pausa' : cd > 0 ? 'Recargando' : 'Listo'));
    if (sl.state.textContent !== state) sl.state.textContent = state;
    // en táctil la barra se oculta: el botón Q/E muestra la recarga
    const btn = this.powers.parentElement?.querySelector<HTMLElement>(`.tbtn.${sl === this.q ? 'q' : 'e'}`);
    if (btn) {
      const label = txt || (sl === this.q ? 'Q' : 'E');
      if (btn.textContent !== label) btn.textContent = label;
      btn.classList.toggle('cool', txt !== '' || blocked);
      btn.classList.toggle('active', active);
    }
  }
}

function capture(e: React.PointerEvent): void {
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    /* puntero ya liberado */
  }
}

function TouchControls({ input }: { input: React.MutableRefObject<InputState | null> }) {
  const joyRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const state = useRef({ joy: 0, btn: 0, pid: -1, ox: 0, oy: 0 });

  const sync = () => {
    if (input.current) input.current.touchBits = state.current.joy | state.current.btn;
  };

  useEffect(() => () => {
    if (input.current) input.current.touchBits = 0;
  }, [input]);

  const joyDown = (e: React.PointerEvent) => {
    const st = state.current;
    if (st.pid !== -1) return;
    st.pid = e.pointerId;
    st.ox = e.clientX;
    st.oy = e.clientY;
    capture(e);
    const base = joyRef.current!;
    const rect = base.parentElement!.getBoundingClientRect();
    base.style.left = `${e.clientX - rect.left}px`;
    base.style.top = `${e.clientY - rect.top}px`;
    base.style.opacity = '1';
    knobRef.current!.style.transform = 'translate(-50%,-50%)';
  };
  const joyMove = (e: React.PointerEvent) => {
    const st = state.current;
    if (e.pointerId !== st.pid) return;
    let dx = e.clientX - st.ox;
    let dy = e.clientY - st.oy;
    const len = Math.hypot(dx, dy);
    const max = 45;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    knobRef.current!.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    st.joy = joystickBits(dx, dy, 12);
    sync();
  };
  const joyUp = (e: React.PointerEvent) => {
    const st = state.current;
    if (e.pointerId !== st.pid) return;
    st.pid = -1;
    st.joy = 0;
    joyRef.current!.style.opacity = '0.45';
    knobRef.current!.style.transform = 'translate(-50%,-50%)';
    sync();
  };
  const btn = (bit: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      state.current.btn |= bit;
      sync();
      capture(e);
    },
    onPointerUp: () => { state.current.btn &= ~bit; sync(); },
    onPointerCancel: () => { state.current.btn &= ~bit; sync(); },
    onLostPointerCapture: () => { state.current.btn &= ~bit; sync(); },
  });

  return (
    <div className="touch">
      <div className="joy-zone" onPointerDown={joyDown} onPointerMove={joyMove} onPointerUp={joyUp} onPointerCancel={joyUp}>
        <div className="joy-base" ref={joyRef}>
          <div className="joy-knob" ref={knobRef} />
        </div>
      </div>
      <div className="touch-btns">
        <button className="tbtn q" aria-label="Poder Q" {...btn(IN.Q)}>Q</button>
        <button className="tbtn e" aria-label="Poder E" {...btn(IN.E)}>E</button>
        <button className="tbtn kick" aria-label="Patear" {...btn(IN.KICK)}>⚽</button>
      </div>
    </div>
  );
}
