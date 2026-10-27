import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TICK_RATE, heroInfo } from '../../../shared/config';
import { clockText } from '../../../shared/game';
import type { GameState } from '../../../shared/types';
import { IN } from '../../../shared/types';
import { drawPowerIcon } from '../game/heroArt';
import { InputState, joystickBits, typingInForm } from '../game/input';
import { GameRunner } from '../game/runner';
import type { Session } from '../game/sessions';
import { isTouchDevice, type Prefs } from '../prefs';
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
  const idleRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputState | null>(null);
  const runnerRef = useRef<GameRunner | null>(null);
  const propsRef = useRef(p);
  propsRef.current = p;
  const [chatFocus, setChatFocus] = useState(0);
  const touch = p.prefs.touch === 'on' || (p.prefs.touch === 'auto' && isTouchDevice());

  // bucle de juego
  useEffect(() => {
    const input = new InputState();
    inputRef.current = input;
    const hud = new HudWriter(redRef.current!, blueRef.current!, clockRef.current!, powersRef.current!, idleRef.current!);
    const runner = new GameRunner(
      canvasRef.current!,
      p.session,
      input,
      () => ({ names: propsRef.current.names, zoom: propsRef.current.prefs.zoom, showNames: propsRef.current.prefs.showNames, debug: propsRef.current.prefs.debug }),
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
      <div className="stage">
        <canvas ref={canvasRef} className="field" />
        <div ref={idleRef} className="idle-msg" style={{ display: 'none' }}>{p.idle}</div>
        <div ref={powersRef} className="powerbar" />
        {p.chat && <Chat {...p.chat} focusSignal={chatFocus} onBlurInput={() => inputRef.current?.clear()} />}
        {touch && !p.menuOpen && <TouchControls input={inputRef} />}
        {touch && <div className="rotate-hint">Girá el teléfono para ver la cancha más grande</div>}
        {p.menuOpen && <div className="menu-overlay">{p.menu}</div>}
      </div>
    </div>
  );
}

/** Actualiza el HUD directamente en el DOM, sólo cuando cambia algo. */
class HudWriter {
  private last = { red: -1, blue: -1, clock: '', hero: '', q: '', e: '', idle: true, mode: '' };
  private q: { root: HTMLDivElement; cd: HTMLSpanElement; fill: HTMLDivElement; icon: HTMLCanvasElement; label: HTMLSpanElement; state: HTMLSpanElement } | null = null;
  private e: typeof this.q = null;

  constructor(
    private red: HTMLElement,
    private blue: HTMLElement,
    private clock: HTMLElement,
    private powers: HTMLDivElement,
    private idle: HTMLDivElement,
  ) {}

  private slot(key: 'Q' | 'E') {
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
    const box = document.createElement('div');
    box.className = 'pbox';
    box.append(icon, fill, k, cd);
    // nombre del poder y estado en texto: no depende del color ni de pasar el mouse
    const label = document.createElement('span');
    label.className = 'plabel';
    const state = document.createElement('span');
    state.className = 'pstate';
    root.append(box, label, state);
    root.setAttribute('role', 'status');
    this.powers.append(root);
    return { root, cd, fill, icon, label, state };
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
    if (!p) return;
    if (!this.q) {
      this.q = this.slot('Q');
      this.e = this.slot('E');
    }
    const info = heroInfo(p.hero, s.mode);
    if (p.hero + s.mode !== L.hero) {
      L.hero = p.hero + s.mode;
      for (const [sl, key] of [[this.q, 'q'], [this.e!, 'e']] as const) {
        const c = sl.icon.getContext('2d')!;
        c.clearRect(0, 0, 56, 56);
        drawPowerIcon(c, p.hero, key, 56);
        sl.root.title = `${info[key].name}: ${info[key].desc}`;
        sl.label.textContent = info[key].name;
      }
    }
    const blocked = s.phase !== 'playing' || s.paused;
    // efectos con duración: el poder está "activo" mientras duran
    const rushQ = p.rush > 0 && p.hero === 'panther';
    const rushE = p.rush > 0 && p.hero === 'hawkeye';
    this.paint(this.q, p.cdQ, info.q.cooldown, blocked, p.superShot > 0 || p.sprint > 0 || rushQ);
    this.paint(this.e!, p.cdE, info.e.cooldown, blocked, p.dash > 0 || p.fury > 0 || p.superSpeed > 0 || p.guard > 0 || p.evade > 0 || p.thrusters > 0 || rushE);
  }

  private paint(sl: NonNullable<typeof this.q>, cd: number, total: number, blocked: boolean, active: boolean) {
    const txt = cd > 0 ? (cd / TICK_RATE).toFixed(cd < TICK_RATE * 3 ? 1 : 0) : '';
    if (sl.cd.textContent !== txt) sl.cd.textContent = txt;
    const h = `${Math.round((cd / total) * 100)}%`;
    if (sl.fill.style.height !== h) sl.fill.style.height = h;
    sl.root.classList.toggle('ready', cd === 0 && !blocked);
    sl.root.classList.toggle('blocked', blocked);
    sl.root.classList.toggle('active', active);
    const state = active ? 'Activo' : blocked ? 'En pausa' : cd > 0 ? 'Recargando' : 'Listo';
    if (sl.state.textContent !== state) sl.state.textContent = state;
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
