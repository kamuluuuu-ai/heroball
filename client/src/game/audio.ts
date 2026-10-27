// Sonidos sintetizados con WebAudio (sin archivos externos).
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.5;
let enabled = true;

function ac(): AudioContext | null {
  if (!enabled || volume <= 0) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  master!.gain.value = volume;
  return ctx;
}

export function setAudio(on: boolean, vol: number): void {
  enabled = on;
  volume = Math.max(0, Math.min(1, vol));
  if (master) master.gain.value = volume;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slide = 0): void {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), c.currentTime + dur);
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g).connect(master!);
  o.start();
  o.stop(c.currentTime + dur);
}

function noise(dur: number, gain: number, freq: number): void {
  const c = ac();
  if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master!);
  src.start();
}

export const sfx = {
  kick(power = 1) {
    tone(160 * power, 0.08, 'triangle', 0.5, 0.5);
    noise(0.05, 0.4, 1800);
  },
  goal() {
    noise(1.4, 0.35, 900);
    tone(523, 0.25, 'square', 0.12);
    setTimeout(() => tone(659, 0.25, 'square', 0.12), 160);
    setTimeout(() => tone(784, 0.45, 'square', 0.12), 320);
  },
  power(hero: string) {
    const f = { spider: 880, batman: 330, hulk: 120, superman: 660 }[hero] ?? 500;
    tone(f, 0.18, 'sawtooth', 0.12, 1.6);
  },
  slam() {
    tone(90, 0.35, 'sine', 0.6, 0.4);
    noise(0.25, 0.3, 300);
  },
  hit() {
    tone(1200, 0.05, 'square', 0.08, 0.6);
  },
  whistle() {
    tone(2100, 0.35, 'sine', 0.12);
  },
};
