// Teclado y controles táctiles → bits de entrada.
import { IN, IN_NUM_SHIFT } from '../../../shared/types';

const KEYMAP: Record<string, number> = {
  KeyW: IN.UP, ArrowUp: IN.UP,
  KeyS: IN.DOWN, ArrowDown: IN.DOWN,
  KeyA: IN.LEFT, ArrowLeft: IN.LEFT,
  KeyD: IN.RIGHT, ArrowRight: IN.RIGHT,
  Space: IN.KICK, KeyX: IN.KICK,
  KeyQ: IN.Q, KeyE: IN.E,
};

/** Teclas numéricas 1-5 (gemas de Thanos; 1-3 responden el quiz de Baldi). */
const NUMKEYS: Record<string, number> = {
  Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5,
  Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5,
};
/** Un toque en pantalla (gema o respuesta) se mantiene este tiempo para que llegue a la simulación. */
const PULSE_MS = 150;

/** ¿El foco está en un campo de texto o formulario? */
export function typingInForm(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export class InputState {
  private keys = new Set<string>();
  /** Teclas numéricas apretadas, en orden (vale la última). */
  private nums: string[] = [];
  private pulse = { n: 0, until: 0 };
  /** Bits de los controles táctiles (joystick + botones). */
  touchBits = 0;
  enabled = true;
  private cleanup: () => void;

  constructor() {
    const down = (e: KeyboardEvent) => {
      if (typingInForm() || !this.enabled) return;
      if (e.code in NUMKEYS) {
        // sin modificadores: no interfiere con atajos del navegador
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!this.nums.includes(e.code)) this.nums.push(e.code);
        e.preventDefault();
        return;
      }
      if (!(e.code in KEYMAP)) return;
      this.keys.add(e.code);
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
      this.nums = this.nums.filter((k) => k !== e.code);
    };
    const clear = () => this.clear();
    const vis = () => { if (document.hidden) this.clear(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', vis);
    this.cleanup = () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', vis);
    };
  }

  /** Limpia todo (perder foco, abrir chat o menú) para evitar movimiento trabado. */
  clear(): void {
    this.keys.clear();
    this.nums = [];
    this.pulse.n = 0;
    this.touchBits = 0;
  }

  /** Toque en una gema o respuesta: el número viaja como entrada un instante. */
  pulseNum(n: number): void {
    this.pulse = { n, until: performance.now() + PULSE_MS };
  }

  bits(): number {
    if (!this.enabled || typingInForm()) return 0;
    let b = this.touchBits;
    for (const k of this.keys) b |= KEYMAP[k] ?? 0;
    // direcciones opuestas se anulan
    if ((b & IN.UP) && (b & IN.DOWN)) b &= ~(IN.UP | IN.DOWN);
    if ((b & IN.LEFT) && (b & IN.RIGHT)) b &= ~(IN.LEFT | IN.RIGHT);
    const num = this.pulse.n && performance.now() < this.pulse.until ? this.pulse.n : NUMKEYS[this.nums[this.nums.length - 1]] ?? 0;
    return b | (num << IN_NUM_SHIFT);
  }

  dispose(): void {
    this.cleanup();
  }
}

/** Joystick analógico → 8 direcciones. */
export function joystickBits(dx: number, dy: number, dead: number): number {
  if (Math.hypot(dx, dy) < dead) return 0;
  const ang = Math.atan2(dy, dx);
  const oct = Math.round(ang / (Math.PI / 4));
  const vx = Math.round(Math.cos(oct * (Math.PI / 4)));
  const vy = Math.round(Math.sin(oct * (Math.PI / 4)));
  let b = 0;
  if (vx > 0) b |= IN.RIGHT;
  if (vx < 0) b |= IN.LEFT;
  if (vy > 0) b |= IN.DOWN;
  if (vy < 0) b |= IN.UP;
  return b;
}
