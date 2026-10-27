// Bucle de render (requestAnimationFrame). La simulación avanza en pasos fijos
// dentro de la sesión; React no se actualiza en cada fotograma.
import type { GameEvent, GameState } from '../../../shared/types';
import { sfx } from './audio';
import { InputState } from './input';
import { Renderer, type RenderOptions } from './renderer';
import type { Session } from './sessions';

export class GameRunner {
  renderer: Renderer;
  private raf = 0;
  private timer = 0;
  private last = 0;
  private running = false;
  private lastView: GameState | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    public session: Session,
    public input: InputState,
    private opts: () => RenderOptions,
    private onFrame: (view: GameState | null) => void,
  ) {
    this.renderer = new Renderer(canvas);
    session.onEvents = (ev) => this.handleEvents(ev);
  }

  private handleEvents(ev: GameEvent[]): void {
    this.renderer.addEvents(ev, this.lastView, this.opts().names);
    for (const e of ev) {
      switch (e.type) {
        case 'kick': sfx.kick(e.power); break;
        case 'goal': sfx.goal(); break;
        case 'power': sfx.power(e.hero); break;
        case 'slam': sfx.slam(); break;
        case 'hit': if (e.target !== 'wall') sfx.hit(); break;
        case 'end': sfx.whistle(); break;
      }
    }
  }

  private frame(t: number): void {
    const dt = t - this.last;
    this.last = t;
    this.session.update(Math.max(0, dt), this.input.bits());
    const view = this.session.view();
    this.lastView = view;
    this.renderer.draw(view, this.session.localId, this.opts());
    this.onFrame(view);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.frame(performance.now());
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    // respaldo: si el navegador estrangula requestAnimationFrame (ventana
    // oculta, ahorro de energía), la simulación sigue con un temporizador
    this.timer = window.setInterval(() => {
      const now = performance.now();
      if (this.running && now - this.last > 100) this.frame(now);
    }, 50);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.timer);
  }
}
