// Teclado y controles táctiles → bits de entrada.
import { IN } from '../../../shared/types';

const KEYMAP: Record<string, number> = {
  KeyW: IN.UP, ArrowUp: IN.UP,
  KeyS: IN.DOWN, ArrowDown: IN.DOWN,
  KeyA: IN.LEFT, ArrowLeft: IN.LEFT,
  KeyD: IN.RIGHT, ArrowRight: IN.RIGHT,
  Space: IN.KICK, KeyX: IN.KICK,
  KeyQ: IN.Q, KeyE: IN.E,
};

/** ¿El foco está en un campo de texto o formulario? */
export function typingInForm(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export class InputState {
  private keys = new Set<string>();
  /** Bits de los controles táctiles (joystick + botones). */
  touchBits = 0;
  enabled = true;
  private cleanup: () => void;

  constructor() {
    const down = (e: KeyboardEvent) => {
      if (!(e.code in KEYMAP)) return;
      if (typingInForm() || !this.enabled) return;
      this.keys.add(e.code);
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
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
    this.touchBits = 0;
  }

  bits(): number {
    if (!this.enabled || typingInForm()) return 0;
    let b = this.touchBits;
    for (const k of this.keys) b |= KEYMAP[k] ?? 0;
    // direcciones opuestas se anulan
    if ((b & IN.UP) && (b & IN.DOWN)) b &= ~(IN.UP | IN.DOWN);
    if ((b & IN.LEFT) && (b & IN.RIGHT)) b &= ~(IN.LEFT | IN.RIGHT);
    return b;
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
